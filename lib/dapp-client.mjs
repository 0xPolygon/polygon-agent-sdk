// Shared DappClient wrapper using dapp-client-cli's FileSequenceStorage + StateManager
// Replaces duplicated KeychainSequenceStorage / MapSessionStorage in operations.mjs and registry.mjs
//
// Wallet JSON files (~/.polygon-agent/wallets/<name>.json) remain the source of truth.
// .state.enc files are ephemeral staging — synced from wallet JSON before each DappClient operation.

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { DappClient, TransportMode, jsonRevivers } from '@0xsequence/dapp-client'
import { loadWalletSession } from './storage.mjs'

const STORAGE_DIR = path.join(os.homedir(), '.polygon-agent')
const DEFAULT_WALLET_URL = 'https://acme-wallet.ecosystem-demo.xyz'

// Install fetch logger for debugging network issues (matches seq-eco.mjs)
// Enabled via SEQ_ECO_DEBUG_FETCH=1 or POLYGON_AGENT_DEBUG_FETCH=1
let fetchLoggerInstalled = false
function installFetchLogger() {
  if (fetchLoggerInstalled) return
  const enabled = ['1', 'true', 'yes'].includes(
    String(process.env.SEQ_ECO_DEBUG_FETCH || process.env.POLYGON_AGENT_DEBUG_FETCH || '').toLowerCase()
  )
  if (!enabled) return
  fetchLoggerInstalled = true

  const logPath = process.env.POLYGON_AGENT_FETCH_LOG_PATH ||
    path.join(STORAGE_DIR, 'fetch-debug.log')
  fs.mkdirSync(path.dirname(logPath), { recursive: true })

  const origFetch = globalThis.fetch
  if (typeof origFetch !== 'function') return

  const redact = (s) => String(s).slice(0, 40000)
  const log = (line) => fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, 'utf8')

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url
    const method = init?.method || 'GET'
    const bodyPreview = init?.body ? redact(init.body) : ''
    log(`→ ${method} ${url}`)
    if (bodyPreview) log(`  req.body=${bodyPreview}`)
    try {
      const res = await origFetch(input, init)
      let resText = ''
      try { resText = redact(await res.clone().text()) } catch (e) { resText = `[unreadable: ${e?.message || e}]` }
      log(`← ${res.status} ${method} ${url}`)
      if (resText) log(`  res.body=${resText}`)
      return res
    } catch (e) {
      log(`✖ fetch threw: ${method} ${url} :: ${e?.stack || e}`)
      throw e
    }
  }

  if (globalThis.window) globalThis.window.fetch = globalThis.fetch
  log(`fetch logger enabled; logPath=${logPath}`)
}

// Derive passphrase from env var or existing encryption key (zero new config)
function getPassphrase() {
  if (process.env.DAPP_CLIENT_CLI_PASSPHRASE) {
    return process.env.DAPP_CLIENT_CLI_PASSPHRASE
  }

  const keyPath = path.join(STORAGE_DIR, '.encryption-key')
  if (!fs.existsSync(keyPath)) {
    throw new Error('Missing ~/.polygon-agent/.encryption-key — run "polygon-agent wallet create" first')
  }

  const keyBuf = fs.readFileSync(keyPath)
  return keyBuf.slice(0, 16).toString('hex')
}

// State file path for a wallet
function statePathFor(walletName) {
  const dir = path.join(STORAGE_DIR, 'state', 'dapp-client-cli')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return path.join(dir, `${walletName}.state.enc`)
}

