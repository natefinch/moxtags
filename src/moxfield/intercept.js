// Moxfield page interaction — Deck data interception utilities.
//
// Reads deck JSON that was intercepted by a MAIN-world script
// (page_hook.js) and published to the DOM via hidden elements
// and data attributes.

/**
 * Read the intercepted deck JSON from a hidden DOM element.
 *
 * @param {Object} [options]
 * @param {string} [options.elementId] - ID of the hidden element (default: 'moxtags-deck-json').
 * @param {Function} [options.logFn] - Optional logging function.
 * @returns {Object|null} The parsed deck JSON, or null if not found/invalid.
 */
export function readInterceptedDeck(options = {}) {
  const elementId = options.elementId || 'moxtags-deck-json';
  const log = options.logFn || (() => {});

  const el = document.getElementById(elementId);
  log('readInterceptedDeck: element found:', !!el);
  if (!el) return null;
  const text = el.textContent;
  log('readInterceptedDeck: textContent length:', text ? text.length : 0);
  try {
    const data = JSON.parse(text);
    const keys = data ? Object.keys(data) : [];
    log('readInterceptedDeck: parsed OK, top-level keys:', keys.slice(0, 15).join(', '));
    return data;
  } catch (e) {
    log('readInterceptedDeck: JSON parse error:', e.message);
    return null;
  }
}

/**
 * Wait for the MAIN-world script to publish intercepted deck data.
 * The hook sets a data attribute on <html> to "ready" when the data
 * is available. Watches via MutationObserver with a timeout.
 *
 * @param {Object} [options]
 * @param {string} [options.elementId] - ID of the hidden element (default: 'moxtags-deck-json').
 * @param {string} [options.attrName] - Data attribute to watch (default: 'data-moxtags-deck').
 * @param {number} [options.timeoutMs] - Timeout in ms (default: 12000).
 * @param {Function} [options.logFn] - Optional logging function.
 * @returns {Promise<Object|null>} The parsed deck JSON, or null on timeout.
 */
export function waitForInterceptedDeck(options = {}) {
  const elementId = options.elementId || 'moxtags-deck-json';
  const attrName = options.attrName || 'data-moxtags-deck';
  const timeoutMs = options.timeoutMs || 12000;
  const log = options.logFn || (() => {});

  return new Promise((resolve) => {
    const attrVal = document.documentElement.getAttribute(attrName);
    log('waitForInterceptedDeck: current attr value:', JSON.stringify(attrVal));

    if (attrVal === 'ready') {
      log('waitForInterceptedDeck: data already ready, reading now');
      return resolve(readInterceptedDeck({ elementId, logFn: log }));
    }

    log('waitForInterceptedDeck: setting up MutationObserver, timeout:', timeoutMs, 'ms');
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        log('waitForInterceptedDeck: mutation detected –',
          m.attributeName, '=', document.documentElement.getAttribute(m.attributeName));
      }
      if (document.documentElement.getAttribute(attrName) === 'ready') {
        log('waitForInterceptedDeck: ready signal received via MutationObserver');
        obs.disconnect();
        clearTimeout(timer);
        resolve(readInterceptedDeck({ elementId, logFn: log }));
      }
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [attrName],
    });

    const timer = setTimeout(() => {
      obs.disconnect();
      const finalVal = document.documentElement.getAttribute(attrName);
      log('waitForInterceptedDeck: TIMED OUT after', timeoutMs, 'ms. Final attr:', JSON.stringify(finalVal));
      const domEl = document.getElementById(elementId);
      log('waitForInterceptedDeck: element exists at timeout:', !!domEl);
      if (finalVal === 'ready') {
        log('waitForInterceptedDeck: attr is ready at timeout – reading anyway');
        resolve(readInterceptedDeck({ elementId, logFn: log }));
      } else {
        resolve(null);
      }
    }, timeoutMs);
  });
}
