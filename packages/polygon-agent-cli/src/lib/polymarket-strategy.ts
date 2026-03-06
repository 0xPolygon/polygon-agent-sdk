import fs from 'node:fs';

import type {
  PlannedTrade,
  StrategyPolicy,
  StrategySignal,
  TradePlan,
  ValidationResult
} from './policy.ts';

import { appendTradeLedger } from './performance.ts';
import { newPlanId } from './policy.ts';
import {
  createAndPostMarketOrder,
  getMarket,
  getMarkets,
  getOpenOrders,
  getOrderBook,
  getPolymarketProxyWalletAddress,
  getPositions
} from './polymarket.ts';
import { loadPolymarketKey } from './storage.ts';
import { evaluateTreasuryLimits, getTreasurySnapshot } from './treasury.ts';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function daysUntil(dateValue: string | null): number | null {
  if (!dateValue) return null;
  const ms = Date.parse(dateValue) - Date.now();
  if (!Number.isFinite(ms)) return null;
  return ms / (24 * 60 * 60 * 1000);
}

async function computeLiquidityUsd(tokenId: string | null): Promise<number> {
  if (!tokenId) return 0;
  try {
    const book = await getOrderBook(tokenId);
    const asks = Array.isArray(book?.asks) ? book.asks : [];
    const bids = Array.isArray(book?.bids) ? book.bids : [];
    const all = [...asks, ...bids];
    return all.reduce((sum, level) => {
      const price = Number(level?.price || 0);
      const size = Number(level?.size || 0);
      return sum + price * size;
    }, 0);
  } catch {
    return 0;
  }
}

export async function scanMarkets({
  policy,
  search,
  limit,
  minVolume,
  maxDaysToEnd,
  includeNegRisk
}: {
  policy: StrategyPolicy;
  search?: string;
  limit?: number;
  minVolume?: number;
  maxDaysToEnd?: number;
  includeNegRisk?: boolean;
}) {
  const markets = await getMarkets({
    search: search ?? policy.marketUniverse.search ?? undefined,
    limit: limit ?? 20
  });

  const eligible = [];
  const rejected = [];
  const minVol = minVolume ?? policy.marketUniverse.minVolume24hrUsd;
  const maxDays = maxDaysToEnd ?? policy.marketUniverse.maxDaysToEnd;
  const allowNegRisk = includeNegRisk ?? policy.marketUniverse.includeNegRisk;

  for (const market of markets) {
    const reasons: string[] = [];
    if (market.volume24hr < minVol) reasons.push(`volume24hr below ${minVol}`);
    const remainingDays = daysUntil(market.endDate);
    if (remainingDays != null && remainingDays > maxDays) {
      reasons.push(`daysToEnd exceeds ${maxDays}`);
    }
    if (market.negRisk && !allowNegRisk) reasons.push('neg-risk market disabled by policy');
    if (!market.yesTokenId || !market.noTokenId) reasons.push('market missing token ids');

    const entry = {
      conditionId: market.conditionId,
      question: market.question,
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
      volume24hrUsd: market.volume24hr,
      negRisk: market.negRisk,
      endDate: market.endDate,
      rejectionReasons: reasons
    };
    if (reasons.length) rejected.push(entry);
    else eligible.push(entry);
  }

  eligible.sort((a, b) => b.volume24hrUsd - a.volume24hrUsd);
  return {
    ok: true,
    policy: policy.name,
    eligible,
    rejected
  };
}

