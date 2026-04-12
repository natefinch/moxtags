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

import { buildReverseIndex, extractTagNames, expandCompactIndex } from './shared/tags.js';
import {
  ORACLE_TAGS_URL,
  ILLUSTRATION_TAGS_URL,
  SCRYFALL_CARD_API,
  REFRESH_INTERVAL_MS,
} from './shared/constants.js';

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
      await loadCardMapExtras().catch(err =>
        console.warn('[MoxTags BG] Failed to load card map extras:', err.message));
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
  scheduleRefresh();
  // Start downloading tag data immediately so it's ready when the user
  // first visits a deck page.
  ensureIndexes().catch(err =>
    console.warn('[MoxTags BG] Initial index load failed:', err.message));
});

chrome.runtime.onStartup.addListener(() => {
  setupUserAgentRule();
  scheduleRefresh();
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
  const stored = await chrome.storage.local.get(['tagDataTimestamp']);
  return {
    refreshing,
    tagDataTimestamp: stored.tagDataTimestamp || null,
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
        const cardUrl = `${SCRYFALL_CARD_API}/${encodeURIComponent(set)}/${encodeURIComponent(number)}`;
        const resp = await fetch(cardUrl, { headers: { 'User-Agent': USER_AGENT }, credentials: 'omit' });
        if (!resp.ok) {
          return { ok: false, error: `Scryfall API error: HTTP ${resp.status}` };
        }
        const card = await resp.json();
        ids = { oracleId: card.oracle_id, illustrationId: card.illustration_id };
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
    const url = `${SCRYFALL_CARD_API}/named?exact=${encodeURIComponent(name)}`;
    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, credentials: 'omit' });
    if (!resp.ok) {
      return { ok: false, error: `Scryfall API error: HTTP ${resp.status}` };
    }
    const card = await resp.json();
    const oracleId = card.oracle_id;
    const illustrationId = card.illustration_id;

    const cardTags = oracleId && oracleIndex
      ? (oracleIndex.get(oracleId) || [])
      : [];
    const artTags = illustrationId && illustrationIndex
      ? (illustrationIndex.get(illustrationId) || [])
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

    // Batch into groups of 75 (Scryfall collection limit).
    const BATCH = 75;
    for (let i = 0; i < needed.length; i += BATCH) {
      const batch = needed.slice(i, i + BATCH);
      const identifiers = batch.map(c => ({
        set: c.set,
        collector_number: c.cn,
      }));

      try {
        const resp = await fetch(`${SCRYFALL_CARD_API}/collection`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
          credentials: 'omit',
          body: JSON.stringify({ identifiers }),
        });
        if (!resp.ok) {
          console.warn(`[MoxTags BG] Collection batch failed: HTTP ${resp.status}`);
          continue;
        }
        const data = await resp.json();
        const newExtras = {};
        for (const card of (data.data || [])) {
          const set = (card.set || '').toLowerCase();
          const cn  = card.collector_number || '';
          if (set && cn) {
            const ids = {
              oracleId: card.oracle_id,
              illustrationId: card.illustration_id,
            };
            cardIdCache.set(`${set}/${cn}`, ids);
            newExtras[`${set}/${cn}`] = ids;
          }
        }
        if (Object.keys(newExtras).length > 0) {
          persistCardMapExtras(newExtras);
        }
      } catch (err) {
        console.warn('[MoxTags BG] Collection batch error:', err.message);
      }

      // Scryfall asks for 50-100ms between requests.
      if (i + BATCH < needed.length) {
        await new Promise(r => setTimeout(r, 100));
      }
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
  const stored = await chrome.storage.local.get([
    'oracleIndex', 'illustrationIndex', 'tagDataTimestamp',
    'oracleTagNames', 'artTagNames',
  ]);

  if (stored.oracleIndex && stored.illustrationIndex) {
    oracleIndex = new Map(stored.oracleIndex);
    illustrationIndex = new Map(stored.illustrationIndex);
    oracleTagNames = stored.oracleTagNames || null;
    artTagNames = stored.artTagNames || null;
    console.log('[MoxTags BG] Indexes loaded from storage.',
      oracleIndex.size, 'oracle IDs,', illustrationIndex.size, 'illustration IDs');

    // Check if refresh is needed (in background, don't block).
    const age = Date.now() - (stored.tagDataTimestamp || 0);
    if (age > REFRESH_INTERVAL_MS) {
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
 * Persist a single newly-discovered card mapping to chrome.storage.local.
 */
function persistCardMapExtra(key, ids) {
  persistCardMapExtras({ [key]: ids });
}

/**
 * Persist multiple newly-discovered card mappings to chrome.storage.local.
 * Merges with any previously stored extras.
 */
async function persistCardMapExtras(newEntries) {
  const count = Object.keys(newEntries).length;
  console.log(`[MoxTags BG] persistCardMapExtras: saving ${count} new entries`);
  try {
    const stored = await chrome.storage.local.get(['cardMapExtras']);
    const extras = stored.cardMapExtras || {};
    const prevCount = Object.keys(extras).length;
    for (const [key, ids] of Object.entries(newEntries)) {
      extras[key] = { o: ids.oracleId, i: ids.illustrationId };
    }
    await chrome.storage.local.set({ cardMapExtras: extras });
    console.log(`[MoxTags BG] persistCardMapExtras: stored ${Object.keys(extras).length} total extras (was ${prevCount})`);
  } catch (err) {
    console.warn('[MoxTags BG] Failed to persist card map extras:', err.message);
  }
}

/**
 * Load previously-discovered card mappings from chrome.storage.local
 * into the in-memory cache.
 */
async function loadCardMapExtras() {
  try {
    const stored = await chrome.storage.local.get(['cardMapExtras']);
    const extras = stored.cardMapExtras;
    if (!extras) return;
    let count = 0;
    for (const [key, ids] of Object.entries(extras)) {
      if (!cardIdCache.has(key)) {
        cardIdCache.set(key, { oracleId: ids.o, illustrationId: ids.i });
        count++;
      }
    }
    if (count > 0) {
      console.log(`[MoxTags BG] Loaded ${count} card map extras from storage.`);
    }
  } catch (err) {
    console.warn('[MoxTags BG] Failed to load card map extras:', err.message);
  }
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
    const [oracleResp, illustrationResp] = await Promise.all([
      fetch(ORACLE_TAGS_URL, { headers: { 'User-Agent': USER_AGENT }, credentials: 'omit' }),
      fetch(ILLUSTRATION_TAGS_URL, { headers: { 'User-Agent': USER_AGENT }, credentials: 'omit' }),
    ]);

    if (!oracleResp.ok || !illustrationResp.ok) {
      throw new Error(`Tag fetch failed: oracle=${oracleResp.status}, illustration=${illustrationResp.status}`);
    }

    const [oracleData, illustrationData] = await Promise.all([
      oracleResp.json(),
      illustrationResp.json(),
    ]);

    // Build reverse indexes: id → [{name, slug}]
    oracleIndex = buildReverseIndex(oracleData.data, 'oracle_ids');
    illustrationIndex = buildReverseIndex(illustrationData.data, 'illustration_ids');

    // Build sorted unique tag name lists for autocomplete.
    oracleTagNames = extractTagNames(oracleData.data);
    artTagNames = extractTagNames(illustrationData.data);

    console.log('[MoxTags BG] Indexes built.',
      oracleIndex.size, 'oracle IDs,', illustrationIndex.size, 'illustration IDs,',
      oracleTagNames.length, 'oracle tag names,', artTagNames.length, 'art tag names');

    // Persist to storage as arrays of [key, value] entries.
    await chrome.storage.local.set({
      oracleIndex: [...oracleIndex.entries()],
      illustrationIndex: [...illustrationIndex.entries()],
      oracleTagNames,
      artTagNames,
      tagDataTimestamp: Date.now(),
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

/**
 * Schedule the next tag data refresh. Uses chrome.alarms to fire
 * roughly once per day with random jitter within a 1-hour window
 * to spread load across users.
 */
function scheduleRefresh() {
  // Random jitter: 0–60 minutes within the next 24h window.
  const jitterMinutes = Math.floor(Math.random() * 60);
  const delayMinutes = 24 * 60 + jitterMinutes;

  chrome.alarms.create('refreshTagData', { delayInMinutes: delayMinutes });
  console.log(`[MoxTags BG] Next tag refresh scheduled in ${delayMinutes} minutes.`);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refreshTagData') {
    refreshTagData()
      .then(() => scheduleRefresh())
      .catch(err => {
        console.warn('[MoxTags BG] Scheduled refresh failed:', err.message);
        // Retry in 1 hour.
        chrome.alarms.create('refreshTagData', { delayInMinutes: 60 });
      });
  }
});
