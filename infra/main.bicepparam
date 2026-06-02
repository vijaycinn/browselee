using 'main.bicep'

param env = 'dev'
param location = 'eastus2'
param foundryRg = 'rg-smec-poc-hf-models'
param foundryAccountName = 'smec-poc-vcinn-resource'
param foundryEndpoint = 'https://smec-poc-vcinn-resource.services.ai.azure.com'
// image intentionally omitted — falls back to the placeholder default in main.bicep.
// Override in CI: --parameters image=<acr>.azurecr.io/browselee-backend:<tag>
