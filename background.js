// MoxTags - Background Service Worker
// Proxies cross-origin fetch requests from the content script.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetch') {
    doFetch(msg.url, msg.options || {})
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep message channel open for async response
  }
});

async function doFetch(url, options) {
  try {
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      credentials: 'omit',
    });

    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}`, status: resp.status };
    }

    const body = await resp.text();
    return { ok: true, body, status: resp.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
