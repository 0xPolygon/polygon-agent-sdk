---
name: polygon-agent-kit
description: Complete Polygon agent development toolkit with full ERC-8004 integration. Setup (1 command), ecosystem wallet (session-based), token operations (send POL/ERC20, DEX swaps via Trails), agent registry (identity + reputation), feedback system. Chain-specific indexer with RPC fallback, encrypted storage at ~/.polygon-agent/
---

# Polygon Agent Kit

## Prerequisites

- **Node.js 20+**
- **Location**: Can be cloned anywhere
- **Entry Point**: `cli/polygon-agent.mjs`
- **Storage**: `~/.polygon-agent/` (AES-256-GCM encrypted)

## Smart Defaults

| Default | Value | Override |
|---------|-------|----------|
| Wallet name | `main` | `--name <name>` or `--wallet <name>` |
| Chain | `polygon` | `--chain <name\|id>` |
| Wallet create | Auto-wait for approval | `--no-wait` |
| Broadcast | Dry-run (preview only) | `--broadcast` to execute |

## Three-Wallet Architecture

| Wallet | Created By | Purpose | Fund? |
|--------|-----------|---------|-------|
| **EOA** | setup | Authentication with Sequence Builder | NO |
| **Builder Smart Wallet** | Session.singleSigner(EOA + accessKey) | Optional AA wallet | Only if using builder-cli transfers |
| **Ecosystem Wallet** | wallet create | PRIMARY spending wallet | YES |

**Critical**: Fund the **Ecosystem Wallet** only. EOA is for authentication.

## Complete Workflow

### Phase 1: Setup (3-in-1 Command)

Replaces: `create-wallet` + `login` + `projects create`

```bash
cd polygon-agent-kit
polygon-agent setup --name "MyAgent"
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

#### Option A: Auto-Wait (Default — zero copy/paste)

```bash
# Step 1: Set environment variables
export SEQUENCE_PROJECT_ACCESS_KEY=<access-key-from-phase-1>

# Step 2: Create wallet (starts local HTTP server, waits for callback)
polygon-agent wallet create
```

`SEQUENCE_ECOSYSTEM_CONNECTOR_URL` defaults to `http://localhost:4444` (the connector-ui dev server). Override via env var if hosting elsewhere.

The CLI starts a temporary HTTP server on a random localhost port and outputs a URL. Open the URL in a browser, approve the session — the connector UI automatically POSTs the encrypted session back to the CLI. No copy/paste needed.

#### Session Permission Parameters

When creating a wallet, you can control the session's spending permissions via flags. Without these, the session gets bare-bones defaults and the agent may not be able to transact.

**Token spending limits** — set maximum amounts the session can transfer:
```bash
polygon-agent wallet create \
  --native-limit 10 \
  --usdc-limit 100 \
  --usdt-limit 50
```

**Generic token limits** — set limits for any token by symbol:
```bash
polygon-agent wallet create \
  --token-limit WETH:0.5 \
  --token-limit DAI:1000
```

**One-off ERC20 permission** — scope a single transfer to a specific recipient and amount:
```bash
polygon-agent wallet create \
  --usdc-to 0xRecipient... --usdc-amount 25
```
Both `--usdc-to` and `--usdc-amount` must be provided together.

**Contract whitelist** — add specific contracts to the session's allowed targets:
```bash
polygon-agent wallet create \
  --contract 0xContractAddress...
```

**Combined example** (agent with full permissions):
```bash
polygon-agent wallet create \
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

# Step 2: Create wallet session request (manual mode)
polygon-agent wallet create --no-wait

# Output: { ok, url, rid, expiresAt }
```

**Step 3: User approves in browser** (opens `url` from output)

```bash
# Step 4: Import session with ciphertext from browser
echo '<ciphertext-from-browser>' > /tmp/session.txt
polygon-agent wallet import --ciphertext @/tmp/session.txt
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

### Fund Wallet via Trails

```bash
polygon-agent fund
```

Opens a Trails widget URL pre-filled with your wallet address. Open the URL in a browser to swap/bridge tokens into your wallet. Defaults to USDC on Polygon.

**Output**:
```json
{
  "ok": true,
  "walletName": "main",
  "walletAddress": "0xEco...",
  "chainId": 137,
  "fundingUrl": "https://demo.trails.build/?mode=swap&toAddress=0xEco...&toChainId=137&toToken=0x...&apiKey=...&theme=light",
  "message": "Open the funding URL in your browser to fund your wallet via Trails."
}
```

### Phase 3: Operations

```bash
# Check balances
export SEQUENCE_INDEXER_ACCESS_KEY=<your-indexer-key>
polygon-agent balances

