param environmentName string
param location string
param tags object
@secure()
param ntaApiKey string
param maximumInstanceCount int

@allowed([512, 2048, 4096])
param instanceMemoryMB int = 2048

@description('Comma-separated Origin allowlist for /mcp. Empty uses the built-in default list (see PRIVACY.md and README).')
param mcpAllowedOrigins string = ''

@minLength(3)
@maxLength(21)
param resourceNameSuffix string = toLower(uniqueString(subscription().id, resourceGroup().id, environmentName))
param canonicalSiteUrl string = ''
@secure()
param additionalAppSettings object = {}

func normalizeOrigin(origin string) string => toLower(reduce(range(0, length(trim(origin))), trim(origin), (value, _) => endsWith(value, '/') ? substring(value, 0, max(0, length(value) - 1)) : value))

// Keep in sync with src/gateway/origin.ts; the regression test checks this contract.
var defaultAllowedOrigins = [
  'https://claude.ai'
  'https://chatgpt.com'
  'vscode-webview://*'
  'http://localhost'
  'http://localhost:*'
  'http://127.0.0.1'
  'http://127.0.0.1:*'
  'https://lemon-meadow-03b2b8903.3.azurestaticapps.net'
  'https://irishopendata.ie'
  'https://www.irishopendata.ie'
  'https://irishopendata.com'
  'https://www.irishopendata.com'
]
var effectiveOriginSetting = !empty(mcpAllowedOrigins) ? mcpAllowedOrigins : contains(additionalAppSettings, 'MCP_ALLOWED_ORIGINS') ? string(additionalAppSettings.MCP_ALLOWED_ORIGINS) : ''
var rawOrigins = trim(effectiveOriginSetting)
var extendOrigins = startsWith(rawOrigins, '+')
var configuredOrigins = map(split(extendOrigins ? substring(rawOrigins, 1) : rawOrigins, ','), entry => normalizeOrigin(entry))
var effectiveOrigins = empty(rawOrigins) ? defaultAllowedOrigins : extendOrigins ? concat(defaultAllowedOrigins, configuredOrigins) : configuredOrigins
var concreteBrowserOrigins = filter(effectiveOrigins, entry => !empty(entry) && !contains(entry, '*'))
var platformOrigins = contains(effectiveOrigins, '*') ? ['*'] : union(concreteBrowserOrigins, [])

@description('Create an App Insights standard availability test against /healthz.')
param enableAvailabilityTest bool = true

@description('Optional URL for the existing health-test identity. Empty uses the Function default hostname.')
param healthCheckUrl string = ''

var token = resourceNameSuffix
var appName = 'func-ireland-mcp-${token}'
var deploymentContainer = 'app-package-${take(token, 10)}'
var hasNtaKey = !empty(ntaApiKey)

// Built-in role definition IDs.
var roles = {
  blobOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  tableContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
  queueContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  kvSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  metricsPublisher: '3913510d-42f4-4e42-8a64-420c390055eb'
}

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${token}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: 1 }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${token}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableLocalAuth: true
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'st${take(token, 22)}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource packageContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: deploymentContainer
  properties: { publicAccess: 'None' }
}

resource pprContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobs
  name: 'ppr'
  properties: { publicAccess: 'None' }
}

resource tables 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource cacheTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tables
  name: 'mcpcache'
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = if (hasNtaKey) {
  name: 'kv-${take(token, 21)}'
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
  }
}

resource ntaSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (hasNtaKey) {
  parent: vault
  name: 'nta-api-key'
  properties: { value: ntaApiKey }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-${token}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

var baseSettings = {
  AzureWebJobsStorage__accountName: storage.name
  AzureWebJobsStorage__credential: 'managedidentity'
  APPLICATIONINSIGHTS_CONNECTION_STRING: insights.properties.ConnectionString
  APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'Authorization=AAD'
  CACHE_TABLE_NAME: cacheTable.name
  PPR_CONTAINER: pprContainer.name
  RATE_LIMIT_PER_MINUTE: '60'
  OTEL_SERVICE_NAME: 'ireland-mcp'
}
var originSettings = empty(mcpAllowedOrigins) ? {} : { MCP_ALLOWED_ORIGINS: mcpAllowedOrigins }
var canonicalSettings = empty(canonicalSiteUrl) ? {} : { CANONICAL_SITE_URL: canonicalSiteUrl }
var ntaSettings = hasNtaKey ? { NTA_API_KEY: '@Microsoft.KeyVault(SecretUri=${ntaSecret!.properties.secretUri})' } : {}
var appSettings = union(additionalAppSettings, baseSettings, originSettings, canonicalSettings, ntaSettings)

resource app 'Microsoft.Web/sites@2024-11-01' = {
  name: appName
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    // Creation-time opt-in (cannot be enabled later). The live app has it; see docs/domain-go-live.md.
    siteScopedCertificatesEnabled: true
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    functionAppConfig: {
      runtime: { name: 'node', version: '22' }
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainer}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: instanceMemoryMB
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      // Functions host handles OPTIONS before app code. Permit matching browser preflights;
      // application code still validates Origin on the actual request.
      cors: {
        allowedOrigins: platformOrigins
        supportCredentials: false
      }
      appSettings: map(items(appSettings), setting => {
        name: setting.key
        value: setting.value
      })
    }
  }
}

resource storageRoles 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for role in [roles.blobOwner, roles.tableContributor, roles.queueContributor]: {
  name: guid(storage.id, app.id, role)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}]

resource insightsRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(insights.id, app.id, roles.metricsPublisher)
  scope: insights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.metricsPublisher)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource vaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (hasNtaKey) {
  name: guid(vault.id, app.id, roles.kvSecretsUser)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.kvSecretsUser)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Standard availability test: GET /healthz every 15 minutes from three regions, expects 200 and "ok".
resource healthTest 'Microsoft.Insights/webtests@2022-06-15' = if (enableAvailabilityTest) {
  name: 'healthz-${token}'
  location: location
  tags: union(tags, { 'hidden-link:${insights.id}': 'Resource' })
  kind: 'standard'
  properties: {
    SyntheticMonitorId: 'healthz-${token}'
    Name: 'ireland-mcp /healthz'
    Kind: 'standard'
    Enabled: true
    Frequency: 900
    Timeout: 30
    RetryEnabled: true
    Locations: [
      { Id: 'emea-nl-ams-azr' }
      { Id: 'emea-gb-db3-azr' }
      { Id: 'emea-fr-pra-edge' }
    ]
    Request: {
      RequestUrl: empty(healthCheckUrl) ? 'https://${app.properties.defaultHostName}/healthz' : healthCheckUrl
      HttpVerb: 'GET'
      FollowRedirects: false
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
      ContentValidation: {
        ContentMatch: '"status":"ok"'
        IgnoreCase: true
        PassIfTextFound: true
      }
    }
  }
}

output appName string = app.name
output defaultHostName string = app.properties.defaultHostName
output customDomainVerificationId string = app.properties.customDomainVerificationId
output insightsName string = insights.name
output healthTestName string = enableAvailabilityTest ? healthTest!.name : ''
output endpoint string = 'https://${app.properties.defaultHostName}/mcp'
