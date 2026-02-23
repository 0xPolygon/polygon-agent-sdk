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
  - [Trails — Swapping, Bridging, and onchain actions](#trails--defi-operations)
  - [Onchain Identity](#polygon-chain--on-chain-identity)
- [Plugins & Skills](#plugins--skills)
- [CLI Reference](#cli-reference)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

---

## Overview

Polygon Agent SDK gives AI agents everything they need to operate onchain:

- **Create and manage wallets** define allowances, session limits, and contract permissions in order to transact securely. Mitigates risk of prompt injection attacks. Private keys never leave the device and have to be exposed to your agent's context.
- **Send tokens, swap, bridge or any action** pay in any token for any onchain action. Built-in swapping, bridging, deposits, DeFi primitives, and more.
- **Register agent identity** and build reputation via ERC-8004
- **Integrated APIs** query cross-chain balances, transaction history and or query nodes via dedicated RPCs
- **Payments first** native gas abstraction built-in, pay end to end in stablecoins for interactions.

---

## Quickstart

### Coming soon: Option A: Clawhub (Openclaw)

```bash
npx clawhub@latest install polygon-agents-sdk
```

This installs the Polygon Agent SDK as a skill your agent can use. Once installed, your agent has access to wallet management, token operations, DEX swaps, and on-chain identity — all through the `polygon-agent` CLI.

### Coming soon: Option B: Claude

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
polygon-agent send --to 0x... --amount 1.0 
polygon-agent swap --from USDC --to USDT --amount 5 

# 6. Register your agent on-chain
polygon-agent agent register --name "MyAgent"
```

> Omit `--broadcast` on any command to preview without sending. See [`skills/QUICKSTART.md`](skills/QUICKSTART.md) for the full step-by-step walkthrough.

---

## Core Components

The SDK is built on three pillars to enable end to end onchain payments with your agents.

### Sequence — Wallet Infrastructure

[Sequence](https://sequence.xyz) powers all wallet operations, RPC access, and indexing.

| Capability | What it does | CLI command |
|------------|-------------|-------------|
| **Wallets** | Session-based smart contract wallets (Account Abstraction) with scoped spending permissions | `wallet create`, `wallet list` |
| **RPCs** | Load balanced RPCs cross-chain for onchain interactions and node queries | Used internally by all commands |
| **Indexer** | Token balance queries and transaction history across ERC-20/721/1155 | `balances` |

Wallet sessions are created through a secure handshake between the CLI, the Connector UI, and the Sequence Ecosystem Wallet. Session permissions let you cap spending per token, whitelist contracts, and set time-based expiry and to mitigate against prompt injection attacks.

### Trails — Swapping, Bridging, and DeFi Actions

[Trails](https://sequence.xyz/trails) handles swapping, bridging, and onchain interactions enabling you to call any smart contract function and pay with any token. Trails handles it under the hood in a single transaction for your agent.

| Capability | What it does | CLI command |
|------------|-------------|-------------|
| **Bridging** | Move assets cross-chain into your Polygon wallet and fund the initial flows to your wallet | `fund` |
| **Swapping** | Token swaps with configurable slippage seamlessly built in | `swap` |
| **Actions** | Composable onchain operations (deposit into a DeFi vault, stake with your favorite protocol) | `send`, `deposit`, `send-token` |

### Onchain Agentic Identity

Native contracts for agent identity, reputation, and emerging payment standards.

| Capability | What it does | CLI command |
|------------|-------------|-------------|
| **ERC-8004** | Register agents as ERC-721 NFTs with metadata and on-chain reputation | `agent register`, `agent reputation`, `agent feedback` |
| **x402** | HTTP-native micropayment protocol for agentic payments to your favorite services
| **Native Apps** | Direct interaction with smart contracts | Via `--contract` whitelisting |

**ERC-8004 contracts on Polygon:**
- Identity Registry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- Reputation Registry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

---

## Plugins & Skills

The SDK ships with agent-friendly documentation designed to be consumed directly by AI agents.

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

| Variable | Default | Description |
|----------|---------|-------------|
| `SEQUENCE_ECOSYSTEM_CONNECTOR_URL` | `https://agentconnect.staging.polygon.technology/` | URL of the Connector UI that users open in a browser to approve wallet sessions. Override to point at a local dev server (`http://localhost:4444`) or a custom deployment. |
| `SEQUENCE_DAPP_ORIGIN` | `https://agentconnect.staging.polygon.technology` | Origin passed to the wallet during session creation. Identifies which dapp is requesting access. Override only if running the connector under a different domain. |
| `TRAILS_API_KEY` | Falls back to project access key | API key for Trails transaction indexing. |

---

## Security

- **Keys never leave the device.** Credentials are encrypted at rest in `~/.polygon-agent/`. Importantly, keys don't have to be exposed to the agent's context.
- **Session permissions are scoped.** Per-session spending limits, contract whitelists, and 24-hour expiry.

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
