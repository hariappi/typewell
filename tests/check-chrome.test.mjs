import assert from 'node:assert/strict';
import test from 'node:test';
import { checkChrome, formatChromeCheckSummary, readChromeCheckConfiguration } from '../scripts/check-chrome.mjs';

// Synthetic identifiers for mocked requests; do not use real account metadata.
const env = {
  CWS_PUBLISHER_ID: 'test-publisher',
  CWS_EXTENSION_ID: 'abcdefghijklmnopabcdefghijklmnop',
  CWS_ACCESS_TOKEN: 'secret-token-not-for-output'
};
const name = `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`;
const identity = { name, itemId: env.CWS_EXTENSION_ID };
const status = extra => ({ ...identity, ...extra });
const revision = (state, version) => ({ state, distributionChannels: [{ crxVersion: version }] });

function harness(responses, overrides = {}) {
  const calls = [], waits = [];
  return {
    calls, waits,
    run: () => checkChrome({
      env,
      fetchImpl: async (url, options) => {
        calls.push({ url, ...options });
        assert.ok(responses.length, 'Unexpected request');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response instanceof Response ? response : new Response(JSON.stringify(response));
      },
      wait: async ms => waits.push(ms),
      ...overrides
    })
  };
}

test('Chrome check uses only the exact status GET and needs no release configuration', async () => {
  const h = harness([status({
    publicKey: 'public-key-not-for-output',
    publishedItemRevisionStatus: revision('PUBLISHED', '1.2.3'),
    submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.2.4'),
    lastAsyncUploadState: 'SUCCEEDED', warned: true, takenDown: false,
    untrusted: env.CWS_ACCESS_TOKEN
  })]);
  const result = await h.run();
  assert.deepEqual(result, {
    published: { state: 'PUBLISHED', versions: ['1.2.3'] },
    submitted: { state: 'PENDING_REVIEW', versions: ['1.2.4'] },
    draftOrUnsubmitted: false, warned: true, takenDown: false, lastUploadState: 'SUCCEEDED'
  });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, `https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`);
  assert.equal(h.calls[0].method, 'GET');
  assert.equal(h.calls[0].body, undefined);
  assert.equal(h.calls[0].redirect, 'error');
  assert.ok(h.calls[0].signal instanceof AbortSignal);
  assert.equal(h.calls[0].headers.Authorization, `Bearer ${env.CWS_ACCESS_TOKEN}`);
  const summary = formatChromeCheckSummary(result);
  assert.match(summary, /PUBLISHED \(1.2.3\)/);
  assert.match(summary, /PENDING_REVIEW \(1.2.4\)/);
  assert.match(summary, /Store warning: yes/);
  assert.doesNotMatch(JSON.stringify(result) + summary, /secret-token|public-key|untrusted/);
});

test('Chrome check explains draft/unsubmitted state without claiming publication', async () => {
  const h = harness([status({ takenDown: true })]);
  const result = await h.run();
  assert.equal(result.draftOrUnsubmitted, true);
  assert.equal(result.warned, false);
  const summary = formatChromeCheckSummary(result);
  assert.match(summary, /draft or unsubmitted/);
  assert.match(summary, /Taken down: yes/);
  assert.doesNotMatch(summary, /PUBLISHED/);
});

test('Chrome check validates identifiers and token without echoing invalid values', () => {
  for (const [field, value] of [
    ['CWS_PUBLISHER_ID', '../secret-token'], ['CWS_PUBLISHER_ID', ''],
    ['CWS_EXTENSION_ID', 'z'.repeat(32)], ['CWS_EXTENSION_ID', 'abc'],
    ['CWS_ACCESS_TOKEN', ''], ['CWS_ACCESS_TOKEN', 'secret-token\nextra']
  ]) {
    assert.throws(() => readChromeCheckConfiguration({ ...env, [field]: value }), error => !/secret-token/.test(error.message));
  }
  assert.equal(readChromeCheckConfiguration(env).extensionId, env.CWS_EXTENSION_ID);
});

test('Chrome check rejects malformed data and mismatched identities without exposing bodies', async () => {
  for (const response of [
    null, {}, { ...identity, name: 'secret-token' }, { ...identity, itemId: 'a'.repeat(32) },
    status({ submittedItemRevisionStatus: revision('secret-token', '1.2.3') }),
    status({ publishedItemRevisionStatus: revision('PUBLISHED', 'secret-token') }),
    status({ publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [] } }),
    status({ warned: 'secret-token' }), status({ takenDown: 'secret-token' }),
    status({ lastAsyncUploadState: 'secret-token' })
  ]) {
    const h = harness([response]);
    await assert.rejects(h.run, error => !/secret-token/.test(error.message));
    assert.equal(h.calls.length, 1);
  }
});

test('Chrome check sanitizes authorization and JSON failures without retrying them', async () => {
  for (const response of [new Response(env.CWS_ACCESS_TOKEN, { status: 401 }), new Response(env.CWS_ACCESS_TOKEN, { status: 403 }), new Response(env.CWS_ACCESS_TOKEN)]) {
    const h = harness([response]);
    await assert.rejects(h.run, error => /HTTP 40[13]|invalid JSON/.test(error.message) && !error.message.includes(env.CWS_ACCESS_TOKEN));
    assert.equal(h.calls.length, 1);
  }
});

test('Chrome check retries only reads and stops after three transient failures', async () => {
  const retry = harness([new Response('', { status: 429 }), new Response('', { status: 503 }), status()]);
  assert.equal((await retry.run()).draftOrUnsubmitted, true);
  assert.equal(retry.waits.length, 2);
  assert.ok(retry.calls.every(call => call.method === 'GET' && call.body === undefined));
  const failed = harness([new Error(env.CWS_ACCESS_TOKEN), new Error(env.CWS_ACCESS_TOKEN), new Error(env.CWS_ACCESS_TOKEN)]);
  await assert.rejects(failed.run, error => /failed or timed out/.test(error.message) && !error.message.includes(env.CWS_ACCESS_TOKEN));
  assert.equal(failed.calls.length, 3);
  assert.equal(failed.waits.length, 2);
});

test('Chrome check enforces bounded timeout and retry configuration', async () => {
  for (const options of [{ maxGetAttempts: 4 }, { maxGetAttempts: 0 }, { requestTimeoutMs: 0 }, { requestTimeoutMs: 60_001 }, { retryDelayMs: 5001 }]) {
    const h = harness([], options);
    await assert.rejects(h.run, /bounded limits/);
    assert.equal(h.calls.length, 0);
  }
});
