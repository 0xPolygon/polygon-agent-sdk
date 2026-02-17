---
name: polygon-agent-kit
description: Complete Polygon agent development toolkit with full ERC-8004 integration. Builder setup (1 command), ecosystem wallet (session-based), token operations (send POL/ERC20, DEX swaps via Trails), agent registry (identity + reputation), feedback system. Chain-specific indexer with RPC fallback, encrypted storage at ~/.polygon-agent/
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

#### Option A: Webhook Callback (Recommended — zero copy/paste)

```bash
# Step 1: Set environment variables
export SEQUENCE_PROJECT_ACCESS_KEY=<access-key-from-phase-1>
export SEQUENCE_DAPP_ORIGIN=https://your-connector-url
export SEQUENCE_ECOSYSTEM_CONNECTOR_URL=https://your-connector-url

# Step 2: Create wallet with --wait (starts local HTTP server, waits for callback)
node cli/polygon-agent.mjs wallet create --name main --chain polygon --wait
```

The CLI starts a temporary HTTP server on a random localhost port and outputs a URL. Open the URL in a browser, approve the session — the connector UI automatically POSTs the encrypted session back to the CLI. No copy/paste needed.

#### Session Permission Parameters

When creating a wallet, you can control the session's spending permissions via flags. Without these, the session gets bare-bones defaults and the agent may not be able to transact.

**Token spending limits** — set maximum amounts the session can transfer:
```bash
node cli/polygon-agent.mjs wallet create --name main --chain polygon --wait \
  --native-limit 10 \
  --usdc-limit 100 \
  --usdt-limit 50
```

**Generic token limits** — set limits for any token by symbol:
```bash
node cli/polygon-agent.mjs wallet create --name main --chain polygon --wait \
  --token-limit WETH:0.5 \
  --token-limit DAI:1000
```

**One-off ERC20 permission** — scope a single transfer to a specific recipient and amount:
```bash
node cli/polygon-agent.mjs wallet create --name main --chain polygon --wait \
  --usdc-to 0xRecipient... --usdc-amount 25
```
Both `--usdc-to` and `--usdc-amount` must be provided together.

**Contract whitelist** — add specific contracts to the session's allowed targets:
```bash
node cli/polygon-agent.mjs wallet create --name main --chain polygon --wait \
  --contract 0xContractAddress...
```

**Combined example** (agent with full permissions):
```bash
node cli/polygon-agent.mjs wallet create --name main --chain polygon --wait \
  --native-limit 5 \
  --usdc-limit 200 \
  --usdt-limit 100 \
  --token-limit WETH:1 \
  --contract 0xABAAd93EeE2a569cF0632f39B10A9f5D734777ca
```

| Flag | Purpose |
|------|---------|
| `--native-limit <amount>` | Max native currency (POL) the session can spend |
| `--usdc-limit <amount>` | Max USDC the session can transfer |
| `--usdt-limit <amount>` | Max USDT the session can transfer |
| `--token-limit <SYM:amount>` | Max amount for any token by symbol (repeatable) |
| `--usdc-to <addr>` | Restrict USDC transfer to this recipient (requires `--usdc-amount`) |
| `--usdc-amount <amount>` | USDC transfer amount for `--usdc-to` recipient |
| `--contract <addr>` | Whitelist a contract address for the session (repeatable) |

**Output** (initial):
```json
{
  "ok": true,
  "walletName": "main",
  "chain": "polygon",
  "rid": "...",
  "url": "https://connector-url/link?rid=...&callbackUrl=http://localhost:54321/callback",
  "callbackPort": 54321,
  "message": "Waiting for session approval (timeout 300s)... Open URL in browser."
}
```

**Output** (after approval):
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

Optional: `--timeout <seconds>` to change the wait timeout (default 300s / 5 min).

#### Option B: Manual ciphertext (fallback)

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

**Send native POL**:
```bash
node cli/polygon-agent.mjs send-native --wallet main --to 0x... --amount 1.5 --broadcast
```

**Send ERC20 tokens**:
```bash
node cli/polygon-agent.mjs send-token --wallet main --symbol USDC --to 0x... --amount 10 --broadcast
```

**Swap tokens**:
```bash
# Execute DEX swap via Trails API
node cli/polygon-agent.mjs swap --wallet main --from USDC --to USDT --amount 5 --slippage 0.005 --broadcast

# Dry run (preview without broadcasting)
node cli/polygon-agent.mjs swap --wallet main --from USDC --to USDT --amount 5
```

