(() => {
  const T = globalThis.Typewell;
  const api = T.api;
  if (T.contentStarted) return;
  T.contentStarted = true;
  const engine = new T.FontEngine((previous, profile) => T.sendMessage({ type: "STYLE", previous, profile }), path => api.runtime.getURL(path));
  let context = null;
  let preview = null;
  let error = null;
  let work = Promise.resolve();
  const apply = () => {
    const task = work.then(async () => {
      const profile = preview ? preview.profile : (context && T.resolveProfile(context.settings, context.host));
      await engine.apply(profile || null, context?.host || null);
      error = null;
      return { ok: true };
    });
    work = task.catch(cause => { error = cause.message; });
    return task.catch(cause => ({ ok: false, error: cause.message }));
  };
  const load = async () => {
    context = await T.sendMessage({ type: "CONTEXT" });
    return apply();
  };
  T.listenMessages(message => {
    if (message.type === "PING") return Promise.resolve({ ok: true, error, host: context?.host });
    if (message.type === "PREVIEW") {
      preview = { id: message.id, profile: message.original === true ? null : T.normalizeProfile(message.profile) };
      return apply();
    }
    if (message.type === "RESTORE" && preview?.id === message.id) {
      preview = null;
      return load();
    }
  });
  api.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) load().catch(cause => { error = cause.message; });
  });
  load().catch(cause => { error = cause.message; });
})();
