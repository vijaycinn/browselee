# Browselee

Point at any webpage. Chat or talk to it. Powered by Azure AI Foundry Realtime (`gpt-realtime-mini`) and `defuddle`.

---

## Hero Diagram

```mermaid
flowchart LR
  subgraph Browser
    CS["Content Script<br/>Shadow DOM injector"]
    WG["React Widget<br/>iframe"]
    SW["Service Worker<br/>background.ts"]
    OS["Offscreen Doc<br/>Defuddle + DOMParser"]
  end
  subgraph Azure["Azure Cloud"]
    BE["Fastify Backend<br/>Azure Container Apps"]
    MI["User-Assigned MI<br/>(Keyless Auth)"]
    FD["Azure AI Foundry<br/>gpt-realtime-mini"]
  end
  Page["Any webpage<br/>e.g. cityofsacramento.gov"]
  Page -->|Inject| CS
  CS -->|Shadow DOM| WG
  WG <-->|Messages| SW
  SW <-->|Extract/Crawl| OS
  SW -->|POST /api/session<br/>POST /api/chat| BE
  BE -->|AAD ai.azure.com<br/>Bearer token| MI
  MI -->|Cognitive Services<br/>OpenAI User| FD
  WG -.->|WebRTC SDP| FD
  WG <==|RTC audio + data| FD
```

---

## What It Does

- **Injects a floating chat/voice widget** on any page via Chrome extension (MV3, Shadow DOM)
- **Eagerly extracts the current page + up to 8 same-origin linked pages** with `defuddle` (removes nav/ads/sidebars for cleaner grounding)
- **Streams voice + text through Azure Foundry Realtime over WebRTC** — browser directly to Foundry; backend only mints ephemeral tokens (lowest latency, no audio proxy)
- **Falls back to `gpt-4o-mini` text streaming over SSE** for text-only sessions when Realtime is unavailable

---

## Architecture Decisions

| Decision | Rationale | Docs |
|---|---|---|
| **Ephemeral tokens** (not bearer tokens in browser) | Scoped, short-lived; browser never holds persistent credentials | [`realtime-api-notes.md`](./docs/realtime-api-notes.md) |
| **WebRTC direct to Foundry** | Lowest latency, no audio proxy overhead, GCC-compliant (audio stays on Azure backbone) | GA API only; preview deprecated Apr 30 2026 |
| **Defuddle + DOMParser in offscreen doc** | Safer extraction (runs in isolated context), efficient link enumeration | [`extension/src/lib/crawl.ts`](./extension/src/lib/crawl.ts) |
| **Service Worker message routing** | Central hub for extract/crawl/session flows; decouples content script from widget | [`extension/src/background.ts`](./extension/src/background.ts) |
| **Fastify backend (stateless)** | Rate-limited, CORS-safe, rapid token minting; designed for container scale | [`backend/src/server.ts`](./backend/src/server.ts) |
| **User-Assigned Managed Identity (UAMI)** | No API keys in env vars; keyless auth for production Azure deployments | [`infra/main.bicep`](./infra/main.bicep) |

---

## Repo Layout

