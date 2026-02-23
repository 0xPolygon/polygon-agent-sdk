---
name: polymarket
description: Place bets on Polymarket prediction markets from the CLI. Browse markets, buy YES/NO outcome positions, check open positions, manage CLOB orders. Uses Sequence ecosystem wallet + builder EOA pattern — smart wallet funds EOA, EOA signs all on-chain and CLOB transactions.
---

# Polymarket CLI Integration

## Architecture

Polymarket requires a private key to sign every transaction and CLOB API request. The Sequence ecosystem (smart contract) wallet cannot sign these payloads directly. The pattern mirrors `x402-pay`:

```
Smart Wallet (USDC.e) → fund → Builder EOA → signs everything
```

1. Smart wallet transfers exact USDC.e amount to builder EOA
2. Builder EOA approves contracts, splits position, posts CLOB orders

This means **the builder EOA must have a Polymarket account** (terms accepted on polymarket.com at least once) before `orders` and `cancel` work. The `markets`, `market`, `positions`, and `buy` (dry-run) commands work without any Polymarket account.

## Prerequisites

- Completed `polygon-agent setup` (creates EOA + stores encrypted private key)
- Completed `polygon-agent wallet create` (ecosystem wallet with USDC.e balance)
- Wallet funded with USDC.e on Polygon mainnet (`polygon-agent fund`)
- **Builder EOA must have native POL for gas** — the EOA submits raw transactions (approve, split) directly to Polygon, which requires POL. The smart wallet's gas abstraction (USDC fees) does not apply to EOA transactions. Send 0.1 POL to the EOA once before first use: `polygon-agent send-native --to <EOA> --amount 0.1 --broadcast`

## Contracts (Polygon mainnet, chain 137)

| Contract | Address |
|----------|---------|
| USDC.e (collateral) | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| CTF (Conditional Token Framework) | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| CTF Exchange (CLOB approval target) | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` |
| Neg Risk CTF Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` |
| Neg Risk Adapter | `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` |

## APIs Used

| API | Base URL | Auth |
|-----|----------|------|
| Gamma (market discovery) | `https://gamma-api.polymarket.com` | None |
| CLOB (trading) | `https://clob.polymarket.com` | EIP-712 L1 + HMAC L2 |
| Data (positions) | `https://data-api.polymarket.com` | None |

---

## Commands Reference

### `polymarket markets`

List active markets sorted by 24-hour volume.

```bash
node cli/polygon-agent.mjs polymarket markets [--search <query>] [--limit <n>] [--offset <n>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--search` | — | Filter markets by question text (client-side substring match) |
| `--limit` | 20 | Number of markets to return |
| `--offset` | 0 | Pagination offset |

**Output fields per market:**
- `conditionId` — use this for `market`, `buy`, etc.
- `question` — the market question
- `yesPrice` / `noPrice` — current implied probabilities (0–1)
- `yesTokenId` / `noTokenId` — CLOB token IDs for each outcome
- `volume24hr` — 24-hour trading volume in USD
- `negRisk` — whether this is a neg-risk market (requires extra approvals)
- `endDate` — market resolution date

```bash
# Top 5 markets by volume
node cli/polygon-agent.mjs polymarket markets --limit 5

# Search for bitcoin markets
node cli/polygon-agent.mjs polymarket markets --search "bitcoin" --limit 10

# Search for US election markets
node cli/polygon-agent.mjs polymarket markets --search "trump" --limit 10

# Paginate
node cli/polygon-agent.mjs polymarket markets --limit 20 --offset 20
```

---

### `polymarket market <conditionId>`

Get full details for a single market by its `conditionId`.

```bash
node cli/polygon-agent.mjs polymarket market <conditionId>
```

```bash
node cli/polygon-agent.mjs polymarket market 0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7
```

Returns the same fields as `markets` but for one market. Use this to confirm token IDs and current prices before placing a bet.

---

### `polymarket buy <conditionId> YES|NO <amount>`

Buy a YES or NO position on a market. Spends `amount` USD worth of USDC.e.

```bash
node cli/polygon-agent.mjs polymarket buy <conditionId> YES|NO <amount> \
  [--price <0-1>] \
  [--wallet <name>] \
  [--broadcast]
```

| Argument | Description |
|----------|-------------|
| `conditionId` | The market's conditionId (from `markets` or `market`) |
| `YES` or `NO` | Which outcome you are buying |
| `amount` | USDC.e to spend (e.g. `10` = $10) |
| `--price` | Optional limit price (0–1) for selling unwanted tokens. If omitted, uses market FOK order at 90% of current bid |
| `--wallet` | Wallet name (default: `main`) |
| `--broadcast` | Actually execute. Without this flag, shows a dry-run plan |

**What happens internally (broadcast):**

