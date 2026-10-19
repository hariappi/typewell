import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Builder, By, until } from 'selenium-webdriver';
import chrome from 'selenium-webdriver/chrome.js';

const root = new URL('../', import.meta.url);
const results = new URL('test-results/', root);
const extensionPath = fileURLToPath(new URL('dist/chromium/', root));
if (!existsSync(`${extensionPath}/manifest.json`)) throw new Error('Build Chromium first with npm run build:chromium.');
const binary = process.env.CHROMIUM_BINARY || [
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/usr/bin/chromium', '/usr/bin/chromium-browser'
].find(candidate => existsSync(candidate));
if (!binary) throw new Error('Set CHROMIUM_BINARY to a Chrome for Testing, Chromium, or Brave executable.');
const browserName = /brave/i.test(binary) ? 'brave' : 'chrome';
const browserLabel = browserName === 'brave' ? 'Brave' : /for testing/i.test(binary) ? 'Chrome for Testing' : 'Chromium';
const extensionVersion = JSON.parse(await readFile(`${extensionPath}/manifest.json`, 'utf8')).version;
const darkMode = process.env.TYPEWELL_TEST_DARK === '1';
await mkdir(results, { recursive: true });
const profileDirectory = await mkdtemp(`${tmpdir()}/typewell-${browserName}-`);
const downloadDirectory = `${profileDirectory}/downloads`;
await mkdir(downloadDirectory);
const respond = async (request, response) => {
  const html = await readFile(new URL(request.url === '/frame' ? 'fixtures/frame.html' : 'fixtures/article.html', import.meta.url), 'utf8');
  response.writeHead(200, {
    'Content-Type': 'text/html',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; frame-src http://localhost:*; script-src 'self'"
  });
  response.end(html.replaceAll('{{PORT}}', server.address().port));
};
const server = createServer(respond);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/article`;
// notion.so is preloaded for HTTPS in Chromium. Serve the local fixture over TLS
// and trust only this disposable test certificate's public key for this session.
const certificatePath = `${profileDirectory}/fixture-cert.pem`;
const keyPath = `${profileDirectory}/fixture-key.pem`;
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certificatePath, '-days', '1', '-subj', '/CN=www.notion.so'], { stdio: 'ignore' });
const certificate = await readFile(certificatePath);
const publicKey = execFileSync('openssl', ['x509', '-pubkey', '-noout'], { input: certificate });
const publicKeyDER = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'DER'], { input: publicKey });
const publicKeyHash = execFileSync('openssl', ['dgst', '-sha256', '-binary'], { input: publicKeyDER }).toString('base64');
const secureServer = createSecureServer({ key: await readFile(keyPath), cert: certificate }, respond);
await new Promise(resolve => secureServer.listen(0, '127.0.0.1', resolve));
const notionURL = `https://www.notion.so:${secureServer.address().port}/article`;
const options = new chrome.Options().setChromeBinaryPath(binary).addArguments(
  `--user-data-dir=${profileDirectory}`,
  `--load-extension=${extensionPath}`,
  `--disable-extensions-except=${extensionPath}`,
  '--no-first-run', '--no-default-browser-check', '--disable-search-engine-choice-screen',
  '--disable-component-update', '--disable-background-networking', '--no-proxy-server',
  '--host-resolver-rules=MAP www.notion.so 127.0.0.1', '--window-size=1260,1000',
  `--ignore-certificate-errors-spki-list=${publicKeyHash}`
).setUserPreferences({
  'download.default_directory': downloadDirectory,
  'download.prompt_for_download': false,
  'profile.default_content_setting_values.notifications': 2
});
if (process.env.TYPEWELL_TEST_HEADFUL !== '1') options.addArguments('--headless=new');
if (darkMode) options.addArguments('--force-dark-mode');
const service = new chrome.ServiceBuilder(process.env.CHROMEDRIVER);
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log(`PASS ${name}`); };
const profile = fontId => ({ fontId, customFont: '', scale: 100, lineHeight: 0, letterSpacing: 0, wordSpacing: 0, preserveCode: true, target: 'all' });
let driver, cdp, page, preferences, extensionURL, version;

