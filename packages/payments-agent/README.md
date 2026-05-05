# @polygonlabs/payments-agent

A [Flue](https://flueframework.com) agent that wraps the [Polygon Agent CLI](../polygon-agent-cli) so an LLM can drive the entire on-chain payments stack — wallets, balances, sends, swaps, DeFi yield, x402 micropayments, ERC-8004 identity, Polymarket — over a webhook.

The agent is a thin harness: every blockchain operation shells out to `polygon-agent <subcommand>`, parses the JSON output, and reports back. The CLI stays the source of truth for keys, signing, and contract calls. Flue handles the LLM, sandbox, and HTTP exposure.

## Architecture

```
┌──────────────────┐   webhook    ┌──────────────────┐   shell    ┌─────────────────┐
│   Your client    │ ───────────► │  Flue agent      │ ─────────► │  polygon-agent  │
│  (curl / app)    │              │  (Sonnet 4.6)    │            │  (this repo)    │
└──────────────────┘              └──────────────────┘   JSON     └─────────────────┘
                                                                          │
                                                                          ▼
                                                                  ~/.polygon-agent/
                                                                  (encrypted state)
```

## Prerequisites

The agent **does not** run setup or wallet creation for you — those need browser interaction. Before starting the agent, do this on the host:

```bash
# 1. Install the CLI globally if you haven't
npm install -g @polygonlabs/agent-cli

# 2. Set up the builder EOA + Sequence project
polygon-agent setup --name "PaymentsHost"

# 3. Create a wallet session
polygon-agent wallet create --usdc-limit 100

# 4. Fund the wallet
polygon-agent fund    # opens the funding URL
polygon-agent balances    # confirm
```

You also need an Anthropic API key for the model.

## Quick start

```bash
cd packages/payments-agent
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...

pnpm install
pnpm dev
```

The agent boots on `http://localhost:3583` and exposes `POST /agents/payments/<id>`.

## Smoke test

Read-only:

```bash
curl -X POST http://localhost:3583/agents/payments/test1 \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"What is the balance of my main wallet?"}'
```

Dry-run write:

```bash
curl -X POST http://localhost:3583/agents/payments/test2 \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"Send 0.01 USDC.e to 0xf150FF60f5aa52A4F3DDAc28539fA1efD24859d4 — dry-run only, do not broadcast"}'
```

Polymarket bet (will execute if the instruction confirms):

```bash
curl -X POST http://localhost:3583/agents/payments/test3 \
  -H 'Content-Type: application/json' \
  -d '{"instruction":"Place a $1 YES bet on the market with conditionId 0xa0f4c4924ea1a8b410b4ce821c2a9955fad21a1b19bdcfde90816732278b3dd5 — broadcast"}'
```

## Build for prod

```bash
pnpm build         # produces dist/server.mjs
pnpm start         # node dist/server.mjs
```

The compiled server reads `PORT` (default `3583`) and the same env vars as dev.

## Capabilities

Read-only:
- Balances on any chain (`polygon-agent balances --chains ...`)
- Wallet info, funding URLs
- Polymarket markets, positions, open orders
- ERC-8004 reputation lookup

Write (LLM uses dry-run first, then `--broadcast` on confirmation):
- Send native or ERC-20
- Swap (single-chain or cross-chain)
- Deposit to Aave / Morpho yield
- Withdraw from positions
- Pay an x402-protected URL (always executes — payment is required for the response)
- Buy/sell on Polymarket
- Register an agent identity, leave feedback

## Safety model

The role prompt at `.flue/roles/payments.md` enforces:

- Skills the agent can invoke live in `.agents/skills/` (one markdown file per capability — balances, send, swap, deposit, x402-pay, polymarket, identity, discovery)


- Dry-run before broadcast
- Never invent addresses
- Reserve gas (≥ 0.1 USDC or 0.1 POL)
- No setup or wallet-create from inside the agent
- Always run `polygon-agent fund` to get funding URLs

## Webhook auth

`v1` has no auth on the webhook endpoint. For anything beyond local dev, set `WEBHOOK_SECRET` in `.env` and add a header check before the request reaches the agent (TODO — track in follow-up).

## Deploy targets

This package targets **Node only**. Cloudflare Workers can't spawn the CLI as a subprocess (no `child_process` API); supporting Workers would require either a remote sandbox or hosting the CLI as an HTTP service the agent calls. Out of scope for v1.

## License

MIT — same as the parent repo.
