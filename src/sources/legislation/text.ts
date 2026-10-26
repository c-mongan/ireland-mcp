const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Converts eISB act XML or listing HTML fragments into readable plain text. */
export function toText(fragment: string): string {
  return decodeEntities(stripTags(fragment))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Strips until stable so crafted input like "<<b>script>" cannot leave a tag behind, then drops stray brackets. */
function stripTags(fragment: string): string {
  let text = fragment;
  let before: string;
  do {
    before = text;
    text = text.replace(/<fn>[\s\S]*?<\/fn>/g, "");
  } while (text !== before);
  text = text
    .replace(/<odq\/>/g, "“")
    .replace(/<cdq\/>/g, "”")
    .replace(/<osq\/>/g, "‘")
    .replace(/<csq\/>/g, "’")
    .replace(/<(emdash|endash)\/>/g, (_m, t: string) => (t === "emdash" ? "—" : "–"))
    .replace(/<\/p>/g, "\n");
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, "");
  } while (text !== previous);
  return text.replace(/[<>]/g, "");
}

/** Decodes entities after tag stripping; out-of-range numeric entities are left as written. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/** Plain text from eISB HTML: source line breaks are layout, so whitespace collapses before block ends become new lines. */
export function htmlText(fragment: string): string {
  let html = fragment;
  let before: string;
  do {
    before = html;
    html = html.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "");
  } while (html !== before);
  return toText(
    html
      .replace(/\s+/g, " ")
      .replace(/<br\s*\/?>|<\/(?:tr|h[1-6]|div|li)>/gi, "$&\n")
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}