1. Smart wallet transfers `amount` USDC.e to builder EOA
2. EOA: `approve` USDC.e → CTF Exchange (max uint256)
3. EOA: `setApprovalForAll` CTF → CTF Exchange
4. *(neg risk markets only)* EOA: `setApprovalForAll` CTF → Neg Risk Exchange + Neg Risk Adapter
5. EOA: `splitPosition(USDC.e, bytes32(0), conditionId, [1,2], amount×1e6)` → mints YES + NO tokens
6. EOA: derives CLOB credentials via EIP-712 signed auth
7. EOA: posts SELL order for the *unwanted* outcome token on CLOB

**Order types:**
- No `--price` → `FOK` (fill-or-kill market order at 90% of best bid) — immediate fill or cancel
- `--price 0.35` → `GTC` (good-till-cancelled limit order at your price) — rests on book

```bash
# Dry-run — see exactly what will happen, no funds moved
node cli/polygon-agent.mjs polymarket buy \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7 \
  YES 10

# Market order — spend $10 USDC.e to buy YES, immediately sell NO at market
node cli/polygon-agent.mjs polymarket buy \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7 \
  YES 10 --broadcast

# Limit order — sell unwanted NO tokens at 0.15 (if not filled immediately, rests on book)
node cli/polygon-agent.mjs polymarket buy \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7 \
  YES 10 --price 0.15 --broadcast
```

**Output (broadcast):**
```json
{
  "ok": true,
  "conditionId": "0x...",
  "question": "Will Bitcoin reach $150,000 in February?",
  "outcome": "YES",
  "amountUsd": 10,
  "effectivePrice": 0.0015,
  "fundTxHash": "0x...",
  "approveTxHash": "0x...",
  "splitTxHash": "0x...",
  "orderId": "0x...",
  "orderType": "FOK",
  "sellPrice": 0.8982,
  "signerAddress": "0x..."
}
```

**If the SELL order fails** (e.g. Cloudflare blocking CLOB POST): the split still succeeds. Your YES tokens are held in the builder EOA. The output will include `orderError` with instructions to sell manually at polymarket.com.

---

### `polymarket positions`

List open positions for the ecosystem smart wallet address.

```bash
node cli/polygon-agent.mjs polymarket positions [--wallet <name>]
```

```bash
node cli/polygon-agent.mjs polymarket positions --wallet main
```

Queries the Polymarket Data API (`/positions?user=<walletAddress>`). Returns all open conditional token positions associated with the smart wallet address.

---

### `polymarket orders`

List open CLOB orders placed by the builder EOA.

```bash
node cli/polygon-agent.mjs polymarket orders
```

Requires the builder EOA to have an active Polymarket CLOB account (must have accepted terms on polymarket.com). Authenticates via EIP-712 L1 auth + HMAC L2 and queries `/data/orders`.

---

### `polymarket cancel <orderId>`

Cancel an open CLOB order by its order ID.

```bash
node cli/polygon-agent.mjs polymarket cancel <orderId>
```

```bash
# Get order IDs first
node cli/polygon-agent.mjs polymarket orders

# Then cancel
node cli/polygon-agent.mjs polymarket cancel 0xabc123...
```

---

## Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POLYMARKET_GAMMA_URL` | `https://gamma-api.polymarket.com` | Override Gamma API base URL |
| `POLYMARKET_CLOB_URL` | `https://clob.polymarket.com` | Override CLOB API base URL |
| `POLYMARKET_DATA_URL` | `https://data-api.polymarket.com` | Override Data API base URL |
| `HTTPS_PROXY` | — | HTTP proxy for CLOB requests (helps if Cloudflare blocks your IP) |

---

## Full Flow: Placing a Bet

This is the complete end-to-end flow from zero to a live YES position.

### Step 1 — Prerequisites (one-time)

```bash
# 1a. Setup EOA + Sequence project (if not done)
node cli/polygon-agent.mjs setup --name "MyAgent"
# → save the accessKey

# 1b. Create ecosystem wallet
export SEQUENCE_PROJECT_ACCESS_KEY=<accessKey>
node cli/polygon-agent.mjs wallet create --usdc-limit 100

# 1c. Fund the wallet with USDC.e on Polygon
node cli/polygon-agent.mjs fund
# → open the funding URL in browser, deposit USDC.e via Trails widget

# 1d. Verify balance
export SEQUENCE_INDEXER_ACCESS_KEY=<indexerKey>
node cli/polygon-agent.mjs balances
# → confirm USDC.e balance > 0
```

### Step 2 — Discover a Market

```bash
# Browse top markets
node cli/polygon-agent.mjs polymarket markets --limit 10

# Or search for a specific topic
node cli/polygon-agent.mjs polymarket markets --search "bitcoin" --limit 5
```

Example output entry:
```json
{
  "conditionId": "0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7",
  "question": "Will Bitcoin reach $150,000 in February?",
  "yesPrice": 0.0015,
  "noPrice": 0.9985,
  "volume24hr": 477606.28,
  "endDate": "2026-03-01T05:00:00Z"
}
```

Copy the `conditionId` — you'll use it in every subsequent command.

### Step 3 — Inspect the Market

```bash
node cli/polygon-agent.mjs polymarket market \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7
```

