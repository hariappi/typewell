(() => {
  const api = globalThis.Typewell.api;
  const choices = new Set(["system", "light", "dark"]);
  const apply = value => {
    const theme = choices.has(value) ? value : "system";
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = theme;
    return theme;
  };
  globalThis.TypewellTheme = { apply };
  api.storage.local.get("settings")
    .then(({ settings }) => apply(settings?.theme))
    .catch(() => apply("system"));
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) apply(changes.settings.newValue?.theme);
  });
})();
