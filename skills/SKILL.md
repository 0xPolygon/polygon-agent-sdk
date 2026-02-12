---
name: polygon-agent-kit
description: Complete Polygon agent development toolkit. Builder setup (1 command), ecosystem wallet (session-based), token operations, 8004 registry. Chain-specific indexer with RPC fallback, encrypted storage at ~/.polygon-agent/
---

# Polygon Agent Kit

## Prerequisites

- **Node.js 20+**
- **Location**: Can be cloned anywhere
- **Entry Point**: `cli/polygon-agent.mjs`
- **Storage**: `~/.polygon-agent/` (AES-256-GCM encrypted)

## Three-Wallet Architecture

| Wallet | Created By | Purpose | Fund? |
|--------|-----------|---------|-------|
| **EOA** | builder setup | Authentication with Sequence Builder | NO |
| **Builder Smart Wallet** | Session.singleSigner(EOA + accessKey) | Optional AA wallet | Only if using builder-cli transfers |
| **Ecosystem Wallet** | wallet start-session | PRIMARY spending wallet | YES ✅ |

**Critical**: Fund the **Ecosystem Wallet** only. EOA is for authentication.

## Complete Workflow

### Phase 1: Builder Setup (3-in-1 Command)

Replaces: `create-wallet` + `login` + `projects create`

```bash
cd polygon-agent-kit
node cli/polygon-agent.mjs builder setup --name "MyAgent"
```

**Output**:
```json
{
  "ok": true,
  "privateKey": "0x...",
  "eoaAddress": "0x...",
  "accessKey": "AQAAAA...",
  "projectId": 123,
  "projectName": "MyAgent",
  "message": "Builder configured successfully. Credentials saved to ~/.polygon-agent/builder.json (encrypted)"
}
```

**Important**: Save the `privateKey` for backup. It won't be shown again.

### Phase 2: Ecosystem Wallet Creation

```bash
# Step 1: Set environment variables
export SEQUENCE_PROJECT_ACCESS_KEY=<access-key-from-phase-1>
export SEQUENCE_DAPP_ORIGIN=https://your-connector-url
export SEQUENCE_ECOSYSTEM_CONNECTOR_URL=https://your-connector-url

# Step 2: Create wallet session request
node cli/polygon-agent.mjs wallet create --name main --chain polygon

# Output: { ok, url, rid, expiresAt }
```

**Step 3: User approves in browser** (opens `url` from output)

```bash
# Step 4: Start session with ciphertext from browser
echo '<ciphertext-from-browser>' > /tmp/session.txt
node cli/polygon-agent.mjs wallet start-session --name main --ciphertext @/tmp/session.txt
```

**Output**:
```json
{
  "ok": true,
  "walletName": "main",
  "walletAddress": "0xEco...",
  "chainId": 137,
  "chain": "polygon",
  "message": "Session started successfully. Wallet ready for operations."
}
```

**Action Required**: Fund the `walletAddress` with MATIC and tokens.

### Phase 3: Operations

```bash
# Check balances
export SEQUENCE_INDEXER_ACCESS_KEY=<your-indexer-key>
node cli/polygon-agent.mjs balances --wallet main

# Output: { ok, walletName, walletAddress, chainId, chain, balances: [...] }
```

**Send & Swap** (coming soon):
```bash
# Send tokens (placeholder)
node cli/polygon-agent.mjs send --wallet main --symbol USDC --to 0x... --amount 10 --broadcast

# Swap tokens (placeholder)
node cli/polygon-agent.mjs swap --wallet main --from USDC --to USDT --amount 5 --broadcast
```

### Phase 4: 8004 Registry (Placeholder)

```bash
node cli/polygon-agent.mjs register --wallet main --name "MyAgent" --metadata "ipfs://..."
# Error: Registry integration coming soon
```

**Contracts** (Polygon mainnet):
- IdentityRegistry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- ReputationRegistry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

## Commands Reference

### Builder

```bash
polygon-agent builder setup --name <name> [--force]
```

Creates EOA, authenticates, creates project, returns access key. Use `--force` to recreate.

### Wallet

```bash
polygon-agent wallet create --name <name> [--chain polygon]
polygon-agent wallet start-session --name <name> --ciphertext '<blob>|@<file>' [--rid <rid>]
polygon-agent wallet list
```

- `wallet create`: Generates session request URL
- `wallet start-session`: Ingests ciphertext from browser approval (supports `@filename`)
- `wallet list`: Shows all configured wallets

### Operations

```bash
polygon-agent balances --wallet <name> [--chain <chain>]
polygon-agent send --wallet <name> --symbol <SYM> --to <addr> --amount <num> [--broadcast]
polygon-agent swap --wallet <name> --from <SYM> --to <SYM> --amount <num> [--broadcast]
```

- `balances`: Uses IndexerGateway with RPC fallback for testnets
- `send`/`swap`: Placeholders (coming soon)

### Registry

```bash
polygon-agent register --wallet <name> --name <agent-name> --metadata <ipfs-hash>
```

Placeholder - full 8004 integration coming soon.

## Environment Variables

### Required

