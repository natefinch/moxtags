// MoxTags - Scryfall page content script.
// Injects Scryfall Tagger art/card tags under card artist sections.

import {
  appendTagToSearchQuery,
  parseCardIdentityFromHref,
  parseCardIdentityFromPath,
  buildTagSearchUrl,
} from './shared/scryfall-page.js';
import { bindPersistentCollapsibleSection } from './shared/collapsible-state.js';

(function () {
  'use strict';

  const TAG = '[MoxTags Scryfall]';
  const CONTAINER_CLASS = 'moxtags-scryfall-tags';
  const SEARCH_FIELD_ID = 'header-search-field';

  init();

  function init() {
    const targets = findInsertionTargets();
    if (targets.length === 0) {
      log('No Scryfall card text blocks found, skipping:', location.pathname);
      return;
    }

    const attachedTargets = targets.map(attachContainer);
    if (isSearchResultsPage()) {
      loadTagsBatch(attachedTargets.map(target => target.identity))
        .then(tagsByKey => renderBatchTags(attachedTargets, tagsByKey))
        .catch(err => renderBatchError(attachedTargets, err));
      return;
    }

    for (const target of attachedTargets) {
      loadTags(target.identity.set, target.identity.cn)
        .then(tags => renderTags(target.container, tags))
        .catch(err => renderError(target.container, err));
    }
  }

  function attachContainer({ artist, identity }) {
    const container = document.createElement('section');
    container.className = `card-text-box ${CONTAINER_CLASS} moxtags-injected`;
    container.setAttribute('aria-label', 'Scryfall Tagger tags');
    renderLoading(container);
    artist.after(container);
    return { artist, identity, container };
  }

  function findInsertionTargets() {
    const profiles = [...document.querySelectorAll('.card-profile')];
    if (profiles.length > 0) {
      return profiles.map(findProfileInsertionTarget).filter(Boolean);
    }

    const identity = parseCardIdentityFromPath(location.pathname);
    const artist = findLastArtist(document);
    if (!identity || !artist || isAlreadyInjected(artist)) return [];
    return [{ artist, identity }];
  }

  function findProfileInsertionTarget(profile) {
    const artist = findLastArtist(profile);
    if (!artist || isAlreadyInjected(artist)) return null;

    const identity = findProfileCardIdentity(profile);
    if (!identity) {
      warn('Could not resolve Scryfall card identity for profile');
      return null;
    }

    return { artist, identity };
  }

  function findLastArtist(root) {
    const artists = root.querySelectorAll('p.card-text-artist');
    return artists.length > 0 ? artists[artists.length - 1] : null;
  }

  function isAlreadyInjected(artist) {
    return artist.nextElementSibling?.classList.contains(CONTAINER_CLASS);
  }

  function findProfileCardIdentity(profile) {
    const currentLanguage = profile.querySelector('a.print-langs-item.current[href]');
    const identity = parseCardIdentityFromHref(currentLanguage?.getAttribute('href'), location.origin);
    if (identity) return identity;

    for (const link of profile.querySelectorAll('a[href*="/card/"]')) {
      const linkIdentity = parseCardIdentityFromHref(link.getAttribute('href'), location.origin);
      if (linkIdentity) return linkIdentity;
    }

    return parseCardIdentityFromPath(location.pathname);
  }

  function isSearchResultsPage() {
    return location.pathname === '/search';
  }

  function loadTags(set, cn) {
    log('Loading tags for', set, cn);
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'fetchTags', set, number: cn },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp?.ok) {
            resolve({
              artTags: resp.artTags || [],
              cardTags: resp.cardTags || [],
              cacheLoading: resp.cacheLoading,
            });
            return;
          }

          const err = new Error(resp?.error || 'Tag fetch failed');
          err.cacheLoading = resp?.cacheLoading;
          reject(err);
        }
      );
    });
  }

  function loadTagsBatch(identities) {
    const cards = dedupeCards(identities);
    log('Loading tags in batch for', cards.length, 'cards');
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'prefetchDeck', cards },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (resp?.ok) {
            resolve(resp.tags || {});
            return;
          }

          reject(new Error(resp?.error || 'Tag batch fetch failed'));
        }
      );
    });
  }

  function dedupeCards(identities) {
    const cardsByKey = new Map();
    for (const identity of identities) {
      cardsByKey.set(cardKey(identity), { set: identity.set, cn: identity.cn });
    }
    return [...cardsByKey.values()];
  }

  function renderBatchTags(targets, tagsByKey) {
    for (const target of targets) {
      const key = cardKey(target.identity);
      if (Object.prototype.hasOwnProperty.call(tagsByKey, key)) {
        renderTags(target.container, normalizeTags(tagsByKey[key]));
        continue;
      }

      loadTags(target.identity.set, target.identity.cn)
        .then(tags => renderTags(target.container, tags))
        .catch(err => renderError(target.container, err));
    }
  }

  function renderBatchError(targets, err) {
    for (const target of targets) {
      renderError(target.container, err);
    }
  }

  function normalizeTags(tags) {
    return {
      artTags: tags?.artTags || [],
      cardTags: tags?.cardTags || [],
      cacheLoading: tags?.cacheLoading,
    };
  }

  function cardKey(identity) {
    return `${identity.set}/${identity.cn}`;
  }

  function renderLoading(container) {
    container.innerHTML = '';
    const loading = document.createElement('p');
    loading.className = 'moxtags-loading moxtags-scryfall-message';
    loading.textContent = 'Loading Scryfall tags...';
    container.appendChild(loading);
  }

  function renderError(container, err) {
    container.innerHTML = '';
    const error = document.createElement('p');
    error.className = err.cacheLoading
      ? 'moxtags-loading moxtags-cache-loading moxtags-scryfall-message'
      : 'moxtags-error moxtags-scryfall-message';
    error.textContent = err.cacheLoading
      ? 'Downloading tag data...'
      : 'Failed to load Scryfall tags';
    container.appendChild(error);
    warn('Tag load failed:', err.message);
  }

  function renderTags(container, tags) {
    container.innerHTML = '';

    container.appendChild(buildTagSection('Card Tags', 'otag', tags.cardTags));
    container.appendChild(buildTagSection('Art Tags', 'art', tags.artTags));

    if (tags.cacheLoading && tags.cardTags.length === 0 && tags.artTags.length === 0) {
      const loading = document.createElement('p');
      loading.className = 'moxtags-loading moxtags-cache-loading moxtags-scryfall-message';
      loading.textContent = 'Downloading tag data...';
      container.appendChild(loading);
    }
  }

  function buildTagSection(title, prefix, tags) {
    const section = document.createElement('div');
    section.className = 'moxtags-scryfall-section';
    const sectionKey = tagSectionKey(prefix);

    const heading = document.createElement('h3');
    heading.className = 'moxtags-scryfall-heading';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'moxtags-scryfall-toggle';

    const label = document.createElement('span');
    label.className = 'moxtags-scryfall-toggle-label';
    label.textContent = title;
    toggle.appendChild(label);

    const chevron = document.createElement('span');
    chevron.className = 'moxtags-scryfall-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    toggle.appendChild(chevron);

    heading.appendChild(toggle);
    section.appendChild(heading);

    const body = document.createElement('div');
    body.className = 'moxtags-scryfall-section-body';
    section.appendChild(body);

    const toggleExpanded = bindPersistentCollapsibleSection({
      site: 'scryfall',
      section: sectionKey,
      toggle,
      body,
      onError: warn,
    });

    toggle.addEventListener('click', () => {
      toggleExpanded();
    });

    if (tags.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'moxtags-empty moxtags-scryfall-message';
      empty.textContent = 'No tags found';
      body.appendChild(empty);
      return section;
    }

    const list = document.createElement('div');
    list.className = 'moxtags-scryfall-tag-list';
    body.appendChild(list);

    for (const tag of tags) {
      list.appendChild(buildTagRow(prefix, tag));
    }

    return section;
  }

  function tagSectionKey(prefix) {
    return prefix === 'art' ? 'art-tags' : 'card-tags';
  }

  function buildTagRow(prefix, tag) {
    const row = document.createElement('div');
    row.className = 'moxtags-tag-row moxtags-scryfall-tag-row';

    const link = document.createElement('a');
    link.className = 'moxtags-tag-item moxtags-scryfall-tag-link';
    link.href = buildTagSearchUrl(prefix, tag.slug, location.origin);
    link.textContent = tag.name;
    link.setAttribute('aria-label', `Add ${prefix}:${tag.slug} to the Scryfall search`);
    link.addEventListener('click', (event) => {
      event.preventDefault();
      addTagToSearchField(prefix, tag.slug);
    });
    row.appendChild(link);

    return row;
  }

  function addTagToSearchField(prefix, slug) {
    const searchField = document.getElementById(SEARCH_FIELD_ID);
    if (!searchField) {
      warn(`Could not find #${SEARCH_FIELD_ID}`);
      return;
    }

    const nextValue = appendTagToSearchQuery(searchField.value, prefix, slug);
    setInputValue(searchField, nextValue);
    searchField.dispatchEvent(new Event('input', { bubbles: true }));
    searchField.dispatchEvent(new Event('change', { bubbles: true }));
    searchField.focus();
  }

  function setInputValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, value);
      return;
    }
    input.value = value;
  }

  function log(...args) {
    console.log(TAG, ...args);
  }

  function warn(...args) {
    console.warn(TAG, ...args);
  }
})();
