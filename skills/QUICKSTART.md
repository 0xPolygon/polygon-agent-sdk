---
name: polygon-agent-kit-quickstart
description: Quick start guide for Polygon Agent Kit. Get project access key, create wallet with session permissions, register agent onchain, perform token operations. Context-efficient workflow for autonomous agents.
---

# Polygon Agent Kit - Quick Start

**Goal**: Zero to operational agent in 4 phases.

## Phase 1: Builder Setup

```bash
node cli/polygon-agent.mjs builder setup --name "MyAgent"
```
Outputs `accessKey` — needed for all wallet operations. Save `privateKey` for backup.

---

## Phase 2: Create Wallet

```bash
export SEQUENCE_PROJECT_ACCESS_KEY=<access-key>
export SEQUENCE_DAPP_ORIGIN=<connector-url>
export SEQUENCE_ECOSYSTEM_CONNECTOR_URL=<connector-url>
```

### Option A: Webhook (Recommended)
```bash
node cli/polygon-agent.mjs wallet create --name agent-wallet --chain polygon --wait
```
Opens URL in browser → approve session → CLI auto-ingests. No copy/paste.

### Option B: Manual
```bash
node cli/polygon-agent.mjs wallet create --name agent-wallet --chain polygon
# Open output URL, approve, copy blob:
node cli/polygon-agent.mjs wallet start-session --name agent-wallet --ciphertext @/tmp/session.txt
```

### Session Permissions

Control what the session can do. Without these, the agent gets bare-bones defaults and may not be able to transact.

```bash
node cli/polygon-agent.mjs wallet create --name agent-wallet --chain polygon --wait \
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

---

## Phase 3: Register Agent (ERC-8004)

```bash
node cli/polygon-agent.mjs register --wallet agent-wallet --name "MyAgent" --broadcast
```
Mints ERC-721 NFT with `agentId`. Check transaction for Registered event.

---

## Phase 4: Token Operations

```bash
# Balances
export SEQUENCE_INDEXER_ACCESS_KEY=<indexer-key>
node cli/polygon-agent.mjs balances --wallet agent-wallet

# Send POL (via ValueForwarder)
node cli/polygon-agent.mjs send-native --wallet agent-wallet --to 0x... --amount 1.0 --broadcast

# Send POL direct (bypass ValueForwarder)
node cli/polygon-agent.mjs send-native --wallet agent-wallet --to 0x... --amount 1.0 --broadcast --direct

# Send ERC20
node cli/polygon-agent.mjs send-token --wallet agent-wallet --symbol USDC --to 0x... --amount 10 --broadcast

# DEX Swap
node cli/polygon-agent.mjs swap --wallet agent-wallet --from USDC --to USDT --amount 5 --slippage 0.005 --broadcast
```

Omit `--broadcast` for dry-run preview.

---

## Commands Summary

| Command | Purpose |
|---------|---------|
| `builder setup` | Get project access key |
| `wallet create --wait` | Create wallet + auto-ingest session |
| `wallet create` | Generate session link (manual flow) |
| `wallet start-session` | Import encrypted session |
| `wallet list` | List configured wallets |
| `register` | Register agent onchain (ERC-8004) |
| `balances` | Check token balances |
| `send-native [--direct]` | Send POL/MATIC |
| `send-token` | Send ERC20 by symbol |
| `swap` | DEX swap via Trails |
| `agent-wallet` | Get agent's payment wallet |
| `reputation` | Get agent reputation score |
| `give-feedback` | Submit on-chain feedback |

---

## Environment Variables

**Required**:
`SEQUENCE_PROJECT_ACCESS_KEY`, `SEQUENCE_DAPP_ORIGIN`, `SEQUENCE_ECOSYSTEM_CONNECTOR_URL`, `SEQUENCE_INDEXER_ACCESS_KEY`

**Optional**: `TRAILS_API_KEY`, `TRAILS_TOKEN_MAP_JSON`, `POLYGON_AGENT_DEBUG_FETCH=1`, `POLYGON_AGENT_DEBUG_FEE=1`

---

## Error Recovery

| Issue | Fix |
|-------|-----|
| Session expired | Re-run `wallet create --wait` |
| Insufficient funds | Fund wallet address with POL |
| Fee errors | Set `POLYGON_AGENT_DEBUG_FEE=1` to inspect |
| Tx failed | Omit `--broadcast` for dry-run first |
| Callback timeout | `--wait --timeout 600` |

---

## Storage

All credentials: `~/.polygon-agent/` (AES-256-GCM encrypted)

Repository: https://github.com/AkshatGada/test-wallet
