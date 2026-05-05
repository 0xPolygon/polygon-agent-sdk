import type { FlueContext } from '@flue/sdk/client';

import { defineCommand } from '@flue/sdk/node';
import * as v from 'valibot';

// Webhook trigger — Flue exposes this agent at POST /agents/payments/<id>
export const triggers = { webhook: true };

// Pre-bind the polygon-agent CLI as a Flue command. Every shell invocation
// that the LLM emits as `polygon-agent <subcommand>` will be routed through
// this Command, with our env vars attached and no opportunity for the model
// to leak/forge them.
const polygonAgent = defineCommand('polygon-agent', {
  env: {
    SEQUENCE_PROJECT_ACCESS_KEY: process.env.SEQUENCE_PROJECT_ACCESS_KEY ?? ''
  }
});

const requestSchema = v.object({
  instruction: v.string()
});

const resultSchema = v.object({
  summary: v.string(),
  transactions: v.array(
    v.object({
      command: v.string(),
      ok: v.boolean(),
      txHash: v.optional(v.string()),
      explorerUrl: v.optional(v.string()),
      note: v.optional(v.string())
    })
  )
});

export default async function payments({ init, payload }: FlueContext) {
  // Parse the webhook body — must contain a natural-language instruction.
  const request = v.parse(requestSchema, payload);

  // 'local' sandbox mounts process.cwd() at /workspace so the agent has
  // access to the host's polygon-agent CLI, ~/.polygon-agent state, and
  // any skill markdown discovered from the working directory.
  const agent = await init({
    sandbox: 'local',
    model: 'minimax/MiniMax-M2.7',
    role: 'payments',
    commands: [polygonAgent]
  });

  const session = await agent.session();

  // The LLM uses session.shell to run polygon-agent commands. Skills in
  // .flue/skills/ are auto-discovered. The role file establishes the safety
  // rules. The result schema enforces structured output.
  return await session.prompt(request.instruction, {
    result: resultSchema
  });
}
