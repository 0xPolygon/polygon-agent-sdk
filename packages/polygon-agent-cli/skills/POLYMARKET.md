---
name: polymarket
description: Place bets on Polymarket prediction markets via the Polygon Agent CLI. Browse markets, buy YES/NO positions, manage CLOB orders, check positions. Uses Sequence ecosystem wallet → Polymarket proxy wallet → CLOB (POLY_PROXY signature type).
---

# Polymarket Integration

## Architecture

Polymarket trading requires three layers working together:

```
Sequence Smart Wallet (holds USDC.e)
        │
        │  ① USDC.e transfer (smart wallet tx, USDC gas fee)
        ▼
Polymarket Proxy Wallet (deterministic CREATE2, owned by EOA)
        │
        │  ② On-chain batch: approve + split (EOA signs, EOA pays POL gas)
        ▼
CLOB — order maker = proxy wallet, signer = EOA (POLY_PROXY sig type)
```

### The Three Actors

| Actor | Created by | Role |
|-------|-----------|------|
| Sequence smart wallet | `polygon-agent wallet create` | Holds USDC.e; funds the proxy wallet |
| Polymarket proxy wallet | Polymarket factory (deterministic) | On-chain identity for CLOB trading; holds outcome tokens |
| Builder EOA | `polygon-agent setup` | Signs all on-chain txs and CLOB API requests |

### Why a Proxy Wallet?

Polymarket's CLOB requires every order to be signed by a private key.
A Sequence smart contract wallet cannot sign CLOB payloads directly.
The proxy wallet pattern solves this: the EOA (which has a private key) **owns** the proxy wallet and signs on its behalf (`signatureType=POLY_PROXY`), while the smart wallet is the ultimate source of funds.

The proxy wallet address is **deterministic** — computed via CREATE2 from the EOA address and the Polymarket factory (`0xaB45c5A4B0c941a2F231C04C3f49182e1A254052`). It never changes.

### Gas Model

| Operation | Who pays gas | Token |
|-----------|-------------|-------|
| USDC.e transfer (smart wallet → proxy) | Sequence relayer | USDC.e (fee abstraction) |
| On-chain batch (approve + split) via `proxy.execute()` | Builder EOA | POL (native) |
| CLOB order posting | Off-chain (no gas) | — |

**The EOA must hold native POL for gas.** The Sequence gas abstraction only applies to smart wallet transactions. Send ~0.1 POL to the EOA before first use.

---

## Prerequisites (One-Time Setup)

```bash
# 1. Setup builder EOA + Sequence project
polygon-agent setup --name "MyAgent"
# → save accessKey and eoaAddress from output

# 2. Export access key
export SEQUENCE_PROJECT_ACCESS_KEY=<accessKey>
export SEQUENCE_INDEXER_ACCESS_KEY=$SEQUENCE_PROJECT_ACCESS_KEY

# 3. Create ecosystem wallet with USDC spending limit
polygon-agent wallet create --usdc-limit 100

# 4. Fund the smart wallet with USDC.e on Polygon
polygon-agent fund
# → open the returned fundingUrl in browser, deposit via Trails widget

# 5. Fund the builder EOA with native POL for gas
# EOA address is in ~/.polygon-agent/builder.json → eoaAddress field
polygon-agent send-native --to <eoaAddress> --amount 0.1 --broadcast

# 6. Show your proxy wallet address (for reference)
polygon-agent polymarket proxy-wallet

# 7. Required for orders/cancel — accept Polymarket terms
# Visit https://polymarket.com, connect the builder EOA wallet, accept terms once.
```

---

## Commands Reference

### `polymarket markets`

List active Polymarket markets sorted by 24-hour volume.

```bash
polygon-agent polymarket markets [--search <query>] [--limit <n>] [--offset <n>]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--search` | — | Client-side substring filter on market question |
| `--limit` | 20 | Max markets to return |
| `--offset` | 0 | Pagination offset |

```bash
# Top 20 by volume
polygon-agent polymarket markets

# Search for Bitcoin markets
polygon-agent polymarket markets --search "bitcoin" --limit 10

# Paginate
polygon-agent polymarket markets --limit 20 --offset 20
```

