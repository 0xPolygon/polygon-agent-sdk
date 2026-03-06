import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { randomHex } from './utils.ts';

export type StrategySide = 'YES' | 'NO' | 'SKIP';
export type BiasMode = 'yes' | 'no' | 'auto';
export type CliJobType =
  | 'scan-markets'
  | 'signal-markets'
  | 'plan-trades'
  | 'execute-plan'
  | 'treasury-status'
  | 'treasury-rebalance'
  | 'session-health'
  | 'session-refresh-check';

export interface CliJobSpec {
  version: 1;
  name: string;
  enabled: boolean;
  type: CliJobType;
  policyFile?: string;
  wallet?: string;
  intervalSeconds?: number;
  nextRunAt?: string;
  maxRuns?: number;
}

export interface StrategyPolicy {
  version: 1;
  name: string;
  wallet: string;
  marketUniverse: {
    search: string | null;
    minVolume24hrUsd: number;
    maxDaysToEnd: number;
    includeNegRisk: boolean;
  };
  signalRules: {
    minEdgeBps: number;
    minConfidenceScore: number;
    yesNoBias: BiasMode;
    requireOrderbookLiquidityUsd: number;
  };
  sizing: {
    method: 'fixed_fraction';
    perTradeFraction: number;
    maxTradeUsd: number;
  };
  risk: {
    reserveFloorUsd: number;
    maxDailyLossUsd: number;
    maxPerMarketExposureUsd: number;
    maxConcurrentPositions: number;
    maxOpenOrders: number;
    maxSlippageBps: number;
    stopOnSessionExpiryMinutes: number;
  };
  treasury: {
    targetProxyWalletUsd: number;
    maxProxyWalletIdleUsd: number;
  };
  automation: {
    jobs: CliJobSpec[];
  };
}

export interface TreasurySnapshot {
  walletAddress: string;
  smartWalletBalances: Array<{
    type: 'native' | 'erc20';
    symbol: string;
    balance: string;
    contractAddress?: string;
    usdValue?: number | null;
  }>;
  proxyWalletAddress: string | null;
  proxyWalletBalanceUsd: number;
  reservedUsd: number;
  deployableUsd: number;
  reserveFloorUsd: number;
  openExposureUsd: number;
  openOrdersUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  valuationStatus: 'complete' | 'partial';
  sessionHealth: {
    hasSession: boolean;
    expiresAt: string | null;
    expiresInMinutes: number | null;
    isExpiringSoon: boolean;
  };
}

export interface StrategySignal {
  conditionId: string;
  question: string;
  recommendedSide: StrategySide;
  signalScore: number;
  confidence: number;
  priceReference: number | null;
  liquidityScore: number;
  volume24hrUsd: number;
  rationale: string[];
  rejected: boolean;
  rejectionReasons: string[];
  treasuryCompatibility: {
    allowed: boolean;
    reasons: string[];
  };
}

export interface ValidationResult {
  code: string;
  ok: boolean;
  message: string;
}

export interface PlannedTrade {
  planTradeId: string;
  conditionId: string;
  question: string;
  side: Exclude<StrategySide, 'SKIP'>;
  orderType: 'market';
  amountUsd: number;
  tokenId: string;
  priceReference: number | null;
  rationale: string[];
  validation: ValidationResult[];
}

export interface TradePlan {
  version: 1;
  planId: string;
  policyName: string;
  walletName: string;
  generatedAt: string;
  trades: PlannedTrade[];
  treasurySnapshot: TreasurySnapshot;
  validation: ValidationResult[];
}

const DEFAULT_POLICY: StrategyPolicy = {
  version: 1,
  name: 'default-polymarket-policy',
  wallet: 'main',
  marketUniverse: {
    search: null,
    minVolume24hrUsd: 50000,
    maxDaysToEnd: 14,
    includeNegRisk: false
  },
  signalRules: {
    minEdgeBps: 300,
    minConfidenceScore: 0.65,
    yesNoBias: 'auto',
    requireOrderbookLiquidityUsd: 1000
  },
  sizing: {
    method: 'fixed_fraction',
    perTradeFraction: 0.05,
    maxTradeUsd: 100
  },
  risk: {
    reserveFloorUsd: 200,
    maxDailyLossUsd: 50,
    maxPerMarketExposureUsd: 100,
    maxConcurrentPositions: 5,
    maxOpenOrders: 10,
    maxSlippageBps: 100,
    stopOnSessionExpiryMinutes: 30
  },
  treasury: {
    targetProxyWalletUsd: 150,
    maxProxyWalletIdleUsd: 300
  },
  automation: {
    jobs: []
  }
};

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

