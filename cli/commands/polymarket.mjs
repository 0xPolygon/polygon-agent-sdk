// Polymarket CLI commands
// All commands follow the existing pattern: getArg, JSON output, --broadcast for write ops
//
// EOA-only signing constraint: ecosystem (smart) wallet cannot sign Polymarket payloads.
// Pattern: smart wallet funds builder EOA → EOA handles on-chain + CLOB ops.

import { loadWalletSession, loadBuilderConfig } from '../../lib/storage.mjs'
import { runDappClientTx } from '../../lib/dapp-client.mjs'
import { getArg, hasFlag } from '../../lib/utils.mjs'
import {
  getMarkets, getMarket,
  getClobPrice,
  deriveClobCreds, getOpenOrders, cancelOrder,
  createAndPostOrder,
  approveUsdce, approveCtfForAll, splitPosition,
  getPositions,
  USDC_E, CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, NEG_RISK_ADAPTER,
} from '../../lib/polymarket.mjs'

// ─── polygon-agent polymarket markets ────────────────────────────────────────
// List active markets sorted by 24h volume
// Options: --search <query>, --limit <n>, --offset <n>

export async function polymarketMarkets() {
  const args = process.argv.slice(2)
  const search = getArg(args, '--search')
  const limit  = Number(getArg(args, '--limit')  || 20)
  const offset = Number(getArg(args, '--offset') || 0)

  try {
    const markets = await getMarkets({ search, limit, offset })
    console.log(JSON.stringify({ ok: true, count: markets.length, markets }, null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2))
    process.exit(1)
  }
}

// ─── polygon-agent polymarket market <conditionId> ───────────────────────────
// Get a single market by conditionId

export async function polymarketMarket() {
  const conditionId = process.argv[4]
  if (!conditionId) {
    console.error(JSON.stringify({ ok: false, error: 'Usage: polymarket market <conditionId>' }, null, 2))
    process.exit(1)
  }

  try {
    const market = await getMarket(conditionId)
    console.log(JSON.stringify({ ok: true, market }, null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2))
    process.exit(1)
  }
}

// ─── polygon-agent polymarket buy <conditionId> YES|NO <amount> ──────────────
// Buy an outcome by splitting USDC.e into YES+NO tokens, then selling the unwanted side.
//
// Flow (broadcast):
//   1. Smart wallet → fund EOA with USDC.e (exact split amount)
//   2. EOA: approve USDC.e → CTF Exchange
//   3. EOA: CTF setApprovalForAll → CTF Exchange (+ Neg Risk if negRisk market)
//   4. EOA: CTF splitPosition → mints YES + NO tokens
//   5. EOA: derive CLOB creds from private key
//   6. EOA: post SELL order for unwanted side (FOK market or GTC limit)
//
// Options:
//   --wallet <name>     default: main
//   --price <0-1>       limit price for selling unwanted side (default: market order FOK)
//   --broadcast         execute (dry-run without)

