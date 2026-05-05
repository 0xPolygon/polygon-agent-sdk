---
name: swap
description: Swap one token for another via the Trails DEX aggregator. Same-chain and cross-chain.
---

# Swap

```bash
polygon-agent swap --from <SYM> --to <SYM> --amount <num> [--to-chain <chain>] [--slippage <num>] [--broadcast]
```

- `--from`, `--to` — token symbols (e.g. `USDC`, `USDT`, `WETH`, `POL`, `USDC.e`)
- `--amount` — amount of the **source** token to spend
- `--to-chain` — destination chain for cross-chain swaps; omit for same-chain
- `--slippage` — 0-0.5 (default 0.005 = 0.5%)

## Output (broadcast)

```json
{
  "ok": true,
  "fromToken": "USDC",
  "toToken": "USDC.e",
  "crossChain": false,
  "amount": "2",
  "intentId": "0x...",
  "depositTxHash": "0x...",
  "depositExplorerUrl": "https://polygonscan.com/tx/0x...",
  "executeStatus": "EXECUTING",
  "receipt": { "intentReceipt": { "status": "SUCCEEDED", ... } }
}
```

The `executeStatus` may be `EXECUTING` initially while the destination side settles; `receipt.intentReceipt.status` becomes `SUCCEEDED` once the swap completes.

## When to use

- The user wants to convert tokens (USDC → USDC.e for Polymarket, USDC → WETH for DeFi, etc.)
- Cross-chain bridging (Polygon ↔ Base, Polygon ↔ Arbitrum)

Always dry-run first to show the expected destination amount, then broadcast on confirmation.
