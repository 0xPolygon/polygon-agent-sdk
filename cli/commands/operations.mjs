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

// Helper: Run dapp-client transaction
async function runDappClientTx({ walletName, chainId, walletUrl, projectAccessKey, dappOrigin, transactions, broadcast }) {
  const session = await loadWalletSession(walletName)
  if (!session) {
    throw new Error(`Wallet not found: ${walletName}`)
  }

  const walletAddress = session.walletAddress

  // Parse session data
  const explicitSession = session.session ? JSON.parse(JSON.stringify(session.session), jsonRevivers) : null
  if (!explicitSession?.pk) {
    throw new Error('Invalid session: missing pk. Re-run wallet start-session.')
  }

  // Check session deadline
  const deadline = explicitSession?.config?.deadline
  if (deadline) {
    const deadlineSec = typeof deadline === 'bigint' ? Number(deadline) : Number(deadline)
    const nowSec = Math.floor(Date.now() / 1000)
    if (Number.isFinite(deadlineSec) && deadlineSec <= nowSec) {
      throw new Error(`Session expired (deadline ${deadlineSec}). Re-run wallet start-session.`)
    }
  }

  // Create in-memory storage
  class MemorySequenceStorage {
    constructor() {
      this.explicitSessions = [{
        pk: explicitSession.pk,
        walletAddress,
        chainId,
        loginMethod: explicitSession.loginMethod,
        userEmail: explicitSession.userEmail,
        guard: explicitSession.guard
      }]
    }

    async setPendingRedirectRequest() {}
    async isRedirectRequestPending() { return false }
    async saveTempSessionPk() {}
    async getAndClearTempSessionPk() { return null }
    async savePendingRequest() {}
    async getAndClearPendingRequest() { return null }
    async peekPendingRequest() { return null }
    async saveExplicitSession(s) { this.explicitSessions = [s] }
    async getExplicitSessions() { return this.explicitSessions }
    async clearExplicitSessions() { this.explicitSessions = [] }
    async saveImplicitSession() {}
    async getImplicitSession() { return null }
    async clearImplicitSession() {}
    async saveSessionlessConnection() {}
    async getSessionlessConnection() { return null }
    async clearSessionlessConnection() {}
    async saveSessionlessConnectionSnapshot() {}
    async getSessionlessConnectionSnapshot() { return null }
    async clearSessionlessConnectionSnapshot() {}
    async clearAllData() {}
  }

  class MapSessionStorage {
    constructor() { this.kv = new Map() }
    async getItem(k) { return this.kv.has(k) ? this.kv.get(k) : null }
    async setItem(k, v) { this.kv.set(k, v) }
    async removeItem(k) { this.kv.delete(k) }
    async clear() { this.kv.clear() }
  }

  const sequenceStorage = new MemorySequenceStorage()
  const sessionStorage = new MapSessionStorage()

  const client = new DappClient({
    storage: {
      sequenceStorage,
      sessionStorage
    },
    walletUrl,
    projectAccessKey,
    dappOrigin,
    transportMode: TransportMode.IFrame,
    onConnect: () => {}
  })

  // Send transaction
  const result = await client.sendTransaction({
    chainId,
    transactions,
    broadcast
  })

  if (!broadcast) {
    console.log(JSON.stringify({ ok: true, dryRun: true, message: 'Dry run complete (use --broadcast to execute)' }, null, 2))
    return { walletAddress, dryRun: true }
  }

  const txHash = result?.txHash || result?.hash
  if (!txHash) {
    throw new Error('Transaction sent but no txHash returned')
  }

  return { walletAddress, txHash, dryRun: false }
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

    const transactions = [{
      to,
      value,
      data: '0x'
    }]

    const { walletAddress, txHash, dryRun } = await runDappClientTx({
      walletName,
      chainId: network.chainId,
      walletUrl,
      projectAccessKey,
      dappOrigin,
      transactions,
      broadcast
    })

    if (dryRun) return

    const explorerUrl = getExplorerUrl(network, txHash)
    console.log(JSON.stringify({
      ok: true,
      walletName,
      walletAddress,
      chain: network.name,
      chainId: network.chainId,
      to,
      amount,
      txHash,
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

    const { walletAddress, txHash, dryRun } = await runDappClientTx({
      walletName,
      chainId: network.chainId,
      walletUrl,
      projectAccessKey,
      dappOrigin,
      transactions,
      broadcast
    })

    if (dryRun) return

    const explorerUrl = getExplorerUrl(network, txHash)
    console.log(JSON.stringify({
      ok: true,
      walletName,
      walletAddress,
      chain: network.name,
      chainId: network.chainId,
      symbol: symbol || 'TOKEN',
      tokenAddress: token,
      decimals,
      to,
      amount,
      txHash,
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
  console.error(JSON.stringify({
    ok: false,
    error: 'Swap command implementation in progress',
    message: 'Trails API integration requires @0xtrails/api package - coming in next update'
  }, null, 2))
  process.exit(1)
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