**Output fields per market:**
- `conditionId` — unique market ID used in all other commands
- `question` — the market question text
- `yesPrice` / `noPrice` — current implied probabilities (0–1, e.g. `0.65` = 65% chance)
- `yesTokenId` / `noTokenId` — CLOB token IDs
- `volume24hr` — 24h trading volume in USD
- `negRisk` — `true` if neg-risk market (different approval flow, handled automatically)
- `endDate` — market resolution date

---

### `polymarket market <conditionId>`

Get full details for a single market.

```bash
polygon-agent polymarket market <conditionId>
```

Use this to confirm token IDs and current prices before placing a bet. The Gamma API does not support direct conditionId lookup — internally scans up to 500 markets by volume then falls back to a closed-market query.

---

### `polymarket proxy-wallet`

Show the Polymarket proxy wallet address derived from your builder EOA.

```bash
polygon-agent polymarket proxy-wallet
```

Output:
```json
{
  "ok": true,
  "eoaAddress": "0x1218...",
  "proxyWalletAddress": "0xabcd...",
  "note": "Fund proxyWalletAddress with USDC.e on Polygon to enable CLOB trading."
}
```

The proxy wallet is the actual holder of outcome tokens after a buy. It is permanent and deterministic per EOA.

---

### `polymarket approve`

Set the required on-chain approvals on the proxy wallet. **Run once before first use** — approvals are permanent on-chain.

```bash
polygon-agent polymarket approve [--neg-risk] [--broadcast]
```

| Flag | Description |
|------|-------------|
| `--neg-risk` | Set neg-risk approvals (adds `NEG_RISK_ADAPTER` + `NEG_RISK_CTF_EXCHANGE`) |
| `--broadcast` | Execute. Without this flag, shows a dry-run plan. EOA must have POL (~0.001 POL). |

**What it sets (regular markets):**
```
USDC.e → CTF_EXCHANGE (ERC20 approve, max)
CTF → CTF_EXCHANGE (setApprovalForAll)
```

**What it sets (`--neg-risk`):**
```
USDC.e → NEG_RISK_ADAPTER (ERC20 approve, max)
USDC.e → NEG_RISK_CTF_EXCHANGE (ERC20 approve, max)
CTF → CTF_EXCHANGE (setApprovalForAll)
CTF → NEG_RISK_CTF_EXCHANGE (setApprovalForAll)
CTF → NEG_RISK_ADAPTER (setApprovalForAll)
```

All approvals are bundled in a single `proxy.execute()` transaction.

```bash
# Dry-run — see what will be set
polygon-agent polymarket approve

# Execute
polygon-agent polymarket approve --broadcast

# For neg-risk markets
polygon-agent polymarket approve --neg-risk --broadcast
```

**Success output:**
```json
{
  "ok": true,
  "proxyWalletAddress": "0xabcd...",
  "signerAddress": "0x1218...",
  "negRisk": false,
  "approveTxHash": "0x...",
  "note": "Proxy wallet approvals set. Ready for clob-buy and sell."
}
```

---

### `polymarket clob-buy <conditionId> YES|NO <usdcAmount>`

The primary command for entering a position. Funds the proxy wallet from the smart wallet, then buys outcome tokens directly from the CLOB.

**Prerequisite:** Run `polymarket approve --broadcast` once before first use.

```bash
polygon-agent polymarket clob-buy <conditionId> YES|NO <usdcAmount> \
  [--price <0-1>] \
  [--fak] \
  [--wallet <name>] \
  [--skip-fund] \
  [--broadcast]
```

| Argument / Flag | Description |
|----------------|-------------|
| `conditionId` | Market ID from `markets` or `market` |
| `YES` or `NO` | Outcome to buy |
| `usdcAmount` | USDC.e to spend (e.g. `10` = $10) |
| `--price <0-1>` | GTC limit order at this price. Omit = market order (FOK or FAK) |
| `--fak` | FAK (fill-and-kill, allows partial fill) instead of FOK |
| `--wallet <name>` | Smart wallet to fund from (default: `main`) |
| `--skip-fund` | Skip smart wallet → proxy transfer; use existing proxy balance |
| `--broadcast` | Execute. Without this flag, prints a dry-run plan with no funds moved. |

