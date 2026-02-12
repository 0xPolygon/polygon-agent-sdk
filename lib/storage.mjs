// Storage module for polygon-agent-kit
// Simple file-based storage with AES-256-GCM encryption
// ~/.polygon-agent/ structure

import fs from 'node:fs'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import os from 'node:os'

const STORAGE_DIR = path.join(os.homedir(), '.polygon-agent')
const ENCRYPTION_KEY_FILE = path.join(STORAGE_DIR, '.encryption-key')

// Ensure storage directory exists
function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true, mode: 0o700 })
  }
  // Create subdirectories
  const subdirs = ['wallets', 'requests']
  for (const dir of subdirs) {
    const fullPath = path.join(STORAGE_DIR, dir)
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { mode: 0o700 })
    }
  }
}

// Get or create encryption key
function getEncryptionKey() {
  ensureStorageDir()

  if (fs.existsSync(ENCRYPTION_KEY_FILE)) {
    return fs.readFileSync(ENCRYPTION_KEY_FILE)
  }

  // Generate new 256-bit key
  const key = randomBytes(32)
  fs.writeFileSync(ENCRYPTION_KEY_FILE, key, { mode: 0o600 })
  return key
}

// Encrypt data with AES-256-GCM
function encrypt(plaintext) {
  const key = getEncryptionKey()
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return {
    iv: iv.toString('hex'),
    encrypted,
    authTag: authTag.toString('hex')
  }
}

// Decrypt data with AES-256-GCM
function decrypt(cipherData) {
  const key = getEncryptionKey()
  const iv = Buffer.from(cipherData.iv, 'hex')
  const authTag = Buffer.from(cipherData.authTag, 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(cipherData.encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

// Save builder config (encrypted private key)
export async function saveBuilderConfig(config) {
  ensureStorageDir()

  const configPath = path.join(STORAGE_DIR, 'builder.json')

  // Encrypt private key
  const encryptedKey = encrypt(config.privateKey)

  const data = {
    privateKey: encryptedKey,
    eoaAddress: config.eoaAddress,
    accessKey: config.accessKey,
    projectId: config.projectId
  }

  fs.writeFileSync(configPath, JSON.stringify(data, null, 2), { mode: 0o600 })
}

// Load builder config (decrypt private key)
export async function loadBuilderConfig() {
  const configPath = path.join(STORAGE_DIR, 'builder.json')

  if (!fs.existsSync(configPath)) {
    return null
  }

  const data = JSON.parse(fs.readFileSync(configPath, 'utf8'))

  // Decrypt private key
  const privateKey = decrypt(data.privateKey)

  return {
    privateKey,
    eoaAddress: data.eoaAddress,
    accessKey: data.accessKey,
    projectId: data.projectId
  }
}

// Save wallet session
export async function saveWalletSession(name, session) {
  ensureStorageDir()

  const walletPath = path.join(STORAGE_DIR, 'wallets', `${name}.json`)
  fs.writeFileSync(walletPath, JSON.stringify(session, null, 2), { mode: 0o600 })
}

// Load wallet session
export async function loadWalletSession(name) {
  const walletPath = path.join(STORAGE_DIR, 'wallets', `${name}.json`)

  if (!fs.existsSync(walletPath)) {
    return null
  }

  return JSON.parse(fs.readFileSync(walletPath, 'utf8'))
}

// Save wallet request (for create-request flow)
export async function saveWalletRequest(rid, request) {
  ensureStorageDir()

  const requestPath = path.join(STORAGE_DIR, 'requests', `${rid}.json`)
  fs.writeFileSync(requestPath, JSON.stringify(request, null, 2), { mode: 0o600 })
}

// Load wallet request
export async function loadWalletRequest(rid) {
  const requestPath = path.join(STORAGE_DIR, 'requests', `${rid}.json`)

  if (!fs.existsSync(requestPath)) {
    return null
  }

  return JSON.parse(fs.readFileSync(requestPath, 'utf8'))
}

// List all wallets
export async function listWallets() {
  ensureStorageDir()

  const walletsDir = path.join(STORAGE_DIR, 'wallets')
  const files = fs.readdirSync(walletsDir)

  return files
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
}

// Delete wallet
export async function deleteWallet(name) {
  const walletPath = path.join(STORAGE_DIR, 'wallets', `${name}.json`)

  if (fs.existsSync(walletPath)) {
    fs.unlinkSync(walletPath)
    return true
  }

  return false
}
