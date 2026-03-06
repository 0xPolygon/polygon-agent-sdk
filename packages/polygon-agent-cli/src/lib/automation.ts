import fs from 'node:fs';
import path from 'node:path';

import type { CliJobSpec } from './policy.ts';

import { loadPolicy, normalizeJobSpec } from './policy.ts';
import { buildTradePlan, scanMarkets, signalMarket } from './polymarket-strategy.ts';
import { ensureStorageSubdirs, getStoragePath } from './storage.ts';
import { getTreasurySnapshot } from './treasury.ts';

function automationDir(...parts: string[]) {
  ensureStorageSubdirs(['automation/jobs', 'automation/state', 'reports']);
  return getStoragePath('automation', ...parts);
}

function reportPath(jobName: string): string {
  ensureStorageSubdirs(['reports']);
  return getStoragePath('reports', `${jobName}-${Date.now()}.json`);
}

function lockPathDefault(jobName: string): string {
  return automationDir('state', `${jobName}.lock`);
}

function jobFilePath(name: string): string {
  return automationDir('jobs', `${name}.json`);
}

export function listJobs(): CliJobSpec[] {
  const dir = automationDir('jobs');
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as CliJobSpec);
}

export function saveJob(spec: CliJobSpec): void {
  fs.writeFileSync(jobFilePath(spec.name), JSON.stringify(spec, null, 2), 'utf8');
}

export function removeJob(name: string): boolean {
  const fp = jobFilePath(name);
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  return true;
}

export async function runCliJob({
  job,
  policyFile,
  wallet,
  broadcast
}: {
  job: CliJobSpec['type'];
  policyFile?: string;
  wallet?: string;
  broadcast?: boolean;
}) {
  const policy = policyFile ? loadPolicy(policyFile) : null;
  const walletName = wallet || policy?.wallet || 'main';

  let result: unknown;
  switch (job) {
    case 'scan-markets':
      if (!policy) throw new Error('scan-markets requires --policy');
      result = await scanMarkets({ policy, limit: 20 });
      break;
    case 'signal-markets':
      if (!policy) throw new Error('signal-markets requires --policy');
      result = await scanMarkets({ policy, limit: 20 });
      break;
    case 'plan-trades':
      if (!policy) throw new Error('plan-trades requires --policy');
      {
        const scan = await scanMarkets({ policy, limit: 20 });
        const signals = await Promise.all(
          scan.eligible
            .slice(0, 5)
            .map((market) => signalMarket({ policy, conditionId: market.conditionId, walletName }))
        );
        result = await buildTradePlan({ policy, walletName, signals });
      }
      break;
    case 'execute-plan':
      throw new Error('execute-plan requires a plan file and is not supported via generic run job');
    case 'treasury-status':
    case 'session-health':
    case 'session-refresh-check':
      if (!policy) throw new Error(`${job} requires --policy`);
      result = await getTreasurySnapshot({ walletName, policy });
      break;
    case 'treasury-rebalance':
      if (!policy) throw new Error('treasury-rebalance requires --policy');
      {
        const snapshot = await getTreasurySnapshot({ walletName, policy });
        result = {
          ok: true,
          dryRun: !broadcast,
          walletName,
          actions: [
            snapshot.proxyWalletBalanceUsd > policy.treasury.maxProxyWalletIdleUsd
              ? `Reduce proxy wallet idle balance by ${(snapshot.proxyWalletBalanceUsd - policy.treasury.maxProxyWalletIdleUsd).toFixed(2)} USDC.e`
              : 'Proxy wallet idle balance within target'
          ],
          snapshot
        };
      }
      break;
  }

  const report = {
    ok: true,
    job,
    generatedAt: new Date().toISOString(),
    result
  };
  fs.writeFileSync(reportPath(job), JSON.stringify(report, null, 2), 'utf8');
  return report;
}

export async function runJobLoop({
  jobs,
  policyFile,
  wallet,
  intervalSeconds,
  maxRuns,
  lockFile
}: {
  jobs: CliJobSpec['type'][];
  policyFile?: string;
  wallet?: string;
  intervalSeconds: number;
  maxRuns?: number;
  lockFile?: string;
}) {
  const lock = lockFile || lockPathDefault('agent-loop');
  if (fs.existsSync(lock)) {
    throw new Error(`Loop lock already exists: ${lock}`);
  }
  fs.writeFileSync(lock, JSON.stringify({ startedAt: new Date().toISOString() }), 'utf8');
  const events = [];
  try {
    const runs = maxRuns ?? 1;
    for (let run = 0; run < runs; run += 1) {
      for (const job of jobs) {
        events.push(await runCliJob({ job, policyFile, wallet, broadcast: false }));
      }
      if (run < runs - 1) {
        await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
      }
    }
  } finally {
    if (fs.existsSync(lock)) fs.unlinkSync(lock);
  }
  return events;
}

export function cronAdd(
  input: Partial<CliJobSpec> & Pick<CliJobSpec, 'name' | 'type'>
): CliJobSpec {
  const job = normalizeJobSpec(input);
  saveJob(job);
  return job;
}

export async function cronRunDue(now = new Date()): Promise<unknown[]> {
  const results = [];
  for (const job of listJobs()) {
    if (!job.enabled) continue;
    const due = !job.nextRunAt || Date.parse(job.nextRunAt) <= now.getTime();
    if (!due) continue;
    results.push(
      await runCliJob({
        job: job.type,
        policyFile: job.policyFile,
        wallet: job.wallet,
        broadcast: false
      })
    );
    if (job.intervalSeconds) {
      job.nextRunAt = new Date(now.getTime() + job.intervalSeconds * 1000).toISOString();
      saveJob(job);
    }
  }
  return results;
}
