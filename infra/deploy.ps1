#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Deploy Browselee infra to Azure via a subscription-scoped Bicep deployment.
.DESCRIPTION
  1. Sets the active subscription.
  2. Runs az deployment sub create (validate-only flag available via $ValidateOnly).
  3. Saves outputs to .deployment-outputs.json for use by CI.
#>

param(
    [string]$Env           = 'dev',
    [string]$SubscriptionId = '941e8603-33bc-46b1-bbae-1a35a75a8efc',
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = $PSScriptRoot

# ── 1. Set active subscription ────────────────────────────────────────────────
Write-Host "`n[1/3] Setting subscription $SubscriptionId ..." -ForegroundColor Cyan
az account set --subscription $SubscriptionId

# ── 2. Deploy ─────────────────────────────────────────────────────────────────
$deploymentName = "browselee-$(Get-Date -Format yyyyMMddHHmmss)"
$templateFile   = Join-Path $scriptDir 'main.bicep'
$paramsFile     = Join-Path $scriptDir 'main.bicepparam'

if ($ValidateOnly) {
    Write-Host "`n[2/3] Validating template (--what-if) ..." -ForegroundColor Cyan
    az deployment sub what-if `
        --location eastus2 `
        --template-file $templateFile `
        --parameters $paramsFile `
        --name $deploymentName
    Write-Host "`n✅ Validation complete — no resources were created." -ForegroundColor Green
    exit 0
}

Write-Host "`n[2/3] Deploying '$deploymentName' ..." -ForegroundColor Cyan
$result = az deployment sub create `
    --location eastus2 `
    --template-file $templateFile `
    --parameters $paramsFile `
    --name $deploymentName `
    --output json 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Error "Deployment failed:`n$result"
    exit $LASTEXITCODE
}

# ── 3. Save outputs ───────────────────────────────────────────────────────────
$outputsFile = Join-Path $scriptDir '.deployment-outputs.json'
$result | Out-File -FilePath $outputsFile -Encoding utf8
Write-Host "`n[3/3] Outputs saved → $outputsFile" -ForegroundColor Cyan

# Parse key outputs for CI hints
$json          = $result | ConvertFrom-Json
$outputs       = $json.properties.outputs
$acrLoginServer = $outputs.acrLoginServer.value
$uamiClientId   = $outputs.uamiClientId.value
$acaName        = $outputs.acaName.value
$apiUrl         = $outputs.apiUrl.value

Write-Host @"

╔══════════════════════════════════════════════════════════════════╗
║  ✅  Browselee infra deployed successfully                       ║
╠══════════════════════════════════════════════════════════════════╣
║  API URL         : $apiUrl
║  ACR Login Server: $acrLoginServer
║  UAMI Client ID  : $uamiClientId
║  Container App   : $acaName
╠══════════════════════════════════════════════════════════════════╣
║  NEXT STEPS for CI (GitHub Actions / ci-actions)                ║
║  ─────────────────────────────────────────────────────────────  ║
║  1. Add repo secrets:                                            ║
║       AZURE_CLIENT_ID   = $uamiClientId
║       ACR_LOGIN_SERVER  = $acrLoginServer
║       AZURE_TENANT_ID   = d7db3890-34ce-4a8a-9e57-84c5fa26c110 ║
║       AZURE_SUBSCRIPTION_ID = 941e8603-33bc-46b1-bbae-1a35a75a8efc ║
║  2. In your docker/build-push-action, set:                      ║
║       registry: $acrLoginServer
║       tags: $acrLoginServer/browselee-backend:<sha>
║  3. Re-deploy with:                                             ║
║       .\deploy.ps1 -Env dev                                     ║
║     after overriding the image param.                           ║
╚══════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Green
