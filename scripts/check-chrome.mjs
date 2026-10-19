import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const itemStates = new Set(['PENDING_REVIEW', 'STAGED', 'PUBLISHED', 'PUBLISHED_TO_TESTERS', 'REJECTED', 'CANCELLED']);
const uploadStates = new Set(['UPLOAD_STATE_UNSPECIFIED', 'SUCCEEDED', 'IN_PROGRESS', 'UPLOAD_IN_PROGRESS', 'FAILED', 'NOT_FOUND']);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function readChromeCheckConfiguration(env = process.env) {
  const publisherId = env.CWS_PUBLISHER_ID;
  const extensionId = env.CWS_EXTENSION_ID;
  const token = env.CWS_ACCESS_TOKEN;
  if (typeof publisherId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(publisherId)) {
    throw new Error('Set CWS_PUBLISHER_ID to the publisher ID shown in the Chrome Web Store dashboard.');
  }
  if (typeof extensionId !== 'string' || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error('CWS_EXTENSION_ID must be the 32-letter Chrome extension ID.');
  }
  if (typeof token !== 'string' || !token.trim() || /\s/.test(token)) {
    throw new Error('Set CWS_ACCESS_TOKEN to a scoped access token.');
  }
  return { publisherId, extensionId, token };
}

function revisionStatus(value) {
  if (value === undefined) return null;
  if (!object(value) || !itemStates.has(value.state) || !Array.isArray(value.distributionChannels) || !value.distributionChannels.length) {
    throw new Error('Chrome returned an unknown or incomplete revision status.');
  }
  const versions = value.distributionChannels.map(channel => {
    const version = channel?.crxVersion;
    if (!object(channel) || typeof version !== 'string' || !/^(0|[1-9]\d{0,4})(\.(0|[1-9]\d{0,4})){0,3}$/.test(version) || version.split('.').some(part => Number(part) > 65535)) {
      throw new Error('Chrome returned an invalid or missing revision version.');
    }
    return version;
  });
  return { state: value.state, versions: [...new Set(versions)] };
}

function sanitizedStatus(value, name, extensionId) {
  if (!object(value) || value.name !== name || value.itemId !== extensionId) {
    throw new Error('Chrome returned a malformed response or a different extension identity.');
  }
  for (const flag of ['warned', 'takenDown']) {
    if (value[flag] !== undefined && typeof value[flag] !== 'boolean') throw new Error('Chrome returned an invalid policy status.');
  }
  if (value.lastAsyncUploadState !== undefined && !uploadStates.has(value.lastAsyncUploadState)) throw new Error('Chrome returned an unknown upload status.');
  const published = revisionStatus(value.publishedItemRevisionStatus);
  const submitted = revisionStatus(value.submittedItemRevisionStatus);
  return {
    published,
    submitted,
    draftOrUnsubmitted: !published && !submitted,
    warned: value.warned ?? false,
    takenDown: value.takenDown ?? false,
    lastUploadState: value.lastAsyncUploadState ?? null
  };
}

export async function checkChrome({
  env = process.env, fetchImpl = globalThis.fetch, wait = sleep,
  requestTimeoutMs = 30_000, maxGetAttempts = 3, retryDelayMs = 1000
} = {}) {
  const { publisherId, extensionId, token } = readChromeCheckConfiguration(env);
  if (!Number.isInteger(maxGetAttempts) || maxGetAttempts < 1 || maxGetAttempts > 3 ||
      !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 60_000 ||
      !Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5000) {
    throw new Error('Chrome read timeout and retry settings must stay within bounded limits.');
  }
  const name = `publishers/${publisherId}/items/${extensionId}`;
  const url = `https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`;
  for (let attempt = 0; attempt < maxGetAttempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(requestTimeoutMs),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
      });
    } catch {
      if (attempt + 1 < maxGetAttempts) { await wait(retryDelayMs); continue; }
      throw new Error('Chrome read-only status request failed or timed out.');
    }
    if (!response.ok) {
      if ((response.status === 429 || response.status >= 500) && attempt + 1 < maxGetAttempts) {
        await wait(retryDelayMs);
        continue;
      }
      // API bodies and transport errors can contain sensitive request details.
      throw new Error(`Chrome read-only status request failed with HTTP ${response.status}.`);
    }
    let value;
    try { value = await response.json(); } catch { throw new Error('Chrome returned invalid JSON for the read-only status check.'); }
    return sanitizedStatus(value, name, extensionId);
  }
}

export function formatChromeCheckSummary(result) {
  const revision = (label, value) => `${label}: ${value ? `${value.state} (${value.versions.join(', ')})` : 'none reported'}.`;
  return [
    'Chrome Web Store / Brave: read-only access verified.',
    revision('Published revision', result.published),
    revision('Submitted revision', result.submitted),
    ...(result.draftOrUnsubmitted ? ['No published or submitted revision reported (draft or unsubmitted).'] : []),
    `Store warning: ${result.warned ? 'yes' : 'no'}.`,
    `Taken down: ${result.takenDown ? 'yes' : 'no'}.`,
    ...(result.lastUploadState ? [`Last upload: ${result.lastUploadState}.`] : [])
  ].join(' ');
}

async function main() {
  try {
    const summary = formatChromeCheckSummary(await checkChrome());
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  } catch (error) {
    console.error(error.message);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, 'Chrome Web Store / Brave: read-only status check failed. Check the workflow error and configured account access.\n');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
