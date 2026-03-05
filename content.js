// MoxTags – Content Script
// Injects Scryfall Tagger art/card tags into Moxfield card context menus.

(function () {
  'use strict';

  // Tracks whether we are currently injecting, to debounce multiple detection paths.
  let injecting = false;

  // ─── State ──────────────────────────────────────────────────────────
  let deckId = null;
  let deckUrl = null;
  let cardMap = new Map();   // lowercase card name → { name, set, cn }
  let tagCache = new Map();  // "set/cn" → { artTags: [], cardTags: [] }
  let currentCard = null;    // info object of most-recently-clicked card
  let observer = null;
  let lastUrl = location.href;

  // ─── Bootstrap ──────────────────────────────────────────────────────
  init();

  function init() {
    deckId = extractDeckId();
    if (!deckId) return;
    deckUrl = location.origin + '/decks/' + deckId;
    log('Initializing for deck', deckId);

    fetchDeckData();

    // Track which card row the user clicked on.
    document.addEventListener('mousedown', onMouseDown, true);

    // Watch for new DOM nodes (the dropdown menu is inserted dynamically).
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden', 'hidden'],
    });

    // Re-init when the SPA navigates to a different deck.
    watchNavigation();
  }

  function cleanup() {
    log('cleanup: disconnecting observer, removing listeners');
    if (observer) observer.disconnect();
    document.removeEventListener('mousedown', onMouseDown, true);
    cardMap.clear();
    tagCache.clear();
    currentCard = null;

    // Remove stale page_hook data from a previous deck so the next
    // init cycle doesn't pick up old data.
    const staleEl = document.getElementById('moxtags-deck-json');
    if (staleEl) {
      log('cleanup: removing stale moxtags-deck-json element');
      staleEl.remove();
    }
    document.documentElement.removeAttribute('data-moxtags-deck');
    log('cleanup: removed data-moxtags-deck attribute');
  }

  function extractDeckId() {
    const m = location.pathname.match(/\/decks\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  // ─── Deck data ─────────────────────────────────────────────────────

  /**
   * Read the intercepted deck JSON that page_hook.js stored in a hidden
   * DOM element.  Returns the parsed object, or null if not found.
   */
  function readInterceptedDeck() {
    const el = document.getElementById('moxtags-deck-json');
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
      warn('readInterceptedDeck: JSON parse error:', e.message);
      return null;
    }
  }

  /**
   * Wait for page_hook.js to store the intercepted deck data in the DOM.
   * The hook sets data-moxtags-deck="ready" on <html> when the data is
   * available.  We watch for that attribute via MutationObserver.
   */
  function waitForInterceptedDeck(timeoutMs = 12000) {
    return new Promise((resolve) => {
      const attrVal = document.documentElement.getAttribute('data-moxtags-deck');
      log('waitForInterceptedDeck: current attr value:', JSON.stringify(attrVal));

      // Already available?
      if (attrVal === 'ready') {
        log('waitForInterceptedDeck: data already ready, reading now');
        return resolve(readInterceptedDeck());
      }

      log('waitForInterceptedDeck: setting up MutationObserver, timeout:', timeoutMs, 'ms');
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          log('waitForInterceptedDeck: mutation detected –',
            m.attributeName, '=', document.documentElement.getAttribute(m.attributeName));
        }
        if (document.documentElement.getAttribute('data-moxtags-deck') === 'ready') {
          log('waitForInterceptedDeck: ready signal received via MutationObserver');
          obs.disconnect();
          clearTimeout(timer);
          resolve(readInterceptedDeck());
        }
      });
      obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-moxtags-deck'],
      });

      const timer = setTimeout(() => {
        obs.disconnect();
        // Check one more time in case we missed it
        const finalVal = document.documentElement.getAttribute('data-moxtags-deck');
        log('waitForInterceptedDeck: TIMED OUT after', timeoutMs, 'ms. Final attr:', JSON.stringify(finalVal));
        const domEl = document.getElementById('moxtags-deck-json');
        log('waitForInterceptedDeck: moxtags-deck-json element exists at timeout:', !!domEl);
        if (finalVal === 'ready') {
          log('waitForInterceptedDeck: attr is ready at timeout – reading anyway');
          resolve(readInterceptedDeck());
        } else {
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  async function fetchDeckData() {
    log('fetchDeckData: starting, deckId =', deckId);

    // Start listening for the intercepted deck data immediately, so the
    // MutationObserver is active while we try the public API below.
    const interceptPromise = waitForInterceptedDeck(12000);

    // Strategy 1: Try the background-script fetch (public decks, fast path).
    const urls = [
      `https://api2.moxfield.com/v3/decks/all/${deckId}`,
      `https://api2.moxfield.com/v2/decks/all/${deckId}`,
    ];

    for (const url of urls) {
      log('fetchDeckData: Strategy 1 – trying', url);
      try {
        const text = await bgFetch(url);
        log('fetchDeckData: bgFetch returned', text.length, 'chars');
        const data = JSON.parse(text);
        const keys = data ? Object.keys(data) : [];
        log('fetchDeckData: parsed response keys:', keys.slice(0, 15).join(', '));
        if (buildCardMap(data)) {
          log('fetchDeckData: Strategy 1 SUCCESS');
          prefetchAllTags();
          return;
        }
        log('fetchDeckData: buildCardMap returned false for', url);
      } catch (e) {
        log('fetchDeckData: Strategy 1 failed for', url, '–', e.message);
      }
    }

    // Strategy 2: Wait for Moxfield's own fetch to be intercepted by
    // page_hook.js (works for private decks – their JS has auth).
    log('Public API failed – waiting for intercepted deck data…');
    log('fetchDeckData: Strategy 2 – awaiting interceptPromise…');
    const data = await interceptPromise;
    log('fetchDeckData: interceptPromise resolved, data is', data === null ? 'null' : typeof data);
    if (data) {
      const keys = Object.keys(data);
      log('fetchDeckData: intercepted data keys:', keys.slice(0, 15).join(', '));
    }
    if (data && buildCardMap(data)) {
      log('fetchDeckData: Strategy 2 SUCCESS');
      prefetchAllTags();
      return;
    }

    warn('Could not load deck data – tag injection will not work.');
  }

  /**
   * Walk every board in the deck JSON and populate `cardMap`.
   * Handles two API response shapes:
   *   v2: boards are top-level, entries have a `.card` wrapper
   *   v3: boards are nested under `data.boards`, entries are flat card objects
   *       (and also within each board, entries can be wrapped: { card: {...} }
   *        or the v3 board values can be { quantity, ..., card: {...} } style)
   * Returns true if at least one card was found.
   */
  function buildCardMap(data) {
    if (!data || typeof data !== 'object') {
      log('buildCardMap: invalid data –', data === null ? 'null' : typeof data);
      return false;
    }

    const boardNames = [
      'mainboard', 'sideboard', 'commanders', 'companions',
      'signatureSpells', 'considering', 'attractions',
      'stickers', 'contraptions', 'planes', 'schemes', 'tokens',
    ];

    log('buildCardMap: data top-level keys:', Object.keys(data).slice(0, 20).join(', '));

    // Determine where the boards live: under data.boards (v3) or top-level (v2).
    const boardSource = (data.boards && typeof data.boards === 'object')
      ? data.boards
      : data;
    log('buildCardMap: using', boardSource === data ? 'top-level' : 'data.boards', 'as board source');
    if (boardSource !== data) {
      log('buildCardMap: data.boards keys:', Object.keys(boardSource).join(', '));
    }

    for (const boardName of boardNames) {
      let board = boardSource[boardName];
      if (!board || typeof board !== 'object') continue;

      // v3 wraps each board as { count: N, cards: { id: {...}, … } }.
      // Unwrap to the inner cards object if present.
      if (board.cards && typeof board.cards === 'object') {
        log('buildCardMap: board', boardName, 'has .cards wrapper (count:', board.count, ')');
        board = board.cards;
      }

      const entries = Object.values(board);
      if (entries.length === 0) continue;
      log('buildCardMap: board', boardName, 'has', entries.length, 'entries');

      // Log the first entry's structure for debugging.
      const first = entries[0];
      if (first) {
        const firstKeys = Object.keys(first);
        log('buildCardMap: first entry in', boardName, '– keys:',
          firstKeys.slice(0, 15).join(', '), firstKeys.length > 15 ? '(+more)' : '');
        if (first.card) {
          log('buildCardMap:   → has .card wrapper – card.name:', first.card.name,
            'set:', first.card.set, 'cn:', first.card.cn);
        } else if (first.name) {
          log('buildCardMap:   → flat entry – name:', first.name,
            'set:', first.set, 'cn:', first.cn);
        }
      }

      for (const entry of entries) {
        // v2 format: { card: { name, set, cn, … }, quantity, … }
        // v3 format: the entry itself is the card object { name, set, cn, … }
        //   or sometimes: { quantity, boardType, card: { name, set, cn, … } }
        const card = entry?.card || entry;
        if (!card?.name) continue;

        const set = (card.set || card.setCode || '').toLowerCase();
        const cn  = String(card.cn || card.collector_number || card.collectorNumber || '');
        if (!set || !cn) {
          log('buildCardMap: skipping card', card.name, '– set:', set, 'cn:', cn);
          continue;
        }

        const info = { name: card.name, set, cn };
        cardMap.set(card.name.toLowerCase(), info);

        // For double-faced cards ("Front // Back"), also key by front face.
        if (card.name.includes(' // ')) {
          const front = card.name.split(' // ')[0].trim().toLowerCase();
          if (!cardMap.has(front)) cardMap.set(front, info);
        }
      }
    }

    log('Card lookup ready –', cardMap.size, 'entries');
    return cardMap.size > 0;
  }

  // ─── Prefetch tags for entire deck ─────────────────────────────────
  function prefetchAllTags() {
    // Collect unique set/cn pairs.
    const seen = new Set();
    const cards = [];
    for (const info of cardMap.values()) {
      const key = `${info.set}/${info.cn}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push({ set: info.set, cn: info.cn });
    }
    log('Prefetching tags for', cards.length, 'unique cards…');
    chrome.runtime.sendMessage({ type: 'prefetchDeck', cards }, (resp) => {
      if (chrome.runtime.lastError) {
        warn('Prefetch failed:', chrome.runtime.lastError.message);
        return;
      }
      if (resp?.ok && resp.tags) {
        for (const [key, tags] of Object.entries(resp.tags)) {
          tagCache.set(key, tags);
        }
        log('Prefetch complete –', tagCache.size, 'cards cached');
      } else {
        warn('Prefetch failed:', resp?.error);
      }
    });
  }

  // ─── Click tracking ────────────────────────────────────────────────
  function onMouseDown(e) {
    const name = identifyCard(e.target);
    if (name) {
      const info = cardMap.get(name.toLowerCase());
      if (info) {
        currentCard = info;
        log('Card context set →', info.name, `(${info.set}/${info.cn})`);
      }
    }
  }

  /**
   * Walk up from the clicked element and look for an element whose
   * trimmed textContent exactly matches a card name in the deck.
   */
  function identifyCard(el) {
    let node = el;
    for (let i = 0; i < 15 && node && node !== document.body; i++) {
      // Check anchor / span / div children for an exact card-name match.
      const found = scanForCardName(node);
      if (found) return found;
      node = node.parentElement;
    }
    return null;
  }

  function scanForCardName(root) {
    const candidates = [root, ...root.querySelectorAll('a, span, div, td, button')];
    for (const el of candidates) {
      const t = el.textContent?.trim();
      if (t && t.length >= 2 && t.length <= 120 && cardMap.has(t.toLowerCase())) {
        return t;
      }
    }
    return null;
  }

  // ─── Menu detection (MutationObserver) ─────────────────────────────
  function onMutations(mutations) {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        scanForMenu(node);
      }
      // Also check attribute changes – menus may be shown/hidden via style.
      if (mut.type === 'attributes' && mut.target?.nodeType === Node.ELEMENT_NODE) {
        scanForMenu(mut.target);
      }
    }
  }

  function scanForMenu(el) {
    // No point scanning for menus if no card has been clicked yet.
    if (!currentCard) return;
    // Direct check on el and all descendants.
    const candidates = [el, ...el.querySelectorAll('*')];
    for (const c of candidates) {
      if (isCardMenu(c)) {
        log('Menu detected via MutationObserver');
        injectTagsIntoMenu(c);
        return;
      }
    }
    // Walk up – the mutation may be inside a menu that already exists.
    let parent = el.parentElement;
    for (let i = 0; i < 10 && parent && parent !== document.body; i++) {
      if (isCardMenu(parent)) {
        log('Menu detected via parent walk');
        injectTagsIntoMenu(parent);
        return;
      }
      parent = parent.parentElement;
    }
  }

  /**
   * Heuristic: the Moxfield card context menu is a dropdown/popover
   * containing menu items like "Switch Printing", "Change Tags", etc.
   * We search broadly and accept any element whose text contains at
   * least two of the known menu items.
   */
  const MENU_KEYWORDS = [
    'Switch Printing', 'Change Tags', 'View Details',
    'Copy Card Name', 'Change Mana Cost', 'Set as Deck Image',
    'Add One', 'Remove',
  ];

  function isCardMenu(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    // Skip our own injected elements.
    if (el.closest?.('.moxtags-injected') || el.closest?.('.moxtags-submenu')) return false;
    const text = el.textContent || '';
    if (text.length < 20 || text.length > 8000) return false;
    let hits = 0;
    for (const kw of MENU_KEYWORDS) {
      if (text.includes(kw)) hits++;
    }
    return hits >= 3;
  }

  // ─── Polling fallback ──────────────────────────────────────────────
  // Sometimes React portals or other frameworks insert the menu in ways
  // the MutationObserver cannot catch reliably. Poll after mouse clicks.
  document.addEventListener('click', () => {
    // Small delay so the menu has time to render.
    setTimeout(pollForMenu, 100);
    setTimeout(pollForMenu, 300);
    setTimeout(pollForMenu, 600);
  }, true);

  function pollForMenu() {
    if (!currentCard) return;
    // Search for a card menu. Start from portals / overlays
    // which are typically direct children of body or within a high-level wrapper.
    const roots = document.querySelectorAll(
      '[role="menu"], [role="listbox"], .dropdown-menu, .popover, ' +
      '[class*="dropdown"], [class*="popover"], [class*="menu"], [class*="Menu"], ' +
      '[class*="context"], [class*="Context"], [data-radix-popper-content-wrapper], ' +
      '[data-popper-placement], [class*="Popover"], [class*="popover"]'
    );
    for (const el of roots) {
      if (isCardMenu(el)) {
        log('Menu detected via polling (targeted selectors)');
        injectTagsIntoMenu(el);
        return;
      }
    }
    // Broader fallback: check direct children of body (React portals).
    for (const el of document.body.children) {
      const found = findSmallestMenu(el);
      if (found) {
        log('Menu detected via polling (body child walk)');
        injectTagsIntoMenu(found);
        return;
      }
    }
  }

  /**
   * Find the smallest (most specific) element in the subtree that
   * matches the card-menu heuristic.
   */
  function findSmallestMenu(root) {
    if (!isCardMenu(root)) return null;
    // Try to find a more specific child.
    for (const child of root.children) {
      const deeper = findSmallestMenu(child);
      if (deeper) return deeper;
    }
    return root;
  }

  // ─── Tag injection ─────────────────────────────────────────────────
  async function injectTagsIntoMenu(menu) {
    // Debounce: multiple detection paths may fire simultaneously.
    if (injecting) return;
    injecting = true;

    // Remove any previous injection in this menu.
    menu.querySelectorAll('.moxtags-injected').forEach(el => el.remove());

    if (!currentCard) {
      warn('No card context when menu opened');
      injecting = false;
      return;
    }

    const { name, set, cn } = currentCard;
    const cacheKey = `${set}/${cn}`;

    // Find the "Buy on Mana Pool" item to insert after.
    const anchor = findAnchorItem(menu, 'Buy on Mana Pool');
    const insertionPoint = anchor || menu.lastElementChild;

    // Create a wrapper for all our injected elements.
    const wrapper = document.createElement('div');
    wrapper.className = 'moxtags-injected';

    // Divider
    const divider = document.createElement('div');
    divider.className = 'moxtags-divider';
    wrapper.appendChild(divider);

    // Loading indicator
    const loader = document.createElement('div');
    loader.className = 'moxtags-loading';
    loader.textContent = 'Loading tags…';
    wrapper.appendChild(loader);

    // Insert after the anchor.
    insertionPoint.after(wrapper);

    // Reset injecting when menu disappears.
    const cleanup = new MutationObserver(() => {
      if (!document.body.contains(menu)) {
        cleanup.disconnect();
        injecting = false;
      }
    });
    cleanup.observe(document.body, { childList: true, subtree: true });

    try {
      let tags = tagCache.get(cacheKey);
      if (!tags) {
        tags = await loadTags(set, cn);
        tagCache.set(cacheKey, tags);
      }

      loader.remove();
      renderSubmenus(wrapper, tags);
    } catch (err) {
      error('Tag fetch failed:', err);
      loader.textContent = 'Failed to load tags';
      loader.classList.add('moxtags-error');
    }
  }

  /**
   * Find a menu item by its visible text. Returns the top-level item
   * element (direct child of `menu`) that contains the target text.
   */
  function findAnchorItem(menu, text) {
    // Search all descendants for the text.
    const all = menu.querySelectorAll('*');
    for (const el of all) {
      if (el.textContent?.trim() === text) {
        // Walk up to the direct child of `menu`.
        let item = el;
        while (item.parentElement && item.parentElement !== menu) {
          item = item.parentElement;
        }
        if (item.parentElement === menu) return item;
      }
    }
    return null;
  }

  // ─── Tag fetching ────────────────────────────────────────────────────
  async function loadTags(set, cn) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'fetchTags', set, number: cn },
        (resp) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (resp?.ok) {
            log(`Tags loaded: ${resp.artTags.length} art, ${resp.cardTags.length} card`);
            resolve({ artTags: resp.artTags, cardTags: resp.cardTags });
          } else {
            reject(new Error(resp?.error || 'Tag fetch failed'));
          }
        }
      );
    });
  }

  // ─── Rendering ─────────────────────────────────────────────────────
  function renderSubmenus(wrapper, tags) {
    if (tags.artTags.length === 0 && tags.cardTags.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'moxtags-empty';
      empty.textContent = 'No tags found';
      wrapper.appendChild(empty);
      return;
    }

    if (tags.artTags.length > 0) {
      wrapper.appendChild(buildSubmenuTrigger('Art Tags', tags.artTags, 'art'));
    }
    if (tags.cardTags.length > 0) {
      wrapper.appendChild(buildSubmenuTrigger('Card Tags', tags.cardTags, 'otag'));
    }
  }

  function buildSubmenuTrigger(title, tags, searchPrefix) {
    const trigger = document.createElement('div');
    trigger.className = 'moxtags-trigger';

    const label = document.createElement('span');
    label.className = 'moxtags-trigger-label';
    label.textContent = title;
    trigger.appendChild(label);

    const arrow = document.createElement('span');
    arrow.className = 'moxtags-trigger-arrow';
    arrow.textContent = '▸';
    trigger.appendChild(arrow);

    const count = document.createElement('span');
    count.className = 'moxtags-trigger-count';
    count.textContent = `(${tags.length})`;
    trigger.appendChild(count);

    // Flyout submenu
    const submenu = document.createElement('div');
    submenu.className = 'moxtags-submenu';

    // "Search (N)" button – hidden until checkboxes are ticked.
    const searchBtn = document.createElement('button');
    searchBtn.className = 'moxtags-search-btn';
    searchBtn.textContent = 'Search';
    searchBtn.style.display = 'none';
    submenu.appendChild(searchBtn);

    // Track checked slugs for combined search.
    const checked = new Set();

    function updateSearchBtn() {
      if (checked.size > 0) {
        searchBtn.textContent = `Search (${checked.size})`;
        searchBtn.style.display = '';
      } else {
        searchBtn.style.display = 'none';
      }
    }

    searchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parts = [...checked].map(slug => `${searchPrefix}:${slug}`);
      const q = parts.join(' ');
      window.location.href = `${deckUrl}/search?q=${encodeURIComponent(q)}`;
    });

    for (const tag of tags) {
      const row = document.createElement('div');
      row.className = 'moxtags-tag-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'moxtags-tag-cb';
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cb.checked) {
          checked.add(tag.slug);
        } else {
          checked.delete(tag.slug);
        }
        updateSearchBtn();
      });
      row.appendChild(cb);

      const a = document.createElement('a');
      a.className = 'moxtags-tag-item';
      a.textContent = tag.name;
      a.href = `${deckUrl}/search?q=${encodeURIComponent(searchPrefix + ':' + tag.slug)}`;
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.href = a.href;
      });
      row.appendChild(a);

      submenu.appendChild(row);
    }

    trigger.appendChild(submenu);

    // Position the submenu on hover so it doesn't overflow the viewport.
    trigger.addEventListener('mouseenter', () => {
      positionSubmenu(trigger, submenu);
    });

    return trigger;
  }

  function positionSubmenu(trigger, submenu) {
    // Reset to default (right side).
    submenu.style.left = '100%';
    submenu.style.right = '';
    submenu.style.top = '0';

    requestAnimationFrame(() => {
      const triggerRect = trigger.getBoundingClientRect();
      const subRect = submenu.getBoundingClientRect();

      // Flip to left if it overflows to the right.
      if (triggerRect.right + subRect.width > window.innerWidth - 10) {
        submenu.style.left = '';
        submenu.style.right = '100%';
      }

      // Shift up if it overflows at the bottom.
      const overflow = subRect.bottom - window.innerHeight + 10;
      if (overflow > 0) {
        submenu.style.top = -overflow + 'px';
      }
    });
  }

  // ─── Background communication ──────────────────────────────────────
  function bgFetch(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'fetch', url }, (resp) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (resp?.ok) {
          resolve(resp.body);
        } else {
          reject(new Error(resp?.error || 'Fetch failed'));
        }
      });
    });
  }

  // ─── SPA navigation ───────────────────────────────────────────────
  function watchNavigation() {
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        log('URL changed – reinitializing');
        cleanup();
        init();
      }
    }, 1000);
  }

  // ─── Logging helpers ──────────────────────────────────────────────
  function log(...args)   { console.log('[MoxTags]', ...args); }
  function warn(...args)  { console.warn('[MoxTags]', ...args); }
  function error(...args) { console.error('[MoxTags]', ...args); }
})();
