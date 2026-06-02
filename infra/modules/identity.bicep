// ── User-Assigned Managed Identity ────────────────────────────────────────────
// Deployed at RG scope via main.bicep module block.

param env string
param location string

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'browselee-${env}-uami'
  location: location
}

output uamiId string = uami.id
output uamiClientId string = uami.properties.clientId
output uamiPrincipalId string = uami.properties.principalId
