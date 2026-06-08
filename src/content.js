// MoxTags – Content Script
// Injects Scryfall Tagger art/card tags into Moxfield card context menus.

import { buildCardMap } from './moxfield/deck.js';
import { parseCardIdFromHref } from './moxfield/card.js';
import { findUnprocessedMoreOptionsButtons, findUnprocessedCardSearchRows, extractCardInfoFromRow } from './moxfield/longlayout.js';
import {
  extractCardPageInfo,
  findCardPagePrintingDetails,
  findFormatLegalitiesHeading,
} from './moxfield/cardpage.js';
import { extractCardOverlayInfo, findLegalityGrid } from './moxfield/overlay.js';
import { MENU_KEYWORDS } from './moxfield/constants.js';
import {
  extractDeckId as _extractDeckId, identifyCard as _identifyCard,
  scanForCardName as _scanForCardName, isCardMenu as _isCardMenu,
  findSmallestMenu as _findSmallestMenu, findAnchorItem as _findAnchorItem,
  extractCardIdFromMenu as _extractCardIdFromMenu,
  addToSearchAndRun as _addToSearchAndRun,
  hasDeckSearchControls as _hasDeckSearchControls,
  isPublicDeckActionMenu as _isPublicDeckActionMenu,
  extractCardInfoFromSearchResultCard as _extractCardInfoFromSearchResultCard,
  extractCardInfoFromSearchResultTarget as _extractCardInfoFromSearchResultTarget,
} from './moxfield/dom.js';
import {
  readInterceptedDeck as _readInterceptedDeck,
  waitForInterceptedDeck as _waitForInterceptedDeck,
} from './moxfield/intercept.js';
import { lookupCardByMoxfieldId as _lookupCardByMoxfieldId } from './moxfield/api.js';
import { createTagAutocomplete } from './shared/tag-autocomplete-ui.js';
import { bindPersistentCollapsibleSection } from './shared/collapsible-state.js';
import { buildScryfallSearchUrl } from './shared/scryfall-page.js';
import { installMenuToggle } from './shared/menu-toggle.js';
import { loadMoxIdCache, createMoxIdPersister } from './cache/mox-ids.js';

