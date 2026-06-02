targetScope = 'subscription'

// ── Parameters ────────────────────────────────────────────────────────────────
@description('Deployment environment tag (dev / staging / prod).')
param env string = 'dev'

@description('Azure region for the new resource group and all resources.')
param location string = 'eastus2'

@description('Existing Foundry resource group (cross-RG role assignment target).')
param foundryRg string = 'rg-smec-poc-hf-models'

@description('Existing Azure AI Foundry account name.')
param foundryAccountName string = 'smec-poc-vcinn-resource'

@description('Foundry endpoint URL injected into the container as an env var.')
param foundryEndpoint string = 'https://smec-poc-vcinn-resource.services.ai.azure.com'

@description('Container image to deploy. Override in CI after the first push to ACR.')
param image string = 'mcr.microsoft.com/k8se/quickstart:latest'

// ── New Resource Group ─────────────────────────────────────────────────────────
var rgName = 'rg-browselee-${env}'

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: rgName
  location: location
}

// ── User-Assigned Managed Identity ────────────────────────────────────────────
module identity 'modules/identity.bicep' = {
  name: 'identity'
  scope: rg
  params: {
    env: env
    location: location
  }
}

// ── Container Apps + ACR + Log Analytics ──────────────────────────────────────
module aca 'modules/aca.bicep' = {
  name: 'aca'
  scope: rg
  params: {
    env: env
    location: location
    uamiId: identity.outputs.uamiId
    uamiClientId: identity.outputs.uamiClientId
    uamiPrincipalId: identity.outputs.uamiPrincipalId
    foundryEndpoint: foundryEndpoint
    image: image
  }
}

// ── Cross-RG Foundry Role Assignment ──────────────────────────────────────────
module foundryRole 'modules/foundry-role.bicep' = {
  name: 'foundry-role'
  scope: resourceGroup(foundryRg)
  params: {
    foundryAccountName: foundryAccountName
    uamiPrincipalId: identity.outputs.uamiPrincipalId
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
@description('Public HTTPS URL of the Container App.')
output apiUrl string = aca.outputs.apiUrl

@description('Client ID of the User-Assigned Managed Identity (use as AZURE_CLIENT_ID).')
output uamiClientId string = identity.outputs.uamiClientId

@description('Principal (object) ID of the UAMI — needed for RBAC audits.')
output uamiPrincipalId string = identity.outputs.uamiPrincipalId

@description('ACR login server — use in GitHub Actions docker/login-action.')
output acrLoginServer string = aca.outputs.acrLoginServer

@description('Container App resource name.')
output acaName string = aca.outputs.acaName

@description('Resource group that owns the Container App.')
output acaRg string = rgName