export async function signalMarket({
  policy,
  conditionId,
  side = 'AUTO',
  walletName
}: {
  policy: StrategyPolicy;
  conditionId: string;
  side?: 'YES' | 'NO' | 'AUTO';
  walletName: string;
}): Promise<StrategySignal> {
  const market = await getMarket(conditionId);
  const chosenSide =
    side === 'AUTO'
      ? policy.signalRules.yesNoBias === 'yes'
        ? 'YES'
        : policy.signalRules.yesNoBias === 'no'
          ? 'NO'
          : (market.yesPrice ?? 0) <= (market.noPrice ?? 0)
            ? 'YES'
            : 'NO'
      : side;

  const tokenId = chosenSide === 'YES' ? market.yesTokenId : market.noTokenId;
  const priceReference = chosenSide === 'YES' ? market.yesPrice : market.noPrice;
  const liquidityUsd = await computeLiquidityUsd(tokenId);
  const rationale: string[] = [];
  const rejectionReasons: string[] = [];

  const priceScore =
    priceReference == null ? 0 : clamp01((0.5 - Math.abs(0.5 - priceReference)) * 2);
  const volumeScore = clamp01(
    market.volume24hr / Math.max(policy.marketUniverse.minVolume24hrUsd * 2, 1)
  );
  const liquidityScore = clamp01(
    liquidityUsd / Math.max(policy.signalRules.requireOrderbookLiquidityUsd * 2, 1)
  );
  const confidence = clamp01((priceScore + volumeScore + liquidityScore) / 3);
  const signalScore = Number((confidence * 100).toFixed(2));

  if (market.volume24hr < policy.marketUniverse.minVolume24hrUsd) {
    rejectionReasons.push('volume below policy threshold');
  } else {
    rationale.push('volume exceeds minimum threshold');
  }
  if (liquidityUsd < policy.signalRules.requireOrderbookLiquidityUsd) {
    rejectionReasons.push('orderbook liquidity below threshold');
  } else {
    rationale.push('orderbook liquidity acceptable');
  }
  if (market.negRisk && !policy.marketUniverse.includeNegRisk) {
    rejectionReasons.push('neg-risk market disabled');
  }
  if (confidence < policy.signalRules.minConfidenceScore) {
    rejectionReasons.push('confidence below threshold');
  } else {
    rationale.push(`confidence ${confidence.toFixed(2)} exceeds minimum`);
  }

  const snapshot = await getTreasurySnapshot({ walletName, policy });
  const treasuryCompatibility = evaluateTreasuryLimits({
    snapshot,
    policy,
    amountUsd: Math.min(snapshot.deployableUsd, policy.sizing.maxTradeUsd)
  });

  return {
    conditionId: market.conditionId,
    question: market.question,
    recommendedSide: rejectionReasons.length ? 'SKIP' : chosenSide,
    signalScore,
    confidence,
    priceReference: priceReference ?? null,
    liquidityScore,
    volume24hrUsd: market.volume24hr,
    rationale,
    rejected: rejectionReasons.length > 0,
    rejectionReasons,
    treasuryCompatibility: {
      allowed: treasuryCompatibility.every((item) => item.ok),
      reasons: treasuryCompatibility.filter((item) => !item.ok).map((item) => item.message)
    }
  };
}