(function () {
  'use strict';

  // Tracks whether we are currently injecting, to debounce multiple detection paths.
  let injecting = false;

  // ─── State ──────────────────────────────────────────────────────────
  let deckId = null;
  let deckUrl = null;
  let pageType = null;    // 'deck' | 'cardSearch' | 'cardPage'
  let cardMap = new Map();   // lowercase card name → { name, set, cn }
  let tagCache = new Map();  // "set/cn" → { artTags: [], cardTags: [] }
  let currentCard = null;    // info object of most-recently-clicked card
  let searchTagsOnScryfall = false;
  let observer = null;
  let lastUrl = location.href;
  let navWatcherId = null;
  let cardPageRetryTimer = null;

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

  const tagAutocomplete = createTagAutocomplete({
    findInputs: () => {
      const input = document.getElementById('deckbox-search');
      return input ? [input] : [];
    },
    label: '#deckbox-search',
    log,
    warn,
  });

  // ─── Bootstrap ──────────────────────────────────────────────────────
  log('Content script loaded at', location.href);
  init();

  function init() {
    pageType = getPageType();
    if (!pageType) {
      log('Not a supported page, skipping init');
      return;
    }

    if (pageType === 'deck') {
      deckId = extractDeckId();
      deckUrl = location.origin + '/decks/' + deckId;
      log('Initializing for deck', deckId, 'at', deckUrl);
      fetchDeckData();
    } else if (pageType === 'cardSearch') {
      log('Initializing for card search page');
    } else if (pageType === 'cardPage') {
      log('Initializing for card page');
    }

    // Track which card row the user clicked on.
    document.addEventListener('mousedown', onMouseDown, true);

    // Watch for new DOM nodes (the dropdown menu is inserted dynamically).
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden', 'hidden', 'href', 'src'],
    });

    // Re-init when the SPA navigates to a different page.
    watchNavigation();

    // Set up search box autocomplete for tag names.
    setupAutocomplete();

    // On card pages, inject tags into the page content immediately.
    if (pageType === 'cardPage') {
      injectTagsIntoCardPage();
    }
  }

  function getPageType() {
    if (extractDeckId()) return 'deck';
    if (/^\/search(\/|$)/.test(location.pathname)) return 'cardSearch';
    if (/^\/cards\//.test(location.pathname)) return 'cardPage';
    return null;
  }

  function cleanup() {
    log('cleanup: disconnecting observer, removing listeners');
    if (observer) observer.disconnect();
    document.removeEventListener('mousedown', onMouseDown, true);
    cardMap.clear();
    tagCache.clear();
    currentCard = null;
    lastOptionsCard = null;
    searchTagsOnScryfall = false;
    if (cardPageRetryTimer) {
      clearTimeout(cardPageRetryTimer);
      cardPageRetryTimer = null;
    }
    pageType = null;
    deckId = null;
    deckUrl = null;
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

    // Remove any card-page tag sections injected into the page content.
    document.querySelectorAll('.moxtags-moxfield-overlay-tags').forEach(el => el.remove());
    document.querySelectorAll('.moxtags-moxfield-overlay-divider').forEach(el => el.remove());
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
    const searchResultInfo = extractCardInfoFromSearchResultTarget(e.target);
    if (searchResultInfo) {
      currentCard = searchResultInfo;
      lastOptionsCard = null;
      log('Card context set (from search result) →', searchResultInfo.name || searchResultInfo.moxCardId);
      return;
    }

    const name = identifyCard(e.target);
    if (name) {
      const info = cardMap.get(name.toLowerCase());
      if (info) {
        const cardContainer = e.target.closest?.('[data-hash]');
        const cardLink = cardContainer?.querySelector?.('a[href*="/cards/"]') || e.target.closest?.('a[href*="/cards/"]');
        const moxCardId = cardContainer?.dataset?.hash || parseCardIdFromHref(cardLink?.getAttribute('href'));
        currentCard = moxCardId ? { ...info, moxCardId } : info;
        lastOptionsCard = null;
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
        scanForCardOverlay(node);
        scanForCardDropdown(node);
        scanForLongLayout(node);
        scanForCardPageContent(node);
      }
      // Also check attribute changes – menus may be shown/hidden via style.
      if (mut.type === 'attributes' && mut.target?.nodeType === Node.ELEMENT_NODE) {
        scanForMenu(mut.target);
        scanForDialog(mut.target);
        scanForCardOverlay(mut.target);
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
        if (isPublicDeckActionMenu(c)) markSearchTagsOnScryfall('public deck menu');
        log('Menu detected via MutationObserver, card:', currentCard?.name);
        injectTagsIntoMenu(c);
        return;
      }
    }
    // Walk up – the mutation may be inside a menu that already exists.
    let parent = el.parentElement;
    for (let i = 0; i < 10 && parent && parent !== document.body; i++) {
      if (isCardMenu(parent)) {
        if (isPublicDeckActionMenu(parent)) markSearchTagsOnScryfall('public deck menu');
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

  function isPublicDeckActionMenu(el) {
    return _isPublicDeckActionMenu(el, { root: document, deckId });
  }

  // ─── Search result card dropdown detection ─────────────────────────
  // On deck search pages, each card has a small "Options" dropdown.
  // It doesn't match the full context-menu heuristic, and Moxfield
  // renders it as a React portal on <body>, not inside the card.
  // Detect it by looking for .dropdown-menu elements with card-specific
  // menu text like "Add to Main Deck".

  const CARD_DROPDOWN_MARKERS = [
    'Add to Main Deck', 'Add to Sideboard',
    'Add to Another Deck', 'Add to Collection', 'Add to Wish List',
    'View Details', 'Copy Card Name', 'Buy on Mana Pool',
  ];

  // Track which card's Options was most recently clicked, since Moxfield
  // portals the dropdown to <body> (losing the card context).
  let lastOptionsCard = null;

  document.addEventListener('mousedown', (e) => {
    const toggle = e.target.closest?.('.dropdown-toggle');
    if (!toggle) return;
    const card = toggle.closest('.decklist-card');
    if (!card) {
      log('Options toggle clicked but no .decklist-card parent found');
      return;
    }
    // Clear currentCard — the general onMouseDown handler may have matched
    // a different card visible on the page (e.g. a deck card on the search
    // results page) instead of the one whose Options button was clicked.
    currentCard = null;
    const info = extractCardInfoFromSearchResultCard(card);
    if (!info) {
      log('Options toggle clicked but no card identity found in .decklist-card');
      return;
    }
    lastOptionsCard = info;
    if (info.set && info.cn) {
      log('Options click tracked:', info.name, `(${info.set}/${info.cn})`);
    } else {
      log('Options click tracked:', info.name, '(not in deck cardMap)', info.moxCardId ? `moxCardId=${info.moxCardId}` : 'no moxCardId');
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
        const info = extractCardInfoFromSearchResultCard(card);
        if (!info) continue;
        currentCard = info;
        log('Card dropdown detected (inline):', info.name || info.moxCardId);
        injectTagsIntoMenu(menu);
        continue;
      }

      // Case B: body-level portal with card-action menu items.
      const text = menu.textContent || '';
      if (!CARD_DROPDOWN_MARKERS.some(m => text.includes(m))) continue;
      const isSearchResultDropdown = text.includes('Add to Main Deck') || text.includes('Add to Sideboard');
      if (isPublicDeckActionMenu(menu)) markSearchTagsOnScryfall('public deck dropdown');

      // Search-result Options menus should prefer the tracked Options click;
      // public deck action menus should prefer the general card click context.
      const cardInfo = isSearchResultDropdown
        ? (lastOptionsCard || currentCard)
        : (currentCard || lastOptionsCard);
      if (!cardInfo) {
        log('Card dropdown found but could not identify card');
        continue;
      }
      currentCard = cardInfo;

      log('Card dropdown detected (portal):', currentCard.name);
      injectTagsIntoMenu(menu);
    }
  }

  function extractCardInfoFromSearchResultCard(card) {
    return _extractCardInfoFromSearchResultCard(card, cardMap);
  }

  function extractCardInfoFromSearchResultTarget(target) {
    return _extractCardInfoFromSearchResultTarget(target, cardMap);
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
    if (!currentCard && !lastOptionsCard) {
      return;
    }
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
        if (isPublicDeckActionMenu(el)) markSearchTagsOnScryfall('public deck menu');
        log('Menu detected via polling (targeted selectors)');
        injectTagsIntoMenu(el);
        return;
      }
    }
    // Broader fallback: check direct children of body (React portals).
    for (const el of document.body.children) {
      const found = findSmallestMenu(el);
      if (found) {
        if (isPublicDeckActionMenu(found)) markSearchTagsOnScryfall('public deck menu');
        log('Menu detected via polling (body child walk)');
        injectTagsIntoMenu(found);
        return;
      }
    }
  }

  function findSmallestMenu(root) {
    return _findSmallestMenu(root, MENU_KEYWORDS);
  }

  function getCardContextKey(cardInfo) {
    if (!cardInfo) return '';
    if (cardInfo.moxCardId) return `mox:${cardInfo.moxCardId}`;
    if (cardInfo.set && cardInfo.cn) return `${cardInfo.set}/${cardInfo.cn}`;
    if (cardInfo.name) return `name:${cardInfo.name.toLowerCase()}`;
    return '';
  }

  // ─── Long layout detection & injection ──────────────────────────────
  // Search results "long" layout: each card is a full-width row with
  // action buttons in a side column. Two variants:
  //   - Deck search: ends with "More Options" button
  //   - Card search: ends with "Add to Wish List" button
  // We add standalone "Art Tags" / "Card Tags" buttons after the last button.

  function scanForLongLayout(el) {
    const moreOpts = findUnprocessedMoreOptionsButtons(el);
    if (moreOpts.length > 0) {
      log('scanForLongLayout: found', moreOpts.length, 'unprocessed More Options buttons');
    }
    for (const { button, row } of moreOpts) {
      injectLongLayoutButtons(button, row);
    }

    const searchRows = findUnprocessedCardSearchRows(el);
    if (searchRows.length > 0) {
      log('scanForLongLayout: found', searchRows.length, 'unprocessed card search text rows');
    }
    for (const { button, row } of searchRows) {
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
    wrapper.dataset.moxtagsSurface = 'moxfield-long-layout';
    if (moxCardId) wrapper.dataset.moxtagsCardKey = `mox:${moxCardId}`;
    wrapper.appendChild(buildLongLayoutTagButton('Art Tags', 'art', moxCardId, cardName));
    wrapper.appendChild(buildLongLayoutTagButton('Card Tags', 'otag', moxCardId, cardName));
    moreOptionsBtn.after(wrapper);
  }

  function buildLongLayoutTagButton(title, searchPrefix, moxCardId, cardName) {
    const container = document.createElement('div');
    container.className = 'moxtags-long-tag-container mt-2';
    container.dataset.moxtagsTrigger = searchPrefix === 'art' ? 'art-tags' : 'card-tags';

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
    menu.dataset.moxtagsSurface = 'moxfield-long-layout-menu';
    container.appendChild(menu);

    let loaded = false;

    installMenuToggle({
      button: btn,
      menu,
      container,
      onOpen: () => loadTagsOnFirstOpen(),
    });

    async function loadTagsOnFirstOpen() {
      log('Long layout button clicked:', title, 'cardId:', moxCardId, 'name:', cardName);

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
    }

    return container;
  }

  // Long-layout menus are closed by per-menu one-time mousedown handlers
  // registered when each menu opens (see buildLongLayoutTagButton).

  function renderLongMenuTags(menu, tags, searchPrefix) {
    const searchBtn = document.createElement('button');
    searchBtn.className = 'moxtags-search-btn';
    searchBtn.textContent = searchActionLabel();
    searchBtn.style.display = 'none';
    menu.appendChild(searchBtn);

    const checked = new Set();

    function updateSearchBtn() {
      if (checked.size > 0) {
        searchBtn.textContent = searchButtonText(checked.size);
        searchBtn.style.display = '';
      } else {
        searchBtn.style.display = 'none';
      }
    }

    searchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parts = [...checked].map(slug => `${searchPrefix}:${slug}`);
      const q = parts.join(' ');
      runTagSearch(q);
      menu.classList.remove('show');
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
      a.title = tagSearchTitle();
      a.href = buildTagSearchUrl(searchPrefix + ':' + tag.slug);
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const query = `${searchPrefix}:${tag.slug}`;
        runTagSearch(query);
        menu.classList.remove('show');
      });
      row.appendChild(a);

      menu.appendChild(row);
    }
  }

  // ─── Tag injection ─────────────────────────────────────────────────
  async function injectTagsIntoMenu(menu, options = {}) {
    const useGlobalDebounce = !options.previewPanel;
    const insertionContainer = options.previewPanel
      ? menu
      : (menu.matches?.('.dropdown-menu')
        ? (menu.querySelector(':scope > .dropdown-menu-parent') || menu)
        : menu);

    // Debounce: multiple detection paths may fire simultaneously.
    if (useGlobalDebounce && injecting) {
      log('injectTagsIntoMenu: skipping, already injecting');
      return;
    }
    if (useGlobalDebounce) injecting = true;

    if (!currentCard) {
      warn('No card context when menu opened');
      if (useGlobalDebounce) injecting = false;
      return;
    }

    const cardKey = options.cardKey || getCardContextKey(currentCard);
    const existingInjection = insertionContainer.querySelector('.moxtags-injected');
    if (cardKey && existingInjection?.dataset.moxtagsCardKey === cardKey) {
      if (useGlobalDebounce) injecting = false;
      return;
    }

    // Remove any previous injection in this menu.
    insertionContainer.querySelectorAll('.moxtags-injected').forEach(el => el.remove());

    let { name, set, cn } = currentCard;
    log('injectTagsIntoMenu: card =', name, 'set =', set, 'cn =', cn);

    // If we don't have set/cn, try to resolve via the Moxfield card ID.
    // First check the dropdown menu for a "View Details" link, then fall
    // back to the moxCardId captured when the Options button was clicked.
    if (!set || !cn) {
      let moxCardId = extractCardIdFromMenu(insertionContainer);
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
          currentCard = { ...currentCard, name, set, cn };
          log('injectTagsIntoMenu: resolved to', set, cn);
        } else {
          log('injectTagsIntoMenu: Moxfield ID resolution failed for', moxCardId);
        }
      }
    }

    // Determine where to insert our tags.
    // Two-column deck context menu: insert after "Add to Wish List".
    // Single-column dropdowns: insert at the end, regardless of the final item.
    const leftCol = insertionContainer.querySelector('.d-flex.flex-nowrap > .d-inline-block:first-child');
    const wishListAnchor = (leftCol && findAnchorItem(leftCol, 'Add to Wish List'))
      || (options.previewPanel ? findAnchorItem(insertionContainer, 'Add to Wish List') : null);

    let insertionPoint;
    if (wishListAnchor) {
      insertionPoint = wishListAnchor;
    } else {
      insertionPoint = insertionContainer.lastElementChild;
    }

    // Create a wrapper for all our injected elements.
    const wrapper = document.createElement('div');
    wrapper.className = options.previewPanel ? 'moxtags-injected moxtags-preview-injected d-grid gap-2' : 'moxtags-injected';
    wrapper.dataset.moxtagsSurface = options.previewPanel ? 'moxfield-preview' : 'moxfield-menu';
    if (cardKey) wrapper.dataset.moxtagsCardKey = cardKey;

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
    if (insertionPoint) {
      insertionPoint.after(wrapper);
    } else {
      insertionContainer.appendChild(wrapper);
    }
    if (options.previewPanel) {
      log('injectTagsIntoMenu: preview wrapper inserted, connected =', wrapper.isConnected);
    }

    // Reset state when menu disappears so the next click picks up a fresh card.
    if (!options.persistent) {
      const cleanupObs = new MutationObserver(() => {
        if (!document.body.contains(menu)) {
          cleanupObs.disconnect();
          currentCard = null;
        }
      });
      cleanupObs.observe(document.body, { childList: true, subtree: true });
    }

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
      } else if (name) {
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
      } else {
        warn('No exact card identity or card name available for tag lookup');
        loader.textContent = 'Could not identify card';
        loader.classList.add('moxtags-error');
        return;
      }

      loader.remove();
      if (options.previewPanel && !wrapper.isConnected) {
        if (!menu.isConnected) {
          log('injectTagsIntoMenu: preview panel was replaced before tags rendered');
          return;
        }
        const anchor = findAnchorItem(insertionContainer, 'Add to Wish List') || findAnchorItem(insertionContainer, 'Buy @ Mana Pool');
        if (anchor) {
          anchor.after(wrapper);
        } else {
          insertionContainer.appendChild(wrapper);
        }
        log('injectTagsIntoMenu: preview wrapper reinserted before render');
      }
      renderSubmenus(wrapper, tags, { previewPanel: options.previewPanel });
      if (options.previewPanel) {
        log('injectTagsIntoMenu: preview rendered art =', tags.artTags.length, 'card =', tags.cardTags.length, 'connected =', wrapper.isConnected);
      }
    } catch (err) {
      error('Tag fetch failed:', err);
      if (err.cacheLoading) {
        loader.textContent = 'Downloading tag data…';
        loader.classList.add('moxtags-cache-loading');
      } else {
        loader.textContent = 'Failed to load tags';
        loader.classList.add('moxtags-error');
      }
    } finally {
      if (useGlobalDebounce) injecting = false;
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

  function markSearchTagsOnScryfall(reason) {
    if (searchTagsOnScryfall) return;
    if (canSearchDeckPage()) {
      log('Keeping tag search target on deck page:', reason);
      return;
    }
    searchTagsOnScryfall = true;
    log('Tag search target set to Scryfall:', reason);
  }

  function canSearchDeckPage() {
    return _hasDeckSearchControls(document, deckId);
  }

  function shouldSearchTagsOnScryfall() {
    return searchTagsOnScryfall && !canSearchDeckPage();
  }

  function searchActionLabel() {
    return shouldSearchTagsOnScryfall() ? 'Search Scryfall' : 'Add to Search';
  }

  function searchButtonText(count) {
    const label = searchActionLabel();
    return count > 0 ? `${label} (${count})` : label;
  }

  function tagSearchTitle() {
    return shouldSearchTagsOnScryfall() ? 'Search Scryfall for this tag' : 'Add to search';
  }

  function buildTagSearchUrl(query) {
    if (shouldSearchTagsOnScryfall()) {
      return buildScryfallSearchUrl(query);
    }
    const base = deckUrl ? `${deckUrl}/search` : '/search/cards';
    return `${base}?q=${encodeURIComponent(query)}`;
  }

  function runTagSearch(query) {
    if (shouldSearchTagsOnScryfall()) {
      window.location.href = buildScryfallSearchUrl(query);
      return true;
    }
    if (addToSearchAndRun(query)) return true;
    window.location.href = buildTagSearchUrl(query);
    return true;
  }

  function addToSearchAndRun(query) {
    const ok = _addToSearchAndRun(query);
    if (!ok) warn('Search input not found, falling back to navigation');
    return ok;
  }

  // ─── Rendering ─────────────────────────────────────────────────────
  function renderSubmenus(wrapper, tags, options = {}) {
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

    const triggerClassName = options.previewPanel
      ? 'btn btn-sm text-start text-ellipsis btn-outline btn-outline-primary moxtags-trigger'
      : 'dropdown-item cursor-pointer no-outline moxtags-trigger';

    if (tags.artTags.length > 0) {
      wrapper.appendChild(buildSubmenuTrigger('Art Tags', tags.artTags, 'art', triggerClassName));
    }
    if (tags.cardTags.length > 0) {
      wrapper.appendChild(buildSubmenuTrigger('Card Tags', tags.cardTags, 'otag', triggerClassName));
    }
  }

  function buildSubmenuTrigger(title, tags, searchPrefix, className = 'dropdown-item cursor-pointer no-outline moxtags-trigger') {
    const trigger = document.createElement('div');
    trigger.className = className;
    trigger.dataset.moxtagsTrigger = searchPrefix === 'art' ? 'art-tags' : 'card-tags';

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

    // Combined tag search button – hidden until checkboxes are ticked.
    const searchBtn = document.createElement('button');
    searchBtn.className = 'moxtags-search-btn';
    searchBtn.textContent = searchActionLabel();
    searchBtn.style.display = 'none';
    submenu.appendChild(searchBtn);

    // Track checked slugs for combined search.
    const checked = new Set();

    function updateSearchBtn() {
      if (checked.size > 0) {
        searchBtn.textContent = searchButtonText(checked.size);
        searchBtn.style.display = '';
      } else {
        searchBtn.style.display = 'none';
      }
    }

    searchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parts = [...checked].map(slug => `${searchPrefix}:${slug}`);
      const q = parts.join(' ');
      runTagSearch(q);
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
      a.title = tagSearchTitle();
      a.href = buildTagSearchUrl(searchPrefix + ':' + tag.slug);
      a.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const query = `${searchPrefix}:${tag.slug}`;
        runTagSearch(query);
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

  // ─── Card view overlay tag sections ─────────────────────────────────
  // Moxfield renders card details as a modal. Add collapsed tag sections
  // immediately above the format legality grid.

  function scanForCardOverlay(el) {
    const overlay = findCardOverlay(el);
    if (overlay) {
      injectTagsIntoCardOverlay(overlay);
      return;
    }

    let parent = el.parentElement;
    for (let i = 0; i < 10 && parent && parent !== document.body; i++) {
      if (isCardOverlay(parent)) {
        injectTagsIntoCardOverlay(parent);
        return;
      }
      parent = parent.parentElement;
    }
  }

  function findCardOverlay(root) {
    if (isCardOverlay(root)) return root;
    const dialogs = root.querySelectorAll?.('[role="dialog"], .modal') || [];
    for (const dialog of dialogs) {
      if (isCardOverlay(dialog)) return dialog;
    }
    return null;
  }

  function isCardOverlay(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (el.querySelector('.moxtags-moxfield-overlay-tags')) return false;
    const isDialog = el.getAttribute?.('role') === 'dialog' || el.classList?.contains('modal');
    if (!isDialog) return false;
    if (!el.querySelector('h1 a[href*="/cards/"]')) return false;
    return Boolean(findLegalityGrid(el));
  }

  async function injectTagsIntoCardOverlay(overlay) {
    if (overlay.querySelector('.moxtags-moxfield-overlay-tags')) return;

    const legalityGrid = findLegalityGrid(overlay);
    if (!legalityGrid) {
      log('Card overlay: legality grid not found');
      return;
    }

    const identity = extractCardOverlayInfo(overlay);
    if (!identity.name && !identity.moxCardId) {
      log('Card overlay: could not extract card identity');
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'moxtags-moxfield-overlay-tags';
    wrapper.dataset.moxtagsSurface = 'moxfield-card-overlay';

    const loader = document.createElement('p');
    loader.className = 'moxtags-moxfield-overlay-message text-muted';
    loader.textContent = 'Loading Scryfall tags…';
    wrapper.appendChild(loader);

    const divider = document.createElement('hr');
    divider.className = 'my-4 moxtags-moxfield-overlay-divider';
    legalityGrid.before(wrapper, divider);

    try {
      const tags = await loadTagsForOverlay(identity);
      wrapper.innerHTML = '';
      renderCardOverlayTags(wrapper, tags);
    } catch (err) {
      error('Card overlay tag fetch failed:', err);
      loader.textContent = err.cacheLoading ? 'Downloading tag data…' : 'Failed to load tags';
      loader.classList.add('moxtags-error');
    }
  }

  async function loadTagsForOverlay(identity) {
    let { name, set, cn, moxCardId } = identity;

    if ((!set || !cn) && name) {
      const cardInfo = cardMap.get(name.toLowerCase());
      if (cardInfo) {
        set = cardInfo.set;
        cn = cardInfo.cn;
        log('Card overlay: resolved from cardMap:', name, '→', set, cn);
      }
    }

    if ((!set || !cn) && moxCardId) {
      const resolved = await lookupCardByMoxfieldId(moxCardId);
      if (resolved) {
        set = resolved.set;
        cn = resolved.cn;
        log('Card overlay: resolved from Moxfield ID:', moxCardId, '→', set, cn);
      }
    }

    if (set && cn) {
      const cacheKey = `${set}/${cn}`;
      const cached = tagCache.get(cacheKey);
      if (cached) {
        log('Card overlay: tags from cache for', cacheKey);
        return cached;
      }
      log('Card overlay: loading tags for', cacheKey);
      const tags = await loadTags(set, cn);
      tagCache.set(cacheKey, tags);
      return tags;
    }

    if (name) {
      const cacheKey = `name:${name.toLowerCase()}`;
      const cached = tagCache.get(cacheKey);
      if (cached) {
        log('Card overlay: tags from cache for', cacheKey);
        return cached;
      }
      log('Card overlay: loading tags by name for', name);
      const tags = await loadTagsByName(name);
      tagCache.set(cacheKey, tags);
      return tags;
    }

    throw new Error('No card identity available for tag lookup');
  }

  function renderCardOverlayTags(wrapper, tags) {
    if (tags.artTags.length === 0 && tags.cardTags.length === 0) {
      const empty = document.createElement('p');
      if (tags.cacheLoading) {
        empty.className = 'moxtags-moxfield-overlay-message text-muted';
        empty.textContent = 'Downloading tag data…';
      } else {
        empty.className = 'moxtags-moxfield-overlay-message text-muted';
        empty.textContent = 'No Scryfall tags found';
      }
      wrapper.appendChild(empty);
      return;
    }

    const selection = buildCardOverlaySelectionController();

    if (tags.cardTags.length > 0) {
      wrapper.appendChild(buildCardOverlayTagSection('Card Tags', tags.cardTags, 'otag', selection));
    }
    if (tags.artTags.length > 0) {
      wrapper.appendChild(buildCardOverlayTagSection('Art Tags', tags.artTags, 'art', selection));
    }

    wrapper.appendChild(selection.button);
  }

  function buildCardOverlaySelectionController() {
    const selected = new Map();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-sm text-start text-ellipsis btn-outline btn-outline-primary moxtags-moxfield-overlay-search-btn';
    button.textContent = tagSearchButtonLabel();
    button.hidden = true;

    function updateButton() {
      const count = selected.size;
      button.hidden = count === 0;
      const label = tagSearchButtonLabel();
      button.textContent = count > 0 ? `${label} (${count})` : label;
    }

    button.addEventListener('click', () => {
      const query = [...selected.values()].join(' ');
      if (!query) return;
      runTagSearch(query);
    });

    return {
      button,
      set(prefix, slug, checked) {
        const key = `${prefix}:${slug}`;
        if (checked) selected.set(key, key);
        else selected.delete(key);
        updateButton();
      },
    };
  }

  function buildCardOverlayTagSection(title, tags, searchPrefix, selection) {
    const section = document.createElement('section');
    section.className = 'moxtags-moxfield-overlay-section';
    const sectionKey = tagSectionKey(searchPrefix);
    section.dataset.moxtagsSection = sectionKey;

    const heading = document.createElement('h3');
    heading.className = 'moxtags-moxfield-overlay-heading';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'moxtags-moxfield-overlay-toggle';
    toggle.dataset.moxtagsTrigger = sectionKey;

    const chevron = document.createElement('span');
    chevron.className = 'moxtags-moxfield-overlay-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    toggle.appendChild(chevron);

    const label = document.createElement('span');
    label.textContent = `${title} (${tags.length})`;
    toggle.appendChild(label);
    heading.appendChild(toggle);
    section.appendChild(heading);

    const body = document.createElement('div');
    body.className = 'moxtags-moxfield-overlay-section-body';

    const list = document.createElement('div');
    list.className = 'moxtags-moxfield-overlay-tag-list';
    for (const tag of tags) {
      list.appendChild(buildCardOverlayTagRow(tag, searchPrefix, selection));
    }
    body.appendChild(list);
    section.appendChild(body);

    const toggleExpanded = bindPersistentCollapsibleSection({
      site: 'moxfield',
      section: sectionKey,
      toggle,
      body,
      onError: warn,
    });

    toggle.addEventListener('click', () => {
      toggleExpanded();
    });

    return section;
  }

  function tagSectionKey(prefix) {
    return prefix === 'art' ? 'art-tags' : 'card-tags';
  }

  function buildCardOverlayTagRow(tag, searchPrefix, selection) {
    const row = document.createElement('div');
    row.className = 'moxtags-moxfield-overlay-tag-row';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'moxtags-moxfield-overlay-tag-cb';
    cb.addEventListener('change', () => {
      selection.set(searchPrefix, tag.slug, cb.checked);
    });
    row.appendChild(cb);

    const link = document.createElement('a');
    link.className = 'moxtags-moxfield-overlay-tag-link';
    link.dataset.moxtagsTagPrefix = searchPrefix;
    link.textContent = tag.name;
    link.title = shouldSearchTagsOnScryfall()
      ? 'Search Scryfall for this tag'
      : 'Search Moxfield for this tag';
    const query = `${searchPrefix}:${tag.slug}`;
    link.href = buildTagSearchUrl(query);
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      runTagSearch(query);
    });
    row.appendChild(link);

    return row;
  }

  function tagSearchButtonLabel() {
    return shouldSearchTagsOnScryfall() ? 'Search Scryfall' : 'Search by tags';
  }

  // ─── Standalone card page tag injection ─────────────────────────────
  // Card pages (/cards/{id}-slug) show a single card with set info,
  // pricing, legalities, rulings, etc. Inject tag sections after the printed
  // set/collector details, reusing the same overlay-style rendering.

  function scanForCardPageContent(el) {
    if (pageType !== 'cardPage') return;
    const container = document.querySelector('main') || document.body;
    if (container.querySelector('.moxtags-moxfield-overlay-tags')) return;
    const printingDetails = findCardPagePrintingDetails(el) || findCardPagePrintingDetails(container);
    if (printingDetails) {
      injectTagsIntoCardPage();
    }
  }

  async function injectTagsIntoCardPage(options = {}) {
    const attempt = options.attempt || 0;
    const container = document.querySelector('main') || document.body;
    if (container.querySelector('.moxtags-moxfield-overlay-tags')) return;

    const printingDetails = findCardPagePrintingDetails(container);
    const heading = findFormatLegalitiesHeading(container);
    const legalityGrid = findLegalityGrid(container);
    const fallbackBefore = attempt >= 6 ? heading || legalityGrid : null;
    if (!printingDetails && !fallbackBefore) {
      log('Card page: printing details not found, retrying…');
      scheduleCardPageInjectionRetry(attempt + 1);
      return;
    }
    if (cardPageRetryTimer) {
      clearTimeout(cardPageRetryTimer);
      cardPageRetryTimer = null;
    }

    const identity = extractCardPageInfo(location.pathname, container);
    if (!identity.name && !identity.moxCardId) {
      log('Card page: could not extract card identity');
      return;
    }
    log('Card page: identity →', identity.name, identity.set, identity.cn, identity.moxCardId);

    const wrapper = document.createElement('div');
    wrapper.className = 'moxtags-moxfield-overlay-tags';
    wrapper.dataset.moxtagsSurface = 'moxfield-card-page';
    const cardKey = getCardContextKey(identity);
    if (cardKey) wrapper.dataset.moxtagsCardKey = cardKey;

    const loader = document.createElement('p');
    loader.className = 'moxtags-moxfield-overlay-message text-muted';
    loader.textContent = 'Loading Scryfall tags…';
    wrapper.appendChild(loader);

    const divider = document.createElement('hr');
    divider.className = 'my-4 moxtags-moxfield-overlay-divider';

    if (printingDetails) {
      const followingSeparator = findNextElementSibling(printingDetails, el => el.matches('hr'));
      if (followingSeparator) {
        followingSeparator.before(wrapper);
      } else {
        printingDetails.after(wrapper, divider);
      }
    } else {
      fallbackBefore.before(wrapper, divider);
    }

    try {
      const tags = await loadTagsForOverlay(identity);
      wrapper.innerHTML = '';
      renderCardOverlayTags(wrapper, tags);
    } catch (err) {
      error('Card page tag fetch failed:', err);
      loader.textContent = err.cacheLoading ? 'Downloading tag data…' : 'Failed to load tags';
      loader.classList.add('moxtags-error');
    }

    function findNextElementSibling(el, predicate) {
      let sibling = el.nextElementSibling;
      while (sibling) {
        if (predicate(sibling)) return sibling;
        sibling = sibling.nextElementSibling;
      }
      return null;
    }
  }

  function scheduleCardPageInjectionRetry(attempt) {
    if (cardPageRetryTimer) return;
    const retryPageType = pageType;
    cardPageRetryTimer = setTimeout(() => {
      cardPageRetryTimer = null;
      if (pageType === retryPageType) injectTagsIntoCardPage({ attempt });
    }, 500);
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
    if (navWatcherId) return; // already watching
    navWatcherId = setInterval(() => {
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
    tagAutocomplete.setup();
  }

  function detachAutocomplete() {
    tagAutocomplete.detach();
  }

  // ─── Logging helpers ──────────────────────────────────────────────
  function log(...args)   { console.log('[MoxTags]', ...args); }
  function warn(...args)  { console.warn('[MoxTags]', ...args); }
  function error(...args) { console.error('[MoxTags]', ...args); }
})();
