import { crc32, inflateRawSync } from "node:zlib";

/** Maintenance only: reads the text blocks of an official CIB Word report. Never used by an MCP request. */
export type DocxBlock = { kind: "p"; text: string } | { kind: "table"; rows: string[][] };

const MAX_XML_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_BYTES = 30 * 1024 * 1024;

/** Extracts one entry from a ZIP archive using the central directory. Supports stored and deflated entries only. */
export function readZipEntry(zip: Uint8Array, name: string): Buffer {
  if (zip.byteLength > MAX_ZIP_BYTES) throw new Error(`ZIP archive is larger than ${MAX_ZIP_BYTES} bytes.`);
  const buf = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP archive: no end-of-central-directory record.");
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let found: Buffer | undefined;
  for (let i = 0; i < entries; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt ZIP central directory.");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entryName = buf.toString("utf8", p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;
    if (entryName !== name) continue;
    if (found) throw new Error(`Duplicate ZIP entry ${name}.`);
    if (flags & 1) throw new Error("Encrypted ZIP entries are not supported.");
    if (size > MAX_XML_BYTES || compressed > MAX_ZIP_BYTES) throw new Error(`${name} is larger than ${MAX_XML_BYTES} bytes.`);
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error("Corrupt ZIP local header.");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + compressed > buf.length) throw new Error("Truncated ZIP entry.");
    const data = buf.subarray(start, start + compressed);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method ${method}.`);
    const out = method === 0 ? Buffer.from(data) : inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES });
    if (out.length !== size || crc32(out) !== crc) throw new Error(`ZIP entry ${name} failed its size or CRC check.`);
    found = out;
  }
  if (found) return found;
  throw new Error(`ZIP entry ${name} not found.`);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "'", lsquo: "'" };
/** Decodes XML/HTML character references in one pass, so "&amp;nbsp;" stays "&nbsp;". */
export const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e] ?? m);
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/** Returns body paragraphs and tables in document order. Nested tables are flattened into their outer cell. */
export function docxBlocks(docx: Uint8Array): DocxBlock[] {
  const xml = readZipEntry(docx, "word/document.xml").toString("utf8");
  const blocks: DocxBlock[] = [];
  let paragraph = "";
  let inText = false;
  let tableDepth = 0;
  let rows: string[][] = [];
  let row: string[] | undefined;
  let cell: string[] | undefined;
  const token = /<(\/?)w:(tbl|tr|tc|p|t|tab|br)(?=[\s/>])[^>]*?(\/?)>|<[^>]*>|[^<]+/g;
  for (const m of xml.matchAll(token)) {
    const [whole, close, tag, selfClose] = m;
    if (!tag) {
      if (inText && whole[0] !== "<") paragraph += decode(whole);
      continue;
    }
    if (tag === "t") { inText = !close && !selfClose; continue; }
    if (tag === "tab" || tag === "br") { paragraph += " "; continue; }
    if (tag === "p") {
      if (close || selfClose) {
        const text = tidy(paragraph);
        paragraph = "";
        if (cell) { if (text) cell.push(text); } else if (tableDepth === 0 && text) blocks.push({ kind: "p", text });
      } else paragraph = "";
      continue;
    }
    if (tag === "tbl") {
      if (!close) { tableDepth += 1; if (tableDepth === 1) rows = []; }
      else { tableDepth -= 1; if (tableDepth === 0) blocks.push({ kind: "table", rows }); }
      continue;
    }
    if (tableDepth !== 1) continue;
    if (tag === "tr") {
      if (!close) row = [];
      else if (row) { rows.push(row); row = undefined; }
    } else if (tag === "tc") {
      if (!close) cell = [];
      else if (cell && row) { row.push(tidy(cell.join(" "))); cell = undefined; }
    }
  }
  return blocks;
}

export const paragraphs = (blocks: DocxBlock[]) => blocks.flatMap((b) => (b.kind === "p" ? [b.text] : []));
export const tables = (blocks: DocxBlock[]) => blocks.flatMap((b) => (b.kind === "table" ? [b.rows] : []));
