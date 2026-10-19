import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDON_ID } from './release-info.mjs';

const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
const api = 'https://addons.mozilla.org/api/v5/';
const versionsURL = `${api}addons/addon/${encodeURIComponent(ADDON_ID)}/versions/`;
const recovery = 'Inspect the AMO version dashboard before retrying. If this version exists without source, attach its matching source archive there; do not recreate or delete the version.';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function fail(message) { throw new Error(`${message} ${recovery}`); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function parts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version)) return null;
  const values = version.split('.').map(Number);
  if (values.some(value => !Number.isSafeInteger(value))) return null;
  return [...values, ...Array(4 - values.length).fill(0)];
}

function newerVersion(candidate, target) {
  const left = parts(candidate), right = parts(target);
  if (!left || !right) fail('An existing listed version cannot be safely compared with this release.');
  for (let index = 0; index < 4; index++) if (left[index] !== right[index]) return left[index] > right[index];
  return false;
}

export function readFirefoxConfiguration(env = process.env) {
  const version = env.RELEASE_VERSION;
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || !parts(version)) {
    throw new Error('RELEASE_VERSION must be a three-part numeric extension version.');
  }
  const apiKey = env.WEB_EXT_API_KEY, apiSecret = env.WEB_EXT_API_SECRET;
  if (typeof apiKey !== 'string' || !apiKey || /\s/.test(apiKey) || typeof apiSecret !== 'string' || !apiSecret || /\s/.test(apiSecret)) {
    throw new Error('Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET to the AMO API credentials.');
  }
  return { version, apiKey, apiSecret };
}

