// Operations commands - balances, send, swap
// Full implementation with dapp-client integration

import { DappClient, TransportMode, jsonRevivers } from '@0xsequence/dapp-client'
import { loadWalletSession } from '../../lib/storage.mjs'
import { getArg, hasFlag, resolveNetwork, formatUnits, parseUnits, getIndexerUrl, getExplorerUrl } from '../../lib/utils.mjs'
import { resolveErc20BySymbol } from '../../lib/token-directory.mjs'

const DEFAULT_WALLET_URL = 'https://acme-wallet.ecosystem-demo.xyz'

// Balances command
export async function balances() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet')

  if (!walletName) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --wallet parameter' }, null, 2))
    process.exit(1)
  }

  try {
    // Load wallet session
    const session = await loadWalletSession(walletName)
    if (!session) {
      throw new Error(`Wallet not found: ${walletName}`)
    }

    // Get indexer key
    const indexerKey = process.env.SEQUENCE_INDEXER_ACCESS_KEY
    if (!indexerKey) {
      throw new Error('Missing SEQUENCE_INDEXER_ACCESS_KEY environment variable')
    }

    // Resolve chain
    const chainArg = getArg(args, '--chain')
    const network = resolveNetwork(chainArg || session.chain || 'polygon')

    // Use IndexerGateway endpoint (upstream fix 6034ce6)
    const indexerUrl = getIndexerUrl(network.chainId)

    // Fetch using raw API (gateway returns chain-nested response)
    const response = await fetch(indexerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Access-Key': indexerKey
      },
      body: JSON.stringify({
        accountAddress: session.walletAddress,
        includeMetadata: true
      })
    })

    if (!response.ok) {
      throw new Error(`Indexer request failed: ${response.status} ${await response.text()}`)
    }

    const data = await response.json()

    // Parse chain-specific response (upstream fix 6034ce6)
    const chainId = String(network.chainId)
    const chainEntry = data.balances?.find(b => String(b.chainId || b.chainID) === chainId)

    if (!chainEntry) {
      console.log(JSON.stringify({
        ok: true,
        walletName,
        walletAddress: session.walletAddress,
        chainId: network.chainId,
        chain: network.name,
        balances: []
      }, null, 2))
      return
    }

    const nativeDecimals = network.nativeCurrency?.decimals ?? 18

    // Parse native balances
    const nbForChain = Array.isArray(chainEntry.nativeBalances)
      ? chainEntry.nativeBalances.find(x => String(x?.chainId || x?.chainID) === chainId)
      : null

    const nativeBalances = Array.isArray(nbForChain?.results) ? nbForChain.results : []

    let native = nativeBalances.map(b => ({
      type: 'native',
      symbol: b.symbol || b.name || network.nativeCurrency?.symbol || 'NATIVE',
      balance: formatUnits(b.balance || '0', nativeDecimals)
    }))

    // RPC fallback for native balance (upstream fix 722ea1b)
    if (native.length === 0 && network.rpcUrl) {
      try {
        const rpcRes = await fetch(network.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_getBalance',
            params: [session.walletAddress, 'latest']
          })
        })

        if (rpcRes.ok) {
          const rpcJson = await rpcRes.json()
          const hex = rpcJson?.result
          if (typeof hex === 'string' && hex.startsWith('0x')) {
            const wei = BigInt(hex)
            native = [{
              type: 'native',
              symbol: network.nativeCurrency?.symbol || 'NATIVE',
              balance: formatUnits(wei, nativeDecimals)
            }]
          }
        }
      } catch (err) {
        // Fallback failed, continue with empty native balances
      }
    }

    // Parse ERC20 balances
    const balancesForChain = Array.isArray(chainEntry.balances)
      ? chainEntry.balances.find(x => String(x?.chainId || x?.chainID) === chainId)
      : null

    const tokenResults = Array.isArray(balancesForChain?.results) ? balancesForChain.results : []

    const erc20 = tokenResults.map(b => ({
      type: 'erc20',
      symbol: b.contractInfo?.symbol || 'ERC20',
      contractAddress: b.contractAddress,
      balance: formatUnits(b.balance || '0', b.contractInfo?.decimals ?? 0)
    }))

    console.log(JSON.stringify({
      ok: true,
      walletName,
      walletAddress: session.walletAddress,
      chainId: network.chainId,
      chain: network.name,
      balances: [...native, ...erc20]
    }, null, 2))

  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      stack: error.stack
    }, null, 2))
    process.exit(1)
  }
}

