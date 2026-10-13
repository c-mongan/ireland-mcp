import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';

/** Pass only process essentials, never caller authentication or executable injection settings. */
export function codexEnvironment(env = process.env) {
  return Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG'].filter(key => env[key]).map(key => [key, env[key]]));
}
export function isOutsideRepository(root, candidate, paths = path) {
  const rel = paths.relative(root, candidate);
  return rel === '..' || rel.startsWith(`..${paths.sep}`) || paths.isAbsolute(rel);
}

/** Independently inspect ignored files too. Git's status is not a repair boundary. */
export function protectedDigest(root, allowedPaths, generatedDirectories = []) {
  root = realpathSync(root);
  const allowed = new Set(allowedPaths);
  const digest = createHash('sha256');
  function visit(relative) {
    if (generatedDirectories.includes(relative)) return;
    const absolute = path.join(root, relative);
    const metadata = lstatSync(absolute);
    if (metadata.isSymbolicLink()) {
      // Internal dependency links are covered by the same traversal. External links
      // could hide writes to an unobserved target, so fail before invoking repair.
      if (allowed.has(relative) || isOutsideRepository(root, realpathSync(absolute))) throw new Error(`Unsupported repair symlink: ${relative}`);
      digest.update(JSON.stringify([relative, metadata.mode, readlinkSync(absolute)]));
    } else if (metadata.isDirectory()) {
      digest.update(JSON.stringify([relative, metadata.mode, 'directory']));
      for (const name of readdirSync(absolute).sort()) visit(relative ? `${relative}/${name}` : name);
    } else if (metadata.isFile()) {
      if (allowed.has(relative)) return;
      const content = readFileSync(absolute);
      digest.update(JSON.stringify([relative, metadata.mode, content.length]));
      digest.update(content);
    } else throw new Error(`Unsupported repair file: ${relative}`);
  }
  for (const name of readdirSync(root).sort()) {
    if (name === '.git') {
      // Git mutates its index during ordinary inspection. Protect executable hooks
      // and config independently; commit/ref identity is checked by the runner.
      const gitDir = path.join(root, name);
      if (!lstatSync(gitDir).isDirectory()) throw new Error('Repair requires a standalone checkout.');
      for (const entry of ['config', 'hooks']) if (readdirSync(gitDir).includes(entry)) visit(`.git/${entry}`);
    } else visit(name);
  }
  return digest.digest('hex');
}
