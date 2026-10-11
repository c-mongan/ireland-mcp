import { StringDecoder } from 'node:string_decoder';
import { once } from 'node:events';
import { handleRpc } from './protocol.mjs';

export async function runStdio(service, input, output, { maxBytes = 32 * 1024 } = {}) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let discarding = false;
  const write = async result => {
    if (result && !output.write(JSON.stringify(result) + '\n')) await once(output, 'drain');
  };
  const processLine = async line => {
    if (!line.trim()) return;
    if (Buffer.byteLength(line) > maxBytes) return write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too large.' } });
    let request;
    try { request = JSON.parse(line); } catch { return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }); }
    await write(await handleRpc(service, request));
  };
  for await (const chunk of input) {
    buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!discarding) await processLine(line);
      discarding = false;
    }
    if (Buffer.byteLength(buffer) > maxBytes) {
      if (!discarding) await write({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message too large.' } });
      buffer = '';
      discarding = true;
    }
  }
  buffer += decoder.end();
  if (!discarding) await processLine(buffer);
}
