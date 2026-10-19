import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Packaging only. This script never signs in, uploads, or submits to Mozilla.
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectories = ['extension', 'scripts', 'tests', 'docs'];
const rootFiles = ['AGENTS.md', '.gitignore', 'README.md', 'PRIVACY.md', 'LICENSE', 'TESTING.md', 'package.json', 'package-lock.json'];
const excludedDirectories = new Set(['node_modules', 'dist', 'test-results', 'web-ext-artifacts', 'coverage', 'playwright-report']);

function storeSourceFiles(version) {
  if (typeof version !== 'string' || version.trim() !== version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a three-part release version.');
  return [
    'store/README.md', 'store/listing.md', `store/release-notes-${version}.md`,
    'store/reviewer-notes-submission.txt', 'store/reviewer-notes.md',
    'store/icon-64.png', 'store/icon-32.png', 'store/icon.svg',
    'store/screenshots/font-picker.png', 'store/screenshots/preferences.png'
  ];
}

function excludedPath(path) {
  const segments = path.split('/');
  return path.includes('\\') || segments.some(segment => !segment || segment === '..' || segment.startsWith('.') || excludedDirectories.has(segment));
}

// The store directory also contains private dashboard captures and generated ZIPs.
// Include its known submission inputs explicitly, never by recursive traversal.
export function isPackagedSourcePath(path, version) {
  const explicitFiles = [...rootFiles, ...storeSourceFiles(version)];
  if (explicitFiles.includes(path)) return true;
  if (excludedPath(path) || !sourceDirectories.includes(path.split('/')[0])) return false;
  return /\.(?:js|mjs|json|html|css|svg|png|jpe?g|woff2|txt|md)$/.test(path) || path.endsWith('/LICENSE');
}

export async function collectSourceFiles(root, version) {
  const sourceFiles = [...rootFiles, ...storeSourceFiles(version)];
  for (const path of sourceFiles) {
    if (!(await lstat(join(root, path))).isFile()) throw new Error(`Expected a regular source file: ${path}`);
  }
  async function filesUnder(directory) {
    if (!(await lstat(join(root, directory))).isDirectory()) throw new Error(`Expected a regular source directory: ${directory}`);
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      const path = `${directory}/${entry.name}`;
      if (excludedPath(path)) continue;
      if (entry.isDirectory()) await filesUnder(path);
      else if (entry.isSymbolicLink()) throw new Error(`Unexpected source symlink: ${path}`);
      else if (entry.isFile() && isPackagedSourcePath(path, version)) sourceFiles.push(path);
    }
  }
  for (const directory of sourceDirectories) await filesUnder(directory);
  return sourceFiles.sort();
}

export async function packageAmo(root = projectRoot) {
  const dist = join(root, 'dist');
  const bundle = join(dist, 'amo');
  const manifest = JSON.parse(await readFile(join(root, 'extension/manifest.json'), 'utf8'));
  const version = manifest.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a three-part release version.');
  if (manifest.incognito !== 'not_allowed') throw new Error('Review private-session handling before enabling private browsing.');
  const sourceFiles = await collectSourceFiles(root, version);

  execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
  await rm(bundle, { recursive: true, force: true });
  await mkdir(bundle, { recursive: true });

  const sourceName = `typewell-${version}-source.zip`;
  const sourcePath = join(dist, sourceName);
  await rm(sourcePath, { force: true });
  execFileSync('zip', ['-q', '-X', sourcePath, ...sourceFiles.sort()], { cwd: root });

  const copied = [
    [`dist/typewell-${version}.xpi`, `typewell-${version}.xpi`],
    [`dist/${sourceName}`, sourceName],
    ['store/listing.md', 'listing.md'],
    [`store/release-notes-${version}.md`, 'release-notes.md'],
    ['store/reviewer-notes-submission.txt', 'reviewer-notes-submission.txt'],
    ['store/reviewer-notes.md', 'reviewer-notes.md'],
    ['PRIVACY.md', 'PRIVACY.md'],
    ['LICENSE', 'LICENSE'],
    ['TESTING.md', 'TESTING.md'],
    ['store/icon-64.png', 'icon-64.png'],
    ['store/icon-32.png', 'icon-32.png'],
    ['store/icon.svg', 'icon.svg'],
    ['store/screenshots/font-picker.png', 'screenshots/font-picker.png'],
    ['store/screenshots/preferences.png', 'screenshots/preferences.png']
  ];
  for (const [from, to] of copied) {
    const target = join(bundle, to);
    await mkdir(join(target, '..'), { recursive: true });
    await copyFile(join(root, from), target);
  }
  await writeFile(join(bundle, 'SUBMISSION.md'), `# Typewell ${version} — Mozilla submission kit

Prepared locally. Nothing has been uploaded, signed, or published.

1. Open https://addons.mozilla.org/en-US/developers/addon/submit/distribution, complete any CAPTCHA, and sign in with the account that should own Typewell. Review any developer agreement yourself.
2. Choose **On this site** and upload **typewell-${version}.xpi** from this folder. Select desktop platforms only and wait for Mozilla's validation.
3. Use **listing.md**, **PRIVACY.md**, **icon-64.png**, and the two **screenshots/** PNGs for the listing. The proposed slug and public support contact need your account's choices.
4. Paste **release-notes.md** and the portal-sized **reviewer-notes-submission.txt**. The longer **reviewer-notes.md** is reference material. Readable runtime source is already in the XPI; **${sourceName}** provides additional development source if requested.
5. Submit the version and record Mozilla's actual status and public URL. Local checks do not constitute approval.

**TESTING.md** records local verification. **amo-release.json** records sizes and SHA-256 checksums. For build commands, extract the source archive and read its README; the submission kit itself is not a source checkout.
`);

  const report = {
    name: manifest.name,
    version,
    addOnId: manifest.browser_specific_settings.gecko.id,
    generatedAt: new Date().toISOString(),
    distribution: 'listed',
    status: 'prepared-locally-not-submitted',
    signed: false,
    minimumFirefox: manifest.browser_specific_settings.gecko.strict_min_version,
    privateBrowsing: manifest.incognito,
    artifacts: [],
    sourceFileCount: sourceFiles.length
  };
  for (const filename of [`typewell-${version}.xpi`, `typewell-${version}.zip`, sourceName]) {
    const path = join(dist, filename);
    const bytes = await readFile(path);
    report.artifacts.push({ path: relative(root, path), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(join(dist, 'amo-release.json'), `${JSON.stringify(report, null, 2)}\n`);
  await copyFile(join(dist, 'amo-release.json'), join(bundle, 'amo-release.json'));
  console.log(`Prepared dist/amo/ with the unsigned upload, listing assets, and ${sourceFiles.length}-file source archive.`);
  console.log('No files have been uploaded to Mozilla. Checksums are in dist/amo-release.json.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await packageAmo();
