import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { assertBoundedXlsxZip } from "./xlsxZip.js";

// One-entry ZIP fixture with separately declared and actual expanded sizes.
function zip(content: Buffer, declared = content.length): Buffer {
  const compressed = deflateRawSync(content);
  const local = Buffer.alloc(31);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(1, 26);
  local[30] = 120;
  const central = Buffer.alloc(47);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(1, 28);
  central[46] = 120;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}

describe("bounded XLSX ZIP validation", () => {
  it("accepts the real official workbook before spreadsheet parsing", () => {
    const bytes = readFileSync(new URL("../council-budgets/fixtures/budget-2026.xlsx", import.meta.url));
    expect(() => assertBoundedXlsxZip(bytes)).not.toThrow();
  });
  it("rejects declared oversize entries and deceptive expansion sizes", () => {
    expect(() => assertBoundedXlsxZip(zip(Buffer.from("tiny"), 40 * 1024 * 1024))).toThrow();
    expect(() => assertBoundedXlsxZip(zip(Buffer.alloc(32_000, 65), 1))).toThrow();
    expect(() => assertBoundedXlsxZip(zip(Buffer.from("small valid content")))).not.toThrow();
  });
  it("rejects broken directories and entries pointing outside the archive", () => {
    expect(() => assertBoundedXlsxZip(Buffer.from("PK\u0003\u0004broken"))).toThrow();
    const bytes = zip(Buffer.from("test"));
    const start = bytes.readUInt32LE(bytes.length - 6);
    bytes.writeUInt32LE(0x7fffffff, start + 42);
    expect(() => assertBoundedXlsxZip(bytes)).toThrow();
  });
});
