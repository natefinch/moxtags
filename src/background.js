// MoxTags - Background Service Worker
// Fetches card tags from Scryfall's cached tag data files and per-card API.

// Load bundled tag data synchronously on service worker startup.
// These files set self.__MOXTAGS_ORACLE, self.__MOXTAGS_ILLUS_1, self.__MOXTAGS_ILLUS_2.
console.log('[MoxTags BG] Service worker starting, loading bundled tag data…');
try {
  importScripts(
    'data/oracle-tags.js',
    'data/illustration-tags-1.js',
    'data/illustration-tags-2.js',
  );
  console.log('[MoxTags BG] importScripts complete.',
    'ORACLE:', !!self.__MOXTAGS_ORACLE,
    'ILLUS_1:', !!self.__MOXTAGS_ILLUS_1,
    'ILLUS_2:', !!self.__MOXTAGS_ILLUS_2);
} catch (e) {
  console.warn('[MoxTags BG] importScripts failed:', e.message);
}

import { expandCompactIndex } from './scryfall/tags.js';
import { fetchTagIndexes, fetchCard, fetchCardByName, fetchCardCollection } from './scryfall/api.js';
import { REFRESH_INTERVAL_MS } from './shared/constants.js';
import { loadTagIndexes, saveTagIndexes, isStale } from './cache/tag-index.js';
import { loadCardMapExtras, saveCardMapExtras } from './cache/card-map.js';
import { scheduleRefresh, onRefreshAlarm } from './cache/refresh.js';

// User-Agent header sent on all outgoing requests.
const USER_AGENT = 'MoxTags/' + chrome.runtime.getManifest().version;

// In-memory reverse indexes: id → [{label, slug}]
let oracleIndex = null;       // oracle_id → tags
let illustrationIndex = null; // illustration_id → tags
let indexReady = null;         // Promise that resolves when indexes are built

// Sorted unique tag name lists for autocomplete.
let oracleTagNames = null;       // string[]
let artTagNames = null;          // string[]

// State for the popup UI.
let refreshing = false;
let lastRefreshError = null;

// Cache of Scryfall card IDs: "set/cn" → { oracleId, illustrationId }
let cardIdCache = new Map();

// Bundled card map loaded from data/card-map.json.
// Format: { o: string[], i: string[], s: { [set]: { [cn]: [oracleIdx, illusIdx] } } }
let bundledCardMap = null;
let cardMapPromise = null; // shared in-flight promise for loading

/**
 * Ensure the bundled card map is loaded. Uses a shared promise to avoid
 * duplicate fetch/parse when multiple callers race on a cold start.
 */
function ensureCardMap() {
  if (bundledCardMap) return Promise.resolve();
  if (!cardMapPromise) {
    console.log('[MoxTags BG] ensureCardMap: starting fetch of card-map files…');
    cardMapPromise = (async () => {
      try {
        const idsUrl = chrome.runtime.getURL('data/card-map-ids.json');
        const setsUrl = chrome.runtime.getURL('data/card-map-sets.json');
        console.log('[MoxTags BG] ensureCardMap: fetching', idsUrl, 'and', setsUrl);
        const [idsResp, setsResp] = await Promise.all([fetch(idsUrl), fetch(setsUrl)]);
        console.log('[MoxTags BG] ensureCardMap: fetch status ids=', idsResp.status, 'sets=', setsResp.status);
        if (idsResp.ok && setsResp.ok) {
          const [ids, sets] = await Promise.all([idsResp.json(), setsResp.json()]);
          bundledCardMap = { o: ids.o, i: ids.i, s: sets.s };
          console.log('[MoxTags BG] Bundled card map loaded.',
            bundledCardMap.o.length, 'oracle IDs,',
            bundledCardMap.i.length, 'illustration IDs,',
            Object.keys(bundledCardMap.s).length, 'sets');
        } else {
          console.warn('[MoxTags BG] ensureCardMap: fetch failed – ids:', idsResp.status, 'sets:', setsResp.status);
        }
      } catch (err) {
        console.warn('[MoxTags BG] ensureCardMap: error:', err.message, err.stack);
      }
      // Load any extra card mappings discovered at runtime.
      try {
        const extras = await loadCardMapExtras();
        let count = 0;
        for (const [key, ids] of extras) {
          if (!cardIdCache.has(key)) {
            cardIdCache.set(key, ids);
            count++;
          }
        }
        if (count > 0) {
          console.log(`[MoxTags BG] Loaded ${count} card map extras from storage.`);
        }
      } catch (err) {
        console.warn('[MoxTags BG] Failed to load card map extras:', err.message);
      }
    })();
  } else {
    console.log('[MoxTags BG] ensureCardMap: already loading, reusing promise');
  }
  return cardMapPromise;
}

