/* Shared extension APIs. Callback responses also work in Chromium versions
   that cannot return promises from runtime.onMessage listeners. */
(() => {
  const T = globalThis.Typewell = globalThis.Typewell || {};
  if (T.api) return;
  const api = globalThis.browser || globalThis.chrome;
  if (!api?.runtime) throw new Error("Typewell requires a browser extension context.");
  T.api = api;
  const unwrap = response => {
    if (response?.__typewellError) throw new Error(response.__typewellError);
    return response;
  };
  T.sendMessage = (...args) => api.runtime.sendMessage(...args).then(unwrap);
  T.sendTabMessage = (...args) => api.tabs.sendMessage(...args).then(unwrap);
  T.listenMessages = handler => {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      let response;
      try { response = handler(message, sender); }
      catch (error) { response = Promise.reject(error); }
      // Ignore unrelated messages without claiming their response channel.
      if (response === undefined) return false;
      Promise.resolve(response).then(sendResponse, error => {
        sendResponse({ __typewellError: error?.message || String(error) });
      });
      return true;
    });
  };
})();
