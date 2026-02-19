# Polygon Agent SDK

<p align="center">
  <img src="assets/architecture.png" alt="Polygon Agents SDK Architecture" width="700" />
</p>

<p align="center">
  <strong>End-to-end blockchain toolkit for AI agents on Polygon.</strong><br/>
  Give your agent wallets, tokens, swaps, and on-chain identity — in one install.
</p>

---

## Table of Contents

- [Overview](#overview)
- [Quickstart](#quickstart)
- [Core Components](#core-components)
  - [Sequence — Wallet Infrastructure](#sequence--wallet-infrastructure)
  - [Trails — DeFi Operations](#trails--defi-operations)
  - [Polygon Chain — On-Chain Identity](#polygon-chain--on-chain-identity)
- [Plugins & Skills](#plugins--skills)
- [CLI Reference](#cli-reference)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

---

## Overview

Polygon Agent SDK gives AI agents everything they need to operate onchain:

- **Create and manage wallets** define allowances, session limits, and contract permissions. Private keys never leave the device and have to be exposed to your agent's context
- **Send tokens, swap, bridge or any action** pay in any token for any onchain action. Built-in swapping, bridging, deposits and more.
- **Register agent identity** and build reputation via ERC-8004
- **Integrated infrastructure** query cross-chain balances, transaction history and or query nodes via dedicated RPCs
- **Payments first** native gas abstraction built-in, pay end to end in stablecoins for interactions.

---

## Quickstart

### Option A: Clawhub (Openclaw)

```bash
npx clawhub@latest install polygon-agents-sdk
```

This installs the Polygon Agent SDK as a skill your agent can use. Once installed, your agent has access to wallet management, token operations, DEX swaps, and on-chain identity — all through the `polygon-agent` CLI.

### Option B: Claude

Add the skill to your Claude project from the repo:

```bash
claude skill add --url https://github.com/0xPolygon/polygon-agent-kit
```

### Option C: Manual

```bash
git clone https://github.com/0xPolygon/polygon-agent-kit.git
cd polygon-agent-kit
npm install
```

### After install — get your agent running

Once the skill is installed, your agent (or you) can run:

```bash
# 1. Setup — creates EOA, authenticates, gets project access key
polygon-agent setup --name "MyAgent"

# 2. Set your access key
export SEQUENCE_PROJECT_ACCESS_KEY=<access-key>

# 3. Create a wallet (opens browser, auto-waits for approval)
polygon-agent wallet create

# 4. Fund the wallet
polygon-agent fund

# 5. Start operating
export SEQUENCE_INDEXER_ACCESS_KEY=<indexer-key>
polygon-agent balances
polygon-agent send --to 0x... --amount 1.0 --broadcast
polygon-agent swap --from USDC --to USDT --amount 5 --broadcast

# 6. Register your agent on-chain
polygon-agent agent register --name "MyAgent" --broadcast
```

> Omit `--broadcast` on any command to preview without sending. See [`skills/QUICKSTART.md`](skills/QUICKSTART.md) for the full step-by-step walkthrough.

---

## Core Components

The SDK is built on three infrastructure pillars, each mapped to a Polygon ecosystem service.

### Sequence — Wallet Infrastructure

[Sequence](https://sequence.xyz) powers all wallet operations, RPC access, and token indexing.

| Capability | What it does | CLI command |
|------------|-------------|-------------|
| **Wallets** | Session-based smart contract wallets (Account Abstraction) with scoped spending permissions | `wallet create`, `wallet list` |
| **RPCs** | Polygon network access for transaction relay and on-chain reads | Used internally by all commands |
| **Indexer** | Token balance queries and transaction history across ERC-20/721/1155 | `balances` |

Wallet sessions are created through a secure handshake between the CLI, the Connector UI, and the Sequence Ecosystem Wallet. Session permissions let you cap spending per token, whitelist contracts, and set time-based expiry.

### Trails — DeFi Operations

[Trails](https://sequence.xyz/trails) handles all cross-chain and DeFi operations via an aggregation layer.

| Capability | What it does | CLI command |
|------------|-------------|-------------|
| **Bridging** | Move assets cross-chain into your Polygon wallet | `fund` |
| **Swapping** | DEX-aggregated token swaps with configurable slippage | `swap` |
| **Actions** | Composable on-chain operations (send native, send ERC-20) | `send`, `send-native`, `send-token` |

### Polygon Chain — On-Chain Identity

Native Polygon contracts for agent identity, reputation, and emerging payment standards.

| Capability | What it does | CLI command |
|------------|-------------|-------------|
| **ERC-8004** | Register agents as ERC-721 NFTs with metadata and on-chain reputation | `agent register`, `agent reputation`, `agent feedback` |
| **x402** | HTTP-native micropayment protocol for agent-to-agent payments | *Coming soon* |
| **Native Apps** | Direct interaction with Polygon-native smart contracts | Via `--contract` whitelisting |

**ERC-8004 contracts on Polygon:**
- Identity Registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Reputation Registry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

---

## Plugins & Skills

The SDK ships with agent-friendly documentation designed to be consumed directly by AI coding assistants.

| Distribution | How to install |
|-------------|----------------|
| **Openclaw** | `npx clawhub@latest install polygon-agents-sdk` |
| **Claude** | `claude skill add --url https://github.com/0xPolygon/polygon-agent-kit` |

Once installed, the agent receives the full skill context — including wallet setup, token operations, and ERC-8004 registration — and can execute autonomously.

See [`skills/SKILL.md`](skills/SKILL.md) for the full agent-consumable reference and [`skills/QUICKSTART.md`](skills/QUICKSTART.md) for the 4-phase setup guide.

---

## CLI Reference

### Setup & Wallets

```bash
polygon-agent setup --name <name>                 # Create EOA + project
polygon-agent wallet create                        # Create wallet (auto-wait)
polygon-agent wallet create --no-wait              # Manual approval flow
polygon-agent wallet list                          # Show all wallets
polygon-agent wallet address                       # Show wallet address
polygon-agent fund                                 # Open funding widget
```

### Token Operations

```bash
polygon-agent balances                             # Check all balances
polygon-agent send --to 0x... --amount 1.0         # Send POL (dry-run)
polygon-agent send --symbol USDC --to 0x... --amount 10 --broadcast
polygon-agent swap --from USDC --to USDT --amount 5 --broadcast
```

### Agent Registry (ERC-8004)

```bash
polygon-agent agent register --name "MyAgent" --broadcast
polygon-agent agent reputation --agent-id <id>
polygon-agent agent feedback --agent-id <id> --value 4.5 --broadcast
polygon-agent agent reviews --agent-id <id>
```

### Smart Defaults

| Default | Value | Override |
|---------|-------|----------|
| Wallet name | `main` | `--name <name>` |
| Chain | `polygon` | `--chain <name\|id>` |
| Wallet create | Auto-wait for approval | `--no-wait` |
| Broadcast | Dry-run (preview) | `--broadcast` |

---

## Environment Variables

**Required:**

| Variable | Purpose |
|----------|---------|
| `SEQUENCE_PROJECT_ACCESS_KEY` | Project access key (from `setup`) |
| `SEQUENCE_INDEXER_ACCESS_KEY` | Indexer API key (for `balances`) |

**Optional:**

| Variable | Default |
|----------|---------|
| `SEQUENCE_ECOSYSTEM_CONNECTOR_URL` | `http://localhost:4444` |
| `SEQUENCE_DAPP_ORIGIN` | Connector UI origin URL |
| `TRAILS_API_KEY` | Falls back to project access key |

---

## Security

- **Keys never leave the device.** All credentials are AES-256-GCM encrypted at rest in `~/.polygon-agent/`.
- **Session permissions are scoped.** Per-session spending limits, contract whitelists, and 24-hour expiry.
- **Encrypted in transit.** Session material is NaCl sealed-box encrypted between CLI and Connector UI.
- **Localhost-only callback.** The webhook server binds to localhost and accepts a single POST.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Missing SEQUENCE_PROJECT_ACCESS_KEY` | Run `setup` first |
| Session expired | Re-run `wallet create` |
| Insufficient funds | Run `fund` to top up your wallet |
| Transaction failed | Omit `--broadcast` to dry-run first |
| Callback timeout | Increase with `--timeout 600` |

---

## Development

```bash
# CLI
npm install
polygon-agent --help

# Connector UI
cd connector-ui && pnpm install && pnpm dev
```

### Project Structure

```
polygon-agent-kit/
├── cli/                    # CLI entry point + commands
│   ├── polygon-agent.mjs
│   └── commands/           # builder, wallet, operations, registry
├── connector-ui/           # React app — wallet connect bridge
├── contracts/              # ERC-8004 ABIs
├── lib/                    # Shared utils (storage, ethauth, tokens)
├── skills/                 # Agent-friendly docs (SKILL.md, QUICKSTART.md)
└── package.json
```

**Requirements:** Node.js 20+, pnpm (for connector-ui)

---

## License

MIT
