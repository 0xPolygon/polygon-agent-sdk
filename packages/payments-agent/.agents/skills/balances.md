---
name: balances
description: Check wallet balances on Polygon and other chains. Returns native + ERC-20 holdings.
---

# Check balances

Run via shell:

```bash
polygon-agent balances [--wallet <name>] [--chain <chain>] [--chains <csv>]
```

- `--wallet <name>` — wallet name from `wallet list` (default `main`)
- `--chain <chain>` — single chain (`polygon`, `amoy`, `mainnet`, `arbitrum`, `optimism`, `base`)
- `--chains <csv>` — multi-chain mode, e.g. `--chains polygon,base,arbitrum` (max 20). Returns `multiChain: true` with a `chains` array.

## Output (single chain)

```json
{
  "ok": true,
  "walletName": "main",
  "walletAddress": "0x...",
  "chainId": 137,
  "chain": "polygon",
  "balances": [
    { "type": "native", "symbol": "POL", "balance": "0.82" },
    { "type": "erc20", "symbol": "USDC.e", "name": "USDC.e", "contractAddress": "0x2791...", "balance": "1.49" }
  ]
}
```

## Use this skill when
- The user asks about their balance, holdings, or what they have on a chain.
- You need to verify funding before constructing a `send`, `swap`, `deposit`, or Polymarket trade.
- You need to confirm the gas reserve before broadcasting any transaction.
