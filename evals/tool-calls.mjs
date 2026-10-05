// promptfoo transform: reduce a transcript to the tools the model actually called.
// A call through ireland_call counts as calling its operation, so assertions work on the
// default (meta-tool) surface and on ?toolsets=all alike. Catalogue listings do not count.
const MARKER = /MCP Tool (?:Result|Error) \(([a-z0-9_]+)\):/g;

export default function toolCalls(output) {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  const markers = [...text.matchAll(MARKER)];
  if (markers.length === 0) return text;
  const called = [];
  markers.forEach((m, i) => {
    called.push(m[1]);
    if (m[1] !== "ireland_call") return;
    const body = text.slice(m.index + m[0].length, markers[i + 1]?.index ?? text.length);
    const op = /"operation"\s*:\s*"([a-z0-9_]+)"/.exec(body);
    if (op) called.push(op[1]);
  });
  return called.join(" ");
}
