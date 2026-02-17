# Polygon Agent Kit

Complete end-to-end blockchain toolkit for AI agents on Polygon. One CLI to go from zero to an operational on-chain agent with wallet management, token operations, DEX swaps, and ERC-8004 identity/reputation registration.

## Quick Start

```bash
# 1. Setup (creates EOA, authenticates, gets project access key)
polygon-agent setup --name "MyAgent"

# 2. Set environment
export SEQUENCE_PROJECT_ACCESS_KEY=<access-key>
export SEQUENCE_DAPP_ORIGIN=<your-connector-url>
export SEQUENCE_ECOSYSTEM_CONNECTOR_URL=<your-connector-url>

# 3. Create wallet (opens browser, auto-waits for approval)
polygon-agent wallet create

# 4. Fund the wallet address, then:
export SEQUENCE_INDEXER_ACCESS_KEY=<indexer-key>
polygon-agent balances
polygon-agent send --to 0x... --amount 1.0 --broadcast
polygon-agent send --symbol USDC --to 0x... --amount 10 --broadcast

# 5. Register agent on-chain (ERC-8004)
polygon-agent agent register --name "MyAgent" --broadcast
```

See `skills/QUICKSTART.md` for a step-by-step guide. See `skills/SKILL.md` for full agent-friendly documentation.

---

## Smart Defaults

The CLI uses sensible defaults to minimize typing:

| Default | Value | Override |
|---------|-------|----------|
| Wallet name | `main` | `--name <name>` or `--wallet <name>` |
| Chain | `polygon` | `--chain <name\|id>` |
| Wallet create mode | Auto-wait for approval | `--no-wait` for manual flow |
| Broadcast | Dry-run (preview) | `--broadcast` to execute |

Most commands work with zero flags:

```bash
polygon-agent balances                   # uses wallet "main", chain "polygon"
polygon-agent wallet address             # shows address for wallet "main"
polygon-agent wallet create              # creates "main" wallet, waits for approval
```

---

## Architecture

The kit has three components that work together:

```
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│     CLI (Node.js)    │     │  Connector UI (React) │     │  Ecosystem Wallet    │
│                      │     │                       │     │  (Sequence Remote)   │
│  polygon-agent.mjs   │     │  localhost:4444       │     │  sequence.app        │
│                      │     │                       │     │                      │
│  - setup             │────>│  - Session approval   │────>│  - Smart contract    │
│  - wallet create     │     │  - Permission config   │     │    wallet (AA)       │
│  - send/swap/balance │<────│  - NaCl encryption    │     │  - Transaction relay │
│  - agent register    │     │  - Webhook callback   │     │  - Session mgmt      │
└──────────────────────┘     └──────────────────────┘     └──────────────────────┘
```

**CLI** generates a session request with a NaCl keypair. **Connector UI** opens the Sequence Ecosystem Wallet in a popup, captures session material (explicit + implicit session keys, attestation), encrypts it with the CLI's public key using NaCl sealed-box, and sends it back — either via webhook POST (default) or manual copy/paste. **CLI** decrypts and stores the session locally, then uses it for all subsequent operations.

### Three-Wallet System

| Wallet | Created By | Purpose | Fund? |
|--------|-----------|---------|-------|
| **EOA** | `setup` | Authentication with Sequence Builder (EIP-712) | No |
| **Builder Smart Wallet** | `Session.singleSigner(EOA)` | Optional AA wallet via Builder | Only if using builder-cli transfers |
| **Ecosystem Wallet** | `wallet create` + approval | Primary spending wallet for all operations | **Yes** |

The **Ecosystem Wallet** is the only wallet you need to fund.

### Wallet Session Flow

```
CLI                          Browser (Connector UI)              Ecosystem Wallet
 │                                │                                    │
 │ wallet create                  │                                    │
 │ ──> generates NaCl keypair     │                                    │
 │ ──> starts HTTP server :random │                                    │
 │ ──> outputs URL with pubKey    │                                    │
 │     + callbackUrl              │                                    │
 │                                │                                    │
 │         user opens URL ───────>│                                    │
 │                                │ clicks "Connect Wallet"            │
 │                                │ ──────────────────────────────────>│
 │                                │                   popup opens      │
 │                                │                   user approves    │
 │                                │<──────────────────────────────────│
 │                                │ receives session material          │
 │                                │ encrypts with NaCl sealed-box      │
 │                                │                                    │
 │<────── POST /callback ────────│                                    │
 │ decrypts ciphertext            │                                    │
 │ saves to ~/.polygon-agent/     │                                    │
 │ wallet ready                   │                                    │
```

With `--no-wait`, the user manually copies the encrypted blob from the browser and feeds it to `wallet import --ciphertext @file`.

---

## Commands

### Setup

```bash
polygon-agent setup --name <name> [--force]
```

Creates an EOA wallet, authenticates with Sequence Builder via EIP-712 (ETHAuth), creates a project, and returns the project access key. Credentials are encrypted and saved to `~/.polygon-agent/builder.json`.

### Wallet

