import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { importFresh, makeTempHome, withPatchedEnv } from './helpers.mjs';

test('validateBettingPlan rejects invalid plan contract', async () => {
  const { validateBettingPlan } = await importFresh(
    '../src/lib/betting-plan.ts',
    `betting-validate-invalid-${Math.random()}`
  );

  const result = await validateBettingPlan({
    version: 1,
    planId: 'p1',
    wallet: 'main',
    objective: 'test',
    steps: [{ id: 'a', type: 'unknown' }]
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.blockingErrors.some((error) => error.includes('steps[0].type is invalid')),
    true
  );
});

test('validateBettingPlan passes valid plan with basic assertions', async (t) => {
  t.mock.module(new URL('../src/lib/treasury.ts', import.meta.url).href, {
    namedExports: {
      getTreasurySnapshot: async () => ({
        deployableUsd: 100,
        valuationStatus: 'complete',
        sessionHealth: { isExpiringSoon: false }
      })
    }
  });

  const { validateBettingPlan } = await importFresh(
    '../src/lib/betting-plan.ts',
    `betting-validate-valid-${Math.random()}`
  );
  const result = await validateBettingPlan({
    version: 1,
    planId: 'p2',
    wallet: 'main',
    objective: 'deploy 10 usdc',
    constraints: {},
    steps: [{ id: 's1', type: 'assert', payload: { rule: 'deployable_gte', amountUsd: 10 } }]
  });

  assert.equal(result.ok, true);
  assert.equal(result.blockingErrors.length, 0);
});

test('executeBettingPlan is dry-run by default and enforces planId idempotency', async (t) => {
  const home = makeTempHome('betting-plan-exec');

  t.mock.module(new URL('../src/lib/storage.ts', import.meta.url).href, {
    namedExports: {
      ensureStorageSubdirs: (subdirs = []) => {
        for (const subdir of subdirs) {
          fs.mkdirSync(`${home}/.polygon-agent/${subdir}`, { recursive: true });
        }
      },
      getStoragePath: (...parts) => `${home}/.polygon-agent/${parts.join('/')}`,
      loadPolymarketKey: async () => '0x' + '77'.repeat(32)
    }
  });

  t.mock.module(new URL('../src/lib/treasury.ts', import.meta.url).href, {
    namedExports: {
      getTreasurySnapshot: async () => ({
        deployableUsd: 100,
        valuationStatus: 'complete',
        sessionHealth: { isExpiringSoon: false }
      })
    }
  });

  t.mock.module(new URL('../src/lib/polymarket.ts', import.meta.url).href, {
    namedExports: {
      USDC_E: '0xusdc',
      cancelOrder: async () => ({ cancelled: true }),
      createAndPostMarketOrder: async () => ({ orderId: 'o1' }),
      createAndPostOrder: async () => ({ orderId: 'o1' }),
      getMarket: async () => ({ question: 'Q', yesTokenId: 'y1', noTokenId: 'n1' }),
      getOrderBook: async () => ({ asks: [], bids: [] }),
      getPolymarketProxyWalletAddress: async () => '0x' + '88'.repeat(20)
    }
  });

  t.mock.module(new URL('../src/lib/dapp-client.ts', import.meta.url).href, {
    namedExports: {
      runDappClientTx: async () => ({ txHash: '0xtx' })
    }
  });

  t.mock.module(new URL('../src/lib/performance.ts', import.meta.url).href, {
    namedExports: {
      appendTradeLedger: () => {}
    }
  });

  await withPatchedEnv({ HOME: home }, async () => {
    const { executeBettingPlan } = await importFresh(
      '../src/lib/betting-plan.ts',
      `betting-execute-${Math.random()}`
    );
    const plan = {
      version: 1,
      planId: 'exec-plan-1',
      wallet: 'main',
      objective: 'test',
      constraints: {},
      steps: [{ id: 'cp1', type: 'checkpoint', payload: {} }]
    };

    const first = await executeBettingPlan({
      plan,
      walletName: 'main',
      broadcast: false,
      allowPartial: false,
      forceRerun: false
    });
    assert.equal(first.dryRun, true);
    assert.equal(first.ok, true);

    await assert.rejects(
      () =>
        executeBettingPlan({
          plan,
          walletName: 'main',
          broadcast: false,
          allowPartial: false,
          forceRerun: false
        }),
      /already executed/i
    );
  });
});
