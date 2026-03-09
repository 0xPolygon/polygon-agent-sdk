import fs from 'node:fs';
import path from 'node:path';

import type {
  BettingPlan,
  BettingPlanStep,
  PlanExecutionResult,
  PlanStepResult,
  PlanValidationResult,
  StrategyPolicy,
  ValidationResult
} from './policy.ts';

import { runDappClientTx } from './dapp-client.ts';
import { appendTradeLedger } from './performance.ts';
import { defaultPolicy } from './policy.ts';
import {
  cancelOrder,
  createAndPostMarketOrder,
  createAndPostOrder,
  getMarket,
  getOrderBook,
  getPolymarketProxyWalletAddress,
  USDC_E
} from './polymarket.ts';
import { ensureStorageSubdirs, getStoragePath, loadPolymarketKey } from './storage.ts';
import { getTreasurySnapshot } from './treasury.ts';

function hasObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function loadBettingPlan(planPath: string): BettingPlan {
  const raw = fs.readFileSync(path.resolve(planPath), 'utf8');
  return JSON.parse(raw) as BettingPlan;
}

function validateStepShape(step: unknown, index: number, errors: string[]): BettingPlanStep | null {
  if (!hasObject(step)) {
    errors.push(`steps[${index}] must be an object`);
    return null;
  }
  const id = step.id;
  const type = step.type;
  if (typeof id !== 'string' || !id.trim())
    errors.push(`steps[${index}].id must be a non-empty string`);
  const allowed = new Set([
    'assert',
    'read',
    'fund_proxy',
    'place_order',
    'cancel_order',
    'rebalance',
    'checkpoint'
  ]);
  if (typeof type !== 'string' || !allowed.has(type)) {
    errors.push(`steps[${index}].type is invalid`);
  }
  return {
    id: String(id || ''),
    type: (type as BettingPlanStep['type']) || 'checkpoint',
    description: typeof step.description === 'string' ? step.description : undefined,
    payload: hasObject(step.payload) ? step.payload : {}
  };
}

function policyForPlan(plan: BettingPlan): StrategyPolicy {
  const base = defaultPolicy();
  base.wallet = plan.wallet;
  if (plan.constraints?.reserveFloorUsd != null)
    base.risk.reserveFloorUsd = plan.constraints.reserveFloorUsd;
  if (plan.constraints?.maxOpenOrders != null)
    base.risk.maxOpenOrders = plan.constraints.maxOpenOrders;
  if (plan.constraints?.maxPerMarketExposureUsd != null) {
    base.risk.maxPerMarketExposureUsd = plan.constraints.maxPerMarketExposureUsd;
  }
  if (plan.constraints?.maxDailyLossUsd != null)
    base.risk.maxDailyLossUsd = plan.constraints.maxDailyLossUsd;
  return base;
}

