import fs from 'node:fs';

import { getStoragePath, ensureStorageSubdirs } from './storage.ts';

export interface TradeLedgerEntry {
  timestamp: string;
  type: 'buy' | 'sell' | 'rebalance';
  strategy?: string;
  planId?: string;
  conditionId?: string;
  question?: string;
  side?: 'YES' | 'NO';
  amountUsd?: number;
  proceedsUsd?: number;
  feesUsd?: number;
  realizedPnlUsd?: number;
  txHash?: string | null;
  orderId?: string | null;
}

function ledgerPath(): string {
  ensureStorageSubdirs(['performance']);
  return getStoragePath('performance', 'trades.jsonl');
}

export function appendTradeLedger(entry: TradeLedgerEntry): void {
  fs.appendFileSync(ledgerPath(), `${JSON.stringify(entry)}\n`, 'utf8');
}

export function readTradeLedger(): TradeLedgerEntry[] {
  const fp = ledgerPath();
  if (!fs.existsSync(fp)) return [];
  return fs
    .readFileSync(fp, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TradeLedgerEntry);
}

export function summarizePnl(filterDays?: number) {
  const now = Date.now();
  const cutoff = filterDays ? now - filterDays * 24 * 60 * 60 * 1000 : null;
  const entries = readTradeLedger().filter((entry) => {
    if (!cutoff) return true;
    return Date.parse(entry.timestamp) >= cutoff;
  });

  let realizedPnlUsd = 0;
  let feesUsd = 0;
  let wins = 0;
  let losses = 0;
  let totalTradeAmount = 0;
  let tradeCount = 0;
  const byStrategy = new Map<string, number>();
  const byMarket = new Map<string, number>();

  for (const entry of entries) {
    realizedPnlUsd += entry.realizedPnlUsd || 0;
    feesUsd += entry.feesUsd || 0;
    if (entry.realizedPnlUsd != null) {
      if (entry.realizedPnlUsd > 0) wins += 1;
      else if (entry.realizedPnlUsd < 0) losses += 1;
    }
    if (entry.amountUsd) {
      totalTradeAmount += entry.amountUsd;
      tradeCount += 1;
    }
    if (entry.strategy) {
      byStrategy.set(
        entry.strategy,
        (byStrategy.get(entry.strategy) || 0) + (entry.realizedPnlUsd || 0)
      );
    }
    if (entry.conditionId) {
      byMarket.set(
        entry.conditionId,
        (byMarket.get(entry.conditionId) || 0) + (entry.realizedPnlUsd || 0)
      );
    }
  }

  return {
    entries,
    realizedPnlUsd,
    feesUsd,
    winCount: wins,
    lossCount: losses,
    averageTradeUsd: tradeCount ? totalTradeAmount / tradeCount : 0,
    byStrategy: Object.fromEntries(byStrategy),
    byMarket: Object.fromEntries(byMarket)
  };
}