#### What happens internally (with `--broadcast`)

**Step 1 — Fund proxy wallet**
Smart wallet transfers `usdcAmount` USDC.e to the proxy wallet. Sequence tx — paid in USDC.e via fee abstraction.

**Step 2 — CLOB BUY order**
Posts a BUY order: `maker=proxyWallet`, `signer=EOA`, `signatureType=POLY_PROXY`.
Tokens arrive in the proxy wallet.

```bash
# Market buy $10 USDC worth of YES tokens
polygon-agent polymarket clob-buy \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7 \
  YES 10 --broadcast

# Limit buy — fill only if price ≤ 0.65
polygon-agent polymarket clob-buy \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7 \
  YES 10 --price 0.65 --broadcast

# Skip re-funding (proxy already has USDC.e)
polygon-agent polymarket clob-buy \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7 \
  YES 5 --skip-fund --broadcast
```

**Success output:**
```json
{
  "ok": true,
  "conditionId": "0x5e5c...",
  "question": "Will Bitcoin reach $150,000?",
  "outcome": "YES",
  "amountUsd": 10,
  "currentPrice": 0.65,
  "proxyWalletAddress": "0xabcd...",
  "signerAddress": "0x1218...",
  "fundTxHash": "0x...",
  "orderId": "0x...",
  "orderType": "FOK"
}
```

---

### `polymarket sell <conditionId> YES|NO <shares>`

Sell outcome tokens held in the proxy wallet via a CLOB SELL order. Pure off-chain — no on-chain transaction, no gas needed.

```bash
polygon-agent polymarket sell <conditionId> YES|NO <shares> \
  [--price <0-1>] \
  [--fak] \
  [--broadcast]
```

| Argument / Flag | Description |
|----------------|-------------|
| `<shares>` | Number of outcome tokens to sell (e.g. `10` = 10 YES tokens) |
| `--price <0-1>` | GTC limit order. Omit = FOK market order |
| `--fak` | FAK (partial fill allowed) instead of FOK |
| `--broadcast` | Execute |

```bash
# Market sell 10 YES tokens
polygon-agent polymarket sell \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7 \
  YES 10 --broadcast

# Limit sell — only fill at 0.80 or above
polygon-agent polymarket sell \
  0x5e5c9dfaf695371a0cc321b47b35f66a6dbd1482f0503526603d2bd2a91bfdc7 \
  YES 10 --price 0.80 --broadcast
```

---

### `polymarket positions`

List open positions for the smart wallet address (queries Polymarket Data API).

```bash
polygon-agent polymarket positions [--wallet <name>]
```

Note: outcome tokens from `buy` are held in the **proxy wallet**, not the smart wallet. This command queries by smart wallet address — it may not show proxy wallet holdings. To see proxy wallet holdings, check polymarket.com using the address from `proxy-wallet`.

---

### `polymarket orders`

List open CLOB orders placed by the builder EOA.

```bash
polygon-agent polymarket orders
```

Authenticates via EIP-712 L1 auth + HMAC L2 credentials derived from the EOA private key (via `@polymarket/clob-client`). Requires the EOA to have accepted Polymarket terms at polymarket.com.

---

### `polymarket cancel <orderId>`

Cancel an open CLOB order by ID.

```bash
polygon-agent polymarket cancel <orderId>
```

```bash
# Get order IDs first
polygon-agent polymarket orders

# Cancel
polygon-agent polymarket cancel 0xabc123...
```

---

## Full Flow: End-to-End Example

