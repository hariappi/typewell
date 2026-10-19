(() => {
  const T = globalThis.Typewell;
  const api = T.api;
  const $ = id => document.getElementById(id);
  let settings = T.defaultSettings(), pendingImport = null, toastTimer = null;
  const tell = (text, error = false) => { clearTimeout(toastTimer); $("message").textContent = text; $("message").classList.toggle("error", error); $("message").hidden = false; toastTimer = setTimeout(() => { $("message").hidden = true; }, 6500); };
  const safely = fn => async (...args) => { try { await fn(...args); } catch (error) { tell(error.message, true); } };
  const update = async operation => { settings = await T.sendMessage({ type: "UPDATE", operation }); render(); };
  function render() {
    $("enabled").checked = settings.enabled;
    $("enabled-title").textContent = settings.enabled ? "Typewell is on" : "Taking a little break";
    $("enabled-detail").textContent = settings.enabled ? "Your saved choices follow you as you browse." : "Your fonts are paused everywhere. All your choices are still saved.";
    for (const button of document.querySelectorAll("[data-theme-choice]")) button.setAttribute("aria-pressed", String(button.dataset.themeChoice === settings.theme));
    $("total-fonts").textContent = T.fonts.length;
    $("total-sites").textContent = Object.keys(settings.sites).length;
    $("global-name").textContent = T.profileName(settings.global);
    $("global-glyph").style.fontFamily = settings.global ? T.fontStack(settings.global) : '"Typewell Lora", serif';
    $("global-detail").textContent = settings.global ? `${settings.global.scale}% text size · ${settings.global.lineHeight ? `${settings.global.lineHeight} line height` : "Original line spacing"}` : "Choose “All websites” in the toolbar to set a default.";
    $("clear-global").hidden = !settings.global;
    $("font-description").textContent = `${T.fonts.filter(font => font.bundled).length} open-source fonts travel with Typewell. No font services, no requests as you browse.`;
    const fragment = document.createDocumentFragment();
    const rules = Object.entries(settings.sites).filter(([host]) => host.includes($("site-search").value.trim().toLowerCase())).sort(([a], [b]) => a.localeCompare(b));
    for (const [host, rule] of rules) {
      const row = document.createElement("div"); row.className = "site-row";
      const initial = document.createElement("span"); initial.className = "site-initial"; initial.textContent = host.replace(/^www\./, "").slice(0, 1).toUpperCase(); initial.setAttribute("aria-hidden", "true");
      const details = document.createElement("div"); details.className = "site-details";
      const name = document.createElement("strong"); name.textContent = host;
      const summary = document.createElement("span"); summary.textContent = rule.disabled ? "Website original · Excluded from your default" : `${T.profileName(rule.profile)} · ${rule.profile.scale}% text size`;
      details.append(name, summary);
      const remove = document.createElement("button"); remove.className = "secondary"; remove.textContent = "Remove rule"; remove.setAttribute("aria-label", `Remove rule for ${host}`);
      remove.addEventListener("click", safely(async () => { await update({ type: "removeSite", host }); tell(`${host} now follows your global default.`); }));
      row.append(initial, details, remove); fragment.append(row);
    }
    if (!rules.length) { const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = $("site-search").value ? "No websites match your search." : "A fresh page. Open Typewell on a website to give it a look of its own."; fragment.append(empty); }
    $("site-list").replaceChildren(fragment);
  }
  $("enabled").addEventListener("change", safely(async () => { await update({ type: "enabled", enabled: $("enabled").checked }); tell(settings.enabled ? "Your fonts are back on." : "Paused everywhere. Your choices are saved."); }));
  for (const button of document.querySelectorAll("[data-theme-choice]")) button.addEventListener("click", safely(async () => {
    await update({ type: "theme", theme: button.dataset.themeChoice });
    tell(button.dataset.themeChoice === "system" ? "Typewell now follows your system appearance." : `${button.textContent} theme selected.`);
  }));
  $("clear-global").addEventListener("click", safely(async () => { await update({ type: "clearGlobal" }); tell("Default cleared. Website-specific choices are still saved."); }));
  $("site-search").addEventListener("input", render);
  $("export").addEventListener("click", safely(async () => {
    const current = await T.sendMessage({ type: "GET_SETTINGS" });
    const blob = new Blob([JSON.stringify(current, null, 2) + "\n"], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `typewell-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    tell("Your settings backup is ready to save.");
  }));
  $("import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", safely(async () => {
    const file = $("import-file").files[0]; $("import-file").value = "";
    if (!file) return;
    if (file.size > 1024 * 1024) throw new Error("This backup is too large. Typewell backups must be under 1 MB.");
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch { throw new Error("This file is not valid JSON. Choose a Typewell settings backup."); }
    pendingImport = T.validateImport(parsed);
    $("import-summary").textContent = `This backup includes ${Object.keys(pendingImport.sites).length} website rules and ${pendingImport.favorites.length} favorites. Default: ${T.profileName(pendingImport.global)}.`;
    $("import-dialog").showModal();
  }));
  $("cancel-import").addEventListener("click", () => { pendingImport = null; $("import-dialog").close(); });
  $("import-dialog").addEventListener("cancel", () => { pendingImport = null; });
  $("confirm-import").addEventListener("click", safely(async () => {
    if (!pendingImport) return;
    $("confirm-import").disabled = true;
    try { await update({ type: "import", settings: pendingImport }); pendingImport = null; $("import-dialog").close(); tell("Welcome back. Your preferences are restored."); }
    finally { $("confirm-import").disabled = false; }
  }));
  for (const link of document.querySelectorAll("nav a")) link.addEventListener("click", () => { document.querySelector(".nav-current")?.classList.remove("nav-current"); link.classList.add("nav-current"); });
  $("extension-version").textContent = `TYPEWELL · ${api.runtime.getManifest().version}`;
  api.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.settings) { settings = T.normalizeSettings(changes.settings.newValue); render(); } });
  T.sendMessage({ type: "GET_SETTINGS" }).then(value => { settings = value; render(); }).catch(error => tell(error.message, true));
})();