// Default nodes URL — matches seq-eco.mjs exactly
function defaultNodesUrl(_projectAccessKey) {
  return 'https://nodes.sequence.app/{network}'
}

// Helper: Run dapp-client transaction (mirrors seq-eco.mjs runDappClientTx exactly)
async function runDappClientTx({ walletName, chainId, walletUrl, projectAccessKey, dappOrigin, transactions, broadcast, preferNativeFee }) {
  const session = await loadWalletSession(walletName)
  if (!session) {
    throw new Error(`Wallet not found: ${walletName}`)
  }

  const walletAddress = session.walletAddress

  // Parse explicit session from stored JSON string (matches seq-eco.mjs storage pattern)
  const explicitRaw = session.explicitSession
  if (!explicitRaw) {
    throw new Error('Missing explicit session. Re-run wallet start-session.')
  }

  const explicitSession = JSON.parse(explicitRaw, jsonRevivers)
  if (!explicitSession?.pk) {
    throw new Error('Stored explicit session is missing pk; re-link wallet')
  }

  // Keychain-backed storage modeled after seq-eco.mjs KeychainSequenceStorage
  class KeychainSequenceStorage {
    constructor() {
      this.pendingRedirect = false
      this.tempSessionPk = null
      this.pendingRequest = null
      this.explicitSessions = [{
        pk: explicitSession.pk,
        walletAddress: explicitSession.walletAddress || walletAddress,
        chainId,
        loginMethod: explicitSession.loginMethod,
        userEmail: explicitSession.userEmail,
        guard: explicitSession.guard
      }]
      this.implicitSession = null
    }
    async setPendingRedirectRequest(isPending) { this.pendingRedirect = !!isPending }
    async isRedirectRequestPending() { return !!this.pendingRedirect }
    async saveTempSessionPk(pk) { this.tempSessionPk = pk }
    async getAndClearTempSessionPk() { const v = this.tempSessionPk; this.tempSessionPk = null; return v }
    async savePendingRequest(context) { this.pendingRequest = context }
    async getAndClearPendingRequest() { const v = this.pendingRequest; this.pendingRequest = null; return v }
    async peekPendingRequest() { return this.pendingRequest }
    async saveExplicitSession(sessionData) {
      this.explicitSessions = [...this.explicitSessions.filter(s => !(s.walletAddress === sessionData.walletAddress && s.pk === sessionData.pk && s.chainId === sessionData.chainId)), sessionData]
    }
    async getExplicitSessions() { return [...this.explicitSessions] }
    async clearExplicitSessions() { this.explicitSessions = [] }
    async saveImplicitSession(sessionData) { this.implicitSession = sessionData }
    async getImplicitSession() { return this.implicitSession }
    async clearImplicitSession() { this.implicitSession = null }
    async saveSessionlessConnection(sessionData) { this.sessionlessConnection = sessionData }
    async getSessionlessConnection() { return this.sessionlessConnection ?? null }
    async clearSessionlessConnection() { this.sessionlessConnection = null }
    async saveSessionlessConnectionSnapshot(sessionData) { this.sessionlessConnectionSnapshot = sessionData }
    async getSessionlessConnectionSnapshot() { return this.sessionlessConnectionSnapshot ?? null }
    async clearSessionlessConnectionSnapshot() { this.sessionlessConnectionSnapshot = null }
    async clearAllData() {}
  }

  class MapSessionStorage {
    constructor() { this.kv = new Map() }
    async getItem(k) { return this.kv.has(k) ? this.kv.get(k) : null }
    async setItem(k, v) { this.kv.set(k, v) }
    async removeItem(k) { this.kv.delete(k) }
  }

  const sequenceStorage = new KeychainSequenceStorage()
  const sequenceSessionStorage = new MapSessionStorage()

  // Load implicit session if available (matches seq-eco.mjs lines 1005-1019)
  if (session.implicitPk && session.implicitAttestation && session.implicitIdentitySig) {
    const implicitAttestation = JSON.parse(session.implicitAttestation, jsonRevivers)
    const implicitIdentitySignature = JSON.parse(session.implicitIdentitySig, jsonRevivers)
    const meta = session.implicitMeta ? JSON.parse(session.implicitMeta, jsonRevivers) : {}
    await sequenceStorage.saveImplicitSession({
      pk: session.implicitPk,
      walletAddress: explicitSession.walletAddress || walletAddress,
      attestation: implicitAttestation,
      identitySignature: implicitIdentitySignature,
      chainId,
      loginMethod: meta.loginMethod,
      userEmail: meta.userEmail,
      guard: meta.guard
    })
  }

  // Node.js polyfill (matches seq-eco.mjs line 1021-1022)
  if (!globalThis.window) globalThis.window = { fetch: globalThis.fetch }
  else if (!globalThis.window.fetch) globalThis.window.fetch = globalThis.fetch

  const keymachineUrl = process.env.SEQUENCE_KEYMACHINE_URL || 'https://keymachine.sequence.app'
  const nodesUrl = process.env.SEQUENCE_NODES_URL || defaultNodesUrl(projectAccessKey)
  const relayerUrl = process.env.SEQUENCE_RELAYER_URL || 'https://{network}-relayer.sequence.app'

  // Create DappClient — matches seq-eco.mjs constructor signature exactly
  const client = new DappClient(walletUrl, dappOrigin, projectAccessKey, {
    transportMode: TransportMode.REDIRECT,
    keymachineUrl,
    nodesUrl,
    relayerUrl,
    sequenceStorage,
    sequenceSessionStorage,
    canUseIndexedDb: false
  })

  await client.initialize()
  if (!client.isInitialized) throw new Error('Client not initialized')

  if (!broadcast) {
    const bigintReplacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
    console.log(JSON.stringify({ ok: true, dryRun: true, walletName, walletAddress, transactions }, bigintReplacer, 2))
    return { walletAddress, dryRun: true }
  }

  // Fee options handling (matches seq-eco.mjs lines 1049-1104)
  let feeOpt
  try {
    const feeOptions = await client.getFeeOptions(chainId, transactions)
    feeOpt = preferNativeFee
      ? (feeOptions || []).find((o) => !o?.token?.contractAddress) || feeOptions?.[0]
      : feeOptions?.[0]
  } catch (e) {
    // Workaround: in some relayer scenarios (notably undeployed wallets), FeeOptions can fail.
    // Try direct relayer feeOptions, then forced fee option.
    const enabled = !['0', 'false', 'no'].includes(String(process.env.SEQ_ECO_FEEOPTIONS_WORKAROUND || 'true').toLowerCase())
    if (!enabled) throw e

    // 1) Try direct relayer feeOptions with wallet address
    try {
      const mgr = client.getChainSessionManager ? client.getChainSessionManager(chainId) : null
      const direct = await mgr?.relayer?.feeOptions?.(walletAddress, chainId, transactions)
      const opts = direct?.options
      if (Array.isArray(opts) && opts.length) {
        feeOpt = preferNativeFee
          ? opts.find((o) => !o?.token?.contractAddress) || opts[0]
          : opts[0]
      }
    } catch {
      // ignore, fall back
    }

    if (feeOpt) {
      // got an option without hitting the broken FeeOptions path
    } else {
      // 2) Forced fee option: pick a fee token and pay a small amount
      let feeTokens
      try {
        feeTokens = await client.getFeeTokens(chainId)
      } catch {
        throw e
      }

      const paymentAddress = feeTokens?.paymentAddress
      const tokens = Array.isArray(feeTokens?.tokens) ? feeTokens.tokens : []
      const token = tokens.find((t) => t?.contractAddress) || null
      if (!paymentAddress || !token) throw e

      const decimals = typeof token.decimals === 'number' ? token.decimals : 6
      const feeValue = decimals >= 3 ? 10 ** (decimals - 3) : 1

      feeOpt = {
        token,
        to: paymentAddress,
        value: String(feeValue),
        gasLimit: 0
      }
    }
  }

  const txHash = await client.sendTransaction(chainId, transactions, feeOpt)
  return { walletAddress, txHash, feeOptionUsed: feeOpt }
}