Check:
- `yesPrice` / `noPrice` — current market-implied probability
- `endDate` — when the market resolves
- `negRisk` — if true, extra contract approvals will be done automatically

### Step 4 — Dry-Run the Buy

Always dry-run first to confirm the plan before spending funds.

```bash
node cli/polygon-agent.mjs polymarket buy \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7 \
  YES 10
```

Output shows:
- `wantedTokenId` / `unwantedTokenId` — which CLOB tokens will be used
- `wantedCurrentPrice` — current YES price
- `splitAmountUnits` — exact USDC.e micro-units to be split
- `sellUnwantedAt` — price the NO tokens will be sold at
- `orderType` — FOK (market) or GTC (limit)

### Step 5 — Execute the Buy

```bash
# Market order (recommended for liquid markets)
node cli/polygon-agent.mjs polymarket buy \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7 \
  YES 10 --broadcast

# Limit order — set your own sell price for the unwanted side
node cli/polygon-agent.mjs polymarket buy \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7 \
  YES 10 --price 0.95 --broadcast
```

The command streams progress to stderr:
```
[polymarket] Funding EOA 0x1218... with 10 USDC.e...
[polymarket] Funded: 0xabc...
[polymarket] Approving USDC.e → CTF Exchange...
[polymarket] Approved: 0xdef...
[polymarket] Setting CTF approval for CTF Exchange...
[polymarket] CTF approved: 0x123...
[polymarket] Splitting position (conditionId: 0x5e5c..., amount: 10000000)...
[polymarket] Split: 0x456...
[polymarket] Deriving CLOB credentials...
[polymarket] Posting FOK SELL order for unwanted NO tokens at 0.8982...
```

Final JSON output (stdout):
```json
{
  "ok": true,
  "conditionId": "0x5e5c...",
  "question": "Will Bitcoin reach $150,000 in February?",
  "outcome": "YES",
  "amountUsd": 10,
  "effectivePrice": 0.0015,
  "fundTxHash": "0x...",
  "approveTxHash": "0x...",
  "splitTxHash": "0x...",
  "orderId": "0x...",
  "orderType": "FOK",
  "sellPrice": 0.8982,
  "signerAddress": "0x1218..."
}
```

### Step 6 — Check Your Position

```bash
# Positions held in the smart wallet
node cli/polygon-agent.mjs polymarket positions --wallet main

# Open CLOB orders from the builder EOA (requires Polymarket account)
node cli/polygon-agent.mjs polymarket orders
```

### Step 7 — Cancel an Order (if needed)

If you placed a GTC limit order and want to cancel it:

```bash
# Get the orderId from the orders list
node cli/polygon-agent.mjs polymarket orders

# Cancel it
node cli/polygon-agent.mjs polymarket cancel <orderId>
```

---

## Key Behaviours

| Behaviour | Detail |
|-----------|--------|
| Dry-run by default | `buy` without `--broadcast` shows plan, moves no funds |
| Split-then-sell | Always splits $amount into YES+NO, sells the unwanted side on CLOB |
| Market order | No `--price` → FOK at 90% of best bid (immediate or cancel) |
| Limit order | `--price 0.35` → GTC resting on order book |
| Split-only fallback | If SELL order fails (Cloudflare), split still completes — tokens held in EOA |
| Neg risk | Extra `setApprovalForAll` calls added automatically when `negRisk: true` |
| CLOB account gate | `orders` and `cancel` require EOA registered on Polymarket (accept terms once on polymarket.com) |
| Approvals persist | USDC.e max approval + CTF approvals only needed once per EOA — subsequent buys skip if already set (manually check on-chain if you want to avoid redundant txs) |

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Could not create api key` | Builder EOA has no Polymarket account — visit polymarket.com, connect wallet, accept terms |
| `CLOB order error: 403` (Cloudflare) | Set `HTTPS_PROXY` env var or retry; split already succeeded, tokens held in EOA |
| `Market not found: 0x...` | conditionId not in top 500 markets — may be low-volume or closed |
| `Wallet not found: main` | Run `polygon-agent wallet create` first |
| `Builder EOA not found` | Run `polygon-agent setup` first |
| `Session expired` | Run `polygon-agent wallet create` (sessions expire after 24h) |
| `Market has no tokenIds` | Market is closed or not yet deployed on CLOB |
| `insufficient funds for gas` | EOA has no POL — run `polygon-agent send-native --to <EOA> --amount 0.1 --broadcast` |
| Split succeeded but SELL failed | YES tokens are in EOA — use `--skip-fund` on retry or sell manually at polymarket.com |

## Why EOA Needs POL (not USDC)

Unlike `x402-pay` where the EOA only **signs** an off-chain message (no gas), Polymarket requires the EOA to submit real on-chain transactions (`approve`, `splitPosition`). The Sequence relayer's USDC gas abstraction only covers smart wallet transactions — raw EOA transactions pay gas in native POL directly to the Polygon network. This is a protocol-level constraint, not a configuration issue.
