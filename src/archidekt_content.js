// MoxTags - Archidekt content script.
// Injects Scryfall Tagger art/card tag submenus into Archidekt card menus.

import {
  appendArchidektTagQuery,
  buildArchidektCombinedTagQuery,
  parseCardIdentityFromAlt,
  parseCardIdentityFromDeckCard,
} from './shared/archidekt-page.js';
import { bindPersistentCollapsibleSection } from './shared/collapsible-state.js';

(function () {
  'use strict';

  const TAG = '[MoxTags Archidekt]';
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
  const CARD_CLASS_FRAGMENTS = [
    'basicCard_container',
    'deckCardWrapper_container',
    'contextMenu_wrapper',
    'textViewCard_card',
  ];

  let activeCard = null;
  let activeCardAt = 0;
  let observer = null;
  let menuObserver = null;
  let observedMenu = null;
  let lastUrl = location.href;
  let navInterval = null;
  let prefetchTimer = null;
  let deckIdentityMap = null;
  const tagCache = new Map();

  init();

  function init() {
    if (!isDeckPage()) {
      watchNavigation();
      return;
    }

    log('Initializing for Archidekt deck page:', location.href);
    document.addEventListener('contextmenu', onPointerMenuIntent, true);
    document.addEventListener('mousedown', onPointerMenuIntent, true);

    observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'],
    });

    schedulePrefetchVisibleCards();
    scanForMenu();
    scanForCardDetails();
    watchNavigation();
  }

  function cleanup({ keepNavigation = false } = {}) {
    if (observer) observer.disconnect();
    observer = null;
    if (menuObserver) menuObserver.disconnect();
    menuObserver = null;
    observedMenu = null;
    document.removeEventListener('contextmenu', onPointerMenuIntent, true);
    document.removeEventListener('mousedown', onPointerMenuIntent, true);
    document.querySelectorAll(`.${INJECTED_CLASS}, .${DETAILS_TAGS_CLASS}`).forEach(el => el.remove());
    activeCard = null;
    activeCardAt = 0;
    deckIdentityMap = null;
    tagCache.clear();
    if (prefetchTimer) clearTimeout(prefetchTimer);
    prefetchTimer = null;

    if (!keepNavigation && navInterval) {
      clearInterval(navInterval);
      navInterval = null;
    }
  }

  function isDeckPage() {
    return /^\/decks\/[^/]+/.test(location.pathname);
  }

  function watchNavigation() {
    if (navInterval) return;
    navInterval = setInterval(() => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      cleanup({ keepNavigation: true });
      init();
    }, 1000);
  }

  function onPointerMenuIntent(event) {
    const isContextMenu = event.type === 'contextmenu';
    const isPrimaryMouseDown = event.type === 'mousedown' && event.button === 0;
    if (!isContextMenu && !isPrimaryMouseDown) return;
    if (event.target instanceof Element && event.target.closest(`.${INJECTED_CLASS}`)) return;

    const card = findCardIdentityFromTarget(event.target);
    if (card) {
      activeCard = card;
      activeCardAt = Date.now();
      return;
    }

    if (isContextMenu || isPrimaryMouseDown) {
      activeCard = null;
      activeCardAt = 0;
    }
  }

  function onMutations() {
    schedulePrefetchVisibleCards();
    scanForMenu();
    scanForCardDetails();
  }

  function scanForMenu() {
    const menu = findCardMenu();
    if (!menu) {
      if (activeCard && Date.now() - activeCardAt < 2000) return;
      activeCard = null;
      activeCardAt = 0;
      if (menuObserver) menuObserver.disconnect();
      menuObserver = null;
      observedMenu = null;
      return;
    }

    observeMenu(menu);
    if (!activeCard) return;
    if (menu.querySelector(`.${INJECTED_CLASS}`)) return;
    injectTagsIntoMenu(menu, activeCard);
  }

  function findCardMenu() {
    const overlay = document.getElementById('contextMenuOverlay');
    if (!overlay) return null;
    return overlay.querySelector(MENU_SELECTOR);
  }

  function observeMenu(menu) {
    if (observedMenu === menu) return;
    if (menuObserver) menuObserver.disconnect();
    observedMenu = menu;
    menuObserver = new MutationObserver(() => {
      if (!menu.querySelector(`.${INJECTED_CLASS}`)) scanForMenu();
    });
    menuObserver.observe(menu, { childList: true, subtree: true });
  }

  function findCardIdentityFromTarget(target) {
    const start = target instanceof Element ? target : target?.parentElement;
    if (!start) return null;

    const directImage = start.closest?.('img[alt]');
    const directIdentity = identityFromImage(directImage);
    if (directIdentity) return addSearchContext(directIdentity, start);

    let el = start;
    while (el && el !== document.body && el instanceof Element) {
      if (isCardContainer(el)) {
        const identity = findCardIdentityInContainer(el);
        if (identity) return addSearchContext(identity, start);
      }
      el = el.parentElement;
    }

    return null;
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
    const textCard = container.matches?.('[class*="textViewCard_card"]')
      ? container
      : container.querySelector?.('[class*="textViewCard_card"]');
    if (!textCard) return null;

    const name = findTextViewCardName(textCard);
    if (!name) return null;

    return findUniqueDeckIdentityByName(name);
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
    const script = document.getElementById('__NEXT_DATA__');
    if (!script?.textContent) return deckIdentityMap;

    try {
      const data = JSON.parse(script.textContent);
      const cardMap = data?.props?.pageProps?.redux?.deck?.cardMap;
      if (!cardMap || typeof cardMap !== 'object') return deckIdentityMap;

      for (const card of Object.values(cardMap)) {
        const identity = parseCardIdentityFromDeckCard(card);
        if (!identity) continue;

        const key = identity.name.toLowerCase();
        const existing = deckIdentityMap.get(key) || [];
        if (!existing.some(item => cardKey(item) === cardKey(identity))) {
          existing.push(identity);
        }
        deckIdentityMap.set(key, existing);
      }
    } catch (err) {
      warn('Could not read Archidekt deck data:', err.message);
    }

    return deckIdentityMap;
  }

  async function injectTagsIntoMenu(menu, card) {
    const wrapper = document.createElement('div');
    wrapper.className = INJECTED_CLASS;
    wrapper.dataset.moxtagsCard = cardKey(card);
    wrapper.addEventListener('mousedown', stopPropagation);
    wrapper.addEventListener('click', stopPropagation);

    const nativeButtonClass = findNativeButtonClass(menu);
    wrapper.dataset.moxtagsSpacerClass = findNativeSpacerClass(menu);
    insertWrapper(menu, wrapper);
    renderLoading(wrapper);

    try {
      const tags = await loadTags(card);
      if (!wrapper.isConnected || cardKey(activeCard) !== cardKey(card)) return;
      renderSubmenus(wrapper, tags, nativeButtonClass, card.appendToCurrentSearch);
    } catch (err) {
      if (!wrapper.isConnected || cardKey(activeCard) !== cardKey(card)) return;
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
    if (!identity) return;

    const key = cardKey(identity);
    const existing = extraInfo.querySelector(`:scope > .${DETAILS_TAGS_CLASS}`);
    if (existing?.dataset.moxtagsCard === key) return;
    existing?.remove();

    const wrapper = document.createElement('div');
    wrapper.className = DETAILS_TAGS_CLASS;
    wrapper.dataset.moxtagsCard = key;
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

    const heading = document.createElement('h4');
    heading.className = 'moxtags-archidekt-details-heading';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'moxtags-archidekt-details-toggle';

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
      return Promise.resolve(tagCache.get(key));
    }

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'fetchTags', set: card.set, number: card.cn },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp?.ok) {
            const tags = normalizeTags(resp);
            tagCache.set(key, tags);
            resolve(tags);
            return;
          }

          const err = new Error(resp?.error || 'Tag fetch failed');
          err.cacheLoading = resp?.cacheLoading;
          reject(err);
        }
      );
    });
  }

  function schedulePrefetchVisibleCards() {
    if (prefetchTimer) clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(prefetchVisibleCards, 500);
  }

  function prefetchVisibleCards() {
    prefetchTimer = null;
    const cardsByKey = new Map();
    for (const img of document.querySelectorAll('img[alt]')) {
      const identity = identityFromImage(img);
      if (!identity) continue;
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
    if (cards.length === 0) return;

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