// Send native token command
export async function sendNative() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet')
  const to = getArg(args, '--to')
  const amount = getArg(args, '--amount')
  const broadcast = hasFlag(args, '--broadcast')

  if (!walletName || !to || !amount) {
    console.error(JSON.stringify({ ok: false, error: 'Missing required parameters: --wallet, --to, --amount' }, null, 2))
    process.exit(1)
  }

  try {
    const session = await loadWalletSession(walletName)
    if (!session) {
      throw new Error(`Wallet not found: ${walletName}`)
    }

    const projectAccessKey = process.env.SEQUENCE_PROJECT_ACCESS_KEY
    if (!projectAccessKey) {
      throw new Error('Missing SEQUENCE_PROJECT_ACCESS_KEY environment variable')
    }

    const walletUrl = process.env.SEQUENCE_ECOSYSTEM_WALLET_URL || DEFAULT_WALLET_URL
    const dappOrigin = process.env.SEQUENCE_DAPP_ORIGIN
    if (!dappOrigin) {
      throw new Error('Missing SEQUENCE_DAPP_ORIGIN environment variable')
    }

    const chainArg = getArg(args, '--chain')
    const network = resolveNetwork(chainArg || session.chain || 'polygon')

    // Parse amount
    const decimals = network.nativeCurrency?.decimals ?? 18
    const value = parseUnits(amount, decimals)

    // Route through ValueForwarder (session permissions are scoped to this contract)
    // forwardValue(address,uint256) selector = 0x98f850f1
    const VALUE_FORWARDER = '0xABAAd93EeE2a569cF0632f39B10A9f5D734777ca'
    const selector = '0x98f850f1'
    const pad = (hex, n = 64) => String(hex).replace(/^0x/, '').padStart(n, '0')
    const data = selector + pad(to) + pad('0x' + value.toString(16))

    const transactions = [{
      to: VALUE_FORWARDER,
      value,
      data
    }]

    const result = await runDappClientTx({
      walletName,
      chainId: network.chainId,
      walletUrl,
      projectAccessKey,
      dappOrigin,
      transactions,
      broadcast
    })

    if (!broadcast) return

    const explorerUrl = getExplorerUrl(network, result.txHash)
    console.log(JSON.stringify({
      ok: true,
      walletName,
      walletAddress: result.walletAddress,
      chain: network.name,
      chainId: network.chainId,
      to,
      amount,
      txHash: result.txHash,
      explorerUrl
    }, null, 2))

  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      stack: error.stack
    }, null, 2))
    process.exit(1)
  }
}