# Output: { ok, walletName, walletAddress, chainId, chain, balances: [...] }
```

**Send native POL**:
```bash
polygon-agent send --to 0x... --amount 1.5 --broadcast
```

**Send ERC20 tokens**:
```bash
polygon-agent send --symbol USDC --to 0x... --amount 10 --broadcast
```

**Swap tokens**:
```bash
# Execute DEX swap via Trails API
polygon-agent swap --from USDC --to USDT --amount 5 --slippage 0.005 --broadcast

# Dry run (preview without broadcasting)
polygon-agent swap --from USDC --to USDT --amount 5
```

### Phase 4: ERC-8004 Agent Registry

**Contracts** (Polygon mainnet):
- IdentityRegistry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- ReputationRegistry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

**Register your agent**:
```bash
# Simple registration
polygon-agent agent register --name "MyAgent" --broadcast

# With metadata URI
polygon-agent agent register --name "MyAgent" \
  --agent-uri "ipfs://Qm..." --broadcast

# With custom metadata
polygon-agent agent register --name "MyAgent" \
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
polygon-agent agent wallet --agent-id 123

# Get agent metadata
polygon-agent agent metadata --agent-id 123 --key name

# Get reputation score
polygon-agent agent reputation --agent-id 123

# Read all feedback
polygon-agent agent reviews --agent-id 123
```

**Submit feedback on an agent**:
```bash
polygon-agent agent feedback \
  --agent-id 123 \
  --value 4.5 \
  --tag1 "helpful" \
  --tag2 "fast" \
  --endpoint "api" \
  --broadcast
```

## Commands Reference

### Setup

```bash
polygon-agent setup --name <name> [--force]
```

Creates EOA, authenticates, creates project, returns access key. Use `--force` to recreate.

Alias: `builder setup` (legacy)

### Wallet

```bash
polygon-agent wallet create [--name <name>] [--chain polygon] [--timeout <sec>] \
  [--native-limit <amt>] [--usdc-limit <amt>] [--usdt-limit <amt>] \
  [--token-limit <SYM:amt>] [--usdc-to <addr> --usdc-amount <amt>] \
  [--contract <addr>]
