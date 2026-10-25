import { inflateRawSync } from "node:zlib";
import { ToolError } from "../../gateway/errors.js";

const MAX_EXPANDED_BYTES = 32 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 1000;
const invalid = (): never => {
  throw new ToolError("UPSTREAM_DOWN", "The council XLSX archive is malformed or exceeds its expansion limit.", { retryable: false });
};

/** Validate the ZIP directory and bounded actual expansion before SheetJS allocates workbook structures. */
export function assertBoundedXlsxZip(input: Uint8Array): void {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let end = -1;
  // ZIP's end record has at most a 65535-byte comment. Multi-disk and ZIP64 files are not required here.
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) {
      end = i;
      break;
    }
  }
  if (end < 0) invalid();
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryStart = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0
    || bytes.readUInt16LE(end + 8) !== count || count < 1 || count > MAX_ENTRIES
    || directoryStart + directorySize !== end) invalid();

  let cursor = directoryStart;
  let expandedTotal = 0;
  for (let entry = 0; entry < count; entry++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) invalid();
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const expanded = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42);
    expandedTotal += expanded;
    if (flags & 1 || (method !== 0 && method !== 8) || expanded > MAX_ENTRY_BYTES
      || expandedTotal > MAX_EXPANDED_BYTES || bytes.readUInt16LE(cursor + 34) !== 0
      || cursor + 46 + nameLength + extraLength + commentLength > end
      || local + 30 > directoryStart || bytes.readUInt32LE(local) !== 0x04034b50) invalid();
    if (bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) invalid();
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (dataStart + compressed > directoryStart) invalid();
    const data = bytes.subarray(dataStart, dataStart + compressed);
    try {
      // Check actual expansion too: a forged small directory size must not bypass the limit.
      const output = method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.max(1, expanded) });
      if (output.length !== expanded) invalid();
    } catch { invalid(); }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) invalid();
}
