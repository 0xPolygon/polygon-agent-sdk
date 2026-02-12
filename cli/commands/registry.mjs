// Registry commands - ERC-8004 Agent Registration and Reputation
// IdentityRegistry: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
// ReputationRegistry: 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Contract, Interface } from 'ethers'
import { loadWalletSession } from '../../lib/storage.mjs'
import { getArg, hasFlag, resolveNetwork, formatUnits, getExplorerUrl } from '../../lib/utils.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Contract addresses on Polygon
const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'
const REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63'

// Load ABIs
const IDENTITY_ABI = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../contracts/IdentityRegistry.json'), 'utf8')
)
const REPUTATION_ABI = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../contracts/ReputationRegistry.json'), 'utf8')
)

// Default nodes URL — matches seq-eco.mjs exactly
function defaultNodesUrl(_projectAccessKey) {
  return 'https://nodes.sequence.app/{network}'
}

// Helper: Run transaction via DappClient (mirrors seq-eco.mjs runDappClientTx)
async function runRegistryTx({ walletName, contractAddress, data, broadcast = true }) {
  const { DappClient, TransportMode, jsonRevivers } = await import('@0xsequence/dapp-client')

  const session = await loadWalletSession(walletName)
  if (!session) {
    throw new Error(`Wallet not found: ${walletName}`)
  }

  const walletAddress = session.walletAddress
  const chainId = 137 // Registry is on Polygon

  const projectAccessKey = process.env.SEQUENCE_PROJECT_ACCESS_KEY
  if (!projectAccessKey) {
    throw new Error('Missing SEQUENCE_PROJECT_ACCESS_KEY environment variable')
  }

  const walletUrl = process.env.SEQUENCE_ECOSYSTEM_WALLET_URL || 'https://acme-wallet.ecosystem-demo.xyz'
  const dappOrigin = process.env.SEQUENCE_DAPP_ORIGIN
  if (!dappOrigin) {
    throw new Error('Missing SEQUENCE_DAPP_ORIGIN environment variable')
  }

  // Parse explicit session from stored JSON string
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

  // Load implicit session if available
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

  // Node.js polyfill
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

  const transactions = [{
    to: contractAddress,
    value: 0n,
    data
  }]

  if (!broadcast) {
    const bigintReplacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v)
    console.log(JSON.stringify({ ok: true, dryRun: true, walletName, walletAddress, transactions }, bigintReplacer, 2))
    return { walletAddress, dryRun: true }
  }

  // Fee options handling (matches seq-eco.mjs)
  let feeOpt
  try {
    const feeOptions = await client.getFeeOptions(chainId, transactions)
    feeOpt = feeOptions?.[0]
  } catch (e) {
    const enabled = !['0', 'false', 'no'].includes(String(process.env.SEQ_ECO_FEEOPTIONS_WORKAROUND || 'true').toLowerCase())
    if (!enabled) throw e

    try {
      const mgr = client.getChainSessionManager ? client.getChainSessionManager(chainId) : null
      const direct = await mgr?.relayer?.feeOptions?.(walletAddress, chainId, transactions)
      const opts = direct?.options
      if (Array.isArray(opts) && opts.length) {
        feeOpt = opts[0]
      }
    } catch {
      // ignore, fall back
    }

    if (!feeOpt) {
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

// Register agent on IdentityRegistry
export async function registerAgent() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet')
  const agentName = getArg(args, '--name')
  const agentURI = getArg(args, '--agent-uri') || getArg(args, '--uri')
  const metadataStr = getArg(args, '--metadata')
  const broadcast = hasFlag(args, '--broadcast')

  if (!walletName) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --wallet parameter' }, null, 2))
    process.exit(1)
  }

  try {
    const iface = new Interface(IDENTITY_ABI)
    let data

    // Parse metadata if provided
    const metadata = []
    if (metadataStr) {
      const pairs = metadataStr.split(',')
      for (const pair of pairs) {
        const [key, value] = pair.split('=')
        if (key && value) {
          metadata.push({
            metadataKey: key.trim(),
            metadataValue: Buffer.from(value.trim(), 'utf8')
          })
        }
      }
    }

    // Add agent name to metadata if provided
    if (agentName) {
      metadata.push({
        metadataKey: 'name',
        metadataValue: Buffer.from(agentName, 'utf8')
      })
    }

    // Choose registration method based on parameters
    if (agentURI && metadata.length > 0) {
      data = iface.encodeFunctionData('register(string,(string,bytes)[])', [agentURI, metadata])
    } else if (agentURI) {
      data = iface.encodeFunctionData('register(string)', [agentURI])
    } else {
      data = iface.encodeFunctionData('register()', [])
    }

    const { walletAddress, txHash, dryRun } = await runRegistryTx({
      walletName,
      contractAddress: IDENTITY_REGISTRY,
      data,
      broadcast
    })

    if (dryRun) return

    const network = resolveNetwork('polygon')
    const explorerUrl = getExplorerUrl(network, txHash)

    console.log(JSON.stringify({
      ok: true,
      walletName,
      walletAddress,
      contract: 'IdentityRegistry',
      contractAddress: IDENTITY_REGISTRY,
      agentName: agentName || 'Anonymous',
      agentURI: agentURI || 'Not provided',
      metadataCount: metadata.length,
      txHash,
      explorerUrl,
      message: 'Agent registered! Check transaction for agentId in Registered event.'
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

// Get agent wallet address
export async function getAgentWallet() {
  const args = process.argv.slice(2)
  const agentId = getArg(args, '--agent-id')

  if (!agentId) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --agent-id parameter' }, null, 2))
    process.exit(1)
  }

  try {
    const network = resolveNetwork('polygon')
    const { JsonRpcProvider } = await import('ethers')
    const provider = new JsonRpcProvider(network.rpcUrl)

    const contract = new Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider)
    const walletAddress = await contract.getAgentWallet(agentId)

    console.log(JSON.stringify({
      ok: true,
      agentId,
      agentWallet: walletAddress,
      hasWallet: walletAddress !== '0x0000000000000000000000000000000000000000'
    }, null, 2))

  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message
    }, null, 2))
    process.exit(1)
  }
}

