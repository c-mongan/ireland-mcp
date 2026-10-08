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

@description('Optional stable resource suffix when adopting an existing environment. Empty uses the azd naming algorithm.')
param resourceNameSuffix string = ''

@description('Opt in to the existing irishopendata.com production domains. Never creates .ie bindings or changes delegation.')
param enableProductionDomains bool = false

@description('Existing SWA apex TXT validation token. Required for production domain replay; not a credential.')
param staticWebAppValidationToken string = ''

@description('Canonical site origin. Empty preserves the application default in generic environments.')
param canonicalSiteUrl string = enableProductionDomains ? 'https://irishopendata.com' : ''

@description('Existing action group resource IDs for availability alerts. No existing action group is modified.')
param availabilityActionGroupIds array = []

@description('Optional availability alert email, supplied from the existing budget contact at deployment time. Empty skips the email action group.')
param availabilityAlertEmail string = ''

@secure()
@description('Additional Function app settings to preserve when adopting an environment. Managed settings take precedence.')
param additionalAppSettings object = {}

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
    resourceNameSuffix: empty(resourceNameSuffix) ? toLower(uniqueString(subscription().id, group.id, environmentName)) : resourceNameSuffix
    canonicalSiteUrl: empty(canonicalSiteUrl) && enableProductionDomains ? 'https://irishopendata.com' : canonicalSiteUrl
    additionalAppSettings: additionalAppSettings
    healthCheckUrl: enableProductionDomains ? 'https://mcp.irishopendata.com/healthz' : ''
  }
}

module domains 'production-domains.bicep' = if (enableProductionDomains) {
  name: 'ireland-mcp-production-domains'
  scope: group
  params: {
    functionAppName: service.outputs.appName
    functionDefaultHost: service.outputs.defaultHostName
    functionVerificationId: service.outputs.customDomainVerificationId
    staticWebAppValidationToken: staticWebAppValidationToken
    location: location
  }
}

module availability 'availability.bicep' = if (enableProductionDomains) {
  name: 'ireland-mcp-production-availability'
  scope: group
  params: {
    location: location
    tags: tags
    insightsName: service.outputs.insightsName
    healthTestName: service.outputs.healthTestName
    actionGroupIds: availabilityActionGroupIds
    alertEmail: availabilityAlertEmail
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