// Send token command (by symbol or address)
export async function sendToken() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet')
  const symbol = getArg(args, '--symbol')
  const tokenAddress = getArg(args, '--token')
  const decimalsArg = getArg(args, '--decimals')
  const to = getArg(args, '--to')
  const amount = getArg(args, '--amount')
  const broadcast = hasFlag(args, '--broadcast')

  if (!walletName || !to || !amount) {
    console.error(JSON.stringify({ ok: false, error: 'Missing required parameters: --wallet, --to, --amount' }, null, 2))
    process.exit(1)
  }

  try {
    const session = await loadWalletSession(walletName)
    if (!session) {
      throw new Error(`Wallet not found: ${walletName}`)
    }

    const projectAccessKey = process.env.SEQUENCE_PROJECT_ACCESS_KEY
    if (!projectAccessKey) {
      throw new Error('Missing SEQUENCE_PROJECT_ACCESS_KEY environment variable')
    }

    const walletUrl = process.env.SEQUENCE_ECOSYSTEM_WALLET_URL || DEFAULT_WALLET_URL
    const dappOrigin = process.env.SEQUENCE_DAPP_ORIGIN
    if (!dappOrigin) {
      throw new Error('Missing SEQUENCE_DAPP_ORIGIN environment variable')
    }

    const chainArg = getArg(args, '--chain')
    const network = resolveNetwork(chainArg || session.chain || 'polygon')

    // Resolve token
    let token = tokenAddress
    let decimals = decimalsArg ? Number(decimalsArg) : null

    if (symbol) {
      const resolved = await resolveErc20BySymbol({ chainId: network.chainId, symbol })
      if (!resolved) {
        throw new Error(`Unknown token symbol: ${symbol} on ${network.name}`)
      }
      token = resolved.address
      decimals = Number(resolved.decimals)
    }

    if (!token || decimals === null) {
      throw new Error('Provide either --symbol OR (--token + --decimals)')
    }

    // Build ERC20 transfer transaction
    const value = parseUnits(amount, decimals)
    const selector = '0xa9059cbb'
    const pad = (hex, n = 64) => String(hex).replace(/^0x/, '').padStart(n, '0')
    const data = selector + pad(to) + pad('0x' + value.toString(16))

    const transactions = [{
      to: token,
      value: 0n,
      data
    }]

    const result = await runDappClientTx({
      walletName,
      chainId: network.chainId,
      walletUrl,
      projectAccessKey,
      dappOrigin,
      transactions,
      broadcast
    })

    if (!broadcast) return

    const explorerUrl = getExplorerUrl(network, result.txHash)
    console.log(JSON.stringify({
      ok: true,
      walletName,
      walletAddress: result.walletAddress,
      chain: network.name,
      chainId: network.chainId,
      symbol: symbol || 'TOKEN',
      tokenAddress: token,
      decimals,
      to,
      amount,
      txHash: result.txHash,
      explorerUrl
    }, null, 2))

  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      stack: error.stack
    }, null, 2))
    process.exit(1)
  }
}

