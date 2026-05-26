// Cache — Card map persistence.
//
// Manages runtime-discovered card identity mappings ("set/cn" → { oracleId, illustrationId })
// in chrome.storage.local. These supplement the bundled card map with cards
// discovered at runtime via Scryfall API lookups.

import * as storage from './storage.js';

const EXTRAS_KEY = 'cardMapExtras';

/**
 * Load previously-discovered card mappings from chrome.storage.local.
 *
 * @returns {Promise<Map<string, { oracleId: string, illustrationId: string|null }>>}
 *   Map of "set/cn" → card IDs. Empty map if nothing stored.
 */
export async function loadCardMapExtras() {
  const stored = await storage.get([EXTRAS_KEY]);
  const extras = stored[EXTRAS_KEY];
  if (!extras) return new Map();

  const result = new Map();
  for (const [key, ids] of Object.entries(extras)) {
    result.set(key, { oracleId: ids.o, illustrationId: ids.i });
  }
  return result;
}

/**
 * Save newly-discovered card mappings to chrome.storage.local.
 * Merges with any previously stored extras.
 *
 * @param {Object<string, { oracleId: string, illustrationId: string|null }>} newEntries
 *   Object of "set/cn" → card IDs to persist.
 * @returns {Promise<void>}
 */
export async function saveCardMapExtras(newEntries) {
  const count = Object.keys(newEntries).length;
  if (count === 0) return;

  const stored = await storage.get([EXTRAS_KEY]);
  const extras = stored[EXTRAS_KEY] || {};
  for (const [key, ids] of Object.entries(newEntries)) {
    extras[key] = { o: ids.oracleId, i: ids.illustrationId };
  }
  await storage.set({ [EXTRAS_KEY]: extras });
}
