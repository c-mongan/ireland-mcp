param location string
param tags object = {}
param insightsName string
@minLength(1)
@description('The service-owned existing health test. This module creates only site and initialize tests.')
param healthTestName string
param actionGroupIds array = []
param alertEmail string = ''

resource insights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: insightsName
}

resource emailGroup 'Microsoft.Insights/actionGroups@2023-01-01' = if (!empty(alertEmail)) {
  name: 'ag-ireland-mcp-availability'
  location: 'global'
  properties: {
    groupShortName: 'ireland-mcp'
    enabled: true
    emailReceivers: [
      { name: 'existing-budget-contact', emailAddress: alertEmail, useCommonAlertSchema: true }
    ]
  }
}

var tests = [
  {
    name: 'irishopendata-com-site'
    displayName: 'irishopendata.com docs'
    url: 'https://irishopendata.com'
    method: 'GET'
    content: 'Ireland MCP'
    headers: []
    body: ''
  }
  {
    name: 'irishopendata-com-initialize'
    displayName: 'mcp.irishopendata.com MCP initialize'
    url: 'https://mcp.irishopendata.com/mcp'
    method: 'POST'
    content: '"name":"ireland-mcp"'
    headers: [
      { key: 'Content-Type', value: 'application/json' }
      { key: 'Accept', value: 'application/json, text/event-stream' }
    ]
    body: base64('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"azure-availability","version":"1"}}}')
  }
]

resource webtests 'Microsoft.Insights/webtests@2022-06-15' = [for test in tests: {
  name: test.name
  location: location
  tags: union(tags, { 'hidden-link:${insights.id}': 'Resource' })
  kind: 'standard'
  properties: {
    SyntheticMonitorId: test.name
    Name: test.displayName
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
    Request: union({
      RequestUrl: test.url
      HttpVerb: test.method
      FollowRedirects: false
      ParseDependentRequests: false
      Headers: test.headers
    }, empty(test.body) ? {} : { RequestBody: test.body })
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
      ContentValidation: {
        ContentMatch: test.content
        IgnoreCase: true
        PassIfTextFound: true
      }
    }
  }
}]

var effectiveActionGroupIds = union(actionGroupIds, empty(alertEmail) ? [] : [emailGroup!.id])
var monitoredTests = concat(tests, [
  { name: healthTestName, displayName: 'mcp.irishopendata.com /healthz' }
])

resource alerts 'Microsoft.Insights/metricAlerts@2018-03-01' = [for test in monitoredTests: {
  name: '${test.name}-availability'
  location: 'global'
  tags: tags
  properties: {
    description: '${test.displayName}: fails from at least two of three locations, or TLS expires within seven days.'
    severity: 1
    enabled: true
    autoMitigate: true
    evaluationFrequency: 'PT1M'
    windowSize: 'PT15M'
    scopes: [resourceId('Microsoft.Insights/webtests', test.name), insights.id]
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: resourceId('Microsoft.Insights/webtests', test.name)
      componentId: insights.id
      failedLocationCount: 2
    }
    actions: [for id in effectiveActionGroupIds: { actionGroupId: id }]
  }
  dependsOn: [webtests]
}]
