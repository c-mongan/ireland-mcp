param environmentName string
param location string
param tags object
@secure()
param ntaApiKey string
param maximumInstanceCount int

@allowed([512, 2048, 4096])
param instanceMemoryMB int = 2048

var token = toLower(uniqueString(subscription().id, resourceGroup().id, environmentName))
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

var baseSettings = [
  { name: 'AzureWebJobsStorage__accountName', value: storage.name }
  { name: 'AzureWebJobsStorage__credential', value: 'managedidentity' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
  { name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING', value: 'Authorization=AAD' }
  { name: 'CACHE_TABLE_NAME', value: cacheTable.name }
  { name: 'PPR_CONTAINER', value: pprContainer.name }
  { name: 'RATE_LIMIT_PER_MINUTE', value: '60' }
]
var ntaSettings = hasNtaKey ? [{ name: 'NTA_API_KEY', value: '@Microsoft.KeyVault(SecretUri=${ntaSecret!.properties.secretUri})' }] : []

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  tags: union(tags, { 'azd-service-name': 'api' })
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
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
      // The platform answers CORS preflights itself, so the app's own OPTIONS handler never runs.
      cors: {
        allowedOrigins: ['*']
      }
      appSettings: concat(baseSettings, ntaSettings)
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

output appName string = app.name
output endpoint string = 'https://${app.properties.defaultHostName}/mcp'
