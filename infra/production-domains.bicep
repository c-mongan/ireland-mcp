@description('Production replay only. The two Function hostnames must already be verified before certificate issuance.')
param functionAppName string
param functionDefaultHost string
param functionVerificationId string
param location string = 'northeurope'
@minLength(1)
param staticWebAppValidationToken string
@description('Existing SWA TXT validation token for the irishopendata.ie apex. Not a credential.')
@minLength(1)
param ieStaticWebAppValidationToken string

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

// Delegation itself is set at the registrar (Blacknight) and is never changed here.
module ieDns 'dns-zone.bicep' = {
  name: 'ireland-mcp-ie-dns'
  params: {
    zoneName: 'irishopendata.ie'
    staticWebAppName: staticSite.name
    functionDefaultHost: functionDefaultHost
    functionVerificationId: functionVerificationId
    staticWebAppValidationToken: ieStaticWebAppValidationToken
  }
}

resource apexBinding 'Microsoft.Web/staticSites/customDomains@2024-11-01' = {
  parent: staticSite
  name: 'irishopendata.com'
  properties: { validationMethod: 'dns-txt-token' }
  dependsOn: [comDns]
}

// SWA Free allows two custom domains: both apexes. Serialized after .com to avoid concurrent site writes.
resource ieApexBinding 'Microsoft.Web/staticSites/customDomains@2024-11-01' = {
  parent: staticSite
  name: 'irishopendata.ie'
  properties: { validationMethod: 'dns-txt-token' }
  dependsOn: [ieDns, apexBinding]
}

// Flex allows three site-scoped certificates; all three are used. www.irishopendata.ie is not bound.
var hosts = [
  { hostname: 'mcp.irishopendata.com', certificateName: 'mcp-irishopendata-com' }
  { hostname: 'www.irishopendata.com', certificateName: 'www-irishopendata-com' }
  { hostname: 'mcp.irishopendata.ie', certificateName: 'mcp-irishopendata-ie' }
]

// Issuance relies on already-verified hostnames. Do not replay a Disabled binding to break a dependency cycle.
@batchSize(1)
resource certificates 'Microsoft.Web/sites/certificates@2024-11-01' = [for host in hosts: {
  parent: app
  name: host.certificateName
  location: location
  properties: { canonicalName: host.hostname }
  dependsOn: [comDns, ieDns]
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
