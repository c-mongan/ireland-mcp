import { readdir } from 'node:fs/promises';
for (const file of await readdir(new URL('../src/', import.meta.url))) {
  if (file.endsWith('.mjs')) await import(new URL(`../src/${file}`, import.meta.url));
}
console.log('All core modules load successfully.');