// Swap command (Trails API)
export async function swap() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet')
  const fromSymbol = getArg(args, '--from')
  const toSymbol = getArg(args, '--to')
  const amount = getArg(args, '--amount')
  const slippageArg = getArg(args, '--slippage')
  const broadcast = hasFlag(args, '--broadcast')

  if (!walletName || !fromSymbol || !toSymbol || !amount) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Missing required parameters: --wallet, --from, --to, --amount'
    }, null, 2))
    process.exit(1)
  }

  if (fromSymbol.toUpperCase() === toSymbol.toUpperCase()) {
    console.error(JSON.stringify({
      ok: false,
      error: 'from and to token must be different'
    }, null, 2))
    process.exit(1)
  }

  try {
    const session = await loadWalletSession(walletName)
    if (!session) {
      throw new Error(`Wallet not found: ${walletName}`)
    }

    const projectAccessKey = process.env.SEQUENCE_PROJECT_ACCESS_KEY
    if (!projectAccessKey) {
      throw new Error('Missing SEQUENCE_PROJECT_ACCESS_KEY environment variable')
    }

    const walletUrl = process.env.SEQUENCE_ECOSYSTEM_WALLET_URL || DEFAULT_WALLET_URL
    const dappOrigin = process.env.SEQUENCE_DAPP_ORIGIN
    if (!dappOrigin) {
      throw new Error('Missing SEQUENCE_DAPP_ORIGIN environment variable')
    }

    const chainArg = getArg(args, '--chain')
    const network = resolveNetwork(chainArg || session.chain || 'polygon')
    const chainId = network.chainId
    const nativeSymbol = network.nativeCurrency?.symbol || 'NATIVE'

    const slippage = slippageArg ? Number(slippageArg) : 0.005
    if (!Number.isFinite(slippage) || slippage <= 0 || slippage >= 0.5) {
      throw new Error('Invalid --slippage (must be between 0 and 0.5)')
    }

    // Resolve tokens
    const fromToken = await getTokenConfig({ chainId, symbol: fromSymbol, nativeSymbol })
    const toToken = await getTokenConfig({ chainId, symbol: toSymbol, nativeSymbol })

    if (fromToken.address.toLowerCase() === toToken.address.toLowerCase()) {
      throw new Error('from and to token must be different')
    }

    // Initialize Trails API
    const { TrailsApi, TradeType } = await import('@0xtrails/api')
    const trailsApiKey = process.env.TRAILS_API_KEY || projectAccessKey
    const trails = new TrailsApi(trailsApiKey, {
      hostname: process.env.TRAILS_API_HOSTNAME
    })

    // Get wallet address
    const walletAddress = session.walletAddress

    // Parse amount
    const { parseUnits } = await import('viem')
    const originTokenAmount = parseUnits(amount, fromToken.decimals).toString()

    // Get quote
    const quoteReq = {
      ownerAddress: walletAddress,
      originChainId: chainId,
      originTokenAddress: fromToken.address,
      originTokenAmount,
      destinationChainId: chainId,
      destinationTokenAddress: toToken.address,
      destinationTokenAmount: '0',
      tradeType: TradeType.EXACT_INPUT,
      options: {
        slippageTolerance: slippage
      }
    }

    const quoteRes = await trails.quoteIntent(quoteReq)
    if (!quoteRes?.intent) {
      throw new Error('No intent returned from quoteIntent')
    }

    const intent = quoteRes.intent

    // Commit intent
    const commitRes = await trails.commitIntent({ intent })
    const intentId = commitRes?.intentId || intent.intentId
    if (!intentId) {
      throw new Error('No intentId from commitIntent')
    }

    const depositTx = intent.depositTransaction
    if (!depositTx?.to) {
      throw new Error('Intent missing depositTransaction')
    }

    const transactions = [{
      to: depositTx.to,
      data: depositTx.data || '0x',
      value: depositTx.value ? BigInt(depositTx.value) : 0n
    }]

    const bigintReplacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v)

    if (!broadcast) {
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        walletName,
        walletAddress,
        intentId,
        fromToken: fromToken.symbol,
        toToken: toToken.symbol,
        amount,
        depositTransaction: depositTx,
        note: 'Re-run with --broadcast to submit the deposit transaction and execute the intent.'
      }, bigintReplacer, 2))
      return
    }

    // Execute swap via DappClient
    const result = await runDappClientTx({
      walletName,
      chainId,
      walletUrl,
      projectAccessKey,
      dappOrigin,
      transactions,
      broadcast: true
    })
    const txHash = result.txHash

    // Execute intent
    const execRes = await trails.executeIntent({
      intentId,
      depositTransactionHash: txHash
    })

    // Wait for receipt
    const receipt = await trails.waitIntentReceipt({ intentId })

    const explorerUrl = getExplorerUrl(network, txHash)
    console.log(JSON.stringify({
      ok: true,
      walletName,
      walletAddress,
      chain: network.name,
      chainId,
      fromToken: fromToken.symbol,
      toToken: toToken.symbol,
      amount,
      intentId,
      depositTxHash: txHash,
      depositExplorerUrl: explorerUrl,
      executeStatus: execRes?.intentStatus,
      receipt
    }, bigintReplacer, 2))

  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message,
      stack: error.stack
    }, null, 2))
    process.exit(1)
  }
}

// Helper: Get token configuration (native or ERC20)
async function getTokenConfig({ chainId, symbol, nativeSymbol }) {
  const sym = String(symbol || '').toUpperCase().trim()

  if (sym === 'NATIVE' || sym === nativeSymbol.toUpperCase() || sym === 'POL' || sym === 'MATIC') {
    return {
      symbol: nativeSymbol.toUpperCase(),
      address: '0x0000000000000000000000000000000000000000',
      decimals: 18
    }
  }

  // Token Directory lookup
  const { resolveErc20BySymbol } = await import('../../lib/token-directory.mjs')
  const token = await resolveErc20BySymbol({ chainId, symbol: sym })
  if (!token?.address || token.decimals == null) {
    throw new Error(`Unknown token ${sym} on chainId=${chainId}`)
  }

  return {
    symbol: sym,
    address: token.address,
    decimals: Number(token.decimals)
  }
}

// Legacy command aliases
export async function send() {
  // Detect if sending native or token
  const args = process.argv.slice(2)
  const symbol = getArg(args, '--symbol')
  const token = getArg(args, '--token')

  if (symbol || token) {
    return sendToken()
  } else {
    return sendNative()
  }
}