```
browselee/
├── README.md                          ← You are here
├── package.json                       Root workspace config (Node 20+, pnpm 9+)
├── pnpm-workspace.yaml
│
├── extension/                         Chrome extension (MV3)
│   ├── src/
│   │   ├── manifest.ts               Extension metadata + permissions
│   │   ├── content.ts                Injects widget + service worker bridge
│   │   ├── background.ts             Service Worker (extract/crawl/session routing)
│   │   ├── offscreen.html            Isolated DOM context for defuddle
│   │   ├── offscreen.ts              Runs DOMParser + link extraction in offscreen
│   │   ├── widget/
│   │   │   ├── App.tsx               Main React widget (chat/voice UI)
│   │   │   ├── hooks/
│   │   │   │   ├── useRealtime.ts    WebRTC + Realtime session management
│   │   │   │   ├── useChannel.ts     SW message channel (bidirectional)
│   │   │   │   └── useExtraction.ts  Corpus fetch + status tracking
│   │   │   └── lib/
│   │   │       ├── crawl.ts          Concurrent link fetch, corpus assembly
│   │   │       ├── corpusFormatter.ts Format corpus as system prompt
│   │   │       └── settings.ts       chrome.storage.local persistence
│   │   └── shared/messages.ts        TypeScript message interfaces
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
│
├── backend/                           Fastify API
│   ├── src/
│   │   ├── server.ts                 App bootstrap, middleware
│   │   ├── routes/
│   │   │   ├── session.ts            POST /api/session → ephemeral token
│   │   │   └── chat.ts               POST /api/chat → SSE text streaming
│   │   └── foundry.ts                AAD token acquisition, OpenAI client init
│   ├── Dockerfile                    Multi-stage, Node + pnpm
│   ├── package.json
│   └── tsconfig.json
│
├── infra/                             Azure IaC (Bicep)
│   ├── main.bicep                    Subscription-scope deployment
│   ├── main.bicepparam               Default params (dev environment)
│   ├── deploy.ps1                    PowerShell wrapper script
│   ├── modules/
│   │   ├── identity.bicep            UAMI creation
│   │   ├── aca.bicep                 Container Apps (logs + ACR + env + app)
│   │   └── foundry-role.bicep        Cross-RG role assignment
│   └── README.md                     Detailed IaC documentation
│
├── .github/workflows/                CI/CD pipelines
│   ├── extension.yml                 Build + package extension
│   ├── backend.yml                   Build + push Docker + deploy to ACA
│   ├── lint.yml                      ESLint on PRs
│   └── README.md                     Workflow setup + OIDC config
│
├── docs/
│   ├── realtime-api-notes.md         Azure AI Foundry Realtime API contract (LOCKED)
│   └── DEMO-SACRAMENTO.md            City of Sacramento walkthrough + runbook
│
└── LICENSE                            MIT
```

---

## Prerequisites

