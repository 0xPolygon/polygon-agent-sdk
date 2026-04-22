---
name: polymarket-skill
description: Place bets on Polymarket prediction markets using the Polygon Agent CLI. Browse markets, check prices, buy YES/NO positions, sell positions, manage orders. All commands are JSON output. Dry-run by default — always add --broadcast to execute.
---

# Polymarket Skill

## Session Initialization

Before any polymarket command, verify the Polymarket key is set:

```bash
polygon-agent polymarket proxy-wallet
```

If this returns `ok: true` with an `eoaAddress` and `proxyWalletAddress`, the key is configured and you can proceed directly to trading. If it errors, the user needs to run `set-key` (see Onboarding below).

---

## Understanding the 3 Addresses

Every Polymarket user has three addresses. Do not confuse them:

| Name | What it is | Used for |
|------|-----------|---------|
| EOA | Private key owner. Shown as `eoaAddress` in CLI output | Signs transactions and CLOB orders. Needs POL for gas only when running `approve` |
| Proxy Wallet | Shown as `proxyWalletAddress` in CLI output. This is what Polymarket shows as "your address" in the UI | Holds USDC.e and outcome tokens. The CLOB `maker` |
| Smart Wallet | The Sequence wallet (`polygon-agent wallet`) | Funds the proxy wallet with USDC.e per trade |

**For trading:** USDC.e flows from the Sequence smart wallet → proxy wallet → CLOB orders. The proxy wallet is the trading identity.

---

## Pre-Trade Checklist

Before placing a trade, verify these four things in order:

**1. EOA key is configured**
```bash
polygon-agent polymarket proxy-wallet
# → must return ok: true with eoaAddress and proxyWalletAddress
```

**2. ToS accepted on Polymarket** ← one-time per EOA, permanent
- Visit https://polymarket.com, connect with the EOA address, accept Terms of Service
- If ToS is not accepted, CLOB order posting will fail with `not authorized`
- If the user has previously traded on Polymarket with this EOA, ToS is already accepted — skip this

**3. Proxy wallet approvals set** ← one-time per EOA, permanent on-chain
- Approvals allow the proxy wallet to interact with the CTF exchange contract
- If the user has previously traded with this EOA (on CLI or Polymarket UI), approvals are already set — **skip `approve --broadcast`**
- Only run `approve --broadcast` for a brand new EOA that has never traded before
- Check: if `clob-buy` dry-run output shows `flow: ["Smart wallet → fund proxy wallet...", "Place CLOB BUY order..."]` without any approval warnings, approvals are likely already set

**4. Smart wallet has USDC.e** ← required per trade, minimum $1
```bash
polygon-agent balances
# → check USDC.e balance (0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174)
# → must have at least $1 USDC.e to place any order
```

---

## Onboarding: First-Time Setup (New EOA Only)

Skip this section entirely if the user has previously traded on Polymarket with their EOA.

### Option A — Using email login (existing Polymarket account)

**Step 1: Get the private key from Polymarket**
```
1. Go to: https://reveal.magic.link/polymarket
2. Connect/authenticate with the same email used for Polymarket
3. Copy the exported private key (0x...)
```

**Step 2: Import the key into the CLI**
```bash
polygon-agent polymarket set-key <privateKey>
```
Output confirms the `eoaAddress` and `proxyWalletAddress`.

**Step 3: Show the user their addresses**
```bash
polygon-agent polymarket proxy-wallet
```
Tell the user: "Your EOA is `<eoaAddress>` — this needs a small amount of POL for the one-time approval step. Your Polymarket trading address (proxy wallet) is `<proxyWalletAddress>` — this is where your USDC.e and outcome tokens live."

**Step 4: Fund EOA with POL for gas (approval step only)**
```bash
polygon-agent send-native --to <eoaAddress> --amount 0.1 --broadcast
```
The EOA only needs POL for the one-time `approve` transaction. After that, trading requires no gas from the EOA.

**Step 5: Accept Terms of Service**
```
1. Go to https://polymarket.com
2. Connect with the EOA address
3. Accept Terms of Service when prompted
```

**Step 6: Set proxy wallet approvals (one-time, permanent)**
```bash
polygon-agent polymarket approve --broadcast
```
This is permanent on-chain. Never needs to be run again for this EOA.

### Option B — Using the builder EOA (no Polymarket account)

**Step 1: Confirm addresses**
```bash
polygon-agent polymarket proxy-wallet
```

