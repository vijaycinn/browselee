# Browselee Backend

> See [repo root README](../README.md) for full project overview.

Fastify-based API service for Azure AI Foundry Realtime token minting and text-mode chat streaming.

---

## Quick Start

```powershell
# Set Foundry env vars
$env:FOUNDRY_ENDPOINT = "https://smec-poc-vcinn-resource.openai.azure.com"
$env:FOUNDRY_REALTIME_MODEL = "gpt-realtime-mini"
$env:FOUNDRY_TEXT_MODEL = "gpt-4o-mini"

# Run locally (uses `az login` for AAD)
pnpm dev

# Server listens on http://0.0.0.0:8080
```

---

## Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/healthz` | GET | Health check → `{ ok: true }` |
| `/api/session` | POST | Mint ephemeral Realtime token (rate-limited: 30 req/min) |
| `/api/chat` | POST | Stream text response via SSE (rate-limited: 60 req/min) |

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `FOUNDRY_ENDPOINT` | ✅ | — | Azure AI Foundry resource URL |
| `FOUNDRY_REALTIME_MODEL` | ✅ | — | Realtime model deployment name |
| `FOUNDRY_TEXT_MODEL` | ✅ | — | Text model deployment name |
| `AZURE_CLIENT_ID` | ❌ | — | UAMI client ID (production; dev uses `DefaultAzureCredential`) |
| `PORT` | ❌ | `8080` | HTTP port |

---

## Authentication

- **Local:** Uses `DefaultAzureCredential` (tries UAMI → env vars → interactive login)
- **Production:** Uses `ManagedIdentityCredential` when `AZURE_CLIENT_ID` is set

Tokens are cached and auto-refreshed 5 minutes before expiry. See [`src/foundry.ts`](./src/foundry.ts) for implementation.

---

## Build & Test

```powershell
pnpm build
pnpm test
```

---

## Docker

Build from repo root (context needs `pnpm-lock.yaml`):

```bash
docker build -f backend/Dockerfile -t browselee-backend:latest .
```

---

## See Also

- [Main README](../README.md) — architecture, quick start, configuration
- [Realtime API contract](../docs/realtime-api-notes.md) — GA API endpoints, token scopes
- [Infra / IaC](../infra/README.md) — Container Apps, UAMI, deployment
- [GitHub Actions](../.github/workflows/README.md) — CI/CD, OIDC, image pushes
