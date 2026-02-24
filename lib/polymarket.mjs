// Polymarket integration library
// Covers: Gamma API (market discovery), CLOB API (trading + HMAC auth), on-chain ops (EOA-signed)
//
// Architecture: smart wallet funds EOA → EOA handles all on-chain + CLOB signing
// (same pattern as x402-pay — ecosystem wallet cannot sign Polymarket payloads directly)

import { createHmac } from 'node:crypto'

// ─── Constants ──────────────────────────────────────────────────────────────

export const GAMMA_URL = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com'
export const CLOB_URL  = process.env.POLYMARKET_CLOB_URL  || 'https://clob.polymarket.com'
export const DATA_URL  = process.env.POLYMARKET_DATA_URL  || 'https://data-api.polymarket.com'

// Polygon mainnet (chain 137)
export const USDC_E       = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' // USDC.e — 6 decimals
export const CTF          = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045' // Conditional Token Framework
export const CTF_EXCHANGE = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E' // CLOB exchange — approve target
export const NEG_RISK_CTF_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a'
export const NEG_RISK_ADAPTER      = '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296'

// ─── Gamma API ──────────────────────────────────────────────────────────────

// List active markets sorted by 24h volume
// --search does client-side substring filter on the question (Gamma has no server-side full-text search)
// Returns: array of { id, conditionId, question, yesTokenId, noTokenId, yesPrice, noPrice, volume24hr, negRisk }
export async function getMarkets({ search, limit = 20, offset = 0 } = {}) {
  // Fetch more results when search is set so we can filter client-side and still return `limit` matches
  const fetchLimit = search ? Math.max(100, limit * 5) : limit
  const params = new URLSearchParams({
    limit: String(fetchLimit),
    offset: String(offset),
    active: 'true',
    closed: 'false',
    order: 'volume24hr',
    ascending: 'false',
  })

  const res = await fetch(`${GAMMA_URL}/markets?${params}`)
  if (!res.ok) throw new Error(`Gamma API error: ${res.status} ${await res.text()}`)

  let markets = await res.json()

  // Client-side filter on question text
  if (search) {
    const q = search.toLowerCase()
    markets = markets.filter(m => (m.question || '').toLowerCase().includes(q))
    markets = markets.slice(0, limit)
  }

  return markets.map(parseMarket)
}

// Get a single market by conditionId
// Gamma API does not support conditionId query filtering — we scan pages until found
export async function getMarket(conditionId) {
  const needle = conditionId.toLowerCase()
  // Scan up to 500 markets (top by volume) to find the conditionId
  for (let offset = 0; offset < 500; offset += 100) {
    const params = new URLSearchParams({
      limit: '100', offset: String(offset),
      active: 'true', closed: 'false',
      order: 'volume24hr', ascending: 'false',
    })
    const res = await fetch(`${GAMMA_URL}/markets?${params}`)
    if (!res.ok) throw new Error(`Gamma API error: ${res.status} ${await res.text()}`)
    const markets = await res.json()
    if (!markets?.length) break
    const found = markets.find(m => m.conditionId?.toLowerCase() === needle)
    if (found) return parseMarket(found)
  }
  // Also try closed markets
  const resClosed = await fetch(`${GAMMA_URL}/markets?conditionId=${encodeURIComponent(conditionId)}&limit=100`)
  if (resClosed.ok) {
    const closed = await resClosed.json()
    const found = (closed || []).find(m => m.conditionId?.toLowerCase() === needle)
    if (found) return parseMarket(found)
  }
  throw new Error(`Market not found: ${conditionId}`)
}

function parseMarket(m) {
  // clobTokenIds, outcomePrices, outcomes are JSON strings — must parse
  let tokenIds = []
  let prices = []
  let outcomes = []
  try { tokenIds = JSON.parse(m.clobTokenIds || '[]') } catch (_) {}
  try { prices = JSON.parse(m.outcomePrices || '[]') } catch (_) {}
  try { outcomes = JSON.parse(m.outcomes || '["Yes","No"]') } catch (_) {}

  return {
    id: m.id,
    conditionId: m.conditionId,
    question: m.question,
    yesTokenId: tokenIds[0] || null,
    noTokenId: tokenIds[1] || null,
    yesPrice: prices[0] ? Number(prices[0]) : null,
    noPrice: prices[1] ? Number(prices[1]) : null,
    outcomes,
    volume24hr: m.volume24hr || 0,
    negRisk: !!m.negRisk,
    endDate: m.endDate || null,
  }
}

// ─── CLOB API — public endpoints (no auth) ──────────────────────────────────