| Requirement | Command |
|---|---|
| **Node 20+** | `node --version` |
| **pnpm 9+** | `npm install -g pnpm && pnpm --version` |
| **Chrome or Edge Chromium** | [Download](https://www.google.com/chrome) |
| **Azure CLI** | `az version` |
| **Bicep CLI** | Installed automatically; or `az bicep install` |
| **Azure subscription** | With [Azure AI Foundry resource](https://ai.azure.com) |
| **Deployed Foundry models** | `gpt-realtime-mini` + `gpt-4o-mini` (pre-configured: `smec-poc-vcinn-resource` in `eastus2`) |
| **Azure authentication** | `az login` |

---

## Quick Start (Local Dev)

```powershell
# Clone and install
git clone https://github.com/vijaycinn/browselee.git
cd browselee
pnpm install

# Set Foundry env vars
$env:FOUNDRY_ENDPOINT = "https://smec-poc-vcinn-resource.openai.azure.com"
$env:FOUNDRY_REALTIME_MODEL = "gpt-realtime-mini"
$env:FOUNDRY_TEXT_MODEL = "gpt-4o-mini"

# Terminal 1: Backend (uses your `az login` for AAD)
pnpm --filter @browselee/backend dev

# Terminal 2: Build extension
pnpm --filter @browselee/extension build

# Manual step: Load extension in Chrome
# 1. Open chrome://extensions
# 2. Toggle "Developer mode" (top-right)
# 3. Click "Load unpacked"
# 4. Select C:\workspace\browselee\extension\dist
```

The widget will appear on any webpage (bottom-right, pulsing circle).

---

## Configuration

### Backend Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `FOUNDRY_ENDPOINT` | ✅ | — | Azure AI Foundry resource endpoint (e.g., `https://smec-poc-vcinn-resource.openai.azure.com`) |
| `FOUNDRY_REALTIME_MODEL` | ✅ | — | Realtime model deployment name (e.g., `gpt-realtime-mini`) |
| `FOUNDRY_TEXT_MODEL` | ✅ | — | Text model deployment name (e.g., `gpt-4o-mini`) |
| `AZURE_CLIENT_ID` | ❌ | — | User-Assigned Managed Identity client ID (production only; dev uses `DefaultAzureCredential`) |
| `PORT` | ❌ | `8080` | HTTP port |
| `NODE_ENV` | ❌ | `development` | Environment mode |

### Extension Settings (via `chrome.storage.local`)

| Key | Type | Default | Description |
|---|---|---|---|
| `browselee_backend_url` | string | `http://localhost:8080` | Backend API base URL |
| `browselee_settings.model` | `"realtime" \| "text"` | `"realtime"` | Which model to use (falls back to text if Realtime unavailable) |
| `browselee_settings.voice` | string | `"alloy"` | Realtime voice name (alloy/ash/ballad/coral/echo/marin/sage/shimmer/verse) |
| `browselee_settings.whisperDeployment` | string | — | Optional custom Whisper deployment name (uses default if omitted) |

---

## Azure Deploy

### Step 1: Deploy Infrastructure

```powershell
cd C:\workspace\browselee\infra
.\deploy.ps1
# (or .\deploy.ps1 -Env staging for non-dev)
```

Outputs are saved to `.deployment-outputs.json` (gitignored):
- `apiUrl` — public endpoint of the Container App
- `uamiClientId` — UAMI client ID for CI/CD
- `acrLoginServer` — ACR hostname for image pushes

### Step 2: Configure GitHub Actions

Copy outputs to **GitHub repository settings → Secrets and variables → Variables**:

| Variable | Source |
|---|---|
| `AZURE_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |
| `AZURE_TENANT_ID` | `az account show --query tenantId -o tsv` |
| `AZURE_CLIENT_ID` | From `.deployment-outputs.json` |
| `ACR_NAME` | From `.deployment-outputs.json` (without `.azurecr.io`) |
| `ACA_NAME` | From Bicep output (e.g., `browselee-dev-api`) |
| `ACA_RG` | From Bicep output (e.g., `rg-browselee-dev`) |

See [`.github/workflows/README.md`](./.github/workflows/README.md) for OIDC setup and troubleshooting.

### Step 3: First Image Push

After the Bicep deploy completes:

```powershell
# Authenticate to ACR
az acr login --name <acrLoginServer>

# Build and push
docker build -f backend/Dockerfile -t <acrLoginServer>/browselee-backend:latest .
docker push <acrLoginServer>/browselee-backend:latest

# Update Container App to use the new image
az containerapp update `
  --name browselee-dev-api `
  --resource-group rg-browselee-dev `
  --image <acrLoginServer>/browselee-backend:latest
```

Subsequent pushes are automatic via GitHub Actions (`backend.yml`).

---

## Testing

```powershell
# Run all tests (backend + extension)
pnpm -r test

# Backend tests (foundry, session, chat routes)
pnpm --filter @browselee/backend test

# Extension tests (offscreen, corpusFormatter, crawl)
pnpm --filter @browselee/extension test
```

---

## Demo: City of Sacramento

**New to this project?** Start with the [City of Sacramento demo runbook](./docs/DEMO-SACRAMENTO.md) for a step-by-step walkthrough, talking points, and troubleshooting.

**Pre-flight checklist:**
- ✅ Backend running locally or deployed to Azure
- ✅ Extension loaded unpacked in Chrome (or from App Store once published)
- ✅ Microphone permissions granted to browser
- ✅ https://www.cityofsacramento.gov/ open in a tab
- ✅ System sound enabled

**Key demo questions:**
1. *"What services does the city offer for housing assistance?"* — page grounding + link traversal
2. *"How do I report a pothole?"* — citation accuracy
3. *"Tell me about business permits"* — multi-turn memory
4. **Switch model in settings** → re-ask to show Realtime vs text mode variance
5. **Use voice** → demonstrate low-latency audio response

See [`docs/DEMO-SACRAMENTO.md`](./docs/DEMO-SACRAMENTO.md) for full runbook, recovery playbook, and post-demo follow-up template.

---

## Key Links

| Resource | Purpose |
|---|---|
| [Azure AI Foundry Docs](https://learn.microsoft.com/en-us/azure/ai-services/openai/) | API reference, models, quotas |
| [`realtime-api-notes.md`](./docs/realtime-api-notes.md) | **LOCKED** contract for Realtime API (GA vs preview, token endpoints, WebRTC) |
| [`infra/README.md`](./infra/README.md) | Infrastructure deployment, UAMI, container apps, Bicep details |
| [`.github/workflows/README.md`](./.github/workflows/README.md) | CI/CD, OIDC, GitHub Actions setup |
| [Defuddle](https://github.com/kepano/defuddle) | HTML cleaning library (removes nav, sidebars, ads) |

---

## License

MIT

---

## Acknowledgments

- **Defuddle** — Kepano, for clean HTML extraction
- **Azure AI Foundry** — Realtime API, ephemeral tokens, container infrastructure
- **Microsoft Learn** — Comprehensive guidance on Azure services, AAD, container apps, Bicep
