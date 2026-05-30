// MoxTags - Archidekt content script.
// Injects Scryfall Tagger art/card tag submenus into Archidekt card menus.

import {
  appendArchidektTagQuery,
  buildArchidektCombinedTagQuery,
  parseCardIdentityFromAlt,
  parseCardIdentityFromDeckCard,
} from './shared/archidekt-page.js';
import { bindPersistentCollapsibleSection } from './shared/collapsible-state.js';
import { createTagAutocomplete } from './shared/tag-autocomplete-ui.js';

(function () {
  'use strict';

  const TAG = '[MoxTags Archidekt]';
  const DEBUG_BUILD = 'archidekt-debug-2026-05-27-current-api-cards';
  const INJECTED_CLASS = 'moxtags-archidekt-injected';
  const DETAILS_TAGS_CLASS = 'moxtags-archidekt-details-tags';
  const MENU_SELECTOR = [
    '[class*="deckCardContextMenu_contextMenu"]',
    '[class*="imageCard_extrasMenu"]',
    '[class*="textViewCard_dropdown"]',
  ].join(', ');
  const CARD_DETAILS_OVERLAY_SELECTOR = '[class*="cardDetailsOverlay_container"]';
  const CARD_INFO_EXTRA_SELECTOR = '[class*="cardInfo_extraInfo"]';
  const SEARCH_OVERLAY_SELECTOR = '[class*="globalOverlayStack_overlay"]';
  const SEARCH_CONTAINER_SELECTOR = '[class*="searchV2_container"]';
  const SYNTAX_FORM_SELECTOR = '[class*="scryfallSearchForm_form"]';
  const SYNTAX_INPUT_SELECTOR = '[class*="scryfallSearchForm_input"] input[type="text"], input[placeholder="color:red cmc:1"]';
  const QUICK_ADD_SYNTAX_INPUT_SELECTOR = '[class*="quickAddCard_input"], input[placeholder^="is:shockland"]';
  const TAG_AUTOCOMPLETE_INPUT_SELECTOR = `${QUICK_ADD_SYNTAX_INPUT_SELECTOR}, ${SYNTAX_INPUT_SELECTOR}`;
  const CARD_CLASS_FRAGMENTS = [
    'basicCard_container',
    'deckCardWrapper_container',
    'contextMenu_wrapper',
    'textViewCard_card',
  ];

  let activeCard = null;
  let activeCardAt = 0;
  let deckInitialized = false;
  let activationObserver = null;
  let observer = null;
  let menuObserver = null;
  let observedMenu = null;
  let lastUrl = location.href;
  let navInterval = null;
  let navigationHooked = false;
  let prefetchTimer = null;
  let deckIdentityMap = null;
  let deckDataAbort = null;
  let deckDataDeckId = null;
  let deckDataPromise = null;
  let lastMenuScanDebug = '';
  let lastActivationDebug = '';
  const tagCache = new Map();
  const tagAutocomplete = createTagAutocomplete({
    findInputs: () => document.querySelectorAll(TAG_AUTOCOMPLETE_INPUT_SELECTOR),
    label: 'Archidekt search input',
    log,
    warn,
    dispatchChangeOnSelect: true,
    stopHandledKeyPropagation: true,
    selectOnEnter: true,
    observeMutations: false,
  });

  log('Content script loaded:', { debugBuild: DEBUG_BUILD, ...describePageState() });
  init();

  function init() {
    log('init()', describePageState());
    tagAutocomplete.setup();
    watchNavigation();
    watchDeckActivation();

    if (!isDeckPage()) {
      log('Not a deck page yet; waiting for SPA navigation or deck DOM activation.');
      return;
    }

    startDeckPage();
  }

  function startDeckPage() {
    if (deckInitialized) {
      log('startDeckPage() called while already initialized; rescanning.', describePageState());
      onMutations();
      return;
    }

    deckInitialized = true;
    log('Initializing for Archidekt deck page:', location.href);
    document.addEventListener('pointerdown', onPointerMenuIntent, true);
    document.addEventListener('contextmenu', onPointerMenuIntent, true);
    document.addEventListener('mousedown', onPointerMenuIntent, true);

    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });
    log('Deck MutationObserver attached.');

    startDeckDataLoad();
    schedulePrefetchVisibleCards();
    scanForMenu();
    scanForCardDetails();
  }

  function cleanup({ keepNavigation = false } = {}) {
    log('cleanup()', { keepNavigation, ...describePageState() });
    deckInitialized = false;
    if (observer) observer.disconnect();
    observer = null;
    if (menuObserver) menuObserver.disconnect();
    menuObserver = null;
    observedMenu = null;
    document.removeEventListener('pointerdown', onPointerMenuIntent, true);
    document.removeEventListener('contextmenu', onPointerMenuIntent, true);
    document.removeEventListener('mousedown', onPointerMenuIntent, true);
    document.querySelectorAll(`.${INJECTED_CLASS}, .${DETAILS_TAGS_CLASS}`).forEach(el => el.remove());
    activeCard = null;
    activeCardAt = 0;
    deckIdentityMap = null;
    if (deckDataAbort) deckDataAbort.abort();
    deckDataAbort = null;
    deckDataDeckId = null;
    deckDataPromise = null;
    tagCache.clear();
    if (prefetchTimer) clearTimeout(prefetchTimer);
    prefetchTimer = null;

    if (!keepNavigation && navInterval) {
      clearInterval(navInterval);
      navInterval = null;
    }

    if (!keepNavigation && activationObserver) {
      activationObserver.disconnect();
      activationObserver = null;
    }
  }

  function isDeckPage() {
    return /^\/decks\/[^/]+/.test(location.pathname);
  }

  function watchNavigation() {
    if (!navigationHooked) {
      navigationHooked = true;
      log('Installing SPA navigation hooks.');
      for (const method of ['pushState', 'replaceState']) {
        const original = history[method];
        history[method] = function (...args) {
          const result = original.apply(this, args);
          log(`history.${method} called; scheduling navigation check.`, { nextUrl: String(args[2] || '') });
          setTimeout(handleNavigationChange, 0);
          return result;
        };
      }

      window.addEventListener('popstate', handleNavigationChange);
      window.addEventListener('hashchange', handleNavigationChange);
    }

    if (!navInterval) {
      navInterval = setInterval(handleNavigationChange, 1000);
      log('Navigation polling interval started.');
    }
  }

  function watchDeckActivation() {
    if (activationObserver) {
      log('Deck activation observer already attached.');
      return;
    }

    activationObserver = new MutationObserver(() => {
      tagAutocomplete.scan();
      if (isDeckPage()) {
        const activationKey = `${location.href}|${deckInitialized}`;
        if (activationKey !== lastActivationDebug) {
          lastActivationDebug = activationKey;
          log('Deck activation observer saw deck page DOM mutation.', describePageState());
        }
      }
      if (isDeckPage() && !deckInitialized) {
        startDeckPage();
      }
    });
    activationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    log('Deck activation observer attached.');
  }

  function handleNavigationChange() {
    if (location.href === lastUrl) return;
    const previousUrl = lastUrl;
    lastUrl = location.href;
    log('Navigation changed.', {
      from: previousUrl,
      to: location.href,
      isDeckPage: isDeckPage(),
      deckInitialized,
    });
    cleanup({ keepNavigation: true });
    init();
  }

  function onPointerMenuIntent(event) {
    const isContextMenu = event.type === 'contextmenu';
    const isPointerOrMouseDown = event.type === 'pointerdown' || event.type === 'mousedown';
    const isCardMenuButtonDown = isPointerOrMouseDown && (event.button === 0 || event.button === 2);
    if (!isContextMenu && !isCardMenuButtonDown) return;
    if (event.target instanceof Element && event.target.closest(`.${INJECTED_CLASS}`)) {
      log('Ignoring pointer inside injected MoxTags menu.', { event: event.type });
      return;
    }

    log('Pointer menu intent.', {
      event: event.type,
      button: event.button,
      target: describeElement(event.target),
      activeCard: describeCard(activeCard),
    });

    const card = findCardIdentityFromTarget(event.target);
    if (card) {
      activeCard = card;
      activeCardAt = Date.now();
      log('Resolved active card from pointer target.', {
        card: describeCard(card),
        target: describeElement(event.target),
      });
      return;
    }

    const unresolved = findUnresolvedCardIdentityFromTarget(event.target);
    if (unresolved) {
      activeCard = unresolved;
      activeCardAt = Date.now();
      log('Found unresolved text-view card from pointer target; waiting for deck data.', {
        card: describeCard(unresolved),
        target: describeElement(event.target),
      });
      resolveActiveCardAfterDeckData(unresolved);
      return;
    }

    if (isContextMenu || isCardMenuButtonDown) {
      if (event.target instanceof Element && event.target.closest('#contextMenuOverlay')) {
        log('Pointer target was inside Archidekt menu overlay; preserving active card.', {
          activeCard: describeCard(activeCard),
          target: describeElement(event.target),
        });
        return;
      }
      if (activeCard) {
        log('Pointer target was not a card; clearing active card.', {
          previousActiveCard: describeCard(activeCard),
          target: describeElement(event.target),
        });
      }
      activeCard = null;
      activeCardAt = 0;
    }
  }

  function onMutations() {
    tagAutocomplete.scan();
    schedulePrefetchVisibleCards();
    scanForMenu();
    scanForCardDetails();
  }

  function scanForMenu() {
    const menu = findCardMenu();
    if (!menu) {
      if (activeCard && Date.now() - activeCardAt < 2000) {
        logMenuScan('Waiting for Archidekt menu after card pointer event.', {
          activeCard: describeCard(activeCard),
          overlayPresent: !!document.getElementById('contextMenuOverlay'),
        });
        return;
      }
      logMenuScan('No Archidekt card menu found.', {
        overlayPresent: !!document.getElementById('contextMenuOverlay'),
        activeCard: describeCard(activeCard),
      });
      activeCard = null;
      activeCardAt = 0;
      if (menuObserver) menuObserver.disconnect();
      menuObserver = null;
      observedMenu = null;
      return;
    }

    observeMenu(menu);
    if (!activeCard) {
      logMenuScan('Archidekt card menu found, but no active card is available.', {
        menu: describeElement(menu),
      });
      return;
    }
    if (activeCard.pendingName) {
      logMenuScan('Archidekt card menu found with unresolved active card; resolving from deck data.', {
        menu: describeElement(menu),
        activeCard: describeCard(activeCard),
      });
      resolveActiveCardAfterDeckData(activeCard);
      return;
    }
    if (menu.querySelector(`.${INJECTED_CLASS}`)) {
      logMenuScan('Archidekt card menu already has MoxTags injection.', {
        menu: describeElement(menu),
        activeCard: describeCard(activeCard),
      });
      return;
    }
    logMenuScan('Injecting MoxTags into Archidekt card menu.', {
      menu: describeElement(menu),
      activeCard: describeCard(activeCard),
    });
    injectTagsIntoMenu(menu, activeCard);
  }

  function findCardMenu() {
    const overlay = document.getElementById('contextMenuOverlay');
    if (!overlay) return null;
    const menu = overlay.querySelector(MENU_SELECTOR);
    if (!menu) {
      logMenuScan('contextMenuOverlay exists but no supported card menu matched.', {
        overlayChildren: [...overlay.children].map(describeElement),
      });
    }
    return menu;
  }

  function observeMenu(menu) {
    if (observedMenu === menu) return;
    if (menuObserver) menuObserver.disconnect();
    observedMenu = menu;
    menuObserver = new MutationObserver(() => {
      log('Observed Archidekt menu mutation.', {
        menu: describeElement(menu),
        injected: !!menu.querySelector(`.${INJECTED_CLASS}`),
      });
      if (!menu.querySelector(`.${INJECTED_CLASS}`)) scanForMenu();
    });
    menuObserver.observe(menu, { childList: true, subtree: true });
    log('Observing Archidekt menu.', { menu: describeElement(menu) });
  }

  function findCardIdentityFromTarget(target) {
    const start = target instanceof Element ? target : target?.parentElement;
    if (!start) return null;

    const directImage = start.closest?.('img[alt]');
    const directIdentity = identityFromImage(directImage);
    if (directIdentity) {
      log('Card identity resolved from direct image alt.', {
        card: describeCard(directIdentity),
        image: describeElement(directImage),
      });
      return addSearchContext(directIdentity, start);
    }

    let el = start;
    while (el && el !== document.body && el instanceof Element) {
      if (isCardContainer(el)) {
        const identity = findCardIdentityInContainer(el);
        if (identity) {
          log('Card identity resolved from containing card DOM.', {
            card: describeCard(identity),
            container: describeElement(el),
          });
          return addSearchContext(identity, start);
        }
        log('Card-like container found, but exact card identity was not resolved.', {
          container: describeElement(el),
        });
      }
      el = el.parentElement;
    }

    return null;
  }

  function findUnresolvedCardIdentityFromTarget(target) {
    const start = target instanceof Element ? target : target?.parentElement;
    if (!start) return null;

    let el = start;
    while (el && el !== document.body && el instanceof Element) {
      if (isCardContainer(el)) {
        const name = findTextViewCardNameInContainer(el);
        if (name) {
          log('Found text-view card name without exact identity yet.', {
            name,
            container: describeElement(el),
          });
          return {
            pendingName: name,
            appendToCurrentSearch: isSearchOverlayTarget(start),
          };
        }
      }
      el = el.parentElement;
    }

    return null;
  }

  function resolveActiveCardAfterDeckData(candidate) {
    if (!candidate?.pendingName) return;
    log('Resolving active card after deck data load.', { candidate: describeCard(candidate) });
    startDeckDataLoad()?.then(() => {
      if (activeCard !== candidate) {
        log('Skipping deck-data identity resolution because active card changed.', {
          candidate: describeCard(candidate),
          activeCard: describeCard(activeCard),
        });
        return;
      }

      const identity = findUniqueDeckIdentityByName(candidate.pendingName);
      if (!identity) {
        log('Deck/page data did not produce a unique identity for text-view card.', {
          candidate: describeCard(candidate),
          knownNameMatches: getDeckIdentitiesByName().get(candidate.pendingName.toLowerCase())?.map(describeCard) || [],
        });
        return;
      }

      activeCard = {
        ...identity,
        appendToCurrentSearch: candidate.appendToCurrentSearch,
      };
      activeCardAt = Date.now();
      log('Resolved text-view active card from deck data.', { card: describeCard(activeCard) });
      scanForMenu();
    });
  }

  function addSearchContext(card, target) {
    return {
      ...card,
      appendToCurrentSearch: isSearchOverlayTarget(target),
    };
  }

  function isSearchOverlayTarget(target) {
    return target instanceof Element
      && !!target.closest(`${SEARCH_OVERLAY_SELECTOR} ${SEARCH_CONTAINER_SELECTOR}`);
  }

  function isCardContainer(el) {
    const className = typeof el.className === 'string' ? el.className : '';
    return CARD_CLASS_FRAGMENTS.some(fragment => className.includes(fragment));
  }

  function findCardIdentityInContainer(container) {
    const images = container.matches('img[alt]')
      ? [container]
      : [...container.querySelectorAll('img[alt]')];

    for (const img of images) {
      const identity = identityFromImage(img);
      if (identity) return identity;
    }

    const textIdentity = identityFromTextViewCard(container);
    if (textIdentity) return textIdentity;

    return null;
  }

  function identityFromImage(img) {
    if (!(img instanceof HTMLImageElement)) return null;
    return parseCardIdentityFromAlt(img.alt);
  }

  function identityFromDetailsOverlay(overlay) {
    for (const img of overlay.querySelectorAll('img[alt]')) {
      const identity = identityFromImage(img);
      if (identity) return identity;
    }

    const title = overlay.querySelector('[class*="cardDetailsOverlay_title"]');
    const name = cleanTextViewCardName(title?.textContent);
    return name ? findUniqueDeckIdentityByName(name) : null;
  }

  function identityFromTextViewCard(container) {
    const name = findTextViewCardNameInContainer(container);
    if (!name) return null;

    return findUniqueDeckIdentityByName(name);
  }

  function findTextViewCardNameInContainer(container) {
    const textCard = container.matches?.('[class*="textViewCard_card"]')
      ? container
      : container.querySelector?.('[class*="textViewCard_card"]');
    return textCard ? findTextViewCardName(textCard) : '';
  }

  function findTextViewCardName(textCard) {
    const namedButton = textCard.querySelector('[class*="textViewCard_button"][title]');
    const fromTitle = cleanTextViewCardName(namedButton?.getAttribute('title'));
    if (fromTitle) return fromTitle;

    const nameEl = textCard.querySelector('[class*="textViewCard_cardName"]');
    return cleanTextViewCardName(nameEl?.textContent);
  }

  function cleanTextViewCardName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ') || '';
  }

  function findUniqueDeckIdentityByName(name) {
    const identities = getDeckIdentitiesByName().get(name.toLowerCase()) || [];
    return identities.length === 1 ? identities[0] : null;
  }

  function getDeckIdentitiesByName() {
    if (deckIdentityMap) return deckIdentityMap;

    deckIdentityMap = new Map();
    mergeDeckCardMap(readEmbeddedDeckCardMap());
    mergeVisibleCardImageIdentities(deckIdentityMap);
    log('Initialized deck identity map from embedded/page data.', {
      names: deckIdentityMap.size,
      identities: countDeckIdentities(deckIdentityMap),
    });
    return deckIdentityMap;
  }

  function readEmbeddedDeckCardMap() {
    const script = document.getElementById('__NEXT_DATA__');
    if (!script?.textContent) {
      log('No __NEXT_DATA__ deck card map available.');
      return null;
    }

    try {
      const data = JSON.parse(script.textContent);
      const cardMap = data?.props?.pageProps?.redux?.deck?.cardMap
        || data?.props?.pageProps?.redux?.deck?.cards
        || null;
      log('Read embedded __NEXT_DATA__ deck card data.', {
        entries: countCardEntries(cardMap),
      });
      return cardMap;
    } catch (err) {
      warn('Could not read Archidekt deck data:', err.message);
      return null;
    }
  }

  function mergeDeckCardMap(cardMap) {
    if (!cardMap || typeof cardMap !== 'object') {
      log('mergeDeckCardMap skipped: no card data object.');
      return;
    }
    const identitiesByName = getDeckIdentitiesByName();
    let added = 0;

    for (const card of Object.values(cardMap)) {
      const identity = parseCardIdentityFromDeckCard(card);
      if (!identity) continue;

      if (addDeckIdentity(identitiesByName, identity)) {
        added += 1;
      }
    }
    log('Merged Archidekt deck card map.', {
      entries: countCardEntries(cardMap),
      added,
      names: identitiesByName.size,
      identities: countDeckIdentities(identitiesByName),
    });
  }

  function mergeVisibleCardImageIdentities(identitiesByName = getDeckIdentitiesByName()) {
    let added = 0;
    let scanned = 0;
    for (const img of document.querySelectorAll('img[alt]')) {
      const identity = identityFromImage(img);
      if (!identity) continue;
      scanned += 1;
      if (addDeckIdentity(identitiesByName, identity)) {
        added += 1;
      }
    }
    log('Merged visible Archidekt image identities.', {
      scanned,
      added,
      names: identitiesByName.size,
      identities: countDeckIdentities(identitiesByName),
    });
  }

  function addDeckIdentity(identitiesByName, identity) {
    const key = identity.name.toLowerCase();
    const existing = identitiesByName.get(key) || [];
    if (existing.some(item => cardKey(item) === cardKey(identity))) {
      identitiesByName.set(key, existing);
      return false;
    }

    existing.push(identity);
    identitiesByName.set(key, existing);
    return true;
  }

  function startDeckDataLoad() {
    const deckId = deckIdFromPath();
    if (!deckId) {
      log('Deck data load skipped: no deck id in path.', describePageState());
      return null;
    }
    if (deckDataDeckId === deckId) {
      log('Deck data load already in progress or complete for deck.', { deckId });
      return deckDataPromise;
    }

    if (deckDataAbort) deckDataAbort.abort();
    deckDataAbort = new AbortController();
    deckDataDeckId = deckId;
    log('Loading Archidekt deck data.', { deckId });

    deckDataPromise = fetch(`/api/decks/${encodeURIComponent(deckId)}/`, {
      credentials: 'same-origin',
      signal: deckDataAbort.signal,
    })
      .then((response) => {
        log('Archidekt deck data response.', { deckId, status: response.status, ok: response.ok });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        const cardMap = data?.cardMap
          || data?.deck?.cardMap
          || data?.cards
          || data?.deck?.cards;
        mergeDeckCardMap(cardMap);
        mergeVisibleCardImageIdentities();
        log('Archidekt deck data loaded.', {
          deckId,
          cardMapEntries: countCardEntries(cardMap),
        });
        schedulePrefetchVisibleCards();
        scanForMenu();
        scanForCardDetails();
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          warn('Could not load Archidekt deck data:', err.message);
        }
      });

    return deckDataPromise;
  }

  function deckIdFromPath() {
    const match = location.pathname.match(/^\/decks\/([^/]+)/);
    return match ? match[1] : '';
  }

  async function injectTagsIntoMenu(menu, card) {
    log('Starting Archidekt menu tag injection.', {
      menu: describeElement(menu),
      card: describeCard(card),
    });
    const wrapper = document.createElement('div');
    wrapper.className = INJECTED_CLASS;
    wrapper.dataset.moxtagsSurface = 'archidekt-menu';
    wrapper.dataset.moxtagsCard = cardKey(card);
    wrapper.dataset.moxtagsCardKey = cardKey(card);
    wrapper.addEventListener('mousedown', stopPropagation);
    wrapper.addEventListener('click', stopPropagation);

    const nativeButtonClass = findNativeButtonClass(menu);
    wrapper.dataset.moxtagsSpacerClass = findNativeSpacerClass(menu);
    insertWrapper(menu, wrapper);
    renderLoading(wrapper);

    try {
      const tags = await loadTags(card);
      if (!wrapper.isConnected || cardKey(activeCard) !== cardKey(card)) {
        log('Skipping menu tag render because wrapper/card became stale.', {
          wrapperConnected: wrapper.isConnected,
          requestedCard: describeCard(card),
          activeCard: describeCard(activeCard),
        });
        return;
      }
      log('Rendering Archidekt menu tag submenus.', {
        card: describeCard(card),
        artTags: tags.artTags.length,
        cardTags: tags.cardTags.length,
        cacheLoading: !!tags.cacheLoading,
      });
      renderSubmenus(wrapper, tags, nativeButtonClass, card.appendToCurrentSearch);
    } catch (err) {
      if (!wrapper.isConnected || cardKey(activeCard) !== cardKey(card)) {
        log('Skipping menu error render because wrapper/card became stale.', {
          wrapperConnected: wrapper.isConnected,
          requestedCard: describeCard(card),
          activeCard: describeCard(activeCard),
          error: err.message,
        });
        return;
      }
      renderError(wrapper, err);
    }
  }

  function scanForCardDetails() {
    for (const overlay of document.querySelectorAll(CARD_DETAILS_OVERLAY_SELECTOR)) {
      injectTagsIntoCardDetails(overlay);
    }
  }

  function injectTagsIntoCardDetails(overlay) {
    const extraInfo = overlay.querySelector(CARD_INFO_EXTRA_SELECTOR);
    if (!extraInfo) return;

    const legalitiesHeading = findLegalitiesHeading(extraInfo);
    if (!legalitiesHeading) return;

    const identity = identityFromDetailsOverlay(overlay);
    if (!identity) {
      log('Card details overlay found but exact identity was not resolved.', {
        overlay: describeElement(overlay),
      });
      return;
    }

    const key = cardKey(identity);
    const existing = extraInfo.querySelector(`:scope > .${DETAILS_TAGS_CLASS}`);
    if (existing?.dataset.moxtagsCard === key) return;
    existing?.remove();
    log('Injecting tags into Archidekt card details.', {
      card: describeCard(identity),
      overlay: describeElement(overlay),
    });

    const wrapper = document.createElement('div');
    wrapper.className = DETAILS_TAGS_CLASS;
    wrapper.dataset.moxtagsSurface = 'archidekt-details';
    wrapper.dataset.moxtagsCard = key;
    wrapper.dataset.moxtagsCardKey = key;
    wrapper.addEventListener('mousedown', stopPropagation);
    wrapper.addEventListener('click', stopPropagation);
    extraInfo.insertBefore(wrapper, legalitiesHeading);
    renderDetailsLoading(wrapper);

    loadTags(identity)
      .then((tags) => {
        if (!wrapper.isConnected || wrapper.dataset.moxtagsCard !== key) return;
        renderDetailsTags(wrapper, tags);
      })
      .catch((err) => {
        if (!wrapper.isConnected || wrapper.dataset.moxtagsCard !== key) return;
        renderDetailsError(wrapper, err);
      });
  }

  function findLegalitiesHeading(extraInfo) {
    return [...extraInfo.children]
      .find(child => /^legalities:?$/i.test(String(child.textContent || '').trim()))
      || null;
  }

  function renderDetailsLoading(wrapper) {
    wrapper.innerHTML = '';
    const loading = document.createElement('p');
    loading.className = 'moxtags-archidekt-details-message moxtags-loading';
    loading.textContent = 'Loading Scryfall tags...';
    wrapper.appendChild(loading);
  }

  function renderDetailsError(wrapper, err) {
    wrapper.innerHTML = '';
    const message = document.createElement('p');
    message.className = err.cacheLoading
      ? 'moxtags-archidekt-details-message moxtags-loading moxtags-cache-loading'
      : 'moxtags-archidekt-details-message moxtags-error';
    message.textContent = err.cacheLoading
      ? 'Downloading tag data...'
      : 'Failed to load Scryfall tags';
    wrapper.appendChild(message);
    warn('Details tag load failed:', err.message);
  }

  function renderDetailsTags(wrapper, tags) {
    wrapper.innerHTML = '';

    if (tags.cacheLoading && tags.artTags.length === 0 && tags.cardTags.length === 0) {
      const loading = document.createElement('p');
      loading.className = 'moxtags-archidekt-details-message moxtags-loading moxtags-cache-loading';
      loading.textContent = 'Downloading tag data...';
      wrapper.appendChild(loading);
      return;
    }

    const selection = buildDetailsSelectionController(wrapper);
    wrapper.appendChild(buildDetailsTagSection('Card Tags', tags.cardTags, 'otag', selection));
    wrapper.appendChild(buildDetailsTagSection('Art Tags', tags.artTags, 'art', selection));
    wrapper.appendChild(selection.searchButton);
  }

  function buildDetailsSelectionController(wrapper) {
    const selected = new Map();
    const searchButton = document.createElement('button');
    searchButton.type = 'button';
    searchButton.className = 'moxtags-archidekt-details-search-btn';
    searchButton.hidden = true;
    searchButton.textContent = 'Search by tags';

    const updateSearchButton = () => {
      searchButton.hidden = selected.size === 0;
      searchButton.textContent = selected.size > 0
        ? `Search by tags (${selected.size})`
        : 'Search by tags';
    };

    searchButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (selected.size === 0) return;
      closeCardDetailsOverlay(wrapper.closest(CARD_DETAILS_OVERLAY_SELECTOR));
      searchArchidektForTags([...selected.values()]);
    });

    return {
      searchButton,
      setTag(prefix, tag, checked) {
        const key = `${prefix}:${tag.slug}`;
        if (checked) {
          selected.set(key, { prefix, slug: tag.slug });
        } else {
          selected.delete(key);
        }
        updateSearchButton();
      },
    };
  }

  function buildDetailsTagSection(title, tags, prefix, selection) {
    const section = document.createElement('section');
    section.className = 'moxtags-archidekt-details-section';
    const sectionKey = tagSectionKey(prefix);
    section.dataset.moxtagsSection = sectionKey;

    const heading = document.createElement('h4');
    heading.className = 'moxtags-archidekt-details-heading';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'moxtags-archidekt-details-toggle';
    button.dataset.moxtagsTrigger = sectionKey;

    const chevron = document.createElement('span');
    chevron.className = 'moxtags-archidekt-details-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    button.appendChild(chevron);

    const label = document.createElement('span');
    label.className = 'moxtags-archidekt-details-toggle-label';
    label.textContent = title;
    button.appendChild(label);
    heading.appendChild(button);

    const body = document.createElement('div');
    body.className = 'moxtags-archidekt-details-section-body';

    if (tags.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'moxtags-archidekt-details-message moxtags-empty';
      empty.textContent = 'No tags found';
      body.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'moxtags-archidekt-details-tag-list';
      for (const tag of tags) {
        list.appendChild(buildDetailsTagRow(tag, prefix, selection));
      }
      body.appendChild(list);
    }

    const toggleExpanded = bindPersistentCollapsibleSection({
      site: 'archidekt',
      section: sectionKey,
      toggle: button,
      body,
      onError: warn,
    });

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleExpanded();
    });

    section.append(heading, body);
    return section;
  }

  function tagSectionKey(prefix) {
    return prefix === 'art' ? 'art-tags' : 'card-tags';
  }

  function buildDetailsTagRow(tag, prefix, selection) {
    const row = document.createElement('span');
    row.className = 'moxtags-archidekt-details-tag-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'moxtags-archidekt-details-tag-cb';
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', () => selection.setTag(prefix, tag, checkbox.checked));
    row.appendChild(checkbox);

    row.appendChild(buildDetailsTagLink(tag, prefix));
    return row;
  }

  function buildDetailsTagLink(tag, prefix) {
    const link = document.createElement('a');
    link.className = 'moxtags-archidekt-details-tag-link';
    link.dataset.moxtagsTagPrefix = prefix;
    link.href = '#';
    link.textContent = tag.name;
    link.title = `Search Archidekt for ${prefix}:${tag.slug}`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeCardDetailsOverlay(link.closest(CARD_DETAILS_OVERLAY_SELECTOR));
      searchArchidektForTags([{ prefix, slug: tag.slug }]);
    });
    return link;
  }

  function insertWrapper(menu, wrapper) {
    const anchor = findMenuInsertionAnchor(menu);
    if (anchor) {
      menu.insertBefore(wrapper, anchor);
      return;
    }
    menu.appendChild(wrapper);
  }

  function findMenuInsertionAnchor(menu) {
    const footer = findFooter(menu);
    if (footer) {
      const previous = footer.previousElementSibling;
      return isMenuGap(previous) || isMenuSpacer(previous) ? previous : footer;
    }

    const lastChild = menu.lastElementChild;
    return isMenuGap(lastChild) || isMenuSpacer(lastChild) ? lastChild : null;
  }

  function findFooter(menu) {
    for (const child of menu.children) {
      if (/Ctrl\s*\+\s*Right Click/i.test(child.textContent || '')) return child;
    }
    return null;
  }

  function isMenuGap(el) {
    return el instanceof Element && String(el.className).includes('menu_gap');
  }

  function isMenuSpacer(el) {
    return el instanceof Element && String(el.className).includes('menu_spacer');
  }

  function findNativeSpacerClass(menu) {
    const spacer = [...menu.children].find(isMenuSpacer);
    return spacer?.className || 'menu_spacer__Ouz3S';
  }

  function findNativeButtonClass(menu) {
    const button = [...menu.querySelectorAll('button')]
      .find(el => !el.closest(`.${INJECTED_CLASS}`));
    return button?.className || '';
  }

  function renderLoading(wrapper) {
    wrapper.innerHTML = '';
    wrapper.appendChild(buildDivider(wrapper));
    const loading = document.createElement('div');
    loading.className = 'moxtags-archidekt-message moxtags-loading';
    loading.textContent = 'Loading Scryfall tags...';
    wrapper.appendChild(loading);
  }

  function renderError(wrapper, err) {
    wrapper.innerHTML = '';
    wrapper.appendChild(buildDivider(wrapper));
    const message = document.createElement('div');
    message.className = err.cacheLoading
      ? 'moxtags-archidekt-message moxtags-loading moxtags-cache-loading'
      : 'moxtags-archidekt-message moxtags-error';
    message.textContent = err.cacheLoading
      ? 'Downloading tag data...'
      : 'Failed to load Scryfall tags';
    wrapper.appendChild(message);
    warn('Tag load failed:', err.message);
  }

  function renderSubmenus(wrapper, tags, nativeButtonClass, appendToCurrentSearch) {
    wrapper.innerHTML = '';
    wrapper.appendChild(buildDivider(wrapper));

    if (tags.cacheLoading && tags.artTags.length === 0 && tags.cardTags.length === 0) {
      const loading = document.createElement('div');
      loading.className = 'moxtags-archidekt-message moxtags-loading moxtags-cache-loading';
      loading.textContent = 'Downloading tag data...';
      wrapper.appendChild(loading);
      return;
    }

    wrapper.appendChild(buildSubmenuTrigger(
      'Art Tags',
      tags.artTags,
      'art',
      nativeButtonClass,
      appendToCurrentSearch
    ));
    wrapper.appendChild(buildSubmenuTrigger(
      'Card Tags',
      tags.cardTags,
      'otag',
      nativeButtonClass,
      appendToCurrentSearch
    ));
  }

  function buildDivider(wrapper) {
    const divider = document.createElement('div');
    divider.className = `${wrapper.dataset.moxtagsSpacerClass} moxtags-archidekt-divider`;
    divider.setAttribute('aria-hidden', 'true');
    return divider;
  }

  function buildSubmenuTrigger(title, tags, prefix, nativeButtonClass, appendToCurrentSearch) {
    const wrapper = document.createElement('div');
    wrapper.className = 'moxtags-archidekt-trigger-wrap';
    wrapper.dataset.moxtagsTrigger = tagSectionKey(prefix);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = [nativeButtonClass, 'moxtags-archidekt-trigger'].filter(Boolean).join(' ');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.addEventListener('click', stopPropagation);

    const label = document.createElement('span');
    label.className = 'moxtags-archidekt-trigger-label';
    label.textContent = title;
    trigger.appendChild(label);

    const arrow = document.createElement('i');
    arrow.className = 'small chevron right icon moxtags-archidekt-trigger-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    trigger.appendChild(arrow);

    const submenu = document.createElement('div');
    submenu.className = 'moxtags-archidekt-submenu';
    submenu.setAttribute('role', 'menu');

    renderTagList(submenu, tags, prefix, appendToCurrentSearch);
    wrapper.append(trigger, submenu);
    wrapper.addEventListener('mouseenter', () => positionSubmenu(wrapper, submenu));

    return wrapper;
  }

  function renderTagList(submenu, tags, prefix, appendToCurrentSearch) {
    if (tags.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'moxtags-archidekt-message moxtags-empty';
      empty.textContent = 'No tags found';
      submenu.appendChild(empty);
      return;
    }

    const searchButton = document.createElement('button');
    searchButton.type = 'button';
    searchButton.className = 'moxtags-archidekt-search-btn';
    searchButton.textContent = 'Search Archidekt...';
    searchButton.style.display = 'none';
    submenu.appendChild(searchButton);

    const checked = new Set();
    const updateSearchButton = () => {
      if (checked.size === 0) {
        searchButton.style.display = 'none';
        searchButton.textContent = 'Search Archidekt...';
        return;
      }
      searchButton.style.display = '';
      searchButton.textContent = `(${checked.size}) Search Archidekt...`;
    };

    searchButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const selectedTags = [...checked].map(slug => ({ prefix, slug }));
      searchArchidektForTags(selectedTags, { appendToCurrentSearch });
    });

    for (const tag of tags) {
      const row = document.createElement('div');
      row.className = 'moxtags-archidekt-tag-row';
      row.setAttribute('role', 'menuitem');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'moxtags-archidekt-tag-cb';
      checkbox.addEventListener('click', (event) => {
        event.stopPropagation();
        if (checkbox.checked) {
          checked.add(tag.slug);
        } else {
          checked.delete(tag.slug);
        }
        updateSearchButton();
      });
      row.appendChild(checkbox);

      const link = document.createElement('a');
      link.className = 'moxtags-archidekt-tag-link';
      link.dataset.moxtagsTagPrefix = prefix;
      link.href = '#';
      link.textContent = tag.name;
      link.title = `Search Archidekt for ${prefix}:${tag.slug}`;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        searchArchidektForTags([{ prefix, slug: tag.slug }], { appendToCurrentSearch });
      });
      row.appendChild(link);

      submenu.appendChild(row);
    }
  }

  async function searchArchidektForTags(tags, { appendToCurrentSearch = false } = {}) {
    const query = buildArchidektCombinedTagQuery(tags);
    if (!query) return;

    try {
      await openArchidektSyntaxSearch(query, { appendToCurrentSearch });
    } catch (err) {
      warn('Archidekt search failed:', err.message);
    }
  }

  async function openArchidektSyntaxSearch(query, { appendToCurrentSearch = false } = {}) {
    const overlay = await ensureSearchOverlay();
    if (!overlay) throw new Error('Could not open card search overlay');

    const syntaxTab = findButtonByText(overlay, 'Syntax search');
    if (!syntaxTab) throw new Error('Could not find Syntax search tab');
    if (!isSelectedTab(syntaxTab)) {
      syntaxTab.click();
    }

    const input = await waitFor(() => findSyntaxSearchInput(), 3000);
    if (!input) throw new Error('Could not find Syntax search input');

    const nextQuery = appendToCurrentSearch
      ? appendArchidektTagQuery(input.value, query)
      : query;
    setNativeInputValue(input, nextQuery);
    input.focus();

    const form = input.closest('form');
    const submitButton = form?.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.click();
      return;
    }
    if (form) {
      form.requestSubmit();
      return;
    }

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true,
    }));
  }

  async function ensureSearchOverlay() {
    const existing = findSearchOverlay();
    if (existing) return existing;

    closeContextMenu();

    const cardSearchButton = findCardSearchButton();
    if (!cardSearchButton) return null;
    cardSearchButton.click();

    return waitFor(findSearchOverlay, 3000);
  }

  function findSearchOverlay() {
    for (const overlay of document.querySelectorAll(SEARCH_OVERLAY_SELECTOR)) {
      if (
        overlay.querySelector(SEARCH_CONTAINER_SELECTOR)
        && findButtonByText(overlay, 'Syntax search')
      ) {
        return overlay;
      }
    }
    return null;
  }

  function findCardSearchButton() {
    const buttons = [...document.querySelectorAll('button')]
      .filter(button => (
        normalizeText(button.textContent) === 'card search'
        && isVisible(button)
      ));

    return buttons.find(button => !button.closest('#navigation-drawer, [class*="navigationDrawer"]'))
      || buttons[0]
      || null;
  }

  function findSyntaxSearchInput() {
    const overlay = findSearchOverlay();
    const root = overlay || document;
    const form = root.querySelector(SYNTAX_FORM_SELECTOR);
    return form?.querySelector(SYNTAX_INPUT_SELECTOR)
      || root.querySelector(SYNTAX_INPUT_SELECTOR)
      || null;
  }

  function findButtonByText(root, text) {
    const expected = normalizeText(text);
    return [...root.querySelectorAll('button')]
      .find(button => normalizeText(button.textContent) === expected) || null;
  }

  function isSelectedTab(button) {
    return String(button.className).includes('tabButtons_selected');
  }

  function setNativeInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function closeContextMenu() {
    const overlay = document.getElementById('contextMenuOverlay');
    if (!overlay) return;

    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      overlay.dispatchEvent(new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    }
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    }));
  }

  function closeCardDetailsOverlay(overlay) {
    if (!overlay) return;

    const event = {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    };
    document.dispatchEvent(new KeyboardEvent('keydown', event));
    window.dispatchEvent(new KeyboardEvent('keydown', event));
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function normalizeText(text) {
    return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function waitFor(getValue, timeoutMs) {
    const started = Date.now();
    return new Promise((resolve) => {
      const tick = () => {
        const value = getValue();
        if (value) {
          resolve(value);
          return;
        }
        if (Date.now() - started >= timeoutMs) {
          resolve(null);
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  function positionSubmenu(triggerWrapper, submenu) {
    submenu.style.display = 'block';
    submenu.style.visibility = 'hidden';
    submenu.style.left = '0';
    submenu.style.right = '';
    submenu.style.top = '0';

    const rect = triggerWrapper.getBoundingClientRect();
    const subWidth = submenu.offsetWidth;
    const subHeight = submenu.offsetHeight;
    const spaceRight = window.innerWidth - rect.right - 10;
    const spaceLeft = rect.left - 10;

    if (subWidth > spaceRight && spaceLeft > spaceRight) {
      submenu.style.left = 'auto';
      submenu.style.right = '100%';
    } else {
      submenu.style.left = '100%';
      submenu.style.right = 'auto';
    }

    const overflow = rect.top + subHeight - window.innerHeight + 10;
    if (overflow > 0) {
      submenu.style.top = `${-overflow}px`;
    }

    submenu.style.display = '';
    submenu.style.visibility = '';
  }

  function loadTags(card) {
    const key = cardKey(card);
    if (tagCache.has(key)) {
      log('Using cached tags for Archidekt card.', { card: describeCard(card) });
      return Promise.resolve(tagCache.get(key));
    }

    log('Requesting tags from background.', { card: describeCard(card) });
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'fetchTags', set: card.set, number: card.cn },
        (resp) => {
          if (chrome.runtime.lastError) {
            warn('Background tag request failed:', chrome.runtime.lastError.message, describeCard(card));
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp?.ok) {
            const tags = normalizeTags(resp);
            tagCache.set(key, tags);
            log('Background tag request succeeded.', {
              card: describeCard(card),
              artTags: tags.artTags.length,
              cardTags: tags.cardTags.length,
              cacheLoading: !!tags.cacheLoading,
            });
            resolve(tags);
            return;
          }

          const err = new Error(resp?.error || 'Tag fetch failed');
          err.cacheLoading = resp?.cacheLoading;
          warn('Background tag request returned error:', err.message, {
            card: describeCard(card),
            cacheLoading: !!err.cacheLoading,
          });
          reject(err);
        }
      );
    });
  }

  function schedulePrefetchVisibleCards() {
    if (prefetchTimer) clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(prefetchVisibleCards, 500);
    log('Scheduled Archidekt visible-card tag prefetch.');
  }

  function prefetchVisibleCards() {
    prefetchTimer = null;
    const cardsByKey = new Map();
    for (const img of document.querySelectorAll('img[alt]')) {
      const identity = identityFromImage(img);
      if (!identity) continue;
      addDeckIdentity(getDeckIdentitiesByName(), identity);
      const key = cardKey(identity);
      if (tagCache.has(key)) continue;
      cardsByKey.set(key, { set: identity.set, cn: identity.cn });
    }
    for (const identities of getDeckIdentitiesByName().values()) {
      for (const identity of identities) {
        const key = cardKey(identity);
        if (tagCache.has(key)) continue;
        cardsByKey.set(key, { set: identity.set, cn: identity.cn });
      }
    }

    const cards = [...cardsByKey.values()];
    if (cards.length === 0) {
      log('Prefetch skipped: no uncached visible/deck cards found.');
      return;
    }

    log('Prefetching Archidekt tags.', { cards: cards.length });
    chrome.runtime.sendMessage({ type: 'prefetchDeck', cards }, (resp) => {
      if (chrome.runtime.lastError) {
        warn('Prefetch failed:', chrome.runtime.lastError.message);
        return;
      }
      if (!resp?.ok) {
        warn('Prefetch failed:', resp?.error);
        return;
      }

      for (const [key, tags] of Object.entries(resp.tags || {})) {
        tagCache.set(key, normalizeTags(tags));
      }
      log('Prefetched tags for', Object.keys(resp.tags || {}).length, 'cards');
    });
  }

  function normalizeTags(tags) {
    return {
      artTags: tags?.artTags || [],
      cardTags: tags?.cardTags || [],
      cacheLoading: tags?.cacheLoading,
    };
  }

  function cardKey(card) {
    if (!card) return '';
    return `${card.set}/${card.cn}`;
  }

  function describePageState() {
    return {
      href: location.href,
      pathname: location.pathname,
      isDeckPage: isDeckPage(),
      deckInitialized,
    };
  }

  function describeCard(card) {
    if (!card) return null;
    if (card.pendingName) {
      return {
        pendingName: card.pendingName,
        appendToCurrentSearch: !!card.appendToCurrentSearch,
      };
    }
    return {
      name: card.name,
      set: card.set,
      cn: card.cn,
      key: cardKey(card),
      appendToCurrentSearch: !!card.appendToCurrentSearch,
    };
  }

  function describeElement(value) {
    if (!(value instanceof Element)) return String(value);

    const parts = [value.tagName.toLowerCase()];
    if (value.id) parts.push(`#${value.id}`);

    const className = typeof value.className === 'string'
      ? value.className.trim().replace(/\s+/g, '.')
      : '';
    if (className) parts.push(`.${className}`);

    const text = normalizeText(value.textContent).slice(0, 80);
    const alt = value.getAttribute?.('alt');
    const title = value.getAttribute?.('title');
    return {
      selector: parts.join(''),
      text,
      alt,
      title,
      childCount: value.children?.length || 0,
    };
  }

  function countDeckIdentities(identitiesByName) {
    let count = 0;
    for (const identities of identitiesByName.values()) {
      count += identities.length;
    }
    return count;
  }

  function countCardEntries(cardMap) {
    return cardMap && typeof cardMap === 'object' ? Object.keys(cardMap).length : 0;
  }

  function logMenuScan(message, details = {}) {
    const debugKey = JSON.stringify({
      message,
      activeCard: details.activeCard || null,
      menu: details.menu?.selector || null,
      overlayPresent: details.overlayPresent,
      overlayChildren: details.overlayChildren?.map(child => child.selector) || null,
    });
    if (debugKey === lastMenuScanDebug) return;
    lastMenuScanDebug = debugKey;
    log(message, details);
  }

  function stopPropagation(event) {
    event.stopPropagation();
  }

  function log(...args) {
    console.log(TAG, ...args);
  }

  function warn(...args) {
    console.warn(TAG, ...args);
  }
})();
