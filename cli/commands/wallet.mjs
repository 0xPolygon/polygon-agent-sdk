// Wallet commands - Session-based ecosystem wallet
// Renamed from create-request → wallet create
// Renamed from ingest-session → wallet start-session

import fs from 'node:fs'
import nacl from 'tweetnacl'
import sealedbox from 'tweetnacl-sealedbox-js'
import { saveWalletSession, loadWalletSession, saveWalletRequest, loadWalletRequest, listWallets } from '../../lib/storage.mjs'
import { getArg, hasFlag, normalizeChain, resolveNetwork } from '../../lib/utils.mjs'

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

// Wallet create command (formerly create-request)
export async function walletCreate() {
  const args = process.argv.slice(3)
  const name = getArg(args, '--name')
  const chainArg = getArg(args, '--chain') || 'polygon'

  if (!name) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --name parameter' }, null, 2))
    process.exit(1)
  }

  try {
    // Normalize chain name (don't resolve to Network object yet - that happens in wallet start-session)
    const chain = normalizeChain(chainArg)
    const connectorUrl = process.env.SEQUENCE_ECOSYSTEM_CONNECTOR_URL

    if (!connectorUrl) {
      throw new Error('Missing SEQUENCE_ECOSYSTEM_CONNECTOR_URL environment variable')
    }

    // Generate NaCl keypair for encryption
    const rid = randomId(16)
    const kp = nacl.box.keyPair()
    const pub = b64urlEncode(kp.publicKey)
    const priv = b64urlEncode(kp.secretKey)

    const createdAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours

    // Save request state (store chain as string, not Network object)
    await saveWalletRequest(rid, {
      rid,
      walletName: name,
      chain,  // Just the normalized string like "polygon"
      createdAt,
      expiresAt,
      publicKeyB64u: pub,
      privateKeyB64u: priv
    })

    // Build connector URL
    const url = new URL(connectorUrl)
    url.pathname = url.pathname.replace(/\/$/, '') + '/link'
    url.searchParams.set('rid', rid)
    url.searchParams.set('wallet', name)
    url.searchParams.set('pub', pub)
    url.searchParams.set('chain', chain)  // String chain name

    // Add project access key if available
    const projectAccessKey = getArg(args, '--access-key') || process.env.SEQUENCE_PROJECT_ACCESS_KEY
    if (projectAccessKey) {
      url.searchParams.set('accessKey', projectAccessKey)
    }

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

// Wallet start-session command (formerly ingest-session)
export async function walletStartSession() {
  const args = process.argv.slice(3)
  const name = getArg(args, '--name')
  let ciphertext = getArg(args, '--ciphertext')
  let rid = getArg(args, '--rid')

  if (!name) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --name parameter' }, null, 2))
    process.exit(1)
  }

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
      // Try to find matching request
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
      explicitSession: JSON.stringify(explicitSession, jsonReplacers),
      sessionPk: explicitSession.pk,
      implicitPk: implicit.pk,
      implicitMeta: JSON.stringify(implicitMeta, jsonReplacers),
      implicitAttestation: JSON.stringify(implicit.attestation, jsonReplacers),
      implicitIdentitySig: JSON.stringify(implicit.identitySignature, jsonReplacers),
      createdAt: new Date().toISOString()
    })

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
  const name = getArg(args, '--name')

  if (!name) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --name parameter' }, null, 2))
    process.exit(1)
  }

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
  const name = getArg(args, '--name')

  if (!name) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --name parameter' }, null, 2))
    process.exit(1)
  }

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
