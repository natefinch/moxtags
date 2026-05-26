// MoxTags – Content Script
// Injects Scryfall Tagger art/card tags into Moxfield card context menus.

import { buildCardMap } from './moxfield/deck.js';
import { parseCardIdFromHref } from './moxfield/card.js';
import { findUnprocessedMoreOptionsButtons, extractCardInfoFromRow } from './moxfield/longlayout.js';
import { MENU_KEYWORDS } from './moxfield/constants.js';
import {
  extractDeckId as _extractDeckId, identifyCard as _identifyCard,
  scanForCardName as _scanForCardName, isCardMenu as _isCardMenu,
  findSmallestMenu as _findSmallestMenu, findAnchorItem as _findAnchorItem,
  extractCardIdFromMenu as _extractCardIdFromMenu,
  addToSearchAndRun as _addToSearchAndRun,
} from './moxfield/dom.js';
import {
  readInterceptedDeck as _readInterceptedDeck,
  waitForInterceptedDeck as _waitForInterceptedDeck,
} from './moxfield/intercept.js';
import { lookupCardByMoxfieldId as _lookupCardByMoxfieldId } from './moxfield/api.js';
import { filterAndSortTags, parseInput, renderCount, highlightTag } from './shared/autocomplete.js';
import { ORACLE_PREFIXES, MAX_VISIBLE } from './shared/constants.js';
import { loadMoxIdCache, createMoxIdPersister } from './cache/mox-ids.js';

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

  // Persistent cache: Moxfield card ID → { set, cn }.
  // Avoids repeated Moxfield API lookups for the same card across sessions.
  const moxIdCache = new Map();
  const moxIdPersister = createMoxIdPersister({ logFn: log });

  // Load the cache from storage on startup.
  loadMoxIdCache().then(cached => {
    for (const [id, val] of cached) {
      moxIdCache.set(id, val);
    }
    if (cached.size > 0) {
      log('Moxfield ID cache loaded:', moxIdCache.size, 'entries');
    }
  });

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
  log('Content script loaded at', location.href);
  init();

  function init() {
    deckId = extractDeckId();
    if (!deckId) {
      log('Not a deck page, skipping init');
      return;
    }
    deckUrl = location.origin + '/decks/' + deckId;
    log('Initializing for deck', deckId, 'at', deckUrl);

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
    return _extractDeckId(location.pathname);
  }

  // ─── Deck data ─────────────────────────────────────────────────────

  function readInterceptedDeck() {
    return _readInterceptedDeck({ logFn: log });
  }

  function waitForInterceptedDeck(timeoutMs = 12000) {
    return _waitForInterceptedDeck({ timeoutMs, logFn: log });
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
          cardMap = result.cardMap;
          mergeMoxIds(result.moxIds);
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
      cardMap = result.cardMap;
      mergeMoxIds(result.moxIds);
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
    log('Prefetching tags for', cards.length, 'unique cards from', cardMap.size, 'total card map entries');
    if (cards.length > 0) {
      log('Sample cards to prefetch:', cards.slice(0, 5).map(c => `${c.set}/${c.cn}`).join(', '));
    }
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
      } else {
        log('Card name found but not in cardMap:', name);
      }
    }
  }

  function identifyCard(el) {
    return _identifyCard(el, cardMap);
  }

  function scanForCardName(root) {
    return _scanForCardName(root, cardMap);
  }

  // ─── Menu detection (MutationObserver) ─────────────────────────────
  function onMutations(mutations) {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        scanForMenu(node);
        scanForDialog(node);
        scanForCardDropdown(node);
        scanForLongLayout(node);
      }
      // Also check attribute changes – menus may be shown/hidden via style.
      if (mut.type === 'attributes' && mut.target?.nodeType === Node.ELEMENT_NODE) {
        scanForMenu(mut.target);
        scanForDialog(mut.target);
        scanForCardDropdown(mut.target);
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
        log('Menu detected via MutationObserver, card:', currentCard?.name);
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
    return _isCardMenu(el, MENU_KEYWORDS);
  }

  // ─── Search result card dropdown detection ─────────────────────────
  // On deck search pages, each card has a small "Options" dropdown.
  // It doesn't match the full context-menu heuristic, and Moxfield
  // renders it as a React portal on <body>, not inside the card.
  // Detect it by looking for .dropdown-menu elements with card-specific
  // menu text like "Add to Main Deck".

  const CARD_DROPDOWN_MARKERS = ['Add to Main Deck', 'Add to Sideboard'];

  // Track which card's Options was most recently clicked, since Moxfield
  // portals the dropdown to <body> (losing the card context).
  let lastOptionsCard = null;

  document.addEventListener('mousedown', (e) => {
    const toggle = e.target.closest?.('.dropdown-toggle');
    if (!toggle) return;
    // Clear currentCard — the general onMouseDown handler may have matched
    // a different card visible on the page (e.g. a deck card on the search
    // results page) instead of the one whose Options button was clicked.
    currentCard = null;
    const card = toggle.closest('.decklist-card');
    if (!card) {
      log('Options toggle clicked but no .decklist-card parent found');
      return;
    }
    const nameEl = card.querySelector('.decklist-card-phantomsearch');
    const name = nameEl?.textContent?.trim();
    if (!name) {
      log('Options toggle clicked but no card name found in .decklist-card-phantomsearch');
      return;
    }
    const info = cardMap.get(name.toLowerCase());
    if (info) {
      lastOptionsCard = info;
      log('Options click tracked:', name, `(${info.set}/${info.cn})`);
    } else {
      // Card not in deck — try to capture the Moxfield card ID so we can
      // resolve the exact printing later. Check (in order):
      //   1. a[href="/cards/{id}-slug"] link within the card element
      //   2. data-hash attribute on the .decklist-card element
      const cardLink = card.querySelector('a[href*="/cards/"]');
      const moxCardId = cardLink
        ? parseCardIdFromHref(cardLink.getAttribute('href'))
        : (card.dataset?.hash || null);
      lastOptionsCard = { name, set: null, cn: null, moxCardId: moxCardId || null };
      log('Options click tracked:', name, '(not in deck cardMap)', moxCardId ? `moxCardId=${moxCardId}` : 'no moxCardId');
    }
  }, true);

  function scanForCardDropdown(el) {
    const candidates = [];
    if (el.classList?.contains('dropdown-menu')) candidates.push(el);
    if (el.querySelectorAll) {
      candidates.push(...el.querySelectorAll('.dropdown-menu'));
    }
    // Walk up in case the mutation was inside a dropdown menu.
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (parent.classList?.contains('dropdown-menu')) {
        candidates.push(parent);
        break;
      }
      parent = parent.parentElement;
    }

    for (const menu of candidates) {
      if (menu.querySelector('.moxtags-injected')) continue;

      // Case A: dropdown is inside a .decklist-card container.
      const card = menu.closest('.decklist-card');
      if (card) {
        const nameEl = card.querySelector('.decklist-card-phantomsearch');
        const name = nameEl?.textContent?.trim();
        if (!name) continue;
        const info = cardMap.get(name.toLowerCase());
        if (!info) continue;
        currentCard = info;
        log('Card dropdown detected (inline):', name);
        injectTagsIntoMenu(menu);
        continue;
      }

      // Case B: body-level portal with card-action menu items.
      const text = menu.textContent || '';
      if (!CARD_DROPDOWN_MARKERS.some(m => text.includes(m))) continue;

      // Identify the card from the tracked Options click (preferred) or
      // the general mousedown context.
      const cardInfo = lastOptionsCard || currentCard;
      if (!cardInfo) {
        log('Card dropdown found but could not identify card');
        continue;
      }
      currentCard = cardInfo;

      log('Card dropdown detected (portal):', currentCard.name);
      injectTagsIntoMenu(menu);
    }
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
    if (!currentCard && !lastOptionsCard) return;
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

  function findSmallestMenu(root) {
    return _findSmallestMenu(root, MENU_KEYWORDS);
  }

  // ─── Long layout detection & injection ──────────────────────────────
  // Search results "long" layout: each card is a full-width row with
  // action buttons in a side column (Add to Main Deck, More Options, …).
  // The standard dropdown-menu injection doesn't apply, so we add
  // standalone "Art Tags" / "Card Tags" buttons after "More Options".

  function scanForLongLayout(el) {
    const results = findUnprocessedMoreOptionsButtons(el);
    if (results.length > 0) {
      log('scanForLongLayout: found', results.length, 'unprocessed More Options buttons');
    }
    for (const { button, row } of results) {
      injectLongLayoutButtons(button, row);
    }
  }

  function injectLongLayoutButtons(moreOptionsBtn, cardRow) {
    const { moxCardId, cardName } = extractCardInfoFromRow(cardRow);
    log('injectLongLayoutButtons: cardId =', moxCardId, 'name =', cardName);
    if (!moxCardId && !cardName) {
      log('injectLongLayoutButtons: no card identity found, skipping');
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'moxtags-long-btn-wrapper moxtags-injected mt-2';

    wrapper.appendChild(buildLongLayoutTagButton('Art Tags', 'art', moxCardId, cardName));
    wrapper.appendChild(buildLongLayoutTagButton('Card Tags', 'otag', moxCardId, cardName));

    moreOptionsBtn.after(wrapper);
  }

  function buildLongLayoutTagButton(title, searchPrefix, moxCardId, cardName) {
    const container = document.createElement('div');
    container.className = 'moxtags-long-tag-container mt-2';

    const btn = document.createElement('button');
    btn.className = 'btn w-100 btn-secondary';
    btn.type = 'button';
    const btnLabel = document.createElement('span');
    btnLabel.textContent = title;
    const caret = document.createElement('span');
    caret.className = 'fa-solid fa-caret-down ms-1';
    caret.setAttribute('aria-hidden', 'true');
    btnLabel.appendChild(caret);
    btn.appendChild(btnLabel);
    container.appendChild(btn);

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu moxtags-long-menu';
    container.appendChild(menu);

    let loaded = false;

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      log('Long layout button clicked:', title, 'cardId:', moxCardId, 'name:', cardName);

      // Close other open long-layout menus.
      document.querySelectorAll('.moxtags-long-menu.show').forEach(m => {
        if (m !== menu) m.classList.remove('show');
      });

      if (menu.classList.contains('show')) {
        menu.classList.remove('show');
        return;
      }

      menu.classList.add('show');

      if (loaded) return;
      loaded = true;

      // Show loading state.
      menu.innerHTML = '';
      const loader = document.createElement('div');
      loader.className = 'moxtags-loading text-body';
      loader.textContent = 'Loading tags…';
      menu.appendChild(loader);

      // Resolve card identity.
      let set, cn;
      const cardInfo = cardName ? cardMap.get(cardName.toLowerCase()) : null;
      if (cardInfo) {
        set = cardInfo.set;
        cn = cardInfo.cn;
        log('Long layout: resolved from cardMap:', cardName, '→', set, cn);
      } else if (moxCardId) {
        log('Long layout: card not in cardMap, resolving via Moxfield ID:', moxCardId);
        const resolved = await lookupCardByMoxfieldId(moxCardId);
        if (resolved) {
          set = resolved.set;
          cn = resolved.cn;
          log('Long layout: Moxfield ID resolved:', moxCardId, '→', set, cn);
        } else {
          log('Long layout: Moxfield ID resolution failed for:', moxCardId);
        }
      }

      // Fetch tags.
      let tags;
      try {
        if (set && cn) {
          const cacheKey = `${set}/${cn}`;
          tags = tagCache.get(cacheKey);
          if (tags) {
            log('Long layout: tags from cache for', cacheKey);
          } else {
            log('Long layout: loading tags from background for', cacheKey);
            tags = await loadTags(set, cn);
            tagCache.set(cacheKey, tags);
          }
        } else if (cardName) {
          const cacheKey = `name:${cardName.toLowerCase()}`;
          tags = tagCache.get(cacheKey);
          if (tags) {
            log('Long layout: tags from cache for', cacheKey);
          } else {
            log('Long layout: loading tags by name for', cardName);
            tags = await loadTagsByName(cardName);
            tagCache.set(cacheKey, tags);
          }
        } else {
          log('Long layout: no set/cn or cardName, cannot fetch tags');
        }
      } catch (err) {
        error('Long layout tag fetch failed:', err);
        loader.textContent = err.cacheLoading ? 'Downloading tag data…' : 'Failed to load tags';
        loaded = false; // allow retry
        return;
      }

      loader.remove();

      const relevantTags = searchPrefix === 'art' ? tags?.artTags : tags?.cardTags;

      if (!relevantTags || relevantTags.length === 0) {
        const empty = document.createElement('div');
        if (tags?.cacheLoading) {
          empty.className = 'moxtags-loading moxtags-cache-loading text-body';
          empty.textContent = 'Downloading tag data…';
          loaded = false;
        } else {
          empty.className = 'moxtags-empty text-body';
          empty.textContent = 'No tags found';
        }
        menu.appendChild(empty);
        return;
      }

      renderLongMenuTags(menu, relevantTags, searchPrefix);
    });

    return container;
  }

  // Single delegated listener to close long-layout menus on outside clicks.
  document.addEventListener('click', (e) => {
    for (const menu of document.querySelectorAll('.moxtags-long-menu.show')) {
      if (!menu.parentElement?.contains(e.target)) {
        menu.classList.remove('show');
      }
    }
  });

  function renderLongMenuTags(menu, tags, searchPrefix) {
    const searchBtn = document.createElement('button');
    searchBtn.className = 'moxtags-search-btn';
    searchBtn.textContent = 'Add to Search';
    searchBtn.style.display = 'none';
    menu.appendChild(searchBtn);

    const checked = new Set();

    function updateSearchBtn() {
      if (checked.size > 0) {
        searchBtn.textContent = `Add to Search (${checked.size})`;
        searchBtn.style.display = '';
      } else {
        searchBtn.style.display = 'none';
      }
    }

    searchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parts = [...checked].map(slug => `${searchPrefix}:${slug}`);
      const q = parts.join(' ');
      if (addToSearchAndRun(q)) {
        menu.classList.remove('show');
        return;
      }
      const base = deckUrl ? `${deckUrl}/search` : '/search/cards';
      window.location.href = `${base}?q=${encodeURIComponent(q)}`;
    });

    for (const tag of tags) {
      const row = document.createElement('div');
      row.className = 'moxtags-tag-row';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'moxtags-tag-cb';
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cb.checked) checked.add(tag.slug);
        else checked.delete(tag.slug);
        updateSearchBtn();
      });
      row.appendChild(cb);

      const a = document.createElement('a');
      a.className = 'dropdown-item moxtags-tag-item';
      a.textContent = tag.name;
      a.title = 'Add to search';
      const tagUrl = deckUrl
        ? `${deckUrl}/search?q=${encodeURIComponent(searchPrefix + ':' + tag.slug)}`
        : `/search/cards?q=${encodeURIComponent(searchPrefix + ':' + tag.slug)}`;
      a.href = tagUrl;
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        const query = `${searchPrefix}:${tag.slug}`;
        if (addToSearchAndRun(query)) {
          e.preventDefault();
          menu.classList.remove('show');
          return;
        }
        window.location.href = a.href;
      });
      row.appendChild(a);

      menu.appendChild(row);
    }
  }

  // ─── Tag injection ─────────────────────────────────────────────────
  async function injectTagsIntoMenu(menu) {
    // Debounce: multiple detection paths may fire simultaneously.
    if (injecting) {
      log('injectTagsIntoMenu: skipping, already injecting');
      return;
    }
    injecting = true;

    // Remove any previous injection in this menu.
    menu.querySelectorAll('.moxtags-injected').forEach(el => el.remove());

    if (!currentCard) {
      warn('No card context when menu opened');
      injecting = false;
      return;
    }

    let { name, set, cn } = currentCard;
    log('injectTagsIntoMenu: card =', name, 'set =', set, 'cn =', cn);

    // If we don't have set/cn, try to resolve via the Moxfield card ID.
    // First check the dropdown menu for a "View Details" link, then fall
    // back to the moxCardId captured when the Options button was clicked.
    if (!set || !cn) {
      let moxCardId = extractCardIdFromMenu(menu);
      if (!moxCardId && currentCard.moxCardId) {
        moxCardId = currentCard.moxCardId;
        log('injectTagsIntoMenu: using moxCardId from Options click:', moxCardId);
      }
      if (moxCardId) {
        log('injectTagsIntoMenu: resolving card via Moxfield ID:', moxCardId);
        const resolved = await lookupCardByMoxfieldId(moxCardId);
        if (resolved) {
          set = resolved.set;
          cn = resolved.cn;
          currentCard = { name, set, cn };
          log('injectTagsIntoMenu: resolved to', set, cn);
        } else {
          log('injectTagsIntoMenu: Moxfield ID resolution failed for', moxCardId);
        }
      }
    }

    // Determine where to insert our tags.
    // Two-column deck context menu: insert into the left column after "Add to Wish List".
    // Single-column Options dropdown: insert after "Buy on Mana Pool" at the bottom.
    const leftCol = menu.querySelector('.d-flex.flex-nowrap > .d-inline-block:first-child');
    const wishListAnchor = leftCol && findAnchorItem(leftCol, 'Add to Wish List');

    let insertionPoint;
    let insertionParent;
    if (wishListAnchor) {
      insertionPoint = wishListAnchor;
      insertionParent = leftCol;
    } else {
      const anchor = findAnchorItem(menu, 'Buy on Mana Pool');
      insertionPoint = anchor || menu.lastElementChild;
      insertionParent = menu;
    }

    // Create a wrapper for all our injected elements.
    const wrapper = document.createElement('div');
    wrapper.className = 'moxtags-injected';

    // Divider
    const divider = document.createElement('div');
    divider.className = 'dropdown-divider';
    wrapper.appendChild(divider);

    // Loading indicator
    const loader = document.createElement('div');
    loader.className = 'moxtags-loading text-body';
    loader.textContent = 'Loading tags…';
    wrapper.appendChild(loader);

    // Insert after the anchor.
    insertionPoint.after(wrapper);

    // Reset state when menu disappears so the next click picks up a fresh card.
    const cleanupObs = new MutationObserver(() => {
      if (!document.body.contains(menu)) {
        cleanupObs.disconnect();
        injecting = false;
        currentCard = null;
      }
    });
    cleanupObs.observe(document.body, { childList: true, subtree: true });

    try {
      let tags;
      if (set && cn) {
        const cacheKey = `${set}/${cn}`;
        tags = tagCache.get(cacheKey);
        if (tags) {
          log('injectTagsIntoMenu: tags from cache for', cacheKey);
        } else {
          log('injectTagsIntoMenu: loading tags for', cacheKey);
          tags = await loadTags(set, cn);
          tagCache.set(cacheKey, tags);
        }
      } else {
        // Card not in deck and Moxfield ID resolution failed — fall back to name.
        const cacheKey = `name:${name.toLowerCase()}`;
        tags = tagCache.get(cacheKey);
        if (tags) {
          log('injectTagsIntoMenu: tags from cache for', cacheKey);
        } else {
          log('injectTagsIntoMenu: loading tags by name for', name);
          tags = await loadTagsByName(name);
          tagCache.set(cacheKey, tags);
        }
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

  function findAnchorItem(container, text) {
    return _findAnchorItem(container, text);
  }

  // ─── Tag fetching ────────────────────────────────────────────────────
  async function loadTags(set, cn) {
    log('loadTags: requesting tags for', set, cn);
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'fetchTags', set, number: cn },
        (resp) => {
          if (chrome.runtime.lastError) {
            warn('loadTags: runtime error:', chrome.runtime.lastError.message);
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (resp?.ok) {
            log(`loadTags: ${set}/${cn} → ${resp.artTags.length} art, ${resp.cardTags.length} card tags`);
            resolve({ artTags: resp.artTags, cardTags: resp.cardTags, cacheLoading: resp.cacheLoading });
          } else {
            warn('loadTags: failed for', set, cn, ':', resp?.error, 'cacheLoading:', resp?.cacheLoading);
            const err = new Error(resp?.error || 'Tag fetch failed');
            err.cacheLoading = resp?.cacheLoading;
            reject(err);
          }
        }
      );
    });
  }

  async function loadTagsByName(name) {
    log('loadTagsByName: requesting tags for', name);
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'fetchTagsByName', name },
        (resp) => {
          if (chrome.runtime.lastError) {
            warn('loadTagsByName: runtime error:', chrome.runtime.lastError.message);
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (resp?.ok) {
            log(`loadTagsByName: ${name} → ${resp.artTags.length} art, ${resp.cardTags.length} card tags`);
            resolve({ artTags: resp.artTags, cardTags: resp.cardTags, cacheLoading: resp.cacheLoading });
          } else {
            warn('loadTagsByName: failed for', name, ':', resp?.error, 'cacheLoading:', resp?.cacheLoading);
            const err = new Error(resp?.error || 'Tag fetch failed');
            err.cacheLoading = resp?.cacheLoading;
            reject(err);
          }
        }
      );
    });
  }

  function extractCardIdFromMenu(menu) {
    return _extractCardIdFromMenu(menu);
  }

  function lookupCardByMoxfieldId(cardId) {
    return _lookupCardByMoxfieldId(cardId, {
      cache: moxIdCache,
      onResolved: () => persistMoxIdCache(),
      logFn: log,
    });
  }

  function persistMoxIdCache() {
    moxIdPersister.persist(moxIdCache);
  }

  function mergeMoxIds(moxIds) {
    moxIdPersister.merge(moxIdCache, moxIds);
  }

  // ─── Search helpers ─────────────────────────────────────────────────

  function addToSearchAndRun(query) {
    const ok = _addToSearchAndRun(query);
    if (!ok) warn('Search input not found, falling back to navigation');
    return ok;
  }

  // ─── Rendering ─────────────────────────────────────────────────────
  function renderSubmenus(wrapper, tags) {
    if (tags.artTags.length === 0 && tags.cardTags.length === 0) {
      const empty = document.createElement('div');
      if (tags.cacheLoading) {
        empty.className = 'moxtags-loading moxtags-cache-loading text-body';
        empty.textContent = 'Downloading tag data…';
      } else {
        empty.className = 'moxtags-empty text-body';
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
    trigger.className = 'dropdown-item cursor-pointer no-outline moxtags-trigger';

    const label = document.createElement('span');
    label.className = 'moxtags-trigger-label';
    label.textContent = title;
    trigger.appendChild(label);

    const arrow = document.createElement('span');
    arrow.className = 'moxtags-trigger-arrow';
    arrow.textContent = '▸';
    trigger.appendChild(arrow);

    // Flyout submenu
    const submenu = document.createElement('div');
    submenu.className = 'dropdown-menu moxtags-submenu';

    // "Add to Search (N)" button – hidden until checkboxes are ticked.
    const searchBtn = document.createElement('button');
    searchBtn.className = 'moxtags-search-btn';
    searchBtn.textContent = 'Add to Search';
    searchBtn.style.display = 'none';
    submenu.appendChild(searchBtn);

    // Track checked slugs for combined search.
    const checked = new Set();

    function updateSearchBtn() {
      if (checked.size > 0) {
        searchBtn.textContent = `Add to Search (${checked.size})`;
        searchBtn.style.display = '';
      } else {
        searchBtn.style.display = 'none';
      }
    }

    searchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parts = [...checked].map(slug => `${searchPrefix}:${slug}`);
      const q = parts.join(' ');
      if (addToSearchAndRun(q)) return;
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
      a.className = 'dropdown-item moxtags-tag-item';
      a.textContent = tag.name;
      a.title = 'Add to search';
      a.href = `${deckUrl}/search?q=${encodeURIComponent(searchPrefix + ':' + tag.slug)}`;
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        const query = `${searchPrefix}:${tag.slug}`;
        if (addToSearchAndRun(query)) {
          e.preventDefault();
          return;
        }
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
    // Measure the submenu before it becomes visible so we can place it on
    // the correct side without a flash.
    submenu.style.display = 'block';
    submenu.style.visibility = 'hidden';
    submenu.style.left = '0';
    submenu.style.right = '';
    submenu.style.top = '0';

    const triggerRect = trigger.getBoundingClientRect();
    const subWidth = submenu.offsetWidth;
    const subHeight = submenu.offsetHeight;

    const spaceRight = window.innerWidth - triggerRect.right - 10;
    const spaceLeft = triggerRect.left - 10;

    // Open on the side with more room (prefer right).
    // Must use 'auto' (not '') to override the CSS default left:100%.
    if (subWidth > spaceRight && spaceLeft > spaceRight) {
      submenu.style.left = 'auto';
      submenu.style.right = '100%';
    } else {
      submenu.style.left = '100%';
      submenu.style.right = 'auto';
    }

    // Shift up if it overflows at the bottom.
    const overflow = (triggerRect.top + subHeight) - window.innerHeight + 10;
    if (overflow > 0) {
      submenu.style.top = -overflow + 'px';
    }

    // Restore — CSS :hover keeps the submenu visible.
    submenu.style.display = '';
    submenu.style.visibility = '';
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
    if (el.querySelector('.moxtags-dialog-group')) return false;
    const text = el.textContent || '';
    return text.includes('Change Tags for') && text.includes('Custom Tags');
  }

  async function injectTagsIntoDialog(dialog) {
    if (dialog.querySelector('.moxtags-dialog-group')) return;

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

    // Create outer wrapper with a distinct background.
    const wrapper = document.createElement('div');
    wrapper.className = 'moxtags-dialog-group';

    const container = document.createElement('div');
    container.className = 'moxtags-dialog-tags';

    const loader = document.createElement('div');
    loader.className = 'moxtags-dialog-loading';
    loader.textContent = 'Loading Scryfall tags…';
    container.appendChild(loader);

    wrapper.appendChild(container);
    insertAfter.after(wrapper);

    // Indent only the first Moxfield Quick Tags dropdown to align with ours.
    const moxDropdowns = dialog.querySelectorAll('.dropdown.d-inline-block:not(.moxtags-dialog-dropdown)');
    if (moxDropdowns.length > 0) {
      moxDropdowns[0].style.marginLeft = '10px';
    }

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

      // Shared state for the tag prefix (deck vs global).
      const prefixState = { prefix: '#' };

      if (tags.artTags.length > 0) {
        container.appendChild(buildTagDropdown('Art Tags', tags.artTags, customTagsInput, prefixState));
      }
      if (tags.cardTags.length > 0) {
        container.appendChild(buildTagDropdown('Card Tags', tags.cardTags, customTagsInput, prefixState));
      }

      // Radio buttons for deck vs global tag scope.
      wrapper.appendChild(buildScopeRadios(prefixState));

      // After rendering, equalize widths across all 4 dropdowns.
      equalizeDropdownWidths(dialog);
    } catch (err) {
      error('Change Tags dialog: tag fetch failed:', err);
      loader.textContent = 'Failed to load Scryfall tags';
      loader.classList.add('moxtags-error');
    }
  }

  function buildTagDropdown(label, tags, customTagsInput, prefixState) {
    const wrapper = document.createElement('div');
    wrapper.className = 'dropdown d-inline-block moxtags-dialog-dropdown';

    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary dropdown-toggle moxtags-dialog-select';
    btn.type = 'button';
    btn.textContent = label;

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu dropdown-menu-scrollable moxtags-dialog-menu';

    for (const tag of tags) {
      const item = document.createElement('button');
      item.className = 'dropdown-item';
      item.type = 'button';
      item.textContent = tag.name;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        addTagToCustomInput(customTagsInput, tag.name, prefixState.prefix);
        menu.classList.remove('show');
      });
      menu.appendChild(item);
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close any other open moxtags menus first.
      document.querySelectorAll('.moxtags-dialog-menu.show').forEach(m => {
        if (m !== menu) m.classList.remove('show');
      });
      menu.classList.toggle('show');
    });

    // Close when clicking outside.
    document.addEventListener('click', () => menu.classList.remove('show'));

    wrapper.appendChild(btn);
    wrapper.appendChild(menu);
    return wrapper;
  }

  function buildScopeRadios(prefixState) {
    const container = document.createElement('div');
    container.className = 'moxtags-dialog-scope';

    const options = [
      { label: 'Add as Deck Tags', prefix: '#' },
      { label: 'Add as Global Tags', prefix: '#!' },
    ];

    for (const opt of options) {
      const lbl = document.createElement('label');
      lbl.className = 'moxtags-dialog-radio-label';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'moxtags-tag-scope';
      radio.value = opt.prefix;
      radio.checked = opt.prefix === prefixState.prefix;
      radio.addEventListener('change', () => {
        prefixState.prefix = opt.prefix;
      });

      lbl.appendChild(radio);
      lbl.appendChild(document.createTextNode(' ' + opt.label));
      container.appendChild(lbl);
    }

    return container;
  }

  function addTagToCustomInput(input, tagName, prefix) {
    // "some-tag-name" → "Some Tag Name"
    const display = tagName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const hashTag = prefix + display;
    const currentVal = input.value.trim();

    // Don't add duplicates.
    const existing = currentVal.split(',').map(t => t.trim().toLowerCase());
    if (existing.includes(hashTag.toLowerCase())) return;

    const newVal = currentVal ? currentVal + ', ' + hashTag : hashTag;
    input.value = newVal;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function equalizeDropdownWidths(dialog) {
    const moxButtons = dialog.querySelectorAll(
      '.dropdown:not(.moxtags-dialog-dropdown) > button.btn-secondary'
    );
    const ourSelects = dialog.querySelectorAll('.moxtags-dialog-select');
    for (const el of [...moxButtons, ...ourSelects]) el.style.width = '158px';
  }

  // ─── Background communication ──────────────────────────────────────
  function bgFetch(url) {
    log('bgFetch: requesting', url);
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'fetch', url }, (resp) => {
        if (chrome.runtime.lastError) {
          warn('bgFetch: runtime error:', chrome.runtime.lastError.message);
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (resp?.ok) {
          log('bgFetch: success, body length:', resp.body?.length);
          resolve(resp.body);
        } else {
          warn('bgFetch: failed for', url, ':', resp?.error, 'status:', resp?.status);
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
