(() => {
  const T = globalThis.Typewell;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  T.defaultProfile = () => ({ fontId: "inter", customFont: "", scale: 100, lineHeight: 0,
    letterSpacing: 0, wordSpacing: 0, preserveCode: true, target: "all" });
  T.defaultSettings = () => ({ version: 1, enabled: true, theme: "system", global: null, sites: {}, favorites: [] });
  T.hostname = url => {
    try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.hostname.toLowerCase() : null; }
    catch { return null; }
  };
  T.stylesEditableContent = host => typeof host === "string" &&
    (host === "notion.so" || host.endsWith(".notion.so") || host === "notion.site" || host.endsWith(".notion.site"));
  T.validHost = host => typeof host === "string" && host.length <= 253 &&
    !["__proto__", "prototype", "constructor"].includes(host) &&
    !/[\s/\\?#@]/.test(host) && T.hostname(`https://${host}`) === host;
  T.localFontName = value => typeof value === "string" && value.trim().length > 0 && value.length <= 80 &&
    /^[\p{L}\p{N} _.'()\-]+$/u.test(value);
  T.normalizeProfile = input => {
    const value = input && typeof input === "object" ? input : {};
    const profile = T.defaultProfile();
    if (own(T.fontById, value.fontId)) profile.fontId = value.fontId;
    if (value.fontId === "custom" && T.localFontName(value.customFont)) {
      profile.fontId = "custom"; profile.customFont = value.customFont.trim();
    }
    for (const [key, min, max] of [["scale", 75, 175], ["lineHeight", 0, 2.5], ["letterSpacing", 0, 0.2], ["wordSpacing", 0, 0.5]]) {
      if (typeof value[key] === "number" && Number.isFinite(value[key])) profile[key] = Math.min(max, Math.max(min, value[key]));
    }
    if (profile.lineHeight > 0 && profile.lineHeight < 1) profile.lineHeight = 1;
    profile.preserveCode = value.preserveCode !== false;
    profile.target = value.target === "reading" ? "reading" : "all";
    return profile;
  };
  T.normalizeSettings = input => {
    const result = T.defaultSettings();
    if (!input || typeof input !== "object") return result;
    result.enabled = input.enabled !== false;
    result.theme = ["system", "light", "dark"].includes(input.theme) ? input.theme : "system";
    result.global = input.global ? T.normalizeProfile(input.global) : null;
    for (const [host, rule] of Object.entries(input.sites || {}).slice(0, 2000)) {
      if (!T.validHost(host) || !rule || typeof rule !== "object") continue;
      result.sites[host] = rule.disabled === true ? { disabled: true } : { profile: T.normalizeProfile(rule.profile) };
    }
    result.favorites = [...new Set((Array.isArray(input.favorites) ? input.favorites : []).filter(id => own(T.fontById, id)))];
    return result;
  };
  T.resolveProfile = (settings, host) => {
    if (!settings.enabled || !host) return null;
    if (own(settings.sites, host)) return settings.sites[host].disabled ? null : settings.sites[host].profile;
    return settings.global;
  };
  T.profileName = profile => !profile ? "Website original" : profile.fontId === "custom" ? profile.customFont : T.fontById[profile.fontId]?.name || "Inter";
  T.cssString = value => `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replace(/[\n\r\f]/g, " ")}"`;
  T.fontStack = profile => {
    const font = T.fontById[profile.fontId];
    if (profile.fontId === "custom") return `${T.cssString(profile.customFont)}, sans-serif`;
    if (font.family === "system-ui") return "system-ui, sans-serif";
    return `${T.cssString(font.family)}, ${font.fallback || (font.category === "mono" ? "monospace" : font.category === "serif" ? "serif" : "sans-serif")}`;
  };
  T.engineCSS = input => {
    const p = T.normalizeProfile(input);
    return `[data-typewell-text] { font-family: ${T.fontStack(p)} !important; ${p.scale !== 100 ? `font-size: calc(var(--typewell-size) * ${p.scale / 100}) !important;` : ""}
      ${p.lineHeight ? `line-height: ${p.lineHeight} !important;` : ""}
      ${p.letterSpacing ? `letter-spacing: ${p.letterSpacing}em !important;` : ""}
      ${p.wordSpacing ? `word-spacing: ${p.wordSpacing}em !important;` : ""} }
      [data-typewell-keep] { font-family: var(--typewell-keep-font) !important; font-size: var(--typewell-keep-size) !important;
        line-height: var(--typewell-keep-line) !important; letter-spacing: var(--typewell-keep-letter) !important; word-spacing: var(--typewell-keep-word) !important; }
      [data-typewell-before]::before { font-family: var(--typewell-before-font) !important; font-size: var(--typewell-before-size) !important; letter-spacing: normal !important; }
      [data-typewell-after]::after { font-family: var(--typewell-after-font) !important; font-size: var(--typewell-after-size) !important; letter-spacing: normal !important; }`;
  };
  T.applyOperation = (input, operation) => {
    const state = T.normalizeSettings(input);
    const { type, host, profile } = operation || {};
    if (["saveSite", "skipSite", "removeSite"].includes(type) && !T.validHost(host)) throw new Error("Open a regular website first.");
    switch (type) {
      case "saveSite": state.sites[host] = { profile: T.normalizeProfile(profile) }; break;
      case "saveGlobal": state.global = T.normalizeProfile(profile); break;
      case "skipSite": state.sites[host] = { disabled: true }; break;
      case "removeSite": delete state.sites[host]; break;
      case "clearGlobal": state.global = null; break;
      case "enabled": state.enabled = operation.enabled === true; break;
      case "theme": state.theme = ["system", "light", "dark"].includes(operation.theme) ? operation.theme : "system"; break;
      case "favorite": {
        if (!own(T.fontById, operation.fontId)) throw new Error("Unknown font.");
        const values = new Set(state.favorites);
        if (operation.favorite) values.add(operation.fontId); else values.delete(operation.fontId);
        state.favorites = [...values]; break;
      }
      case "import": return T.validateImport(operation.settings);
      default: throw new Error("Unknown settings action.");
    }
    return state;
  };
  T.validateImport = input => {
    if (!input || typeof input !== "object" || Array.isArray(input) || input.version !== 1 ||
      typeof input.enabled !== "boolean" || !input.sites || typeof input.sites !== "object" || Array.isArray(input.sites) ||
      !Array.isArray(input.favorites) || Object.keys(input.sites).length > 2000) throw new Error("This is not a supported Typewell backup.");
    if (own(input, "theme") && !["system", "light", "dark"].includes(input.theme)) throw new Error("The backup contains an invalid theme.");
    const validate = profile => {
      if (!profile || typeof profile !== "object" || Array.isArray(profile) ||
        !(own(T.fontById, profile.fontId) || (profile.fontId === "custom" && T.localFontName(profile.customFont)))) throw new Error("The backup contains an invalid font.");
      for (const [key, min, max] of [["scale", 75, 175], ["lineHeight", 0, 2.5], ["letterSpacing", 0, 0.2], ["wordSpacing", 0, 0.5]]) {
        if (typeof profile[key] !== "number" || !Number.isFinite(profile[key]) || profile[key] < min || profile[key] > max ||
          (key === "lineHeight" && profile[key] > 0 && profile[key] < 1)) throw new Error("The backup contains an invalid spacing value.");
      }
      if (!["all", "reading"].includes(profile.target) || typeof profile.preserveCode !== "boolean") throw new Error("The backup contains an invalid preference.");
    };
    if (input.global !== null) validate(input.global);
    for (const [host, rule] of Object.entries(input.sites)) {
      if (!T.validHost(host) || !rule || typeof rule !== "object") throw new Error("The backup contains an invalid website.");
      if (rule.disabled !== true) validate(rule.profile);
    }
    if (!input.favorites.every(id => own(T.fontById, id))) throw new Error("The backup contains an unknown favorite.");
    return T.normalizeSettings(input);
  };
})();
