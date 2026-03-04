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
    if (observer) observer.disconnect();
    document.removeEventListener('mousedown', onMouseDown, true);
    cardMap.clear();
    tagCache.clear();
    currentCard = null;
  }

  function extractDeckId() {
    const m = location.pathname.match(/\/decks\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  // ─── Deck data ─────────────────────────────────────────────────────
  async function fetchDeckData() {
    // Try the known Moxfield API endpoints.
    for (const base of [
      `https://api2.moxfield.com/v3/decks/all/${deckId}`,
      `https://api2.moxfield.com/v2/decks/all/${deckId}`,
      `https://api.moxfield.com/v2/decks/all/${deckId}`,
    ]) {
      try {
        const text = await bgFetch(base);
        const data = JSON.parse(text);
        if (buildCardMap(data)) return;
      } catch (_) {
        // Try next endpoint.
      }
    }
    warn('Could not load deck data from API – tag injection will not work.');
  }

  /**
   * Walk every board in the deck JSON and populate `cardMap`.
   * Returns true if at least one card was found.
   */
  function buildCardMap(data) {
    if (!data || typeof data !== 'object') return false;

    const boards = [
      'mainboard', 'sideboard', 'commanders', 'companions',
      'signatureSpells', 'considering', 'attractions',
      'stickers', 'contraptions', 'planes', 'schemes', 'tokens',
    ];

    for (const boardName of boards) {
      const board = data[boardName];
      if (!board || typeof board !== 'object') continue;

      for (const entry of Object.values(board)) {
        const card = entry?.card;
        if (!card?.name) continue;

        const set = (card.set || card.setCode || '').toLowerCase();
        const cn  = String(card.cn || card.collector_number || card.collectorNumber || '');
        if (!set || !cn) continue;

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
    if (el.classList?.contains('moxtags-panel') || el.closest?.('.moxtags-panel')) return false;
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

    // Guard: remove any previous panel.
    const existing = document.querySelector('.moxtags-panel');
    if (existing) existing.remove();

    if (!currentCard) {
      warn('No card context when menu opened');
      injecting = false;
      return;
    }

    const { name, set, cn } = currentCard;
    const cacheKey = `${set}/${cn}`;

    // Create the side panel and position it next to the menu.
    const panel = document.createElement('div');
    panel.className = 'moxtags-panel';

    const loader = document.createElement('div');
    loader.className = 'moxtags-loading';
    loader.textContent = `Loading tags…`;
    panel.appendChild(loader);

    // Insert the panel as a sibling right after the menu.
    menu.parentElement.insertBefore(panel, menu.nextSibling);

    // Position the panel to the right of the menu.
    positionPanel(menu, panel);

    // Also remove the panel when the menu disappears.
    const cleanup = new MutationObserver(() => {
      if (!document.body.contains(menu) || menu.offsetParent === null) {
        panel.remove();
        cleanup.disconnect();
        injecting = false;
      }
    });
    cleanup.observe(document.body, { childList: true, subtree: true, attributes: true });

    try {
      let tags = tagCache.get(cacheKey);
      if (!tags) {
        tags = await loadTags(set, cn);
        tagCache.set(cacheKey, tags);
      }

      loader.remove();
      renderTagSections(panel, tags);
      positionPanel(menu, panel);
    } catch (err) {
      error('Tag fetch failed:', err);
      loader.textContent = 'Failed to load tags';
      loader.classList.add('moxtags-error');
    }
  }

  function positionPanel(menu, panel) {
    const rect = menu.getBoundingClientRect();
    panel.style.position = 'fixed';
    panel.style.top = rect.top + 'px';
    panel.style.left = (rect.right + 2) + 'px';
    // If the panel would go off-screen to the right, put it on the left.
    requestAnimationFrame(() => {
      const panelRect = panel.getBoundingClientRect();
      if (panelRect.right > window.innerWidth - 10) {
        panel.style.left = (rect.left - panelRect.width - 2) + 'px';
      }
      // Clamp height so it doesn't go off bottom.
      const maxH = window.innerHeight - rect.top - 10;
      if (maxH > 100) {
        panel.style.maxHeight = maxH + 'px';
      }
    });
  }

  // ─── Scryfall Tagger fetching (GraphQL) ─────────────────────────────
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
  function renderTagSections(panel, tags) {
    if (tags.artTags.length === 0 && tags.cardTags.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'moxtags-empty';
      empty.textContent = 'No tags found';
      panel.appendChild(empty);
      return;
    }

    const cols = document.createElement('div');
    cols.className = 'moxtags-columns';

    if (tags.artTags.length > 0) {
      cols.appendChild(buildSection('Art Tags', tags.artTags, 'art'));
    }
    if (tags.cardTags.length > 0) {
      cols.appendChild(buildSection('Card Tags', tags.cardTags, 'otag'));
    }

    panel.appendChild(cols);
  }

  function buildSection(title, tags, searchPrefix) {
    const section = document.createElement('div');
    section.className = 'moxtags-section';

    const header = document.createElement('div');
    header.className = 'moxtags-section-header';
    header.textContent = title;
    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'moxtags-tag-list';

    for (const tag of tags) {
      const a = document.createElement('a');
      a.className = 'moxtags-tag-item';
      a.textContent = tag.name;
      a.href = `${deckUrl}/search?q=${encodeURIComponent(searchPrefix + ':' + tag.slug)}`;
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        window.location.href = a.href;
      });
      list.appendChild(a);
    }

    section.appendChild(list);
    return section;
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
