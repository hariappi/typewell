import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import '../extension/shared/catalog.js';
import '../extension/shared/model.js';
const T = globalThis.Typewell;
const profile = fontId => ({ ...T.defaultProfile(), fontId });

test('a fresh installation does not change website fonts', () => {
  assert.equal(T.resolveProfile(T.defaultSettings(), 'example.com'), null);
});
test('site rules beat global defaults and survive global changes', () => {
  let state = T.applyOperation(null, { type: 'saveGlobal', profile: profile('inter') });
  state = T.applyOperation(state, { type: 'saveSite', host: 'example.com', profile: profile('lora') });
  state = T.applyOperation(state, { type: 'saveGlobal', profile: profile('lexend') });
  assert.equal(T.resolveProfile(state, 'example.com').fontId, 'lora');
  assert.equal(T.resolveProfile(state, 'elsewhere.com').fontId, 'lexend');
});
test('excluded sites keep their original fonts even with a global default', () => {
  let state = T.applyOperation(null, { type: 'saveGlobal', profile: profile('inter') });
  state = T.applyOperation(state, { type: 'skipSite', host: 'example.com' });
  assert.equal(T.resolveProfile(state, 'example.com'), null);
  state = T.applyOperation(state, { type: 'removeSite', host: 'example.com' });
  assert.equal(T.resolveProfile(state, 'example.com').fontId, 'inter');
});
test('pausing restores pages without discarding saved preferences', () => {
  let state = T.applyOperation(null, { type: 'saveSite', host: 'example.com', profile: profile('lora') });
  state = T.applyOperation(state, { type: 'enabled', enabled: false });
  assert.equal(T.resolveProfile(state, 'example.com'), null);
  assert.equal(state.sites['example.com'].profile.fontId, 'lora');
  state = T.applyOperation(state, { type: 'enabled', enabled: true });
  assert.equal(T.resolveProfile(state, 'example.com').fontId, 'lora');
});
test('appearance theme is saved safely and older backups use the system theme', () => {
  assert.equal(T.defaultSettings().theme, 'system');
  assert.equal(T.applyOperation(null, { type: 'theme', theme: 'dark' }).theme, 'dark');
  assert.equal(T.applyOperation(null, { type: 'theme', theme: 'unknown' }).theme, 'system');
  const olderBackup = T.defaultSettings();
  delete olderBackup.theme;
  assert.equal(T.validateImport(olderBackup).theme, 'system');
  assert.throws(() => T.validateImport({ ...T.defaultSettings(), theme: 'neon' }));
});
test('rules are exact host matches across ports, schemes and paths', () => {
  const state = T.applyOperation(null, { type: 'saveSite', host: 'example.com', profile: profile('lora') });
  assert.equal(T.hostname('http://EXAMPLE.com:8080/story?q=test'), 'example.com');
  assert.equal(T.resolveProfile(state, 'www.example.com'), null);
  assert.equal(T.resolveProfile(state, 'notexample.com'), null);
});
test('internal pages and non-web schemes are not supported hosts', () => {
  for (const url of ['about:blank', 'file:///tmp/a.html', 'data:text/html,test', 'javascript:alert(1)', 'not a URL']) assert.equal(T.hostname(url), null);
});
test('Notion document hosts allow editable page text without matching lookalike domains', () => {
  for (const host of ['notion.so', 'www.notion.so', 'workspace.notion.so', 'notion.site', 'notes.notion.site']) {
    assert.equal(T.stylesEditableContent(host), true, host);
  }
  for (const host of ['evilnotion.so', 'notion.so.example.com', 'notion.com', 'example.com', null]) {
    assert.equal(T.stylesEditableContent(host), false, String(host));
  }
});
test('invalid hostnames cannot become storage keys', () => {
  for (const host of ['__proto__', 'constructor', 'prototype', 'a.com/path', 'https://a.com', 'a.com@evil.com', '', 'EXAMPLE.COM']) {
    assert.equal(T.validHost(host), false, host);
    assert.throws(() => T.applyOperation(null, { type: 'saveSite', host, profile: profile('inter') }));
  }
  assert.equal(T.validHost('localhost'), true);
  assert.equal(T.validHost('[::1]'), true);
});
test('font names and CSS values cannot inject arbitrary CSS', () => {
  assert.equal(T.localFontName('Aptos Display'), true);
  for (const value of ['a; color:red', 'a\nbody{}', 'url(https://evil.com)', '";} * {display:none', '', '   ']) assert.equal(T.localFontName(value), false);
  const safe = T.normalizeProfile({ fontId: 'custom', customFont: 'bad; color:red', scale: 'url(https://evil.com)' });
  assert.equal(safe.fontId, 'inter');
  assert.equal(safe.scale, 100);
  assert.equal(T.engineCSS(safe).includes('evil.com'), false);
});
test('size and spacing are bounded; ordinary formatting stays untouched by default', () => {
  const safe = T.normalizeProfile({ scale: 10000, lineHeight: 0.4, letterSpacing: -10, wordSpacing: Infinity });
  assert.equal(safe.scale, 175);
  assert.equal(safe.lineHeight, 1);
  assert.equal(safe.letterSpacing, 0);
  assert.equal(safe.wordSpacing, 0);
  const textRule = T.engineCSS(T.defaultProfile()).split('}')[0];
  for (const property of ['font-size:', 'font-weight:', 'font-style:', 'line-height:', 'letter-spacing:', 'word-spacing:']) assert.equal(textRule.includes(property), false);
});
test('import round trips valid preferences without sharing object references', () => {
  let state = T.applyOperation(null, { type: 'saveGlobal', profile: profile('inter') });
  state = T.applyOperation(state, { type: 'skipSite', host: 'example.com' });
  state = T.applyOperation(state, { type: 'favorite', fontId: 'lora', favorite: true });
  const copy = T.validateImport(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(copy, state);
  assert.notEqual(copy.sites, state.sites);
});
test('import rejects malformed and newer-version backups rather than partially applying them', () => {
  for (const input of [null, [], {}, { ...T.defaultSettings(), version: 2 }, { ...T.defaultSettings(), sites: [] }, { ...T.defaultSettings(), favorites: ['unknown'] }]) assert.throws(() => T.validateImport(input));
  assert.throws(() => T.validateImport({ ...T.defaultSettings(), global: { ...profile('inter'), scale: 500 } }));
  assert.throws(() => T.validateImport(JSON.parse('{"version":1,"enabled":true,"global":null,"favorites":[],"sites":{"__proto__":{"disabled":true}}}')));
});
test('favorites are deduplicated and clearing global retains site choices', () => {
  let state = T.applyOperation(null, { type: 'favorite', fontId: 'inter', favorite: true });
  state = T.applyOperation(state, { type: 'favorite', fontId: 'inter', favorite: true });
  assert.deepEqual(state.favorites, ['inter']);
  state = T.applyOperation(state, { type: 'saveSite', host: 'example.com', profile: profile('lora') });
  state = T.applyOperation(state, { type: 'clearGlobal' });
  assert.equal(T.resolveProfile(state, 'example.com').fontId, 'lora');
});
test('every bundled font has its declared binary, checksum and license', async () => {
  assert.equal(new Set(T.fonts.map(font => font.id)).size, T.fonts.length);
  const sources = JSON.parse(await readFile(new URL('../extension/fonts/sources.json', import.meta.url), 'utf8'));
  for (const font of T.fonts.filter(font => font.bundled)) {
    const bytes = await readFile(new URL(`../extension/${font.file}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2', font.id);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sources[font.id].sha256, font.id);
    assert.ok((await readFile(new URL(`../extension/fonts/${sources[font.id].license}`, import.meta.url))).length > 100, font.id);
  }
});