```bash
polygon-agent wallet create [--name <name>] [--chain polygon] [--timeout <sec>]
polygon-agent wallet create --no-wait [--name <name>]
polygon-agent wallet import --ciphertext '<blob>|@<file>' [--name <name>] [--rid <rid>]
polygon-agent wallet list
polygon-agent wallet address [--name <name>]
polygon-agent wallet remove [--name <name>]
```

- `wallet create` — **Default: auto-wait mode.** Starts a temp HTTP server, generates a connector URL, waits for browser approval. Zero copy/paste.
- `wallet create --no-wait` — Generates a session request URL for manual browser approval.
- `wallet import` — Ingests encrypted ciphertext from browser approval. Supports `@filename` for reading from file.
- `wallet list` — Shows all configured wallets with addresses and chains.

Session permission flags (for `wallet create`):

| Flag | Purpose |
|------|---------|
| `--native-limit <amount>` | Max POL the session can spend |
| `--usdc-limit <amount>` | Max USDC the session can transfer |
| `--usdt-limit <amount>` | Max USDT the session can transfer |
| `--token-limit <SYM:AMT>` | Token limit by symbol (repeatable) |
| `--usdc-to <addr> --usdc-amount <n>` | One-off USDC transfer (fixed recipient) |
| `--contract <addr>` | Whitelist contract (repeatable) |

### Operations

```bash
polygon-agent balances [--wallet <name>] [--chain <chain>]
polygon-agent send --to <addr> --amount <num> [--broadcast]
polygon-agent send --symbol <SYM> --to <addr> --amount <num> [--broadcast]
polygon-agent send-native --to <addr> --amount <num> [--broadcast] [--direct]
polygon-agent send-token --symbol <SYM> --to <addr> --amount <num> [--broadcast]
polygon-agent swap --from <SYM> --to <SYM> --amount <num> [--slippage <num>] [--broadcast]
```

- All operations support **dry-run mode** by default (omit `--broadcast` to preview without sending).
- `send` auto-detects: native send if no `--symbol`/`--token`, ERC20 send if provided.
- `send-native` routes through a ValueForwarder contract for session compatibility. Use `--direct` to bypass.
- `send-token` resolves symbols (USDC, USDT, WETH, etc.) via Sequence's token-directory.
- `swap` uses Trails API for DEX aggregation with configurable slippage.

### Agent (ERC-8004 Registry)

```bash
polygon-agent agent register --name <agent-name> [--uri <uri>] [--metadata <k=v,k=v>] [--broadcast]
polygon-agent agent wallet --agent-id <id>
polygon-agent agent metadata --agent-id <id> --key <key>
polygon-agent agent reputation --agent-id <id> [--tag1 <tag>]
polygon-agent agent feedback --agent-id <id> --value <score> [--tag1 <tag>] [--broadcast]
polygon-agent agent reviews --agent-id <id>
```

Full ERC-8004 Trustless Agents integration:
- **IdentityRegistry** (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) — Register agents as ERC-721 NFTs with metadata URIs and key-value metadata.
- **ReputationRegistry** (`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`) — On-chain feedback with numeric scores, tags, and endpoint identifiers.

---

## Project Structure

```
polygon-agent-kit/
├── cli/
│   ├── polygon-agent.mjs          # Entry point — routes all commands
│   └── commands/
│       ├── builder.mjs            # setup (EOA + auth + project)
│       ├── wallet.mjs             # wallet create/import/list
│       ├── operations.mjs         # balances, send, swap
│       └── registry.mjs           # agent register/reputation/feedback
│
├── connector-ui/                   # React + Vite + Tailwind v4
│   ├── src/
│   │   ├── App.tsx                # Main component — wallet connect + encrypt
│   │   ├── config.ts              # Environment config (VITE_* vars)
│   │   ├── indexer.ts             # Sequence IndexerGateway client
│   │   └── tokenDirectory.ts     # Token symbol resolution
│   ├── public/
│   │   └── polygon-logo.svg
│   ├── vite.config.ts             # Vite + React + Tailwind plugins
│   └── index.html
│
├── lib/
│   ├── storage.mjs                # AES-256-GCM encrypted file storage
│   ├── utils.mjs                  # CLI arg parsing, network resolution
│   ├── ethauth.mjs                # EIP-712 ETHAuth proof generation
│   └── token-directory.mjs        # Token symbol → address resolution
│
├── contracts/
│   ├── IdentityRegistry.json      # ERC-8004 agent registration ABI
│   └── ReputationRegistry.json    # ERC-8004 reputation/feedback ABI
│
├── skills/
│   ├── SKILL.md                   # Full agent-friendly documentation
│   └── QUICKSTART.md              # 4-phase quick start guide
│
└── package.json
```

### Local Storage

All credentials are encrypted with AES-256-GCM and stored under `~/.polygon-agent/`:

```
~/.polygon-agent/
├── .encryption-key               # 256-bit key (mode 0600, auto-generated)
├── builder.json                  # { privateKey, eoaAddress, accessKey, projectId }
├── wallets/
│   ├── main.json                # { walletAddress, session, chainId, chain }
│   └── <name>.json
└── requests/
    └── <rid>.json               # Pending wallet creation requests
```

