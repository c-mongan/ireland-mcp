// Public Azure DNS zone for irishopendata.ie or irishopendata.com (set zoneName). Deploy separately into the app's resource group:
//   az deployment group create -g <rg> --template-file infra/dns-zone.bicep \
//     --parameters staticWebAppName=<swa> functionDefaultHost=<app>.azurewebsites.net functionVerificationId=<id>
// The registrar must delegate the domain to the zone's name servers. See docs/domain-go-live.md.
param zoneName string = 'irishopendata.ie'
param staticWebAppName string
param functionDefaultHost string
@description('Function App properties.customDomainVerificationId (read with az resource show; az functionapp show returns null on Flex).')
param functionVerificationId string
param functionHosts array = ['mcp', 'www']

resource swa 'Microsoft.Web/staticSites@2023-01-01' existing = {
  name: staticWebAppName
}

resource zone 'Microsoft.Network/dnsZones@2018-05-01' = {
  name: zoneName
  location: 'global'
  tags: { project: 'ireland-mcp', purpose: 'custom-domain' }
}

// Apex ALIAS to the Static Web App, as created by the portal's "Custom domain on Azure DNS" flow.
resource apex 'Microsoft.Network/dnsZones/A@2018-05-01' = {
  parent: zone
  name: '@'
  properties: {
    TTL: 3600
    targetResource: { id: swa.id }
  }
}

resource functionCnames 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = [for host in functionHosts: {
  parent: zone
  name: host
  properties: {
    TTL: 3600
    CNAMERecord: { cname: functionDefaultHost }
  }
}]

resource functionOwnership 'Microsoft.Network/dnsZones/TXT@2018-05-01' = [for host in functionHosts: {
  parent: zone
  name: 'asuid.${host}'
  properties: {
    TTL: 3600
    TXTRecords: [{ value: [functionVerificationId] }]
  }
}]

output nameServers array = zone.properties.nameServers
