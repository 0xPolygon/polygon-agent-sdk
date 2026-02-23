---
name: polymarket-skill
description: Compact reference for placing bets on Polymarket via polygon-agent CLI.
---

# Polymarket Skill

## Setup (one-time)
```bash
polygon-agent setup --name <name>          # creates builder EOA
polygon-agent wallet create --usdc-limit 100
polygon-agent fund                         # deposit USDC.e via browser
polygon-agent send-native --to <EOA> --amount 0.1 --broadcast  # EOA needs POL for gas
# EOA address found in ~/.polygon-agent/builder.json
```
Also: connect EOA to polymarket.com and accept terms (required for orders/cancel).

## Commands

```bash
# Browse markets
polymarket markets [--search <q>] [--limit 20] [--offset 0]
polymarket market <conditionId>

# Buy — always dry-run first, then add --broadcast
polymarket buy <conditionId> YES|NO <amount> [--price 0-1] [--broadcast] [--skip-fund]

# Check
polymarket positions          # tokens in smart wallet (via Data API)
polymarket orders             # open CLOB orders from EOA (needs Polymarket account)
polymarket cancel <orderId>
```

## Buy flow (broadcast)
1. Smart wallet → USDC.e → EOA (relayer pays gas in USDC)
2. EOA → `approve` USDC.e (to CTF Exchange, or Neg Risk Adapter if negRisk market)
3. EOA → `setApprovalForAll` CTF (+ Neg Risk Exchange + Adapter if negRisk)
4. EOA → `splitPosition` → mints YES + NO tokens
5. EOA → CLOB SELL order for unwanted side (FOK market or GTC limit)

**EOA needs ~0.1 POL for gas** — steps 2–4 are raw on-chain txs. The Sequence relayer USDC gas abstraction only covers the smart wallet (step 1), not the EOA.

## Key flags
| Flag | Effect |
|------|--------|
| `--broadcast` | Execute (omit for dry-run) |
| `--price 0.35` | GTC limit order instead of FOK market order |
| `--skip-fund` | Skip smart wallet→EOA transfer; use existing EOA balance |

## Neg risk markets
When `negRisk: true` in market data: USDC.e is approved to the Neg Risk Adapter (not CTF Exchange), and split is called on `NegRiskAdapter.splitPosition(conditionId, amount)` instead of CTF directly.

## Errors
| Error | Fix |
|-------|-----|
| `insufficient funds for gas` | Send 0.1 POL to EOA: `send-native --to <EOA> --amount 0.1 --broadcast` |
| `Could not create api key` | Visit polymarket.com, connect EOA, accept terms |
| Split ok but SELL failed | Tokens in EOA — retry with `--skip-fund` or sell at polymarket.com |
| `Market not found` | Market outside top 500 by volume or closed |
| `Session expired` | Re-run `wallet create` |

## Contracts (Polygon mainnet)
| Name | Address |
|------|---------|
| USDC.e | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |
| CTF | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| CTF Exchange | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` |
| Neg Risk Adapter | `0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296` |
| Neg Risk CTF Exchange | `0xC5d563A36AE78145C45a50134d48A1215220f80a` |
