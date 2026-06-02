# Browselee Infrastructure

Bicep IaC for deploying the Browselee backend on Azure Container Apps with keyless (UAMI) auth to Azure AI Foundry.

---

## Architecture

```
subscription (941e8603-…)
│
├── rg-browselee-dev                         ← NEW (created by this template)
│   ├── browselee-dev-uami                   UAMI (User-Assigned Managed Identity)
│   ├── browselee-dev-logs                   Log Analytics Workspace
│   ├── browseleeacr<hash>                   Azure Container Registry (Basic, no admin)
│   ├── browselee-dev-env                    Container Apps Environment
│   └── browselee-dev-api                    Container App (external ingress :8080)
│
└── rg-smec-poc-hf-models                    EXISTING — Foundry resource group
    └── smec-poc-vcinn-resource              Azure AI Foundry account
        └── (role assignment: UAMI → Cognitive Services OpenAI User)
```

**The Foundry account is NOT created by this template.** Only a cross-RG role assignment is added so the UAMI can call Foundry APIs without API keys.

### Identity flow

```
Container App → UAMI (browselee-dev-uami)
                  ├── AcrPull      → browseleeacr<hash>   (pull images at runtime)
                  └── Cognitive Services OpenAI User → smec-poc-vcinn-resource (Foundry)
```

The container app authenticates to Foundry using `DefaultAzureCredential` with `AZURE_CLIENT_ID` set to the UAMI client ID.

---

## File layout

```
infra/
├── main.bicep              Subscription-scope entry point
├── main.bicepparam         Default parameter values (dev)
├── deploy.ps1              PowerShell deploy wrapper
├── modules/
│   ├── identity.bicep      UAMI creation
│   ├── aca.bicep           Log Analytics + ACR + Container Apps env + Container App
│   └── foundry-role.bicep  Cross-RG role assignment on existing Foundry account
├── .foundry-config.json    ← gitignored, local Foundry context
└── .deployment-outputs.json← gitignored, saved after each deploy
```

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Azure CLI ≥ 2.50 | `az version` |
| Bicep CLI | `az bicep install` (auto-installed on first use) |
| Subscription contributor | Needed to create RG + role assignments |
| Owner/UAA on `rg-smec-poc-hf-models` | Needed for the cross-RG role assignment |
| Docker (optional) | Only needed to push images to ACR manually |

---

## Deploy

```powershell
cd C:\workspace\browselee\infra

# Validate template without deploying
.\deploy.ps1 -ValidateOnly

# Full deploy (dev environment)
.\deploy.ps1

# Deploy a specific environment
.\deploy.ps1 -Env staging
```

Outputs are saved to `.deployment-outputs.json` (gitignored). Copy `acrLoginServer` and `uamiClientId` into your GitHub Actions secrets.

### First push after deploy

```bash
# Build and push your image
az acr login --name <acrLoginServer>
docker build -t <acrLoginServer>/browselee-backend:latest ./backend
docker push <acrLoginServer>/browselee-backend:latest

# Update the container app to use the real image
az containerapp update \
  --name browselee-dev-api \
  --resource-group rg-browselee-dev \
  --image <acrLoginServer>/browselee-backend:latest
```

---

## Tear down

```bash
# Delete the browselee resource group (non-blocking)
az group delete -n rg-browselee-dev --yes --no-wait

# The Foundry RG (rg-smec-poc-hf-models) is NOT touched by teardown.
# Remove the UAMI role assignment manually if desired:
# az role assignment delete --assignee <uamiPrincipalId> \
#   --role "Cognitive Services OpenAI User" \
#   --scope /subscriptions/.../resourceGroups/rg-smec-poc-hf-models/providers/Microsoft.CognitiveServices/accounts/smec-poc-vcinn-resource
```

---

## Environment variables injected into the Container App

| Name | Value |
|---|---|
| `FOUNDRY_ENDPOINT` | `https://smec-poc-vcinn-resource.services.ai.azure.com` |
| `FOUNDRY_REALTIME_MODEL` | `gpt-realtime-mini` |
| `FOUNDRY_TEXT_MODEL` | `gpt-4o-mini` |
| `AZURE_CLIENT_ID` | UAMI client ID (for `DefaultAzureCredential`) |
| `PORT` | `8080` |
| `NODE_ENV` | `production` |

---

## Notes

- **ACR admin is disabled** — the container app pulls images via the UAMI's `AcrPull` role.
- **Foundry resource is shared** — the `rg-smec-poc-hf-models` RG and the Foundry account pre-exist and are not modified by this template beyond the single role assignment.
- The `image` parameter defaults to `mcr.microsoft.com/k8se/quickstart:latest` so the first deploy succeeds without a real image. CI should override it.

