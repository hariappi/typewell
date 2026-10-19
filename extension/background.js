/* All writes pass through one queue so two extension windows cannot lose each other's changes. */
(() => {
  const T = globalThis.Typewell;
  const api = T.api;
  let writes = Promise.resolve();
  const read = async () => T.normalizeSettings((await api.storage.local.get("settings")).settings);
  const isUI = sender => sender.id === api.runtime.id && sender.url?.startsWith(api.runtime.getURL(""));
  const sendTab = (tabId, message) => T.sendTabMessage(tabId, message);
  T.listenMessages((message, sender) => {
    if (sender.id !== api.runtime.id || !message || typeof message !== "object") return;
    if (message.type === "CONTEXT") return read().then(settings => ({ settings, host: T.hostname(sender.tab?.url) }));
    if (message.type === "STYLE" && sender.tab && Number.isInteger(sender.frameId)) {
      return (async () => {
        const target = { tabId: sender.tab.id, frameIds: [sender.frameId] };
        const before = message.previous ? T.engineCSS(message.previous) : null;
        const after = message.profile ? T.engineCSS(message.profile) : null;
        if (before === after) return { ok: true };
        if (after) await api.scripting.insertCSS({ target, css: after, origin: "USER" });
        if (before) await api.scripting.removeCSS({ target, css: before, origin: "USER" });
        return { ok: true };
      })();
    }
    if (!isUI(sender)) return;
    if (message.type === "GET_SETTINGS") return writes.then(read);
    if (message.type === "UPDATE") {
      const result = writes.then(async () => {
        const settings = T.applyOperation(await read(), message.operation);
        await api.storage.local.set({ settings });
        return settings;
      });
      writes = result.catch(() => {});
      return result;
    }
  });
  api.runtime.onConnect.addListener(port => {
    if (port.name !== "typewell-preview" || !isUI(port.sender)) return;
    const id = crypto.randomUUID();
    let tabId = null;
    let queue = Promise.resolve();
    const reply = message => { try { port.postMessage(message); } catch { /* Popup has closed. */ } };
    port.onMessage.addListener(message => {
      if (message.type === "KEEP_ALIVE") return;
      queue = queue.then(async () => {
        if (!Number.isInteger(message.tabId)) throw new Error("No website to preview.");
        if (tabId !== null && tabId !== message.tabId) await sendTab(tabId, { type: "RESTORE", id }).catch(() => {});
        tabId = message.tabId;
        const tab = await api.tabs.get(tabId);
        if (T.hostname(tab.url) !== message.host) throw new Error("The page changed. Reopen Typewell on the new website.");
        const response = await sendTab(tabId, message.type === "STOP"
          ? { type: "RESTORE", id }
          : { type: "PREVIEW", id, original: message.original === true, profile: message.original === true ? null : T.normalizeProfile(message.profile) });
        if (response?.ok === false) throw new Error(response.error);
        reply({ ok: true, request: message.request });
      }).catch(error => reply({ ok: false, error: error.message, request: message.request }));
    });
    port.onDisconnect.addListener(() => {
      queue.then(() => tabId !== null && sendTab(tabId, { type: "RESTORE", id })).catch(() => {});
    });
  });
})();
