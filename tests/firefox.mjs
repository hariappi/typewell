import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const root = new URL('../', import.meta.url);
const extensionVersion = JSON.parse(await readFile(new URL('extension/manifest.json', root), 'utf8')).version;
const results = new URL('test-results/', root);
await mkdir(results, { recursive: true });
const addonId = 'typewell@font-changer.local';
const uuid = '188658a3-1d21-45de-8b98-21baf0109084';
const extensionURL = `moz-extension://${uuid}`;
const darkMode = process.env.TYPEWELL_TEST_DARK === '1';
const server = createServer(async (request, response) => {
  const html = await readFile(new URL(request.url === '/frame' ? 'fixtures/frame.html' : 'fixtures/article.html', import.meta.url), 'utf8');
  response.writeHead(200, { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; frame-src http://localhost:*; script-src 'self'" });
  response.end(html.replaceAll('{{PORT}}', server.address().port));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/article`;
const notionURL = `http://www.notion.so:${server.address().port}/article`;
const prefs = {
  'extensions.webextensions.uuids': JSON.stringify({ [addonId]: uuid }),
  'browser.shell.checkDefaultBrowser': false,
  'browser.startup.homepage_override.mstone': 'ignore',
  'datareporting.policy.dataSubmissionEnabled': false,
  'toolkit.telemetry.reportingpolicy.firstRun': false,
  'network.dns.localDomains': 'www.notion.so',
  'network.stricttransportsecurity.preloadlist': false,
  'ui.systemUsesDarkTheme': darkMode ? 1 : 0,
  'browser.download.dir': fileURLToPath(results),
  'browser.download.folderList': 2,
  'browser.helperApps.neverAsk.saveToDisk': 'application/json'
};
const options = new firefox.Options().addArguments('-headless');
const binary = process.env.FIREFOX_BINARY || (process.platform === 'darwin' ? '/Applications/Firefox.app/Contents/MacOS/firefox' : null);
if (binary) options.setBinary(binary);
for (const [key, value] of Object.entries(prefs)) options.setPreference(key, value);
const temporaryDriver = '/private/tmp/typewell-test-tools/geckodriver';
const service = new firefox.ServiceBuilder(process.env.GECKODRIVER || (existsSync(temporaryDriver) ? temporaryDriver : undefined))
  .addArguments('--allow-system-access', '--profile-root', process.platform === 'darwin' ? '/private/tmp' : tmpdir());
let testProfileDirectory = null;
// macOS 27 requires LaunchServices for Firefox's app-data access (Mozilla bug 2060476).
// The explicit, newly created profile keeps this launch separate from the user's Firefox.
if (process.platform === 'darwin' && !process.env.FIREFOX_DIRECT_LAUNCH) {
  const portProbe = createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const marionettePort = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  testProfileDirectory = await mkdtemp('/private/tmp/typewell-firefox-');
  await writeFile(`${testProfileDirectory}/user.js`, Object.entries({ ...prefs, 'marionette.port': marionettePort, 'marionette.enabled': true })
    .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));
  execFileSync('/usr/bin/open', ['-n', '-a', process.env.FIREFOX_APP || '/Applications/Firefox.app', '--args',
    '-headless', '-no-remote', '--marionette', '--remote-allow-system-access', '-profile', testProfileDirectory]);
  service.addArguments('--connect-existing', '--marionette-port', String(marionettePort));
}
let driver, page, preferences, activeCheck = 'Firefox setup';
const checks = [];
const check = (name, fn) => (async () => { activeCheck = name; await fn(); checks.push(name); console.log(`PASS ${name}`); })();
const profile = fontId => ({ fontId, customFont: '', scale: 100, lineHeight: 0, letterSpacing: 0, wordSpacing: 0, preserveCode: true, target: 'all' });
async function change(operation) {
  await driver.switchTo().window(preferences);
  const result = await driver.executeAsyncScript(`const done=arguments[arguments.length-1]; browser.runtime.sendMessage({type:'UPDATE', operation:arguments[0]}).then(settings=>done({settings}), error=>done({error:error.message}));`, operation);
  if (result.error) throw new Error(result.error);
  await driver.switchTo().window(page);
  return result.settings;
}
async function fontIs(id, family) {
  await driver.wait(async () => (await driver.executeScript('return getComputedStyle(document.getElementById(arguments[0])).fontFamily', id)).includes(family), 12000, `${id} should use ${family}`);
}
async function metrics(id, pseudo = null) {
  return driver.executeScript(`const element=document.getElementById(arguments[0]), css=getComputedStyle(element,arguments[1]); return {family:css.fontFamily,size:css.fontSize,weight:css.fontWeight,style:css.fontStyle,line:css.lineHeight,letter:css.letterSpacing};`, id, pseudo);
}
// Observe the test profile only. These listeners never apply a theme or write settings.
async function traceThemeChanges() {
  await driver.executeScript(`
    const trace = window.__typewellTestThemeTrace = { startedAt: Date.now(), events: [] };
    const record = (type, details = {}) => {
      trace.events.push({ elapsedMs: Date.now() - trace.startedAt, type, themeAttribute: document.documentElement.getAttribute('data-theme'), ...details });
      if (trace.events.length > 50) trace.events.shift();
    };
    record('trace-start', { themeApi: typeof window.TypewellTheme?.apply });
    new MutationObserver(records => records.forEach(recordValue => record('theme-attribute', { oldValue: recordValue.oldValue })))
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'], attributeOldValue: true });
    browser.storage.onChanged.addListener((changes, area) => {
      if (changes.settings) record('storage-changed', { area, oldTheme: changes.settings.oldValue?.theme ?? null, newTheme: changes.settings.newValue?.theme ?? null });
    });
    window.addEventListener('error', event => record('script-error', { message: event.message, filename: event.filename, line: event.lineno }));
    window.addEventListener('unhandledrejection', event => record('unhandled-rejection', { message: String(event.reason?.message || event.reason) }));
  `);
}

async function captureThemeState() {
  return driver.executeAsyncScript(`const done = arguments[arguments.length - 1];
    const read = operation => Promise.race([
      Promise.resolve().then(operation).then(value => ({ value }), error => ({ error: error.message })),
      new Promise(resolve => setTimeout(() => resolve({ error: 'Diagnostic read timed out after 2000 ms' }), 2000))
    ]);
    const root = document.documentElement;
    const state = {
      url: location.href, readyState: document.readyState, userAgent: navigator.userAgent,
      themeApi: typeof window.TypewellTheme?.apply,
      themeAttribute: root.getAttribute('data-theme'), colorScheme: getComputedStyle(root).colorScheme,
      backgroundColor: document.body ? getComputedStyle(document.body).backgroundColor : null,
      systemDark: matchMedia('(prefers-color-scheme: dark)').matches,
      choices: [...document.querySelectorAll('[data-theme-choice]')].map(button => ({ theme: button.dataset.themeChoice, pressed: button.getAttribute('aria-pressed') })),
      message: document.getElementById('message')?.textContent ?? null,
      scripts: [...document.scripts].map(script => script.src),
      trace: window.__typewellTestThemeTrace ?? null
    };
    Promise.all([
      read(() => browser.storage.local.get('settings').then(value => value.settings?.theme ?? null)),
      read(() => browser.runtime.sendMessage({ type: 'GET_SETTINGS' }).then(value => value?.theme ?? null))
    ]).then(([storageTheme, backgroundTheme]) => done({ ...state, storageTheme, backgroundTheme }), error => done({ ...state, diagnosticError: error.message }));
  `);
}
// Firefox's normal switchTo.frame does not enter a remote extension popup.
// Use its existing WebDriver actor in this isolated test session to exercise that document.
async function popupEval(script, args = []) {
  const result = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];
    const browser=document.querySelector('browser.webextension-popup-browser:not(.webextension-preload-browser)');
    if(!browser) return done({error:'Popup is closed'});
    browser.browsingContext.currentWindowGlobal.getActor('MarionetteCommands').executeScript(arguments[0],arguments[1],{})
      .then(value=>done({value}),error=>done({error:error.message}));`, script, args);
  if (result.error) throw new Error(result.error);
  return result.value;
}
async function pageEval(script) {
  const result = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];
    window.gBrowser.selectedBrowser.browsingContext.currentWindowGlobal.getActor('MarionetteCommands').executeScript(arguments[0],[],{})
      .then(value=>done({value}),error=>done({error:error.message}));`, script);
  if (result.error) throw new Error(result.error);
  return result.value;
}
try {
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
  await driver.manage().window().setRect({ width: 1260, height: 1000 });
  await driver.installAddon(fileURLToPath(new URL('extension/', root)), true);
  await driver.get(url); page = await driver.getWindowHandle();
  await driver.executeScript(`const host=document.createElement('div');host.id='shadow-host';document.querySelector('main').append(host);const root=host.attachShadow({mode:'open'});root.innerHTML='<p id="shadow-text" style="font-family:Georgia;font-size:17px">Text in an open shadow root</p>';`);
  const initial = await metrics('body-text');
  const heading = await metrics('heading');
  const code = await metrics('code');
  const icon = await metrics('icon');
  const unknownIcon = await metrics('unknown-icon');
  const pseudo = await metrics('pseudo', '::before');
  const editor = await metrics('editor');
  const githubCodeIds = ['github-line-number', 'github-line', 'github-keyword', 'github-legacy-number', 'github-legacy-code', 'github-legacy-token'];
  const githubOriginal = Object.fromEntries(await Promise.all(githubCodeIds.map(async id => [id, await metrics(id)])));
  const githubColor = await driver.executeScript('return getComputedStyle(document.getElementById("github-keyword")).color');
  const googleIconIds = ['google-symbol', 'google-material-symbol', 'google-sans-symbol', 'google-class-symbol'];
  const googleIcons = Object.fromEntries(await Promise.all(googleIconIds.map(async id => [id, await metrics(id)])));
  const googlePseudos = await Promise.all([['google-pseudo', '::before'], ['empty-pseudo', '::before'], ['empty-pseudo', '::after']]
    .map(async ([id, pseudo]) => ({ id, pseudo, original: await metrics(id, pseudo) })));
  await driver.switchTo().newWindow('tab'); preferences = await driver.getWindowHandle();
  await driver.get(`${extensionURL}/options/options.html`);
  await driver.wait(until.elementLocated(By.id('enabled')), 5000);
  await traceThemeChanges();
  console.log('Firefox', (await driver.getCapabilities()).get('browserVersion'));
  console.log('Permissions', await driver.executeAsyncScript(`const done=arguments[arguments.length-1];browser.permissions.getAll().then(done);`));
  await check('Firefox prevents private browsing access for this release', async () => {
    assert.equal(await driver.executeScript('return browser.runtime.getManifest().incognito'), 'not_allowed');
    const allowed = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];browser.extension.isAllowedIncognitoAccess().then(done);`);
    assert.equal(allowed, false);
  });
  await check('options page loads the real extension and all font assets', async () => {
    await driver.wait(async () => (await driver.findElement(By.id('total-fonts')).getText()) === '159', 5000);
    assert.equal(await driver.executeScript('return typeof browser.runtime.sendMessage'), 'function');
    assert.equal(await driver.findElement(By.id('extension-version')).getText(), `TYPEWELL · ${extensionVersion}`);
    const loaded = await driver.executeAsyncScript(`const done=arguments[arguments.length-1]; Promise.all(Typewell.fonts.filter(f=>f.bundled).map(f=>document.fonts.load('16px "'+f.family+'"'))).then(results=>done(results.every(faces=>faces.length>0)),error=>done(error.message));`);
    assert.equal(loaded, true);
  });
  await check(`popup and preferences follow Firefox ${darkMode ? 'dark' : 'light'} mode`, async () => {
    assert.equal(await driver.executeScript('return matchMedia("(prefers-color-scheme: dark)").matches'), darkMode);
    assert.equal(await driver.executeScript('return getComputedStyle(document.documentElement).colorScheme'), darkMode ? 'dark' : 'light');
    assert.equal(await driver.executeScript('return getComputedStyle(document.body).backgroundColor'), darkMode ? 'rgb(20, 26, 23)' : 'rgb(248, 247, 243)');
  });
  await check('preferences can lock Typewell to light or dark appearance', async () => {
    const override = darkMode ? 'light' : 'dark';
    await driver.findElement(By.css(`[data-theme-choice="${override}"]`)).click();
    await driver.wait(async () => await driver.executeScript('return document.documentElement.dataset.theme') === override, 5000,
      `Preferences must apply data-theme="${override}" after the ${override} button is clicked; see failure-state.json for storage and theme-event evidence.`);
    assert.equal(await driver.executeScript('return getComputedStyle(document.documentElement).colorScheme'), override);
    assert.equal(await driver.executeScript('return getComputedStyle(document.body).backgroundColor'), override === 'dark' ? 'rgb(20, 26, 23)' : 'rgb(248, 247, 243)');
    assert.equal(await driver.findElement(By.css(`[data-theme-choice="${override}"]`)).getAttribute('aria-pressed'), 'true');
    await driver.findElement(By.css('[data-theme-choice="system"]')).click();
    await driver.wait(async () => await driver.executeScript('return !document.documentElement.hasAttribute("data-theme")'), 5000,
      'Preferences must remove data-theme after System is clicked; see failure-state.json for storage and theme-event evidence.');
  });
  await check('new installation leaves ordinary pages unchanged', async () => {
    await driver.switchTo().window(page);
    assert.deepEqual(await metrics('body-text'), initial);
    assert.equal(await driver.executeScript('return document.querySelectorAll("[data-typewell-text]").length'), 0);
  });
  await check('site font loads despite font-src none and overrides author !important', async () => {
    await change({ type: 'saveSite', host: '127.0.0.1', profile: profile('lora') });
    await fontIs('body-text', 'Typewell Lora');
    await fontIs('forced', 'Typewell Lora');
    assert.equal(await driver.executeScript('return document.fonts.check("16px \\\"Typewell Lora\\\"")'), true);
    assert.equal(await driver.executeScript('return [...document.fonts].some(f=>f.family === "Typewell Lora" && f.status === "loaded")'), true);
  });
  await check('headings, emphasis, code, editors, common icons and pseudo-icons retain formatting', async () => {
    const currentHeading = await metrics('heading');
    assert.equal(currentHeading.size, heading.size); assert.equal(currentHeading.weight, heading.weight);
    assert.equal((await metrics('emphasis')).style, 'italic');
    assert.deepEqual(await metrics('code'), code);
    assert.deepEqual(await metrics('icon'), icon);
    assert.deepEqual(await metrics('unknown-icon'), unknownIcon);
    assert.equal((await metrics('pseudo', '::before')).family, pseudo.family);
    assert.equal((await metrics('pseudo', '::before')).size, pseudo.size);
    assert.deepEqual(await metrics('editor'), editor);
  });
  await check('GitHub file lines, syntax tokens and line numbers retain their original code fonts', async () => {
    for (const id of githubCodeIds) assert.deepEqual(await metrics(id), githubOriginal[id], id);
    await fontIs('github-description', 'Typewell Lora');
    assert.equal(await driver.executeScript('return getComputedStyle(document.getElementById("github-keyword")).color'), githubColor);
  });
  await check('Google ligature icons retain their fonts while Google Sans labels change', async () => {
    for (const id of googleIconIds) assert.deepEqual(await metrics(id), googleIcons[id], id);
    await fontIs('google-copy', 'Typewell Lora');
    await fontIs('google-pseudo', 'Typewell Lora');
  });
  await check('Google generated icons survive on text labels and empty descendants', async () => {
    for (const { id, pseudo, original } of googlePseudos) {
      const current = await metrics(id, pseudo);
      assert.equal(current.family, original.family, `${id}${pseudo} font`);
      assert.equal(current.size, original.size, `${id}${pseudo} size`);
    }
  });
  await check('Notion document editors receive the selected font while other editors stay protected', async () => {
    await driver.switchTo().newWindow('tab');
    const notion = await driver.getWindowHandle();
    await driver.get(notionURL);
    await driver.switchTo().window(preferences);
    const result = await driver.executeAsyncScript(`const done=arguments[arguments.length-1]; browser.runtime.sendMessage({type:'UPDATE', operation:arguments[0]}).then(settings=>done({settings}), error=>done({error:error.message}));`,
      { type: 'saveSite', host: 'www.notion.so', profile: profile('lora') });
    if (result.error) throw new Error(result.error);
    await driver.switchTo().window(notion);
    await fontIs('editor', 'Typewell Lora');
    assert.equal(await driver.findElement(By.id('editor')).getAttribute('data-typewell-text'), '');
    await driver.close();
    await driver.switchTo().window(page);
  });
  await check('cross-origin iframe uses the top-level website preference', async () => {
    await driver.switchTo().frame(await driver.findElement(By.id('embedded')));
    await fontIs('frame-text', 'Typewell Lora');
    await driver.switchTo().defaultContent();
  });
  await check('open shadow roots receive the selected font', async () => {
    assert.ok((await driver.executeScript('return getComputedStyle(document.querySelector("#shadow-host").shadowRoot.querySelector("p")).fontFamily')).includes('Typewell Lora'));
  });
  await check('dynamic content receives the font without reloading', async () => {
    await driver.executeScript(`const p=document.createElement('p');p.id='dynamic';p.textContent='An infinitely scrolling story';document.querySelector('main').append(p);`);
    await fontIs('dynamic', 'Typewell Lora');
  });
  await check('relative text scaling preserves hierarchy and does not compound on dynamic text', async () => {
    await change({ type: 'saveSite', host: '127.0.0.1', profile: { ...profile('inter'), scale: 125, lineHeight: 1.6, letterSpacing: 0.03 } });
    await fontIs('body-text', 'Typewell Inter');
    assert.equal((await metrics('body-text')).size, '20px');
    assert.equal((await metrics('heading')).size, '45px');
    assert.equal((await metrics('body-text')).line, '32px');
    for (let index = 0; index < 3; index++) {
      await driver.executeScript(`const span=document.createElement('span');span.id='nested-'+arguments[0];span.textContent=' new child ';document.getElementById('scaled-parent').append(span);`, index);
      await fontIs(`nested-${index}`, 'Typewell Inter');
      assert.equal((await metrics(`nested-${index}`)).size, '25px');
    }
    assert.equal((await metrics('scaled-parent')).size, '25px');
  });
  await check('Google icons keep their size and spacing with readability adjustments', async () => {
    for (const id of googleIconIds) assert.deepEqual(await metrics(id), googleIcons[id], id);
    for (const { id, pseudo, original } of googlePseudos) {
      const current = await metrics(id, pseudo);
      assert.equal(current.family, original.family, `${id}${pseudo} font`);
      assert.equal(current.size, original.size, `${id}${pseudo} size`);
      assert.equal(current.letter, original.letter, `${id}${pseudo} spacing`);
    }
  });
  await check('dynamically opened Google-style menus preserve icons and style their labels', async () => {
    await driver.executeScript(`const button=document.createElement('button');button.id='dynamic-google-menu';button.innerHTML='<span id="dynamic-google-icon" class="google-ligature">spark</span> Upgrade';document.querySelector('main').append(button);`);
    await fontIs('dynamic-google-menu', 'Typewell Inter');
    await driver.wait(async () => await driver.findElement(By.id('dynamic-google-icon')).getAttribute('data-typewell-keep') !== null, 5000);
    const current = await metrics('dynamic-google-icon');
    for (const key of ['family', 'size', 'letter']) assert.equal(current[key], googleIcons['google-symbol'][key], key);
  });
  await check('new text inside a protected code block stays in its original font', async () => {
    await driver.executeScript(`const span=document.createElement('span');span.id='dynamic-code';span.textContent=' newCode()';document.getElementById('code-child').append(span);`);
    await driver.wait(async () => (await driver.findElement(By.id('dynamic-code')).getText()).includes('newCode'), 2000);
    // Wait for the mutation engine to process the same insertion before checking protection.
    await driver.executeAsyncScript('const done=arguments[arguments.length-1];setTimeout(done,250);');
    assert.equal((await metrics('dynamic-code')).family, code.family);
  });
  await check('GitHub code stays aligned during readability adjustments and dynamic line insertion', async () => {
    for (const id of githubCodeIds) assert.deepEqual(await metrics(id), githubOriginal[id], id);
    await driver.executeScript(`const span=document.createElement('span');span.id='github-new-token';span.textContent=' newToken';document.getElementById('github-line').append(span);const line=document.createElement('div');line.id='github-new-line';line.className='react-code-text';line.textContent='return newToken';document.querySelector('.react-code-file-contents').append(line);`);
    await driver.wait(async () => await driver.findElement(By.id('github-new-line')).getAttribute('data-typewell-keep') !== null, 5000);
    assert.deepEqual(await metrics('github-new-token'), githubOriginal['github-line']);
    assert.deepEqual(await metrics('github-new-line'), githubOriginal['github-line']);
    await fontIs('github-description', 'Typewell Inter');
  });
  await check('turning off code preservation deliberately styles GitHub code and turning it on restores it', async () => {
    await change({ type: 'saveSite', host: '127.0.0.1', profile: { ...profile('inter'), preserveCode: false } });
    // The table cell contains only a span; the visible text leaf gets the override.
    for (const id of githubCodeIds.filter(id => id !== 'github-legacy-code')) await fontIs(id, 'Typewell Inter');
    await change({ type: 'saveSite', host: '127.0.0.1', profile: profile('inter') });
    await driver.wait(async () => (await metrics('github-line')).family === githubOriginal['github-line'].family, 5000);
    for (const id of githubCodeIds) assert.deepEqual(await metrics(id), githubOriginal[id], id);
    await fontIs('github-description', 'Typewell Inter');
  });
  await check('global settings respect site overrides, exclusions and removal', async () => {
    await change({ type: 'saveGlobal', profile: profile('lexend') });
    await fontIs('body-text', 'Typewell Inter');
    await change({ type: 'skipSite', host: '127.0.0.1' });
    await fontIs('body-text', 'Arial');
    assert.deepEqual(await metrics('body-text'), initial);
    await change({ type: 'removeSite', host: '127.0.0.1' });
    await fontIs('body-text', 'Typewell Lexend');
  });
  await check('reading mode leaves navigation alone and code styling can be enabled', async () => {
    await change({ type: 'saveSite', host: '127.0.0.1', profile: { ...profile('inter'), target: 'reading', preserveCode: false } });
    await fontIs('body-text', 'Typewell Inter');
    assert.equal((await metrics('navigation')).family.includes('Typewell'), false);
    await fontIs('code', 'Typewell Inter');
    await change({ type: 'removeSite', host: '127.0.0.1' });
    await fontIs('body-text', 'Typewell Lexend');
  });
  await check('preview is temporary and port disconnect restores the saved font', async () => {
    await driver.switchTo().window(preferences);
    const result = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];browser.tabs.query({}).then(tabs=>{ const tab=tabs.find(t=>t.url.startsWith(arguments[0]));window.previewPort=browser.runtime.connect({name:'typewell-preview'});previewPort.onMessage.addListener(done);previewPort.postMessage({type:'PREVIEW',tabId:tab.id,host:'127.0.0.1',profile:arguments[1],request:1});});`, url, profile('lora'));
    assert.equal(result.ok, true, result.error);
    await driver.switchTo().window(page); await fontIs('body-text', 'Typewell Lora');
    await driver.switchTo().window(preferences); await driver.executeScript('window.previewPort.disconnect()');
    await driver.switchTo().window(page); await fontIs('body-text', 'Typewell Lexend');
  });
  await check('pause restores exact original computed text formatting and removes markers', async () => {
    await change({ type: 'enabled', enabled: false });
    await fontIs('body-text', 'Arial');
    assert.deepEqual(await metrics('body-text'), initial);
    assert.deepEqual(await metrics('heading'), heading);
    assert.equal(await driver.executeScript('return document.querySelectorAll("[data-typewell-text],[data-typewell-keep],[data-typewell-before]").length'), 0);
    assert.equal(await driver.executeScript('return document.getElementById("body-text").hasAttribute("style")'), false);
  });
  await check('saved settings survive page navigation and resume', async () => {
    await change({ type: 'enabled', enabled: true });
    await driver.navigate().refresh(); await fontIs('body-text', 'Typewell Lexend');
  });
  await check('settings UI supports favorites, rule removal, export and invalid import feedback', async () => {
    await change({ type: 'favorite', fontId: 'lora', favorite: true });
    await change({ type: 'saveSite', host: 'reading.example', profile: profile('literata') });
    await driver.switchTo().window(preferences);
    await driver.wait(until.elementLocated(By.css('[aria-label="Remove rule for reading.example"]')), 5000);
    await driver.findElement(By.css('[aria-label="Remove rule for reading.example"]')).click();
    await driver.wait(async () => (await driver.findElements(By.css('[aria-label="Remove rule for reading.example"]'))).length === 0, 5000);
    await driver.findElement(By.id('export')).click();
    await driver.executeScript(`const transfer=new DataTransfer(); transfer.items.add(new File(['{"version":2}'],'invalid-backup.json',{type:'application/json'})); const input=document.getElementById('import-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));`);
    await driver.wait(async () => (await driver.findElement(By.id('message')).getText()).includes('not a supported'), 5000, 'Invalid backup should show a validation error');
  });
  await check('valid backup import requires confirmation and applies the imported profile', async () => {
    const backup = { version: 1, enabled: true, global: profile('geist'), sites: { 'reading.example': {profile:profile('literata')} }, favorites: ['lora', 'geist'] };
    await driver.executeScript(`const transfer=new DataTransfer();transfer.items.add(new File([arguments[0]],'backup.json',{type:'application/json'}));const input=document.getElementById('import-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));`, JSON.stringify(backup));
    await driver.wait(async () => await driver.executeScript('return document.getElementById("import-dialog").open'), 5000);
    assert.equal(await driver.findElement(By.id('global-name')).getText(), 'Lexend');
    await driver.findElement(By.id('confirm-import')).click();
    await driver.wait(async () => (await driver.findElement(By.id('global-name')).getText()) === 'Geist', 5000);
    await driver.switchTo().window(page); await fontIs('body-text', 'Typewell Geist');
  });
  await driver.switchTo().window(preferences);
  await driver.executeScript('window.scrollTo(0,0)');
  await driver.executeScript('document.getElementById("message").hidden=true');
  await writeFile(new URL('preferences.png', results), await driver.takeScreenshot(), 'base64');
  await driver.switchTo().window(page);
  await driver.setContext(firefox.Context.CHROME);
  const widgetId = await driver.executeScript(`const {CustomizableUI}=ChromeUtils.importESModule('moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs');
    const widget=CustomizableUI.getWidgetsInArea(CustomizableUI.AREA_ADDONS).find(w=>w.id.includes('typewell'));
    if(!widget) throw new Error('Typewell toolbar widget not found');
    CustomizableUI.addWidgetToArea(widget.id,CustomizableUI.AREA_NAVBAR);return widget.id;`);
  await driver.findElement(By.css(`#${widgetId} .unified-extensions-item-action-button`)).click();
  await driver.wait(until.elementLocated(By.css('browser.webextension-popup-browser:not(.webextension-preload-browser)')), 5000);
  await check('real toolbar popup detects its website and renders all font choices', async () => {
    await driver.wait(async () => (await popupEval('return document.getElementById("host")?.textContent')) === '127.0.0.1', 5000);
    assert.equal(await popupEval('return document.querySelectorAll(".font-card").length'), 159);
    assert.equal(await popupEval('return document.getElementById("save").disabled'), false);
    assert.equal(await popupEval('return document.documentElement.scrollWidth'), 420);
    assert.equal(await popupEval('return document.documentElement.scrollHeight'), 600);
    assert.equal(await popupEval('return matchMedia("(prefers-color-scheme: dark)").matches'), darkMode);
    assert.equal(await popupEval('return getComputedStyle(document.documentElement).colorScheme'), darkMode ? 'dark' : 'light');
    assert.equal(await popupEval('return getComputedStyle(document.body).backgroundColor'), darkMode ? 'rgb(20, 26, 23)' : 'rgb(248, 247, 243)');
  });
  await check('saved appearance choice updates the open popup', async () => {
    const override = darkMode ? 'light' : 'dark';
    await popupEval(`return browser.runtime.sendMessage({type:'UPDATE',operation:{type:'theme',theme:arguments[0]}}).then(()=>true)`, [override]);
    await driver.wait(async () => (await popupEval('return document.documentElement.dataset.theme')) === override, 5000);
    assert.equal(await popupEval('return getComputedStyle(document.body).backgroundColor'), override === 'dark' ? 'rgb(20, 26, 23)' : 'rgb(248, 247, 243)');
    await popupEval(`return browser.runtime.sendMessage({type:'UPDATE',operation:{type:'theme',theme:'system'}}).then(()=>true)`);
    await driver.wait(async () => (await popupEval('return !document.documentElement.hasAttribute("data-theme")')) === true, 5000);
  });
  await check('popup search, selection and favorites work with a real live preview', async () => {
    await popupEval(`const search=document.getElementById('search');search.value='JetBrains';search.dispatchEvent(new Event('input'));`);
    assert.equal(await popupEval('return document.querySelectorAll(".font-card").length'), 1);
    await popupEval('document.querySelector(".font-choose").click()');
    await driver.wait(async () => (await pageEval('return getComputedStyle(document.getElementById("body-text")).fontFamily')).includes('Typewell JetBrains Mono'), 5000);
    await popupEval('document.querySelector(".favorite").click()');
    await driver.wait(async () => (await popupEval('return document.querySelector(".favorite").getAttribute("aria-pressed")')) === 'true', 5000);
    await popupEval(`const search=document.getElementById('search');search.value='';search.dispatchEvent(new Event('input'));document.querySelector('[data-category="favorites"]').click();`);
    assert.equal(await popupEval('return document.querySelectorAll(".font-card").length'), 3);
  });
  await check('popup spacing controls and Apply save the displayed profile', async () => {
    await popupEval(`document.getElementById('tune-tab').click();const scale=document.getElementById('scale');scale.value='125';scale.dispatchEvent(new Event('input'));document.getElementById('save').click();`);
    await driver.wait(async () => (await popupEval('return document.getElementById("message").textContent')).includes('Saved.'), 5000);
    await driver.wait(async () => (await pageEval('return getComputedStyle(document.getElementById("body-text")).fontSize')) === '20px', 5000);
  });
  await check('closing the actual popup reverts an unsaved change to the saved profile', async () => {
    await popupEval(`const scale=document.getElementById('scale');scale.value='100';scale.dispatchEvent(new Event('input'));document.getElementById('fonts-tab').click();document.querySelector('[data-category="all"]').click();document.querySelector('[data-font="lora"] .font-choose').click();`);
    await driver.wait(async () => (await pageEval('return getComputedStyle(document.getElementById("body-text")).fontFamily')).includes('Typewell Lora'), 5000);
    const screenshot = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];const browser=document.querySelector('browser.webextension-popup-browser:not(.webextension-preload-browser)');
      browser.browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(0,0,420,600),1,'rgb(248,247,243)').then(bitmap=>{
        const canvas=document.createElementNS('http://www.w3.org/1999/xhtml','canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;canvas.getContext('2d').drawImage(bitmap,0,0);done(canvas.toDataURL('image/png').split(',')[1]);
      },error=>done({error:error.message}));`);
    if (typeof screenshot !== 'string') throw new Error(screenshot.error);
    await writeFile(new URL('popup.png', results), screenshot, 'base64');
    await driver.executeScript(`document.querySelector('browser.webextension-popup-browser:not(.webextension-preload-browser)').closest('panel').hidePopup();`);
    await driver.wait(async () => (await pageEval('return getComputedStyle(document.getElementById("body-text")).fontFamily')).includes('Typewell JetBrains Mono'), 5000);
  });
  await check('Use original previews temporarily until the popup closes', async () => {
    await driver.findElement(By.css(`#${widgetId} .unified-extensions-item-action-button`)).click();
    await driver.wait(until.elementLocated(By.css('browser.webextension-popup-browser:not(.webextension-preload-browser)')), 5000);
    await popupEval('document.getElementById("original").click()');
    await driver.wait(async () => (await pageEval('return getComputedStyle(document.getElementById("body-text")).fontFamily')).includes('Arial'), 5000);
    assert.equal(await popupEval('return document.getElementById("original").textContent'), 'Original selected');
    assert.equal(await popupEval('return document.getElementById("original").getAttribute("aria-pressed")'), 'true');
    await driver.executeScript(`document.querySelector('browser.webextension-popup-browser:not(.webextension-preload-browser)').closest('panel').hidePopup();`);
    await driver.wait(async () => (await pageEval('return getComputedStyle(document.getElementById("body-text")).fontFamily')).includes('Typewell JetBrains Mono'), 5000);
  });
  await check('Apply saves the website original choice', async () => {
    await driver.findElement(By.css(`#${widgetId} .unified-extensions-item-action-button`)).click();
    await driver.wait(until.elementLocated(By.css('browser.webextension-popup-browser:not(.webextension-preload-browser)')), 5000);
    await popupEval('document.getElementById("original").click();document.getElementById("save").click()');
    await driver.wait(async () => (await popupEval('return document.getElementById("message").textContent')).includes('Saved.'), 5000);
    await driver.wait(async () => (await pageEval('return getComputedStyle(document.getElementById("body-text")).fontFamily')).includes('Arial'), 5000);
    await driver.executeScript(`document.querySelector('browser.webextension-popup-browser:not(.webextension-preload-browser)').closest('panel').hidePopup();`);
    await driver.wait(async () => (await pageEval('return getComputedStyle(document.getElementById("body-text")).fontFamily')).includes('Arial'), 5000);
    await driver.findElement(By.css(`#${widgetId} .unified-extensions-item-action-button`)).click();
    await driver.wait(until.elementLocated(By.css('browser.webextension-popup-browser:not(.webextension-preload-browser)')), 5000);
    await driver.wait(async () => (await popupEval('return document.getElementById("site-status-text").textContent')) === 'Original', 5000);
    await driver.executeScript(`document.querySelector('browser.webextension-popup-browser:not(.webextension-preload-browser)').closest('panel').hidePopup();`);
  });
  await driver.setContext(firefox.Context.CONTENT);
  await check('protected Firefox pages show a useful message and still allow global preferences', async () => {
    await driver.get('about:blank');
    await driver.setContext(firefox.Context.CHROME);
    await driver.findElement(By.css(`#${widgetId} .unified-extensions-item-action-button`)).click();
    await driver.wait(until.elementLocated(By.css('browser.webextension-popup-browser:not(.webextension-preload-browser)')), 5000);
    await driver.wait(async () => (await popupEval('return document.getElementById("message").textContent')).includes('Your browser protects this page'), 5000);
    assert.equal(await popupEval('return document.getElementById("scope-site").disabled'), true);
    assert.equal(await popupEval('return document.getElementById("save").disabled'), false);
    await driver.executeScript(`document.querySelector('browser.webextension-popup-browser:not(.webextension-preload-browser)').closest('panel').hidePopup();`);
    await driver.setContext(firefox.Context.CONTENT);
  });
  if (process.env.TYPEWELL_TEST_LIVE_GITHUB === '1') {
    await check('live public GitHub file preserves monospace code while surrounding text changes', async () => {
      await change({ type: 'skipSite', host: 'github.com' });
      await driver.switchTo().newWindow('tab');
      const livePage = await driver.getWindowHandle();
      const liveURL = 'https://github.com/thinking-machines-lab/tinker/blob/main/pyproject.toml';
      await driver.get(liveURL);
      await driver.wait(until.elementLocated(By.css('.react-code-text:not(.react-line-number)')), 15000);
      const snapshot = () => driver.executeScript(`return [...document.querySelectorAll('.react-code-text:not(.react-line-number)')].slice(0,3).map(element=>{const css=getComputedStyle(element);return {text:element.textContent,family:css.fontFamily,size:css.fontSize,line:css.lineHeight,letter:css.letterSpacing};});`);
      const original = await snapshot();
      assert.ok(original.length > 0 && original.every(line => line.family.includes('monospace')));
      await change({ type: 'saveSite', host: 'github.com', profile: { ...profile('lora'), scale: 125, lineHeight: 1.6, letterSpacing: 0.03 } });
      await driver.switchTo().window(livePage);
      await driver.wait(async () => driver.executeScript(`return [...document.querySelectorAll('[data-typewell-text]')].some(element=>!element.closest('.react-code-file-contents')&&getComputedStyle(element).fontFamily.includes('Typewell Lora'));`), 10000);
      assert.deepEqual(await snapshot(), original);
      await driver.wait(async () => driver.executeScript(`return document.querySelector('.react-code-text:not(.react-line-number)').hasAttribute('data-typewell-keep');`), 5000);
      await writeFile(new URL('github-live-results.json', results), JSON.stringify({ url: liveURL, firefox: (await driver.getCapabilities()).get('browserVersion'), original, styled: await snapshot(), proseFont: 'Typewell Lora', scale: 125, lineHeight: 1.6, letterSpacing: 0.03 }, null, 2));
      await writeFile(new URL('github-code-preserved.png', results), await driver.takeScreenshot(), 'base64');
      await driver.close();
      await driver.switchTo().window(page);
    });
  }
  console.log(`\n${checks.length} real Firefox integration checks passed.`);
  await writeFile(new URL('firefox-results.json', results), JSON.stringify({ firefox: (await driver.getCapabilities()).get('browserVersion'), checks }, null, 2));
} catch (error) {
  if (driver) {
    try { await driver.setContext(firefox.Context.CONTENT); await writeFile(new URL('failure.png', results), await driver.takeScreenshot(), 'base64'); } catch { /* Best effort. */ }
    const failure = { failedCheck: activeCheck, error: error.message, stack: error.stack, passedChecks: checks };
    try { failure.theme = await captureThemeState(); } catch (diagnosticError) { failure.diagnosticError = diagnosticError.message; }
    await writeFile(new URL('failure-state.json', results), `${JSON.stringify(failure, null, 2)}\n`);
    console.error('Firefox failure state:', JSON.stringify(failure));
  }
  throw error;
} finally {
  if (driver) await driver.quit();
  if (testProfileDirectory) await rm(testProfileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await new Promise(resolve => server.close(resolve));
}
