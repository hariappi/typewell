import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ADDON_ID = 'typewell@font-changer.local';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function validateReleaseVersions({ tag, packageVersion, lockVersion, lockPackageVersion, manifestVersion, addonId }) {
  if (typeof tag !== 'string' || tag.trim() !== tag || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
    throw new Error('RELEASE_TAG must be a stable release tag such as v1.2.3.');
  }
  const version = tag.slice(1);
  const parts = version.split('.').map(Number);
  if (parts.some(part => part > 65535) || parts.every(part => part === 0)) {
    throw new Error('Release version components must be 0–65535 and cannot all be zero.');
  }
  if (packageVersion !== version || manifestVersion !== version) {
    throw new Error(`Release ${tag} must match package.json (${packageVersion}) and extension/manifest.json (${manifestVersion}).`);
  }
  if (lockVersion !== version || lockPackageVersion !== version) {
    throw new Error(`Release ${tag} must match package-lock.json at version (${lockVersion}) and packages[\"\"].version (${lockPackageVersion}).`);
  }
  if (addonId !== ADDON_ID) throw new Error(`The Firefox add-on ID must remain ${ADDON_ID}.`);
  return { version, tag };
}

async function readRequiredText(root, filename) {
  let text;
  try {
    text = await readFile(join(root, filename), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Required release file is missing: ${filename}`);
    throw error;
  }
  if (!text.trim()) throw new Error(`Required release file is empty: ${filename}`);
  return text.trim();
}

export async function loadReleaseInfo({ root = projectRoot, tag = process.env.RELEASE_TAG } = {}) {
  const [pkg, lock, manifest] = await Promise.all([
    readFile(join(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(join(root, 'package-lock.json'), 'utf8').then(JSON.parse),
    readFile(join(root, 'extension/manifest.json'), 'utf8').then(JSON.parse)
  ]);
  const release = validateReleaseVersions({
    tag,
    packageVersion: pkg.version,
    lockVersion: lock.version,
    lockPackageVersion: lock.packages?.['']?.version,
    manifestVersion: manifest.version,
    addonId: manifest.browser_specific_settings?.gecko?.id
  });
  const [releaseNotes, approvalNotes] = await Promise.all([
    readRequiredText(root, `store/release-notes-${release.version}.md`),
    readRequiredText(root, 'store/reviewer-notes-submission.txt')
  ]);
  return {
    ...release,
    metadata: {
      version: {
        license: 'MIT',
        compatibility: ['firefox'],
        release_notes: { 'en-US': releaseNotes },
        approval_notes: approvalNotes
      }
    }
  };
}

export async function writeReleaseInfo({ root = projectRoot, tag = process.env.RELEASE_TAG, output = process.env.GITHUB_OUTPUT } = {}) {
  const release = await loadReleaseInfo({ root, tag });
  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist/amo-metadata.json'), `${JSON.stringify(release.metadata, null, 2)}\n`);
  if (output) await appendFile(output, `version=${release.version}\ntag=${release.tag}\n`);
  return release;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => arg !== '--metadata')) throw new Error('Usage: RELEASE_TAG=vX.Y.Z node scripts/release-info.mjs [--metadata]');
  const release = await writeReleaseInfo();
  console.log(`Validated ${release.tag} for Firefox and Chromium; wrote dist/amo-metadata.json.`);
}
