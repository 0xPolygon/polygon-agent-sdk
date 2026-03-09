import type { CommandModule } from 'yargs';

import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import {
  executeBettingPlan,
  explainBettingPlan,
  loadBettingPlan,
  validateBettingPlan
} from '../lib/betting-plan.ts';

async function handleValidate(argv: { plan: string }): Promise<void> {
  try {
    const plan = loadBettingPlan(argv.plan);
    const validation = await validateBettingPlan(plan);
    console.log(JSON.stringify(validation, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
    process.exit(1);
  }
}

async function handleExplain(argv: { plan: string }): Promise<void> {
  try {
    const plan = loadBettingPlan(argv.plan);
    const explanation = explainBettingPlan(plan);
    console.log(JSON.stringify({ ok: true, ...explanation }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
    process.exit(1);
  }
}

async function handleExecute(argv: {
  plan: string;
  wallet?: string;
  broadcast?: boolean;
  'auto-approve'?: boolean;
  'allow-partial'?: boolean;
  'force-rerun'?: boolean;
}): Promise<void> {
  try {
    const plan = loadBettingPlan(argv.plan);
    const walletName = argv.wallet || plan.wallet;
    const broadcast = argv.broadcast ?? false;
    const autoApprove = argv['auto-approve'] ?? false;
    const allowPartial = argv['allow-partial'] ?? false;
    const forceRerun = argv['force-rerun'] ?? false;

    const validation = await validateBettingPlan(plan);
    if (!validation.ok) {
      console.log(JSON.stringify(validation, null, 2));
      process.exit(1);
      return;
    }

    const confirmStep =
      broadcast && !autoApprove
        ? async (step: { id: string; type: string; description?: string }) => {
            if (!input.isTTY || !output.isTTY) {
              throw new Error(
                'Broadcast mode requires interactive approvals. Use --auto-approve in non-interactive environments.'
              );
            }
            const rl = createInterface({ input, output });
            try {
              const answer = await rl.question(
                `Approve step ${step.id} (${step.type})${step.description ? `: ${step.description}` : ''}? [y/N] `
              );
              return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
            } finally {
              rl.close();
            }
          }
        : undefined;

    const result = await executeBettingPlan({
      plan,
      walletName,
      broadcast,
      allowPartial,
      forceRerun,
      confirmStep
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
    process.exit(1);
  }
}

export const planCommand: CommandModule = {
  command: 'plan',
  describe: 'Validate, explain, and execute LLM-authored betting plans',
  builder: (yargs) =>
    yargs
      .command({
        command: 'validate',
        describe: 'Validate plan schema and operational checks',
        builder: (y) =>
          y.option('plan', {
            type: 'string',
            demandOption: true,
            describe: 'Path to plan JSON'
          }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handler: (argv) => handleValidate(argv as any)
      })
      .command({
        command: 'explain',
        describe: 'Explain deterministic step order and dependencies',
        builder: (y) =>
          y.option('plan', {
            type: 'string',
            demandOption: true,
            describe: 'Path to plan JSON'
          }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handler: (argv) => handleExplain(argv as any)
      })
      .command({
        command: 'execute',
        describe: 'Execute plan step-by-step (dry-run by default)',
        builder: (y) =>
          y
            .option('plan', {
              type: 'string',
              demandOption: true,
              describe: 'Path to plan JSON'
            })
            .option('wallet', {
              type: 'string',
              describe: 'Wallet override; defaults to plan.wallet'
            })
            .option('broadcast', {
              type: 'boolean',
              default: false,
              describe: 'Run live writes (otherwise dry-run only)'
            })
            .option('auto-approve', {
              type: 'boolean',
              default: false,
              describe: 'Skip per-step prompts in broadcast mode'
            })
            .option('allow-partial', {
              type: 'boolean',
              default: false,
              describe: 'Continue running remaining steps after a failure'
            })
            .option('force-rerun', {
              type: 'boolean',
              default: false,
              describe: 'Allow executing a planId that already has an execution record'
            }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handler: (argv) => handleExecute(argv as any)
      })
      .demandCommand(1, '')
      .showHelpOnFail(true),
  handler: () => {}
};
