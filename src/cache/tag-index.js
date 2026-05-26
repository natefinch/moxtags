// Cache — Tag index persistence.
//
// Knows the shape of tag index data (Map entries, tag name arrays, timestamps)
// but not where the data comes from (Scryfall, bundled files, etc.).

import * as storage from './storage.js';

const STORAGE_KEYS = [
  'oracleIndex', 'illustrationIndex', 'tagDataTimestamp',
  'oracleTagNames', 'artTagNames',
];

/**
 * Load tag indexes from chrome.storage.local.
 *
 * @returns {Promise<{
 *   oracleIndex: Map, illustrationIndex: Map,
 *   oracleTagNames: string[]|null, artTagNames: string[]|null,
 *   timestamp: number|null
 * }|null>}
 *   Returns null if no stored indexes exist.
 */
export async function loadTagIndexes() {
  const stored = await storage.get(STORAGE_KEYS);

  if (!stored.oracleIndex || !stored.illustrationIndex) {
    return null;
  }

  return {
    oracleIndex: new Map(stored.oracleIndex),
    illustrationIndex: new Map(stored.illustrationIndex),
    oracleTagNames: stored.oracleTagNames || null,
    artTagNames: stored.artTagNames || null,
    timestamp: stored.tagDataTimestamp || null,
  };
}

/**
 * Save tag indexes to chrome.storage.local.
 *
 * @param {Object} data
 * @param {Map} data.oracleIndex
 * @param {Map} data.illustrationIndex
 * @param {string[]} data.oracleTagNames
 * @param {string[]} data.artTagNames
 * @returns {Promise<void>}
 */
export async function saveTagIndexes({ oracleIndex, illustrationIndex, oracleTagNames, artTagNames }) {
  await storage.set({
    oracleIndex: [...oracleIndex.entries()],
    illustrationIndex: [...illustrationIndex.entries()],
    oracleTagNames,
    artTagNames,
    tagDataTimestamp: Date.now(),
  });
}

/**
 * Check if the stored tag data is stale.
 *
 * @param {number|null} timestamp - The timestamp of the stored data.
 * @param {number} maxAge - Maximum age in milliseconds.
 * @returns {boolean} True if data is stale or timestamp is null.
 */
export function isStale(timestamp, maxAge) {
  if (!timestamp) return true;
  return (Date.now() - timestamp) > maxAge;
}
