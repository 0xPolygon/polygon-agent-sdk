// Wallet commands - Session-based ecosystem wallet
// Renamed from create-request → wallet create
// Renamed from ingest-session → wallet start-session

import fs from 'node:fs'
import nacl from 'tweetnacl'
import sealedbox from 'tweetnacl-sealedbox-js'
import { saveWalletSession, loadWalletSession, saveWalletRequest, loadWalletRequest, listWallets } from '../../lib/storage.mjs'
import { getArg, hasFlag, resolveNetwork } from '../../lib/utils.mjs'

// Base64 URL encode
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url')
}

// Base64 URL decode
function b64urlDecode(str) {
  return Buffer.from(str, 'base64url')
}

// Generate random ID
function randomId(bytes) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
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
    const chain = resolveNetwork(chainArg)
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

    // Save request state
    await saveWalletRequest(rid, {
      rid,
      walletName: name,
      chain: chain.name,
      chainId: chain.chainId,
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
    url.searchParams.set('chain', chain.name)

    // Add project access key if available
    const projectAccessKey = getArg(args, '--access-key') || process.env.SEQUENCE_PROJECT_ACCESS_KEY
    if (projectAccessKey) {
      url.searchParams.set('accessKey', projectAccessKey)
    }

    // Add DAPP origin
    const dappOrigin = process.env.SEQUENCE_DAPP_ORIGIN
    if (dappOrigin) {
      url.searchParams.set('origin', dappOrigin)
    }

    console.log(JSON.stringify({
      ok: true,
      walletName: name,
      chain: chain.name,
      chainId: chain.chainId,
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

    // Decrypt ciphertext with NaCl sealed box
    const publicKey = b64urlDecode(request.publicKeyB64u)
    const privateKey = b64urlDecode(request.privateKeyB64u)
    const ciphertextBuf = b64urlDecode(ciphertext)

    const decrypted = sealedbox.open(ciphertextBuf, publicKey, privateKey)
    if (!decrypted) {
      throw new Error('Failed to decrypt ciphertext')
    }

    // Parse decrypted payload
    const payload = JSON.parse(Buffer.from(decrypted).toString('utf8'))

    if (!payload.walletAddress) {
      throw new Error('Invalid payload: missing walletAddress')
    }

    // Save wallet session
    await saveWalletSession(name, {
      walletAddress: payload.walletAddress,
      session: payload.session,
      chainId: request.chainId,
      chain: request.chain,
      createdAt: new Date().toISOString()
    })

    console.log(JSON.stringify({
      ok: true,
      walletName: name,
      walletAddress: payload.walletAddress,
      chainId: request.chainId,
      chain: request.chain,
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