---

## Connector UI (`connector-ui/`)

A React single-page app that bridges the CLI to the Sequence Ecosystem Wallet. Built with:

- **React 18** + **Vite 5**
- **Tailwind CSS v4** (CSS-first config via `@theme`)
- **lucide-react** icons
- **@0xsequence/dapp-client** for wallet integration
- **tweetnacl-sealedbox-js** for NaCl sealed-box encryption

**Dev server**:
```bash
cd connector-ui
pnpm install
pnpm dev  # starts on http://localhost:4444
```

**Environment** (`.env`):
```
VITE_PROJECT_ACCESS_KEY=<from-setup>
VITE_WALLET_URL=<ecosystem-wallet-url>
VITE_DAPP_ORIGIN=<connector-origin>
VITE_INDEXER_ACCESS_KEY=<indexer-key>
```

---

## Environment Variables

### Required

| Variable | Purpose | When |
|----------|---------|------|
| `SEQUENCE_PROJECT_ACCESS_KEY` | Project access key from setup | Wallet creation |
| `SEQUENCE_DAPP_ORIGIN` | Connector UI origin URL | Wallet creation |
| `SEQUENCE_ECOSYSTEM_CONNECTOR_URL` | Connector UI base URL | Wallet creation |
| `SEQUENCE_INDEXER_ACCESS_KEY` | Indexer API key | Balance queries |

### Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `SEQUENCE_BUILDER_API_URL` | Builder API endpoint | `https://api.sequence.build` |
| `SEQUENCE_INDEXER_URL` | Indexer URL override | `https://indexer.sequence.app/rpc/IndexerGateway/...` |
| `TRAILS_API_KEY` | Trails API key for swaps | Falls back to `SEQUENCE_PROJECT_ACCESS_KEY` |
| `TRAILS_TOKEN_MAP_JSON` | Token address overrides (JSON) | Token-directory lookup |
| `POLYGON_AGENT_DEBUG_FETCH` | Log HTTP to `~/.polygon-agent/fetch-debug.log` | Off |
| `POLYGON_AGENT_DEBUG_FEE` | Dump fee options to stderr | Off |

---

## Backward Compatibility

All legacy command forms still work:

| Legacy | Simplified |
|--------|-----------|
| `builder setup --name <n>` | `setup --name <n>` |
| `wallet create --name main --wait` | `wallet create` |
| `wallet start-session` | `wallet import` |
| `register --wallet main` | `agent register` |
| `agent-wallet --agent-id <id>` | `agent wallet --agent-id <id>` |
| `agent-metadata --agent-id <id>` | `agent metadata --agent-id <id>` |
| `reputation --agent-id <id>` | `agent reputation --agent-id <id>` |
| `give-feedback --wallet main` | `agent feedback` |
| `read-feedback --agent-id <id>` | `agent reviews --agent-id <id>` |

---

## Security

- **Private keys never leave the device.** The EOA key is encrypted at rest with AES-256-GCM. The ecosystem wallet session keys are sealed-box encrypted in transit and AES encrypted at rest.
- **Session permissions are scoped.** The connector UI configures per-session spending limits (native value cap, ERC20 transfer caps, fee token allowances) with a 24-hour deadline.
- **No plaintext secrets on disk.** All sensitive data in `~/.polygon-agent/` is encrypted. The encryption key file is created with mode 0600.
- **Callback is localhost-only.** The webhook callback server only binds to localhost and accepts a single POST before shutting down.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Builder configured already` | Use `--force` flag to recreate |
| `Missing SEQUENCE_PROJECT_ACCESS_KEY` | Run `setup` first or set env var |
| `Missing wallet` | Check `wallet list`, re-run `wallet create` |
| `Indexer 404/400` | Uses IndexerGateway + RPC fallback (auto-handled) |
| `Session expired` | Re-run `wallet create` |
| `Ciphertext truncated (Telegram)` | Use default `wallet create` (auto-wait mode) |
| `Timed out waiting for callback` | Increase timeout: `--timeout 600` |
| `Transaction failed` | Omit `--broadcast` for dry-run preview first |

---

## ERC-8004: Trustless Agents

The kit includes full integration with the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) standard for decentralized agent identity and reputation on Polygon.

**Registration flow:**
```
agent register --name "MyAgent" --broadcast
  → Mints ERC-721 NFT with agentId

agent feedback --agent-id 123 --value 4.5 --tag1 "helpful" --broadcast
  → Stores on-chain feedback

agent reputation --agent-id 123
  → Returns aggregated reputation
```

---

## Development

```bash
# Install CLI dependencies
npm install

# Install connector UI dependencies
cd connector-ui && pnpm install

# Run connector UI dev server
pnpm dev  # http://localhost:4444

# Run CLI
polygon-agent --help
```

### Requirements

- Node.js 20+
- pnpm (for connector-ui)

---

## License

MIT
