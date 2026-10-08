@description('Production replay only. The two Function hostnames must already be verified before certificate issuance.')
param functionAppName string
param functionDefaultHost string
param functionVerificationId string
param location string = 'northeurope'
@minLength(1)
param staticWebAppValidationToken string

resource app 'Microsoft.Web/sites@2024-11-01' existing = {
  name: functionAppName
}

resource staticSite 'Microsoft.Web/staticSites@2024-11-01' = {
  name: 'swa-ireland-mcp'
  location: 'westeurope'
  sku: { name: 'Free', tier: 'Free' }
  properties: {
    repositoryUrl: 'https://github.com/c-mongan/ireland-mcp'
    branch: 'main'
    provider: 'GitHub'
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
    enterpriseGradeCdnStatus: 'Disabled'
  }
}

module comDns 'dns-zone.bicep' = {
  name: 'ireland-mcp-com-dns'
  params: {
    zoneName: 'irishopendata.com'
    staticWebAppName: staticSite.name
    functionDefaultHost: functionDefaultHost
    functionVerificationId: functionVerificationId
    staticWebAppValidationToken: staticWebAppValidationToken
  }
}

// Preserve the pre-existing pending zone and records only. No .ie custom domains, certificates or delegation.
module ieDns 'dns-zone.bicep' = {
  name: 'ireland-mcp-ie-dns'
  params: {
    zoneName: 'irishopendata.ie'
    staticWebAppName: staticSite.name
    functionDefaultHost: functionDefaultHost
    functionVerificationId: functionVerificationId
  }
}

resource apexBinding 'Microsoft.Web/staticSites/customDomains@2024-11-01' = {
  parent: staticSite
  name: 'irishopendata.com'
  properties: { validationMethod: 'dns-txt-token' }
  dependsOn: [comDns]
}

var hosts = [
  { hostname: 'mcp.irishopendata.com', certificateName: 'mcp-irishopendata-com' }
  { hostname: 'www.irishopendata.com', certificateName: 'www-irishopendata-com' }
]

// Issuance relies on already-verified hostnames. Do not replay a Disabled binding to break a dependency cycle.
@batchSize(1)
resource certificates 'Microsoft.Web/sites/certificates@2024-11-01' = [for host in hosts: {
  parent: app
  name: host.certificateName
  location: location
  properties: { canonicalName: host.hostname }
  dependsOn: [comDns]
}]

@batchSize(1)
resource bindings 'Microsoft.Web/sites/hostNameBindings@2024-11-01' = [for (host, i) in hosts: {
  parent: app
  name: host.hostname
  properties: {
    hostNameType: 'Verified'
    customHostNameDnsRecordType: 'CName'
    sslState: 'SniEnabled'
    thumbprint: certificates[i].properties.thumbprint
  }
  dependsOn: [certificates]
}]
