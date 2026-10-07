// Deploy separately after DNS ownership validation. One SAN certificate covers all aliases.
param functionAppName string
param location string

@secure()
param pfxBlob string

@secure()
param pfxPassword string

resource app 'Microsoft.Web/sites@2024-11-01' existing = {
  name: functionAppName
}

resource certificate 'Microsoft.Web/sites/certificates@2024-11-01' = {
  parent: app
  name: 'domain-san'
  location: location
  properties: {
    pfxBlob: pfxBlob
    password: pfxPassword
  }
}

// Serialize updates to the same site to avoid concurrent hostname-binding conflicts.
@batchSize(1)
resource bindings 'Microsoft.Web/sites/hostNameBindings@2024-11-01' = [for hostname in [
  'mcp.irishopendata.ie'
  'www.irishopendata.ie'
  'irishopendata.com'
  'www.irishopendata.com'
]: {
  parent: app
  name: hostname
  properties: {
    hostNameType: 'Verified'
    customHostNameDnsRecordType: hostname == 'irishopendata.com' ? 'A' : 'CName'
    sslState: 'SniEnabled'
    thumbprint: certificate.properties.thumbprint
  }
}]
