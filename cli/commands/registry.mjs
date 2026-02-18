// Registry commands - ERC-8004 Agent Registration and Reputation
// IdentityRegistry: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
// ReputationRegistry: 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Contract, Interface } from 'ethers'
import { runDappClientTx } from '../../lib/dapp-client.mjs'
import { getArg, hasFlag, resolveNetwork, formatUnits, getExplorerUrl, getRpcUrl } from '../../lib/utils.mjs'

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

// Register agent on IdentityRegistry
export async function registerAgent() {
  const args = process.argv.slice(2)
  const walletName = getArg(args, '--wallet') || 'main'
  const agentName = getArg(args, '--name')
  const agentURI = getArg(args, '--agent-uri') || getArg(args, '--uri')
  const metadataStr = getArg(args, '--metadata')
  const broadcast = hasFlag(args, '--broadcast')

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
    } else if (metadata.length > 0) {
      data = iface.encodeFunctionData('register(string,(string,bytes)[])', ['', metadata])
    } else if (agentURI) {
      data = iface.encodeFunctionData('register(string)', [agentURI])
    } else {
      data = iface.encodeFunctionData('register()', [])
    }

    const { walletAddress, txHash, dryRun } = await runDappClientTx({
      walletName,
      chainId: 137,
      transactions: [{ to: IDENTITY_REGISTRY, value: 0n, data }],
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
    const provider = new JsonRpcProvider(getRpcUrl(network))

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
    const provider = new JsonRpcProvider(getRpcUrl(network))

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
    const provider = new JsonRpcProvider(getRpcUrl(network))

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
  const walletName = getArg(args, '--wallet') || 'main'
  const agentId = getArg(args, '--agent-id')
  const value = getArg(args, '--value')
  const tag1 = getArg(args, '--tag1') || ''
  const tag2 = getArg(args, '--tag2') || ''
  const endpoint = getArg(args, '--endpoint') || ''
  const feedbackURI = getArg(args, '--feedback-uri') || ''
  const broadcast = hasFlag(args, '--broadcast')

  if (!agentId || !value) {
    console.error(JSON.stringify({
      ok: false,
      error: 'Missing required parameters: --agent-id, --value'
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

    const { walletAddress, txHash, dryRun } = await runDappClientTx({
      walletName,
      chainId: 137,
      transactions: [{ to: REPUTATION_REGISTRY, value: 0n, data }],
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
    const provider = new JsonRpcProvider(getRpcUrl(network))

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
