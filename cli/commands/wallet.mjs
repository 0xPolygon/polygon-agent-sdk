// Wallet commands - Session-based ecosystem wallet
// Renamed from create-request → wallet create
// Renamed from ingest-session → wallet start-session

import fs from 'node:fs'
import http from 'node:http'
import nacl from 'tweetnacl'
import sealedbox from 'tweetnacl-sealedbox-js'
import { saveWalletSession, loadWalletSession, saveWalletRequest, loadWalletRequest, listWallets } from '../../lib/storage.mjs'
import { getArg, getArgs, hasFlag, normalizeChain, resolveNetwork } from '../../lib/utils.mjs'

// Base64 URL encode — matches seq-eco.mjs exactly
function b64urlEncode(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

// Base64 URL decode — matches seq-eco.mjs exactly
function b64urlDecode(str) {
  const norm = str.replace(/-/g, '+').replace(/_/g, '/')
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4))
  return Buffer.from(norm + pad, 'base64')
}

// Generate random ID — matches seq-eco.mjs exactly (base64url, NOT hex)
function randomId(bytes = 16) {
  return b64urlEncode(nacl.randomBytes(bytes))
}

// ERC-8004 contracts — always whitelisted in sessions
const ERC8004_CONTRACTS = [
  '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432', // IdentityRegistry
  '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63', // ReputationRegistry
]

// Parse session permission args and append them to a URL
function applySessionPermissionParams(url, args) {
  // One-off ERC20 transfer (fixed recipient + amount) — must provide both or neither
  const usdcTo = getArg(args, '--usdc-to')
  const usdcAmount = getArg(args, '--usdc-amount')
  if (usdcTo || usdcAmount) {
    if (!usdcTo || !usdcAmount) throw new Error('Must provide both --usdc-to and --usdc-amount')
    url.searchParams.set('erc20', 'usdc')
    url.searchParams.set('erc20To', usdcTo)
    url.searchParams.set('erc20Amount', usdcAmount)
  }

  // Open-ended spending limits
  // Default usdcLimit ensures fee-payment permissions are always included (both native USDC
  // and Bridged USDC.e), so wallets funded only with ERC20 tokens work out-of-the-box.
  const nativeLimit = getArg(args, '--native-limit') || getArg(args, '--pol-limit')
  const usdcLimit = getArg(args, '--usdc-limit') || '50'
  const usdtLimit = getArg(args, '--usdt-limit')
  if (nativeLimit) url.searchParams.set('nativeLimit', nativeLimit)
  url.searchParams.set('usdcLimit', usdcLimit)
  if (usdtLimit) url.searchParams.set('usdtLimit', usdtLimit)

  // Generic token limits (repeatable: --token-limit USDC:50 --token-limit WETH:0.1)
  const tokenLimits = getArgs(args, '--token-limit')
    .map((s) => String(s || '').trim())
    .filter(Boolean)
  if (tokenLimits.length) url.searchParams.set('tokenLimits', tokenLimits.join(','))

  // Contract whitelist — always include ERC-8004 contracts, plus any user-specified ones
  const userContracts = getArgs(args, '--contract')
    .map((s) => String(s || '').trim())
    .filter(Boolean)
  const allContracts = [...new Set([...ERC8004_CONTRACTS, ...userContracts])]
  url.searchParams.set('contracts', allContracts.join(','))
}

