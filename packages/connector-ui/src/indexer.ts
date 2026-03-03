import { Network } from '@0xsequence/wallet-primitives';

// Chain-agnostic indexer endpoint: returns balances for all supported chains.
const DEFAULT_INDEXER_URL = 'https://indexer.sequence.app/rpc/Indexer/GetTokenBalancesSummary';

export type BalanceSummary = {
  // Some indexer payloads nest balances per chain; we keep this loose.
  [k: string]: any;
};

function getIndexerAccessKey(): string | undefined {
  // New name (chain-agnostic)
  const k = (import.meta.env.VITE_INDEXER_ACCESS_KEY as string | undefined) || undefined;
  if (k) return k;

  // Back-compat: older env var name
  return (import.meta.env.VITE_POLYGON_INDEXER_ACCESS_KEY as string | undefined) || undefined;
}

export function resolveChainId(params: URLSearchParams): number {
  const chainIdRaw = params.get('chainId');
  if (chainIdRaw) {
    const n = Number(chainIdRaw);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid chainId=${chainIdRaw}`);
    return n;
  }

  const chainName = (params.get('chain') || 'polygon').toLowerCase();
  const net = Network.getNetworkFromName(chainName);
  if (!net) throw new Error(`Unsupported chain name: ${chainName}`);
  return net.chainId;
}

export function resolveNetwork(chainId: number) {
  const net = Network.getNetworkFromChainId(chainId);
  if (!net) throw new Error(`Unsupported chainId: ${chainId}`);
  return net;
}

export async function fetchBalancesAllChains(walletAddress: string): Promise<BalanceSummary> {
  const accessKey = getIndexerAccessKey();
  if (!accessKey) throw new Error('Missing indexer access key (set VITE_INDEXER_ACCESS_KEY)');

  const url = (import.meta.env.VITE_INDEXER_URL as string | undefined) || DEFAULT_INDEXER_URL;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Access-Key': accessKey
    },
    body: JSON.stringify({
      // NOTE: omit chainID to fetch balances for all supported chains.
      omitMetadata: false,
      filter: {
        contractStatus: 'VERIFIED',
        accountAddresses: [walletAddress]
      }
    })
  });

  if (!res.ok) throw new Error(`Indexer error: ${res.status}`);
  return res.json();
}

// Attempts to extract the per-chain entry from a multi-chain indexer response.
export function pickChainBalances(all: any, chainId: number): any {
  if (!all) return null;

  // Observed shapes vary; try common ones.
  const candidates = [
    all?.chains?.[String(chainId)],
    all?.chains?.[chainId],
    all?.byChainId?.[String(chainId)],
    all?.byChainId?.[chainId],
    all?.results?.[String(chainId)],
    all?.results?.[chainId]
  ];
  for (const c of candidates) {
    if (c) return c;
  }

  // Some APIs return an array of chain entries.
  const arr = all?.chainBalances || all?.chains || all?.results;
  if (Array.isArray(arr)) {
    const hit = arr.find(
      (x: any) => String(x?.chainId) === String(chainId) || String(x?.chainID) === String(chainId)
    );
    if (hit) return hit;
  }

  // Fallback: if response already is a single-chain summary, return it.
  if (all?.balances || all?.nativeBalances) return all;

  return null;
}
