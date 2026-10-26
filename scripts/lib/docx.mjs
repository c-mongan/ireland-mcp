// Dependency-free readers for the published Word (.docx) and HTML statistics files.
// Used only by refresh scripts and tests; the MCP runtime reads the committed JSON snapshots.
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Largest uncompressed entry accepted, so a small deflate stream cannot expand without bound. */
export const MAX_ENTRY_BYTES = 20 * 1024 * 1024;

/** Reads one entry from a ZIP archive (stored or deflated) via its central directory. */
export function readZipEntry(buffer, name) {
  const bytes = Buffer.from(buffer);
  const minEocd = Math.max(0, bytes.length - 0xffff - 22);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive: end of central directory not found.");
  const entries = bytes.readUInt16LE(eocd + 10);
  let offset = bytes.readUInt32LE(eocd + 16);
  for (let n = 0; n < entries; n++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("Corrupt ZIP central directory.");
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const entryName = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (entryName === name) {
      if (bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Corrupt ZIP local header.");
      const start = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
      if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`ZIP entry ${name} is ${uncompressedSize} bytes uncompressed; the limit is ${MAX_ENTRY_BYTES}.`);
      const data = bytes.subarray(start, start + compressedSize);
      if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method ${method} for ${name}.`);
      const out = method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
      if (out.length !== uncompressedSize) throw new Error(`ZIP entry ${name} inflated to ${out.length} bytes, expected ${uncompressedSize}.`);
      return out;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`ZIP entry not found: ${name}`);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === "#") return String.fromCodePoint(code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

const runText = (xml) => decodeEntities([...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(""));
const paragraphs = (xml) => [...xml.matchAll(/<w:p[\s>][\s\S]*?<\/w:p>/g)].map((m) => runText(m[0]).trim());
const cellText = (xml) => paragraphs(xml).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

/**
 * Body blocks in document order: paragraphs and tables. Each table carries the last non-empty
 * paragraph before it as its caption. Nested tables are not used by the CIB files and are rejected.
 */
export function docxBlocks(buffer) {
  const xml = readZipEntry(buffer, "word/document.xml").toString("utf8");
  const body = xml.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1];
  if (!body) throw new Error("DOCX has no document body.");
  const blocks = [];
  let caption = "";
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[\s>][\s\S]*?<\/w:p>/g)) {
    const chunk = m[0];
    if (chunk.startsWith("<w:tbl>")) {
      if (chunk.slice(7).includes("<w:tbl>")) throw new Error("Nested DOCX tables are not supported.");
      const rows = [...chunk.matchAll(/<w:tr[\s>][\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => cellText(c[0])));
      blocks.push({ type: "table", caption, rows });
    } else {
      const text = runText(chunk).trim();
      if (text) { blocks.push({ type: "p", text }); caption = text; }
    }
  }
  return blocks;
}

/** Plain text of every paragraph and table cell, for figure verification. */
export function docxText(buffer) {
  return docxBlocks(buffer).map((b) => (b.type === "p" ? b.text : b.rows.map((r) => r.join(" | ")).join("\n"))).join("\n");
}

/** Visible text of an HTML page with scripts, styles and tags removed. */
export function htmlText(html) {
  const stripped = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, " ").replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

/** Parses a printed integer such as "394,400", "1789" or "6,382 " into a number. */
export function parseCount(text) {
  const cleaned = String(text).replace(/[\s\u00a0]/g, "");
  if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(cleaned)) throw new Error(`Not a printed count: ${JSON.stringify(text)}`);
  return Number(cleaned.replaceAll(",", ""));
}

/** Parses a printed percentage such as "43.33%", "36.4" or "24%" into a number, or null when blank. */
export function parsePercent(text) {
  const cleaned = String(text).replace(/[\s\u00a0%]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) throw new Error(`Not a printed percentage: ${JSON.stringify(text)}`);
  return Number(cleaned);
}

/** True when the exact printed figure occurs in the source text as a whole number token. */
export function textContainsFigure(text, printed) {
  const escaped = printed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9,.])${escaped}($|[^0-9.,]|[.,](?![0-9]))`).test(text.replace(/\u00a0/g, " "));
}
