// MoxTags – Page Hook (runs in the MAIN world at document_start)
// Intercepts Moxfield's own deck API responses so the content script
// can read the full deck JSON (including set/collector_number for every
// card) even on private decks where direct API calls fail.

(function () {
  'use strict';

  const TAG = '[MoxTags Hook]';

  // Regex matching Moxfield deck API URLs (v2 or v3).
  const DECK_API_RE = /\/v[23]\/decks\/all\/[A-Za-z0-9_-]+/;

  let deckDataPublished = false;

  console.log(TAG, 'Page hook loaded at', new Date().toISOString());

  /**
   * Publish the intercepted deck JSON to the content script by storing it
   * in a shared DOM element (a hidden <script type="application/json">).
   */
  function publishDeckData(json) {
    if (deckDataPublished) {
      console.log(TAG, 'publishDeckData called but already published – skipping');
      return;
    }
    deckDataPublished = true;

    const keys = Object.keys(json);
    console.log(TAG, 'Publishing deck data. Top-level keys:', keys.join(', '));
    console.log(TAG, 'mainboard type:', typeof json.mainboard,
      json.mainboard ? '(' + Object.keys(json.mainboard).length + ' entries)' : '(missing)');

    // Write the JSON into a hidden DOM element the content script can read.
    const el = document.createElement('script');
    el.type = 'application/json';
    el.id = 'moxtags-deck-json';
    const jsonStr = JSON.stringify(json);
    el.textContent = jsonStr;
    console.log(TAG, 'JSON size:', jsonStr.length, 'chars');
    (document.head || document.documentElement).appendChild(el);

    // Verify it was inserted
    const verify = document.getElementById('moxtags-deck-json');
    console.log(TAG, 'DOM element inserted:', !!verify,
      verify ? 'textContent length=' + verify.textContent.length : '');

    // Set a flag attribute so content.js knows the data is available.
    document.documentElement.setAttribute('data-moxtags-deck', 'ready');
    console.log(TAG, 'data-moxtags-deck attribute set to "ready"');
  }

  /**
   * Check whether a response body looks like valid deck data and publish it.
   */
  function checkAndPublish(data, source) {
    if (!data || typeof data !== 'object') {
      console.log(TAG, source, '– response is not an object:', typeof data);
      return;
    }
    const keys = Object.keys(data);
    console.log(TAG, source, '– response keys:', keys.slice(0, 20).join(', '),
      keys.length > 20 ? '(+' + (keys.length - 20) + ' more)' : '');

    // Check for board properties directly on the object (Moxfield v3 format).
    const boardNames = ['mainboard', 'sideboard', 'commanders', 'companions'];
    const foundBoards = boardNames.filter(b => b in data);
    console.log(TAG, source, '– found board keys:', foundBoards.join(', ') || '(none)');

    // Also check for a nested "boards" wrapper (in case the API wraps them).
    if (data.boards && typeof data.boards === 'object') {
      console.log(TAG, source, '– has data.boards wrapper, keys:',
        Object.keys(data.boards).join(', '));
    }

    // Accept the data if it has any of the expected board properties.
    if (foundBoards.length > 0 || (data.boards && typeof data.boards === 'object')) {
      // If boards are nested under data.boards, unwrap for content.js
      publishDeckData(data);
    } else {
      console.log(TAG, source, '– does NOT look like deck data, skipping');
    }
  }

  // ─── Intercept fetch() ─────────────────────────────────────────────
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let result;
    try {
      result = origFetch.apply(this, arguments);
    } catch (e) {
      throw e;
    }

    try {
      const url = typeof input === 'string'
        ? input
        : input instanceof Request ? input.url : String(input);

      const matches = DECK_API_RE.test(url);
      if (matches) {
        console.log(TAG, 'fetch() matched deck API:', url,
          'published:', deckDataPublished);
      }

      if (!deckDataPublished && matches) {
        result.then(resp => {
          console.log(TAG, 'fetch() response for', url,
            '– status:', resp.status, resp.statusText);
          if (!resp.ok) {
            console.log(TAG, 'fetch() response not ok, skipping');
            return;
          }
          resp.clone().json()
            .then(data => {
              checkAndPublish(data, 'fetch(' + url + ')');
            })
            .catch(err => {
              console.warn(TAG, 'fetch() JSON parse error:', err.message);
            });
        }).catch(err => {
          console.warn(TAG, 'fetch() promise rejected:', err.message);
        });
      }
    } catch (e) {
      console.warn(TAG, 'fetch() intercept error:', e.message);
    }

    return result;
  };

  // ─── Intercept XMLHttpRequest ──────────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._moxtags_url = typeof url === 'string' ? url : String(url);

    const matches = DECK_API_RE.test(this._moxtags_url);
    if (matches) {
      console.log(TAG, 'XHR.open() matched deck API:', method, this._moxtags_url,
        'published:', deckDataPublished);
    }

    if (!deckDataPublished && matches) {
      this.addEventListener('load', function () {
        console.log(TAG, 'XHR load for', this._moxtags_url,
          '– status:', this.status);
        try {
          if (this.status >= 200 && this.status < 300) {
            const data = JSON.parse(this.responseText);
            checkAndPublish(data, 'XHR(' + this._moxtags_url + ')');
          } else {
            console.log(TAG, 'XHR status not 2xx, skipping');
          }
        } catch (e) {
          console.warn(TAG, 'XHR parse error:', e.message);
        }
      });
    }

    return origOpen.apply(this, arguments);
  };

  console.log(TAG, 'fetch() and XHR interceptors installed');

  // ─── Reset on SPA navigation ──────────────────────────────────────
  // When the content script cleans up (SPA navigation to a new deck),
  // it removes the data-moxtags-deck attribute.  Watch for that removal
  // so we can intercept the next deck's API response.
  const resetObs = new MutationObserver(() => {
    const val = document.documentElement.getAttribute('data-moxtags-deck');
    if (deckDataPublished && val === null) {
      console.log(TAG, 'data-moxtags-deck removed — resetting for next deck');
      deckDataPublished = false;
      // Also remove the old JSON element if it's still around.
      const old = document.getElementById('moxtags-deck-json');
      if (old) old.remove();
    }
  });
  resetObs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-moxtags-deck'],
  });
})();
