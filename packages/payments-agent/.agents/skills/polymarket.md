---
name: polymarket
description: Trade prediction markets on Polymarket — browse markets, place YES/NO bets, manage positions. Uses CLOB V2 with pUSD collateral.
---

# Polymarket (CLOB V2)

The Polymarket integration is documented in detail at `skills/polygon-polymarket/SKILL.md` in the repo root. The high-level flow:

## Discovery (read-only)

```bash
polygon-agent polymarket markets --search "<keyword>" --limit 10
polygon-agent polymarket market <conditionId>
polygon-agent polymarket positions
polygon-agent polymarket orders
polygon-agent polymarket proxy-wallet
```

## Trading (broadcast)

```bash
# Buy YES or NO with $N USDC.e — fund + wrap to pUSD + place CLOB order
polygon-agent polymarket clob-buy <conditionId> YES 1 --broadcast

# Limit order
polygon-agent polymarket clob-buy <conditionId> YES 1 --price 0.45 --broadcast

# Sell shares (off-chain CLOB, no gas)
polygon-agent polymarket sell <conditionId> YES <shares> --broadcast

# Cancel an open order
polygon-agent polymarket cancel <orderId>
```

## Key facts

- Collateral is **pUSD** (since CLOB V2 migration on April 28, 2026). The CLI auto-wraps USDC.e → pUSD inside `clob-buy`.
- All users (including returning ones) need `polygon-agent polymarket approve --broadcast` once for V2 contracts. Approvals are permanent on-chain.
- Minimum order size is $1.
- Default order type is FOK (fill or kill); add `--price <0-1>` for GTC limit orders, `--fak` for fill-and-kill.
- The proxy wallet (not the smart wallet) holds pUSD and outcome tokens.

## When to use

- User wants to bet on a specific market: discovery → market lookup → dry-run buy → broadcast.
- User asks "what positions do I have on Polymarket?" → run `positions` directly.
- User wants to exit a position: `positions` to get share count → `sell` dry-run → broadcast.
