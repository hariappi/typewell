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
  let changedSinceLoad = false;
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      changedSinceLoad = true;
      apply(changes.settings.newValue?.theme);
    }
  });
  // A newer change must win even if the initial read resolves or fails later.
  api.storage.local.get("settings")
    .then(({ settings }) => { if (!changedSinceLoad) apply(settings?.theme); })
    .catch(() => { if (!changedSinceLoad) apply("system"); });
})();
