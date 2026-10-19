import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = name => readFile(new URL(`../extension/${name}`, import.meta.url), 'utf8');
const compat = await source('shared/compat.js');
const background = (await Promise.all(['shared/catalog.js', 'shared/model.js', 'background.js'].map(source))).join('\n');
const uiSender = { id: 'typewell-test', url: 'chrome-extension://typewell-test/options/options.html' };

// A callback-only message receiver reproduces Chrome before promise listener support.
// Storage can be shared by multiple worker instances to simulate worker restarts.
function worker(storage = {}, nativeFirefox = false) {
  let listener;
  const styles = [];
  const api = {
    runtime: {
      id: uiSender.id,
      getURL: path => `chrome-extension://${uiSender.id}/${path}`,
      onMessage: { addListener: value => { listener = value; } },
      onConnect: { addListener() {} },
      sendMessage: message => dispatch(message, uiSender).promise
    },
    storage: { local: {
      get: async key => ({ [key]: structuredClone(storage[key]) }),
      set: async value => { Object.assign(storage, structuredClone(value)); }
    } },
    scripting: {
      insertCSS: async value => styles.push({ action: 'insert', ...value }),
      removeCSS: async value => styles.push({ action: 'remove', ...value })
    },
    tabs: { sendMessage: async () => ({ ok: true }) }
  };
  const context = { [nativeFirefox ? 'browser' : 'chrome']: api, URL, crypto: { randomUUID } };
  runInNewContext(compat, context);
  const T = context.Typewell;
  const dispatch = (message, sender) => {
    let respond;
    const promise = new Promise(resolve => { respond = resolve; });
    const accepted = listener(message, sender, respond);
    if (!accepted) respond(undefined);
    return { accepted, promise };
  };
  return { T, api, storage, styles, context, dispatch, start: () => runInNewContext(background, context) };
}

test('callback messaging keeps asynchronous responses open in both browser namespaces', async () => {
  for (const firefox of [false, true]) {
    const { T, api, dispatch } = worker({}, firefox);
    assert.equal(T.api, api);
    T.listenMessages(message => message.type === 'known' ? Promise.resolve({ ok: true }) : undefined);
    const response = dispatch({ type: 'known' }, uiSender);
    assert.equal(response.accepted, true);
    assert.equal((await response.promise).ok, true);
    assert.equal(dispatch({ type: 'unrelated' }, uiSender).accepted, false);
  }
});

test('message failures reach callers, and reinjection keeps the original API helpers', async () => {
  const { T, context } = worker();
  T.listenMessages(message => {
    if (message.type === 'sync') throw new Error('Invalid operation');
    return Promise.reject(new Error('Storage unavailable'));
  });
  await assert.rejects(T.sendMessage({ type: 'sync' }), /Invalid operation/);
  await assert.rejects(T.sendMessage({ type: 'async' }), /Storage unavailable/);
  const send = T.sendMessage;
  runInNewContext(compat, context);
  assert.equal(T.sendMessage, send);
});

test('worker serializes concurrent settings changes and recovers after a rejected update', async () => {
  const first = worker();
  first.start();
  await Promise.all([
    first.T.sendMessage({ type: 'UPDATE', operation: { type: 'favorite', fontId: 'lora', favorite: true } }),
    first.T.sendMessage({ type: 'UPDATE', operation: { type: 'theme', theme: 'dark' } })
  ]);
  await assert.rejects(first.T.sendMessage({ type: 'UPDATE', operation: { type: 'unknown' } }));
  const settings = await first.T.sendMessage({ type: 'UPDATE', operation: { type: 'enabled', enabled: false } });
  assert.equal(settings.favorites.includes('lora'), true);
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.enabled, false);

  const restarted = worker(first.storage);
  restarted.start();
  const restored = await restarted.T.sendMessage({ type: 'GET_SETTINGS' });
  assert.equal(restored.favorites.includes('lora'), true);
  assert.equal(restored.theme, 'dark');
  assert.equal(restored.enabled, false);
});

test('worker accepts website styling in its sender frame and restricts settings writes to extension UI', async () => {
  const { T, dispatch, styles, start } = worker();
  start();
  const website = { id: uiSender.id, url: 'https://example.com/', tab: { id: 7, url: 'https://example.com/' }, frameId: 2 };
  const result = dispatch({ type: 'STYLE', profile: T.defaultProfile() }, website);
  assert.equal((await result.promise).ok, true);
  assert.equal(styles.length, 1);
  assert.equal(styles[0].origin, 'USER');
  assert.equal(styles[0].target.tabId, 7);
  assert.equal(styles[0].target.frameIds[0], 2);
  assert.equal(dispatch({ type: 'UPDATE', operation: { type: 'enabled', enabled: false } }, website).accepted, false);
  assert.equal(dispatch({ type: 'CONTEXT' }, { ...website, id: 'another-extension' }).accepted, false);
});