/**
 * Look up a card's oracle_id and illustration_id from the bundled card map.
 * Returns { oracleId, illustrationId } or null if not found.
 */
function lookupBundledCard(set, cn) {
  if (!bundledCardMap) {
    console.log('[MoxTags BG] lookupBundledCard: no card map loaded');
    return null;
  }
  const setCards = bundledCardMap.s[set];
  if (!setCards) {
    console.log(`[MoxTags BG] lookupBundledCard: set "${set}" not in card map`);
    return null;
  }
  const entry = setCards[cn];
  if (!entry) {
    console.log(`[MoxTags BG] lookupBundledCard: ${set}/${cn} not in card map`);
    return null;
  }
  const [oi, ii] = entry;
  const result = {
    oracleId: bundledCardMap.o[oi],
    illustrationId: ii >= 0 ? bundledCardMap.i[ii] : null,
  };
  console.log(`[MoxTags BG] lookupBundledCard: ${set}/${cn} → oracle=${result.oracleId}, illus=${result.illustrationId}`);
  return result;
}

// ─── Startup ─────────────────────────────────────────────────────────

// Chrome ignores User-Agent set via fetch headers (forbidden header).
// Use declarativeNetRequest to override it at the network level.
function setupUserAgentRule() {
  if (!chrome.declarativeNetRequest) return;
  chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{
          header: 'User-Agent',
          operation: 'set',
          value: USER_AGENT,
        }],
      },
      condition: {
        requestDomains: ['api.scryfall.com'],
      },
    }],
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupUserAgentRule();
  scheduleRefresh('refreshTagData', 24 * 60);
  // Start downloading tag data immediately so it's ready when the user
  // first visits a deck page.
  ensureIndexes().catch(err =>
    console.warn('[MoxTags BG] Initial index load failed:', err.message));
});

chrome.runtime.onStartup.addListener(() => {
  setupUserAgentRule();
  scheduleRefresh('refreshTagData', 24 * 60);
});