// Sync wallet JSON into dapp-client-cli encrypted state and return storage objects
async function syncStateAndGetStorage({ walletName, chainId }) {
  const session = await loadWalletSession(walletName)
  if (!session) {
    throw new Error(`Wallet not found: ${walletName}`)
  }

  const walletAddress = session.walletAddress

  const explicitRaw = session.explicitSession
  if (!explicitRaw) {
    throw new Error('Missing explicit session. Re-run wallet start-session.')
  }

  const explicitSession = JSON.parse(explicitRaw, jsonRevivers)
  if (!explicitSession?.pk) {
    throw new Error('Stored explicit session is missing pk; re-link wallet')
  }

  // Check session expiry before attempting transaction (matches seq-eco.mjs)
  const deadline = explicitSession?.config?.deadline
  if (deadline) {
    const deadlineSec = typeof deadline === 'bigint' ? Number(deadline) : Number(deadline)
    const nowSec = Math.floor(Date.now() / 1000)
    if (Number.isFinite(deadlineSec) && deadlineSec <= nowSec) {
      throw new Error(`Explicit session has expired (deadline ${deadlineSec}). Re-link wallet to mint a fresh session.`)
    }
  }

  const passphrase = getPassphrase()
  const statePath = statePathFor(walletName)

  const { StateManager } = await import('@0xsequence/dapp-client-cli/dist/state.js')
  const { FileSequenceStorage, FileSessionStorage } = await import('@0xsequence/dapp-client-cli/dist/storage.js')

  const stateManager = new StateManager(statePath, passphrase)
  const storage = new FileSequenceStorage(stateManager, { suppressPendingRedirect: true })
  const sessionStorage = new FileSessionStorage(stateManager)

  // Read env-driven config
  const walletUrl = process.env.SEQUENCE_ECOSYSTEM_WALLET_URL || DEFAULT_WALLET_URL
  const origin = process.env.SEQUENCE_DAPP_ORIGIN
  const projectAccessKey = process.env.SEQUENCE_PROJECT_ACCESS_KEY
  if (!origin) throw new Error('Missing SEQUENCE_DAPP_ORIGIN environment variable')
  if (!projectAccessKey) throw new Error('Missing SEQUENCE_PROJECT_ACCESS_KEY environment variable')

  const keymachineUrl = process.env.SEQUENCE_KEYMACHINE_URL || 'https://keymachine.sequence.app'
  const nodesUrl = process.env.SEQUENCE_NODES_URL || 'https://nodes.sequence.app/{network}'
  const relayerUrl = process.env.SEQUENCE_RELAYER_URL || 'https://{network}-relayer.sequence.app'

  // Initialize state with config and reset storage to prevent stale sessions
  await stateManager.update((state) => {
    state.config.walletUrl = walletUrl
    state.config.origin = origin
    state.config.projectAccessKey = projectAccessKey
    state.config.keymachineUrl = keymachineUrl
    state.config.nodesUrl = nodesUrl
    state.config.relayerUrl = relayerUrl
    state.config.transportMode = 'redirect'

    state.storage.pendingRedirect = false
    state.storage.tempSessionPk = null
    state.storage.pendingRequest = null
    state.storage.explicitSessions = []
    state.storage.implicitSession = null

    state.storage.sessionlessConnection = { walletAddress }
    state.storage.sessionlessConnectionSnapshot = { walletAddress }
  })

  // Parse implicit metadata if available
  const implicitMeta = session.implicitMeta ? JSON.parse(session.implicitMeta, jsonRevivers) : {}

  // Save explicit session
  await storage.saveExplicitSession({
    pk: explicitSession.pk,
    walletAddress,
    chainId,
    loginMethod: implicitMeta.loginMethod ?? explicitSession.loginMethod,
    userEmail: implicitMeta.userEmail ?? explicitSession.userEmail,
    guard: implicitMeta.guard,
  })

  // Persist connected identity
  await stateManager.update((state) => {
    state.storage.sessionlessConnection = {
      walletAddress,
      loginMethod: implicitMeta.loginMethod ?? explicitSession.loginMethod,
      userEmail: implicitMeta.userEmail ?? explicitSession.userEmail,
      guard: implicitMeta.guard,
    }
    state.storage.sessionlessConnectionSnapshot = {
      walletAddress,
      loginMethod: implicitMeta.loginMethod ?? explicitSession.loginMethod,
      userEmail: implicitMeta.userEmail ?? explicitSession.userEmail,
      guard: implicitMeta.guard,
    }
  })

  // Save implicit session if available
  if (session.implicitPk && session.implicitAttestation && session.implicitIdentitySig) {
    const implicitAttestation = JSON.parse(session.implicitAttestation, jsonRevivers)
    const implicitIdentitySignature = JSON.parse(session.implicitIdentitySig, jsonRevivers)
    await storage.saveImplicitSession({
      pk: session.implicitPk,
      walletAddress,
      chainId,
      attestation: implicitAttestation,
      identitySignature: implicitIdentitySignature,
    })
  }

  // Clear any pending redirect remnants
  await storage.setPendingRedirectRequest(false)
  await storage.savePendingRequest(null)
  await storage.saveTempSessionPk(null)

  // Ensure sessionStorage is initialized
  await sessionStorage.removeItem('')

  return {
    storage,
    sessionStorage,
    walletAddress,
    walletUrl,
    origin,
    projectAccessKey,
    keymachineUrl,
    nodesUrl,
    relayerUrl,
  }
}