// A separate CDP connection evaluates the real action popup without focusing another
// window, which would close that popup and invalidate the preview being tested.
async function connectCDP(address) {
  const { webSocketDebuggerUrl } = await (await fetch(`http://${address}/json/version`)).json();
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const requests = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = requests.get(message.id);
    if (!request) return;
    requests.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    send(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { requests.delete(id); reject(new Error(`CDP ${method} timed out`)); }, 15000);
        requests.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    close() { socket.close(); }
  };
}
async function targets() { return (await cdp.send('Target.getTargets')).targetInfos; }
async function attach(targetId) { return (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId; }
async function evaluate(sessionId, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function change(operation) {
  await driver.switchTo().window(preferences);
  const result = await driver.executeAsyncScript(`const done=arguments[arguments.length-1]; Typewell.sendMessage({type:'UPDATE',operation:arguments[0]}).then(settings=>done({settings}),error=>done({error:error.message}));`, operation);
  if (result.error) throw new Error(result.error);
  await driver.switchTo().window(page);
  return result.settings;
}
async function fontIs(id, family) {
  await driver.wait(async () => (await metrics(id)).family.includes(family), 12000, `${id} should use ${family}`);
}
async function metrics(id, pseudo = null) {
  return driver.executeScript(`const css=getComputedStyle(document.getElementById(arguments[0]),arguments[1]);return {family:css.fontFamily,size:css.fontSize,weight:css.fontWeight,style:css.fontStyle,line:css.lineHeight,letter:css.letterSpacing};`, id, pseudo);
}
async function openPopup() {
  await driver.switchTo().window(preferences);
  const opened = await driver.executeAsyncScript(`const done=arguments[arguments.length-1]; (async()=>{const tab=(await Typewell.api.tabs.query({})).find(tab=>tab.url===arguments[0]);await Typewell.api.tabs.update(tab.id,{active:true});await Typewell.api.action.openPopup({windowId:tab.windowId});return true;})().then(done,error=>done({error:error.message}));`, url);
  if (opened?.error) throw new Error(opened.error);
  let popup;
  await driver.wait(async () => { popup = (await targets()).find(target => target.url === `${extensionURL}/popup/popup.html`); return !!popup; }, 5000, 'The real extension action popup should open');
  const popupSession = await attach(popup.targetId);
  const pageTarget = (await targets()).find(target => target.url === url && target.type === 'page');
  const pageSession = await attach(pageTarget.targetId);
  await driver.wait(async () => await evaluate(popupSession, 'document.querySelectorAll(".font-card").length') === 159, 8000);
  return {
    popup: expression => evaluate(popupSession, expression),
    page: expression => evaluate(pageSession, expression),
    close: () => cdp.send('Target.closeTarget', { targetId: popup.targetId })
  };
}
async function insertBackup(value, filename = 'backup.json') {
  await driver.executeScript(`const transfer=new DataTransfer();transfer.items.add(new File([arguments[0]],arguments[1],{type:'application/json'}));const input=document.getElementById('import-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));`, JSON.stringify(value), filename);
}

try {
  driver = await new Builder().forBrowser('chrome').setChromeOptions(options).setChromeService(service).build();
  await driver.manage().setTimeouts({ script: 15000 });
  const capabilities = await driver.getCapabilities();
  version = capabilities.get('browserVersion');
  cdp = await connectCDP(capabilities.get('goog:chromeOptions').debuggerAddress);
  console.log(`${browserLabel} ${version}\nBinary: ${binary}\nDisposable profile: ${profileDirectory}`);
  let worker;
  await driver.wait(async () => { worker = (await targets()).find(target => target.type === 'service_worker' && target.url.endsWith('/background-worker.js')); return !!worker; }, 10000, 'Typewell service worker should register');
  // Node's URL.origin is "null" for chrome-extension URLs.
  extensionURL = worker.url.slice(0, worker.url.indexOf('/', 'chrome-extension://'.length));
  await driver.get(url); page = await driver.getWindowHandle();
  await driver.executeScript(`const host=document.createElement('div');host.id='shadow-host';document.querySelector('main').append(host);host.attachShadow({mode:'open'}).innerHTML='<p id="shadow-text" style="font-family:Georgia;font-size:17px">Text in an open shadow root</p>';`);
  const initial = await metrics('body-text');
  const heading = await metrics('heading');
  const protectedIds = ['code', 'editor', 'icon', 'unknown-icon', 'github-line-number', 'github-line', 'github-keyword', 'github-legacy-number', 'github-legacy-code', 'github-legacy-token', 'google-symbol', 'google-material-symbol', 'google-sans-symbol', 'google-class-symbol'];
  const originals = Object.fromEntries(await Promise.all(protectedIds.map(async id => [id, await metrics(id)])));
  const pseudoOriginals = await Promise.all([['pseudo', '::before'], ['google-pseudo', '::before'], ['empty-pseudo', '::before'], ['empty-pseudo', '::after']].map(async ([id, pseudo]) => ({ id, pseudo, original: await metrics(id, pseudo) })));
  await driver.switchTo().newWindow('tab'); preferences = await driver.getWindowHandle();
  await driver.get(`${extensionURL}/options/options.html`);
  await driver.wait(until.elementLocated(By.id('enabled')), 5000);
  await check('Chromium Manifest V3 worker, preferences, private browsing policy and all bundled fonts load', async () => {
    await driver.wait(async () => await driver.findElement(By.id('total-fonts')).getText() === '159', 8000);
    const manifest = await driver.executeScript('return Typewell.api.runtime.getManifest()');
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.background.service_worker, 'background-worker.js');
    assert.equal(manifest.browser_specific_settings, undefined);
    assert.equal(manifest.incognito, 'not_allowed');
    const allowed = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];Typewell.api.extension.isAllowedIncognitoAccess(done);`);
    assert.equal(allowed, false);
    assert.equal(await driver.findElement(By.id('extension-version')).getText(), `TYPEWELL · ${manifest.version}`);
    const loaded = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];Promise.all(Typewell.fonts.filter(font=>font.bundled).map(font=>document.fonts.load('16px "'+font.family+'"'))).then(results=>done(results.every(faces=>faces.length>0)),error=>done(error.message));`);
    assert.equal(loaded, true);
  });
  await check('preferences follow system appearance and save explicit light and dark choices', async () => {
    assert.equal(await driver.executeScript('return matchMedia("(prefers-color-scheme: dark)").matches'), darkMode);
    for (const theme of ['dark', 'light']) {
      await driver.findElement(By.css(`[data-theme-choice="${theme}"]`)).click();
      await driver.wait(async () => await driver.executeScript('return document.documentElement.dataset.theme') === theme, 5000);
      assert.equal(await driver.executeScript('return getComputedStyle(document.body).backgroundColor'), theme === 'dark' ? 'rgb(20, 26, 23)' : 'rgb(248, 247, 243)');
    }
    await driver.findElement(By.css('[data-theme-choice="system"]')).click();
    await driver.wait(async () => await driver.executeScript('return !document.documentElement.hasAttribute("data-theme")'), 5000);
  });
  await check('fresh installation leaves pages unchanged', async () => {
    await driver.switchTo().window(page);
    assert.deepEqual(await metrics('body-text'), initial);
    assert.equal(await driver.executeScript('return document.querySelectorAll("[data-typewell-text]").length'), 0);
  });
  await check('site font overrides author important rules and loads under restrictive font CSP', async () => {
    await change({ type: 'saveSite', host: '127.0.0.1', profile: profile('lora') });
    await fontIs('body-text', 'Typewell Lora'); await fontIs('forced', 'Typewell Lora');
    assert.equal(await driver.executeScript('return [...document.fonts].some(font=>font.family==="Typewell Lora"&&font.status==="loaded")'), true);
  });
  await check('headings and emphasis retain formatting while code, editors and icons are protected', async () => {
    const current = await metrics('heading');
    assert.equal(current.size, heading.size); assert.equal(current.weight, heading.weight);
    assert.equal((await metrics('emphasis')).style, 'italic');
    for (const id of protectedIds) assert.deepEqual(await metrics(id), originals[id], id);
    for (const { id, pseudo, original } of pseudoOriginals) {
      const current = await metrics(id, pseudo);
      for (const property of ['family', 'size', 'letter']) assert.equal(current[property], original[property], `${id}${pseudo} ${property}`);
    }
    await fontIs('google-copy', 'Typewell Lora'); await fontIs('github-description', 'Typewell Lora');
  });
  await check('cross-origin frames, open shadow roots and dynamically inserted prose use the site font', async () => {
    await driver.switchTo().frame(await driver.findElement(By.id('embedded'))); await fontIs('frame-text', 'Typewell Lora');
    await driver.switchTo().defaultContent();
    assert.match(await driver.executeScript('return getComputedStyle(document.querySelector("#shadow-host").shadowRoot.querySelector("p")).fontFamily'), /Typewell Lora/);
    await driver.executeScript(`const p=document.createElement('p');p.id='dynamic';p.textContent='An infinitely scrolling story';document.querySelector('main').append(p);`);
    await fontIs('dynamic', 'Typewell Lora');
  });
  await check('Notion editor leaves receive the font while ordinary editors stay protected', async () => {
    await change({ type: 'saveSite', host: 'www.notion.so', profile: profile('lora') });
    await driver.switchTo().newWindow('tab'); const notion = await driver.getWindowHandle();
    await driver.get(notionURL); await fontIs('editor', 'Typewell Lora');
    await driver.close(); await driver.switchTo().window(page);
    assert.deepEqual(await metrics('editor'), originals.editor);
  });
  await check('readability scaling preserves hierarchy, protected glyphs and dynamic code alignment', async () => {
    await change({ type: 'saveSite', host: '127.0.0.1', profile: { ...profile('inter'), scale: 125, lineHeight: 1.6, letterSpacing: 0.03 } });
    await fontIs('body-text', 'Typewell Inter');
    assert.equal((await metrics('body-text')).size, '20px'); assert.equal((await metrics('heading')).size, '45px');
    assert.equal((await metrics('body-text')).line, '32px');
    for (const id of protectedIds) assert.deepEqual(await metrics(id), originals[id], id);
    await driver.executeScript(`const span=document.createElement('span');span.id='nested';span.textContent=' A new child';document.getElementById('scaled-parent').append(span);const token=document.createElement('span');token.id='dynamic-code';token.textContent=' newToken';document.getElementById('github-line').append(token);const line=document.createElement('div');line.id='dynamic-code-line';line.className='react-code-text';line.textContent='return newToken';document.querySelector('.react-code-file-contents').append(line);`);
    await fontIs('nested', 'Typewell Inter'); assert.equal((await metrics('nested')).size, '25px');
    await driver.wait(async () => await driver.findElement(By.id('dynamic-code-line')).getAttribute('data-typewell-keep') !== null, 5000);
    assert.deepEqual(await metrics('dynamic-code'), originals['github-line']);
    assert.deepEqual(await metrics('dynamic-code-line'), originals['github-line']);
  });
  await check('global defaults respect exact site rules, exclusions, reading mode and explicit code styling', async () => {
    await change({ type: 'saveGlobal', profile: profile('lexend') }); await fontIs('body-text', 'Typewell Inter');
    await change({ type: 'skipSite', host: '127.0.0.1' }); await fontIs('body-text', 'Arial');
    assert.deepEqual(await metrics('body-text'), initial);
    await change({ type: 'removeSite', host: '127.0.0.1' }); await fontIs('body-text', 'Typewell Lexend');
    await change({ type: 'saveSite', host: '127.0.0.1', profile: { ...profile('inter'), target: 'reading', preserveCode: false } });
    await fontIs('code', 'Typewell Inter');
    assert.doesNotMatch((await metrics('navigation')).family, /Typewell/);
    await change({ type: 'removeSite', host: '127.0.0.1' }); await fontIs('body-text', 'Typewell Lexend');
  });
  await check('real runtime preview ports restore saved styling on disconnect', async () => {
    await driver.switchTo().window(preferences);
    const preview = await driver.executeAsyncScript(`const done=arguments[arguments.length-1];Typewell.api.tabs.query({}).then(tabs=>{const tab=tabs.find(tab=>tab.url===arguments[0]);window.previewPort=Typewell.api.runtime.connect({name:'typewell-preview'});previewPort.onMessage.addListener(done);previewPort.postMessage({type:'PREVIEW',tabId:tab.id,host:'127.0.0.1',profile:arguments[1],request:1});});`, url, profile('lora'));
    assert.equal(preview.ok, true, preview.error);
    await driver.switchTo().window(page); await fontIs('body-text', 'Typewell Lora');
    await driver.switchTo().window(preferences); await driver.executeScript('window.previewPort.disconnect()');
    await driver.switchTo().window(page); await fontIs('body-text', 'Typewell Lexend');
  });
  await check('pause restores original metrics and removes styling markers; resume survives navigation', async () => {
    await change({ type: 'enabled', enabled: false }); await fontIs('body-text', 'Arial');
    assert.deepEqual(await metrics('body-text'), initial); assert.deepEqual(await metrics('heading'), heading);
    assert.equal(await driver.executeScript('return document.querySelectorAll("[data-typewell-text],[data-typewell-keep],[data-typewell-before]").length'), 0);
    await change({ type: 'enabled', enabled: true }); await driver.navigate().refresh(); await fontIs('body-text', 'Typewell Lexend');
  });
  await check('settings UI removes rules and validates backups before confirmed import', async () => {
    await change({ type: 'favorite', fontId: 'lora', favorite: true });
    await change({ type: 'saveSite', host: 'reading.example', profile: profile('literata') });
    await driver.switchTo().window(preferences);
    await driver.wait(until.elementLocated(By.css('[aria-label="Remove rule for reading.example"]')), 5000);
    await driver.findElement(By.css('[aria-label="Remove rule for reading.example"]')).click();
    await driver.wait(async () => (await driver.findElements(By.css('[aria-label="Remove rule for reading.example"]'))).length === 0, 5000);
    await insertBackup({ version: 2 }, 'invalid.json');
    await driver.wait(async () => (await driver.findElement(By.id('message')).getText()).includes('not a supported'), 5000);
    await insertBackup({ version: 1, enabled: true, global: profile('geist'), sites: {}, favorites: ['lora', 'geist'] });
    await driver.wait(async () => await driver.executeScript('return document.getElementById("import-dialog").open'), 5000);
    assert.equal(await driver.findElement(By.id('global-name')).getText(), 'Lexend');
    await driver.findElement(By.id('confirm-import')).click();
    await driver.wait(async () => await driver.findElement(By.id('global-name')).getText() === 'Geist', 5000);
    await driver.switchTo().window(page); await fontIs('body-text', 'Typewell Geist');
  });
  await check('actual action popup detects the website, searches, previews, favorites and applies tuning', async () => {
    const ui = await openPopup();
    assert.equal(await ui.popup('document.getElementById("host").textContent'), '127.0.0.1');
    assert.equal(await ui.popup('document.getElementById("save").disabled'), false);
    await ui.popup(`(()=>{const search=document.getElementById('search');search.value='JetBrains';search.dispatchEvent(new Event('input'));})()`);
    assert.equal(await ui.popup('document.querySelectorAll(".font-card").length'), 1);
    await ui.popup('document.querySelector(".font-choose").click()');
    await driver.wait(async () => (await ui.page('getComputedStyle(document.getElementById("body-text")).fontFamily')).includes('Typewell JetBrains Mono'), 5000);
    // Open runtime ports alone do not reset the MV3 idle timer. Keep the real
    // popup open past Chromium's 30-second idle interval to verify its heartbeat.
    console.log('Checking the real popup preview survives a 35-second worker idle interval…');
    await new Promise(resolve => setTimeout(resolve, 35000));
    assert.equal(await ui.popup('document.getElementById("save").disabled'), false);
    assert.match(await ui.page('getComputedStyle(document.getElementById("body-text")).fontFamily'), /Typewell JetBrains Mono/);
    await ui.popup('document.querySelector(".favorite").click()');
    await driver.wait(async () => await ui.popup('document.querySelector(".favorite").getAttribute("aria-pressed")') === 'true', 5000);
    await ui.popup(`(()=>{document.getElementById('tune-tab').click();const scale=document.getElementById('scale');scale.value='125';scale.dispatchEvent(new Event('input'));document.getElementById('save').click();})()`);
    await driver.wait(async () => (await ui.popup('document.getElementById("message").textContent')).includes('Saved.'), 5000);
    assert.equal(await ui.page('getComputedStyle(document.getElementById("body-text")).fontSize'), '20px');
    await ui.close();
    await driver.switchTo().window(page); await fontIs('body-text', 'Typewell JetBrains Mono');
  });
  await check('closing an actual popup restores its unsaved font and original-font previews', async () => {
    let ui = await openPopup();
    await ui.popup('document.querySelector("[data-font=lora] .font-choose").click()');
    await driver.wait(async () => (await ui.page('getComputedStyle(document.getElementById("body-text")).fontFamily')).includes('Typewell Lora'), 5000);
    await ui.close(); await driver.switchTo().window(page); await fontIs('body-text', 'Typewell JetBrains Mono');
    ui = await openPopup(); await ui.popup('document.getElementById("original").click()');
    await driver.wait(async () => (await ui.page('getComputedStyle(document.getElementById("body-text")).fontFamily')).includes('Arial'), 5000);
    assert.equal(await ui.popup('document.getElementById("original").getAttribute("aria-pressed")'), 'true');
    await ui.close(); await driver.switchTo().window(page); await fontIs('body-text', 'Typewell JetBrains Mono');
  });
  await check('Apply persists the original-font selection after the action popup closes', async () => {
    const ui = await openPopup();
    await ui.popup('document.getElementById("original").click();document.getElementById("save").click()');
    await driver.wait(async () => (await ui.popup('document.getElementById("message").textContent')).includes('Saved.'), 5000);
    await ui.close(); await driver.switchTo().window(page); await fontIs('body-text', 'Arial');
  });
  await check('saved settings and CSS updates survive a stopped and restarted Manifest V3 service worker', async () => {
    await change({ type: 'removeSite', host: '127.0.0.1' }); await fontIs('body-text', 'Typewell Geist');
    const target = (await targets()).find(target => target.url === `${extensionURL}/options/options.html`);
    const sessionId = await attach(target.targetId);
    await cdp.send('ServiceWorker.enable', {}, sessionId);
    await cdp.send('ServiceWorker.stopAllWorkers', {}, sessionId);
    await driver.wait(async () => !(await targets()).some(target => target.type === 'service_worker' && target.url.startsWith(extensionURL)), 5000, 'Worker must actually stop before restart is tested');
    await driver.switchTo().window(page); await driver.navigate().refresh(); await fontIs('body-text', 'Typewell Geist');
    await change({ type: 'saveSite', host: '127.0.0.1', profile: profile('lora') }); await fontIs('body-text', 'Typewell Lora');
    await driver.wait(async () => (await targets()).some(target => target.type === 'service_worker' && target.url.startsWith(extensionURL)), 5000);
    await cdp.send('ServiceWorker.disable', {}, sessionId);
  });
  await writeFile(new URL(`${browserName}-results.json`, results), JSON.stringify({ browser: browserName, browserLabel, version, binary, extensionVersion, generatedAt: new Date().toISOString(), extensionURL, checks }, null, 2));
  console.log(`\n${checks.length} real ${browserLabel} integration checks passed.`);
} catch (error) {
  if (driver) {
    try { await writeFile(new URL(`${browserName}-failure.png`, results), await driver.takeScreenshot(), 'base64'); } catch { /* Best effort. */ }
  }
  throw error;
} finally {
  if (cdp) cdp.close();
  try { if (driver) await driver.quit(); }
  finally {
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => secureServer.close(resolve));
  }
}