// Get agent metadata
export async function getMetadata() {
  const args = process.argv.slice(2)
  const agentId = getArg(args, '--agent-id')
  const key = getArg(args, '--key')

  if (!agentId || !key) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --agent-id or --key parameter' }, null, 2))
    process.exit(1)
  }

  try {
    const network = resolveNetwork('polygon')
    const { JsonRpcProvider } = await import('ethers')
    const provider = new JsonRpcProvider(network.rpcUrl)

    const contract = new Contract(IDENTITY_REGISTRY, IDENTITY_ABI, provider)
    const valueBytes = await contract.getMetadata(agentId, key)
    const value = Buffer.from(valueBytes.slice(2), 'hex').toString('utf8')

    console.log(JSON.stringify({
      ok: true,
      agentId,
      key,
      value
    }, null, 2))

  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message
    }, null, 2))
    process.exit(1)
  }
}

// Get agent reputation summary
export async function getReputation() {
  const args = process.argv.slice(2)
  const agentId = getArg(args, '--agent-id')
  const tag1 = getArg(args, '--tag1') || ''
  const tag2 = getArg(args, '--tag2') || ''

  if (!agentId) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --agent-id parameter' }, null, 2))
    process.exit(1)
  }

  try {
    const network = resolveNetwork('polygon')
    const { JsonRpcProvider } = await import('ethers')
    const provider = new JsonRpcProvider(network.rpcUrl)

    const contract = new Contract(REPUTATION_REGISTRY, REPUTATION_ABI, provider)

    // Get all clients first
    const clients = await contract.getClients(agentId)

    // Get summary
    const [count, summaryValue, summaryValueDecimals] = await contract.getSummary(
      agentId,
      clients,
      tag1,
      tag2
    )

    const score = formatUnits(summaryValue, summaryValueDecimals)

    console.log(JSON.stringify({
      ok: true,
      agentId,
      feedbackCount: Number(count),
      reputationScore: score,
      decimals: summaryValueDecimals,
      clientCount: clients.length,
      tag1: tag1 || 'all',
      tag2: tag2 || 'all'
    }, null, 2))

  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message
    }, null, 2))
    process.exit(1)
  }
}

