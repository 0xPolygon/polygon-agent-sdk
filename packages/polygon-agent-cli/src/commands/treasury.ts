import type { CommandModule } from 'yargs';

import { summarizePnl } from '../lib/performance.ts';
import { loadPolicy } from '../lib/policy.ts';
import { getTreasurySnapshot, evaluateTreasuryLimits } from '../lib/treasury.ts';

function resolvePolicyFromArg(policyPath?: string) {
  return loadPolicy(policyPath || 'default-policy.yaml');
}

export const treasuryCommand: CommandModule = {
  command: 'treasury',
  describe: 'Treasury, allocation, limits, rebalancing, and PnL',
  builder: (yargs) =>
    yargs
      .command({
        command: 'status',
        describe: 'Show treasury status for wallet + proxy wallet',
        builder: (y) =>
          y
            .option('policy', { type: 'string', demandOption: true, describe: 'Policy file path' })
            .option('wallet', { type: 'string', describe: 'Wallet name override' }),
        handler: async (argv) => {
          try {
            const policy = resolvePolicyFromArg(argv.policy as string);
            const walletName = (argv.wallet as string) || policy.wallet;
            const snapshot = await getTreasurySnapshot({ walletName, policy });
            console.log(
              JSON.stringify({ ok: true, walletName, policy: policy.name, snapshot }, null, 2)
            );
          } catch (error) {
            console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
            process.exit(1);
          }
        }
      })
      .command({
        command: 'allocate',
        describe: 'Evaluate allocation capacity against treasury limits',
        builder: (y) =>
          y
            .option('policy', { type: 'string', demandOption: true, describe: 'Policy file path' })
            .option('wallet', { type: 'string', describe: 'Wallet name override' })
            .option('strategy', { type: 'string', describe: 'Strategy name override' })
            .option('amount', { type: 'number', describe: 'Requested USD allocation' })
            .option('condition-id', { type: 'string', describe: 'Target market condition ID' }),
        handler: async (argv) => {
          try {
            const policy = resolvePolicyFromArg(argv.policy as string);
            const walletName = (argv.wallet as string) || policy.wallet;
            const snapshot = await getTreasurySnapshot({ walletName, policy });
            const amount =
              (argv.amount as number | undefined) ??
              Math.min(
                snapshot.deployableUsd * policy.sizing.perTradeFraction,
                policy.sizing.maxTradeUsd
              );
            const validation = evaluateTreasuryLimits({ snapshot, policy, amountUsd: amount });
            const approved = validation.every((item) => item.ok);
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  walletName,
                  strategy: (argv.strategy as string | undefined) || policy.name,
                  conditionId: (argv['condition-id'] as string | undefined) || null,
                  requestedUsd: amount,
                  approvedUsd: approved ? amount : 0,
                  rejectedUsd: approved ? 0 : amount,
                  validation
                },
                null,
                2
              )
            );
          } catch (error) {
            console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
            process.exit(1);
          }
        }
      })
      .command({
        command: 'rebalance',
        describe: 'Suggest or execute treasury rebalancing actions',
        builder: (y) =>
          y
            .option('policy', { type: 'string', demandOption: true, describe: 'Policy file path' })
            .option('wallet', { type: 'string', describe: 'Wallet name override' })
            .option('broadcast', {
              type: 'boolean',
              default: false,
              describe: 'Execute actions (dry-run by default)'
            }),
        handler: async (argv) => {
          try {
            const policy = resolvePolicyFromArg(argv.policy as string);
            const walletName = (argv.wallet as string) || policy.wallet;
            const snapshot = await getTreasurySnapshot({ walletName, policy });
            const actions = [];
            if (snapshot.proxyWalletBalanceUsd > policy.treasury.maxProxyWalletIdleUsd) {
              actions.push({
                type: 'reduce-proxy-idle',
                amountUsd: Number(
                  (snapshot.proxyWalletBalanceUsd - policy.treasury.maxProxyWalletIdleUsd).toFixed(
                    2
                  )
                )
              });
            }
            if (snapshot.proxyWalletBalanceUsd < policy.treasury.targetProxyWalletUsd) {
              actions.push({
                type: 'top-up-proxy',
                amountUsd: Number(
                  Math.min(
                    policy.treasury.targetProxyWalletUsd - snapshot.proxyWalletBalanceUsd,
                    snapshot.deployableUsd
                  ).toFixed(2)
                )
              });
            }
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  dryRun: !(argv.broadcast as boolean),
                  walletName,
                  snapshot,
                  actions
                },
                null,
                2
              )
            );
          } catch (error) {
            console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
            process.exit(1);
          }
        }
      })
      .command({
        command: 'limits',
        describe: 'Show effective treasury and risk limits from policy',
        builder: (y) =>
          y.option('policy', { type: 'string', demandOption: true, describe: 'Policy file path' }),
        handler: async (argv) => {
          try {
            const policy = resolvePolicyFromArg(argv.policy as string);
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  policy: policy.name,
                  limits: {
                    reserveFloorUsd: policy.risk.reserveFloorUsd,
                    maxDailyLossUsd: policy.risk.maxDailyLossUsd,
                    maxPerMarketExposureUsd: policy.risk.maxPerMarketExposureUsd,
                    maxConcurrentPositions: policy.risk.maxConcurrentPositions,
                    maxOpenOrders: policy.risk.maxOpenOrders,
                    maxSlippageBps: policy.risk.maxSlippageBps,
                    maxProxyWalletIdleUsd: policy.treasury.maxProxyWalletIdleUsd,
                    stopOnSessionExpiryMinutes: policy.risk.stopOnSessionExpiryMinutes
                  }
                },
                null,
                2
              )
            );
          } catch (error) {
            console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
            process.exit(1);
          }
        }
      })
      .command({
        command: 'pnl',
        describe: 'Show realized and unrealized PnL summary',
        builder: (y) =>
          y
            .option('days', { type: 'number', describe: 'Optional trailing window in days' })
            .option('details', {
              type: 'boolean',
              default: false,
              describe: 'Include ledger entries'
            }),
        handler: async (argv) => {
          try {
            const summary = summarizePnl(argv.days as number | undefined);
            console.log(
              JSON.stringify(
                {
                  ok: true,
                  realizedPnlUsd: summary.realizedPnlUsd,
                  unrealizedPnlUsd: 0,
                  feesUsd: summary.feesUsd,
                  winCount: summary.winCount,
                  lossCount: summary.lossCount,
                  averageTradeUsd: summary.averageTradeUsd,
                  byStrategy: summary.byStrategy,
                  byMarket: summary.byMarket,
                  entries: argv.details ? summary.entries : undefined
                },
                null,
                2
              )
            );
          } catch (error) {
            console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
            process.exit(1);
          }
        }
      })
      .demandCommand(1, '')
      .showHelpOnFail(true),
  handler: () => {}
};