**Step 2: Accept Terms of Service (required)**
```
1. Go to https://polymarket.com
2. Connect with the EOA address shown above
3. Accept Terms of Service when prompted
```

**Step 3: Fund EOA with POL for gas**
```bash
polygon-agent send-native --to <eoaAddress> --amount 0.1 --broadcast
```

**Step 4: Set proxy wallet approvals (one-time)**
```bash
polygon-agent polymarket approve --broadcast
```

---

## Commands

### Browse Markets

```bash
# List top markets by volume
polygon-agent polymarket markets

# Search by keyword
polygon-agent polymarket markets --search "bitcoin" --limit 10

# Paginate
polygon-agent polymarket markets --limit 20 --offset 20
```

Key output fields per market:
- `conditionId` — the ID needed for all trading commands
- `question` — what the market is asking
- `yesPrice` / `noPrice` — current probability (0 to 1, e.g. `0.65` = 65%)
- `negRisk` — if `true`, set neg-risk approvals before trading this market
- `endDate` — when the market resolves

### Get a Single Market

```bash
polygon-agent polymarket market <conditionId>
```

Use this to confirm prices and token IDs before placing an order.

### Show Proxy Wallet Address

```bash
polygon-agent polymarket proxy-wallet
```

Confirms which EOA and proxy wallet are active. The proxy wallet is where USDC.e and tokens are held.

### Set Approvals (One-Time Only — Skip if EOA Has Traded Before)

```bash
# Standard markets
polygon-agent polymarket approve --broadcast

# Neg-risk markets (only if you see negRisk: true on a market you want to trade)
polygon-agent polymarket approve --neg-risk --broadcast
```

**Only run this for a brand new EOA that has never traded on Polymarket.** Approvals are permanent on-chain — running it again on an already-approved EOA wastes gas but does no harm.

### Buy a Position

```bash
# Dry-run first — always check before executing
polygon-agent polymarket clob-buy <conditionId> YES|NO <usdcAmount>

# Execute — funds proxy wallet from smart wallet, then places order
polygon-agent polymarket clob-buy <conditionId> YES|NO <usdcAmount> --broadcast

# If proxy wallet already has USDC.e from a previous failed order (skip the funding step)
polygon-agent polymarket clob-buy <conditionId> YES|NO <usdcAmount> --skip-fund --broadcast

# Limit order — fill only at this price or better
polygon-agent polymarket clob-buy <conditionId> YES <usdcAmount> --price 0.45 --broadcast
```

**How it works:**
1. Smart wallet transfers `usdcAmount` USDC.e to the proxy wallet (Sequence tx, USDC.e fee)
2. Posts CLOB BUY order: maker=proxy wallet, signer=EOA (off-chain, no gas)
3. Tokens arrive in proxy wallet on fill

**Order types:**
- No `--price`: FOK market order (fill entirely or cancel)
- `--fak`: FAK market order (partial fills allowed)
- `--price 0.x`: GTC limit order (stays open until filled or cancelled)

**Minimum order size: $1 USDC.** The CLOB rejects orders below $1. If the fund step runs but the order is rejected, the USDC.e stays in the proxy wallet — use `--skip-fund` on the retry.

### Sell a Position

```bash
# Dry-run first
polygon-agent polymarket sell <conditionId> YES|NO <shares>

# Execute
polygon-agent polymarket sell <conditionId> YES|NO <shares> --broadcast

# Limit sell
polygon-agent polymarket sell <conditionId> YES <shares> --price 0.80 --broadcast
```

`<shares>` is the number of outcome tokens (not USD). Get share count from `positions`.
Selling is pure off-chain — no gas, no on-chain tx.

### Check Positions

```bash
polygon-agent polymarket positions
```

Shows all open positions in the proxy wallet with current value, P&L, and outcome.

### Check Open Orders

```bash
polygon-agent polymarket orders
```

Lists GTC limit orders that are still open (FOK/FAK orders are never "open" — they fill or cancel immediately).

### Cancel an Order

```bash
polygon-agent polymarket cancel <orderId>
```

Get `orderId` from the `orders` command or from the `orderId` field in `clob-buy` output.

---

## Full Autonomous Trading Flow

