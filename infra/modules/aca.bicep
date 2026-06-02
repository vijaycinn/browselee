// ── Container Apps Environment + ACR + Log Analytics ─────────────────────────
// Deployed at RG scope via main.bicep module block.

param env string
param location string

@description('Resource ID of the User-Assigned Managed Identity.')
param uamiId string

@description('Client ID of the UAMI — injected as AZURE_CLIENT_ID env var.')
param uamiClientId string

@description('Principal ID of the UAMI — used for AcrPull role assignment.')
param uamiPrincipalId string

@description('Foundry endpoint URL for the FOUNDRY_ENDPOINT env var.')
param foundryEndpoint string

@description('Container image. Defaults to a harmless quickstart placeholder.')
param image string = 'mcr.microsoft.com/k8se/quickstart:latest'

// ACR name: prefix (12) + uniqueString (13) = 25 chars — well within 5-50 limit.
var acrName = 'browseleeacr${uniqueString(resourceGroup().id)}'
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

// ── Log Analytics Workspace ───────────────────────────────────────────────────
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'browselee-${env}-logs'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ── Azure Container Registry ──────────────────────────────────────────────────
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    // anonymousPullEnabled defaults to false; property omitted to avoid BCP037 warning on older Bicep type definitions
  }
}

// AcrPull: UAMI → ACR
resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, uamiPrincipalId, acrPullRoleId)
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
    principalId: uamiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// ── Container Apps Environment ────────────────────────────────────────────────
resource cae 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: 'browselee-${env}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// ── Container App ─────────────────────────────────────────────────────────────
resource ca 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'browselee-${env}-api'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uamiId}': {}
    }
  }
  properties: {
    environmentId: cae.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: uamiId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'FOUNDRY_ENDPOINT',       value: foundryEndpoint }
            { name: 'FOUNDRY_REALTIME_MODEL',  value: 'gpt-realtime-mini' }
            { name: 'FOUNDRY_TEXT_MODEL',      value: 'gpt-4o-mini' }
            { name: 'AZURE_CLIENT_ID',         value: uamiClientId }
            { name: 'PORT',                    value: '8080' }
            { name: 'NODE_ENV',                value: 'production' }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
output acrLoginServer string = acr.properties.loginServer
output apiUrl string = 'https://${ca.properties.configuration.ingress.fqdn}'
output acaName string = ca.name
