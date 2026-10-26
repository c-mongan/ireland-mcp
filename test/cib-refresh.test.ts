import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM script without type declarations
import { docxBlocks, docxText, htmlText, parseCount, parsePercent, readZipEntry, textContainsFigure } from "../scripts/lib/docx.mjs";
// @ts-expect-error -- plain ESM script without type declarations
import { canonicalCategory, CIB_HOST, CIB_SOURCES, listFigures, verifyFigures } from "../scripts/lib/cib.mjs";

/** Minimal ZIP writer (stored or deflated entries) for synthetic .docx fixtures. */
function zip(entries: Record<string, string>, deflate = true): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const raw = Buffer.from(text, "utf8");
    const data = deflate ? deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc32(raw), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc32(raw), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(Object.keys(entries).length, 8); eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const row = (...cells: string[]) => `<w:tr>${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join("")}</w:tr>`;
const docx = (body: string, deflate = true) => zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": `<w:document><w:body>${body}</w:body></w:document>` }, deflate);

describe("CIB refresh helpers", () => {
  const body = p("There were 384,091 callers &amp; more.") + p("Table 1 – CIS Query Categories") +
    `<w:tbl>${row("Top Level Category", "# Queries", "% Sub-Category")}${row("Social Welfare", "315,200", "44.5%")}${row("Total", "708,862", "100.0%")}</w:tbl>`;

  it("reads deflated and stored ZIP entries and rejects non-ZIP input", () => {
    expect(readZipEntry(zip({ "a.txt": "hello" }), "a.txt").toString()).toBe("hello");
    expect(readZipEntry(zip({ "a.txt": "hello" }, false), "a.txt").toString()).toBe("hello");
    expect(() => readZipEntry(Buffer.from("not a zip at all, definitely not"), "a.txt")).toThrow("Not a ZIP");
    expect(() => readZipEntry(zip({ "a.txt": "x" }), "b.txt")).toThrow("not found");
  });

  it("extracts paragraphs and captioned tables from a docx in document order", () => {
    const blocks = docxBlocks(docx(body));
    expect(blocks[0]).toEqual({ type: "p", text: "There were 384,091 callers & more." });
    const table = blocks.find((b: { type: string }) => b.type === "table");
    expect(table.caption).toBe("Table 1 – CIS Query Categories");
    expect(table.rows[1]).toEqual(["Social Welfare", "315,200", "44.5%"]);
    expect(docxText(docx(body, false))).toContain("Total | 708,862 | 100.0%");
  });

  it("parses printed counts and percentages strictly", () => {
    expect(parseCount("394,400")).toBe(394400);
    expect(parseCount("1789")).toBe(1789);
    expect(parseCount("6,382\u00a0")).toBe(6382);
    expect(() => parseCount("39,44")).toThrow();
    expect(() => parseCount("1.5")).toThrow();
    expect(parsePercent("43.33%")).toBe(43.33);
    expect(parsePercent("")).toBeNull();
    expect(() => parsePercent("n/a")).toThrow();
  });

  it("matches a figure only as a whole printed number", () => {
    const text = htmlText("<p>Overview 394,400 callers</p><script>var x = 999;</script><p>over 788,900. Total 6,382.</p>");
    expect(text).not.toContain("999");
    expect(textContainsFigure(text, "394,400")).toBe(true);
    expect(textContainsFigure(text, "6,382")).toBe(true);
    expect(textContainsFigure(text, "94,400")).toBe(false);
    expect(textContainsFigure(text, "788,90")).toBe(false);
    expect(textContainsFigure(text, "788,902")).toBe(false);
  });

  it("maps only reviewed category labels", () => {
    expect(canonicalCategory("Birth, Family & Relationships")).toBe("Birth, Family and Relationships");
    expect(canonicalCategory("Covid 19")).toBe("Covid-19");
    expect(canonicalCategory("Money\u00a0and Tax")).toBe("Money and Tax");
    expect(() => canonicalCategory("Astrology")).toThrow("Unreviewed");
  });

  it("fails verification when a pinned figure is not in its cited file", () => {
    const loaded = new Map([["q", { url: "https://x/q.docx", text: "There were 708,862 queries" }]]);
    expect(verifyFigures({ "a.json": { years: [{ queries: { value: 708862, printed: "708,862", source: "q" } }] } }, loaded)).toBe(1);
    expect(listFigures({ "a.json": { years: [{ queries: { value: 708862, printed: "708,862", source: "q" } }] } })).toEqual([{ path: "a.years[0].queries", printed: "708,862", value: 708862, source: "q" }]);
    expect(() => verifyFigures({ "a.json": { years: [{ queries: { value: 708863, printed: "708,863", source: "q" } }] } }, loaded)).toThrow("not found");
    expect(() => verifyFigures({ "a.json": { years: [{ queries: { value: 1, printed: "708,862", source: "q" } }] } }, loaded)).toThrow("does not match");
    expect(() => verifyFigures({ "a.json": { years: [{ queries: { value: 1, printed: "1", source: "zz" } }] } }, loaded)).toThrow("unknown source");
  });

  it("lists only fixed https CIB URLs", () => {
    for (const source of CIB_SOURCES) {
      const url = new URL(source.url);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe(CIB_HOST);
    }
    expect(new Set(CIB_SOURCES.map((s: { id: string }) => s.id)).size).toBe(CIB_SOURCES.length);
  });
});
