// Utility functions for polygon-agent-kit

import fs from 'node:fs'
import { networks } from '@0xsequence/network'

// Parse command-line argument
export function getArg(args, flag) {
  const idx = args.indexOf(flag)
  if (idx === -1 || idx === args.length - 1) return null

  let val = args[idx + 1]

  // Support @filename syntax for reading from files
  if (typeof val === 'string' && val.startsWith('@')) {
    const filePath = val.slice(1)
    try {
      val = fs.readFileSync(filePath, 'utf8').trim()
    } catch (err) {
      throw new Error(`Failed to read file ${filePath}: ${err.message}`)
    }
  }

  return val
}

// Check if flag is present
export function hasFlag(args, flag) {
  return args.includes(flag)
}

// Resolve network from chain name or ID
export function resolveNetwork(chainOrId) {
  // Try as chain ID first
  const chainId = parseInt(chainOrId)
  if (!isNaN(chainId)) {
    const network = networks[chainId]
    if (network) return network
  }

  // Try as chain name
  const lowerName = String(chainOrId).toLowerCase()
  for (const [id, network] of Object.entries(networks)) {
    if (network.name.toLowerCase() === lowerName) {
      return network
    }
  }

  throw new Error(`Unknown chain: ${chainOrId}`)
}

// Format units (wei to human-readable)
export function formatUnits(value, decimals = 18) {
  const bigValue = BigInt(value)
  const divisor = BigInt(10) ** BigInt(decimals)

  const intPart = bigValue / divisor
  const fracPart = bigValue % divisor

  if (fracPart === 0n) {
    return intPart.toString()
  }

  const fracStr = fracPart.toString().padStart(decimals, '0')
  const trimmed = fracStr.replace(/0+$/, '')

  return `${intPart}.${trimmed}`
}

// Parse units (human-readable to wei)
export function parseUnits(value, decimals = 18) {
  const [intPart, fracPart = ''] = value.split('.')

  const paddedFrac = fracPart.padEnd(decimals, '0').slice(0, decimals)
  const combined = intPart + paddedFrac

  return BigInt(combined)
}

// Get indexer URL for chain (learned from upstream fix)
export function getIndexerUrl(chainId) {
  // Use IndexerGateway (not Indexer) - upstream fix commit 6034ce6
  return process.env.SEQUENCE_INDEXER_URL || 'https://indexer.sequence.app/rpc/IndexerGateway/GetTokenBalancesSummary'
}

// Explorer URL for transaction
export function getExplorerUrl(network, txHash) {
  const base = network.blockExplorer?.url || `https://polygonscan.com`
  return `${base}/tx/${txHash}`
}

// Generate random hex string
export function randomHex(bytes) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('')
}
