import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { ADDON_ID } from '../scripts/release-info.mjs';
import { createAmoJWT, formatFirefoxSummary, publishFirefox, readFirefoxConfiguration } from '../scripts/publish-firefox.mjs';

const env = { RELEASE_VERSION: '1.2.4', WEB_EXT_API_KEY: 'user:123:456', WEB_EXT_API_SECRET: 'secret-do-not-print' };
const root = '/tmp/typewell-publish-test';
const endpoint = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(ADDON_ID)}/versions/`;
const manifest = { version: env.RELEASE_VERSION, browser_specific_settings: { gecko: { id: ADDON_ID } } };
const item = (version = '1.2.3', extra = {}) => ({ id: 10, version, channel: 'listed', ...extra });
const page = (results = [], extra = {}) => ({ count: results.length, next: null, results, ...extra });
const detail = extra => ({ ...item('1.2.4'), is_disabled: false, file: { status: 'unreviewed' }, source: 'https://addons.mozilla.org/source.zip', ...extra });

function harness(responses, overrides = {}) {
  const calls = [], runs = [], waits = [];
  const options = {
    env, root, maxGetAttempts: 2, maxPages: 3,
    readFileImpl: async () => JSON.stringify(manifest), statImpl: async () => ({ isFile: () => true }),
    runWebExt: (...args) => { runs.push(args); },
    wait: async ms => { waits.push(ms); },
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      assert.ok(responses.length, 'Unexpected HTTP request');
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response instanceof Response ? response : new Response(JSON.stringify(response));
    },
    ...overrides
  };
  return { calls, runs, waits, run: () => publishFirefox(options) };
}

test('Firefox configuration rejects missing credentials and unsafe versions', () => {
  for (const [key, value] of [
    ['RELEASE_VERSION', '../1.2.4'], ['RELEASE_VERSION', '1.2.4\n'], ['RELEASE_VERSION', '1.2'],
    ['RELEASE_VERSION', '01.2.4'], ['RELEASE_VERSION', '1.2.4-beta'], ['WEB_EXT_API_KEY', ''],
    ['WEB_EXT_API_SECRET', undefined], ['WEB_EXT_API_SECRET', 'secret\nvalue']
  ]) assert.throws(() => readFirefoxConfiguration({ ...env, [key]: value }));
  assert.equal(readFirefoxConfiguration(env).version, '1.2.4');
});

test('AMO JWT has a short lifetime, unique nonce, and valid HS256 signature', () => {
  const token = createAmoJWT(env.WEB_EXT_API_KEY, env.WEB_EXT_API_SECRET, { now: 1_700_000_000_000, nonce: 'unique-test-nonce' });
  const [header, payload, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iss: env.WEB_EXT_API_KEY, jti: 'unique-test-nonce', iat: 1_700_000_000, exp: 1_700_000_060 });
  assert.equal(signature, createHmac('sha256', env.WEB_EXT_API_SECRET).update(`${header}.${payload}`).digest('base64url'));
  assert.notEqual(createAmoJWT(env.WEB_EXT_API_KEY, env.WEB_EXT_API_SECRET), createAmoJWT(env.WEB_EXT_API_KEY, env.WEB_EXT_API_SECRET));
});

test('Firefox submits a missing version once from the verified package using local web-ext', async () => {
  const h = harness([page([item()])]);
  const result = await h.run();
  assert.deepEqual(result, { version: '1.2.4', state: 'submitted', action: 'submitted' });
  assert.equal(h.calls.length, 1);
  assert.equal(new URL(h.calls[0].url).searchParams.get('filter'), 'all_with_unlisted');
  assert.equal(h.calls[0].method, 'GET');
  assert.equal(h.calls[0].redirect, 'error');
  assert.match(h.calls[0].headers.Authorization, /^JWT /);
  assert.equal(h.runs.length, 1);
  const [binary, args, options] = h.runs[0];
  assert.equal(binary, process.execPath);
  assert.deepEqual(args, [
    `${root}/node_modules/web-ext/bin/web-ext.js`, 'sign', '--source-dir', `${root}/firefox-upload`,
    '--channel', 'listed', '--amo-base-url', 'https://addons.mozilla.org/api/v5/',
    '--amo-metadata', `${root}/dist/amo-metadata.json`, '--upload-source-code', `${root}/dist/typewell-1.2.4-source.zip`,
    '--approval-timeout', '0', '--no-input', '--no-config-discovery'
  ]);
  assert.equal(options.env.WEB_EXT_API_SECRET, env.WEB_EXT_API_SECRET);
  assert.ok(!args.includes(env.WEB_EXT_API_SECRET));
  assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.match(formatFirefoxSummary(result), /Approval and publication remain with Mozilla/);
});

test('Firefox follows all version pages and safely skips a complete existing submission', async () => {
  const next = `${endpoint}?filter=all_with_unlisted&page_size=50&page=2`;
  for (const state of ['public', 'unreviewed']) {
    const h = harness([
      page([item()], { count: 2, next }),
      page([item('1.2.4', { id: 11 })], { count: 2 }),
      detail({ id: 11, file: { status: state } })
    ]);
    const result = await h.run();
    assert.deepEqual(result, { version: '1.2.4', state, action: 'already-submitted' });
    assert.equal(h.runs.length, 0);
    assert.equal(h.calls[1].url, next);
    assert.equal(h.calls[2].url, `${endpoint}11/`);
    assert.match(formatFirefoxSummary(result), /No submission was repeated/);
  }
});

test('Firefox does not skip incomplete, disabled, unlisted, or malformed existing submissions', async () => {
  for (const value of [
    detail({ source: null }), detail({ source: undefined }), detail({ source: 'not a URL' }), detail({ source: 'http://example.com/source.zip' }),
    detail({ is_disabled: true }), detail({ is_disabled: undefined }), detail({ file: { status: 'disabled' } }),
    detail({ file: { status: 'future-status' } }), detail({ id: 99 }), detail({ version: '1.2.3' }), detail({ channel: 'unlisted' })
  ]) {
    const h = harness([page([item('1.2.4')]), value]);
    await assert.rejects(h.run, /Inspect the AMO version dashboard/);
    assert.equal(h.runs.length, 0);
  }
  const h = harness([page([item('1.2.4', { channel: 'unlisted' })])]);
  await assert.rejects(h.run, /another AMO channel/);
  assert.equal(h.calls.length, 1);
  assert.equal(h.runs.length, 0);
});

test('Firefox blocks newer listed releases even when this version already exists', async () => {
  for (const newer of ['1.2.5', '1.3', '2.0.0', '1.2.4.1']) {
    const h = harness([page([item('1.2.4'), item(newer, { id: 11 })])]);
    await assert.rejects(h.run, /newer listed version/);
    assert.equal(h.runs.length, 0);
  }
  const unknown = harness([page([item('2.0beta1')])]);
  await assert.rejects(unknown.run, /cannot be safely compared/);
  assert.equal(unknown.runs.length, 0);
});

test('AMO pagination cannot redirect authentication to another host or endpoint', async () => {
  for (const next of [
    'https://example.com/steal', `${endpoint}?page=2`,
    'https://addons.mozilla.org/api/v5/accounts/profile/?filter=all_with_unlisted',
    `${endpoint.replace('https://', 'http://')}?filter=all_with_unlisted`,
    `${endpoint.replace('https://', 'https://user:password@')}?filter=all_with_unlisted`,
    `${endpoint}?filter=all_with_unlisted#fragment`, `${endpoint}?filter=all_with_unlisted&filter=public`,
    `${endpoint.replace('versions/', 'versions%ZZ/')}?filter=all_with_unlisted`, ''
  ]) {
    const h = harness([page([], { count: 1, next })]);
    await assert.rejects(h.run, /pagination URL/);
    assert.equal(h.calls.length, 1);
    assert.equal(h.runs.length, 0);
  }
});