### Phase 4: ERC-8004 Agent Registry

**Contracts** (Polygon mainnet):
- IdentityRegistry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- ReputationRegistry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

**Register your agent**:
```bash
# Simple registration
node cli/polygon-agent.mjs register --wallet main --name "MyAgent" --broadcast

# With metadata URI
node cli/polygon-agent.mjs register --wallet main --name "MyAgent" \
  --agent-uri "ipfs://Qm..." --broadcast

# With custom metadata
node cli/polygon-agent.mjs register --wallet main --name "MyAgent" \
  --agent-uri "ipfs://Qm..." \
  --metadata "version=1.0,type=trading" \
  --broadcast
```

**Output**:
```json
{
  "ok": true,
  "contract": "IdentityRegistry",
  "agentName": "MyAgent",
  "txHash": "0x...",
  "explorerUrl": "https://polygonscan.com/tx/0x...",
  "message": "Agent registered! Check transaction for agentId in Registered event."
}
```

**Query agent information**:
```bash
# Get agent's payment wallet
node cli/polygon-agent.mjs agent-wallet --agent-id 123

# Get agent metadata
node cli/polygon-agent.mjs agent-metadata --agent-id 123 --key name

# Get reputation score
node cli/polygon-agent.mjs reputation --agent-id 123

# Read all feedback
node cli/polygon-agent.mjs read-feedback --agent-id 123
```

**Submit feedback on an agent**:
```bash
node cli/polygon-agent.mjs give-feedback \
  --wallet main \
  --agent-id 123 \
  --value 4.5 \
  --tag1 "helpful" \
  --tag2 "fast" \
  --endpoint "api" \
  --broadcast
```

## Commands Reference

### Builder

```bash
polygon-agent builder setup --name <name> [--force]
```

Creates EOA, authenticates, creates project, returns access key. Use `--force` to recreate.

### Wallet

```bash
polygon-agent wallet create --name <name> [--chain polygon] [--wait] [--timeout <sec>] \
  [--native-limit <amt>] [--usdc-limit <amt>] [--usdt-limit <amt>] \
  [--token-limit <SYM:amt>] [--usdc-to <addr> --usdc-amount <amt>] \
  [--contract <addr>]
polygon-agent wallet start-session --name <name> --ciphertext '<blob>|@<file>' [--rid <rid>]
polygon-agent wallet list
```

- `wallet create`: Generates session request URL with optional permission params
- `wallet create --wait`: Creates wallet and waits for callback (zero copy/paste). Starts a temp HTTP server on localhost; connector UI POSTs ciphertext back automatically. Use `--timeout` to set wait time (default 300s).
- `wallet start-session`: Ingests ciphertext from browser approval (supports `@filename`)
- `wallet list`: Shows all configured wallets

### Operations

```bash
polygon-agent balances --wallet <name> [--chain <chain>]
polygon-agent send-native --wallet <name> --to <addr> --amount <num> [--broadcast] [--direct]
polygon-agent send-token --wallet <name> --symbol <SYM> --to <addr> --amount <num> [--broadcast]
polygon-agent swap --wallet <name> --from <SYM> --to <SYM> --amount <num> [--broadcast] [--slippage <num>]
```

- `balances`: Uses IndexerGateway with RPC fallback for testnets
- `send-native`: Send native POL/MATIC via ValueForwarder contract. Use `--direct` to bypass ValueForwarder and send a raw native transfer (useful when session permissions allow direct sends)
- `send-token`: Send ERC20 by symbol (resolves via token-directory)
- `swap`: DEX swap via Trails API with configurable slippage

### Registry (ERC-8004)

**Registration**:
```bash
polygon-agent register --wallet <name> --name <agent-name> [--agent-uri <uri>] [--metadata <k=v,k=v>] [--broadcast]
```

**Query**:
```bash
polygon-agent agent-wallet --agent-id <id>           # Get payment wallet
polygon-agent agent-metadata --agent-id <id> --key <key>  # Get metadata value
polygon-agent reputation --agent-id <id> [--tag1 <tag>]   # Get reputation score
polygon-agent read-feedback --agent-id <id>               # Read all feedback
```

**Feedback**:
```bash
polygon-agent give-feedback --wallet <name> --agent-id <id> --value <score> [--tag1 <tag>] [--tag2 <tag>] [--endpoint <endpoint>] [--broadcast]
```