export async function validateBettingPlan(plan: BettingPlan): Promise<PlanValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: ValidationResult[] = [];
  if (!plan || typeof plan !== 'object') {
    return {
      ok: false,
      planId: 'unknown',
      checks,
      blockingErrors: ['Plan must be an object'],
      warnings
    };
  }
  if (plan.version !== 1) errors.push('version must be 1');
  if (!plan.planId || typeof plan.planId !== 'string') errors.push('planId is required');
  if (!plan.wallet || typeof plan.wallet !== 'string') errors.push('wallet is required');
  if (!plan.objective || typeof plan.objective !== 'string') errors.push('objective is required');
  if (!Array.isArray(plan.steps) || !plan.steps.length)
    errors.push('steps must be a non-empty array');

  const parsedSteps = (plan.steps || [])
    .map((step, i) => validateStepShape(step, i, errors))
    .filter((step): step is BettingPlanStep => step != null);

  const stepIds = new Set<string>();
  for (const step of parsedSteps) {
    if (stepIds.has(step.id)) errors.push(`duplicate step id: ${step.id}`);
    stepIds.add(step.id);
  }

  if (!errors.length) {
    try {
      const policy = policyForPlan(plan);
      const snapshot = await getTreasurySnapshot({ walletName: plan.wallet, policy });
      checks.push({
        code: 'session-health',
        ok: !snapshot.sessionHealth.isExpiringSoon,
        message: snapshot.sessionHealth.isExpiringSoon
          ? 'Session is expiring soon'
          : 'Session health is acceptable'
      });
      if (snapshot.valuationStatus === 'partial') {
        warnings.push('Treasury valuation is partial; risk checks may be conservative');
      }
      for (const step of parsedSteps) {
        if (step.type !== 'assert') continue;
        const rule = String(step.payload?.rule || '');
        if (rule === 'deployable_gte') {
          const amount = parseNumber(step.payload?.amountUsd);
          if (amount == null) {
            errors.push(`assert step ${step.id} missing payload.amountUsd`);
            continue;
          }
          checks.push({
            code: `assert:${step.id}`,
            ok: snapshot.deployableUsd >= amount,
            message:
              snapshot.deployableUsd >= amount
                ? `deployableUsd >= ${amount}`
                : `deployableUsd ${snapshot.deployableUsd.toFixed(2)} < ${amount.toFixed(2)}`
          });
        } else if (rule === 'session_healthy') {
          checks.push({
            code: `assert:${step.id}`,
            ok: !snapshot.sessionHealth.isExpiringSoon,
            message: !snapshot.sessionHealth.isExpiringSoon
              ? 'session healthy'
              : 'session expiring too soon'
          });
        } else {
          warnings.push(`Unknown assert rule at step ${step.id}; it will be ignored`);
        }
      }
    } catch (error) {
      errors.push((error as Error).message);
    }
  }

  const checkFailures = checks.filter((check) => !check.ok).map((check) => check.message);
  const blockingErrors = [...errors, ...checkFailures];
  return {
    ok: blockingErrors.length === 0,
    planId: plan.planId || 'unknown',
    checks,
    blockingErrors,
    warnings
  };
}

export function explainBettingPlan(plan: BettingPlan) {
  const explain = (plan.steps || []).map((step, index) => ({
    stepId: step.id,
    type: step.type,
    description: step.description || null,
    dependsOn: index === 0 ? [] : [plan.steps[index - 1]?.id].filter(Boolean),
    payloadKeys: hasObject(step.payload) ? Object.keys(step.payload) : []
  }));
  return {
    planId: plan.planId,
    objective: plan.objective,
    wallet: plan.wallet,
    stepCount: explain.length,
    steps: explain
  };
}

function executionRecordPath(planId: string): string {
  ensureStorageSubdirs(['plans/executions']);
  return getStoragePath('plans', 'executions', `${planId}.json`);
}

async function getProxyWalletAddress(): Promise<string> {
  const privateKey = await loadPolymarketKey();
  const { privateKeyToAccount } = await import('viem/accounts');
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  return getPolymarketProxyWalletAddress(account.address);
}