// Run a transaction via DappClient using FileSequenceStorage
// This replaces the duplicated runDappClientTx() in operations.mjs and runRegistryTx() in registry.mjs
export async function runDappClientTx({ walletName, chainId, transactions, broadcast, preferNativeFee }) {
  const {
    storage,
    sessionStorage,
    walletAddress,
    walletUrl,
    origin,
    projectAccessKey,
    keymachineUrl,
    nodesUrl,
    relayerUrl,
  } = await syncStateAndGetStorage({ walletName, chainId })

  // Node.js polyfill
  if (!globalThis.window) globalThis.window = { fetch: globalThis.fetch }
  else if (!globalThis.window.fetch) globalThis.window.fetch = globalThis.fetch

  installFetchLogger()

  // Create DappClient with FileSequenceStorage
  const client = new DappClient(walletUrl, origin, projectAccessKey, {
    transportMode: TransportMode.REDIRECT,
    keymachineUrl,
    nodesUrl,
    relayerUrl,
    sequenceStorage: storage,
    sequenceSessionStorage: sessionStorage,
    canUseIndexedDb: false,
  })

  await client.initialize()
  if (!client.isInitialized) throw new Error('Client not initialized')

  if (!broadcast) {
    const bigintReplacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
    console.log(JSON.stringify({ ok: true, dryRun: true, walletName, walletAddress, transactions }, bigintReplacer, 2))
    return { walletAddress, dryRun: true }
  }

  // Fee options handling — 3-tier fallback (preserved from original)
  let feeOpt
  try {
    const feeOptions = await client.getFeeOptions(chainId, transactions)

    // Debug fee options (SEQ_ECO_DEBUG_FEE_OPTIONS=1 or POLYGON_AGENT_DEBUG_FEE=1)
    const debugFee = ['1', 'true', 'yes'].includes(
      String(process.env.SEQ_ECO_DEBUG_FEE_OPTIONS || process.env.POLYGON_AGENT_DEBUG_FEE || '').toLowerCase()
    )
    if (debugFee) {
      console.error(JSON.stringify({
        debug: 'feeOptions',
        walletName,
        chainId,
        feeOptionsCount: Array.isArray(feeOptions) ? feeOptions.length : 0,
        feeOptions: (feeOptions || []).map((o) => ({
          tokenSymbol: o?.token?.symbol,
          tokenAddress: o?.token?.contractAddress ?? null,
          value: o?.value,
          gasLimit: o?.gasLimit,
        }))
      }, null, 2))
    }

    feeOpt = preferNativeFee
      ? (feeOptions || []).find((o) => !o?.token?.contractAddress) || feeOptions?.[0]
      : feeOptions?.[0]
  } catch (e) {
    const enabled = !['0', 'false', 'no'].includes(String(process.env.SEQ_ECO_FEEOPTIONS_WORKAROUND || 'true').toLowerCase())
    if (!enabled) throw e

    // Tier 2: Try direct relayer feeOptions
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

    if (!feeOpt) {
      // Tier 3: Forced fee option from getFeeTokens
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
        gasLimit: 0,
      }
    }
  }

  const txHash = await client.sendTransaction(chainId, transactions, feeOpt)
  return { walletAddress, txHash, feeOptionUsed: feeOpt }
}
