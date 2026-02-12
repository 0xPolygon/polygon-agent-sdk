# Polygon Agent Kit

Complete end-to-end blockchain toolkit for AI agents on Polygon.

## Features

- **Builder** - One-command setup for Sequence project (EOA + auth + access key)
- **Wallet** - Session-based ecosystem wallet creation
- **Operations** - Token transfers, swaps, balance checks
- **Registry** - 8004 agent registration (coming soon)

## Quick Start

```bash
# 1. Setup builder (creates EOA, authenticates, gets project key)
node cli/polygon-agent.mjs builder setup --name "MyAgent"

# 2. Create wallet session
node cli/polygon-agent.mjs wallet create --name main

# 3. Start session (after browser approval)
node cli/polygon-agent.mjs wallet start-session --name main --ciphertext @/tmp/session.txt

# 4. Check balances
export SEQUENCE_INDEXER_ACCESS_KEY=<key>
node cli/polygon-agent.mjs balances --wallet main

# 5. Send tokens
node cli/polygon-agent.mjs send --wallet main --symbol USDC --to 0x... --amount 10 --broadcast
```

## Architecture

Three-wallet system:
1. **EOA** - Authentication only (builder login)
2. **Builder Smart Wallet** - Optional AA wallet
3. **Ecosystem Wallet** - Primary spending wallet (fund this!)

## Documentation

See `skills/SKILL.md` for complete agent-friendly documentation.
