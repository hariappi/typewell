import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const api = 'https://chromewebstore.googleapis.com';
const scopeNote = 'Inspect the Chrome Web Store dashboard before retrying; a request may already have reached the store.';
const itemStates = new Set(['PENDING_REVIEW', 'STAGED', 'PUBLISHED', 'PUBLISHED_TO_TESTERS', 'REJECTED', 'CANCELLED']);
const activeStates = new Set(['PENDING_REVIEW', 'STAGED']);
const publishedStates = new Set(['PUBLISHED', 'PUBLISHED_TO_TESTERS']);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function fail(message) {
  throw new Error(`${message} ${scopeNote}`);
}

function versionParts(version, exactThree = false) {
  const pattern = exactThree ? /^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/ : /^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/;
  if (typeof version !== 'string' || !pattern.test(version)) return null;
  const parts = version.split('.').map(Number);
  if (parts.some(part => part > 65535)) return null;
  return [...parts, ...Array(4 - parts.length).fill(0)];
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) fail('The store returned an invalid or missing version.');
  for (let index = 0; index < 4; index++) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  }
  return 0;
}

export function readConfiguration(env = process.env) {
  const version = env.RELEASE_VERSION;
  const parts = versionParts(version, true);
  if (!parts || parts.every(part => part === 0)) throw new Error('RELEASE_VERSION must be a nonzero three-part numeric extension version.');
  const publisherId = env.CWS_PUBLISHER_ID;
  if (typeof publisherId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(publisherId)) {
    throw new Error('Set CWS_PUBLISHER_ID to the publisher ID shown in the Chrome Web Store dashboard.');
  }
  const extensionId = env.CWS_EXTENSION_ID;
  if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error('CWS_EXTENSION_ID must be the 32-letter Chrome extension ID.');
  }
  const token = env.CWS_ACCESS_TOKEN;
  if (typeof token !== 'string' || !token.trim() || /\s/.test(token)) throw new Error('Set CWS_ACCESS_TOKEN to a scoped access token.');
  return { version, publisherId, extensionId, token };
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function uploadState(value) {
  // Some prose in Google's docs still uses the older UPLOAD_IN_PROGRESS name.
  if (value === 'UPLOAD_IN_PROGRESS') return 'IN_PROGRESS';
  if (['SUCCEEDED', 'IN_PROGRESS', 'FAILED', 'NOT_FOUND'].includes(value)) return value;
  fail('The store returned an unknown upload state.');
}

function validateIdentity(value, name, extensionId) {
  if (!object(value) || value.itemId !== extensionId || value.name !== name) {
    fail('The store returned a malformed response or a different extension identity.');
  }
}

function revisions(status) {
  return ['publishedItemRevisionStatus', 'submittedItemRevisionStatus'].flatMap(key => {
    const revision = status[key];
    if (revision === undefined) return [];
    if (!object(revision) || !itemStates.has(revision.state) || !Array.isArray(revision.distributionChannels) || !revision.distributionChannels.length) {
      fail('The store returned an unknown or incomplete revision status.');
    }
    return revision.distributionChannels.map(channel => {
      if (!object(channel) || !versionParts(channel.crxVersion)) fail('The store returned an invalid or missing revision version.');
      return { state: revision.state, version: channel.crxVersion, source: key };
    });
  });
}

function preflight(status, version) {
  if (status.takenDown === true) fail('The extension is taken down and cannot be released automatically.');
  if (status.lastAsyncUploadState !== undefined && uploadState(status.lastAsyncUploadState) === 'IN_PROGRESS') {
    fail('Another Chrome package upload is still in progress.');
  }
  const existing = revisions(status);
  if (existing.some(revision => compareVersions(revision.version, version) > 0)) fail('The store already has a newer extension version.');
  if (existing.some(revision => activeStates.has(revision.state) && compareVersions(revision.version, version) !== 0)) {
    fail('A different Chrome version is already pending review or staged.');
  }
  const same = existing.filter(revision => compareVersions(revision.version, version) === 0);
  const active = same.find(revision => activeStates.has(revision.state));
  if (active) return { version, state: active.state, action: 'already-submitted' };
  const published = same.find(revision => publishedStates.has(revision.state));
  if (published) return { version, state: published.state, action: 'already-published' };
  if (same.length) fail('This version already has a rejected or cancelled submission.');
  return null;
}