export async function polymarketBuy() {
  const args = process.argv.slice(2)
  const conditionId = process.argv[4]
  const outcomeArg  = (process.argv[5] || '').toUpperCase()
  const amountArg   = process.argv[6]
  const walletName  = getArg(args, '--wallet') || 'main'
  const priceArg    = getArg(args, '--price')
  const broadcast   = hasFlag(args, '--broadcast')

  if (!conditionId || !outcomeArg || !amountArg) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Usage: polymarket buy <conditionId> YES|NO <amount> [--price <0-1>] [--wallet <n>] [--broadcast]'
    }, null, 2))
    process.exit(1)
  }

  if (!['YES', 'NO'].includes(outcomeArg)) {
    console.error(JSON.stringify({ ok: false, error: 'Outcome must be YES or NO' }, null, 2))
    process.exit(1)
  }

  const amountUsd = Number(amountArg)
  if (!amountUsd || amountUsd <= 0) {
    console.error(JSON.stringify({ ok: false, error: 'Amount must be a positive number' }, null, 2))
    process.exit(1)
  }

  try {
    // Load market info
    const market = await getMarket(conditionId)
    const wantedTokenId   = outcomeArg === 'YES' ? market.yesTokenId : market.noTokenId
    const unwantedTokenId = outcomeArg === 'YES' ? market.noTokenId  : market.yesTokenId

    if (!wantedTokenId || !unwantedTokenId) {
      throw new Error(`Market ${conditionId} has no tokenIds (may be closed or invalid)`)
    }

    // Get current price of wanted outcome
    const wantedPrice = outcomeArg === 'YES' ? market.yesPrice : market.noPrice

    // Determine sell price for unwanted side
    let sellPrice
    let orderType
    if (priceArg) {
      sellPrice = Number(priceArg)
      orderType = 'GTC'
    } else {
      // Market order: sell at 90% of current bid for unwanted side
      const unwantedBid = await getClobPrice(unwantedTokenId, 'BUY')
      sellPrice = Math.max(0.01, unwantedBid * 0.9)
      orderType = 'FOK'
    }

    // Amount in micro-USDC (6 decimals)
    const amountUnits = BigInt(Math.round(amountUsd * 1e6))

    // Dry-run: show plan without executing
    if (!broadcast) {
      console.log(JSON.stringify({
        ok: true,
        dryRun: true,
        conditionId,
        question: market.question,
        outcome: outcomeArg,
        wantedTokenId,
        unwantedTokenId,
        wantedCurrentPrice: wantedPrice,
        amountUsd,
        splitAmountUnits: amountUnits.toString(),
        sellUnwantedAt: sellPrice,
        orderType,
        negRisk: market.negRisk,
        note: 'Re-run with --broadcast to execute. Smart wallet will fund EOA, EOA will split + sell unwanted side.',
      }, null, 2))
      return
    }

    // Load credentials
    const [session, builderConfig] = await Promise.all([
      loadWalletSession(walletName),
      loadBuilderConfig(),
    ])
    if (!session) throw new Error(`Wallet not found: ${walletName}`)
    if (!builderConfig?.privateKey) throw new Error('Builder EOA not found. Run: polygon-agent setup')

    const privateKey = builderConfig.privateKey
    const { privateKeyToAccount } = await import('viem/accounts')
    const { createWalletClient, createPublicClient, http } = await import('viem')
    const { polygon } = await import('viem/chains')

    const account     = privateKeyToAccount(privateKey)
    const walletClient = createWalletClient({ account, chain: polygon, transport: http() })
    const publicClient = createPublicClient({ chain: polygon, transport: http() })

    // Step 1: Fund EOA from smart wallet (transfer USDC.e)
    process.stderr.write(`[polymarket] Funding EOA ${account.address} with ${amountUsd} USDC.e...\n`)
    const pad = (hex, n = 64) => String(hex).replace(/^0x/, '').padStart(n, '0')
    const transferData = '0xa9059cbb' + pad(account.address) + pad('0x' + amountUnits.toString(16))
    const fundResult = await runDappClientTx({
      walletName,
      chainId: 137,
      transactions: [{ to: USDC_E, value: 0n, data: transferData }],
      broadcast: true,
      preferNativeFee: false,
    })
    process.stderr.write(`[polymarket] Funded: ${fundResult.txHash}\n`)

    // Step 2: Approve USDC.e → CTF Exchange (max approval)
    process.stderr.write(`[polymarket] Approving USDC.e → CTF Exchange...\n`)
    const MAX_UINT256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
    const approveTxHash = await approveUsdce(walletClient, publicClient, CTF_EXCHANGE, MAX_UINT256)
    process.stderr.write(`[polymarket] Approved: ${approveTxHash}\n`)

    // Step 3: setApprovalForAll CTF → CTF Exchange
    process.stderr.write(`[polymarket] Setting CTF approval for CTF Exchange...\n`)
    const ctfApproveHash = await approveCtfForAll(walletClient, publicClient, CTF_EXCHANGE)
    process.stderr.write(`[polymarket] CTF approved: ${ctfApproveHash}\n`)

    // Step 3b: Additional approvals for neg risk markets
    let negRiskApproveHash = null
    if (market.negRisk) {
      process.stderr.write(`[polymarket] Neg risk market — approving Neg Risk Exchange + Adapter...\n`)
      await approveCtfForAll(walletClient, publicClient, NEG_RISK_CTF_EXCHANGE)
      negRiskApproveHash = await approveCtfForAll(walletClient, publicClient, NEG_RISK_ADAPTER)
      process.stderr.write(`[polymarket] Neg risk approved: ${negRiskApproveHash}\n`)
    }

    // Step 4: splitPosition → mints YES + NO tokens
    process.stderr.write(`[polymarket] Splitting position (conditionId: ${conditionId}, amount: ${amountUnits})...\n`)
    const splitTxHash = await splitPosition(walletClient, publicClient, { conditionId, amount: amountUnits })
    process.stderr.write(`[polymarket] Split: ${splitTxHash}\n`)

    // Step 5: Derive CLOB creds from EOA private key
    process.stderr.write(`[polymarket] Deriving CLOB credentials...\n`)
    let creds
    try {
      creds = await deriveClobCreds(privateKey)
    } catch (credErr) {
      throw new Error(`CLOB credential derivation failed: ${credErr.message}. Split succeeded — tokens held at ${account.address}. Sell manually at polymarket.com`)
    }

    // Step 6: Post SELL order for unwanted side
    process.stderr.write(`[polymarket] Posting ${orderType} SELL order for unwanted ${outcomeArg === 'YES' ? 'NO' : 'YES'} tokens at ${sellPrice}...\n`)
    let orderResult
    try {
      orderResult = await createAndPostOrder({
        tokenId: unwantedTokenId,
        side: 'SELL',
        size: amountUsd,        // outcome tokens ≈ USDC.e amount at $0 cost
        price: sellPrice,
        orderType,
        privateKey,
        creds,
      })
    } catch (orderErr) {
      // Don't fail the whole command — split succeeded, tokens are held
      console.log(JSON.stringify({
        ok: true,
        conditionId,
        question: market.question,
        outcome: outcomeArg,
        amountUsd,
        fundTxHash: fundResult.txHash,
        approveTxHash,
        splitTxHash,
        orderId: null,
        orderError: orderErr.message,
        note: `Split succeeded — ${outcomeArg} tokens held at ${account.address}. SELL order failed (Cloudflare?). Sell manually at polymarket.com`,
      }, null, 2))
      return
    }

    console.log(JSON.stringify({
      ok: true,
      conditionId,
      question: market.question,
      outcome: outcomeArg,
      amountUsd,
      effectivePrice: wantedPrice,
      fundTxHash: fundResult.txHash,
      approveTxHash,
      splitTxHash,
      orderId: orderResult?.orderId || orderResult?.orderID || orderResult?.id || null,
      orderType,
      sellPrice,
      signerAddress: account.address,
      note: `${outcomeArg} position opened. Unwanted side sell order posted.`,
    }, null, 2))

  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message, stack: err.stack }, null, 2))
    process.exit(1)
  }
}