// AMO accepts short-lived HS256 JWTs. Create a fresh nonce for each read request.
export function createAmoJWT(apiKey, apiSecret, { now = Date.now(), nonce = randomUUID() } = {}) {
  const issuedAt = Math.floor(now / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: apiKey, jti: nonce, iat: issuedAt, exp: issuedAt + 60 })).toString('base64url');
  const signature = createHmac('sha256', apiSecret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function safeNextPage(next) {
  let url, pathname;
  try { url = new URL(next); pathname = decodeURIComponent(url.pathname); } catch { fail('AMO returned an invalid pagination URL.'); }
  const expected = new URL(versionsURL);
  if (url.origin !== expected.origin || url.username || url.password || url.hash ||
      pathname !== decodeURIComponent(expected.pathname) ||
      url.searchParams.getAll('filter').length !== 1 || url.searchParams.get('filter') !== 'all_with_unlisted') {
    fail('AMO returned an unexpected pagination URL.');
  }
  return url.href;
}

export async function publishFirefox({
  env = process.env, root = rootDirectory, fetchImpl = globalThis.fetch,
  readFileImpl = readFile, statImpl = stat, runWebExt = execFileSync,
  wait = sleep, requestTimeoutMs = 30_000, maxGetAttempts = 3, maxPages = 100
} = {}) {
  const { version, apiKey, apiSecret } = readFirefoxConfiguration(env);
  if (!Number.isInteger(maxGetAttempts) || maxGetAttempts < 1 || !Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error('AMO read retry and pagination limits must be positive integers.');
  }
  const sourceDir = join(root, 'firefox-upload');
  const metadata = join(root, 'dist/amo-metadata.json');
  const source = join(root, `dist/typewell-${version}-source.zip`);
  let manifest;
  try {
    manifest = JSON.parse(await readFileImpl(join(sourceDir, 'manifest.json'), 'utf8'));
    for (const path of [metadata, source]) if (!(await statImpl(path)).isFile()) throw new Error('not a file');
  } catch {
    throw new Error('The tested Firefox package, metadata, or source archive is missing or unreadable. Download and verify the release artifacts first.');
  }
  if (!object(manifest) || manifest.version !== version || manifest.browser_specific_settings?.gecko?.id !== ADDON_ID) {
    throw new Error('The tested Firefox manifest does not match the release version and Typewell add-on ID.');
  }

  async function getJSON(url) {
    for (let attempt = 0; attempt < maxGetAttempts; attempt++) {
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'GET', redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs),
          headers: { Authorization: `JWT ${createAmoJWT(apiKey, apiSecret)}`, Accept: 'application/json' }
        });
      } catch {
        if (attempt + 1 < maxGetAttempts) { await wait(1000); continue; }
        fail('AMO preflight request failed or timed out. No submission was attempted.');
      }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt + 1 < maxGetAttempts) { await wait(1000); continue; }
        fail(`AMO preflight failed with HTTP ${response.status}. No submission was attempted.`);
      }
      try { return await response.json(); } catch { fail('AMO returned invalid JSON. No submission was attempted.'); }
    }
  }

  // The default API list excludes pending/disabled versions. Check all channels
  // because an unlisted version can also reserve the same version number.
  let next = `${versionsURL}?filter=all_with_unlisted&page_size=50`;
  const visited = new Set(), ids = new Set();
  let expectedCount = null, match = null;
  while (next) {
    if (visited.has(next) || visited.size >= maxPages) fail('AMO pagination repeated or exceeded its limit. No submission was attempted.');
    visited.add(next);
    const page = await getJSON(next);
    if (!object(page) || !Number.isSafeInteger(page.count) || page.count < 0 || !Array.isArray(page.results) ||
        (page.next !== null && typeof page.next !== 'string')) fail('AMO returned an incomplete version list.');
    if (expectedCount !== null && page.count !== expectedCount) fail('The AMO version list changed during preflight.');
    expectedCount = page.count;
    for (const item of page.results) {
      if (!object(item) || !Number.isSafeInteger(item.id) || item.id < 1 || ids.has(item.id) ||
          typeof item.version !== 'string' || !item.version || !['listed', 'unlisted', 'enterprise'].includes(item.channel)) {
        fail('AMO returned an invalid or repeated version record.');
      }
      ids.add(item.id);
      if (item.channel === 'listed' && newerVersion(item.version, version)) fail('AMO already has a newer listed version.');
      if (item.version === version) {
        if (match) fail('AMO returned multiple records for this version.');
        match = item;
      }
    }
    if (ids.size > expectedCount) fail('AMO returned inconsistent version counts.');
    next = page.next === null ? null : safeNextPage(page.next);
  }
  if (ids.size !== expectedCount) fail('AMO returned an incomplete version history.');
  if (match) {
    if (match.channel !== 'listed') fail('This Firefox version already exists on another AMO channel.');
    const detail = await getJSON(`${versionsURL}${match.id}/`);
    if (!object(detail) || detail.id !== match.id || detail.version !== version || detail.channel !== 'listed') {
      fail('AMO returned mismatched version details.');
    }
    let hasSource = false;
    try { hasSource = typeof detail.source === 'string' && new URL(detail.source).protocol === 'https:'; } catch { /* Missing or invalid source. */ }
    if (!hasSource) fail('This Firefox version already exists but its reviewer source is missing or unconfirmed.');
    if (detail.is_disabled !== false || !object(detail.file) || !['public', 'unreviewed'].includes(detail.file.status)) {
      fail('This Firefox version already exists in a disabled, rejected, or unknown state.');
    }
    return { version, state: detail.file.status, action: 'already-submitted' };
  }

  try {
    runWebExt(process.execPath, [
      join(root, 'node_modules/web-ext/bin/web-ext.js'), 'sign',
      '--source-dir', sourceDir, '--channel', 'listed', '--amo-base-url', api,
      '--amo-metadata', metadata, '--upload-source-code', source,
      '--approval-timeout', '0', '--no-input', '--no-config-discovery'
    ], { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 });
  } catch {
    // web-ext may have created the version before the source PATCH failed.
    // Do not print subprocess errors/stdout/stderr, or retry the mutation.
    fail('Firefox submission did not finish successfully; the version may already have been created.');
  }
  return { version, state: 'submitted', action: 'submitted' };
}

export function formatFirefoxSummary(result) {
  if (!parts(result.version) || !['submitted', 'already-submitted'].includes(result.action) || !['public', 'unreviewed', 'submitted'].includes(result.state)) {
    throw new Error('Cannot summarize an invalid Firefox submission result.');
  }
  if (result.action === 'already-submitted') {
    return `Firefox — Typewell ${result.version}: existing listed version is ${result.state}, with reviewer source attached. No submission was repeated.`;
  }
  return `Firefox — Typewell ${result.version}: submitted to Mozilla with reviewer source. Approval and publication remain with Mozilla.`;
}

async function main() {
  try {
    const summary = formatFirefoxSummary(await publishFirefox());
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  } catch (error) {
    console.error(error.message);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Firefox: release stopped. ${recovery}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
