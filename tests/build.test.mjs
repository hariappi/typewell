import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createManifest, parseBuildTargets } from '../scripts/build-manifest.mjs';

const extension = new URL('../extension/', import.meta.url);
const source = JSON.parse(await readFile(new URL('manifest.json', extension), 'utf8'));

test('build targets preserve the Firefox default and support explicit browser packages', () => {
  assert.deepEqual(parseBuildTargets([]), ['firefox']);
  assert.deepEqual(parseBuildTargets(['--target', 'firefox']), ['firefox']);
  assert.deepEqual(parseBuildTargets(['--target', 'chromium']), ['chromium']);
  assert.deepEqual(parseBuildTargets(['--target=all']), ['firefox', 'chromium']);
  for (const args of [['--target'], ['--target', 'safari'], ['--unknown'], ['--target', 'all', '--unknown']]) {
    assert.throws(() => parseBuildTargets(args));
  }
});

test('Chromium manifest uses a service worker and retains the existing permission scope', () => {
  const manifest = createManifest(source, 'chromium');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '114');
  assert.deepEqual(manifest.background, { service_worker: 'background-worker.js' });
  assert.equal('browser_specific_settings' in manifest, false);
  assert.deepEqual(manifest.permissions, source.permissions);
  assert.deepEqual(manifest.host_permissions, source.host_permissions);
  assert.deepEqual(manifest.content_security_policy, source.content_security_policy);
  assert.equal(manifest.incognito, 'not_allowed');
  assert.equal(manifest.version, source.version);
  for (const script of manifest.content_scripts) {
    assert.equal(script.js[0], 'shared/compat.js');
    assert.equal(script.js.filter(file => file === 'shared/compat.js').length, 1);
  }
});

test('browser manifest generation leaves the Firefox source intact', () => {
  const before = structuredClone(source);
  createManifest(source, 'chromium');
  const firefox = createManifest(source, 'firefox');
  assert.deepEqual(source, before);
  assert.deepEqual(firefox, source);
  assert.notEqual(firefox, source);
  assert.notEqual(firefox.background, source.background);
  assert.throws(() => createManifest(source, 'safari'));
});

test('Chromium extension and toolbar icons are bundled PNGs at their declared sizes', async () => {
  const manifest = createManifest(source, 'chromium');
  assert.deepEqual(Object.keys(manifest.icons), ['16', '32', '48', '128']);
  assert.deepEqual(manifest.action.default_icon, manifest.icons);
  for (const [size, path] of Object.entries(manifest.icons)) {
    const bytes = await readFile(new URL(path, extension));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', path);
    assert.equal(bytes.readUInt32BE(16), Number(size), path);
    assert.equal(bytes.readUInt32BE(20), Number(size), path);
  }
});

test('Chromium manifest entry points exist in the packaged source', async () => {
  const manifest = createManifest(source, 'chromium');
  const files = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page,
    ...manifest.content_scripts.flatMap(script => script.js)];
  for (const file of files) assert.ok((await stat(new URL(file, extension))).isFile(), file);
});
