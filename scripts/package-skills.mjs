#!/usr/bin/env node
// Zips each skills/<name>/ folder into dist/skills/<name>.zip for claude.ai upload.
// The shared citations file is bundled as <name>/_shared/citations.md and links are rewritten to match.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");
const sharedDir = join(skillsDir, "_shared");
const outDir = join(root, "dist", "skills");

function walk(dir) {
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

// Fixed timestamp (1980-01-01) keeps the zips reproducible.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const toZipPath = (path) => path.split(sep).join("/");

const skills = readdirSync(skillsDir)
  .filter((name) => !name.startsWith("_") && !name.startsWith("."))
  .filter((name) => statSync(join(skillsDir, name)).isDirectory())
  .sort();

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const name of skills) {
  const dir = join(skillsDir, name);
  const entries = walk(dir).map((file) => {
    let data = readFileSync(file);
    if (file.endsWith(".md")) {
      const depth = relative(dir, dirname(file)).split(sep).filter(Boolean).length;
      const prefix = depth === 0 ? "" : "../".repeat(depth);
      data = Buffer.from(data.toString("utf8").replaceAll(`${"../".repeat(depth + 1)}_shared/`, `${prefix}_shared/`), "utf8");
    }
    return { name: `${name}/${toZipPath(relative(dir, file))}`, data };
  });
  for (const file of walk(sharedDir)) {
    entries.push({ name: `${name}/_shared/${toZipPath(relative(sharedDir, file))}`, data: readFileSync(file) });
  }
  const out = join(outDir, `${name}.zip`);
  writeFileSync(out, zip(entries));
  console.log(`${relative(root, out)} (${entries.length} files)`);
}
console.log(`Packaged ${skills.length} skills.`);