```bash
# ── IF NEW EOA (run once, then never again) ──────────────────────────────

# 1. Import Polymarket private key
polygon-agent polymarket set-key 0x<yourPrivateKey>
# → save eoaAddress and proxyWalletAddress

# 2. Accept ToS at https://polymarket.com (connect EOA, accept when prompted)

# 3. Fund EOA with POL for the one-time approval tx
polygon-agent send-native --to <eoaAddress> --amount 0.1 --broadcast

# 4. Set approvals (one-time, permanent)
polygon-agent polymarket approve --broadcast

# ── IF RETURNING USER (EOA has traded before) ────────────────────────────
# Skip all steps above. Go straight to trading.

# ── FIND A MARKET ────────────────────────────────────────────────────────

# 5. Search for markets
polygon-agent polymarket markets --search "bitcoin" --limit 10

# 6. Get details on a specific market
polygon-agent polymarket market 0x<conditionId>
# → check: yesPrice, noPrice, negRisk, endDate
# → if negRisk: true → run approve --neg-risk --broadcast first

# ── ENTER A POSITION ────────────────────────────────────────────────────

# 7. Dry-run to confirm
polygon-agent polymarket clob-buy 0x<conditionId> YES 5
# → review: currentPrice, proxyWalletAddress, flow

# 8. Execute
polygon-agent polymarket clob-buy 0x<conditionId> YES 5 --broadcast
# → check: orderStatus === "matched"

# ── MANAGE ──────────────────────────────────────────────────────────────

# 9. Check positions
polygon-agent polymarket positions
# → review: size (shares), curPrice, cashPnl

# 10. Sell when ready
polygon-agent polymarket sell 0x<conditionId> YES <shares> --broadcast
# → orderStatus === "matched" means USDC.e is back in proxy wallet
```

---

## Decision Logic for an Autonomous Agent

When deciding whether to buy:
1. Run `proxy-wallet` — confirm EOA and proxy wallet addresses
2. Run `balances` — confirm smart wallet has at least $1 USDC.e
3. Check `positions` — avoid doubling up on already-held positions
4. Check `markets` — use `yesPrice`/`noPrice` as probability inputs
5. Check `negRisk` on the target market — if `true`, verify neg-risk approvals were set
6. Use `--skip-fund` if the proxy wallet already has enough USDC.e from a previous attempt
7. Always dry-run first, then broadcast

When deciding whether to sell:
1. Get current `size` (shares) from `positions`
2. Use `curPrice` vs `avgPrice` to assess profit/loss
3. Market sell (`sell --broadcast`) for immediate exit
4. Limit sell (`--price 0.x --broadcast`) to wait for a better price

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `No EOA key found` | `set-key` not run | Run `polygon-agent polymarket set-key <pk>` |
| `Could not create api key` (stderr only) | ToS not accepted | Non-fatal — CLI retries with `deriveApiKey` and may still succeed. If orders fail too, visit polymarket.com and accept ToS with the EOA |
| `CLOB order error: not authorized` | ToS not accepted | Visit polymarket.com, connect EOA wallet, accept terms |
| `insufficient funds for gas` | EOA has no POL | `polygon-agent send-native --to <eoaAddress> --amount 0.1 --broadcast` |
| `Market not found` | Low-volume or closed market | Market may have resolved; try `--search` with different terms |
| `Market has no tokenIds` | Closed market | Check `endDate` — market resolved |
| `orderStatus: "unmatched"` on FOK | No liquidity at market price | Try `--fak` for partial fill, or `--price 0.x` for limit order |
| `invalid amount for a marketable BUY order ($X), min size: $1` | Amount below CLOB minimum | Use at least $1. If USDC.e was already funded, retry with `--skip-fund` |
| `Wallet not found: main` | No Sequence wallet | Run `polygon-agent wallet create` |
| `No signer supported for call` | Wallet session missing USDC.e whitelist | Re-create wallet session: `polygon-agent wallet create --name main` |

---

## Key Facts for Agents

- **All commands are dry-run by default.** `approve`, `clob-buy`, `sell` do nothing without `--broadcast`.
- **Approvals are one-time and permanent.** If the EOA has traded before, skip `approve` entirely.
- **`clob-buy` transfers USDC.e from the smart wallet to the proxy wallet automatically** (unless `--skip-fund`).
- **Positions live in the proxy wallet**, not the Sequence smart wallet. `positions` queries the proxy wallet.
- **Sell is free.** No gas, no on-chain tx. Selling via CLOB is a signed off-chain message only.
- **`orderStatus: "matched"`** means the trade filled. `"unmatched"` means FOK failed (no liquidity).
- **The proxy wallet address never changes.** It is deterministic from the EOA via CREATE2.
- **`Could not create api key` in stderr is non-fatal.** The CLI handles this automatically.
