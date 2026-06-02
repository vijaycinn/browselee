# GitHub Actions Workflows

This directory contains the CI/CD workflows for browselee.

## Workflows

### extension.yml
Builds and packages the browser extension.

**Triggers:**
- Push to `main` touching `extension/**` or `pnpm-lock.yaml`
- Tag push (v*)
- Manual trigger (`workflow_dispatch`)

**Actions:**
- Installs dependencies and builds the extension
- Runs tests
- Creates a zip artifact: `browselee-extension-<sha>.zip`
- On tag push: creates a GitHub Release and attaches the zip

**Artifacts:**
- Retained for 14 days
- On tag: attached to GitHub Release with name `browselee-extension-<tag>.zip`

### backend.yml
Builds, pushes, and deploys the backend service to Azure Container Apps.

**Triggers:**
- Push to `main` touching `backend/**` or `pnpm-lock.yaml`
- Manual trigger with optional `deploy` input (default: true)

**Actions:**
- Installs dependencies and builds the backend
- Runs tests
- Authenticates to Azure via OIDC (no stored credentials)
- Builds Docker image and pushes to ACR
- Updates Azure Container Apps with the new image (automatic on push, optional on manual trigger)

**Environment Variables (required as GitHub variables/secrets):**
- `ACR_NAME` — ACR instance name (e.g., `browseleeprod`)
- `ACA_NAME` — Container App name (e.g., `browselee-api`)
- `ACA_RG` — Resource Group containing the Container App
- `AZURE_CLIENT_ID` — Entra app/UAMI client ID for CI/CD
- `AZURE_TENANT_ID` — Azure tenant ID
- `AZURE_SUBSCRIPTION_ID` — Azure subscription ID

### lint.yml
Lints the codebase on pull requests.

**Triggers:**
- Pull request to `main`

**Actions:**
- Installs dependencies
- Runs `pnpm lint` (ESLint on root + workspaces)

---

## Setup Instructions

### 1. GitHub Repository Variables and Secrets

Add these as **Repository Variables** (not Secrets) in GitHub:

| Variable | Description | Example |
|---|---|---|
| `ACR_NAME` | ACR login server name (without `.azurecr.io`) | `browseleeprod` |
| `ACA_NAME` | Container App name | `browselee-api` |
| `ACA_RG` | Resource Group name | `rg-browselee-prod` |
| `AZURE_CLIENT_ID` | Entra app client ID for CI/CD | `12345678-1234-1234-1234-123456789012` |
| `AZURE_TENANT_ID` | Azure tenant ID | `87654321-4321-4321-4321-210987654321` |
| `AZURE_SUBSCRIPTION_ID` | Azure subscription ID | `11111111-2222-3333-4444-555555555555` |

### 2. Azure Federated Credentials (OIDC)

The backend workflow uses OIDC to authenticate to Azure without stored credentials. This requires setting up federated credentials on an Entra app or User-Assigned Managed Identity.

#### Option A: Create a dedicated service principal for CI/CD

```bash
# Create Entra app
APP_ID=$(az ad app create --display-name browselee-cicd-spn --query appId -o tsv)

# Create service principal
SPID=$(az ad sp create --id "$APP_ID" --query id -o tsv)

# Add federated credential for main branch
cat > fic-main.json << 'EOF'
{
  "name": "browselee-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:vijaycinn/browselee:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF

az ad app federated-credential create --id "$APP_ID" --parameters @fic-main.json

# Grant roles to the service principal
az role assignment create --assignee "$SPID" --role AcrPush --scope "/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$ACR_RG"
az role assignment create --assignee "$SPID" --role "Contributor" --scope "/subscriptions/$AZURE_SUBSCRIPTION_ID/resourceGroups/$ACA_RG"
```

Then populate the GitHub variables with:
- `AZURE_CLIENT_ID` = `$APP_ID`
- `AZURE_TENANT_ID` = `<your tenant ID>`
- `AZURE_SUBSCRIPTION_ID` = `<your subscription ID>`

#### Option B: Reuse the UAMI created by Bicep

If the Bicep script (`infra/main.bicep`) provisioned a User-Assigned Managed Identity for the Container App, you can reuse it for CI/CD by:

1. Adding the federated credential to the existing UAMI
2. Granting it `AcrPush` on the ACR
3. Granting it `Contributor` (or finer-grained roles) on the Container Apps resource group

