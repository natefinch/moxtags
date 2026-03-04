// MoxTags - Background Service Worker
// Fetches card tags from Scryfall's cached tag data files and per-card API.

const ORACLE_TAGS_URL = 'https://api.scryfall.com/private/tags/oracle';
const ILLUSTRATION_TAGS_URL = 'https://api.scryfall.com/private/tags/illustration';
const SCRYFALL_CARD_API = 'https://api.scryfall.com/cards';

// How often to refresh the tag data (roughly once per day).
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// In-memory reverse indexes: id → [{label, slug}]
let oracleIndex = null;       // oracle_id → tags
let illustrationIndex = null; // illustration_id → tags
let indexReady = null;         // Promise that resolves when indexes are built

// State for the popup UI.
let refreshing = false;
let lastRefreshError = null;

// Cache of Scryfall card IDs: "set/cn" → { oracleId, illustrationId }
let cardIdCache = new Map();

// ─── Startup ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  scheduleRefresh();
});

chrome.runtime.onStartup.addListener(() => {
  scheduleRefresh();
});

// Indexes are loaded lazily on first fetchTags call, not at startup.

// ─── Message handling ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetch') {
    doFetch(msg.url, msg.options || {})
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'fetchTags') {
    fetchTags(msg.set, msg.number)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'prefetchDeck') {
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
      headers: options.headers || {},
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
    await ensureIndexes();

    const key = `${set}/${number}`;
    let ids = cardIdCache.get(key);

    // If not in cache, fetch this single card from Scryfall (fallback).
    if (!ids) {
      const cardUrl = `${SCRYFALL_CARD_API}/${encodeURIComponent(set)}/${encodeURIComponent(number)}`;
      const resp = await fetch(cardUrl, { credentials: 'omit' });
      if (!resp.ok) {
        return { ok: false, error: `Scryfall API error: HTTP ${resp.status}` };
      }
      const card = await resp.json();
      ids = { oracleId: card.oracle_id, illustrationId: card.illustration_id };
      cardIdCache.set(key, ids);
    }

    const cardTags = ids.oracleId && oracleIndex
      ? (oracleIndex.get(ids.oracleId) || [])
      : [];
    const artTags = ids.illustrationId && illustrationIndex
      ? (illustrationIndex.get(ids.illustrationId) || [])
      : [];

    return { ok: true, artTags, cardTags };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Batch prefetch ──────────────────────────────────────────────────
/**
 * Prefetch oracle_id and illustration_id for all cards in a deck
 * using Scryfall's /cards/collection endpoint (75 per request).
 * Returns resolved tags for every card keyed by "set/cn".
 */
async function prefetchDeck(cards) {
  await ensureIndexes();

  // Filter to cards not already cached.
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
          headers: { 'Content-Type': 'application/json' },
          credentials: 'omit',
          body: JSON.stringify({ identifiers }),
        });
        if (!resp.ok) {
          console.warn(`[MoxTags BG] Collection batch failed: HTTP ${resp.status}`);
          continue;
        }
        const data = await resp.json();
        for (const card of (data.data || [])) {
          const set = (card.set || '').toLowerCase();
          const cn  = card.collector_number || '';
          if (set && cn) {
            cardIdCache.set(`${set}/${cn}`, {
              oracleId: card.oracle_id,
              illustrationId: card.illustration_id,
            });
          }
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
 * Ensure indexes are loaded. Uses in-memory cache, falls back to
 * chrome.storage.local, and fetches from Scryfall if needed.
 */
async function ensureIndexes() {
  if (oracleIndex && illustrationIndex) return;

  // Try loading from storage.
  const stored = await chrome.storage.local.get(['oracleIndex', 'illustrationIndex', 'tagDataTimestamp']);

  if (stored.oracleIndex && stored.illustrationIndex) {
    oracleIndex = new Map(stored.oracleIndex);
    illustrationIndex = new Map(stored.illustrationIndex);
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

  // No stored data – must fetch now.
  await refreshTagData();
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
      fetch(ORACLE_TAGS_URL, { credentials: 'omit' }),
      fetch(ILLUSTRATION_TAGS_URL, { credentials: 'omit' }),
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

    console.log('[MoxTags BG] Indexes built.',
      oracleIndex.size, 'oracle IDs,', illustrationIndex.size, 'illustration IDs');

    // Persist to storage as arrays of [key, value] entries.
    await chrome.storage.local.set({
      oracleIndex: [...oracleIndex.entries()],
      illustrationIndex: [...illustrationIndex.entries()],
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

/**
 * Build a Map from id → [{name, slug}] from the tag data array.
 * Each tag has a `label` (used as both name and slug) and an array
 * of IDs under `idKey`.
 */
function buildReverseIndex(tags, idKey) {
  const index = new Map();
  for (const tag of tags) {
    const entry = { name: tag.label, slug: tag.label };
    const ids = tag[idKey];
    if (!ids) continue;
    for (const id of ids) {
      let list = index.get(id);
      if (!list) {
        list = [];
        index.set(id, list);
      }
      list.push(entry);
    }
  }
  return index;
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
