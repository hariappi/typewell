import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import '../extension/shared/catalog.js';

const directory = new URL('../extension/fonts/', import.meta.url);
await mkdir(directory, { recursive: true });
let previous = {};
try { previous = JSON.parse(await readFile(new URL('sources.json', directory), 'utf8')); } catch { /* First fetch. */ }
const sources = {};
const fonts = globalThis.Typewell.fonts.filter(font => font.bundled);
let next = 0;
async function fetchBytes(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) { if (attempt === 2) throw error; }
  }
}
async function readExisting(font, metadata) {
  if (!metadata?.sha256 || !metadata?.license) return null;
  try {
    const binary = await readFile(new URL(`${font.id}.woff2`, directory));
    const license = await readFile(new URL(metadata.license, directory));
    if (binary.subarray(0, 4).toString() !== 'wOF2') return null;
    if (createHash('sha256').update(binary).digest('hex') !== metadata.sha256) return null;
    if (license.length < 100) return null;
    return metadata;
  } catch {
    return null;
  }
}
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < fonts.length) {
    const font = fonts[next++];
    const old = previous[font.id];
    const existing = await readExisting(font, old);
    if (existing) {
      sources[font.id] = existing;
      console.log(`Kept ${font.name}`);
      continue;
    }
    const metadata = JSON.parse(await fetchBytes(`https://registry.npmjs.org/@fontsource%2F${font.id}/latest`));
    const version = metadata.version;
    const base = `https://cdn.jsdelivr.net/npm/@fontsource/${font.id}@${version}`;
    const source = `${base}/files/${font.id}-latin-400-normal.woff2`;
    const [binary, license] = await Promise.all([fetchBytes(source), fetchBytes(`${base}/LICENSE`)]);
    if (binary.subarray(0, 4).toString() !== 'wOF2') throw new Error(`Invalid font: ${font.id}`);
    await writeFile(new URL(`${font.id}.woff2`, directory), binary);
    await writeFile(new URL(`${font.id}.LICENSE.txt`, directory), license);
    sources[font.id] = { package: `@fontsource/${font.id}`, version, source,
      sha256: createHash('sha256').update(binary).digest('hex'), license: `${font.id}.LICENSE.txt`, subset: 'latin', weight: 400, style: 'normal' };
    console.log(`Bundled ${font.name}`);
  }
}));
const ordered = Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(new URL('sources.json', directory), JSON.stringify(ordered, null, 2) + '\n');
const styles = fonts.map(font => `@font-face { font-family: ${JSON.stringify(font.family)}; src: url("../${font.file}") format("woff2"); font-weight: 400; font-style: normal; font-display: swap; }`).join('\n');
await writeFile(new URL('../ui/fonts.css', directory), styles + '\n');
console.log(`Done: ${fonts.length} font families, with licenses and SHA-256 hashes.`);