polygon-agent wallet create --no-wait [--name <name>]
polygon-agent wallet import --ciphertext '<blob>|@<file>' [--name <name>] [--rid <rid>]
polygon-agent wallet list
polygon-agent wallet address [--name <name>]
polygon-agent wallet remove [--name <name>]
```

- `wallet create`: Creates wallet and waits for callback (default, zero copy/paste). Starts a temp HTTP server on localhost; connector UI POSTs ciphertext back automatically. Use `--timeout` to set wait time (default 300s).
- `wallet create --no-wait`: Generates session request URL (manual flow)
- `wallet import`: Ingests ciphertext from browser approval (supports `@filename`)
- `wallet list`: Shows all configured wallets

Alias: `wallet start-session` (legacy for `wallet import`)

### Fund

```bash
polygon-agent fund [--wallet <name>] [--token <address>]
```

Opens a Trails widget URL to fund the wallet. Defaults to USDC on Polygon.

### Operations

```bash
polygon-agent balances [--wallet <name>] [--chain <chain>]
polygon-agent send --to <addr> --amount <num> [--symbol <SYM>] [--broadcast]
polygon-agent send-native --to <addr> --amount <num> [--broadcast] [--direct]
polygon-agent send-token --symbol <SYM> --to <addr> --amount <num> [--broadcast]
polygon-agent swap --from <SYM> --to <SYM> --amount <num> [--broadcast] [--slippage <num>]
```

- `balances`: Uses IndexerGateway with RPC fallback for testnets
- `send`: Auto-detects native vs ERC20 based on `--symbol`/`--token` flag presence
- `send-native`: Send native POL/MATIC via ValueForwarder contract. Use `--direct` to bypass ValueForwarder
- `send-token`: Send ERC20 by symbol (resolves via token-directory)
- `swap`: DEX swap via Trails API with configurable slippage

### Agent (ERC-8004)

**Registration**:
```bash
polygon-agent agent register --name <agent-name> [--agent-uri <uri>] [--metadata <k=v,k=v>] [--broadcast]
```

**Query**:
```bash
polygon-agent agent wallet --agent-id <id>
polygon-agent agent metadata --agent-id <id> --key <key>
polygon-agent agent reputation --agent-id <id> [--tag1 <tag>]
polygon-agent agent reviews --agent-id <id>
```

**Feedback**:
```bash
polygon-agent agent feedback --agent-id <id> --value <score> [--tag1 <tag>] [--tag2 <tag>] [--endpoint <endpoint>] [--broadcast]
```

**Contracts**: IdentityRegistry (`0x8004A169...`), ReputationRegistry (`0x8004BAa1...`)

Legacy aliases: `register`, `agent-wallet`, `agent-metadata`, `reputation`, `give-feedback`, `read-feedback`

## Environment Variables

### Required

| Variable | Purpose | When |
|----------|---------|------|
| `SEQUENCE_PROJECT_ACCESS_KEY` | Project access key (from `setup`) | Wallet creation, swaps |
| `SEQUENCE_INDEXER_ACCESS_KEY` | Indexer API key | Balance checks |

### Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `SEQUENCE_ECOSYSTEM_CONNECTOR_URL` | Connector UI URL for wallet creation | `http://localhost:4444` |
| `SEQUENCE_BUILDER_API_URL` | Builder API endpoint | `https://api.sequence.build` |
| `SEQUENCE_INDEXER_URL` | Indexer URL override | `https://indexer.sequence.app/rpc/IndexerGateway/...` |
| `SEQUENCE_ECOSYSTEM_WALLET_URL` | Ecosystem wallet URL | `https://acme-wallet.ecosystem-demo.xyz` |
| `TRAILS_API_KEY` | Trails API key for swaps | Falls back to `SEQUENCE_PROJECT_ACCESS_KEY` |
| `TRAILS_TOKEN_MAP_JSON` | JSON override for token addresses per chain (e.g. `{"137":{"USDC":"0x..."}}`) | Token-directory lookup |
| `POLYGON_AGENT_DEBUG_FETCH` | Log all HTTP requests/responses to `~/.polygon-agent/fetch-debug.log` | Off |
| `POLYGON_AGENT_DEBUG_FEE` | Dump fee options to stderr for debugging | Off |

## Key Features

### Agent-First Design
- **Smart defaults**: `--wallet main`, `--chain polygon`, auto-wait mode — most commands need zero flags
- **Condensed flows**: 3 builder steps → 1 command
- **Grouped commands**: `agent register`, `agent reputation`, `agent feedback` under one namespace
- **Single entry point**: `polygon-agent` routes all commands

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
1. polygon-agent agent register --name "MyAgent" --broadcast
   → Mints ERC-721 NFT with agentId
   → Emits Registered event with agentId, owner, URI

2. Users interact with agent
   → Agent provides services via endpoints (A2A, MCP, etc.)

3. polygon-agent agent feedback --agent-id 123 --value 4.5 --tag1 "helpful" --broadcast
   → Stores on-chain feedback
   → Updates reputation score

4. polygon-agent agent reputation --agent-id 123
   → Returns aggregated reputation score
   → Filters by tags if specified
```

**Spec**: https://eips.ethereum.org/EIPS/eip-8004

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Builder configured already` | Use `--force` flag to recreate |
| `Missing SEQUENCE_PROJECT_ACCESS_KEY` | Run `setup` first or set env var |
| `Missing wallet` | Check `wallet list`, re-run `wallet create` |
| `Indexer 404/400` | Uses IndexerGateway + RPC fallback (auto-handled) |
| `No native balance on testnet` | RPC fallback activates automatically |
| `Session expired` | Sessions have a 24h deadline. Re-run `wallet create` |
| `Explicit session has expired (deadline ...)` | Session deadline has passed. Re-link wallet to mint a fresh session |
| `Fee option errors / insufficient balance` | Set `POLYGON_AGENT_DEBUG_FEE=1` to inspect fee options. Ensure wallet holds native currency for fees |
| `Ciphertext truncated (Telegram)` | Use default `wallet create` (auto-wait mode) |
| `Timed out waiting for callback` | Increase timeout: `--timeout 600` (10 min) |

## File Structure

```
~/.polygon-agent/
├── .encryption-key           # AES-256-GCM key (auto-generated)
├── builder.json              # { privateKey (encrypted), eoaAddress, accessKey, projectId }
├── wallets/
│   ├── main.json            # { walletAddress, session, chainId, chain }
│   └── <name>.json
└── requests/
    └── <rid>.json           # Pending wallet creation requests
```
