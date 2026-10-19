import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ADDON_ID, loadReleaseInfo, validateReleaseVersions, writeReleaseInfo } from '../scripts/release-info.mjs';
import { collectSourceFiles, isPackagedSourcePath } from '../scripts/package-amo.mjs';

const version = '1.2.3';
const validRelease = { tag: `v${version}`, packageVersion: version, lockVersion: version, lockPackageVersion: version, manifestVersion: version, addonId: ADDON_ID };

async function write(root, path, contents = 'source') {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents);
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'typewell-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, 'package.json', JSON.stringify({ version }));
  await write(root, 'package-lock.json', JSON.stringify({ version, packages: { '': { version } } }));
  await write(root, 'extension/manifest.json', JSON.stringify({ version, browser_specific_settings: { gecko: { id: ADDON_ID } } }));
  await write(root, `store/release-notes-${version}.md`, '\n# Release notes\n\n- A useful fix.\n');
  await write(root, 'store/reviewer-notes-submission.txt', 'Readable source; local fonts.\n');
  return root;
}

test('release tags identify the same version in both browser editions', () => {
  assert.deepEqual(validateReleaseVersions(validRelease), { version, tag: `v${version}` });
  assert.throws(() => validateReleaseVersions({ ...validRelease, packageVersion: '1.2.2' }), /must match/);
  assert.throws(() => validateReleaseVersions({ ...validRelease, manifestVersion: '1.2.4' }), /must match/);
  assert.throws(() => validateReleaseVersions({ ...validRelease, lockVersion: '1.2.2' }), /package-lock.json/);
  assert.throws(() => validateReleaseVersions({ ...validRelease, lockPackageVersion: '1.2.2' }), /package-lock.json/);
  assert.throws(() => validateReleaseVersions({ ...validRelease, addonId: 'another-addon@example.com' }), /add-on ID must remain/);
  assert.throws(() => validateReleaseVersions({ ...validRelease, addonId: undefined }), /add-on ID must remain/);
});

test('release versions follow Chromium numeric limits', () => {
  const input = version => ({ ...validRelease, tag: `v${version}`, packageVersion: version, lockVersion: version, lockPackageVersion: version, manifestVersion: version });
  for (const version of ['0.0.1', '65535.65535.65535']) {
    assert.equal(validateReleaseVersions(input(version)).version, version);
  }
  for (const version of ['0.0.0', '65536.1.0', '1.65536.0', '1.0.65536', '99999999999999999999.0.1']) {
    assert.throws(() => validateReleaseVersions(input(version)), /0–65535/, version);
  }
});

test('release validation rejects malformed, prerelease, and unsafe tags', () => {
  for (const tag of [undefined, '', '1.2.3', 'v1.2', 'v01.2.3', 'v1.2.3-beta.1', 'v1.2.3+build', 'v1.2.3\n', ' v1.2.3', '../../1.2.3', 'v1.2.3\nversion=evil']) {
    assert.throws(() => validateReleaseVersions({ ...validRelease, tag }), /RELEASE_TAG/, String(tag));
  }
});

test('AMO metadata uses the version notes, reviewer notes, and desktop Firefox compatibility', async t => {
  const root = await fixture(t);
  const release = await loadReleaseInfo({ root, tag: `v${version}` });
  assert.deepEqual(release.metadata, {
    version: {
      license: 'MIT',
      compatibility: ['firefox'],
      release_notes: { 'en-US': '# Release notes\n\n- A useful fix.' },
      approval_notes: 'Readable source; local fonts.'
    }
  });
  assert.equal(release.version, version);
});

test('missing and empty release inputs stop publishing preparation', async t => {
  for (const path of [`store/release-notes-${version}.md`, 'store/reviewer-notes-submission.txt']) {
    const root = await fixture(t);
    await rm(join(root, path));
    await assert.rejects(loadReleaseInfo({ root, tag: `v${version}` }), /Required release file is missing/);
    await write(root, path, ' \n');
    await assert.rejects(loadReleaseInfo({ root, tag: `v${version}` }), /Required release file is empty/);
  }
});

