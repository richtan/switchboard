# MPP Router

Cost-optimized API router that selects the cheapest provider for each request intent, handles [MPP](https://www.anthropic.com/research/mpp) micropayments automatically, and tracks savings in real time.

**Live dashboard:** [mpprouter.com](https://mpprouter.com)

## How it works

1. You send a request with an **intent** (e.g. `web_search`, `llm`, `image_gen`)
2. The router picks the **cheapest available provider** for that intent
3. Payment is handled automatically via the MPP 402 protocol
4. You get the response back with routing metadata in headers

## Supported intents

`web_search` · `scrape` · `llm` · `image_gen` · `travel` · `email` · `social` · `enrich` · `maps` · `blockchain` · `weather` · `finance`

## Quickstart

```bash
# Clone and install
git clone git@github.com:richtan/mpprouter.git
cd mpprouter
npm install

# Configure
export SPENDING_KEY=0x...   # MPP signing key (required)
export API_KEY=my-secret    # Protect spending endpoints (recommended)
export BUDGET=5             # Max USD to spend (default: $5)

# Run with terminal dashboard
npm run dev

# Or headless
npm start
```

The server starts on port **3402** (override with `PORT` env var).

## API

All spending endpoints (`/intent/*`, `/proxy/*`) require `Authorization: Bearer <API_KEY>` when `API_KEY` is set. Read-only endpoints are open.

### Intent routing

```bash
# Search the web
curl -X POST "http://localhost:3402/intent/web_search?q=hello" \
  -H "Authorization: Bearer $API_KEY"

# Generate an image
curl -X POST "http://localhost:3402/intent/image_gen" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "a cat in space"}'
```

Response headers include routing metadata:
- `X-MppRouter-Intent` — matched intent
- `X-MppRouter-Provider` — selected provider
- `X-MppRouter-Price` — cost in USD
- `X-MppRouter-Saved` — savings vs next cheapest

### Other endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | Web dashboard |
| GET | `/events` | No | SSE stream (live transactions + stats) |
| GET | `/health` | No | Service/intent counts |
| GET | `/prices` | No | All intents with provider pricing |
| GET | `/compare/:intent` | No | Compare providers for an intent |
| GET | `/stats` | No | Spending totals and recent transactions |
| ALL | `/proxy/*` | Yes | Direct proxy to a specific service |

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SPENDING_KEY` | Yes | — | Hex private key for MPP payment signing |
| `API_KEY` | No | — | Bearer token for spending endpoints |
| `BUDGET` | No | `5` | Max USD spend per session |
| `PORT` | No | `3402` | HTTP server port |

## Deploy

Deployed on [Railway](https://railway.app) via Docker:

```bash
railway up --detach
```

Or use the Dockerfile directly:

```bash
docker build -t mpprouter .
docker run -p 3402:3402 \
  -e SPENDING_KEY=0x... \
  -e API_KEY=my-secret \
  mpprouter
```

## Architecture

```
Request → Auth middleware → Intent matching → Provider selection (cheapest)
  → MPP payment (402 protocol) → Proxy to provider → Response + metadata
```

- **Hono** web framework on Node.js
- **mppx** for cryptographic micropayments
- Services loaded from `src/discovery/services.json`
- Provider failures tracked with 60s cooldown
- Transaction log kept in memory (last 1000)