```bash
UAMI_ID=$(az identity show -g "$ACA_RG" -n browselee-mi --query clientId -o tsv)

cat > fic-main.json << 'EOF'
{
  "name": "browselee-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:vijaycinn/browselee:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}
EOF

az identity federated-credential create --name browselee-main --identity-name browselee-mi --resource-group "$ACA_RG" --parameters @fic-main.json
```

**Recommendation:** Use Option A (dedicated service principal) for clear separation of concerns and to avoid mixing runtime and CI/CD permissions.

### 3. Docker Build Context

The `backend.yml` workflow builds the Docker image with:
```bash
docker build -f backend/Dockerfile -t ... .
```

The **build context is the repo root** (`.`) because:
- The `pnpm-lock.yaml` is at the repo root
- The Dockerfile uses relative paths (`COPY package.json pnpm-lock.yaml* ./`)

This is already configured in the workflow and in the Dockerfile (multi-stage).

### 4. ACR Permissions

The CI/CD principal (service principal or UAMI) must have:
- **AcrPush** on the ACR resource
- **Contributor** (or `Microsoft.App/containerApps/*`) on the Container Apps resource group

Verify with:
```bash
az role assignment list --assignee "$AZURE_CLIENT_ID" --scope /subscriptions/$AZURE_SUBSCRIPTION_ID
```

### 5. Container App Configuration

Ensure the Container App in Azure is configured to:
- Pull images from the ACR
- Use the appropriate UAMI as the runtime identity (if applicable)
- Expose port 8080 (as per the Dockerfile `EXPOSE` statement)

---

## Workflow Execution

### Extension Workflow
On a push to `main` with changes to `extension/**`:
1. Builds the extension
2. Runs tests
3. Creates an artifact zip with retention 14 days
4. On tag (v*), creates a GitHub Release and attaches the zip

### Backend Workflow
On a push to `main` with changes to `backend/**`:
1. Builds and tests the backend
2. Authenticates to Azure via OIDC
3. Builds and pushes the Docker image to ACR
4. Updates the Container App with the new image

Manual trigger with `deploy=false` will build and push but skip the Container Apps update.

### Lint Workflow
On any pull request to `main`:
1. Installs dependencies
2. Runs `pnpm lint` (ESLint)

---

## Troubleshooting

### OIDC Token Exchange Fails
- Verify the federated credential subject matches the GitHub repository and branch:
  ```
  repo:vijaycinn/browselee:ref:refs/heads/main
  ```
- Ensure the Entra app/UAMI has permissions on the ACR and Container Apps RG

### ACR Login Fails
- Verify the service principal/UAMI has the `AcrPush` role
- Check that `ACR_NAME` variable is set correctly (without `.azurecr.io`)

### Docker Build Fails
- Ensure the build context is the repo root (it is, in the workflow)
- Verify the `pnpm-lock.yaml` exists at repo root
- Check that `backend/Dockerfile` has the correct relative paths

### Container App Update Fails
- Verify `ACA_NAME` and `ACA_RG` are correct
- Ensure the service principal has `Contributor` role on the RG
- Check that the image tag is valid and matches the deployment

---

## Adding More Branches or Tags

To extend OIDC to additional branches or tag patterns:

1. Create additional federated credentials:
   ```bash
   cat > fic-staging.json << 'EOF'
   {
     "name": "browselee-staging",
     "issuer": "https://token.actions.githubusercontent.com",
     "subject": "repo:vijaycinn/browselee:ref:refs/heads/staging",
     "audiences": ["api://AzureADTokenExchange"]
   }
   EOF
   
   az ad app federated-credential create --id "$APP_ID" --parameters @fic-staging.json
   ```

2. Optionally, update the workflows to trigger on those branches:
   ```yaml
   on:
     push:
       branches:
         - main
         - staging
   ```

---

## References

- [GitHub Actions: OIDC with Azure](https://learn.microsoft.com/en-us/azure/active-directory/workload-identities/workload-identity-federation-create-trust-github)
- [Azure Container Apps: Deploy from ACR](https://learn.microsoft.com/en-us/azure/container-apps/containers)
- [Docker multi-stage builds](https://docs.docker.com/build/building/multi-stage/)