```bash
# --- Prerequisites (run once) ---
export SEQUENCE_PROJECT_ACCESS_KEY=<key>
export SEQUENCE_INDEXER_ACCESS_KEY=$SEQUENCE_PROJECT_ACCESS_KEY

# Fund EOA with POL for gas (eoaAddress is in ~/.polygon-agent/builder.json)
polygon-agent send-native --to <eoaAddress> --amount 0.1 --broadcast

# Set proxy wallet approvals (one-time, permanent)
polygon-agent polymarket approve --broadcast
# For neg-risk markets: polygon-agent polymarket approve --neg-risk --broadcast

# --- Find a market ---
polygon-agent polymarket markets --search "trump" --limit 5
# → note the conditionId you want

# Inspect it
polygon-agent polymarket market 0x<conditionId>
# → check yesPrice, noPrice, endDate, negRisk

# --- Place a bet ---
# Dry-run first
polygon-agent polymarket clob-buy 0x<conditionId> YES 10

# Execute (funds proxy wallet + places CLOB BUY)
polygon-agent polymarket clob-buy 0x<conditionId> YES 10 --broadcast

# --- Manage ---
# Check open orders
polygon-agent polymarket orders

# Cancel if needed
polygon-agent polymarket cancel <orderId>

# Sell your position
polygon-agent polymarket sell 0x<conditionId> YES 10 --broadcast
```

---

## Contracts (Polygon Mainnet, Chain 137)

| Contract | Address |
|----------|---------|
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| CTF (Conditional Token Framework) | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| CTF Exchange | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` |
| Neg Risk CTF Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` |
| Neg Risk Adapter | `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` |
| Proxy Wallet Factory | `0xaB45c5A4B0c941a2F231C04C3f49182e1A254052` |

---

## APIs Used

| API | Base URL | Auth |
|-----|----------|------|
| Gamma (market discovery) | `https://gamma-api.polymarket.com` | None |
| CLOB (trading) | `https://clob.polymarket.com` | EIP-712 L1 + HMAC L2 (via `@polymarket/clob-client`) |
| Data (positions) | `https://data-api.polymarket.com` | None |

Override via env: `POLYMARKET_GAMMA_URL`, `POLYMARKET_CLOB_URL`, `POLYMARKET_DATA_URL`.

---

## Neg-Risk Markets

When `negRisk: true` in market data, `polymarket approve --neg-risk` sets the extended approval set:

| | Regular Market | Neg-Risk Market (`--neg-risk`) |
|-|---------------|-------------------------------|
| USDC.e approval | → CTF Exchange | → Neg Risk Adapter + Neg Risk CTF Exchange |
| CTF approval | → CTF Exchange | → CTF Exchange + Neg Risk CTF Exchange + Neg Risk Adapter |

Run `polymarket approve --neg-risk --broadcast` to set neg-risk approvals, then `clob-buy` works normally.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `insufficient funds for gas` | EOA has no POL | `polygon-agent send-native --to <eoaAddress> --amount 0.1 --broadcast` |
| `Could not create api key` | EOA not registered on Polymarket | Visit polymarket.com, connect EOA wallet, accept terms |
| `CLOB order error: 403` | Cloudflare blocking POST | Set `HTTPS_PROXY` env var or retry |
| `Market not found` | conditionId not in top 500 by volume | Market may be low-volume or closed |
| `Market has no tokenIds` | Market closed or not CLOB-deployed | Check `endDate` — may have resolved |
| `Wallet not found: main` | No ecosystem wallet | Run `polygon-agent wallet create` |
| `Builder EOA not found` | Setup not done | Run `polygon-agent setup` |
| `Session expired` | 24h session window elapsed | Re-run `polygon-agent wallet create` |
| `clob-buy` fails with approval error | Proxy wallet not approved | Run `polygon-agent polymarket approve --broadcast` |

---

## Key Behaviours

| Behaviour | Detail |
|-----------|--------|
| Dry-run by default | `approve`, `clob-buy`, `sell` without `--broadcast` show a plan; no funds moved |
| Proxy wallet is permanent | Same address forever — derived from EOA via CREATE2. Token balances persist across sessions. |
| Approvals are one-time | Run `approve --broadcast` once. Permanent on-chain — no need to repeat unless switching to neg-risk markets. |
| CLOB-only flow | `clob-buy` buys tokens directly from the order book. No minting/splitting. |
| CLOB auth is stateless | Credentials derived on-the-fly via `createOrDeriveApiKey()` from the EOA private key. No stored CLOB API keys needed. |
| `ethers5` alias | `@polymarket/clob-client` requires ethers v5. It is aliased as `ethers5` in `package.json` alongside the main `ethers` v6 dependency. Both coexist without conflict. |