async function executeStep({
  step,
  walletName,
  dryRun
}: {
  step: BettingPlanStep;
  walletName: string;
  dryRun: boolean;
}): Promise<PlanStepResult> {
  try {
    if (step.type === 'checkpoint') {
      return { stepId: step.id, type: step.type, ok: true, dryRun, output: { checkpoint: true } };
    }
    if (step.type === 'read') {
      const readType = String(step.payload?.target || '');
      if (readType === 'treasury_snapshot') {
        const policy = defaultPolicy();
        policy.wallet = walletName;
        const snapshot = await getTreasurySnapshot({ walletName, policy });
        return { stepId: step.id, type: step.type, ok: true, dryRun, output: snapshot };
      }
      if (readType === 'market') {
        const conditionId = String(step.payload?.conditionId || '');
        const market = await getMarket(conditionId);
        const yesBook = market.yesTokenId ? await getOrderBook(market.yesTokenId) : null;
        const noBook = market.noTokenId ? await getOrderBook(market.noTokenId) : null;
        return {
          stepId: step.id,
          type: step.type,
          ok: true,
          dryRun,
          output: { market, yesBook, noBook }
        };
      }
      return {
        stepId: step.id,
        type: step.type,
        ok: true,
        dryRun,
        output: { note: 'no-op read target' }
      };
    }
    if (step.type === 'assert') {
      const rule = String(step.payload?.rule || '');
      if (rule === 'deployable_gte') {
        const amount = parseNumber(step.payload?.amountUsd) ?? 0;
        const policy = defaultPolicy();
        policy.wallet = walletName;
        const snapshot = await getTreasurySnapshot({ walletName, policy });
        if (snapshot.deployableUsd < amount) {
          return {
            stepId: step.id,
            type: step.type,
            ok: false,
            dryRun,
            error: `deployableUsd ${snapshot.deployableUsd.toFixed(2)} < ${amount.toFixed(2)}`
          };
        }
        return {
          stepId: step.id,
          type: step.type,
          ok: true,
          dryRun,
          output: { deployableUsd: snapshot.deployableUsd }
        };
      }
      return {
        stepId: step.id,
        type: step.type,
        ok: true,
        dryRun,
        output: { note: 'assert rule ignored' }
      };
    }
    if (step.type === 'fund_proxy') {
      const amountUsd = parseNumber(step.payload?.amountUsd);
      if (amountUsd == null || amountUsd <= 0) {
        return {
          stepId: step.id,
          type: step.type,
          ok: false,
          dryRun,
          error: 'amountUsd must be > 0'
        };
      }
      const proxyWalletAddress = await getProxyWalletAddress();
      const amountUnits = BigInt(Math.round(amountUsd * 1e6));
      const pad = (hex: string, n = 64) => String(hex).replace(/^0x/, '').padStart(n, '0');
      const transferData =
        '0xa9059cbb' + pad(proxyWalletAddress) + pad('0x' + amountUnits.toString(16));
      if (dryRun) {
        return {
          stepId: step.id,
          type: step.type,
          ok: true,
          dryRun,
          output: { to: proxyWalletAddress, token: USDC_E, amountUsd }
        };
      }
      const tx = await runDappClientTx({
        walletName,
        chainId: 137,
        transactions: [{ to: USDC_E, value: 0n, data: transferData }],
        broadcast: true,
        preferNativeFee: false
      });
      return {
        stepId: step.id,
        type: step.type,
        ok: true,
        dryRun,
        output: { txHash: tx.txHash, amountUsd }
      };
    }
    if (step.type === 'place_order') {
      const conditionId = String(step.payload?.conditionId || '');
      const side = String(step.payload?.side || 'YES').toUpperCase();
      const amountUsd = parseNumber(step.payload?.amountUsd);
      const limitPrice = parseNumber(step.payload?.price);
      if (!conditionId)
        return {
          stepId: step.id,
          type: step.type,
          ok: false,
          dryRun,
          error: 'conditionId is required'
        };
      if (!['YES', 'NO'].includes(side)) {
        return {
          stepId: step.id,
          type: step.type,
          ok: false,
          dryRun,
          error: 'side must be YES or NO'
        };
      }
      if (amountUsd == null || amountUsd <= 0) {
        return {
          stepId: step.id,
          type: step.type,
          ok: false,
          dryRun,
          error: 'amountUsd must be > 0'
        };
      }
      const privateKey = await loadPolymarketKey();
      const proxyWalletAddress = await getProxyWalletAddress();
      const market = await getMarket(conditionId);
      const tokenId = side === 'YES' ? market.yesTokenId : market.noTokenId;
      if (!tokenId)
        return {
          stepId: step.id,
          type: step.type,
          ok: false,
          dryRun,
          error: 'tokenId not available'
        };
      if (dryRun) {
        return {
          stepId: step.id,
          type: step.type,
          ok: true,
          dryRun,
          output: { conditionId, side, amountUsd, price: limitPrice ?? null }
        };
      }
      const orderResult = limitPrice
        ? await createAndPostOrder({
            tokenId,
            side: 'BUY',
            size: amountUsd / Math.max(limitPrice, 0.0001),
            price: limitPrice,
            orderType: 'GTC',
            privateKey,
            proxyWalletAddress
          })
        : await createAndPostMarketOrder({
            tokenId,
            side: 'BUY',
            amount: amountUsd,
            orderType: 'FOK',
            privateKey,
            proxyWalletAddress
          });
      appendTradeLedger({
        timestamp: new Date().toISOString(),
        type: 'buy',
        planId: undefined,
        conditionId,
        question: market.question,
        side: side as 'YES' | 'NO',
        amountUsd,
        orderId: orderResult?.orderId || orderResult?.orderID || orderResult?.id || null,
        feesUsd: 0,
        realizedPnlUsd: 0
      });
      return {
        stepId: step.id,
        type: step.type,
        ok: true,
        dryRun,
        output: { orderId: orderResult?.orderId || orderResult?.orderID || orderResult?.id || null }
      };
    }
    if (step.type === 'cancel_order') {
      const orderId = String(step.payload?.orderId || '');
      if (!orderId)
        return {
          stepId: step.id,
          type: step.type,
          ok: false,
          dryRun,
          error: 'orderId is required'
        };
      if (dryRun)
        return { stepId: step.id, type: step.type, ok: true, dryRun, output: { orderId } };
      const privateKey = await loadPolymarketKey();
      const result = await cancelOrder(orderId, privateKey);
      return { stepId: step.id, type: step.type, ok: true, dryRun, output: { orderId, result } };
    }
    if (step.type === 'rebalance') {
      const policy = defaultPolicy();
      policy.wallet = walletName;
      const snapshot = await getTreasurySnapshot({ walletName, policy });
      return {
        stepId: step.id,
        type: step.type,
        ok: true,
        dryRun,
        output: {
          action:
            snapshot.proxyWalletBalanceUsd > policy.treasury.maxProxyWalletIdleUsd
              ? 'reduce-proxy-idle'
              : 'none',
          snapshot
        }
      };
    }
    return {
      stepId: step.id,
      type: step.type,
      ok: false,
      dryRun,
      error: `Unsupported step type: ${step.type}`
    };
  } catch (error) {
    return { stepId: step.id, type: step.type, ok: false, dryRun, error: (error as Error).message };
  }
}