// ─── polygon-agent polymarket positions ──────────────────────────────────────
// List open positions for the smart wallet address
// Options: --wallet <name>

export async function polymarketPositions() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet') || 'main'

  try {
    const session = await loadWalletSession(walletName)
    if (!session) throw new Error(`Wallet not found: ${walletName}`)

    const positions = await getPositions(session.walletAddress)
    console.log(JSON.stringify({
      ok: true,
      walletAddress: session.walletAddress,
      count: Array.isArray(positions) ? positions.length : 0,
      positions,
    }, null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2))
    process.exit(1)
  }
}

// ─── polygon-agent polymarket orders ─────────────────────────────────────────
// List open CLOB orders for the builder EOA
// Options: --wallet <name> (unused but accepted for consistency)

export async function polymarketOrders() {
  try {
    const builderConfig = await loadBuilderConfig()
    if (!builderConfig?.privateKey) throw new Error('Builder EOA not found. Run: polygon-agent setup')

    const creds = await deriveClobCreds(builderConfig.privateKey)
    const orders = await getOpenOrders(creds)

    console.log(JSON.stringify({
      ok: true,
      signerAddress: creds.address,
      count: Array.isArray(orders) ? orders.length : 0,
      orders,
    }, null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2))
    process.exit(1)
  }
}

// ─── polygon-agent polymarket cancel <orderId> ───────────────────────────────
// Cancel an open CLOB order by ID

export async function polymarketCancel() {
  const orderId = process.argv[4]
  if (!orderId) {
    console.error(JSON.stringify({ ok: false, error: 'Usage: polymarket cancel <orderId>' }, null, 2))
    process.exit(1)
  }

  try {
    const builderConfig = await loadBuilderConfig()
    if (!builderConfig?.privateKey) throw new Error('Builder EOA not found. Run: polygon-agent setup')

    const creds = await deriveClobCreds(builderConfig.privateKey)
    const result = await cancelOrder(orderId, creds)

    console.log(JSON.stringify({
      ok: true,
      orderId,
      signerAddress: creds.address,
      result,
    }, null, 2))
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2))
    process.exit(1)
  }
}
