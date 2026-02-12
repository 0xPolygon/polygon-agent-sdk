import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TOKEN_DIR_RAW = 'https://raw.githubusercontent.com/0xsequence/token-directory'

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
}

function cacheDir() {
  return path.join(os.homedir(), '.openclaw', 'state', 'sequence-ecosystem', 'token-directory')
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`fetch ${url} failed: ${res.status} ${text}`)
  }
  return res.json()
}

export async function loadTokenDirectoryIndex({ ref = 'main' } = {}) {
  const dir = cacheDir()
  ensureDir(dir)
  const fp = path.join(dir, `index.${ref}.json`)

  // Cache index for 10 minutes to reduce GitHub hits.
  const ttlMs = 10 * 60 * 1000
  if (fs.existsSync(fp)) {
    try {
      const st = fs.statSync(fp)
      if (Date.now() - st.mtimeMs < ttlMs) {
        return JSON.parse(fs.readFileSync(fp, 'utf8'))
      }
    } catch {}
  }

  const url = `${TOKEN_DIR_RAW}/${ref}/index/index.json`
  const json = await fetchJson(url)
  fs.writeFileSync(fp, JSON.stringify(json), 'utf8')
  return json
}

function pickChainFolderFromIndex(indexJson, chainId) {
  const idx = indexJson?.index
  if (!idx || typeof idx !== 'object') return null

  for (const [chainName, meta] of Object.entries(idx)) {
    if (!meta || typeof meta !== 'object') continue
    if (String(meta.chainId) !== String(chainId)) continue
    if (chainName === '_external') continue
    return { chainName, meta }
  }

  return null
}

export async function loadErc20ListForChain({ chainId, ref = 'main' }) {
  const dir = cacheDir()
  ensureDir(dir)

  const indexJson = await loadTokenDirectoryIndex({ ref })
  const picked = pickChainFolderFromIndex(indexJson, chainId)
  if (!picked) throw new Error(`token-directory: unknown chainId=${chainId}`)

  const { chainName, meta } = picked
  const sha256 = meta?.tokenLists?.['erc20.json'] || null
  if (!sha256) throw new Error(`token-directory: no erc20 list found for chainId=${chainId} (${chainName})`)

  const filePath = `index/${chainName}/erc20.json`

  const cacheKey = `${chainId}.erc20.${ref}.${String(sha256).slice(0, 12)}.json`
  const fp = path.join(dir, cacheKey)

  if (fs.existsSync(fp)) {
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf8'))
    } catch {}
  }

  const url = `${TOKEN_DIR_RAW}/${ref}/${filePath}`
  const list = await fetchJson(url)
  fs.writeFileSync(fp, JSON.stringify(list), 'utf8')
  return list
}

export async function resolveErc20BySymbol({ chainId, symbol, ref = 'main' }) {
  const sym = String(symbol || '').toUpperCase().trim()
  if (!sym) throw new Error('token-directory: missing symbol')

  const list = await loadErc20ListForChain({ chainId, ref })
  const tokens = list?.tokens || list
  if (!Array.isArray(tokens)) throw new Error('token-directory: unexpected erc20 list format')

  const matches = tokens.filter((t) => String(t?.symbol || '').toUpperCase() === sym)
  if (!matches.length) return null

  const pick = matches.find((t) => t?.extensions?.verified === true) || matches.find((t) => t?.logoURI) || matches[0]

  return {
    chainId: Number(pick.chainId ?? chainId),
    address: pick.address,
    symbol: pick.symbol,
    name: pick.name,
    decimals: pick.decimals,
    logoURI: pick.logoURI || null
  }
}