// Get best price for a token side
// Returns: number (e.g. 0.65)
export async function getClobPrice(tokenId, side = 'BUY') {
  const res = await fetch(`${CLOB_URL}/price?token_id=${tokenId}&side=${side}`)
  if (!res.ok) throw new Error(`CLOB price error: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return Number(data.price)
}

// Get order book for a token
export async function getOrderBook(tokenId) {
  const res = await fetch(`${CLOB_URL}/book?token_id=${tokenId}`)
  if (!res.ok) throw new Error(`CLOB book error: ${res.status} ${await res.text()}`)
  return res.json()
}

// ─── CLOB API — authentication ───────────────────────────────────────────────

// Derive CLOB API credentials from EOA private key
// Replicates py-clob-client L1 auth: EIP-712 ClobAuth struct → headers-only POST /auth/api-key
// Reference: py_clob_client/headers/headers.py + py_clob_client/signing/eip712.py
export async function deriveClobCreds(privateKey, nonce = 0) {
  const { privateKeyToAccount } = await import('viem/accounts')
  const account = privateKeyToAccount(privateKey)

  const timestamp = String(Math.floor(Date.now() / 1000))

  // EIP-712 domain + types matching py-clob-client exactly:
  //   ClobAuth.address = Address() → "address" type
  //   ClobAuth.timestamp = String() → "string" type
  //   ClobAuth.nonce = Uint() → "uint256" type
  //   ClobAuth.message = String() → "string" type
  const domain = { name: 'ClobAuthDomain', version: '1', chainId: 137 }
  const types = {
    ClobAuth: [
      { name: 'address',   type: 'address' },
      { name: 'timestamp', type: 'string'  },
      { name: 'nonce',     type: 'uint256' },
      { name: 'message',   type: 'string'  },
    ],
  }
  const msgData = {
    address:   account.address,
    timestamp,
    nonce:     BigInt(nonce),
    message:   'This message attests that I control the given wallet',
  }

  const { createWalletClient, http } = await import('viem')
  const { polygon } = await import('viem/chains')
  const walletClient = createWalletClient({ account, chain: polygon, transport: http() })
  const signature = await walletClient.signTypedData({ domain, types, primaryType: 'ClobAuth', message: msgData })

  // Headers-only request — no body (py-clob-client sends no body)
  // Header names use underscores: POLY_ADDRESS, POLY_SIGNATURE, POLY_TIMESTAMP, POLY_NONCE
  const l1Headers = {
    'POLY_ADDRESS':   account.address,
    'POLY_SIGNATURE': signature,
    'POLY_TIMESTAMP': timestamp,
    'POLY_NONCE':     String(nonce),
  }

  // Try POST /auth/api-key (create). Falls back to GET /auth/derive-api-key if keys already exist
  // (400 "Could not create api key" means a key was previously created for this address+nonce)
  let res = await fetchWithRetry(`${CLOB_URL}/auth/api-key`, { method: 'POST', headers: l1Headers })
  if (!res.ok) {
    res = await fetchWithRetry(`${CLOB_URL}/auth/derive-api-key`, { method: 'GET', headers: l1Headers })
  }
  if (!res.ok) throw new Error(`CLOB auth error: ${res.status} ${await res.text()}`)
  const creds = await res.json()
  return { key: creds.apiKey || creds.key, secret: creds.secret, passphrase: creds.passphrase, address: account.address }
}

// Build Level 2 HMAC headers for authenticated CLOB API requests
// Matches clob-client (TS) exactly:
//   secret is base64url decoded before use (convert - → + and _ → / then standard base64 decode)
//   message = timestamp + METHOD + path [+ body]
//   output  = standard base64 digest (TS client does crypto.subtle → base64, NOT base64url)
export function makeClobAuthHeaders(creds, method, urlPath, body = '') {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const msg = timestamp + method.toUpperCase() + urlPath + (body || '')
  const keyBuf = Buffer.from(creds.secret, 'base64url')
  // TS clob-client: crypto.subtle digest → base64 → replace +→- and /→_ (keeps = padding)
  const sig = createHmac('sha256', keyBuf).update(msg).digest('base64').replace(/\+/g, '-').replace(/\//g, '_')
  return {
    'POLY_ADDRESS':    creds.address,
    'POLY_SIGNATURE':  sig,
    'POLY_TIMESTAMP':  timestamp,
    'POLY_API_KEY':    creds.key,
    'POLY_PASSPHRASE': creds.passphrase,
  }
}

// ─── CLOB API — authenticated endpoints ─────────────────────────────────────

// List open orders for the authenticated address
export async function getOpenOrders(creds) {
  const path = '/data/orders'
  const headers = { ...makeClobAuthHeaders(creds, 'GET', path), 'Content-Type': 'application/json' }
  const res = await fetch(`${CLOB_URL}${path}`, { headers })
  if (!res.ok) throw new Error(`CLOB orders error: ${res.status} ${await res.text()}`)
  return res.json()
}

// Cancel a specific order by ID
export async function cancelOrder(orderId, creds) {
  const path = `/order/${orderId}`
  const headers = { ...makeClobAuthHeaders(creds, 'DELETE', path), 'Content-Type': 'application/json' }
  const res = await fetchWithRetry(`${CLOB_URL}${path}`, { method: 'DELETE', headers })
  if (!res.ok) throw new Error(`CLOB cancel error: ${res.status} ${await res.text()}`)
  return res.json()
}

// ─── CLOB API — order creation + posting (EIP-712 signed) ───────────────────

// Create a signed EIP-712 order and POST to CLOB API
// side: 'BUY' | 'SELL'
// orderType: 'GTC' (limit, default) | 'FOK' (market/fill-or-kill)
// size: number of outcome tokens (e.g. 10 = 10 YES tokens)
// price: probability 0-1 (e.g. 0.65)
export async function createAndPostOrder({ tokenId, side, size, price, orderType = 'GTC', privateKey, creds }) {
  const { privateKeyToAccount } = await import('viem/accounts')
  const { signTypedData } = await import('viem/actions')
  const { createWalletClient, http } = await import('viem')
  const { polygon } = await import('viem/chains')

  const account = privateKeyToAccount(privateKey)
  const walletClient = createWalletClient({ account, chain: polygon, transport: http() })

  // Polymarket CTF Exchange EIP-712 domain
  const domain = {
    name: 'CTF Exchange',
    version: '1',
    chainId: 137,
    verifyingContract: CTF_EXCHANGE,
  }

  // Order struct types
  const types = {
    Order: [
      { name: 'salt',           type: 'uint256' },
      { name: 'maker',          type: 'address' },
      { name: 'signer',         type: 'address' },
      { name: 'taker',          type: 'address' },
      { name: 'tokenId',        type: 'uint256' },
      { name: 'makerAmount',    type: 'uint256' },
      { name: 'takerAmount',    type: 'uint256' },
      { name: 'expiration',     type: 'uint256' },
      { name: 'nonce',          type: 'uint256' },
      { name: 'feeRateBps',     type: 'uint256' },
      { name: 'side',           type: 'uint8'   },
      { name: 'signatureType',  type: 'uint8'   },
    ],
  }

  // side: 0 = BUY, 1 = SELL
  const sideNum = side === 'BUY' ? 0 : 1

  // Convert human amounts to contract units
  // makerAmount for SELL = outcome tokens (no decimals — CTF uses 1e6 but Polymarket uses whole units)
  // takerAmount for SELL = USDC.e received (price * size, 6 decimals)
  // makerAmount for BUY = USDC.e spent (price * size, 6 decimals)
  // takerAmount for BUY = outcome tokens received
  const sizeUnits     = BigInt(Math.round(size * 1e6))           // outcome token units
  const usdcUnits     = BigInt(Math.round(size * price * 1e6))   // USDC.e units

  const makerAmount = sideNum === 1 ? sizeUnits : usdcUnits  // SELL: give tokens; BUY: give USDC
  const takerAmount = sideNum === 1 ? usdcUnits : sizeUnits  // SELL: get USDC;   BUY: get tokens

  const salt = BigInt(Math.floor(Math.random() * 1e15))

  const orderStruct = {
    salt,
    maker:         account.address,
    signer:        account.address,
    taker:         '0x0000000000000000000000000000000000000000',
    tokenId:       BigInt(tokenId),
    makerAmount,
    takerAmount,
    expiration:    0n,
    nonce:         0n,
    feeRateBps:    0n,
    side:          sideNum,
    signatureType: 0, // EOA = 0
  }

  const signature = await walletClient.signTypedData({ domain, types, primaryType: 'Order', message: orderStruct })

  const orderPayload = {
    salt:          salt.toString(),
    maker:         account.address,
    signer:        account.address,
    taker:         '0x0000000000000000000000000000000000000000',
    tokenId:       tokenId,
    makerAmount:   makerAmount.toString(),
    takerAmount:   takerAmount.toString(),
    expiration:    '0',
    nonce:         '0',
    feeRateBps:    '0',
    side:          sideNum,
    signatureType: 0,
    signature,
  }

  const body = JSON.stringify({
    order: orderPayload,
    owner: account.address,
    orderType,
  })

  const path = '/order'
  const authHeaders = makeClobAuthHeaders(creds, 'POST', path, body)
  const headers = { ...authHeaders, 'Content-Type': 'application/json' }

  const res = await fetchWithRetry(`${CLOB_URL}${path}`, { method: 'POST', headers, body })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CLOB order error: ${res.status} ${text}`)
  }
  return res.json()
}

