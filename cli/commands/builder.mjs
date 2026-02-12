// Builder command - Condense 3 steps into 1
// Step 1: Create EOA wallet
// Step 2: Authenticate with Sequence Builder
// Step 3: Create project and get access key

import { ethers } from 'ethers'
import { saveBuilderConfig, loadBuilderConfig } from '../../lib/storage.mjs'
import { getArg, hasFlag } from '../../lib/utils.mjs'

// ETHAuth constants
const ETH_AUTH_VERSION = '1'
const ETH_AUTH_PREFIX = 'eth'
const ETH_AUTH_DOMAIN = {
  name: 'ETHAuth',
  version: '1',
}

// Generate ETHAuth proof (condensed from builder-cli/src/lib/ethauth.ts)
async function generateEthAuthProof(privateKey) {
  const wallet = new ethers.Wallet(privateKey)
  const now = Math.floor(Date.now() / 1000)

  const claims = {
    app: 'polygon-agent-kit',
    iat: now,
    exp: now + 3600, // 1 hour
    v: ETH_AUTH_VERSION
  }

  // Build EIP-712 typed data
  const types = []
  const message = {}

  if (claims.app) {
    types.push({ name: 'app', type: 'string' })
    message.app = claims.app
  }
  if (claims.iat) {
    types.push({ name: 'iat', type: 'int64' })
    message.iat = claims.iat
  }
  if (claims.exp) {
    types.push({ name: 'exp', type: 'int64' })
    message.exp = claims.exp
  }
  if (claims.v) {
    types.push({ name: 'v', type: 'string' })
    message.v = claims.v
  }

  const typedData = {
    domain: ETH_AUTH_DOMAIN,
    types: { Claims: types },
    message,
    primaryType: 'Claims'
  }

  // Sign with EIP-712
  const signature = await wallet.signTypedData(typedData.domain, typedData.types, typedData.message)

  // Encode proof: eth.<address>.<base64-claims>.<signature>
  const address = wallet.address.toLowerCase()
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${ETH_AUTH_PREFIX}.${address}.${encodedClaims}.${signature}`
}

// Get auth token from Sequence Builder API
async function getAuthToken(proofString) {
  const apiUrl = process.env.SEQUENCE_BUILDER_API_URL || 'https://api.sequence.build'
  const url = `${apiUrl}/rpc/Builder/GetAuthToken`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ethAuth: proofString })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`GetAuthToken failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()

  if (!data.ok || !data.auth?.jwtToken) {
    throw new Error('GetAuthToken returned invalid response')
  }

  return data.auth.jwtToken
}

// Create project on Sequence Builder
async function createProject(name, jwtToken) {
  const apiUrl = process.env.SEQUENCE_BUILDER_API_URL || 'https://api.sequence.build'
  const url = `${apiUrl}/rpc/Builder/CreateProject`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwtToken}`
    },
    body: JSON.stringify({ name })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`CreateProject failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()

  if (!data.project) {
    throw new Error('CreateProject returned invalid response')
  }

  return data.project
}

// Get default access key for project
async function getDefaultAccessKey(projectId, jwtToken) {
  const apiUrl = process.env.SEQUENCE_BUILDER_API_URL || 'https://api.sequence.build'
  const url = `${apiUrl}/rpc/Builder/GetDefaultAccessKey`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwtToken}`
    },
    body: JSON.stringify({ projectID: projectId })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`GetDefaultAccessKey failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()

  if (!data.accessKey?.accessKey) {
    throw new Error('GetDefaultAccessKey returned invalid response')
  }

  return data.accessKey.accessKey
}

// Main builder setup command
export async function builderSetup() {
  const args = process.argv.slice(3)
  const name = getArg(args, '--name')

  if (!name) {
    console.error(JSON.stringify({ ok: false, error: 'Missing --name parameter' }, null, 2))
    process.exit(1)
  }

  try {
    // Check if already set up
    const existing = await loadBuilderConfig()
    if (existing && !hasFlag(args, '--force')) {
      console.log(JSON.stringify({
        ok: true,
        message: 'Builder already configured. Use --force to recreate.',
        eoaAddress: existing.eoaAddress,
        accessKey: existing.accessKey,
        projectId: existing.projectId
      }, null, 2))
      return
    }

    // Step 1: Generate EOA
    const wallet = ethers.Wallet.createRandom()
    const privateKey = wallet.privateKey
    const eoaAddress = wallet.address

    // Step 2: Authenticate with Sequence Builder
    const ethAuthProof = await generateEthAuthProof(privateKey)
    const jwtToken = await getAuthToken(ethAuthProof)

    // Step 3: Create project
    const project = await createProject(name, jwtToken)

    // Get default access key
    const accessKey = await getDefaultAccessKey(project.id, jwtToken)

    // Save to encrypted storage
    await saveBuilderConfig({
      privateKey,
      eoaAddress,
      accessKey,
      projectId: project.id
    })

    // Output result
    console.log(JSON.stringify({
      ok: true,
      privateKey,  // Show once for backup
      eoaAddress,
      accessKey,
      projectId: project.id,
      projectName: project.name,
      message: 'Builder configured successfully. Credentials saved to ~/.polygon-agent/builder.json (encrypted)'
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
