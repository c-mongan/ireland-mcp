const VERSIONS = ['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
const errorResponse = (id, code, message) => ({ jsonrpc: '2.0', id: typeof id === 'string' || typeof id === 'number' ? id : null, error: { code, message } });
export async function handleRpc(service, request) {
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' ||
      ('id' in request && typeof request.id !== 'string' && typeof request.id !== 'number' && request.id !== null))
    return errorResponse(request?.id, -32600, 'Invalid JSON-RPC request.');
  if (!('id' in request)) return null;
  const params = request.params ?? {};
  if (!params || typeof params !== 'object' || Array.isArray(params)) return errorResponse(request.id, -32602, 'Invalid params.');
  const result = value => ({ jsonrpc: '2.0', id: request.id, result: value });
  try {
    if (request.method === 'initialize') return result({ protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
      capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false } },
      serverInfo: { name: 'irish-legal-mcp', version: '0.1.0' },
      instructions: 'Read-only Irish evidence tools. Preserve source dates, versions, warnings and attribution. Guidance is explanatory. Indexed text does not certify current law; missing results do not establish absence of law.' });
    if (request.method === 'ping') return result({});
    if (request.method === 'tools/list') return result({ tools: service.tools });
    if (request.method === 'tools/call') {
      if (typeof params.name !== 'string') return errorResponse(request.id, -32602, 'Tool name is required.');
      const value = await service.call(params.name, params.arguments ?? {});
      return result({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    }
    if (request.method === 'resources/list') return result({ resources: [
      { uri: 'ireland-legal://sources', name: 'Irish legal source catalogue', mimeType: 'application/json' },
      { uri: 'ireland-legal://coverage', name: 'Indexed coverage and refresh status', mimeType: 'application/json' }
    ] });
    if (request.method === 'resources/templates/list') return result({ resourceTemplates: [] });
    if (request.method === 'resources/read') {
      const catalogue = await service.call('irish_legal_catalogue', {});
      const content = params.uri === 'ireland-legal://sources' ? catalogue : params.uri === 'ireland-legal://coverage' ? catalogue.coverage : undefined;
      if (!content) return errorResponse(request.id, -32602, 'Unknown resource URI.');
      return result({ contents: [{ uri: params.uri, mimeType: 'application/json', text: JSON.stringify(content) }] });
    }
    return errorResponse(request.id, -32601, 'Method not found.');
  } catch (error) {
    if (/^BAD_ARGS:|^UNKNOWN_TOOL:/.test(error.message)) return errorResponse(request.id, -32602, error.message);
    if (/^NOT_FOUND:|^HISTORICAL_UNAVAILABLE:/.test(error.message)) return result({ isError: true, content: [{ type: 'text', text: error.message }] });
    return errorResponse(request.id, -32603, 'Evidence service is temporarily unavailable.');
  }
}
