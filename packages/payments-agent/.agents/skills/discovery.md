---
name: discovery
description: Discover and use the x402 Bazaar — pay-per-call APIs (web search, Twitter, AI image gen, sentiment, code review).
---

# x402 Bazaar — pay-per-call APIs

The Bazaar catalog lives at `https://x402-api.onrender.com/api/catalog?status=online`. Most services charge $0.005–$0.02 USDC per call. No API keys required.

## How to call

Every Bazaar endpoint is reached with the same primitive:

```bash
polygon-agent x402-pay --url "<url>" --wallet main --method GET
# or for POSTs with a body:
polygon-agent x402-pay --url "<url>" --wallet main --body '{"...":"..."}'
```

## Common services

| Service | Price | Endpoint pattern | Key params |
|---------|-------|------------------|-----------|
| Web search (DuckDuckGo) | $0.005 | `https://x402-api.onrender.com/api/call/9b0f5b5f-...` | `?q=<query>&max=10` |
| Latest news | $0.005 | `/api/call/266d045f-...` | `?topic=<topic>&lang=en` |
| Twitter/X profile + tweets | $0.005 | `https://x402-api.onrender.com/api/twitter` | `?user=<username>` |
| AI image (Gemini) | $0.02 | `https://x402-api.onrender.com/api/image` | `?prompt=<...>&size=512` |
| Article → Markdown | $0.005 | `/api/call/87b50238-...` | `?url=<article-url>` |
| Sentiment | $0.005 | `/api/call/66d68ca6-...` | `?text=<text>` |
| Summarize text | $0.01 | `/api/call/dd9b5098-...` | `?text=<text>&maxLength=200` |

The `/api/call/<uuid>` proxy routes need an admin token and aren't always public. The direct routes (`/api/twitter`, `/api/image`) are the reliable ones — prefer those.

## When to use

- The user wants information from an external API and is OK paying micropayments per call.
- For one-off lookups where setting up a free-tier API key isn't worth it.

## Gotchas

- Funds come from the smart wallet's USDC.e. Run `balances` first to confirm there's enough.
- The CLI signs and submits the payment automatically — no manual EIP-3009 signing.
- `Could not create api key` from Polymarket-style stderr is unrelated; ignore it for Bazaar calls.