test('release loading rejects a stale lockfile root package version', async t => {
  const root = await fixture(t);
  await write(root, 'package-lock.json', JSON.stringify({ version, packages: { '': { version: '1.2.2' } } }));
  await assert.rejects(loadReleaseInfo({ root, tag: `v${version}` }), /package-lock.json/);
});

test('release output writes metadata and appends GitHub outputs without touching release archives', async t => {
  const root = await fixture(t);
  const output = join(root, 'github-output');
  await write(root, 'github-output', 'previous=step\n');
  await write(root, `dist/typewell-${version}.xpi`, 'previously submitted artifact');
  const release = await writeReleaseInfo({ root, tag: `v${version}`, output });
  assert.deepEqual(JSON.parse(await readFile(join(root, 'dist/amo-metadata.json'), 'utf8')), release.metadata);
  assert.equal(await readFile(output, 'utf8'), `previous=step\nversion=${version}\ntag=v${version}\n`);
  assert.equal(await readFile(join(root, `dist/typewell-${version}.xpi`), 'utf8'), 'previously submitted artifact');
});

test('source ZIP policy includes reproducible inputs and excludes local configuration and store captures', () => {
  for (const path of ['package-lock.json', '.gitignore', 'extension/background.js', 'extension/fonts/example.woff2', 'extension/fonts/LICENSE', 'scripts/build.mjs', 'tests/fixtures/article.html', 'docs/screenshots/example.jpg', `store/release-notes-${version}.md`]) {
    assert.equal(isPackagedSourcePath(path, version), true, path);
  }
  for (const path of ['.env', '.env.production', '.npmrc', '.git/config', 'scripts/.env.local', 'scripts/.credentials.json', 'scripts/node_modules/package/index.js', 'tests/test-results/result.json', 'docs/dist/private.png', 'docs/build.zip', 'extension/private-key.pem', 'store/chrome/submission-status.png', 'store/chrome/typewell-privacy-site.zip', 'store/chrome/privacy-site/deployment.json', 'store/chrome/privacy-site/public-page.jpg', 'store/submission.json', 'store/unreviewed-notes.md', 'dist/typewell-1.2.3.xpi', '../package.json', 'extension/../private.json', 'extension\\private.json']) {
    assert.equal(isPackagedSourcePath(path, version), false, path);
  }
});

async function sourceFixture(t) {
  const root = await fixture(t);
  for (const path of ['AGENTS.md', '.gitignore', 'README.md', 'PRIVACY.md', 'LICENSE', 'TESTING.md', 'store/README.md', 'store/listing.md', 'store/reviewer-notes.md', 'store/icon-64.png', 'store/icon-32.png', 'store/icon.svg', 'store/screenshots/font-picker.png', 'store/screenshots/preferences.png']) await write(root, path);
  for (const path of ['scripts/build.mjs', 'tests/example.test.mjs', 'docs/example.jpg', 'extension/fonts/LICENSE']) await write(root, path);
  return root;
}

test('source collection never walks unrelated store content or includes ignored local artifacts', async t => {
  const root = await sourceFixture(t);
  for (const path of ['.env', 'scripts/.env.local', 'tests/test-results/private.json', 'docs/build.zip', 'store/chrome/submission-status.png', 'store/chrome/typewell-privacy-site.zip']) await write(root, path, 'PRIVATE LOCAL CONTENT');
  const files = await collectSourceFiles(root, version);
  assert.ok(files.includes('extension/fonts/LICENSE'));
  assert.ok(files.includes('docs/example.jpg'));
  assert.ok(files.includes('store/reviewer-notes-submission.txt'));
  assert.ok(files.every(path => isPackagedSourcePath(path, version)));
  assert.equal(files.some(path => path.includes('/chrome/') || path.includes('.env') || path.includes('test-results') || path.endsWith('.zip')), false);
});

test('source collection rejects symlinks instead of copying their targets', async t => {
  const root = await sourceFixture(t);
  await symlink(join(root, 'package.json'), join(root, 'scripts/linked.json'));
  await assert.rejects(collectSourceFiles(root, version), /Unexpected source symlink/);
  await rm(join(root, 'scripts/linked.json'));
  await rm(join(root, 'README.md'));
  await symlink(join(root, 'package.json'), join(root, 'README.md'));
  await assert.rejects(collectSourceFiles(root, version), /Expected a regular source file/);
});
