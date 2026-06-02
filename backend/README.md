# Browselee Backend

Fastify-based API service for document processing and semantic analysis.

## Setup

### Environment Variables

- `FOUNDRY_ENDPOINT`: Azure AI Foundry endpoint (e.g., `https://smec-poc-vcinn-resource.openai.azure.com`)
- `FOUNDRY_TEXT_MODEL`: Model deployment name (default: `gpt-4o-mini`)
- `PORT`: Server port (default: `8080`)
- `AZURE_CLIENT_ID`: (Optional) Managed Identity client ID for production

### Local Development

```bash
pnpm install
pnpm dev
```

Server will listen on http://0.0.0.0:8080

### Build & Test

```bash
pnpm build
pnpm test
```

## API Endpoints

### `GET /healthz`

Health check endpoint. Returns `{ ok: true }`.

### `POST /api/chat`

Streaming chat endpoint using Azure AI Foundry's `gpt-4o-mini` deployment.

**Request:**
```json
{
  "messages": [
    { "role": "system|user|assistant", "content": "..." }
  ],
  "context": "Optional markdown context (max 60KB)"
}
```

**Response:**
Server-Sent Events (SSE) stream. Each event contains a delta object with the model's response chunk.

**Example:**
```bash
curl -X POST http://localhost:8080/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "context": "# Document Title\nSome content..."
  }'
```

## Docker Build

**Note:** The `Dockerfile` uses multi-stage builds with relative COPY paths. When building in CI, ensure the build context is set to the repository root:

```bash
docker build -f backend/Dockerfile -t browselee-backend:latest .
```

The Dockerfile will correctly resolve `pnpm-lock.yaml` from the repo root and `src/` from `backend/`.

## Authentication

The service uses Azure AD (AAD) for authentication to Azure AI Foundry:

- **Local Development**: Uses `DefaultAzureCredential`, which tries managed identity, environment variables, then interactive login.
- **Production**: Uses `ManagedIdentityCredential` when `AZURE_CLIENT_ID` is set, falling back to `DefaultAzureCredential`.

Token caching is automatic — tokens are refreshed 5 minutes before expiry.

