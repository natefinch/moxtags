// Moxfield page interaction — Moxfield API helpers.
//
// Provides utilities for looking up card data via the Moxfield API,
// proxied through the MAIN-world script (page_hook.js) via postMessage.

/**
 * Look up a card's set/cn by Moxfield card ID, proxied through
 * the MAIN-world page_hook.js script via window.postMessage.
 *
 * @param {string} cardId - The Moxfield card ID.
 * @param {Object} options
 * @param {Map} options.cache - In-memory cache of cardId → { set, cn }.
 * @param {Function} [options.onResolved] - Callback when a card is resolved (for persisting).
 * @param {number} [options.timeoutMs] - Timeout in ms (default: 5000).
 * @param {Function} [options.logFn] - Optional logging function.
 * @returns {Promise<{ set: string, cn: string }|null>}
 */
export function lookupCardByMoxfieldId(cardId, options = {}) {
  const cache = options.cache;
  const onResolved = options.onResolved || (() => {});
  const timeoutMs = options.timeoutMs || 5000;
  const win = options.window ?? window;
  const log = options.logFn || (() => {});

  // Check in-memory cache first.
  if (cache) {
    const cached = cache.get(cardId);
    if (cached) {
      log('Card lookup cache hit:', cardId, '→', cached.set, cached.cn);
      return Promise.resolve(cached);
    }
  }

  return new Promise((resolve) => {
    const requestId = `${cardId}-${Date.now()}`;
    const timeout = setTimeout(() => {
      win.removeEventListener('message', handler);
      log('Card lookup timed out for', cardId);
      resolve(null);
    }, timeoutMs);

    function handler(e) {
      if (e.data?.type !== 'moxtags-card-result' || e.data.requestId !== requestId) return;
      win.removeEventListener('message', handler);
      clearTimeout(timeout);
      if (e.data.error || !e.data.set || !e.data.cn) {
        log('Card lookup failed:', cardId, e.data.error || 'missing set/cn');
        resolve(null);
      } else {
        const result = { set: e.data.set, cn: e.data.cn };
        log('Card lookup resolved:', cardId, '→', result.set, result.cn);
        if (cache) {
          cache.set(cardId, result);
        }
        onResolved(cardId, result);
        resolve(result);
      }
    }

    win.addEventListener('message', handler);
    win.postMessage({ type: 'moxtags-card-lookup', cardId, requestId }, '*');
  });
}
