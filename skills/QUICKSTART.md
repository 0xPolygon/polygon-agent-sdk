---
name: polygon-agent-kit-quickstart
description: Quick start guide for Polygon Agent Kit. Get project access key, create wallet, register agent onchain, perform token operations. Context-efficient workflow for autonomous agents.
---

# Polygon Agent Kit - Quick Start

**Goal**: Get from zero to operational agent in 4 phases.

## Phase 1: Builder Setup (Get Access Key)

```bash
node cli/polygon-agent.mjs builder setup --name "MyAgent"
```

**Output**: `{ privateKey, eoaAddress, accessKey, projectId }`

**Action**: Save `accessKey` - needed for all wallet operations.

---

## Phase 2: Create Wallet

```bash
# Set environment
export SEQUENCE_PROJECT_ACCESS_KEY=<access-key-from-phase-1>
export SEQUENCE_DAPP_ORIGIN=<your-connector-url>
export SEQUENCE_ECOSYSTEM_CONNECTOR_URL=<your-connector-url>
```

### Option A: Webhook Callback (Recommended)

```bash
node cli/polygon-agent.mjs wallet create --name agent-wallet --chain polygon --wait
```

The CLI starts a temporary HTTP server on localhost and outputs a URL. Open the URL in a browser, approve the session — the connector UI POSTs the encrypted session back automatically. No copy/paste needed.

**Output** (after approval): `{ ok, walletAddress, chainId }`

Optional: `--timeout <seconds>` to change wait time (default 300s).

### Option B: Manual Ciphertext (Fallback)

```bash
# Create wallet request
node cli/polygon-agent.mjs wallet create --name agent-wallet --chain polygon
```

**Output**: `{ ok, rid, url }`

**Action**:
1. Open `url` in browser
2. Click "Connect wallet"
3. Approve session in Ecosystem Wallet
4. Copy encrypted blob

```bash
# Start session with encrypted blob
echo '<blob>' > /tmp/session.txt
node cli/polygon-agent.mjs wallet start-session --name agent-wallet --ciphertext @/tmp/session.txt
```

**Output**: `{ ok, walletAddress, chainId }`

---

**Action**: Fund `walletAddress` with POL + tokens (USDC, USDT, etc.)

---

## Phase 3: Register Agent Onchain (ERC-8004)

```bash
node cli/polygon-agent.mjs register --wallet agent-wallet --name "MyAgent" --broadcast
```

**Output**: `{ ok, txHash, explorerUrl, message }`

**Note**: Check transaction for `agentId` in Registered event.

---

## Phase 4: Token Operations

**Check balances**:
```bash
export SEQUENCE_INDEXER_ACCESS_KEY=<indexer-key>
node cli/polygon-agent.mjs balances --wallet agent-wallet
```

**Send native POL**:
```bash
node cli/polygon-agent.mjs send-native --wallet agent-wallet --to 0x... --amount 1.0 --broadcast
```

**Send ERC20 tokens**:
```bash
node cli/polygon-agent.mjs send-token --wallet agent-wallet --symbol USDC --to 0x... --amount 10 --broadcast
```

**Swap tokens**:
```bash
node cli/polygon-agent.mjs swap --wallet agent-wallet --from USDC --to USDT --amount 5 --slippage 0.005 --broadcast
```

---

## Environment Variables (Required)

```bash
SEQUENCE_PROJECT_ACCESS_KEY=<from-phase-1>
SEQUENCE_DAPP_ORIGIN=<connector-url>
SEQUENCE_ECOSYSTEM_CONNECTOR_URL=<connector-url>
SEQUENCE_INDEXER_ACCESS_KEY=<indexer-key>
```

---

## Storage Location

All credentials stored in: `~/.polygon-agent/`

```
~/.polygon-agent/
├── .encryption-key          # AES-256-GCM key (auto-generated)
├── builder.json             # EOA + project credentials (encrypted)
├── wallets/
│   └── agent-wallet.json   # Wallet session (encrypted)
└── requests/
    └── <rid>.json           # Pending requests
```

---

## Key Commands Summary

| Phase | Command | Purpose |
|-------|---------|---------|
| 1 | `builder setup` | Get project access key |
| 2 | `wallet create --wait` | Create wallet + auto-ingest session |
| 2 | `wallet create` | Generate session link (manual flow) |
| 2 | `wallet start-session` | Import encrypted session (manual flow) |
| 3 | `register` | Register agent onchain (ERC-8004) |
| 4 | `balances` | Check token balances |
| 4 | `send-native` | Send POL/MATIC |
| 4 | `send-token` | Send ERC20 by symbol |
| 4 | `swap` | DEX swap via Trails |

---

## Error Recovery

**Session expired**: Re-run `wallet create` + `wallet start-session`

**Insufficient funds**: Check balances, fund wallet address

**Transaction failed**: Check `--broadcast` flag (omit for dry-run)

**Ciphertext truncated**: Use `wallet create --wait` for webhook callback

**Callback timeout**: Increase with `--wait --timeout 600`

---

## Repository

Public testing repo: https://github.com/AkshatGada/test-wallet
