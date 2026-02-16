# Polygon Agent Kit

Complete end-to-end blockchain toolkit for AI agents on Polygon. One CLI to go from zero to an operational on-chain agent with wallet management, token operations, DEX swaps, and ERC-8004 identity/reputation registration.

## TL;DR

```bash
# 1. Setup builder (creates EOA, authenticates, gets project key)
node cli/polygon-agent.mjs builder setup --name "MyAgent"

# 2. Set environment
export SEQUENCE_PROJECT_ACCESS_KEY=<access-key>
export SEQUENCE_DAPP_ORIGIN=<your-connector-url>
export SEQUENCE_ECOSYSTEM_CONNECTOR_URL=<your-connector-url>

# 3. Create wallet (opens browser, auto-ingests session via webhook)
node cli/polygon-agent.mjs wallet create --name main --chain polygon --wait

# 4. Fund the wallet address from the output, then:
export SEQUENCE_INDEXER_ACCESS_KEY=<indexer-key>
node cli/polygon-agent.mjs balances --wallet main
node cli/polygon-agent.mjs send-native --wallet main --to 0x... --amount 1.0 --broadcast
node cli/polygon-agent.mjs send-token --wallet main --symbol USDC --to 0x... --amount 10 --broadcast

# 5. Register agent on-chain (ERC-8004)
node cli/polygon-agent.mjs register --wallet main --name "MyAgent" --broadcast
```

See `skills/QUICKSTART.md` for a step-by-step guide. See `skills/SKILL.md` for full agent-friendly documentation.

---

## Architecture

The kit has three components that work together:

```
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│     CLI (Node.js)    │     │  Connector UI (React) │     │  Ecosystem Wallet    │
│                      │     │                       │     │  (Sequence Remote)   │
│  polygon-agent.mjs   │     │  localhost:4444       │     │  sequence.app        │
│                      │     │                       │     │                      │
│  - builder setup     │────>│  - Session approval   │────>│  - Smart contract    │
│  - wallet create     │     │  - Permission config   │     │    wallet (AA)       │
│  - send/swap/balance │<────│  - NaCl encryption    │     │  - Transaction relay │
│  - register (8004)   │     │  - Webhook callback   │     │  - Session mgmt      │
└──────────────────────┘     └──────────────────────┘     └──────────────────────┘
```

**CLI** generates a session request with a NaCl keypair. **Connector UI** opens the Sequence Ecosystem Wallet in a popup, captures session material (explicit + implicit session keys, attestation), encrypts it with the CLI's public key using NaCl sealed-box, and sends it back — either via webhook POST (recommended) or manual copy/paste. **CLI** decrypts and stores the session locally, then uses it for all subsequent operations.

### Three-Wallet System

The kit uses three distinct wallets with different purposes:

| Wallet | Created By | Purpose | Fund? |
|--------|-----------|---------|-------|
| **EOA** | `builder setup` | Authentication with Sequence Builder (EIP-712) | No |
| **Builder Smart Wallet** | `Session.singleSigner(EOA)` | Optional AA wallet via Builder | Only if using builder-cli transfers |
| **Ecosystem Wallet** | `wallet create` + approval | Primary spending wallet for all operations | **Yes** |

The **Ecosystem Wallet** is the only wallet you need to fund. It's a Sequence smart contract wallet (account abstraction) that executes transactions through session-based permissions — no private key leaves the Sequence infrastructure.

### Wallet Session Flow

```
CLI                          Browser (Connector UI)              Ecosystem Wallet
 │                                │                                    │
 │ wallet create --wait           │                                    │
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

Without `--wait`, the user manually copies the encrypted blob from the browser and feeds it to `wallet start-session --ciphertext @file`.

---

## Project Structure

```
polygon-agent-kit/
├── cli/
│   ├── polygon-agent.mjs          # Entry point — routes all commands
│   └── commands/
│       ├── builder.mjs            # builder setup (EOA + auth + project)
│       ├── wallet.mjs             # wallet create/start-session/list
│       ├── operations.mjs         # balances, send-native, send-token, swap
│       └── registry.mjs           # ERC-8004 register, reputation, feedback
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

