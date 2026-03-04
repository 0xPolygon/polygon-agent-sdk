import { resolveNetwork } from './indexer';

const TOKEN_DIR_RAW = 'https://raw.githubusercontent.com/0xsequence/token-directory/main';

type Token = {
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string | null;
};

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return res.json();
}

function cacheGet(key: string): any | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cacheSet(key: string, value: any): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

async function loadIndex(): Promise<any> {
  const key = 'tokenDirectory.index';
  const cached = cacheGet(key);
  const ttlMs = 10 * 60 * 1000;
  if (cached?.ts && Date.now() - cached.ts < ttlMs && cached?.data) return cached.data;

  const data = await fetchJson(`${TOKEN_DIR_RAW}/index/index.json`);
  cacheSet(key, { ts: Date.now(), data });
  return data;
}

function chainFolderFromIndex(
  indexJson: any,
  chainId: number
): { chainName: string; sha256: string } {
  const idx = indexJson?.index;
  if (!idx) throw new Error('token-directory: missing index');
  for (const [chainName, meta] of Object.entries<any>(idx)) {
    if (chainName === '_external') continue;
    if (String(meta?.chainId) !== String(chainId)) continue;
    const sha = meta?.tokenLists?.['erc20.json'];
    if (!sha)
      throw new Error(`token-directory: no erc20 list for chainId=${chainId} (${chainName})`);
    return { chainName, sha256: sha };
  }
  throw new Error(`token-directory: unknown chainId=${chainId}`);
}

async function loadErc20List(chainId: number): Promise<{ tokens: Token[] }> {
  const idx = await loadIndex();
  const { chainName, sha256 } = chainFolderFromIndex(idx, chainId);

  const key = `tokenDirectory.erc20.${chainId}.${String(sha256).slice(0, 12)}`;
  const cached = cacheGet(key);
  if (cached?.tokens) return cached;

  const data = await fetchJson(`${TOKEN_DIR_RAW}/index/${chainName}/erc20.json`);
  cacheSet(key, data);
  return data;
}

export async function resolveErc20Symbol(chainId: number, symbol: string): Promise<Token | null> {
  const sym = String(symbol || '')
    .toUpperCase()
    .trim();
  if (!sym) return null;

  const list = await loadErc20List(chainId);
  const tokens = Array.isArray((list as any)?.tokens) ? (list as any).tokens : (list as any);
  if (!Array.isArray(tokens)) throw new Error('token-directory: unexpected erc20 list format');

  const matches = tokens.filter((t: any) => String(t?.symbol || '').toUpperCase() === sym);
  if (!matches.length) return null;

  const pick =
    matches.find((t: any) => t?.extensions?.verified === true) ||
    matches.find((t: any) => t?.logoURI) ||
    matches[0];
  return {
    chainId: Number(pick.chainId ?? chainId),
    address: pick.address,
    symbol: pick.symbol,
    name: pick.name,
    decimals: pick.decimals,
    logoURI: pick.logoURI || null
  };
}

export function nativeSymbolForChainId(chainId: number): string {
  const net = resolveNetwork(chainId);
  return net?.nativeCurrency?.symbol || 'NATIVE';
}