export async function executeBettingPlan({
  plan,
  walletName,
  broadcast,
  allowPartial,
  forceRerun,
  confirmStep
}: {
  plan: BettingPlan;
  walletName: string;
  broadcast: boolean;
  allowPartial: boolean;
  forceRerun: boolean;
  confirmStep?: (step: BettingPlanStep, index: number) => Promise<boolean>;
}): Promise<PlanExecutionResult> {
  const dryRun = !broadcast;
  const recordFile = executionRecordPath(plan.planId);
  if (!forceRerun && fs.existsSync(recordFile)) {
    throw new Error(`Plan ${plan.planId} already executed. Use --force-rerun to execute again.`);
  }

  const stepResults: PlanStepResult[] = [];
  let stoppedAtStep: string | undefined;

  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    if (broadcast && confirmStep) {
      const approved = await confirmStep(step, i);
      if (!approved) {
        stepResults.push({
          stepId: step.id,
          type: step.type,
          ok: false,
          dryRun,
          stopped: true,
          skipped: true,
          error: 'Step execution declined by operator'
        });
        stoppedAtStep = step.id;
        break;
      }
    }
    const result = await executeStep({ step, walletName, dryRun });
    stepResults.push(result);
    if (!result.ok) {
      stoppedAtStep = step.id;
      if (!allowPartial) break;
    }
  }

  const summary = {
    totalSteps: plan.steps.length,
    succeeded: stepResults.filter((result) => result.ok).length,
    failed: stepResults.filter((result) => !result.ok && !result.skipped).length,
    skipped: stepResults.filter((result) => !!result.skipped).length
  };
  const execution: PlanExecutionResult = {
    ok: stepResults.every((result) => result.ok),
    planId: plan.planId,
    dryRun,
    stoppedAtStep,
    stepResults,
    summary
  };
  fs.writeFileSync(recordFile, JSON.stringify(execution, null, 2), 'utf8');
  return execution;
}