// ─── Message handling ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetch') {
    doFetch(msg.url, msg.options || {})
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'fetchTags') {
    console.log(`[MoxTags BG] fetchTags request: set=${msg.set} number=${msg.number}`);
    fetchTags(msg.set, msg.number)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'fetchTagsByName') {
    console.log(`[MoxTags BG] fetchTagsByName request: name=${msg.name}`);
    fetchTagsByName(msg.name)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'prefetchDeck') {
    console.log(`[MoxTags BG] prefetchDeck request: ${msg.cards?.length} cards`);
    prefetchDeck(msg.cards)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'getStatus') {
    getStatus().then(status => sendResponse(status));
    return true;
  }
  if (msg.type === 'refreshTags') {
    refreshing = true;
    lastRefreshError = null;
    refreshTagData()
      .then(() => { refreshing = false; sendResponse({ ok: true }); })
      .catch(err => {
        refreshing = false;
        lastRefreshError = err.message;
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }
  if (msg.type === 'getTagNames') {
    ensureIndexes()
      .then(() => sendResponse({ ok: true, oracleTagNames: oracleTagNames || [], artTagNames: artTagNames || [] }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ─── Status for popup ─────────────────────────────────────────────────
async function getStatus() {
  const stored = await loadTagIndexes();
  return {
    refreshing,
    tagDataTimestamp: stored?.timestamp || null,
    oracleCount: oracleIndex ? oracleIndex.size : null,
    illustrationCount: illustrationIndex ? illustrationIndex.size : null,
    lastError: lastRefreshError,
  };
}

// ─── Simple proxy fetch (used for Moxfield API) ─────────────────────
async function doFetch(url, options) {
  try {
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers: { 'User-Agent': USER_AGENT, ...(options.headers || {}) },
      credentials: 'omit',
    });
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}`, status: resp.status };
    }
    const body = await resp.text();
    return { ok: true, body, status: resp.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Tag lookup ──────────────────────────────────────────────────────
async function fetchTags(set, number) {
  try {
    const indexesReady = !!(oracleIndex && illustrationIndex);
    console.log(`[MoxTags BG] fetchTags(${set}, ${number}): indexesReady=${indexesReady}, bundledCardMap=${!!bundledCardMap}`);
    await Promise.all([ensureIndexes(), ensureCardMap()]);
    console.log(`[MoxTags BG] fetchTags: ensureIndexes+ensureCardMap resolved, bundledCardMap=${!!bundledCardMap}`);

    const key = `${set}/${number}`;
    let ids = cardIdCache.get(key);
    console.log(`[MoxTags BG] fetchTags: cache lookup ${key} → ${ids ? 'HIT' : 'MISS'}`);

    // If not in cache, check bundled card map first, then Scryfall.
    if (!ids) {
      ids = lookupBundledCard(set, number);
      if (ids) {
        console.log(`[MoxTags BG] fetchTags: ${key} resolved from bundled card map`);
        cardIdCache.set(key, ids);
      } else {
        console.log(`[MoxTags BG] fetchTags: ${key} NOT in bundled map, falling back to Scryfall API`);
        try {
          ids = await fetchCard(set, number, fetch, {
            headers: { 'User-Agent': USER_AGENT },
          });
        } catch (err) {
          return { ok: false, error: err.message };
        }
        cardIdCache.set(key, ids);
        persistCardMapExtra(key, ids);
      }
    }

    const cardTags = ids.oracleId && oracleIndex
      ? (oracleIndex.get(ids.oracleId) || [])
      : [];
    const artTags = ids.illustrationId && illustrationIndex
      ? (illustrationIndex.get(ids.illustrationId) || [])
      : [];

    return { ok: true, artTags, cardTags, cacheLoading: refreshing };
  } catch (err) {
    // If indexes haven't loaded yet, signal that the cache is still loading
    // so the UI can show an appropriate message instead of an error.
    return { ok: false, error: err.message, cacheLoading: refreshing || !oracleIndex };
  }
}

// ─── Tag lookup by card name ─────────────────────────────────────────
async function fetchTagsByName(name) {
  try {
    await ensureIndexes();

    // Use Scryfall's named card API to find the card.
    // This returns the default printing — used as a fallback when the exact
    // printing cannot be resolved via the Moxfield card ID.
    const ids = await fetchCardByName(name, fetch, {
      headers: { 'User-Agent': USER_AGENT },
    });

    const cardTags = ids.oracleId && oracleIndex
      ? (oracleIndex.get(ids.oracleId) || [])
      : [];
    const artTags = ids.illustrationId && illustrationIndex
      ? (illustrationIndex.get(ids.illustrationId) || [])
      : [];

    return { ok: true, artTags, cardTags, cacheLoading: refreshing };
  } catch (err) {
    return { ok: false, error: err.message, cacheLoading: refreshing || !oracleIndex };
  }
}

// ─── Batch prefetch ──────────────────────────────────────────────────
/**
 * Prefetch oracle_id and illustration_id for all cards in a deck
 * using Scryfall's /cards/collection endpoint (75 per request).
 * Returns resolved tags for every card keyed by "set/cn".
 */
async function prefetchDeck(cards) {
  console.log(`[MoxTags BG] prefetchDeck: starting with ${cards.length} cards, bundledCardMap=${!!bundledCardMap}`);
  await Promise.all([ensureIndexes(), ensureCardMap()]);
  console.log(`[MoxTags BG] prefetchDeck: ensureIndexes+ensureCardMap resolved, bundledCardMap=${!!bundledCardMap}`);

  // Resolve cards from the in-memory cache and bundled map first.
  let bundledHits = 0;
  let cacheHits = 0;
  for (const c of cards) {
    const key = `${c.set}/${c.cn}`;
    if (cardIdCache.has(key)) {
      cacheHits++;
    } else {
      const bundled = lookupBundledCard(c.set, c.cn);
      if (bundled) {
        cardIdCache.set(key, bundled);
        bundledHits++;
      }
    }
  }
  console.log(`[MoxTags BG] prefetchDeck: ${cacheHits} cache hits, ${bundledHits} bundled hits, ${cards.length - cacheHits - bundledHits} still needed`);

  // Only fetch cards still not resolved.
  const needed = cards.filter(c => !cardIdCache.has(`${c.set}/${c.cn}`));
  if (needed.length > 0) {
    console.log(`[MoxTags BG] Prefetching ${needed.length} cards from Scryfall…`);

    const resolved = await fetchCardCollection(needed, fetch, {
      headers: { 'User-Agent': USER_AGENT },
    });

    // Merge resolved cards into cache and persist new discoveries.
    const newExtras = {};
    for (const [key, ids] of resolved) {
      cardIdCache.set(key, ids);
      newExtras[key] = ids;
    }
    if (Object.keys(newExtras).length > 0) {
      saveCardMapExtras(newExtras).catch(err =>
        console.warn('[MoxTags BG] Failed to persist card map extras:', err.message));
    }

    console.log(`[MoxTags BG] Prefetch done. Card ID cache: ${cardIdCache.size} entries.`);
  }

  // Resolve tags for all requested cards.
  const result = {};
  for (const c of cards) {
    const key = `${c.set}/${c.cn}`;
    const ids = cardIdCache.get(key);
    if (!ids) continue;
    const cardTags = ids.oracleId && oracleIndex
      ? (oracleIndex.get(ids.oracleId) || [])
      : [];
    const artTags = ids.illustrationId && illustrationIndex
      ? (illustrationIndex.get(ids.illustrationId) || [])
      : [];
    result[key] = { artTags, cardTags };
  }

  return { ok: true, tags: result };
}

// ─── Index management ────────────────────────────────────────────────

/**
 * Ensure indexes are loaded. Tries (in order):
 * 1. In-memory cache
 * 2. chrome.storage.local (previously refreshed data)
 * 3. Bundled JSON files shipped with the extension
 * 4. Fresh fetch from Scryfall API
 */
async function ensureIndexes() {
  if (oracleIndex && illustrationIndex) {
    console.log('[MoxTags BG] ensureIndexes: already loaded');
    return;
  }
  console.log('[MoxTags BG] ensureIndexes: loading…');

  // Try loading from storage (freshest persisted data).
  const stored = await loadTagIndexes();

  if (stored) {
    oracleIndex = stored.oracleIndex;
    illustrationIndex = stored.illustrationIndex;
    oracleTagNames = stored.oracleTagNames;
    artTagNames = stored.artTagNames;
    console.log('[MoxTags BG] Indexes loaded from storage.',
      oracleIndex.size, 'oracle IDs,', illustrationIndex.size, 'illustration IDs');

    // Check if refresh is needed (in background, don't block).
    if (isStale(stored.timestamp, REFRESH_INTERVAL_MS)) {
      refreshTagData().catch(err =>
        console.warn('[MoxTags BG] Background refresh failed:', err.message));
    }
    return;
  }

  // No stored data — try bundled tag data shipped with the extension.
  if (loadBundledData()) {
    // Bundled data loaded — kick off an API refresh in the background
    // so we get up-to-date tags without blocking.
    refreshTagData().catch(err =>
      console.warn('[MoxTags BG] Background refresh failed:', err.message));
    return;
  }

  // No bundled data either — must fetch from API now.
  await refreshTagData();
}

/**
 * Load pre-computed tag indexes from bundled JS globals.
 * The globals are set by importScripts() at service worker startup.
 * Returns true if successful, false if data is not available.
 */
function loadBundledData() {
  try {
    if (!self.__MOXTAGS_ORACLE || !self.__MOXTAGS_ILLUS_1 || !self.__MOXTAGS_ILLUS_2) return false;

    oracleIndex = expandCompactIndex(self.__MOXTAGS_ORACLE);
    illustrationIndex = expandCompactIndex(self.__MOXTAGS_ILLUS_1, self.__MOXTAGS_ILLUS_2);
    oracleTagNames = self.__MOXTAGS_ORACLE.t;
    // Both halves share the same tag labels array.
    artTagNames = self.__MOXTAGS_ILLUS_1.t;

    // Release the raw tag data to free memory.
    delete self.__MOXTAGS_ORACLE;
    delete self.__MOXTAGS_ILLUS_1;
    delete self.__MOXTAGS_ILLUS_2;

    console.log('[MoxTags BG] Indexes loaded from bundled data.',
      oracleIndex.size, 'oracle IDs,', illustrationIndex.size, 'illustration IDs');
    return true;
  } catch (err) {
    console.warn('[MoxTags BG] Failed to load bundled data:', err.message);
    return false;
  }
}

// ─── Card map extras (newly-discovered cards) ────────────────────────

/**
 * Persist a single newly-discovered card mapping via cache.
 */
function persistCardMapExtra(key, ids) {
  saveCardMapExtras({ [key]: ids }).catch(err =>
    console.warn('[MoxTags BG] Failed to persist card map extra:', err.message));
}

/**
 * Fetch both tag files from Scryfall, build reverse indexes, and
 * persist them to chrome.storage.local.
 */
async function refreshTagData() {
  refreshing = true;
  lastRefreshError = null;
  console.log('[MoxTags BG] Fetching tag data from Scryfall…');

  try {
    const result = await fetchTagIndexes(fetch, {
      headers: { 'User-Agent': USER_AGENT },
    });

    oracleIndex = result.oracleIndex;
    illustrationIndex = result.illustrationIndex;
    oracleTagNames = result.oracleTagNames;
    artTagNames = result.artTagNames;

    console.log('[MoxTags BG] Indexes built.',
      oracleIndex.size, 'oracle IDs,', illustrationIndex.size, 'illustration IDs,',
      oracleTagNames.length, 'oracle tag names,', artTagNames.length, 'art tag names');

    // Persist to storage.
    await saveTagIndexes({
      oracleIndex, illustrationIndex, oracleTagNames, artTagNames,
    });

    console.log('[MoxTags BG] Tag data cached to storage.');
    lastRefreshError = null;
  } catch (err) {
    lastRefreshError = err.message;
    throw err;
  } finally {
    refreshing = false;
  }
}

// ─── Scheduled refresh ──────────────────────────────────────────────
onRefreshAlarm('refreshTagData', () => refreshTagData());
