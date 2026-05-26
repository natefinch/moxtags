// Scryfall API interaction — Pure API call functions.
//
// All functions accept a `fetchFn` parameter for dependency injection
// and return raw data. They don't touch chrome.storage or global state.

import { SCRYFALL_CARD_API, ORACLE_TAGS_URL, ILLUSTRATION_TAGS_URL } from './constants.js';
import { buildReverseIndex, extractTagNames } from './tags.js';

/**
 * Fetch both tag index files from Scryfall and build reverse indexes.
 *
 * @param {Function} fetchFn - A fetch-compatible function.
 * @param {Object} [options]
 * @param {string} [options.oracleUrl] - Override the oracle tags URL.
 * @param {string} [options.illustrationUrl] - Override the illustration tags URL.
 * @param {Object} [options.headers] - Additional headers (e.g., User-Agent).
 * @returns {Promise<{
 *   oracleIndex: Map, illustrationIndex: Map,
 *   oracleTagNames: string[], artTagNames: string[]
 * }>}
 */
export async function fetchTagIndexes(fetchFn, options = {}) {
  const oracleUrl = options.oracleUrl || ORACLE_TAGS_URL;
  const illustrationUrl = options.illustrationUrl || ILLUSTRATION_TAGS_URL;
  const headers = options.headers || {};

  const [oracleResp, illustrationResp] = await Promise.all([
    fetchFn(oracleUrl, { headers, credentials: 'omit' }),
    fetchFn(illustrationUrl, { headers, credentials: 'omit' }),
  ]);

  if (!oracleResp.ok || !illustrationResp.ok) {
    throw new Error(
      `Tag fetch failed: oracle=${oracleResp.status}, illustration=${illustrationResp.status}`
    );
  }

  const [oracleData, illustrationData] = await Promise.all([
    oracleResp.json(),
    illustrationResp.json(),
  ]);

  const oracleIndex = buildReverseIndex(oracleData.data, 'oracle_ids');
  const illustrationIndex = buildReverseIndex(illustrationData.data, 'illustration_ids');
  const oracleTagNames = extractTagNames(oracleData.data);
  const artTagNames = extractTagNames(illustrationData.data);

  return { oracleIndex, illustrationIndex, oracleTagNames, artTagNames };
}

/**
 * Fetch a single card from Scryfall by set code and collector number.
 *
 * @param {string} set - Set code (e.g., "neo").
 * @param {string} cn - Collector number.
 * @param {Function} fetchFn - A fetch-compatible function.
 * @param {Object} [options]
 * @param {string} [options.apiUrl] - Override the base Scryfall card API URL.
 * @param {Object} [options.headers] - Additional headers.
 * @returns {Promise<{ oracleId: string, illustrationId: string|null }>}
 */
export async function fetchCard(set, cn, fetchFn, options = {}) {
  const apiUrl = options.apiUrl || SCRYFALL_CARD_API;
  const headers = options.headers || {};

  const url = `${apiUrl}/${encodeURIComponent(set)}/${encodeURIComponent(cn)}`;
  const resp = await fetchFn(url, { headers, credentials: 'omit' });
  if (!resp.ok) {
    throw new Error(`Scryfall API error: HTTP ${resp.status}`);
  }
  const card = await resp.json();
  return { oracleId: card.oracle_id, illustrationId: card.illustration_id };
}

/**
 * Fetch a card from Scryfall by exact name (default printing).
 *
 * @param {string} name - Exact card name.
 * @param {Function} fetchFn - A fetch-compatible function.
 * @param {Object} [options]
 * @param {string} [options.apiUrl] - Override the base Scryfall card API URL.
 * @param {Object} [options.headers] - Additional headers.
 * @returns {Promise<{ oracleId: string, illustrationId: string|null }>}
 */
export async function fetchCardByName(name, fetchFn, options = {}) {
  const apiUrl = options.apiUrl || SCRYFALL_CARD_API;
  const headers = options.headers || {};

  const url = `${apiUrl}/named?exact=${encodeURIComponent(name)}`;
  const resp = await fetchFn(url, { headers, credentials: 'omit' });
  if (!resp.ok) {
    throw new Error(`Scryfall API error: HTTP ${resp.status}`);
  }
  const card = await resp.json();
  return { oracleId: card.oracle_id, illustrationId: card.illustration_id };
}

/**
 * Fetch multiple cards from Scryfall using the /cards/collection endpoint.
 * Automatically batches into groups of `batchSize` (default 75).
 *
 * @param {Array<{ set: string, cn: string }>} cards - Cards to look up.
 * @param {Function} fetchFn - A fetch-compatible function.
 * @param {Object} [options]
 * @param {string} [options.apiUrl] - Override the base Scryfall card API URL.
 * @param {Object} [options.headers] - Additional headers.
 * @param {number} [options.batchSize] - Max cards per request (default 75).
 * @param {number} [options.delayMs] - Delay between batches in ms (default 100).
 * @returns {Promise<Map<string, { oracleId: string, illustrationId: string|null }>>}
 *   Map of "set/cn" → card IDs.
 */
export async function fetchCardCollection(cards, fetchFn, options = {}) {
  const apiUrl = options.apiUrl || SCRYFALL_CARD_API;
  const headers = options.headers || {};
  const batchSize = options.batchSize || 75;
  const delayMs = options.delayMs ?? 100;

  const result = new Map();

  for (let i = 0; i < cards.length; i += batchSize) {
    const batch = cards.slice(i, i + batchSize);
    const identifiers = batch.map(c => ({
      set: c.set,
      collector_number: c.cn,
    }));

    try {
      const resp = await fetchFn(`${apiUrl}/collection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        credentials: 'omit',
        body: JSON.stringify({ identifiers }),
      });
      if (!resp.ok) {
        console.warn(`Collection batch failed: HTTP ${resp.status}`);
        continue;
      }
      const data = await resp.json();
      for (const card of (data.data || [])) {
        const set = (card.set || '').toLowerCase();
        const cn = card.collector_number || '';
        if (set && cn) {
          result.set(`${set}/${cn}`, {
            oracleId: card.oracle_id,
            illustrationId: card.illustration_id,
          });
        }
      }
    } catch (err) {
      console.warn('Collection batch error:', err.message);
    }

    // Scryfall asks for 50-100ms between requests.
    if (i + batchSize < cards.length && delayMs > 0) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return result;
}