function parseYamlObject(
  lines: string[],
  startIndex: number,
  indent: number
): [Record<string, unknown>, number] {
  const out: Record<string, unknown> = {};
  let i = startIndex;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) {
      i += 1;
      continue;
    }
    const currentIndent = raw.match(/^ */)?.[0].length ?? 0;
    if (currentIndent < indent) break;
    if (currentIndent > indent) {
      throw new Error(`Invalid YAML indentation near line ${i + 1}`);
    }
    const line = raw.trim();
    if (line.startsWith('- ')) {
      throw new Error(`Unexpected YAML list item near line ${i + 1}`);
    }
    const idx = line.indexOf(':');
    if (idx <= 0) throw new Error(`Invalid YAML entry near line ${i + 1}`);
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    if (!rest) {
      const next = lines[i + 1];
      if (!next) {
        out[key] = {};
        i += 1;
        continue;
      }
      const nextIndent = next.match(/^ */)?.[0].length ?? 0;
      if (next.trim().startsWith('- ')) {
        const [arr, nextIndex] = parseYamlArray(lines, i + 1, indent + 2);
        out[key] = arr;
        i = nextIndex;
        continue;
      }
      if (nextIndent <= indent) {
        out[key] = {};
        i += 1;
        continue;
      }
      const [obj, nextIndex] = parseYamlObject(lines, i + 1, indent + 2);
      out[key] = obj;
      i = nextIndex;
      continue;
    }
    out[key] = parseScalar(rest);
    i += 1;
  }
  return [out, i];
}

function parseYamlArray(lines: string[], startIndex: number, indent: number): [unknown[], number] {
  const out: unknown[] = [];
  let i = startIndex;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim() || raw.trim().startsWith('#')) {
      i += 1;
      continue;
    }
    const currentIndent = raw.match(/^ */)?.[0].length ?? 0;
    if (currentIndent < indent) break;
    if (currentIndent !== indent || !raw.trim().startsWith('- ')) {
      break;
    }
    const itemText = raw.trim().slice(2).trim();
    if (!itemText) {
      const [obj, nextIndex] = parseYamlObject(lines, i + 1, indent + 2);
      out.push(obj);
      i = nextIndex;
      continue;
    }
    if (itemText.includes(':')) {
      const synthetic = `${' '.repeat(indent + 2)}${itemText}`;
      const nestedLines = [synthetic];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j];
        const nextIndent = next.match(/^ */)?.[0].length ?? 0;
        if (nextIndent <= indent) break;
        nestedLines.push(next);
        j += 1;
      }
      const [obj] = parseYamlObject(nestedLines, 0, indent + 2);
      out.push(obj);
      i = j;
      continue;
    }
    out.push(parseScalar(itemText));
    i += 1;
  }
  return [out, i];
}

function parseYaml(text: string): unknown {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const [parsed] = parseYamlObject(lines, 0, 0);
  return parsed;
}

function deepMerge<T>(base: T, override: unknown): T {
  if (Array.isArray(base)) {
    return (Array.isArray(override) ? override : base) as unknown as T;
  }
  if (typeof base !== 'object' || base === null) {
    return (override ?? base) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  const source =
    typeof override === 'object' && override !== null ? (override as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(source)) {
    const baseValue = out[key];
    if (
      baseValue &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      out[key] = deepMerge(baseValue as Record<string, unknown>, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

function assertPolicy(policy: StrategyPolicy): void {
  if (policy.version !== 1) throw new Error('Policy version must be 1');
  if (!policy.name) throw new Error('Policy name is required');
  if (!policy.wallet) throw new Error('Policy wallet is required');
  if (policy.sizing.method !== 'fixed_fraction') {
    throw new Error('Only sizing.method=fixed_fraction is supported');
  }
  if (policy.sizing.perTradeFraction <= 0 || policy.sizing.perTradeFraction > 1) {
    throw new Error('sizing.perTradeFraction must be between 0 and 1');
  }
  if (policy.signalRules.minConfidenceScore < 0 || policy.signalRules.minConfidenceScore > 1) {
    throw new Error('signalRules.minConfidenceScore must be between 0 and 1');
  }
}

export function policyStorageRoot(): string {
  return path.join(os.homedir(), '.polygon-agent');
}

export function resolvePolicyPath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  if (filePath.startsWith('~')) return path.join(os.homedir(), filePath.slice(1));
  const candidate = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(candidate)) return candidate;
  return path.join(policyStorageRoot(), 'policies', filePath);
}

export function loadPolicy(policyPath: string): StrategyPolicy {
  const resolved = resolvePolicyPath(policyPath);
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = resolved.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
  const merged = deepMerge(DEFAULT_POLICY, parsed) as StrategyPolicy;
  merged.automation.jobs = Array.isArray(merged.automation.jobs) ? merged.automation.jobs : [];
  assertPolicy(merged);
  return merged;
}

export function defaultPolicy(): StrategyPolicy {
  return JSON.parse(JSON.stringify(DEFAULT_POLICY)) as StrategyPolicy;
}

export function newPlanId(): string {
  return `plan-${Date.now()}-${randomHex(4)}`;
}

export function normalizeJobSpec(
  input: Partial<CliJobSpec> & Pick<CliJobSpec, 'name' | 'type'>
): CliJobSpec {
  return {
    version: 1,
    name: input.name,
    type: input.type,
    enabled: input.enabled ?? true,
    policyFile: input.policyFile,
    wallet: input.wallet,
    intervalSeconds: input.intervalSeconds,
    nextRunAt: input.nextRunAt,
    maxRuns: input.maxRuns
  };
}
