import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import yargs from 'yargs';

import { importFresh } from './helpers.mjs';

async function parseCommand(commandModule, args) {
  const logs = [];
  const errors = [];
  const stderrWrites = [];

  const origLog = console.log;
  const origError = console.error;
  const origWrite = process.stderr.write;
  const origExit = process.exit;

  console.log = (msg) => logs.push(String(msg));
  console.error = (msg) => errors.push(String(msg));
  process.stderr.write = (chunk) => {
    stderrWrites.push(String(chunk));
    return true;
  };
  process.exit = (code) => {
    throw new Error(`process.exit:${code ?? 0}`);
  };

  try {
    await yargs()
      .exitProcess(false)
      .scriptName('polygon-agent')
      .command(commandModule)
      .demandCommand(1, '')
      .strict()
      .parseAsync(args);
  } finally {
    console.log = origLog;
    console.error = origError;
    process.stderr.write = origWrite;
    process.exit = origExit;
  }

  return { logs, errors, stderrWrites };
}

test('operations commands function with mocked external integrations', async (t) => {
  const USDC = '0x' + '01'.repeat(20);
  const USDT = '0x' + '02'.repeat(20);
  const RECIPIENT = '0x' + '12'.repeat(20);
  const DEPOSIT = '0x' + '03'.repeat(20);
  const POOL = '0x' + '04'.repeat(20);

  const walletSession = {
    walletAddress: '0x' + '11'.repeat(20),
    chainId: 137,
    chain: 'polygon',
    projectAccessKey: 'pk_wallet',
    explicitSession: '{"pk":"0xabc"}',
    sessionPk: '0xabc',
    implicitPk: '0xdef',
    implicitMeta: '{}',
    implicitAttestation: '{}',
    implicitIdentitySig: '{}',
    createdAt: '2026-03-06T00:00:00.000Z'
  };

  t.mock.module(new URL('../src/lib/dapp-client.ts', import.meta.url).href, {
    namedExports: {
      runDappClientTx: async ({ walletName, transactions, broadcast }) => ({
        walletAddress: walletSession.walletAddress,
        txHash: broadcast ? '0xtxhash' : undefined,
        dryRun: !broadcast,
        walletName,
        transactions
      })
    }
  });

  t.mock.module(new URL('../src/lib/storage.ts', import.meta.url).href, {
    namedExports: {
      loadWalletSession: async () => walletSession,
      loadBuilderConfig: async () => ({
        privateKey: '0x' + '99'.repeat(32),
        eoaAddress: '0x' + 'aa'.repeat(20),
        accessKey: 'pk_test',
        projectId: 1
      })
    }
  });

  t.mock.module(new URL('../src/lib/token-directory.ts', import.meta.url).href, {
    namedExports: {
      resolveErc20BySymbol: async ({ symbol }) => ({
        address: symbol === 'USDT' ? USDT : USDC,
        decimals: 6
      })
    }
  });

  t.mock.module('@0xsequence/indexer', {
    namedExports: {
      SequenceIndexer: class {
        async getNativeTokenBalance() {
          return { balance: { balance: '1000000000000000000' } };
        }
        async getTokenBalances() {
          return {
            balances: [
              {
                contractAddress: USDC,
                balance: '5000000',
                contractInfo: { symbol: 'USDC', name: 'USD Coin', decimals: 6 }
              }
            ]
          };
        }
      }
    }
  });

  t.mock.module('@0xtrails/api', {
    namedExports: {
      TradeType: { EXACT_INPUT: 'EXACT_INPUT' },
      TrailsApi: class {
        async quoteIntent() {
          return {
            intent: {
              intentId: 'intent-1',
              depositTransaction: { to: DEPOSIT, data: '0xdeadbeef', value: '0' }
            }
          };
        }
        async commitIntent() {
          return { intentId: 'intent-1' };
        }
        async executeIntent() {
          return { intentStatus: 'executed' };
        }
        async waitIntentReceipt() {
          return { done: true, intentReceipt: { status: 'done' } };
        }
        async getEarnPools() {
          return {
            pools: [
              {
                isActive: true,
                chainId: 137,
                protocol: 'aave-v3',
                name: 'Aave USDC',
                apy: 0.04,
                tvl: 1000000,
                depositAddress: POOL,
                token: { symbol: 'USDC' }
              }
            ]
          };
        }
      }
    }
  });

  t.mock.module('viem/accounts', {
    namedExports: {
      privateKeyToAccount: () => ({ address: '0x' + 'aa'.repeat(20) })
    }
  });

  t.mock.module('@x402/fetch', {
    namedExports: {
      wrapFetchWithPayment: (fetchImpl) => fetchImpl,
      x402Client: class {
        register() {}
      },
      x402HTTPClient: class {
        getPaymentRequiredResponse() {
          return { accepts: [] };
        }
      },
      decodePaymentResponseHeader: () => ({ transaction: '0xpay' })
    }
  });

  t.mock.module('@x402/evm', {
    namedExports: {
      ExactEvmScheme: class {}
    }
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ pong: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });

  try {
    const {
      balancesCommand,
      fundCommand,
      sendCommand,
      sendNativeCommand,
      sendTokenCommand,
      swapCommand,
      depositCommand,
      x402PayCommand
    } = await importFresh('../src/commands/operations.ts', `ops-${Math.random()}`);

    let result = await parseCommand(balancesCommand, ['balances']);
    assert.equal(JSON.parse(result.logs[0]).ok, true);

    result = await parseCommand(fundCommand, ['fund']);
    assert.match(JSON.parse(result.logs[0]).fundingUrl, /^https:\/\/demo\.trails\.build\//);

    result = await parseCommand(sendCommand, [
      'send',
      '--to',
      RECIPIENT,
      '--amount',
      '1',
      '--broadcast'
    ]);
    assert.equal(JSON.parse(result.logs[0]).txHash, '0xtxhash');

    result = await parseCommand(sendNativeCommand, [
      'send-native',
      '--to',
      RECIPIENT,
      '--amount',
      '1',
      '--broadcast'
    ]);
    assert.equal(JSON.parse(result.logs[0]).ok, true);

    result = await parseCommand(sendTokenCommand, [
      'send-token',
      '--symbol',
      'USDC',
      '--to',
      RECIPIENT,
      '--amount',
      '5',
      '--broadcast'
    ]);
    assert.equal(JSON.parse(result.logs[0]).symbol, 'USDC');

    result = await parseCommand(swapCommand, [
      'swap',
      '--from',
      'USDC',
      '--to',
      'USDT',
      '--amount',
      '5'
    ]);
    assert.equal(JSON.parse(result.logs[0]).dryRun, true);

    result = await parseCommand(depositCommand, ['deposit', '--asset', 'USDC', '--amount', '5']);
    assert.equal(JSON.parse(result.logs[0]).dryRun, true);

    result = await parseCommand(x402PayCommand, ['x402-pay', '--url', 'https://example.com/test']);
    assert.deepEqual(JSON.parse(result.logs[0]), { ok: true, status: 200, data: { pong: true } });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('setup command persists builder config with mocked builder API responses', async (t) => {
  let saved = null;

  t.mock.module(new URL('../src/lib/ethauth.ts', import.meta.url).href, {
    namedExports: {
      generateEthAuthProof: async () => 'eth.test.proof'
    }
  });

  t.mock.module(new URL('../src/lib/storage.ts', import.meta.url).href, {
    namedExports: {
      loadBuilderConfig: async () => null,
      saveBuilderConfig: async (config) => {
        saved = config;
      }
    }
  });

  t.mock.module(new URL('../src/lib/utils.ts', import.meta.url).href, {
    namedExports: {
      generateAgentName: () => 'polygon-agent-test'
    }
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/rpc/Builder/GetAuthToken')) {
      return new Response(JSON.stringify({ ok: true, auth: { jwtToken: 'jwt_test' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (String(url).endsWith('/rpc/Builder/CreateProject')) {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ project: { id: 42, name: body.name } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (String(url).endsWith('/rpc/QuotaControl/GetDefaultAccessKey')) {
      return new Response(JSON.stringify({ accessKey: { accessKey: 'pk_test_123' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('not found', { status: 404 });
  };

  try {
    const { setupCommand } = await importFresh(
      '../src/commands/setup.ts',
      `setup-${Math.random()}`
    );
    const result = await parseCommand(setupCommand, ['setup', '--name', 'TestAgent']);
    const json = JSON.parse(result.logs[0]);

    assert.equal(json.ok, true);
    assert.equal(json.projectId, 42);
    assert.equal(json.accessKey, 'pk_test_123');
    assert.equal(saved.projectId, 42);
    assert.equal(saved.accessKey, 'pk_test_123');
    assert.match(saved.privateKey, /^0x[0-9a-f]{64}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('agent commands function with mocked registry and tx boundaries', async (t) => {
  const actualEthers = await import('ethers');

  t.mock.module(new URL('../src/lib/dapp-client.ts', import.meta.url).href, {
    namedExports: {
      runDappClientTx: async () => ({
        walletAddress: '0x' + '11'.repeat(20),
        txHash: '0xregtx',
        dryRun: false
      })
    }
  });

  t.mock.module(new URL('../src/lib/automation.ts', import.meta.url).href, {
    namedExports: {
      runCliJob: async ({ job }) => ({ ok: true, job }),
      runJobLoop: async ({ jobs }) => jobs.map((job) => ({ ok: true, job })),
      cronAdd: ({ name, type }) => ({ version: 1, name, type, enabled: true }),
      listJobs: () => [{ version: 1, name: 'morning-scan', type: 'scan-markets', enabled: true }],
      removeJob: () => true,
      cronRunDue: async () => [{ ok: true, job: 'scan-markets' }]
    }
  });

  t.mock.module('ethers', {
    namedExports: {
      ...actualEthers,
      JsonRpcProvider: class {},
      Contract: class {
        async getAgentWallet() {
          return '0x' + '22'.repeat(20);
        }
        async getMetadata() {
          return '0x68656c6c6f';
        }
        async getClients() {
          return ['0x' + '33'.repeat(20)];
        }
        async getSummary() {
          return [2n, 450n, 2];
        }
        async readAllFeedback() {
          return [['0x' + '33'.repeat(20)], [0n], [450n], [2], ['quality'], ['fast'], [false]];
        }
      }
    }
  });

  const { agentCommand } = await importFresh('../src/commands/agent.ts', `agent-${Math.random()}`);

  let result = await parseCommand(agentCommand, [
    'agent',
    'register',
    '--name',
    'Agent',
    '--broadcast'
  ]);
  assert.equal(JSON.parse(result.logs[0]).txHash, '0xregtx');

  result = await parseCommand(agentCommand, ['agent', 'wallet', '--agent-id', '1']);
  assert.equal(JSON.parse(result.logs[0]).hasWallet, true);

  result = await parseCommand(agentCommand, [
    'agent',
    'metadata',
    '--agent-id',
    '1',
    '--key',
    'greeting'
  ]);
  assert.equal(JSON.parse(result.logs[0]).value, 'hello');

  result = await parseCommand(agentCommand, ['agent', 'reputation', '--agent-id', '1']);
  assert.equal(JSON.parse(result.logs[0]).feedbackCount, 2);

  result = await parseCommand(agentCommand, [
    'agent',
    'feedback',
    '--agent-id',
    '1',
    '--value',
    '4.5',
    '--broadcast'
  ]);
  assert.equal(JSON.parse(result.logs[0]).txHash, '0xregtx');

  result = await parseCommand(agentCommand, ['agent', 'reviews', '--agent-id', '1']);
  assert.equal(JSON.parse(result.logs[0]).feedbackCount, 1);

  result = await parseCommand(agentCommand, ['agent', 'run', '--job', 'scan-markets']);
  assert.equal(JSON.parse(result.logs[0]).job, 'scan-markets');

  result = await parseCommand(agentCommand, [
    'agent',
    'loop',
    '--job',
    'scan-markets',
    '--interval',
    '1',
    '--max-runs',
    '1'
  ]);
  assert.equal(JSON.parse(result.logs[0]).ok, true);

  result = await parseCommand(agentCommand, [
    'agent',
    'cron',
    'add',
    '--name',
    'morning-scan',
    '--job',
    'scan-markets'
  ]);
  assert.equal(JSON.parse(result.logs[0]).job.name, 'morning-scan');

  result = await parseCommand(agentCommand, ['agent', 'cron', 'list']);
  assert.equal(JSON.parse(result.logs[0]).jobs[0].name, 'morning-scan');

  result = await parseCommand(agentCommand, ['agent', 'cron', 'remove', '--name', 'morning-scan']);
  assert.equal(JSON.parse(result.logs[0]).name, 'morning-scan');

  result = await parseCommand(agentCommand, ['agent', 'cron', 'run-due']);
  assert.equal(JSON.parse(result.logs[0]).results[0].job, 'scan-markets');
});

test('polymarket commands function with mocked market and wallet integrations', async (t) => {
  t.mock.module(new URL('../src/lib/storage.ts', import.meta.url).href, {
    namedExports: {
      loadWalletSession: async () => ({
        walletAddress: '0x' + '11'.repeat(20),
        chainId: 137,
        chain: 'polygon',
        projectAccessKey: 'pk_wallet'
      }),
      getStoragePath: (...parts) => `/tmp/${parts.join('/')}`,
      ensureStorageSubdirs: () => {},
      savePolymarketKey: async () => {},
      loadPolymarketKey: async () => '0x' + '77'.repeat(32)
    }
  });

  t.mock.module(new URL('../src/lib/dapp-client.ts', import.meta.url).href, {
    namedExports: {
      runDappClientTx: async () => ({
        walletAddress: '0x' + '11'.repeat(20),
        txHash: '0xclobfund',
        dryRun: false
      })
    }
  });

  t.mock.module(new URL('../src/lib/polymarket.ts', import.meta.url).href, {
    namedExports: {
      USDC_E: '0xusdc',
      CTF: '0xctf',
      CTF_EXCHANGE: '0xexchange',
      NEG_RISK_CTF_EXCHANGE: '0xnegexchange',
      NEG_RISK_ADAPTER: '0xnegadapter',
      getMarkets: async () => [{ conditionId: 'cond-1', question: 'Will it rain?' }],
      getMarket: async () => ({
        conditionId: 'cond-1',
        question: 'Will it rain?',
        yesTokenId: 'yes-1',
        noTokenId: 'no-1',
        yesPrice: 0.55,
        noPrice: 0.45
      }),
      getOpenOrders: async () => [{ id: 'order-1' }],
      cancelOrder: async () => ({ cancelled: true }),
      createAndPostOrder: async () => ({ orderId: 'order-1' }),
      createAndPostMarketOrder: async () => ({ orderId: 'order-2' }),
      getPolymarketProxyWalletAddress: async () => '0x' + '88'.repeat(20),
      executeViaProxyWallet: async () => '0xapprovetx',
      getPositions: async () => [{ tokenId: 'yes-1', size: 10 }]
    }
  });

  t.mock.module(new URL('../src/lib/policy.ts', import.meta.url).href, {
    namedExports: {
      loadPolicy: () => ({
        name: 'test-policy',
        wallet: 'main',
        marketUniverse: {
          search: null,
          minVolume24hrUsd: 1000,
          maxDaysToEnd: 14,
          includeNegRisk: false
        },
        signalRules: {
          minEdgeBps: 300,
          minConfidenceScore: 0.6,
          yesNoBias: 'auto',
          requireOrderbookLiquidityUsd: 100
        },
        sizing: { method: 'fixed_fraction', perTradeFraction: 0.05, maxTradeUsd: 100 },
        risk: {
          reserveFloorUsd: 100,
          maxDailyLossUsd: 50,
          maxPerMarketExposureUsd: 100,
          maxConcurrentPositions: 5,
          maxOpenOrders: 10,
          maxSlippageBps: 100,
          stopOnSessionExpiryMinutes: 30
        },
        treasury: { targetProxyWalletUsd: 100, maxProxyWalletIdleUsd: 200 },
        automation: { jobs: [] }
      })
    }
  });

  t.mock.module(new URL('../src/lib/polymarket-strategy.ts', import.meta.url).href, {
    namedExports: {
      scanMarkets: async () => ({
        ok: true,
        policy: 'test-policy',
        eligible: [{ conditionId: 'cond-1', question: 'Will it rain?', volume24hrUsd: 10000 }],
        rejected: []
      }),
      signalMarket: async () => ({
        conditionId: 'cond-1',
        question: 'Will it rain?',
        recommendedSide: 'YES',
        signalScore: 91,
        confidence: 0.91,
        priceReference: 0.45,
        liquidityScore: 0.8,
        volume24hrUsd: 10000,
        rationale: ['good'],
        rejected: false,
        rejectionReasons: [],
        treasuryCompatibility: { allowed: true, reasons: [] }
      }),
      buildTradePlan: async () => ({
        version: 1,
        planId: 'plan-1',
        policyName: 'test-policy',
        walletName: 'main',
        generatedAt: '2026-03-06T00:00:00.000Z',
        trades: [
          {
            planTradeId: 'pt-1',
            conditionId: 'cond-1',
            question: 'Will it rain?',
            side: 'YES',
            amountUsd: 25
          }
        ],
        treasurySnapshot: { deployableUsd: 100 },
        validation: []
      }),
      saveTradePlan: () => {},
      executeTradePlan: async ({ broadcast }) => [{ ok: true, dryRun: !broadcast, tradeId: 'pt-1' }]
    }
  });

  t.mock.module('viem/accounts', {
    namedExports: {
      privateKeyToAccount: () => ({ address: '0x' + '99'.repeat(20) })
    }
  });

  const { polymarketCommand } = await importFresh(
    '../src/commands/polymarket.ts',
    `poly-${Math.random()}`
  );

  let result = await parseCommand(polymarketCommand, ['polymarket', 'markets']);
  assert.equal(JSON.parse(result.logs[0]).count, 1);

  result = await parseCommand(polymarketCommand, ['polymarket', 'market', 'cond-1']);
  assert.equal(JSON.parse(result.logs[0]).market.conditionId, 'cond-1');

  result = await parseCommand(polymarketCommand, ['polymarket', 'set-key', '0x' + '77'.repeat(32)]);
  assert.equal(JSON.parse(result.logs[0]).ok, true);

  result = await parseCommand(polymarketCommand, ['polymarket', 'proxy-wallet']);
  assert.equal(JSON.parse(result.logs[0]).proxyWalletAddress, '0x' + '88'.repeat(20));

  result = await parseCommand(polymarketCommand, ['polymarket', 'approve']);
  assert.equal(JSON.parse(result.logs[0]).dryRun, true);

  result = await parseCommand(polymarketCommand, ['polymarket', 'clob-buy', 'cond-1', 'YES', '5']);
  assert.equal(JSON.parse(result.logs[0]).dryRun, true);

  result = await parseCommand(polymarketCommand, ['polymarket', 'sell', 'cond-1', 'YES', '2']);
  assert.equal(JSON.parse(result.logs[0]).dryRun, true);

  result = await parseCommand(polymarketCommand, ['polymarket', 'positions']);
  assert.equal(JSON.parse(result.logs[0]).count, 1);

  result = await parseCommand(polymarketCommand, ['polymarket', 'orders']);
  assert.equal(JSON.parse(result.logs[0]).count, 1);

  result = await parseCommand(polymarketCommand, ['polymarket', 'cancel', 'order-1']);
  assert.equal(JSON.parse(result.logs[0]).orderId, 'order-1');

  result = await parseCommand(polymarketCommand, [
    'polymarket',
    'scan',
    '--policy',
    '/tmp/policy.yaml'
  ]);
  assert.equal(JSON.parse(result.logs[0]).eligible[0].conditionId, 'cond-1');

  result = await parseCommand(polymarketCommand, [
    'polymarket',
    'signal',
    '--policy',
    '/tmp/policy.yaml',
    '--condition-id',
    'cond-1'
  ]);
  assert.equal(JSON.parse(result.logs[0]).signals[0].recommendedSide, 'YES');

  result = await parseCommand(polymarketCommand, [
    'polymarket',
    'plan',
    '--policy',
    '/tmp/policy.yaml',
    '--condition-id',
    'cond-1'
  ]);
  assert.equal(JSON.parse(result.logs[0]).plan.planId, 'plan-1');

  const tempPlanPath = path.join(os.tmpdir(), `plan-${Date.now()}.json`);
  fs.writeFileSync(
    tempPlanPath,
    JSON.stringify({
      version: 1,
      planId: 'plan-1',
      walletName: 'main',
      trades: [{ planTradeId: 'pt-1', conditionId: 'cond-1', side: 'YES', amountUsd: 25 }]
    })
  );
  result = await parseCommand(polymarketCommand, [
    'polymarket',
    'execute-plan',
    '--plan',
    tempPlanPath
  ]);
  assert.equal(JSON.parse(result.logs[0]).results[0].ok, true);
});

test('treasury commands function with mocked treasury and performance integrations', async (t) => {
  t.mock.module(new URL('../src/lib/policy.ts', import.meta.url).href, {
    namedExports: {
      loadPolicy: () => ({
        name: 'test-policy',
        wallet: 'main',
        sizing: { perTradeFraction: 0.05, maxTradeUsd: 50 },
        risk: {
          reserveFloorUsd: 100,
          maxDailyLossUsd: 50,
          maxPerMarketExposureUsd: 100,
          maxConcurrentPositions: 5,
          maxOpenOrders: 10,
          maxSlippageBps: 100,
          stopOnSessionExpiryMinutes: 30
        },
        treasury: { targetProxyWalletUsd: 150, maxProxyWalletIdleUsd: 300 }
      })
    }
  });

  t.mock.module(new URL('../src/lib/treasury.ts', import.meta.url).href, {
    namedExports: {
      getTreasurySnapshot: async () => ({
        walletAddress: '0x' + '11'.repeat(20),
        smartWalletBalances: [{ type: 'erc20', symbol: 'USDC', balance: '500', usdValue: 500 }],
        proxyWalletAddress: '0x' + '22'.repeat(20),
        proxyWalletBalanceUsd: 200,
        reservedUsd: 10,
        deployableUsd: 250,
        reserveFloorUsd: 100,
        openExposureUsd: 25,
        openOrdersUsd: 10,
        realizedPnlUsd: 5,
        unrealizedPnlUsd: 0,
        valuationStatus: 'complete',
        sessionHealth: {
          hasSession: true,
          expiresAt: null,
          expiresInMinutes: null,
          isExpiringSoon: false
        }
      }),
      evaluateTreasuryLimits: () => [{ code: 'reserve-floor', ok: true, message: 'ok' }]
    }
  });

  t.mock.module(new URL('../src/lib/performance.ts', import.meta.url).href, {
    namedExports: {
      summarizePnl: () => ({
        realizedPnlUsd: 12,
        feesUsd: 1,
        winCount: 2,
        lossCount: 1,
        averageTradeUsd: 25,
        byStrategy: { 'test-policy': 12 },
        byMarket: { 'cond-1': 12 },
        entries: []
      })
    }
  });

  const { treasuryCommand } = await importFresh(
    '../src/commands/treasury.ts',
    `treasury-${Math.random()}`
  );

  let result = await parseCommand(treasuryCommand, [
    'treasury',
    'status',
    '--policy',
    '/tmp/policy.yaml'
  ]);
  assert.equal(JSON.parse(result.logs[0]).snapshot.deployableUsd, 250);

  result = await parseCommand(treasuryCommand, [
    'treasury',
    'allocate',
    '--policy',
    '/tmp/policy.yaml',
    '--amount',
    '25'
  ]);
  assert.equal(JSON.parse(result.logs[0]).approvedUsd, 25);

  result = await parseCommand(treasuryCommand, [
    'treasury',
    'rebalance',
    '--policy',
    '/tmp/policy.yaml'
  ]);
  assert.equal(JSON.parse(result.logs[0]).dryRun, true);

  result = await parseCommand(treasuryCommand, [
    'treasury',
    'limits',
    '--policy',
    '/tmp/policy.yaml'
  ]);
  assert.equal(JSON.parse(result.logs[0]).limits.maxOpenOrders, 10);

  result = await parseCommand(treasuryCommand, ['treasury', 'pnl']);
  assert.equal(JSON.parse(result.logs[0]).realizedPnlUsd, 12);
});
