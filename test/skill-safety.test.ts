import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("treats shell syntax in generated-file paths as literal filenames", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ireland-skill-safety-"));
  try {
    execFileSync("git", ["init", "--quiet", directory]);
    writeFileSync(join(directory, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(directory, "ignored.txt"), "test");
    const moduleUrl = pathToFileURL(resolve(".agents/skills/impeccable/scripts/lib/is-generated.mjs")).href;
    const { isGeneratedFile } = await import(moduleUrl);
    expect(isGeneratedFile("ignored.txt", { cwd: directory })).toBe(true);
    expect(isGeneratedFile("$(touch injected).txt", { cwd: directory })).toBe(false);
    expect(existsSync(join(directory, "injected"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
