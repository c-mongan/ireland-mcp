import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildCipsRecords, buildCisRecords, count, htmlText, pinnedUrls, type Downloads } from "./build.js";
import { docxBlocks, readZipEntry } from "./docx.js";
import { KNOWN_FAILED_CHECKS } from "./refresh.js";
import { categoryKey } from "./schema.js";

/** Minimal stored (uncompressed) ZIP writer for synthetic Word documents. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const p = (text: string) => `<w:p><w:pPr/><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const table = (rows: string[][]) => `<w:tbl><w:tblPr/>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr/>${p(c)}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
const docx = (...body: string[]) => zip({
  "[Content_Types].xml": "<Types/>",
  "word/document.xml": `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body.join("")}<w:sectPr/></w:body></w:document>`
});
const at = (bytes: Uint8Array) => ({ bytes, retrievedAt: "2026-10-26T12:00:00.000Z" });

describe("CIB DOCX reader", () => {
  it("reads paragraphs and table cells in order, decoding entities and splitting runs", () => {
    const blocks = docxBlocks(docx(
      `<w:p><w:r><w:t>Social </w:t></w:r><w:r><w:t>Welfare &amp; Housing</w:t></w:r></w:p>`,
      table([["Category", "Queries"], ["Birth, Family & Relationships", "13,653"]]),
      p("After")
    ));
    expect(blocks).toEqual([
      { kind: "p", text: "Social Welfare & Housing" },
      { kind: "table", rows: [["Category", "Queries"], ["Birth, Family & Relationships", "13,653"]] },
      { kind: "p", text: "After" }
    ]);
  });

  it("rejects archives that are not ZIP, miss the entry or fail the CRC", () => {
    expect(() => readZipEntry(Buffer.from("not a zip"), "word/document.xml")).toThrow(/Not a ZIP/);
    expect(() => readZipEntry(zip({ "other.xml": "<x/>" }), "word/document.xml")).toThrow(/not found/);
    const good = zip({ "word/document.xml": "<w:document/>" });
    const corrupt = Buffer.from(good);
    corrupt[30 + "word/document.xml".length] = "X".charCodeAt(0);
    expect(() => readZipEntry(corrupt, "word/document.xml")).toThrow(/CRC/);
    expect(() => readZipEntry(zip({ "word/document.xml": "<a/>", "x": "" }), "word/document.xml")).not.toThrow();
  });

  it("decodes HTML entities exactly once", () => {
    expect(htmlText(Buffer.from("<p>394,400 callers&nbsp;were assisted by the Citizen&#39;s &amp;nbsp; Services</p><script>x</script>"))).toBe(" 394,400 callers were assisted by the Citizen's &nbsp; Services ");
  });

  it("parses published counts strictly and normalises category labels", () => {
    expect([count("315,200"), count("1789"), count("1,78"), count("-"), count("")]).toEqual([315200, 1789, undefined, undefined, undefined]);
    expect(categoryKey("Birth, Family & Relationships")).toBe("birth-family-and-relationships");
    expect(categoryKey("Birth Family and Relationship")).toBe("birth-family-and-relationships");
    expect(categoryKey("Covid 19")).toBe("covid-19");
  });
});

describe("CIB snapshot build", () => {
  const D = "https://www.citizensinformationboard.ie/downloads/datahub";

  it("only pins official Citizens Information Board URLs", () => {
    const urls = pinnedUrls();
    expect(urls.length).toBeGreaterThan(20);
    expect(urls.every((u) => u.startsWith("https://www.citizensinformationboard.ie/"))).toBe(true);
  });

  it("builds CIPS records, identifies the calls-answered definition and flags sub-table mismatches", () => {
    const base = `${D}/cips-test`;
    const downloads: Downloads = new Map([
      [`${base}.docx`, at(docx(
        p("CIPS answered 111,472 calls during 2025. A further 1,792 interactions were by webchat."),
        table([["Mode of contact", "Number of callers", "% of callers"], ["Telephone", "111,472", "98.2%"], ["Webchats", "1,792", "1.6%"], ["Social Media Enquiries", "240", "0.2%"], ["Total", "113,504", "100%"]]),
        table([["Main Call Category", "No. of categorised calls", "% of all categorised calls"], ["Social Welfare", "300", "60.0%"], ["Housing", "200", "40.0%"], ["Total of categorised calls", "500", ""]]),
        table([["Call Sub-categories", "Number"], ["Carers", "300"], ["Total", "300"]]),
        table([["Call Sub-categories", "Number"], ["Renting", "199"], ["Total", "199"]])
      ))],
      [`${base}.pdf`, at(Buffer.from("%PDF"))]
    ]);
    const [record] = buildCipsRecords(downloads, { 2025: base });
    expect(record!.contacts).toEqual({ telephone: 111472, webchat: 1792, social_media: 240, total: 113504 });
    expect(record!.calls_answered_basis).toBe("telephone_only");
    expect(record!.calls_answered_published_text).toMatch(/^CIPS answered 111,472 calls/);
    expect(record!.categories.map((c) => [c.category_key, c.calls, c.share_pct_published])).toEqual([["social-welfare", 300, 60], ["housing", 200, 40]]);
    expect(record!.sources.map((s) => s.format)).toEqual(["docx", "pdf"]);
    expect(record!.sources[1]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    const failed = record!.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(["subcategory_table_total_matches:housing"]);
  });

  it("derives 2025-style callers from four quarterly reports and records every operand", () => {
    const cat = `${D}/qc-test`;
    const quarters = [1, 2, 3, 4].map((q) => `${D}/q${q}-test`);
    const downloads: Downloads = new Map([
      [`${cat}.docx`, at(docx(
        p("The services responded to 600 queries from the public in 2025. The ratio of queries per caller was 1.50 – that is, close to two."),
        table([["Top Level Category", "# Queries", "Prior Year", "% Change", "% Sub-Category"], ["Social Welfare", "400", "1", "+1%", "66.7%"], ["Local", "200", "1", "+1%", "33.3%"], ["Total", "600", "2", "", "100.0%"]])
      ))],
      [`${cat}.pdf`, at(Buffer.from("%PDF"))],
      ...quarters.flatMap((q, i) => [
        [`${q}.docx`, at(docx(p(`There were ${100 + i} callers to CISs nationally during Q${i + 1}.`)))] as const,
        [`${q}.pdf`, at(Buffer.from("%PDF"))] as const
      ])
    ]);
    const { annual, categories } = buildCisRecords(downloads, { 2025: { categories: cat, callers: { quarterly: quarters } } });
    expect(annual[0]!.callers).toBe(406);
    expect(annual[0]!.callers_basis).toBe("derived_sum_of_quarterly_reports");
    expect(annual[0]!.callers_derivation!.operands.map((o) => o.value)).toEqual([100, 101, 102, 103]);
    expect(annual[0]!.callers_derivation!.warning).toMatch(/not a published annual total/);
    expect(annual[0]!.sources).toHaveLength(10);
    expect(annual[0]!.checks.find((c) => c.name === "published_ratio_matches_computed")!.ok).toBe(false);
    expect(categories[0]!.categories.map((c) => c.share_pct_published)).toEqual([66.7, 33.3]);
    expect(categories[0]!.checks.every((c) => c.ok)).toBe(true);
  });

  it("fails loudly when a pinned report changes shape", () => {
    const base = `${D}/broken`;
    const downloads: Downloads = new Map([[`${base}.docx`, at(docx(p("No figures here.")))], [`${base}.pdf`, at(Buffer.from("%PDF"))]]);
    expect(() => buildCipsRecords(downloads, { 2025: base })).toThrow(/calls answered/);
  });

  it("documents exactly the publisher inconsistencies the refresh tolerates", () => {
    expect([...KNOWN_FAILED_CHECKS].every((k) => k.startsWith("2025 subcategory_table_total_matches:"))).toBe(true);
  });
});
