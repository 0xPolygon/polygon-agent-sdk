---
name: deposit
description: Deposit tokens into yield-bearing pools (Aave v3, Morpho) and withdraw from them.
---

# DeFi deposit / withdraw

## Deposit

```bash
polygon-agent deposit --asset <SYM> --amount <num> [--protocol aave|morpho] [--broadcast]
```

The CLI picks the highest-TVL pool for that asset (subject to `--protocol` filter). Aave V3 Pool is auto-whitelisted for all wallet sessions.

## Withdraw

```bash
polygon-agent withdraw --position <addr> --amount <num|max> [--chain <chain>] [--broadcast]
```

- `--position` — the aToken address (Aave) or the ERC-4626 vault address (Morpho/Yearn). Get this from the `deposit` output's `depositAddress` or from Trails' earn pools.
- `--amount` — `max` to withdraw the full position, or an underlying-token amount.

## Output (deposit, broadcast)

```json
{
  "ok": true,
  "protocol": "aave",
  "poolName": "Aave v3",
  "poolApy": "5.23%",
  "asset": "USDC",
  "amount": "10.0",
  "txHash": "0x...",
  "explorerUrl": "https://polygonscan.com/tx/0x...",
  "note": "USDC is now earning yield in Aave v3..."
}
```

## Rules

- Dry-run first to show the user the pool, APY, and TVL — then broadcast on confirmation.
- The CLI enforces a 0.1 token gas reserve on `deposit` automatically; don't override.
- For Morpho or other vaults beyond Aave, the user may need to re-create their wallet session with `--contract <vault-address>` whitelisted. If you see a session-rejection error, surface that.