| Variable | Purpose | When |
|----------|---------|------|
| `SEQUENCE_PROJECT_ACCESS_KEY` | Project access key | Wallet creation |
| `SEQUENCE_DAPP_ORIGIN` | Connector origin | Wallet creation |
| `SEQUENCE_ECOSYSTEM_CONNECTOR_URL` | Connector URL | Wallet creation |
| `SEQUENCE_INDEXER_ACCESS_KEY` | Indexer API key | Balance checks |

### Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `SEQUENCE_BUILDER_API_URL` | Builder API endpoint | `https://api.sequence.build` |
| `SEQUENCE_INDEXER_URL` | Indexer URL override | `https://indexer.sequence.app/rpc/IndexerGateway/...` |

## Key Features

### Agent-First Design
- **Condensed flows**: 3 builder steps → 1 command
- **Clear naming**: `wallet create` vs `create-request`, `wallet start-session` vs `ingest-session`
- **Single entry point**: `polygon-agent.mjs` routes all commands

### Upstream Fixes Integrated
- **IndexerGateway URL**: Commit `6034ce6` - uses correct `/rpc/IndexerGateway/...` endpoint
- **RPC Fallback**: Commit `722ea1b` - queries RPC when indexer omits native balance (testnets)
- **dotenv Support**: Loads `.env.local` for local development
- **Package Upgrades**: Uses `@0xsequence` beta.15 (latest)

### Secure Storage
- **Encrypted Config**: Private keys encrypted with AES-256-GCM
- **Auto-Generated Key**: Encryption key at `~/.polygon-agent/.encryption-key` (0600 permissions)
- **Cross-Platform**: File-based storage (no macOS Keychain dependency)

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Builder configured already` | Use `--force` flag to recreate |
| `Missing SEQUENCE_PROJECT_ACCESS_KEY` | Run `builder setup` first or set env var |
| `Missing wallet` | Check `wallet list`, re-run `wallet create` + `wallet start-session` |
| `Indexer 404/400` | Uses IndexerGateway + RPC fallback (auto-handled) |
| `No native balance on testnet` | RPC fallback activates automatically |
| `Session expired` | Re-run `wallet create` + `wallet start-session` flow |

## File Structure

```
~/.polygon-agent/
├── .encryption-key           # AES-256-GCM key (auto-generated)
├── builder.json              # { privateKey (encrypted), eoaAddress, accessKey, projectId }
├── wallets/
│   ├── main.json            # { walletAddress, session, chainId, chain }
│   └── agent-wallet.json
└── requests/
    └── <rid>.json           # Pending wallet creation requests
```

## Development Status

### ✅ Implemented
- Builder setup (3-in-1)
- Wallet create + start-session
- Balances with upstream fixes
- Registry placeholder
- Encrypted storage
- SKILL.md documentation

### 🚧 Coming Soon
- Send tokens (requires @0xsequence/wallet integration)
- Swap (requires Trails integration)
- 8004 Registry (IdentityRegistry + ReputationRegistry)
- Token directory integration (symbol → address mapping)

## Example: Full Agent Flow

```bash
# 1. Builder setup
node cli/polygon-agent.mjs builder setup --name "TestAgent"
# Save privateKey + accessKey

# 2. Set environment
export SEQUENCE_PROJECT_ACCESS_KEY=<access-key>
export SEQUENCE_DAPP_ORIGIN=https://connector-url
export SEQUENCE_ECOSYSTEM_CONNECTOR_URL=https://connector-url
export SEQUENCE_INDEXER_ACCESS_KEY=<indexer-key>

# 3. Create wallet
node cli/polygon-agent.mjs wallet create --name test-wallet
# Open URL in browser, approve

# 4. Start session
echo '<ciphertext>' > /tmp/session.txt
node cli/polygon-agent.mjs wallet start-session --name test-wallet --ciphertext @/tmp/session.txt
# Fund walletAddress with MATIC + tokens

# 5. Check balances
node cli/polygon-agent.mjs balances --wallet test-wallet

# 6. List wallets
node cli/polygon-agent.mjs wallet list
```

## Technical Details

### Indexer Integration
- **Endpoint**: `https://indexer.sequence.app/rpc/IndexerGateway/GetTokenBalancesSummary`
- **Chain Parsing**: Extracts chain-specific nested balances from gateway response
- **Native Balance**: RPC fallback via `eth_getBalance` when indexer returns empty
- **Error Handling**: Graceful degradation (RPC fallback on indexer failure)

### Session Management
- **Encryption**: NaCl sealed-box (public-key authenticated encryption)
- **State Persistence**: Request stored at `~/.polygon-agent/requests/<rid>.json`
- **Auto-Detection**: `--rid` optional (auto-detects from request directory)
- **File Input**: Supports `@filename` for large ciphertext blobs

### Builder Authentication
- **ETHAuth**: EIP-712 signed proof format
- **JWT Token**: Returned from `GetAuthToken` API
- **Project Creation**: Single API call with JWT auth
- **Access Key**: Default key auto-fetched via `GetDefaultAccessKey`

## Notes

- **Breaking Change**: This is a NEW project, not compatible with existing openclaw-ecosystem-wallet-skill
- **Reference Only**: Builder-cli and seq-eco code used as reference (not copied)
- **Package Versions**: Uses latest beta.15 (learned from upstream commit 0323e32)
- **Backward Compatibility**: N/A (fresh start with agent-first design)
