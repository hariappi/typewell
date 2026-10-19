import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const compat = await readFile(new URL('../extension/shared/compat.js', import.meta.url), 'utf8');
const theme = await readFile(new URL('../extension/ui/theme.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

function themePage(namespace, duringRead) {
  let resolveRead, rejectRead, onChanged;
  const initialRead = new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
  const root = { dataset: {}, removeAttribute(name) { assert.equal(name, 'data-theme'); delete this.dataset.theme; } };
  const api = {
    runtime: {},
    storage: {
      local: { get: key => { assert.equal(key, 'settings'); duringRead?.(onChanged); return initialRead; } },
      onChanged: { addListener: listener => { onChanged = listener; } }
    }
  };
  const context = { [namespace]: api, document: { documentElement: root } };
  runInNewContext(`${compat}\n${theme}`, context);
  return {
    selected: () => root.dataset.theme ?? 'system',
    hasAttribute: () => Object.hasOwn(root.dataset, 'theme'),
    resolve: value => resolveRead({ settings: value === undefined ? undefined : { theme: value } }),
    reject: () => rejectRead(new Error('Initial storage read failed')),
    event: (changes, area = 'local') => onChanged(changes, area),
    change: value => onChanged({ settings: { newValue: value === undefined ? undefined : { theme: value } } }, 'local')
  };
}

for (const namespace of ['browser', 'chrome']) {
  test(`${namespace} theme loads saved choices and uses system for absent or invalid settings`, async () => {
    for (const value of ['light', 'dark', 'system', undefined, 'unknown']) {
      const page = themePage(namespace);
      page.resolve(value);
      await flush();
      assert.equal(page.selected(), ['light', 'dark'].includes(value) ? value : 'system');
      assert.equal(page.hasAttribute(), ['light', 'dark'].includes(value));
    }
  });

  test(`${namespace} latest theme change survives an older initial read resolving`, async () => {
    for (const [newTheme, oldTheme] of [['dark', 'system'], ['light', 'dark'], ['system', 'dark']]) {
      const page = themePage(namespace);
      page.change(newTheme);
      assert.equal(page.selected(), newTheme);
      page.resolve(oldTheme);
      await flush();
      assert.equal(page.selected(), newTheme);
    }
  });

  test(`${namespace} latest theme change survives an older initial read failing`, async () => {
    const page = themePage(namespace);
    page.change('dark');
    page.reject();
    await flush();
    assert.equal(page.selected(), 'dark');
  });

  test(`${namespace} theme still falls back to system when the initial read fails alone`, async () => {
    const page = themePage(namespace);
    page.reject();
    await flush();
    assert.equal(page.selected(), 'system');
    assert.equal(page.hasAttribute(), false);
  });

  test(`${namespace} unrelated storage events do not discard the saved theme`, async () => {
    const page = themePage(namespace);
    page.event({ unrelated: { newValue: true } });
    page.event({ settings: { newValue: { theme: 'dark' } } }, 'sync');
    page.resolve('light');
    await flush();
    assert.equal(page.selected(), 'light');
  });

  test(`${namespace} subsequent choices and settings deletion update the open page`, async () => {
    const page = themePage(namespace);
    page.resolve('dark');
    await flush();
    for (const value of ['light', 'dark', 'system', 'dark', undefined]) {
      page.change(value);
      assert.equal(page.selected(), value ?? 'system');
    }
    assert.equal(page.hasAttribute(), false);
  });

  test(`${namespace} observes a change arriving as the initial read starts`, async () => {
    const page = themePage(namespace, listener => {
      assert.equal(typeof listener, 'function');
      listener({ settings: { newValue: { theme: 'dark' } } }, 'local');
    });
    page.resolve('light');
    await flush();
    assert.equal(page.selected(), 'dark');
  });
}
