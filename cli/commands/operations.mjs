// Operations commands - balances, send, swap
// Uses shared dapp-client wrapper for transaction execution

import { loadWalletSession } from '../../lib/storage.mjs'
import { runDappClientTx } from '../../lib/dapp-client.mjs'
import { getArg, hasFlag, resolveNetwork, formatUnits, parseUnits, getIndexerUrl, getExplorerUrl, getRpcUrl } from '../../lib/utils.mjs'
import { resolveErc20BySymbol } from '../../lib/token-directory.mjs'

// Get per-chain indexer URL
function getChainIndexerUrl(chainId) {
  const chainNames = {
    137: 'polygon',
    80002: 'amoy',
    1: 'mainnet',
    42161: 'arbitrum',
    10: 'optimism',
    8453: 'base',
    43114: 'avalanche',
    56: 'bsc',
    100: 'gnosis'
  }
  const name = chainNames[chainId] || 'polygon'
  return `https://${name}-indexer.sequence.app`
}

// Balances command
export async function balances() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet') || 'main'

  try {
    // Load wallet session
    const session = await loadWalletSession(walletName)
    if (!session) {
      throw new Error(`Wallet not found: ${walletName}`)
    }

    // Get indexer key — prefer session-stored key, fall back to env
    const indexerKey = process.env.SEQUENCE_INDEXER_ACCESS_KEY || session.projectAccessKey || process.env.SEQUENCE_PROJECT_ACCESS_KEY
    if (!indexerKey) {
      throw new Error('Missing project access key (not in wallet session or environment)')
    }

    // Resolve chain
    const chainArg = getArg(args, '--chain')
    const network = resolveNetwork(chainArg || session.chain || 'polygon')
    const nativeDecimals = network.nativeCurrency?.decimals ?? 18
    const nativeSymbol = network.nativeCurrency?.symbol || 'POL'

    // Use per-chain Sequence Indexer
    const { SequenceIndexer } = await import('@0xsequence/indexer')
    const indexerUrl = getChainIndexerUrl(network.chainId)
    const indexer = new SequenceIndexer(indexerUrl, indexerKey)

    // Fetch native and token balances in parallel
    const [nativeRes, tokenRes] = await Promise.all([
      indexer.getNativeTokenBalance({ accountAddress: session.walletAddress }),
      indexer.getTokenBalances({ accountAddress: session.walletAddress, includeMetadata: true })
    ])

    // Parse native balance
    const nativeWei = nativeRes?.balance?.balance || '0'
    const native = [{
      type: 'native',
      symbol: nativeSymbol,
      balance: formatUnits(BigInt(nativeWei), nativeDecimals)
    }]

    // Parse ERC20 balances
    const erc20 = (tokenRes?.balances || []).map(b => ({
      type: 'erc20',
      symbol: b.contractInfo?.symbol || 'ERC20',
      name: b.contractInfo?.name || undefined,
      contractAddress: b.contractAddress,
      balance: formatUnits(b.balance || '0', b.contractInfo?.decimals ?? 18)
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

// Send native token command
export async function sendNative() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet') || 'main'
  const to = getArg(args, '--to')
  const amount = getArg(args, '--amount')
  const broadcast = hasFlag(args, '--broadcast')

  if (!to || !amount) {
    console.error(JSON.stringify({ ok: false, error: 'Missing required parameters: --to, --amount' }, null, 2))
    process.exit(1)
  }

  try {
    const session = await loadWalletSession(walletName)
    if (!session) {
      throw new Error(`Wallet not found: ${walletName}`)
    }

    const chainArg = getArg(args, '--chain')
    const network = resolveNetwork(chainArg || session.chain || 'polygon')

    // Parse amount
    const decimals = network.nativeCurrency?.decimals ?? 18
    const value = parseUnits(amount, decimals)

    // --direct: bypass ValueForwarder and send raw native transfer (matches seq-eco.mjs)
    const useDirectNative = hasFlag(args, '--direct') || ['1', 'true', 'yes'].includes(String(process.env.SEQ_ECO_NATIVE_DIRECT || '').toLowerCase())

    // Preferred: ValueForwarder call (session permissions are scoped to this contract)
    // forwardValue(address,uint256) selector = 0x98f850f1
    const VALUE_FORWARDER = '0xABAAd93EeE2a569cF0632f39B10A9f5D734777ca'
    const selector = '0x98f850f1'
    const pad = (hex, n = 64) => String(hex).replace(/^0x/, '').padStart(n, '0')
    const data = selector + pad(to) + pad('0x' + value.toString(16))

    const transactions = useDirectNative
      ? [{ to, value, data: '0x' }]
      : [{ to: VALUE_FORWARDER, value, data }]

    const result = await runDappClientTx({
      walletName,
      chainId: network.chainId,
      transactions,
      broadcast,
      preferNativeFee: true
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
  const walletName = getArg(args, '--wallet') || 'main'
  const symbol = getArg(args, '--symbol')
  const tokenAddress = getArg(args, '--token')
  const decimalsArg = getArg(args, '--decimals')
  const to = getArg(args, '--to')
  const amount = getArg(args, '--amount')
  const broadcast = hasFlag(args, '--broadcast')

  if (!to || !amount) {
    console.error(JSON.stringify({ ok: false, error: 'Missing required parameters: --to, --amount' }, null, 2))
    process.exit(1)
  }

  try {
    const session = await loadWalletSession(walletName)
    if (!session) {
      throw new Error(`Wallet not found: ${walletName}`)
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
      transactions,
      broadcast,
      preferNativeFee: true
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
// Supports same-chain and cross-chain swaps via --to-chain <chain>
export async function swap() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet') || 'main'
  const fromSymbol = getArg(args, '--from')
  const toSymbol = getArg(args, '--to')
  const amount = getArg(args, '--amount')
  const slippageArg = getArg(args, '--slippage')
  const toChainArg = getArg(args, '--to-chain')
  const broadcast = hasFlag(args, '--broadcast')

  if (!fromSymbol || !toSymbol || !amount) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Missing required parameters: --from, --to, --amount'
    }, null, 2))
    process.exit(1)
  }

  try {
    const session = await loadWalletSession(walletName)
    if (!session) {
      throw new Error(`Wallet not found: ${walletName}`)
    }

    // Origin chain: from wallet session (deposit tx signed here)
    const chainArg = getArg(args, '--chain')
    const originNetwork = resolveNetwork(chainArg || session.chain || 'polygon')
    const originChainId = originNetwork.chainId
    const originNativeSymbol = originNetwork.nativeCurrency?.symbol || 'NATIVE'

    // Destination chain: --to-chain if specified (cross-chain), else same as origin
    const destNetwork = toChainArg ? resolveNetwork(toChainArg) : originNetwork
    const destChainId = destNetwork.chainId
    const destNativeSymbol = destNetwork.nativeCurrency?.symbol || 'NATIVE'
    const isCrossChain = destChainId !== originChainId

    const slippage = slippageArg ? Number(slippageArg) : 0.005
    if (!Number.isFinite(slippage) || slippage <= 0 || slippage >= 0.5) {
      throw new Error('Invalid --slippage (must be between 0 and 0.5)')
    }

    // Resolve tokens: from uses origin chain, to uses destination chain
    const fromToken = await getTokenConfig({ chainId: originChainId, symbol: fromSymbol, nativeSymbol: originNativeSymbol })
    const toToken = await getTokenConfig({ chainId: destChainId, symbol: toSymbol, nativeSymbol: destNativeSymbol })

    if (!isCrossChain && fromToken.address.toLowerCase() === toToken.address.toLowerCase()) {
      throw new Error('from and to token must be different')
    }

    // Initialize Trails API
    const { TrailsApi, TradeType } = await import('@0xtrails/api')
    const trailsApiKey = process.env.TRAILS_API_KEY || session.projectAccessKey || process.env.SEQUENCE_PROJECT_ACCESS_KEY
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
      originChainId,
      originTokenAddress: fromToken.address,
      originTokenAmount,
      destinationChainId: destChainId,
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
        fromChain: originNetwork.name,
        toToken: toToken.symbol,
        toChain: destNetwork.name,
        crossChain: isCrossChain,
        amount,
        depositTransaction: depositTx,
        note: 'Re-run with --broadcast to submit the deposit transaction and execute the intent.'
      }, bigintReplacer, 2))
      return
    }

    // Execute swap via DappClient (deposit tx is always on origin chain)
    const result = await runDappClientTx({
      walletName,
      chainId: originChainId,
      transactions,
      broadcast: true,
      preferNativeFee: false  // wallet funded with USDC — prefer ERC20 fee
    })
    const txHash = result.txHash

    // Execute intent
    const execRes = await trails.executeIntent({
      intentId,
      depositTransactionHash: txHash
    })

    // Wait for receipt
    const receipt = await trails.waitIntentReceipt({ intentId })

    const explorerUrl = getExplorerUrl(originNetwork, txHash)
    console.log(JSON.stringify({
      ok: true,
      walletName,
      walletAddress,
      fromToken: fromToken.symbol,
      fromChain: originNetwork.name,
      fromChainId: originChainId,
      toToken: toToken.symbol,
      toChain: destNetwork.name,
      toChainId: destChainId,
      crossChain: isCrossChain,
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

// Load optional token map override from env (matches trails.mjs)
// Format: TRAILS_TOKEN_MAP_JSON='{"137":{"USDC":{"address":"0x...","decimals":6}}}'
function loadTokenMap() {
  const raw = process.env.TRAILS_TOKEN_MAP_JSON || ''
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('Invalid TRAILS_TOKEN_MAP_JSON (must be valid JSON)')
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

  // 1) Explicit env override (matches trails.mjs)
  const tokenMap = loadTokenMap()
  const entry = tokenMap?.[String(chainId)]?.[sym]
  if (entry?.address && entry.decimals != null) {
    return { symbol: sym, address: entry.address, decimals: Number(entry.decimals) }
  }

  // 2) Token Directory lookup
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

// Fund command - opens Trails funding widget with wallet address pre-filled
export async function fund() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet') || 'main'

  try {
    const session = await loadWalletSession(walletName)
    if (!session) {
      throw new Error(`Wallet not found: ${walletName}. Run 'wallet create' first.`)
    }

    const walletAddress = session.walletAddress
    const chainId = session.chainId || 137

    // Default fund token: USDC on Polygon
    const toToken = getArg(args, '--token') || '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359'
    const apiKey = process.env.SEQUENCE_PROJECT_ACCESS_KEY || ''

    const fundingUrl = `https://demo.trails.build/?mode=swap&toAddress=${walletAddress}&toChainId=${chainId}&toToken=${toToken}&apiKey=${apiKey}&theme=light`

    console.log(JSON.stringify({
      ok: true,
      walletName,
      walletAddress,
      chainId,
      fundingUrl,
      message: 'Open the funding URL in your browser to fund your wallet via Trails.'
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