// ─── Data API — positions ────────────────────────────────────────────────────

// Get open positions for a wallet address
export async function getPositions(address, limit = 20) {
  const res = await fetch(`${DATA_URL}/positions?user=${address}&limit=${limit}`)
  if (!res.ok) throw new Error(`Data API error: ${res.status} ${await res.text()}`)
  return res.json()
}

// ─── On-chain ops (viem, EOA-signed) ────────────────────────────────────────

const ERC20_APPROVE_ABI = [{
  name: 'approve', type: 'function',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}]

const CTF_ABI = [
  {
    name: 'splitPosition', type: 'function',
    inputs: [
      { name: 'collateralToken',    type: 'address' },
      { name: 'parentCollectionId', type: 'bytes32' },
      { name: 'conditionId',        type: 'bytes32' },
      { name: 'partition',          type: 'uint256[]' },
      { name: 'amount',             type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'setApprovalForAll', type: 'function',
    inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }],
    outputs: [],
  },
]

// Neg Risk Adapter simplified splitPosition(bytes32 conditionId, uint256 amount)
const NEG_RISK_ADAPTER_ABI = [
  {
    name: 'splitPosition', type: 'function',
    inputs: [
      { name: 'conditionId', type: 'bytes32' },
      { name: 'amount',      type: 'uint256' },
    ],
    outputs: [],
  },
]