export async function publishChrome({
  env = process.env,
  fetchImpl = globalThis.fetch,
  readPackage = readFile,
  wait = sleep,
  requestTimeoutMs = 30_000,
  pollIntervalMs = 5_000,
  maxPolls = 24,
  maxGetAttempts = 3
} = {}) {
  const { version, publisherId, extensionId, token } = readConfiguration(env);
  if (!Number.isInteger(maxPolls) || maxPolls < 1 || !Number.isInteger(maxGetAttempts) || maxGetAttempts < 1) {
    throw new Error('Polling and read retry limits must be positive integers.');
  }
  const name = `publishers/${publisherId}/items/${extensionId}`;
  const url = `${api}/v2/${name}`;

  async function requestJson(endpoint, { method = 'GET', body, contentType } = {}) {
    const attempts = method === 'GET' ? maxGetAttempts : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method,
          redirect: 'error',
          headers: { Authorization: `Bearer ${token}`, ...(contentType ? { 'Content-Type': contentType } : {}) },
          ...(body === undefined ? {} : { body }),
          signal: AbortSignal.timeout(requestTimeoutMs)
        });
      } catch {
        if (attempt + 1 < attempts) { await wait(pollIntervalMs); continue; }
        fail(`Chrome ${method} request failed or timed out.`);
      }
      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt + 1 < attempts) {
          await wait(pollIntervalMs);
          continue;
        }
        // Never print response bodies or request details: they can contain credentials.
        fail(`Chrome ${method} request failed with HTTP ${response.status}.`);
      }
      let result;
      try { result = await response.json(); } catch { fail(`Chrome ${method} response was not valid JSON.`); }
      validateIdentity(result, name, extensionId);
      return result;
    }
  }

  const current = await requestJson(`${url}:fetchStatus`);
  const duplicate = preflight(current, version);
  if (duplicate) return duplicate;

  const packagePath = new URL(`../dist/typewell-${version}-chromium.zip`, import.meta.url);
  let bytes;
  try { bytes = await readPackage(packagePath); } catch { throw new Error(`Cannot read dist/typewell-${version}-chromium.zip. Build and validate the release first.`); }
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error('The Chromium package is not a ZIP archive. Build and validate the release first.');
  }
  const uploaded = await requestJson(`${api}/upload/v2/${name}:upload`, { method: 'POST', body: bytes, contentType: 'application/zip' });
  let state = uploadState(uploaded.uploadState);
  if (uploaded.crxVersion !== undefined && uploaded.crxVersion !== version) fail('The uploaded Chrome package has a different version.');
  if (state === 'SUCCEEDED' && uploaded.crxVersion !== version) fail('The upload response did not confirm the expected version.');
  for (let poll = 0; state === 'IN_PROGRESS' && poll < maxPolls; poll++) {
    await wait(pollIntervalMs);
    const status = await requestJson(`${url}:fetchStatus`);
    state = uploadState(status.lastAsyncUploadState);
  }
  if (state !== 'SUCCEEDED') fail(state === 'IN_PROGRESS' ? 'Chrome upload processing exceeded the polling limit.' : 'Chrome package upload did not succeed.');

  const published = await requestJson(`${url}:publish`, {
    method: 'POST',
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false }),
    contentType: 'application/json'
  });
  if (!activeStates.has(published.state) && !publishedStates.has(published.state)) fail('Chrome returned an unsuccessful or unknown publish state.');
  return { version, state: published.state, action: 'submitted', warningCount: Array.isArray(published.warningInfo?.warnings) ? published.warningInfo.warnings.length : 0 };
}

export function formatSummary(result) {
  const actions = { 'already-submitted': 'Already submitted; no changes made.', 'already-published': 'Already published; no changes made.', submitted: 'Store submission request accepted.' };
  if (!versionParts(result.version, true) || !actions[result.action] || !itemStates.has(result.state)) throw new Error('Cannot summarize an invalid publish result.');
  return `Chrome Web Store / Brave — Typewell ${result.version}: ${result.state}. ${actions[result.action]}${result.warningCount ? ` Store returned ${result.warningCount} warning(s); inspect the dashboard.` : ''}`;
}

async function main() {
  try {
    const result = await publishChrome();
    const summary = formatSummary(result);
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  } catch (error) {
    console.error(error.message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, 'Chrome Web Store / Brave: release stopped. Inspect the workflow error and store dashboard before retrying.\n');
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
