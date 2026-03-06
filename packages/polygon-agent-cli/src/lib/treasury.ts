import { SequenceIndexer } from '@0xsequence/indexer';

import type { StrategyPolicy, TreasurySnapshot, ValidationResult } from './policy.ts';

import { summarizePnl } from './performance.ts';
import {
  getOpenOrders,
  getPolymarketProxyWalletAddress,
  getPositions,
  USDC_E
} from './polymarket.ts';
import { loadPolymarketKey, loadWalletSession } from './storage.ts';
import { formatUnits, resolveNetwork } from './utils.ts';

function parseNumberLike(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function getSessionHealth(explicitSessionRaw: string | null | undefined, stopOnMinutes: number) {
  if (!explicitSessionRaw) {
    return {
      hasSession: false,
      expiresAt: null,
      expiresInMinutes: null,
      isExpiringSoon: true
    };
  }
  try {
    const parsed = JSON.parse(explicitSessionRaw);
    const deadline = parseNumberLike(parsed?.config?.deadline);
    if (!deadline) {
      return {
        hasSession: true,
        expiresAt: null,
        expiresInMinutes: null,
        isExpiringSoon: false
      };
    }
    const expiresAt = new Date(deadline * 1000).toISOString();
    const expiresInMinutes = Math.floor((deadline * 1000 - Date.now()) / 60000);
    return {
      hasSession: true,
      expiresAt,
      expiresInMinutes,
      isExpiringSoon: expiresInMinutes <= stopOnMinutes
    };
  } catch {
    return {
      hasSession: true,
      expiresAt: null,
      expiresInMinutes: null,
      isExpiringSoon: false
    };
  }
}

function estimateOpenOrdersUsd(orders: unknown): number {
  if (!Array.isArray(orders)) return 0;
  return orders.reduce((sum, order) => {
    const item = order as Record<string, unknown>;
    const amount = parseNumberLike(item.amount ?? item.size);
    const price = parseNumberLike(item.price ?? item.avgPrice);
    return sum + amount * (price || 1);
  }, 0);
}

function estimateExposureUsd(positions: unknown): number {
  if (!Array.isArray(positions)) return 0;
  return positions.reduce((sum, position) => {
    const item = position as Record<string, unknown>;
    const size = parseNumberLike(item.size ?? item.amount ?? item.balance);
    const avgPrice = parseNumberLike(item.avgPrice ?? item.initialValue ?? item.curPrice);
    return sum + (avgPrice ? size * avgPrice : size);
  }, 0);
}

export async function getTreasurySnapshot({
  walletName,
  policy
}: {
  walletName: string;
  policy: StrategyPolicy;
}): Promise<TreasurySnapshot> {
  const session = await loadWalletSession(walletName);
  if (!session) throw new Error(`Wallet not found: ${walletName}`);

  const network = resolveNetwork(session.chain || 'polygon');
  const accessKey =
    session.projectAccessKey ||
    process.env.SEQUENCE_INDEXER_ACCESS_KEY ||
    process.env.SEQUENCE_PROJECT_ACCESS_KEY;
  if (!accessKey) {
    throw new Error('Missing project/indexer access key for treasury snapshot');
  }

  const indexer = new SequenceIndexer(`https://${network.name}-indexer.sequence.app`, accessKey);
  const [nativeRes, tokenRes] = await Promise.all([
    indexer.getNativeTokenBalance({ accountAddress: session.walletAddress }),
    indexer.getTokenBalances({ accountAddress: session.walletAddress, includeMetadata: true })
  ]);

  const smartWalletBalances: TreasurySnapshot['smartWalletBalances'] = [
    {
      type: 'native',
      symbol: network.nativeToken?.symbol || 'NATIVE',
      balance: formatUnits(nativeRes?.balance?.balance || '0', network.nativeToken?.decimals ?? 18),
      usdValue: null
    }
  ];

  for (const token of tokenRes?.balances || []) {
    smartWalletBalances.push({
      type: 'erc20',
      symbol: token.contractInfo?.symbol || 'ERC20',
      contractAddress: token.contractAddress,
      balance: formatUnits(token.balance || '0', token.contractInfo?.decimals ?? 18),
      usdValue:
        token.contractAddress?.toLowerCase() === USDC_E.toLowerCase()
          ? parseNumberLike(formatUnits(token.balance || '0', token.contractInfo?.decimals ?? 6))
          : null
    });
  }

  let proxyWalletAddress: string | null = null;
  let positions: unknown[] = [];
  let orders: unknown[] = [];
  try {
    const privateKey = await loadPolymarketKey();
    const { privateKeyToAccount } = await import('viem/accounts');
    proxyWalletAddress = await getPolymarketProxyWalletAddress(
      privateKeyToAccount(privateKey as `0x${string}`).address
    );
    [positions, orders] = await Promise.all([
      getPositions(proxyWalletAddress),
      getOpenOrders(privateKey)
    ]);
  } catch {
    proxyWalletAddress = null;
  }

  const proxyWalletBalanceUsd = smartWalletBalances
    .filter((balance) => balance.contractAddress?.toLowerCase() === USDC_E.toLowerCase())
    .reduce((sum, balance) => sum + (balance.usdValue || 0), 0);
  const openOrdersUsd = estimateOpenOrdersUsd(orders);
  const openExposureUsd = estimateExposureUsd(positions);
  const { realizedPnlUsd } = summarizePnl();
  const sessionHealth = getSessionHealth(
    session.explicitSession,
    policy.risk.stopOnSessionExpiryMinutes
  );
  const deployableUsd = Math.max(
    0,
    proxyWalletBalanceUsd +
      smartWalletBalances.reduce((sum, balance) => sum + (balance.usdValue || 0), 0) -
      policy.risk.reserveFloorUsd -
      openOrdersUsd
  );

  return {
    walletAddress: session.walletAddress,
    smartWalletBalances,
    proxyWalletAddress,
    proxyWalletBalanceUsd,
    reservedUsd: openOrdersUsd,
    deployableUsd,
    reserveFloorUsd: policy.risk.reserveFloorUsd,
    openExposureUsd,
    openOrdersUsd,
    realizedPnlUsd,
    unrealizedPnlUsd: 0,
    valuationStatus: smartWalletBalances.some((balance) => balance.usdValue == null)
      ? 'partial'
      : 'complete',
    sessionHealth
  };
}

export function evaluateTreasuryLimits({
  snapshot,
  policy,
  amountUsd,
  currentMarketExposureUsd = 0,
  openPositionsCount = 0,
  openOrdersCount = 0
}: {
  snapshot: TreasurySnapshot;
  policy: StrategyPolicy;
  amountUsd: number;
  currentMarketExposureUsd?: number;
  openPositionsCount?: number;
  openOrdersCount?: number;
}): ValidationResult[] {
  const results: ValidationResult[] = [];
  results.push({
    code: 'reserve-floor',
    ok: snapshot.deployableUsd >= amountUsd,
    message:
      snapshot.deployableUsd >= amountUsd
        ? 'Deployable capital covers proposed allocation'
        : `Deployable capital ${snapshot.deployableUsd.toFixed(2)} is below requested ${amountUsd.toFixed(2)}`
  });
  results.push({
    code: 'per-market-exposure',
    ok: currentMarketExposureUsd + amountUsd <= policy.risk.maxPerMarketExposureUsd,
    message:
      currentMarketExposureUsd + amountUsd <= policy.risk.maxPerMarketExposureUsd
        ? 'Per-market exposure within limit'
        : `Per-market exposure would exceed ${policy.risk.maxPerMarketExposureUsd}`
  });
  results.push({
    code: 'concurrent-positions',
    ok: openPositionsCount < policy.risk.maxConcurrentPositions,
    message:
      openPositionsCount < policy.risk.maxConcurrentPositions
        ? 'Concurrent positions within limit'
        : `Concurrent positions exceed ${policy.risk.maxConcurrentPositions}`
  });
  results.push({
    code: 'open-orders',
    ok: openOrdersCount < policy.risk.maxOpenOrders,
    message:
      openOrdersCount < policy.risk.maxOpenOrders
        ? 'Open orders within limit'
        : `Open orders exceed ${policy.risk.maxOpenOrders}`
  });
  results.push({
    code: 'session-health',
    ok: !snapshot.sessionHealth.isExpiringSoon,
    message: snapshot.sessionHealth.isExpiringSoon
      ? 'Session expiry is too close for autonomous execution'
      : 'Session health acceptable'
  });
  return results;
}
