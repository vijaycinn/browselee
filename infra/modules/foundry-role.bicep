// ── Cross-RG Foundry Role Assignment ──────────────────────────────────────────
// Deployed at the EXISTING foundry RG scope (rg-smec-poc-hf-models).
// Grants the UAMI "Cognitive Services OpenAI User" on the Foundry account.
// The Foundry account itself is NOT created here.

param foundryAccountName string
param uamiPrincipalId string

// Reference the existing Foundry account (CognitiveServices/accounts covers AI Foundry).
resource foundryAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' existing = {
  name: foundryAccountName
}

// Cognitive Services OpenAI User — well-known built-in role GUID.
var cognitiveServicesOpenAIUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, uamiPrincipalId, cognitiveServicesOpenAIUserRoleId)
  scope: foundryAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesOpenAIUserRoleId)
    principalId: uamiPrincipalId
    principalType: 'ServicePrincipal'
  }
}
