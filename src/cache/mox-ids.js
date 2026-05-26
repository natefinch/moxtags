// Cache — Moxfield card ID persistence.
//
// Manages the mapping of Moxfield card IDs → { set, cn } in
// chrome.storage.local. This avoids repeated Moxfield API lookups
// for the same card across sessions.

import * as storage from './storage.js';

const CACHE_KEY = 'moxIdCache';

/**
 * Load the Moxfield ID cache from chrome.storage.local.
 *
 * @returns {Promise<Map<string, { set: string, cn: string }>>}
 *   Map of Moxfield card ID → { set, cn }. Empty map if nothing stored.
 */
export async function loadMoxIdCache() {
  const result = await storage.get([CACHE_KEY]);
  const stored = result[CACHE_KEY];
  if (!stored || typeof stored !== 'object') return new Map();

  const cache = new Map();
  for (const [id, val] of Object.entries(stored)) {
    cache.set(id, val);
  }
  return cache;
}

/**
 * Create a debounced persister for the Moxfield ID cache.
 * Returns an object with `persist()` and `merge()` methods.
 *
 * @param {Object} [options]
 * @param {number} [options.debounceMs] - Debounce interval (default 2000ms).
 * @param {Function} [options.logFn] - Optional logging function.
 * @returns {{ persist: (cache: Map) => void, merge: (cache: Map, newIds: Map) => void }}
 */
export function createMoxIdPersister(options = {}) {
  const debounceMs = options.debounceMs || 2000;
  const log = options.logFn || (() => {});
  let dirty = false;
  let timer = null;

  function persist(cache) {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      const obj = Object.fromEntries(cache);
      storage.set({ [CACHE_KEY]: obj }).then(() => {
        log('Moxfield ID cache persisted:', cache.size, 'entries');
      });
    }, debounceMs);
  }

  function merge(cache, newIds) {
    if (!newIds || newIds.size === 0) return;
    let added = 0;
    for (const [id, val] of newIds) {
      if (!cache.has(id)) {
        cache.set(id, val);
        added++;
      }
    }
    if (added > 0) {
      log('Moxfield ID cache: merged', added, 'new entries (total:', cache.size + ')');
      persist(cache);
    }
  }

  return { persist, merge };
}