test('AMO repeated, truncated, changing, and malformed history cannot authorize a submission', async () => {
  const next = `${endpoint}?filter=all_with_unlisted&page=2`;
  const initial = `${endpoint}?filter=all_with_unlisted&page_size=50`;
  for (const responses of [
    [page([], { count: 1 })], [page([item()], { count: 0 })], [page([], { next: initial })],
    [page([item()], { count: 2, next }), page([item()], { count: 2 })],
    [page([item()], { count: 2, next }), page([], { count: 1 })],
    [page([], { next: undefined })], [null], [{ count: 0, next: null }],
    [page([item('1.2.3', { channel: 'unknown' })])]
  ]) {
    const h = harness(responses);
    await assert.rejects(h.run, /Inspect the AMO version dashboard/);
    assert.equal(h.runs.length, 0);
  }
  const limit = harness([page([], { count: 1, next })], { maxPages: 1 });
  await assert.rejects(limit.run, /exceeded its limit/);
  assert.equal(limit.runs.length, 0);
});

test('AMO preflight retries transient reads without leaking response bodies', async () => {
  const h = harness([new Response('private details', { status: 503 }), page()]);
  assert.equal((await h.run()).action, 'submitted');
  assert.equal(h.calls.length, 2);
  assert.equal(h.waits.length, 1);
  assert.notEqual(h.calls[0].headers.Authorization, h.calls[1].headers.Authorization);
  for (const failure of [401, 403, 404, 429, 500]) {
    const blocked = harness([new Response('secret response', { status: failure }), new Response('secret response', { status: failure })]);
    await assert.rejects(blocked.run, error => /HTTP/.test(error.message) && !error.message.includes('secret response'));
    assert.equal(blocked.runs.length, 0);
    assert.equal(blocked.calls.length, [429, 500].includes(failure) ? 2 : 1);
  }
});

test('AMO network errors and invalid JSON fail before running web-ext', async () => {
  for (const responses of [[new Error('sensitive failure'), new Error('sensitive failure')], [new Response('sensitive invalid JSON')]]) {
    const h = harness(responses);
    await assert.rejects(h.run, error => /No submission was attempted/.test(error.message) && !error.message.includes('sensitive'));
    assert.equal(h.runs.length, 0);
  }
});

test('Firefox missing local inputs and mismatched manifest stop before network access', async () => {
  for (const overrides of [
    { readFileImpl: async () => { throw new Error('private filename'); } },
    { statImpl: async () => ({ isFile: () => false }) },
    { readFileImpl: async () => 'null' },
    { readFileImpl: async () => JSON.stringify({ ...manifest, version: '1.2.3' }) },
    { readFileImpl: async () => JSON.stringify({ ...manifest, browser_specific_settings: {} }) }
  ]) {
    const h = harness([], overrides);
    await assert.rejects(h.run, /release artifacts|does not match/);
    assert.equal(h.calls.length, 0);
    assert.equal(h.runs.length, 0);
  }
});

test('Firefox never retries a possibly accepted web-ext submission or prints its output', async () => {
  let attempts = 0;
  const h = harness([page()], { runWebExt: () => { attempts++; throw new Error('credential-sensitive subprocess output'); } });
  await assert.rejects(h.run, error => /may already have been created/.test(error.message) && !error.message.includes('credential-sensitive'));
  assert.equal(attempts, 1);
  assert.equal(h.calls.length, 1);
});
