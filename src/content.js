// MoxTags – Content Script
// Injects Scryfall Tagger art/card tags into Moxfield card context menus.

import { buildCardMap } from './shared/deck.js';
import { filterAndSortTags, parseInput, renderCount, highlightTag } from './shared/autocomplete.js';
import { ORACLE_PREFIXES, MENU_KEYWORDS, MAX_VISIBLE } from './shared/constants.js';

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

  // ─── Autocomplete state ────────────────────────────────────────────
  let acInput = null;           // the #deckbox-search element
  let acDropdown = null;        // the dropdown container
  let acItems = [];             // currently rendered items (DOM elements)
  let acHighlightIdx = -1;     // index of highlighted item
  let acFilteredTags = [];     // currently filtered tag names
  let acCurrentPrefix = '';     // e.g. 'otag:'
  let acCurrentPartial = '';    // text typed after the prefix colon
  let acWordStart = 0;          // index in input.value where the current prefix word starts
  let acOracleTagNames = null;  // cached from background
  let acArtTagNames = null;     // cached from background
  let acObserver = null;        // MutationObserver for detecting #deckbox-search
  let acBlurTimer = null;       // delay for blur dismissal

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

    // Set up search box autocomplete for tag names.
    setupAutocomplete();
  }

  function cleanup() {
    log('cleanup: disconnecting observer, removing listeners');
    if (observer) observer.disconnect();
    document.removeEventListener('mousedown', onMouseDown, true);
    cardMap.clear();
    tagCache.clear();
    currentCard = null;
    detachAutocomplete();

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
        const result = buildCardMap(data, log);
        if (result) {
          cardMap = result;
          log('fetchDeckData: Strategy 1 SUCCESS');
          prefetchAllTags();
          return;
        }
        log('fetchDeckData: buildCardMap returned null for', url);
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
    const result = data && buildCardMap(data, log);
    if (result) {
      cardMap = result;
      log('fetchDeckData: Strategy 2 SUCCESS');
      prefetchAllTags();
      return;
    }

    warn('Could not load deck data – tag injection will not work.');
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
        scanForDialog(node);
      }
      // Also check attribute changes – menus may be shown/hidden via style.
      if (mut.type === 'attributes' && mut.target?.nodeType === Node.ELEMENT_NODE) {
        scanForMenu(mut.target);
        scanForDialog(mut.target);
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
    const cleanupObs = new MutationObserver(() => {
      if (!document.body.contains(menu)) {
        cleanupObs.disconnect();
        injecting = false;
      }
    });
    cleanupObs.observe(document.body, { childList: true, subtree: true });

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
      if (err.cacheLoading) {
        loader.textContent = 'Downloading tag data…';
        loader.classList.add('moxtags-cache-loading');
      } else {
        loader.textContent = 'Failed to load tags';
        loader.classList.add('moxtags-error');
      }
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
            resolve({ artTags: resp.artTags, cardTags: resp.cardTags, cacheLoading: resp.cacheLoading });
          } else {
            const err = new Error(resp?.error || 'Tag fetch failed');
            err.cacheLoading = resp?.cacheLoading;
            reject(err);
          }
        }
      );
    });
  }

  // ─── Rendering ─────────────────────────────────────────────────────
  function renderSubmenus(wrapper, tags) {
    if (tags.artTags.length === 0 && tags.cardTags.length === 0) {
      const empty = document.createElement('div');
      if (tags.cacheLoading) {
        empty.className = 'moxtags-loading moxtags-cache-loading';
        empty.textContent = 'Downloading tag data…';
      } else {
        empty.className = 'moxtags-empty';
        empty.textContent = 'No tags found';
      }
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

  // ─── Change Tags dialog injection ──────────────────────────────────
  // When the user opens Moxfield's "Change Tags" dialog (Shift+Click),
  // inject <select> dropdowns for this card's Scryfall art and card tags.

  function scanForDialog(el) {
    const dialog = findChangeTagsDialog(el);
    if (dialog) {
      injectTagsIntoDialog(dialog);
      return;
    }
    // Walk up in case the mutation was inside a dialog.
    let parent = el.parentElement;
    for (let i = 0; i < 10 && parent && parent !== document.body; i++) {
      if (isChangeTagsDialog(parent)) {
        injectTagsIntoDialog(parent);
        return;
      }
      parent = parent.parentElement;
    }
  }

  function findChangeTagsDialog(root) {
    if (isChangeTagsDialog(root)) return root;
    const dialogs = root.querySelectorAll?.('dialog, [role="dialog"]') || [];
    for (const d of dialogs) {
      if (isChangeTagsDialog(d)) return d;
    }
    return null;
  }

  function isChangeTagsDialog(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const tag = el.tagName?.toLowerCase();
    if (tag !== 'dialog' && el.getAttribute?.('role') !== 'dialog') return false;
    if (el.querySelector('.moxtags-dialog-tags')) return false;
    const text = el.textContent || '';
    return text.includes('Change Tags for') && text.includes('Custom Tags');
  }

  async function injectTagsIntoDialog(dialog) {
    if (dialog.querySelector('.moxtags-dialog-tags')) return;

    // Extract card name from the dialog heading.
    const heading = dialog.querySelector('h1, h2, h3, h4, h5, h6');
    const headingText = heading?.textContent?.trim() || '';
    const match = headingText.match(/^Change Tags for (.+)$/);
    const cardName = match?.[1];

    if (!cardName) {
      log('Change Tags dialog: could not extract card name');
      return;
    }

    // Look up card in the deck map (prefer heading name, fall back to currentCard).
    const cardInfo = cardMap.get(cardName.toLowerCase()) || currentCard;
    if (!cardInfo) {
      log('Change Tags dialog: card not found in deck:', cardName);
      return;
    }

    // Find the Custom Tags input.
    const customTagsInput = dialog.querySelector('input[type="search"], input[type="text"], input');
    if (!customTagsInput) {
      log('Change Tags dialog: could not find Custom Tags input');
      return;
    }

    // Find insertion point – after "Recent Deck Tags" or "Recent Global Tags" button.
    const buttons = dialog.querySelectorAll('button');
    let insertAfter = null;
    for (const btn of buttons) {
      const t = btn.textContent?.trim();
      if (t?.startsWith('Recent Deck Tags') || t?.startsWith('Recent Global Tags')) {
        // Walk up to the wrapping div.dropdown so we insert after it,
        // not inside it.
        insertAfter = btn.closest('.dropdown') || btn;
      }
    }
    if (!insertAfter) {
      log('Change Tags dialog: could not find insertion point');
      return;
    }

    // Create container.
    const container = document.createElement('div');
    container.className = 'moxtags-dialog-tags';

    const loader = document.createElement('div');
    loader.className = 'moxtags-dialog-loading';
    loader.textContent = 'Loading Scryfall tags…';
    container.appendChild(loader);

    insertAfter.after(container);

    // Fetch tags for this card.
    const { set, cn } = cardInfo;
    const cacheKey = `${set}/${cn}`;

    try {
      let tags = tagCache.get(cacheKey);
      if (!tags) {
        tags = await loadTags(set, cn);
        tagCache.set(cacheKey, tags);
      }

      loader.remove();

      if (tags.artTags.length === 0 && tags.cardTags.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'moxtags-dialog-empty';
        empty.textContent = 'No Scryfall tags found';
        container.appendChild(empty);
        return;
      }

      if (tags.artTags.length > 0) {
        container.appendChild(buildTagDropdown('Art Tags', tags.artTags, customTagsInput));
      }
      if (tags.cardTags.length > 0) {
        container.appendChild(buildTagDropdown('Card Tags', tags.cardTags, customTagsInput));
      }

      // After rendering, equalize widths across all 4 dropdowns.
      equalizeDropdownWidths(dialog, container);
    } catch (err) {
      error('Change Tags dialog: tag fetch failed:', err);
      loader.textContent = 'Failed to load Scryfall tags';
      loader.classList.add('moxtags-error');
    }
  }

  function buildTagDropdown(label, tags, customTagsInput) {
    const wrapper = document.createElement('div');
    wrapper.className = 'dropdown d-inline-block moxtags-dialog-dropdown';

    const select = document.createElement('select');
    select.className = 'btn btn-secondary moxtags-dialog-select';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = label;
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    for (const tag of tags) {
      const option = document.createElement('option');
      option.value = tag.name;
      option.textContent = tag.name;
      select.appendChild(option);
    }

    select.addEventListener('change', () => {
      if (!select.value) return;
      addTagToCustomInput(customTagsInput, select.value);
      select.selectedIndex = 0;
    });

    wrapper.appendChild(select);
    return wrapper;
  }

  function addTagToCustomInput(input, tagName) {
    // "some-tag-name" → "#Some Tag Name"
    const display = tagName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const hashTag = '#' + display;
    const currentVal = input.value.trim();

    // Don't add duplicates.
    const existing = currentVal.split(',').map(t => t.trim().toLowerCase());
    if (existing.includes(hashTag.toLowerCase())) return;

    const newVal = currentVal ? currentVal + ', ' + hashTag : hashTag;
    input.value = newVal;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function equalizeDropdownWidths(dialog, container) {
    requestAnimationFrame(() => {
      // Collect Moxfield's Quick Tags buttons and our selects.
      const moxButtons = dialog.querySelectorAll('.dropdown > button.btn-secondary');
      const ourSelects = container.querySelectorAll('.moxtags-dialog-select');
      const all = [...moxButtons, ...ourSelects];
      if (all.length === 0) return;

      // Reset any previous fixed width so natural widths are measured.
      for (const el of all) el.style.width = '';

      const maxWidth = Math.max(...all.map(el => el.getBoundingClientRect().width));
      const px = Math.ceil(maxWidth) + 'px';
      for (const el of all) el.style.width = px;
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

  // ─── Autocomplete ─────────────────────────────────────────────────
  // Provides tag name suggestions when typing otag:/oracletag:/function:
  // or art:/atag:/arttag: in the #deckbox-search input.

  function setupAutocomplete() {
    acInput = document.getElementById('deckbox-search');
    if (acInput) {
      attachAutocomplete(acInput);
    } else {
      // Watch for it to appear (React may render it later).
      acObserver = new MutationObserver(() => {
        const el = document.getElementById('deckbox-search');
        if (el) {
          acObserver.disconnect();
          acObserver = null;
          acInput = el;
          attachAutocomplete(el);
        }
      });
      acObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  function attachAutocomplete(input) {
    log('Autocomplete attached to #deckbox-search');
    input.addEventListener('input', onAcInput);
    input.addEventListener('keydown', onAcKeydown);
    input.addEventListener('blur', onAcBlur);
    input.addEventListener('focus', onAcFocus);
  }

  function detachAutocomplete() {
    if (acInput) {
      acInput.removeEventListener('input', onAcInput);
      acInput.removeEventListener('keydown', onAcKeydown);
      acInput.removeEventListener('blur', onAcBlur);
      acInput.removeEventListener('focus', onAcFocus);
      acInput = null;
    }
    if (acObserver) {
      acObserver.disconnect();
      acObserver = null;
    }
    closeAcDropdown();
  }

  function onAcFocus() {
    // Re-evaluate on focus in case the input already has a prefix.
    onAcInput();
  }

  function onAcInput() {
    if (!acInput) return;
    const val = acInput.value;
    const cursor = acInput.selectionStart ?? val.length;

    const parsed = parseInput(val, cursor);
    if (!parsed || !parsed.partial) {
      closeAcDropdown();
      return;
    }

    acCurrentPrefix = parsed.prefix;
    acWordStart = parsed.wordStart;

    // Determine which tag list to use.
    const isOracle = parsed.isOracle;

    // Ensure we have tag names.
    if (isOracle && acOracleTagNames) {
      showFilteredTags(acOracleTagNames, parsed.partial);
    } else if (!isOracle && acArtTagNames) {
      showFilteredTags(acArtTagNames, parsed.partial);
    } else {
      // Need to fetch tag names from background.
      const matchedPrefix = parsed.prefix;
      fetchTagNames().then(() => {
        // Re-check — the input may have changed while we were fetching.
        if (acInput && acCurrentPrefix === matchedPrefix) {
          const list = isOracle ? acOracleTagNames : acArtTagNames;
          if (list) showFilteredTags(list, parsed.partial);
        }
      });
    }
  }

  function fetchTagNames() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getTagNames' }, (resp) => {
        if (chrome.runtime.lastError) {
          warn('getTagNames failed:', chrome.runtime.lastError.message);
          return resolve();
        }
        if (resp?.ok) {
          acOracleTagNames = resp.oracleTagNames || [];
          acArtTagNames = resp.artTagNames || [];
          log('Tag names loaded:', acOracleTagNames.length, 'oracle,', acArtTagNames.length, 'art');
        }
        resolve();
      });
    });
  }

  function showFilteredTags(tagList, partial) {
    acFilteredTags = filterAndSortTags(tagList, partial);
    acCurrentPartial = partial.toLowerCase();

    if (acFilteredTags.length === 0) {
      closeAcDropdown();
      return;
    }

    renderAcDropdown();
  }

  function renderAcDropdown() {
    if (!acInput) return;

    if (!acDropdown) {
      acDropdown = document.createElement('div');
      acDropdown.className = 'moxtags-autocomplete';
      // Prevent dropdown clicks from blurring the input.
      acDropdown.addEventListener('mousedown', (e) => e.preventDefault());
      document.body.appendChild(acDropdown);
    }

    // Position below the search box.
    const rect = acInput.getBoundingClientRect();
    acDropdown.style.left = rect.left + window.scrollX + 'px';
    acDropdown.style.top = rect.bottom + window.scrollY + 2 + 'px';
    acDropdown.style.minWidth = rect.width + 'px';

    // Cap rendered items for short partials to avoid DOM bloat; remove cap at 3+ chars.
    const count = renderCount(acFilteredTags.length, acCurrentPartial.length);
    acDropdown.innerHTML = '';
    acItems = [];
    acHighlightIdx = 0;

    for (let i = 0; i < count; i++) {
      const tag = acFilteredTags[i];
      const item = document.createElement('div');
      item.className = 'moxtags-autocomplete-item';
      item.appendChild(buildHighlightedTag(tag, acCurrentPartial));
      item.dataset.index = i;

      item.addEventListener('click', () => selectAcItem(i));
      item.addEventListener('mouseenter', () => highlightAcItem(i));

      acDropdown.appendChild(item);
      acItems.push(item);
    }

    highlightAcItem(0);
    acDropdown.style.display = '';
  }

  /**
   * Build a document fragment for a tag name with the matched portion
   * of each matching dash-delimited word wrapped in <b>.
   */
  function buildHighlightedTag(tag, partial) {
    const segments = highlightTag(tag, partial);
    const frag = document.createDocumentFragment();
    for (const seg of segments) {
      if (seg.bold) {
        const b = document.createElement('b');
        b.textContent = seg.text;
        frag.appendChild(b);
      } else {
        frag.appendChild(document.createTextNode(seg.text));
      }
    }
    return frag;
  }

  function highlightAcItem(idx) {
    if (idx < 0 || idx >= acItems.length) return;
    if (acHighlightIdx >= 0 && acHighlightIdx < acItems.length) {
      acItems[acHighlightIdx].classList.remove('highlighted');
    }
    acHighlightIdx = idx;
    acItems[idx].classList.add('highlighted');
    // Scroll into view if needed.
    acItems[idx].scrollIntoView({ block: 'nearest' });
  }

  function selectAcItem(idx) {
    if (idx < 0 || idx >= acFilteredTags.length) return;
    if (!acInput) return;

    const tag = acFilteredTags[idx];
    const val = acInput.value;
    const cursor = acInput.selectionStart ?? val.length;

    // Replace from wordStart to cursor with prefix + tag + trailing space.
    const before = val.substring(0, acWordStart);
    const after = val.substring(cursor);
    const insertion = acCurrentPrefix + tag + ' ';
    acInput.value = before + insertion + after;

    // Place cursor after the inserted text.
    const newCursor = acWordStart + insertion.length;
    acInput.setSelectionRange(newCursor, newCursor);

    // Fire input event so Moxfield's React picks up the change.
    acInput.dispatchEvent(new Event('input', { bubbles: true }));

    closeAcDropdown();
    acInput.focus();
  }

  function closeAcDropdown() {
    if (acDropdown) {
      acDropdown.remove();
      acDropdown = null;
    }
    acItems = [];
    acHighlightIdx = -1;
    acFilteredTags = [];
  }

  function onAcKeydown(e) {
    if (!acDropdown || acItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = (acHighlightIdx + 1) % acItems.length;
      highlightAcItem(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = (acHighlightIdx - 1 + acItems.length) % acItems.length;
      highlightAcItem(prev);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      selectAcItem(acHighlightIdx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeAcDropdown();
    }
  }

  function onAcBlur() {
    // Delay to allow click events on dropdown items to fire first.
    acBlurTimer = setTimeout(() => {
      closeAcDropdown();
    }, 200);
  }

  // ─── Logging helpers ──────────────────────────────────────────────
  function log(...args)   { console.log('[MoxTags]', ...args); }
  function warn(...args)  { console.warn('[MoxTags]', ...args); }
  function error(...args) { console.error('[MoxTags]', ...args); }
})();