// Wallet create command (formerly create-request)
export async function walletCreate() {
  const args = process.argv.slice(3)
  const name = getArg(args, '--name') || 'main'
  const chainArg = getArg(args, '--chain') || 'polygon'

  try {
    // Normalize chain name (don't resolve to Network object yet - that happens in wallet start-session)
    const chain = normalizeChain(chainArg)
    const connectorUrl = process.env.SEQUENCE_ECOSYSTEM_CONNECTOR_URL || 'http://localhost:4444'

    // Generate NaCl keypair for encryption
    const rid = randomId(16)
    const kp = nacl.box.keyPair()
    const pub = b64urlEncode(kp.publicKey)
    const priv = b64urlEncode(kp.secretKey)

    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours

    // Add project access key if available
    const projectAccessKey = getArg(args, '--access-key') || process.env.SEQUENCE_PROJECT_ACCESS_KEY

    // Save request state (store chain as string, not Network object)
    await saveWalletRequest(rid, {
      rid,
      walletName: name,
      chain,  // Just the normalized string like "polygon"
      createdAt,
      expiresAt,
      publicKeyB64u: pub,
      privateKeyB64u: priv,
      projectAccessKey: projectAccessKey || null
    })

    // Build connector URL
    const url = new URL(connectorUrl)
    url.pathname = url.pathname.replace(/\/$/, '') + '/link'
    url.searchParams.set('rid', rid)
    url.searchParams.set('wallet', name)
    url.searchParams.set('pub', pub)
    url.searchParams.set('chain', chain)  // String chain name

    if (projectAccessKey) {
      url.searchParams.set('accessKey', projectAccessKey)
    }

    // Add session permission params (spending limits, token limits, contracts)
    applySessionPermissionParams(url, args)

    console.log(JSON.stringify({
      ok: true,
      walletName: name,
      chain,  // String chain name
      rid,
      url: url.toString(),
      expiresAt,
      message: 'Open URL in browser to approve wallet creation, then use wallet start-session with returned ciphertext'
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

// Shared helper: decrypt ciphertext and save wallet session.
// Used by both walletStartSession() and walletCreateAndWait().
async function decryptAndSaveSession(name, ciphertext, rid) {
  // Load request
  const request = await loadWalletRequest(rid)
  if (!request) {
    throw new Error(`Request not found: ${rid}`)
  }

  const chain = normalizeChain(request.chain || 'polygon')

  // Check if request is expired
  const exp = Date.parse(request.expiresAt)
  if (Number.isFinite(exp) && Date.now() > exp) {
    throw new Error(`Request rid=${rid} is expired (expiresAt=${request.expiresAt}). Create a new request.`)
  }

  // Decrypt ciphertext with NaCl sealed box
  const publicKey = b64urlDecode(request.publicKeyB64u)
  const privateKey = b64urlDecode(request.privateKeyB64u)
  const ciphertextBuf = b64urlDecode(ciphertext)

  const decrypted = sealedbox.open(ciphertextBuf, publicKey, privateKey)
  if (!decrypted) {
    throw new Error('Failed to decrypt ciphertext')
  }

  // Parse decrypted payload (with dapp-client jsonRevivers if available)
  let payload
  try {
    const { jsonRevivers } = await import('@0xsequence/dapp-client')
    payload = JSON.parse(Buffer.from(decrypted).toString('utf8'), jsonRevivers)
  } catch {
    payload = JSON.parse(Buffer.from(decrypted).toString('utf8'))
  }

  const walletAddress = payload.walletAddress
  const chainId = payload.chainId
  const explicitSession = payload.explicitSession
  const implicit = payload.implicit

  if (!walletAddress || typeof walletAddress !== 'string') {
    throw new Error('Missing walletAddress in payload')
  }
  if (!chainId || typeof chainId !== 'number') {
    throw new Error('Missing chainId in payload')
  }

  // Verify chain matches (request stores chain name, payload has chainId)
  const net = resolveNetwork(chain)
  if (Number(net.chainId) !== Number(chainId)) {
    throw new Error(`Chain mismatch: request chain=${chain} (chainId=${net.chainId}) but payload chainId=${chainId}`)
  }

  if (!explicitSession || typeof explicitSession !== 'object') {
    throw new Error('Missing explicitSession in payload')
  }
  if (!explicitSession.pk || typeof explicitSession.pk !== 'string') {
    throw new Error('Missing explicitSession.pk in payload')
  }
  if (!implicit?.pk || !implicit?.attestation || !implicit?.identitySignature) {
    throw new Error('Missing implicit session in payload')
  }

  // Prepare implicit session metadata
  const implicitMeta = {
    guard: implicit.guard,
    loginMethod: implicit.loginMethod,
    userEmail: implicit.userEmail
  }

  // Save wallet session (including all session data like seq-eco does)
  const { jsonReplacers } = await import('@0xsequence/dapp-client')
  await saveWalletSession(name, {
    walletAddress,
    chainId,
    chain,
    projectAccessKey: request.projectAccessKey || null,
    explicitSession: JSON.stringify(explicitSession, jsonReplacers),
    sessionPk: explicitSession.pk,
    implicitPk: implicit.pk,
    implicitMeta: JSON.stringify(implicitMeta, jsonReplacers),
    implicitAttestation: JSON.stringify(implicit.attestation, jsonReplacers),
    implicitIdentitySig: JSON.stringify(implicit.identitySignature, jsonReplacers),
    createdAt: new Date().toISOString()
  })

  return { walletAddress, chainId, chain }
}

// Wallet start-session / import command (formerly ingest-session)
export async function walletStartSession() {
  const args = process.argv.slice(3)
  const name = getArg(args, '--name') || 'main'
  let ciphertext = getArg(args, '--ciphertext')
  let rid = getArg(args, '--rid')

  if (!ciphertext) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --ciphertext parameter' }, null, 2))
    process.exit(1)
  }

  try {
    // Support @filename syntax for reading ciphertext from file
    if (ciphertext.startsWith('@')) {
      const filePath = ciphertext.slice(1)
      try {
        ciphertext = fs.readFileSync(filePath, 'utf8').trim()
      } catch (err) {
        throw new Error(`Failed to read ciphertext from file '${filePath}': ${err.message}`)
      }
    }

    // Auto-detect rid if not provided
    if (!rid) {
      const requestFiles = fs.readdirSync(`${process.env.HOME}/.polygon-agent/requests`).filter(f => f.endsWith('.json'))

      for (const file of requestFiles) {
        const requestRid = file.replace('.json', '')
        const request = await loadWalletRequest(requestRid)
        if (request && request.walletName === name) {
          rid = requestRid
          break
        }
      }

      if (!rid) {
        throw new Error(`No matching request found for wallet '${name}'. Available: ${requestFiles.join(', ')}`)
      }
    }

    const { walletAddress, chainId, chain } = await decryptAndSaveSession(name, ciphertext, rid)

    console.log(JSON.stringify({
      ok: true,
      walletName: name,
      walletAddress,
      chainId,
      chain,
      message: 'Session started successfully. Wallet ready for operations.'
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

// Wallet create-and-wait command: starts temp HTTP server, waits for connector UI callback
export async function walletCreateAndWait() {
  const args = process.argv.slice(3)
  const name = getArg(args, '--name') || 'main'
  const chainArg = getArg(args, '--chain') || 'polygon'
  const timeoutSec = parseInt(getArg(args, '--timeout') || '300', 10)

  try {
    const chain = normalizeChain(chainArg)
    const connectorUrl = process.env.SEQUENCE_ECOSYSTEM_CONNECTOR_URL || 'http://localhost:4444'

    // Generate NaCl keypair for encryption
    const rid = randomId(16)
    const kp = nacl.box.keyPair()
    const pub = b64urlEncode(kp.publicKey)
    const priv = b64urlEncode(kp.secretKey)

    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()

    const projectAccessKey = getArg(args, '--access-key') || process.env.SEQUENCE_PROJECT_ACCESS_KEY

    await saveWalletRequest(rid, {
      rid,
      walletName: name,
      chain,
      createdAt,
      expiresAt,
      publicKeyB64u: pub,
      privateKeyB64u: priv,
      projectAccessKey: projectAccessKey || null
    })

    // Start temp HTTP server on random port (localhost only)
    const { resolve: resolveCallback, reject: rejectCallback, promise: callbackPromise } = promiseWithResolvers()

    const SUCCESS_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Session Approved</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0f;color:#e5e5e5}
.card{text-align:center;padding:2rem;border-radius:1rem;background:#16161f;border:1px solid #2a2a3a;max-width:360px}
.check{width:48px;height:48px;margin:0 auto 1rem;border-radius:50%;background:rgba(34,197,94,.15);display:flex;align-items:center;justify-content:center}
h2{margin:0 0 .5rem;font-size:1.25rem;color:#22c55e}p{margin:0;font-size:.875rem;color:#888}</style></head>
<body><div class="card"><div class="check"><svg width="24" height="24" fill="none" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
<h2>Session Approved</h2><p>You can close this tab and return to your CLI.</p></div></body></html>`

    const MAX_BODY = 65536 // 64KB
    const server = http.createServer((req, res) => {
      // CORS headers for all responses
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      // Preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      // Only accept POST /callback
      if (req.method !== 'POST' || !req.url.startsWith('/callback')) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
        return
      }

      let body = ''
      let size = 0
      req.on('data', chunk => {
        size += chunk.length
        if (size > MAX_BODY) {
          res.writeHead(413, { 'Content-Type': 'text/plain' })
          res.end('Payload too large')
          req.destroy()
          return
        }
        body += chunk
      })
      req.on('end', () => {
        try {
          // Parse body — supports both JSON (fetch) and URL-encoded (form POST)
          let data
          const ct = (req.headers['content-type'] || '').toLowerCase()
          if (ct.includes('application/x-www-form-urlencoded')) {
            data = Object.fromEntries(new URLSearchParams(body))
          } else {
            data = JSON.parse(body)
          }
          if (!data.ciphertext || typeof data.ciphertext !== 'string') {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Missing ciphertext')
            return
          }
          // Respond with HTML success page (rendered in browser after form POST)
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(SUCCESS_HTML)
          resolveCallback(data.ciphertext)
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('Invalid request body')
        }
      })
    })

    await new Promise((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve())
      server.on('error', reject)
    })
    const port = server.address().port

    // Build connector URL with callback
    const url = new URL(connectorUrl)
    url.pathname = url.pathname.replace(/\/$/, '') + '/link'
    url.searchParams.set('rid', rid)
    url.searchParams.set('wallet', name)
    url.searchParams.set('pub', pub)
    url.searchParams.set('chain', chain)
    url.searchParams.set('callbackUrl', `http://localhost:${port}/callback`)

    if (projectAccessKey) {
      url.searchParams.set('accessKey', projectAccessKey)
    }

    // Add session permission params (spending limits, token limits, contracts)
    applySessionPermissionParams(url, args)

    console.log(JSON.stringify({
      ok: true,
      walletName: name,
      chain,
      rid,
      url: url.toString(),
      callbackPort: port,
      expiresAt,
      message: `Waiting for session approval (timeout ${timeoutSec}s)... Open URL in browser.`
    }, null, 2))

    // Wait for callback or timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for callback (${timeoutSec}s)`)), timeoutSec * 1000)
    })

    let ciphertext
    try {
      ciphertext = await Promise.race([callbackPromise, timeoutPromise])
    } finally {
      server.close()
    }

    // Decrypt and save session
    const { walletAddress, chainId, chain: resolvedChain } = await decryptAndSaveSession(name, ciphertext, rid)

    console.log(JSON.stringify({
      ok: true,
      walletName: name,
      walletAddress,
      chainId,
      chain: resolvedChain,
      message: 'Session started successfully. Wallet ready for operations.'
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

// Promise.withResolvers polyfill (Node <22)
function promiseWithResolvers() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

// Wallet list command
export async function walletList() {
  try {
    const wallets = await listWallets()

    const details = []
    for (const name of wallets) {
      const session = await loadWalletSession(name)
      if (session) {
        details.push({
          name,
          address: session.walletAddress,
          chain: session.chain,
          chainId: session.chainId
        })
      }
    }

    console.log(JSON.stringify({
      ok: true,
      wallets: details
    }, null, 2))

  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message
    }, null, 2))
    process.exit(1)
  }
}

// Wallet address command
export async function walletAddress() {
  const args = process.argv.slice(3)
  const name = getArg(args, '--name') || 'main'

  try {
    const session = await loadWalletSession(name)
    if (!session) {
      throw new Error(`Wallet not found: ${name}`)
    }

    console.log(JSON.stringify({
      ok: true,
      walletName: name,
      walletAddress: session.walletAddress,
      chain: session.chain,
      chainId: session.chainId
    }, null, 2))

  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message
    }, null, 2))
    process.exit(1)
  }
}

// Wallet remove command
export async function walletRemove() {
  const args = process.argv.slice(3)
  const name = getArg(args, '--name') || 'main'

  try {
    const { deleteWallet } = await import('../../lib/storage.mjs')
    const deleted = await deleteWallet(name)

    if (!deleted) {
      throw new Error(`Wallet not found: ${name}`)
    }

    console.log(JSON.stringify({
      ok: true,
      walletName: name,
      message: 'Wallet removed successfully'
    }, null, 2))

  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message
    }, null, 2))
    process.exit(1)
  }
}