**Contracts**: IdentityRegistry (`0x8004A169...`), ReputationRegistry (`0x8004BAa1...`)

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
| `SEQUENCE_ECOSYSTEM_WALLET_URL` | Ecosystem wallet URL | `https://acme-wallet.ecosystem-demo.xyz` |
| `TRAILS_API_KEY` | Trails API key for swaps | Falls back to `SEQUENCE_PROJECT_ACCESS_KEY` |
| `TRAILS_TOKEN_MAP_JSON` | JSON override for token addresses per chain (e.g. `{"137":{"USDC":"0x..."}}`) | Token-directory lookup |
| `POLYGON_AGENT_DEBUG_FETCH` | Log all HTTP requests/responses to `~/.polygon-agent/fetch-debug.log` | Off |
| `POLYGON_AGENT_DEBUG_FEE` | Dump fee options to stderr for debugging | Off |

## Key Features

### Agent-First Design
- **Condensed flows**: 3 builder steps → 1 command
- **Clear naming**: `wallet create` vs `create-request`, `wallet start-session` vs `ingest-session`
- **Single entry point**: `polygon-agent.mjs` routes all commands

### Secure Storage
- **Encrypted Config**: Private keys encrypted with AES-256-GCM
- **Auto-Generated Key**: Encryption key at `~/.polygon-agent/.encryption-key` (0600 permissions)
- **Cross-Platform**: File-based storage (no macOS Keychain dependency)

### ERC-8004 Agent Registry

The polygon-agent-kit includes full **ERC-8004 Trustless Agents** integration for Polygon:

**What is ERC-8004?**
- **Decentralized agent identity**: Portable, censorship-resistant identifiers (ERC-721 NFTs)
- **Reputation system**: On-chain feedback collection with value + tags
- **Trust validation**: Discover and choose agents across organizational boundaries

**Three Core Components**:

1. **IdentityRegistry** (`0x8004A169...`)
   - Register agents with metadata URIs (IPFS, HTTPS, data URIs)
   - Set payment wallet (requires EIP-712 or ERC-1271 signature)
   - Store custom metadata (key-value pairs)
   - Returns agentId (ERC-721 token ID)

2. **ReputationRegistry** (`0x8004BAa1...`)
   - Submit feedback (score with decimals + optional tags + endpoint)
   - Aggregate reputation scores across clients
   - Tag-based filtering (e.g., "helpful", "fast", "api")
   - Revoke feedback capability

3. **ValidationRegistry** (not yet integrated)
   - Validator smart contracts for work verification
   - Stake-secured re-execution, zkML proofs, TEE oracles

**Agent Registration Flow**:
```
1. polygon-agent register --wallet main --name "MyAgent" --broadcast
   → Mints ERC-721 NFT with agentId
   → Emits Registered event with agentId, owner, URI

2. Users interact with agent
   → Agent provides services via endpoints (A2A, MCP, etc.)

3. polygon-agent give-feedback --agent-id 123 --value 4.5 --tag1 "helpful"
   → Stores on-chain feedback
   → Updates reputation score

4. polygon-agent reputation --agent-id 123
   → Returns aggregated reputation score
   → Filters by tags if specified
```

**Spec**: https://eips.ethereum.org/EIPS/eip-8004

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Builder configured already` | Use `--force` flag to recreate |
| `Missing SEQUENCE_PROJECT_ACCESS_KEY` | Run `builder setup` first or set env var |
| `Missing wallet` | Check `wallet list`, re-run `wallet create` + `wallet start-session` |
| `Indexer 404/400` | Uses IndexerGateway + RPC fallback (auto-handled) |
| `No native balance on testnet` | RPC fallback activates automatically |
| `Session expired` | Sessions have a 24h deadline. Re-run `wallet create` + `wallet start-session` flow |
| `Explicit session has expired (deadline ...)` | Session deadline has passed. Re-link wallet to mint a fresh session |
| `Fee option errors / insufficient balance` | Set `POLYGON_AGENT_DEBUG_FEE=1` to inspect fee options. Ensure wallet holds native currency for fees |
| `Ciphertext truncated (Telegram)` | Use `wallet create --wait` for zero-copy webhook callback |
| `Timed out waiting for callback` | Increase timeout: `--wait --timeout 600` (10 min) |

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

