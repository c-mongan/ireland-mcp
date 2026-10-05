targetScope = 'subscription'

@minLength(1)
@maxLength(40)
@description('azd environment name; used to name the resource group and resources.')
param environmentName string

@description('Azure region. North Europe keeps the service close to Irish users.')
param location string = 'northeurope'

@secure()
@description('Optional NTA GTFS-Realtime API key. Stored in Key Vault; never returned to MCP clients. Leave empty to disable the NTA tools.')
param ntaApiKey string = ''

@description('Email for the monthly budget alert. Leave empty to skip creating the budget.')
param budgetContactEmail string = ''

@description('Monthly budget in the billing currency.')
param monthlyBudget int = 20

@minValue(1)
@maxValue(1000)
@description('Hard cap on Flex Consumption scale-out; bounds cost under abuse.')
param maximumInstanceCount int = 10

@description('Comma-separated Origin allowlist for /mcp; empty keeps the app default.')
param mcpAllowedOrigins string = ''

@description('Budget start; must be the first day of a month.')
param budgetStartDate string = utcNow('yyyy-MM-01')

var tags = { 'azd-env-name': environmentName, service: 'ireland-mcp' }

resource group 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module service 'service.bicep' = {
  name: 'ireland-mcp-service'
  scope: group
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    ntaApiKey: ntaApiKey
    maximumInstanceCount: maximumInstanceCount
    mcpAllowedOrigins: mcpAllowedOrigins
  }
}

module budget 'budget.bicep' = if (!empty(budgetContactEmail)) {
  name: 'ireland-mcp-budget'
  scope: group
  params: {
    name: 'budget-${environmentName}'
    amount: monthlyBudget
    contactEmail: budgetContactEmail
    startDate: budgetStartDate
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = group.name
output SERVICE_API_NAME string = service.outputs.appName
output MCP_ENDPOINT string = service.outputs.endpoint
