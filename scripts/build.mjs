import { mkdir, readFile, copyFile, stat, cp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import '../extension/shared/catalog.js';
import { createManifest, parseBuildTargets } from './build-manifest.mjs';

const root = new URL('../', import.meta.url);
const extension = new URL('extension/', root);
const targets = parseBuildTargets(process.argv.slice(2));
const manifest = JSON.parse(await readFile(new URL('manifest.json', extension), 'utf8'));
for (const file of ['LICENSE', 'PRIVACY.md']) await copyFile(new URL(file, root), new URL(file, extension));
const sources = JSON.parse(await readFile(new URL('fonts/sources.json', extension), 'utf8'));
for (const font of globalThis.Typewell.fonts.filter(font => font.bundled)) {
  const bytes = await readFile(new URL(font.file, extension));
  if (bytes.subarray(0, 4).toString() !== 'wOF2') throw new Error(`Invalid WOFF2 file: ${font.name}`);
  if (createHash('sha256').update(bytes).digest('hex') !== sources[font.id]?.sha256) throw new Error(`Font checksum mismatch: ${font.name}`);
  const license = await readFile(new URL(`fonts/${sources[font.id].license}`, extension), 'utf8');
  if (license.length < 100) throw new Error(`Missing font license: ${font.name}`);
}
await mkdir(new URL('dist/', root), { recursive: true });
const name = `typewell-${manifest.version}`;
function buildArchive(source, filename) {
  execFileSync(process.execPath, [fileURLToPath(new URL('node_modules/web-ext/bin/web-ext.js', root)), 'build',
    '--source-dir', fileURLToPath(source), '--artifacts-dir', fileURLToPath(new URL('dist/', root)),
    '--filename', filename, '--overwrite-dest'], { stdio: 'inherit', env: { ...process.env, NO_UPDATE_NOTIFIER: '1' } });
}

for (const target of targets) {
  if (target === 'firefox') {
    buildArchive(extension, `${name}.zip`);
    await copyFile(new URL(`dist/${name}.zip`, root), new URL(`dist/${name}.xpi`, root));
    console.log(`Built dist/${name}.xpi (${((await stat(new URL(`dist/${name}.xpi`, root))).size / 1024 / 1024).toFixed(2)} MB).`);
    console.log('This is an unsigned development package. Permanent installation in release Firefox requires Mozilla signing.');
  } else {
    const unpacked = new URL('dist/chromium/', root);
    await rm(unpacked, { recursive: true, force: true });
    await cp(extension, unpacked, { recursive: true });
    await writeFile(new URL('manifest.json', unpacked), `${JSON.stringify(createManifest(manifest, target), null, 2)}\n`);
    buildArchive(unpacked, `${name}-chromium.zip`);
    console.log(`Built dist/${name}-chromium.zip and unpacked dist/chromium/ for Chrome, Brave, and other Chromium browsers.`);
  }
}