## Components in Detail

### CLI (`cli/`)

Single entry point: `polygon-agent.mjs`. All commands route to modules in `commands/`.

#### Builder

```bash
polygon-agent builder setup --name <name> [--force]
```

Creates an EOA wallet, authenticates with Sequence Builder via EIP-712 (ETHAuth), creates a project, and returns the project access key. All credentials are encrypted and saved to `~/.polygon-agent/builder.json`.

#### Wallet

```bash
polygon-agent wallet create --name <name> [--chain polygon] [--wait] [--timeout <sec>]
polygon-agent wallet start-session --name <name> --ciphertext '<blob>|@<file>' [--rid <rid>]
polygon-agent wallet list
```

- `wallet create --wait` — **Recommended.** Starts a temp HTTP server on a random localhost port, generates a connector URL with the callback address baked in. The connector UI POSTs the encrypted session blob directly back to the CLI. Zero copy/paste.
- `wallet create` — Generates a session request URL for manual browser approval.
- `wallet start-session` — Ingests the encrypted ciphertext from browser approval. Supports `@filename` for reading from file (useful when the blob is too large to paste directly, e.g. Telegram's 4096-char limit).
- `wallet list` — Shows all configured wallets with addresses and chains.

#### Operations

```bash
polygon-agent balances --wallet <name> [--chain <chain>]
polygon-agent send-native --wallet <name> --to <addr> --amount <num> [--broadcast]
polygon-agent send-token --wallet <name> --symbol <SYM> --to <addr> --amount <num> [--broadcast]
polygon-agent swap --wallet <name> --from <SYM> --to <SYM> --amount <num> [--slippage <num>] [--broadcast]
```

- All operations support **dry-run mode** by default (omit `--broadcast` to preview without sending).
- `send-native` routes through a ValueForwarder contract for session compatibility.
- `send-token` resolves symbols (USDC, USDT, WETH, etc.) via Sequence's token-directory.
- `balances` uses IndexerGateway with automatic RPC fallback on testnet/error.
- `swap` uses Trails API for DEX aggregation with configurable slippage.

#### Registry (ERC-8004)

```bash
polygon-agent register --wallet <name> --name <agent-name> [--agent-uri <uri>] [--metadata <k=v,k=v>] [--broadcast]
polygon-agent agent-wallet --agent-id <id>
polygon-agent agent-metadata --agent-id <id> --key <key>
polygon-agent reputation --agent-id <id> [--tag1 <tag>]
polygon-agent give-feedback --wallet <name> --agent-id <id> --value <score> [--tag1 <tag>] [--tag2 <tag>] [--broadcast]
polygon-agent read-feedback --agent-id <id>
```

Full ERC-8004 Trustless Agents integration:
- **IdentityRegistry** (`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`) — Register agents as ERC-721 NFTs with metadata URIs and key-value metadata.
- **ReputationRegistry** (`0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`) — On-chain feedback with numeric scores, tags, and endpoint identifiers.

### Connector UI (`connector-ui/`)

A React single-page app that bridges the CLI to the Sequence Ecosystem Wallet. Built with:

- **React 18** + **Vite 5**
- **Tailwind CSS v4** (CSS-first config via `@theme`)
- **lucide-react** icons
- **@0xsequence/dapp-client** for wallet integration
- **tweetnacl-sealedbox-js** for NaCl sealed-box encryption

The connector UI handles:
1. **Session permission configuration** — ValueForwarder base permission, optional ERC20 limits (via URL params: `usdcLimit`, `usdtLimit`, `nativeLimit`, `tokenLimits=SYM:amount,...`), and fee token pre-approvals.
2. **Wallet connection** — Opens Sequence Ecosystem Wallet popup, captures explicit + implicit session keys.
3. **Encryption** — Seals session material with the CLI's NaCl public key.
4. **Delivery** — POSTs ciphertext to the CLI's localhost callback (webhook mode) or displays it for manual copy.

**Dev server**:
```bash
cd connector-ui
pnpm install
pnpm dev  # starts on http://localhost:4444
```

**Environment** (`.env`):
```
VITE_PROJECT_ACCESS_KEY=<from-builder-setup>
VITE_WALLET_URL=<ecosystem-wallet-url>
VITE_DAPP_ORIGIN=<connector-origin>
VITE_INDEXER_ACCESS_KEY=<indexer-key>
```

### Shared Libraries (`lib/`)

| Module | Purpose |
|--------|---------|
| `storage.mjs` | AES-256-GCM encrypted read/write to `~/.polygon-agent/`. Auto-generates encryption key on first use (mode 0600). |
| `utils.mjs` | CLI arg parsing (`--flag value`, `@filename`), chain name normalization, unit conversion, explorer/indexer URL resolution. |
| `ethauth.mjs` | EIP-712 typed data construction and signing for Sequence Builder authentication. |
| `token-directory.mjs` | Fetches token metadata from `0xsequence/token-directory` on GitHub. 10-minute local cache. |

### Contracts (`contracts/`)

JSON ABI files only (no Solidity source). Used by `registry.mjs` for ethers.js Contract instantiation.

- `IdentityRegistry.json` — Agent registration, metadata, payment wallet.
- `ReputationRegistry.json` — Feedback submission, reputation aggregation, tag filtering.

---

## Environment Variables

### Required

| Variable | Purpose | When |
|----------|---------|------|
| `SEQUENCE_PROJECT_ACCESS_KEY` | Project access key from builder setup | Wallet creation |
| `SEQUENCE_DAPP_ORIGIN` | Connector UI origin URL | Wallet creation |
| `SEQUENCE_ECOSYSTEM_CONNECTOR_URL` | Connector UI base URL | Wallet creation |
| `SEQUENCE_INDEXER_ACCESS_KEY` | Indexer API key | Balance queries |

### Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `SEQUENCE_BUILDER_API_URL` | Builder API endpoint | `https://api.sequence.build` |
| `SEQUENCE_INDEXER_URL` | Indexer URL override | `https://indexer.sequence.app/rpc/IndexerGateway/...` |

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
| `Missing SEQUENCE_PROJECT_ACCESS_KEY` | Run `builder setup` first or set env var |
| `Missing wallet` | Check `wallet list`, re-run `wallet create` |
| `Indexer 404/400` | Uses IndexerGateway + RPC fallback (auto-handled) |
| `No native balance on testnet` | RPC fallback activates automatically |
| `Session expired` | Re-run `wallet create` flow |
| `Ciphertext truncated (Telegram)` | Use `wallet create --wait` for webhook callback |
| `Timed out waiting for callback` | Increase timeout: `--wait --timeout 600` |
| `Transaction failed` | Omit `--broadcast` for dry-run preview first |

---

## ERC-8004: Trustless Agents

The kit includes full integration with the [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) standard for decentralized agent identity and reputation on Polygon.

**What it provides:**
- **Decentralized identity** — Each agent gets an ERC-721 NFT with a unique `agentId`, metadata URI, and on-chain key-value metadata.
- **Reputation system** — Clients submit on-chain feedback (score + tags + endpoint). Reputation is aggregated and queryable by anyone.
- **Trust validation** — Discover and evaluate agents across organizational boundaries without centralized intermediaries.

**Registration flow:**
```
register --name "MyAgent" --broadcast
  → Mints ERC-721 NFT with agentId
  → Emits Registered(agentId, owner, URI)

give-feedback --agent-id 123 --value 4.5 --tag1 "helpful"
  → Stores on-chain feedback
  → Updates reputation score

reputation --agent-id 123
  → Returns aggregated reputation
```

---

## Development

```bash
# Install CLI dependencies
cd polygon-agent-kit
npm install

# Install connector UI dependencies
cd connector-ui
pnpm install

# Run connector UI dev server
pnpm dev  # http://localhost:4444

# Run CLI commands
node cli/polygon-agent.mjs --help
```

### Requirements

- Node.js 20+
- pnpm (for connector-ui)

---

## License

MIT
