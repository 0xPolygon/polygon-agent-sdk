---
name: send
description: Send native POL or ERC-20 tokens to a recipient address. Dry-run by default.
---

# Send tokens

## Native (POL)

```bash
polygon-agent send-native --to <addr> --amount <num> [--broadcast]
```

## ERC-20 by symbol

```bash
polygon-agent send-token --symbol <SYM> --to <addr> --amount <num> [--broadcast]
```

## ERC-20 by contract address (when symbol is unknown)

```bash
polygon-agent send-token --token <0x...> --decimals <n> --to <addr> --amount <num> [--broadcast]
```

## Auto-detect (`send`)

`polygon-agent send` infers native vs ERC-20 from `--symbol`. Use it when the user says "send 5 USDC to ..." without specifying token vs native.

## Output (broadcast)

```json
{
  "ok": true,
  "walletName": "main",
  "walletAddress": "0x...",
  "to": "0x...",
  "amount": "5.0",
  "txHash": "0x...",
  "explorerUrl": "https://polygonscan.com/tx/0x..."
}
```

## Rules

- **Dry-run first.** Without `--broadcast`, the CLI returns `{ "ok": true, "dryRun": true }` and does nothing on-chain. Run dry-run, show the user, then re-run with `--broadcast` only when the instruction confirms.
- **Reserve gas.** Don't spend the full balance — leave ~0.1 USDC or 0.1 POL for fees.
- **Use the address verbatim.** Never substitute, never auto-correct.