// Approve USDC.e for a spender (EOA-signed)
// Returns: txHash
export async function approveUsdce(walletClient, publicClient, spender, amount) {
  const { encodeFunctionData } = await import('viem')
  const data = encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [spender, amount] })
  const hash = await walletClient.sendTransaction({ to: USDC_E, data, value: 0n })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

// setApprovalForAll on CTF for an operator (EOA-signed)
// Returns: txHash
export async function approveCtfForAll(walletClient, publicClient, operator) {
  const { encodeFunctionData } = await import('viem')
  const data = encodeFunctionData({ abi: CTF_ABI, functionName: 'setApprovalForAll', args: [operator, true] })
  const hash = await walletClient.sendTransaction({ to: CTF, data, value: 0n })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

// splitPosition — yields YES + NO outcome tokens
// For neg risk markets: calls NegRiskAdapter.splitPosition(conditionId, amount)
// For regular markets: calls CTF.splitPosition(USDC.e, bytes32(0), conditionId, [1,2], amount)
// amount: USDC.e in micro-units (BigInt, 6 decimals)
// Returns: txHash
export async function splitPosition(walletClient, publicClient, { conditionId, amount, negRisk = false }) {
  const { encodeFunctionData } = await import('viem')
  let data, to
  if (negRisk) {
    data = encodeFunctionData({
      abi: NEG_RISK_ADAPTER_ABI,
      functionName: 'splitPosition',
      args: [conditionId, amount],
    })
    to = NEG_RISK_ADAPTER
  } else {
    const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000'
    data = encodeFunctionData({
      abi: CTF_ABI,
      functionName: 'splitPosition',
      args: [USDC_E, ZERO_BYTES32, conditionId, [1n, 2n], amount],
    })
    to = CTF
  }
  const hash = await walletClient.sendTransaction({ to, data, value: 0n })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

// ─── Helper: fetch with Cloudflare retry ─────────────────────────────────────

// Polymarket CLOB blocks some IPs via Cloudflare on POST requests.
// Retry up to 5 times. Supports HTTPS_PROXY env var.
export async function fetchWithRetry(url, init = {}, retries = 5) {
  let lastErr
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, init)
      // Cloudflare challenge pages return 403 or 503 with HTML — retry those
      if ((res.status === 403 || res.status === 503) && i < retries - 1) {
        const text = await res.text()
        if (text.includes('Cloudflare') || text.includes('cf-ray')) {
          await sleep(1000 * (i + 1))
          continue
        }
        // Not Cloudflare — return as-is
        return new Response(text, { status: res.status, headers: res.headers })
      }
      return res
    } catch (err) {
      lastErr = err
      if (i < retries - 1) await sleep(500 * (i + 1))
    }
  }
  throw lastErr || new Error('fetch failed after retries')
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}