export async function buildTradePlan({
  policy,
  walletName,
  signals,
  maxTrades
}: {
  policy: StrategyPolicy;
  walletName: string;
  signals: StrategySignal[];
  maxTrades?: number;
}): Promise<TradePlan> {
  const snapshot = await getTreasurySnapshot({ walletName, policy });
  const privateKey = await loadPolymarketKey();
  const { privateKeyToAccount } = await import('viem/accounts');
  const proxyWalletAddress = await getPolymarketProxyWalletAddress(
    privateKeyToAccount(privateKey as `0x${string}`).address
  );
  const [positions, orders] = await Promise.all([
    getPositions(proxyWalletAddress),
    getOpenOrders(privateKey)
  ]);
  const openPositionsCount = Array.isArray(positions) ? positions.length : 0;
  const openOrdersCount = Array.isArray(orders) ? orders.length : 0;

  const sorted = [...signals]
    .filter(
      (signal): signal is StrategySignal & { recommendedSide: 'YES' | 'NO' } =>
        !signal.rejected && signal.recommendedSide !== 'SKIP'
    )
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, maxTrades ?? Number.MAX_SAFE_INTEGER);

  const trades: PlannedTrade[] = [];
  const validation: ValidationResult[] = [];
  for (const signal of sorted) {
    const market = await getMarket(signal.conditionId);
    const tokenId = signal.recommendedSide === 'YES' ? market.yesTokenId : market.noTokenId;
    if (!tokenId) {
      validation.push({
        code: 'missing-token-id',
        ok: false,
        message: `Market ${signal.conditionId} is missing token id for ${signal.recommendedSide}`
      });
      continue;
    }
    const candidateAmount = Math.min(
      snapshot.deployableUsd * policy.sizing.perTradeFraction,
      policy.sizing.maxTradeUsd
    );
    const perTradeValidation = evaluateTreasuryLimits({
      snapshot,
      policy,
      amountUsd: candidateAmount,
      currentMarketExposureUsd: 0,
      openOrdersCount,
      openPositionsCount
    });
    if (!perTradeValidation.every((item) => item.ok)) {
      validation.push(...perTradeValidation.filter((item) => !item.ok));
      continue;
    }
    trades.push({
      planTradeId: `${newPlanId()}-${trades.length + 1}`,
      conditionId: signal.conditionId,
      question: signal.question,
      side: signal.recommendedSide,
      orderType: 'market',
      amountUsd: Number(candidateAmount.toFixed(2)),
      tokenId,
      priceReference: signal.priceReference,
      rationale: signal.rationale,
      validation: perTradeValidation
    });
  }

  if (!trades.length) {
    validation.push({
      code: 'no-trades',
      ok: false,
      message: 'No eligible trades satisfied policy and treasury constraints'
    });
  }

  return {
    version: 1,
    planId: newPlanId(),
    policyName: policy.name,
    walletName,
    generatedAt: new Date().toISOString(),
    trades,
    treasurySnapshot: snapshot,
    validation
  };
}

export function saveTradePlan(plan: TradePlan, destinationPath: string): void {
  fs.writeFileSync(destinationPath, JSON.stringify(plan, null, 2), 'utf8');
}

export async function executeTradePlan({
  plan,
  allowPartial,
  broadcast
}: {
  plan: TradePlan;
  allowPartial: boolean;
  broadcast: boolean;
}) {
  const privateKey = await loadPolymarketKey();
  const { privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const proxyWalletAddress = await getPolymarketProxyWalletAddress(account.address);

  const results = [];
  for (const trade of plan.trades) {
    const market = await getMarket(trade.conditionId);
    const side = trade.side;
    const recommendedPrice = side === 'YES' ? market.yesPrice : market.noPrice;
    if (!broadcast) {
      results.push({
        tradeId: trade.planTradeId,
        conditionId: trade.conditionId,
        ok: true,
        dryRun: true,
        amountUsd: trade.amountUsd,
        proxyWalletAddress,
        action: `BUY ${side}`
      });
      continue;
    }
    try {
      const orderResult = await createAndPostMarketOrder({
        tokenId: trade.tokenId,
        side: 'BUY',
        amount: trade.amountUsd,
        orderType: 'FOK',
        privateKey,
        proxyWalletAddress
      });
      appendTradeLedger({
        timestamp: new Date().toISOString(),
        type: 'buy',
        strategy: plan.policyName,
        planId: plan.planId,
        conditionId: trade.conditionId,
        question: trade.question,
        side: trade.side,
        amountUsd: trade.amountUsd,
        feesUsd: 0,
        realizedPnlUsd: 0,
        orderId: orderResult?.orderId || orderResult?.orderID || orderResult?.id || null
      });
      results.push({
        tradeId: trade.planTradeId,
        conditionId: trade.conditionId,
        ok: true,
        amountUsd: trade.amountUsd,
        proxyWalletAddress,
        orderId: orderResult?.orderId || orderResult?.orderID || orderResult?.id || null,
        priceReference: recommendedPrice ?? trade.priceReference
      });
    } catch (error) {
      results.push({
        tradeId: trade.planTradeId,
        conditionId: trade.conditionId,
        ok: false,
        error: (error as Error).message
      });
      if (!allowPartial) break;
    }
  }
  return results;
}
