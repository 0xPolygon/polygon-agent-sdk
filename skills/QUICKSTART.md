---
name: polygon-agent-kit-quickstart
description: Quick start guide for Polygon Agent Kit. Get project access key, create wallet with session permissions, register agent onchain, perform token operations. Context-efficient workflow for autonomous agents.
---

# Polygon Agent Kit - Quick Start

**Goal**: Zero to operational agent in 4 phases.

## Phase 1: Setup

```bash
polygon-agent setup --name "MyAgent"
```
Outputs `accessKey` — needed for all wallet operations. Save `privateKey` for backup.

---

## Phase 2: Create Wallet

```bash
export SEQUENCE_PROJECT_ACCESS_KEY=<access-key-from-phase-1>
```

`SEQUENCE_ECOSYSTEM_CONNECTOR_URL` defaults to `http://localhost:4444` (the connector-ui dev server). Override via env var if hosting elsewhere.

### Option A: Auto-Wait (Default — zero copy/paste)
```bash
polygon-agent wallet create
```
Opens URL in browser → approve session → CLI auto-ingests. No copy/paste.

### Option B: Manual
```bash
polygon-agent wallet create --no-wait
# Open output URL, approve, copy blob:
polygon-agent wallet import --ciphertext @/tmp/session.txt
```

### Session Permissions

Control what the session can do. Without these, the agent gets bare-bones defaults and may not be able to transact.

```bash
polygon-agent wallet create \
  --native-limit 5 \
  --usdc-limit 100 \
  --usdt-limit 50 \
  --token-limit WETH:0.5 \
  --contract 0xABAAd93EeE2a569cF0632f39B10A9f5D734777ca
```

| Flag | Purpose |
|------|---------|
| `--native-limit <amt>` | Max POL the session can spend |
| `--usdc-limit <amt>` | Max USDC the session can transfer |
| `--usdt-limit <amt>` | Max USDT the session can transfer |
| `--token-limit <SYM:amt>` | Max for any token by symbol (repeatable) |
| `--usdc-to <addr>` | Restrict USDC to this recipient (requires `--usdc-amount`) |
| `--usdc-amount <amt>` | USDC amount for `--usdc-to` recipient |
| `--contract <addr>` | Whitelist contract address (repeatable) |

**After approval**: Fund `walletAddress` with POL + tokens.

### Fund wallet via Trails
```bash
polygon-agent fund
```
Opens a Trails widget URL pre-filled with your wallet address. Open the URL in a browser to swap/bridge tokens into your wallet.

---

## Phase 3: Register Agent (ERC-8004)

```bash
polygon-agent agent register --name "MyAgent" --broadcast
```
Mints ERC-721 NFT with `agentId`. Check transaction for Registered event.

---

## Phase 4: Token Operations

```bash
# Balances
export SEQUENCE_INDEXER_ACCESS_KEY=<indexer-key>
polygon-agent balances

# Send POL (via ValueForwarder)
polygon-agent send --to 0x... --amount 1.0 --broadcast

# Send POL direct (bypass ValueForwarder)
polygon-agent send-native --to 0x... --amount 1.0 --broadcast --direct

# Send ERC20
polygon-agent send --symbol USDC --to 0x... --amount 10 --broadcast

# DEX Swap
polygon-agent swap --from USDC --to USDT --amount 5 --slippage 0.005 --broadcast
```

Omit `--broadcast` for dry-run preview.

---

## Commands Summary

| Command | Purpose |
|---------|---------|
| `setup` | Get project access key |
| `wallet create` | Create wallet (auto-waits for approval) |
| `wallet create --no-wait` | Generate session link (manual flow) |
| `wallet import` | Import encrypted session |
| `wallet list` | List configured wallets |
| `agent register` | Register agent onchain (ERC-8004) |
| `fund` | Open Trails widget to fund wallet |
| `balances` | Check token balances |
| `send [--symbol SYM]` | Send native or ERC20 |
| `send-native [--direct]` | Send POL/MATIC (explicit) |
| `send-token` | Send ERC20 by symbol (explicit) |
| `swap` | DEX swap via Trails |
| `agent wallet` | Get agent's payment wallet |
| `agent reputation` | Get agent reputation score |
| `agent feedback` | Submit on-chain feedback |
| `agent reviews` | Read all agent feedback |

**Smart defaults**: `--wallet main`, `--chain polygon`, `--name main`. Most commands need zero flags.

---

## Environment Variables

**Required**:
`SEQUENCE_PROJECT_ACCESS_KEY` (from setup), `SEQUENCE_INDEXER_ACCESS_KEY` (for balance checks)

**Defaults** (override if needed):
`SEQUENCE_ECOSYSTEM_CONNECTOR_URL` → `http://localhost:4444`

**Optional**: `TRAILS_API_KEY`, `TRAILS_TOKEN_MAP_JSON`, `POLYGON_AGENT_DEBUG_FETCH=1`, `POLYGON_AGENT_DEBUG_FEE=1`

---

## Error Recovery

| Issue | Fix |
|-------|-----|
| Session expired | Re-run `wallet create` |
| Insufficient funds | Fund wallet address with POL |
| Fee errors | Set `POLYGON_AGENT_DEBUG_FEE=1` to inspect |
| Tx failed | Omit `--broadcast` for dry-run first |
| Callback timeout | `--timeout 600` |

---

## Storage

All credentials: `~/.polygon-agent/` (AES-256-GCM encrypted)

Repository: https://github.com/0xPolygon/polygon-agent-kit
