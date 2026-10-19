(() => {
  const T = globalThis.Typewell;
  const api = T.api;
  const $ = id => document.getElementById(id);
  let settings = T.defaultSettings();
  let draft = T.defaultProfile();
  let tab = null, host = null, canPreview = false, scope = "site", category = "all";
  let port = null, requestId = 0, latestRequest = 0, dirty = false, previewTimer = null, draftOriginal = false;
  const categoryLabel = { sans: "Sans serif", serif: "Serif", mono: "Monospace", accessible: "Accessible", display: "Display", handwriting: "Handwriting", system: "On your device" };
  const tell = (text, error = false) => { $("message").textContent = text; $("message").classList.toggle("error", error); };
  const update = operation => T.sendMessage({ type: "UPDATE", operation });
  const safely = fn => async (...args) => { try { await fn(...args); } catch (error) { tell(error.message, true); } };
  function setStatus() {
    const rule = host && settings.sites[host];
    $("host").textContent = host || "Browser page";
    $("host").title = host || "Open a regular website to change its font";
    $("site-status-text").textContent = !settings.enabled ? "Paused" : rule?.disabled ? "Original" : rule ? "Custom" : settings.global ? "Global" : "Original";
    $("power").setAttribute("aria-pressed", String(settings.enabled));
    $("power").setAttribute("aria-label", settings.enabled ? "Pause Typewell" : "Resume Typewell");
    $("power").title = settings.enabled ? "Pause Typewell" : "Resume Typewell";
    $("scope-site").disabled = !host;
    $("save").disabled = scope === "site" && !canPreview;
    $("save-label").textContent = scope === "site" ? "Apply to this website" : "Set as my default";
    $("original").disabled = scope === "site" ? !host : !settings.global;
    $("live-preview").disabled = !canPreview;
  }
  function renderDraft() {
    $("original").textContent = scope === "global" ? "Clear default" : draftOriginal ? "Original selected" : "Use original";
    $("original").setAttribute("aria-pressed", String(scope === "site" && draftOriginal));
    $("scale").value = draft.scale;
    $("scale-value").value = `${draft.scale}%`;
    const lineSelect = $("line-height");
    if (![...lineSelect.options].some(option => Number(option.value) === draft.lineHeight)) {
      const option = document.createElement("option"); option.value = draft.lineHeight; option.textContent = `Custom · ${draft.lineHeight}`; lineSelect.append(option);
    }
    lineSelect.value = draft.lineHeight;
    for (const [id, key] of [["letter-spacing", "letterSpacing"], ["word-spacing", "wordSpacing"]]) {
      $(id).value = draft[key] * 100;
      $(`${id}-value`).value = draft[key] ? `${draft[key].toFixed(2)} em` : "Original";
    }
    $("preserve-code").checked = draft.preserveCode;
    $("target").value = draft.target;
    $("custom-font").value = draft.customFont;
    for (const card of document.querySelectorAll(".font-card")) {
      const selected = !draftOriginal && card.dataset.font === draft.fontId;
      card.classList.toggle("selected", selected);
      card.querySelector(".font-choose").setAttribute("aria-pressed", String(selected));
    }
  }
  function renderFonts() {
    const query = $("search").value.trim().toLowerCase();
    const featuredRank = id => T.featured.includes(id) ? T.featured.indexOf(id) : 1000;
    const fonts = T.fonts.filter(font => (font.name.toLowerCase().includes(query) || font.category.includes(query)) &&
      (category === "all" || (category === "favorites" ? settings.favorites.includes(font.id) : font.category === category)))
      .sort((a, b) => featuredRank(a.id) - featuredRank(b.id) || a.name.localeCompare(b.name));
    const fragment = document.createDocumentFragment();
    for (const font of fonts) {
      const card = document.createElement("div"); card.className = "font-card"; card.dataset.font = font.id; card.setAttribute("role", "listitem");
      const choose = document.createElement("button"); choose.className = "font-choose"; choose.title = `Choose ${font.name}`;
      const glyph = document.createElement("span"); glyph.className = "font-glyph"; glyph.textContent = "Ag"; glyph.style.fontFamily = T.fontStack({ fontId: font.id }); glyph.setAttribute("aria-hidden", "true");
      const details = document.createElement("span"); details.className = "font-details";
      const name = document.createElement("span"); name.className = "font-name"; name.textContent = font.name;
      const kind = document.createElement("span"); kind.className = "font-kind"; kind.textContent = categoryLabel[font.category]; details.append(name, kind); choose.append(glyph, details);
      choose.addEventListener("click", () => { draft.fontId = font.id; draft.customFont = ""; changed(); });
      const favorite = document.createElement("button"); favorite.className = "favorite";
      const favored = settings.favorites.includes(font.id); favorite.textContent = favored ? "★" : "☆";
      favorite.setAttribute("aria-pressed", String(favored)); favorite.setAttribute("aria-label", `${favored ? "Unfavorite" : "Favorite"} ${font.name}`);
      favorite.addEventListener("click", safely(async () => {
        settings = await update({ type: "favorite", fontId: font.id, favorite: !settings.favorites.includes(font.id) });
        renderFonts();
        document.querySelector(`[data-font="${font.id}"] .favorite`)?.focus();
      }));
      card.append(choose, favorite); fragment.append(card);
    }
    if (!fonts.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = category === "favorites" && !query ? "A little collection of your favorites. Tap a star to start one." : "No fonts found. Try a different name or category."; fragment.append(empty); }
    $("font-list").replaceChildren(fragment); renderDraft();
  }
  function sendPreview(stop = false) {
    clearTimeout(previewTimer);
    if (!canPreview || !port) return;
    latestRequest = ++requestId;
    port.postMessage({ type: stop ? "STOP" : "PREVIEW", tabId: tab.id, host, original: !stop && draftOriginal, profile: draftOriginal ? null : draft, request: latestRequest });
  }
  function changed() {
    draftOriginal = false; draft = T.normalizeProfile(draft); dirty = true; renderDraft();
    if (canPreview && $("live-preview").checked) {
      clearTimeout(previewTimer); previewTimer = setTimeout(() => sendPreview(), 100);
    } else tell("Ready when you are. Apply to save your choice.");
  }
  function selectScope(next) {
    sendPreview(true); scope = next; dirty = false; draftOriginal = false;
    $("scope-site").setAttribute("aria-pressed", String(scope === "site"));
    $("scope-global").setAttribute("aria-pressed", String(scope === "global"));
    draft = T.normalizeProfile(scope === "global" ? settings.global : settings.sites[host]?.profile || settings.global);
    setStatus(); renderDraft();
    tell(scope === "global" ? "Website-specific choices keep their own look." : "Saved for this exact hostname, across all its pages.");
  }
  $("scope-site").addEventListener("click", () => selectScope("site"));
  $("scope-global").addEventListener("click", () => selectScope("global"));
  $("search").addEventListener("input", renderFonts);
  $("scale").addEventListener("input", () => { draft.scale = Number($("scale").value); changed(); });
  $("line-height").addEventListener("change", () => { draft.lineHeight = Number($("line-height").value); changed(); });
  $("letter-spacing").addEventListener("input", () => { draft.letterSpacing = Number($("letter-spacing").value) / 100; changed(); });
  $("word-spacing").addEventListener("input", () => { draft.wordSpacing = Number($("word-spacing").value) / 100; changed(); });
  $("preserve-code").addEventListener("change", () => { draft.preserveCode = $("preserve-code").checked; changed(); });
  $("target").addEventListener("change", () => { draft.target = $("target").value; changed(); });
  $("reset-tuning").addEventListener("click", () => { draft = { ...T.defaultProfile(), fontId: draft.fontId, customFont: draft.customFont }; changed(); });
  $("use-custom").addEventListener("click", () => {
    const name = $("custom-font").value.trim();
    if (!T.localFontName(name)) return tell("Enter a valid installed font family name (up to 80 characters).", true);
    draft.fontId = "custom"; draft.customFont = name; changed();
  });
  $("custom-font").addEventListener("keydown", event => { if (event.key === "Enter") $("use-custom").click(); });
  $("live-preview").addEventListener("change", () => {
    if (!$("live-preview").checked) { sendPreview(true); tell("Preview off. Your saved settings are restored."); }
    else if (dirty) sendPreview();
  });
  $("save").addEventListener("click", safely(async () => {
    $("save").disabled = true;
    try {
      if (scope === "site" && T.hostname((await api.tabs.get(tab.id)).url) !== host) throw new Error("The page changed. Reopen Typewell before saving.");
      if (scope === "site" && draftOriginal) settings = await update({ type: settings.global ? "skipSite" : "removeSite", host });
      else settings = await update({ type: scope === "site" ? "saveSite" : "saveGlobal", host, profile: draft });
      dirty = false; sendPreview(true); setStatus();
      tell(!settings.enabled ? "Saved. Resume Typewell to apply your fonts." : scope === "site" && draftOriginal ? "Saved. This website will use its original fonts." : scope === "global" && settings.sites[host] ? "Default saved. This website keeps its own rule." : "Saved. A little more you, every visit.");
    } finally { setStatus(); }
  }));
  $("original").addEventListener("click", safely(async () => {
    if (scope === "global") {
      settings = await update({ type: "clearGlobal" });
      sendPreview(true); dirty = false; setStatus();
      tell("Default cleared. Website-specific choices stay saved.");
      return;
    }
    draftOriginal = true; dirty = true; setStatus(); renderDraft();
    if (canPreview && $("live-preview").checked) sendPreview();
    else tell("Website original selected. Apply to save it.");
  }));
  $("power").addEventListener("click", safely(async () => {
    settings = await update({ type: "enabled", enabled: !settings.enabled });
    sendPreview(true); dirty = false; setStatus(); tell(settings.enabled ? "Typewell is back on." : "Paused everywhere. Your choices are still saved.");
  }));
  for (const id of ["settings", "manage"]) $(id).addEventListener("click", safely(async () => { await api.runtime.openOptionsPage(); window.close(); }));
  function showPanel(name) {
    for (const panel of ["fonts", "tune"]) { $(`${panel}-panel`).hidden = panel !== name; $(`${panel}-tab`).setAttribute("aria-selected", String(panel === name)); $(`${panel}-tab`).tabIndex = panel === name ? 0 : -1; }
  }
  for (const panel of ["fonts", "tune"]) {
    $(`${panel}-tab`).addEventListener("click", () => showPanel(panel));
    $(`${panel}-tab`).addEventListener("keydown", event => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "fonts" : event.key === "End" ? "tune" : panel === "fonts" ? "tune" : "fonts"; showPanel(next); $(`${next}-tab`).focus(); }
    });
  }
  $("grant-access").addEventListener("click", safely(async () => {
    const granted = await api.permissions.request({ origins: ["http://*/*", "https://*/*"] });
    if (granted) { $("permission-notice").hidden = true; await connectPage(); setStatus(); tell("Website access enabled."); }
  }));
  async function connectPage() {
    if (!host) return;
    try { await T.sendTabMessage(tab.id, { type: "PING" }, { frameId: 0 }); }
    catch {
      try { await api.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["shared/compat.js", "shared/catalog.js", "shared/model.js", "content/engine.js", "content/content.js"] }); }
      catch { canPreview = false; return; }
    }
    const result = await T.sendTabMessage(tab.id, { type: "PING" }, { frameId: 0 });
    canPreview = result?.ok === true;
    if (result?.error) tell(result.error, true);
  }
  async function init() {
    settings = await T.sendMessage({ type: "GET_SETTINGS" });
    [tab] = await api.tabs.query({ active: true, currentWindow: true });
    host = T.hostname(tab?.url);
    if (!host) scope = "global";
    $("permission-notice").hidden = await api.permissions.contains({ origins: ["http://*/*", "https://*/*"] });
    await connectPage();
    port = api.runtime.connect({ name: "typewell-preview" });
    port.onMessage.addListener(message => {
      if (message.request !== latestRequest) return;
      if (!message.ok) tell(message.error || "Preview unavailable on this page.", true);
      else if (dirty && $("live-preview").checked) tell("Previewing on page. Apply to keep this look.");
    });
    port.onDisconnect.addListener(() => { port = null; canPreview = false; setStatus(); tell("Connection closed. Reopen Typewell to preview.", true); });
    setInterval(() => { if (port) port.postMessage({ type: "KEEP_ALIVE" }); }, 10000);
    $("font-count").textContent = T.fonts.length;
    for (const [key, name] of Object.entries(T.categories)) {
      const button = document.createElement("button"); button.textContent = name; button.dataset.category = key; button.setAttribute("aria-pressed", String(key === category));
      button.addEventListener("click", () => { category = key; for (const other of $("categories").children) other.setAttribute("aria-pressed", String(other === button)); renderFonts(); });
      $("categories").append(button);
    }
    selectScope(scope); renderFonts(); showPanel("fonts");
    if (!canPreview) tell("Your browser protects this page. You can still set your default font.");
  }
  init().catch(error => tell(`Could not load Typewell: ${error.message}`, true));
})();
