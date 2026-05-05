---
name: x402-pay
description: Call HTTP endpoints that require x402 micropayments. The CLI auto-detects the 402 response, signs an EIP-3009 payment, and retries.
---

# x402 micropayments

```bash
polygon-agent x402-pay --url <url> --wallet main [--method GET|POST] [--body '<json>'] [--header 'Key: Value']
```

The CLI:
1. Sends the initial request
2. If the endpoint returns `HTTP 402 Payment Required`, parses the payment requirements from the response
3. Funds the builder EOA with the exact token amount from the smart wallet
4. Signs an EIP-3009 transferWithAuthorization
5. Retries the original request with the `X-PAYMENT` header
6. Returns the final response body

This always executes (no `--broadcast` needed — payments are required to get the response).

## Output

```json
{
  "ok": true,
  "status": 200,
  "data": { "...endpoint response body..." }
}
```

## When to use

- The user wants to call a paid API (Twitter scraping, AI image gen, code review, web search) without managing API keys.
- The user wants to test x402 endpoints.

## Catalog

The x402 Bazaar at `https://x402-api.onrender.com/api/catalog?status=online` lists available services. Most charge $0.005–$0.02 USDC per call.
