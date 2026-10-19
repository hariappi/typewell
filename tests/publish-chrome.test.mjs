import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSummary, publishChrome, readConfiguration } from '../scripts/publish-chrome.mjs';

const env = {
  RELEASE_VERSION: '1.2.4',
  CWS_PUBLISHER_ID: 'typewell-publisher',
  CWS_EXTENSION_ID: 'a'.repeat(32),
  CWS_ACCESS_TOKEN: 'test-token-do-not-print'
};
const name = `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;
const identity = { name, itemId: env.CWS_EXTENSION_ID };
const status = extra => ({ ...identity, ...extra });
const revision = (state, version) => ({ state, distributionChannels: [{ crxVersion: version, deployPercentage: 100 }] });
const upload = extra => ({ ...identity, uploadState: 'SUCCEEDED', crxVersion: env.RELEASE_VERSION, ...extra });
const published = state => ({ ...identity, state });
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);

function harness(responses, overrides = {}) {
  const calls = [];
  const waits = [];
  const reads = [];
  const options = {
    env,
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      assert.ok(responses.length, 'Unexpected HTTP request');
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (next instanceof Response) return next;
      return new Response(JSON.stringify(next), { status: 200 });
    },
    readPackage: async path => { reads.push(path); return zip; },
    wait: async ms => { waits.push(ms); },
    maxPolls: 2,
    maxGetAttempts: 2,
    ...overrides
  };
  return { calls, waits, reads, run: () => publishChrome(options) };
}

test('Chrome configuration rejects invalid IDs and versions before network access', () => {
  const invalid = [
    ['RELEASE_VERSION', '../1.2.4'], ['RELEASE_VERSION', '1.2'], ['RELEASE_VERSION', '1.2.4-beta'],
    ['RELEASE_VERSION', '65536.0.0'], ['RELEASE_VERSION', '01.2.4'], ['RELEASE_VERSION', '0.0.0'],
    ['CWS_PUBLISHER_ID', '../another'], ['CWS_PUBLISHER_ID', 'id?query=true'],
    ['CWS_EXTENSION_ID', 'a'.repeat(31)], ['CWS_EXTENSION_ID', 'z'.repeat(32)],
    ['CWS_ACCESS_TOKEN', ''], ['CWS_ACCESS_TOKEN', 'token\nother']
  ];
  for (const [key, value] of invalid) assert.throws(() => readConfiguration({ ...env, [key]: value }));
  assert.equal(readConfiguration(env).version, '1.2.4');
});

test('Chrome publishes a confirmed upload exactly once and reports pending review', async () => {
  const h = harness([status(), upload(), published('PENDING_REVIEW')]);
  const result = await h.run();
  assert.deepEqual(result, { version: '1.2.4', state: 'PENDING_REVIEW', action: 'submitted', warningCount: 0 });
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST', 'POST']);
  assert.equal(h.reads[0].pathname.split('/').at(-1), 'typewell-1.2.4-chromium.zip');
  assert.equal(h.calls[1].url, `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`);
  assert.equal(h.calls[1].body, zip);
  assert.equal(h.calls[1].headers['Content-Type'], 'application/zip');
  assert.equal(h.calls[1].headers.Authorization, `Bearer ${env.CWS_ACCESS_TOKEN}`);
  assert.deepEqual(JSON.parse(h.calls[2].body), { publishType: 'DEFAULT_PUBLISH', skipReview: false });
  assert.match(formatSummary(result), /PENDING_REVIEW/);
  assert.doesNotMatch(formatSummary(result), /test-token|PUBLISHED/);
});

test('Chrome async uploads poll only reads before publishing', async () => {
  const h = harness([
    status(), upload({ uploadState: 'IN_PROGRESS', crxVersion: undefined }),
    status({ lastAsyncUploadState: 'IN_PROGRESS' }), status({ lastAsyncUploadState: 'SUCCEEDED' }),
    published('PENDING_REVIEW')
  ]);
  assert.equal((await h.run()).state, 'PENDING_REVIEW');
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'POST', 'GET', 'GET', 'POST']);
  assert.equal(h.waits.length, 2);
});

test('Chrome accepts documented legacy async spelling', async () => {
  const h = harness([status(), upload({ uploadState: 'UPLOAD_IN_PROGRESS', crxVersion: undefined }), status({ lastAsyncUploadState: 'SUCCEEDED' }), published('PENDING_REVIEW')]);
  assert.equal((await h.run()).state, 'PENDING_REVIEW');
});

test('Chrome duplicates preserve the actual submitted or published state without mutations', async () => {
  for (const state of ['PENDING_REVIEW', 'STAGED', 'PUBLISHED', 'PUBLISHED_TO_TESTERS']) {
    const source = state.startsWith('PUBLISHED') ? 'publishedItemRevisionStatus' : 'submittedItemRevisionStatus';
    const h = harness([status({ [source]: revision(state, '1.2.4') })]);
    const result = await h.run();
    assert.equal(result.state, state);
    assert.equal(result.action, state.startsWith('PUBLISHED') ? 'already-published' : 'already-submitted');
    assert.equal(h.calls.length, 1);
    assert.equal(h.reads.length, 0);
    if (state === 'STAGED') assert.doesNotMatch(formatSummary(result), /PUBLISHED/);
  }
});

test('Chrome blocks another active submission and newer store revisions', async () => {
  const blocked = [
    { submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.2.3') },
    { submittedItemRevisionStatus: revision('STAGED', '1.2.3') },
    { publishedItemRevisionStatus: revision('PUBLISHED', '1.3.0') },
    { submittedItemRevisionStatus: revision('REJECTED', '1.3.0') },
    { submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.2.4.1') },
    { submittedItemRevisionStatus: revision('CANCELLED', '1.2.4') },
    { submittedItemRevisionStatus: revision('REJECTED', '1.2.4') },
    { lastAsyncUploadState: 'IN_PROGRESS' },
    { takenDown: true }
  ];
  for (const current of blocked) {
    const h = harness([status(current)]);
    await assert.rejects(h.run, /dashboard before retrying/);
    assert.equal(h.calls.length, 1);
  }
});

test('Chrome permits a higher release after an older rejected submission', async () => {
  const h = harness([status({ submittedItemRevisionStatus: revision('REJECTED', '1.2.3') }), upload(), published('PENDING_REVIEW')]);
  assert.equal((await h.run()).state, 'PENDING_REVIEW');
});

test('Chrome does not hide another pending release behind a matching published version', async () => {
  const h = harness([status({ publishedItemRevisionStatus: revision('PUBLISHED', '1.2.4'), submittedItemRevisionStatus: revision('STAGED', '1.2.3') })]);
  await assert.rejects(h.run, /different Chrome version/);
  assert.equal(h.calls.length, 1);
});

test('Chrome fails closed on unknown or malformed preflight state', async () => {
  const blocked = [
    { lastAsyncUploadState: 'UPLOAD_STATE_UNSPECIFIED' },
    { submittedItemRevisionStatus: revision('FUTURE_STATE', '1.2.3') },
    { submittedItemRevisionStatus: { state: 'PENDING_REVIEW' } },
    { publishedItemRevisionStatus: revision('PUBLISHED', 'invalid') },
    { publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [] } }
  ];
  for (const current of blocked) {
    const h = harness([status(current)]);
    await assert.rejects(h.run, /dashboard before retrying/);
    assert.equal(h.calls.length, 1);
  }
});

test('Chrome rejects unexpected extension identities', async () => {
  for (const response of [null, {}, { ...identity, itemId: 'b'.repeat(32) }, { ...identity, name: 'wrong' }]) {
    const h = harness([response]);
    await assert.rejects(h.run, /malformed response or a different extension identity/);
    assert.equal(h.calls.length, 1);
  }
});

test('Chrome upload failures and mismatched versions never reach publish', async () => {
  for (const result of [
    upload({ uploadState: 'FAILED' }), upload({ uploadState: 'NOT_FOUND' }),
    upload({ uploadState: 'UNKNOWN' }), upload({ uploadState: undefined }),
    upload({ crxVersion: '1.2.5' }), upload({ crxVersion: undefined })
  ]) {
    const h = harness([status(), result]);
    await assert.rejects(h.run, /dashboard before retrying/);
    assert.equal(h.calls.length, 2);
    assert.ok(h.calls.every(call => !call.url.endsWith(':publish')));
  }
});

test('Chrome bounded async failure or timeout never reaches publish', async () => {
  for (const states of [['FAILED'], ['NOT_FOUND'], [undefined], ['UNKNOWN'], ['IN_PROGRESS', 'IN_PROGRESS']]) {
    const h = harness([status(), upload({ uploadState: 'IN_PROGRESS' }), ...states.map(lastAsyncUploadState => status({ lastAsyncUploadState }))]);
    await assert.rejects(h.run, /dashboard before retrying/);
    assert.equal(h.calls.filter(call => call.method === 'POST').length, 1);
    assert.ok(h.calls.length <= 4);
  }
});

test('Chrome retries transient reads but never retries upload or publish mutations', async () => {
  const h = harness([new Response('', { status: 503 }), status(), upload(), published('PENDING_REVIEW')]);
  assert.equal((await h.run()).state, 'PENDING_REVIEW');
  assert.deepEqual(h.calls.map(call => call.method), ['GET', 'GET', 'POST', 'POST']);
  for (const failure of [new Response('sensitive response', { status: 500 }), new Error('sensitive network failure')]) {
    const uploadFailure = harness([status(), failure]);
    await assert.rejects(uploadFailure.run, error => /dashboard before retrying/.test(error.message) && !/sensitive/.test(error.message));
    assert.equal(uploadFailure.calls.length, 2);
  }
  const publishFailure = harness([status(), upload(), new Error('unknown post outcome')]);
  await assert.rejects(publishFailure.run, /dashboard before retrying/);
  assert.equal(publishFailure.calls.length, 3);
});

test('Chrome read retry budget and HTTP authorization errors stop before upload', async () => {
  const retry = harness([new Error('offline'), new Error('offline')]);
  await assert.rejects(retry.run, /failed or timed out/);
  assert.equal(retry.calls.length, 2);
  const unauthorized = harness([new Response('private details', { status: 401 })]);
  await assert.rejects(unauthorized.run, /HTTP 401/);
  assert.equal(unauthorized.calls.length, 1);
});

test('Chrome malformed JSON is not silently retried or published', async () => {
  const h = harness([status(), new Response('not JSON')]);
  await assert.rejects(h.run, /not valid JSON.*dashboard before retrying/);
  assert.equal(h.calls.length, 2);
});

test('Chrome missing or invalid package fails before any mutation', async () => {
  for (const readPackage of [async () => { throw new Error('private path'); }, async () => Buffer.from('not a zip')]) {
    const h = harness([status()], { readPackage });
    await assert.rejects(h.run, /Build and validate the release first/);
    assert.equal(h.calls.length, 1);
  }
});

test('Chrome publish responses retain real store states and reject unknown outcomes', async () => {
  for (const state of ['PENDING_REVIEW', 'STAGED', 'PUBLISHED', 'PUBLISHED_TO_TESTERS']) {
    const h = harness([status(), upload(), published(state)]);
    assert.equal((await h.run()).state, state);
  }
  for (const state of ['REJECTED', 'CANCELLED', 'FUTURE_STATE', undefined]) {
    const h = harness([status(), upload(), published(state)]);
    await assert.rejects(h.run, /unsuccessful or unknown publish state/);
    assert.equal(h.calls.length, 3);
  }
});

test('Chrome reports warning count without exposing response content', async () => {
  const h = harness([status(), upload(), { ...published('PENDING_REVIEW'), warningInfo: { warnings: [{ reason: 'BROAD_HOST', description: 'untrusted text' }] } }]);
  const summary = formatSummary(await h.run());
  assert.match(summary, /1 warning/);
  assert.doesNotMatch(summary, /untrusted text|test-token/);
});
