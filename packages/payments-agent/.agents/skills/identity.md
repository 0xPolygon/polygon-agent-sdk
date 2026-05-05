---
name: identity
description: ERC-8004 agent identity and reputation operations on Polygon — register, get info, leave/read feedback.
---

# ERC-8004 agent identity

## Register a new agent (mints an NFT)

```bash
polygon-agent agent register --name <n> [--agent-uri <uri>] [--metadata <k=v,k=v>] [--broadcast]
```

After broadcast, the `agentId` lives in the `Registered` event on the Logs tab of the tx — the CLI's response includes the tx hash; use that to retrieve the ID.

## Lookup

```bash
polygon-agent agent wallet --agent-id <id>          # get the payment wallet for an agent
polygon-agent agent metadata --agent-id <id> --key <key>
polygon-agent agent reputation --agent-id <id> [--tag1 <t>] [--tag2 <t>]
polygon-agent agent reviews --agent-id <id> [--tag1 <t>] [--tag2 <t>] [--revoked]
```

## Leave feedback (broadcast)

```bash
polygon-agent agent feedback --agent-id <id> --value <score> [--tag1 <t>] [--tag2 <t>] [--feedback-uri <uri>] [--broadcast]
```

`--value` is a 0–100 score. Tags categorize the feedback (e.g. `tag1=trading`, `tag2=accuracy`).

## Contracts (Polygon mainnet only)

- IdentityRegistry: `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`
- ReputationRegistry: `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63`

ERC-8004 only works on `polygon` (mainnet). Reject any request to use it on other chains.