// Give feedback to an agent
export async function giveFeedback() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet')
  const agentId = getArg(args, '--agent-id')
  const value = getArg(args, '--value')
  const tag1 = getArg(args, '--tag1') || ''
  const tag2 = getArg(args, '--tag2') || ''
  const endpoint = getArg(args, '--endpoint') || ''
  const feedbackURI = getArg(args, '--feedback-uri') || ''
  const broadcast = hasFlag(args, '--broadcast')

  if (!walletName || !agentId || !value) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Missing required parameters: --wallet, --agent-id, --value'
    }, null, 2))
    process.exit(1)
  }

  try {
    // Parse value (support decimals like 4.5 = 450 with 2 decimals)
    const valueFloat = parseFloat(value)
    const decimals = 2
    const valueInt = BigInt(Math.round(valueFloat * Math.pow(10, decimals)))

    const iface = new Interface(REPUTATION_ABI)
    const data = iface.encodeFunctionData('giveFeedback', [
      agentId,
      valueInt,
      decimals,
      tag1,
      tag2,
      endpoint,
      feedbackURI,
      '0x0000000000000000000000000000000000000000000000000000000000000000' // feedbackHash
    ])

    const { walletAddress, txHash, dryRun } = await runRegistryTx({
      walletName,
      contractAddress: REPUTATION_REGISTRY,
      data,
      broadcast
    })

    if (dryRun) return

    const network = resolveNetwork('polygon')
    const explorerUrl = getExplorerUrl(network, txHash)

    console.log(JSON.stringify({
      ok: true,
      walletName,
      walletAddress,
      agentId,
      value: valueFloat,
      tag1,
      tag2,
      endpoint,
      txHash,
      explorerUrl,
      message: 'Feedback submitted successfully'
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

// Read all feedback for an agent
export async function readAllFeedback() {
  const args = process.argv.slice(2)
  const agentId = getArg(args, '--agent-id')
  const tag1 = getArg(args, '--tag1') || ''
  const tag2 = getArg(args, '--tag2') || ''
  const includeRevoked = hasFlag(args, '--include-revoked')

  if (!agentId) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --agent-id parameter' }, null, 2))
    process.exit(1)
  }

  try {
    const network = resolveNetwork('polygon')
    const { JsonRpcProvider } = await import('ethers')
    const provider = new JsonRpcProvider(network.rpcUrl)

    const contract = new Contract(REPUTATION_REGISTRY, REPUTATION_ABI, provider)

    // Get all clients
    const clients = await contract.getClients(agentId)

    // Read all feedback
    const [clientsList, indexes, values, decimals, tag1s, tag2s, revoked] = await contract.readAllFeedback(
      agentId,
      clients,
      tag1,
      tag2,
      includeRevoked
    )

    const feedback = []
    for (let i = 0; i < clientsList.length; i++) {
      feedback.push({
        client: clientsList[i],
        index: Number(indexes[i]),
        value: formatUnits(values[i], decimals[i]),
        tag1: tag1s[i],
        tag2: tag2s[i],
        revoked: revoked[i]
      })
    }

    console.log(JSON.stringify({
      ok: true,
      agentId,
      feedbackCount: feedback.length,
      feedback
    }, null, 2))

  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error.message
    }, null, 2))
    process.exit(1)
  }
}
