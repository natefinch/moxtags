# scryfall

Reusable package for interacting with the [Scryfall](https://scryfall.com/) API — fetching cards, building tag indexes, and managing compact tag data structures.

All API functions use **dependency injection** for `fetch` and request options, making them testable and usable outside the browser extension context (e.g., in Node.js scripts).

## Files

| File | Purpose |
|------|---------|
| `api.js` | Pure Scryfall API functions (cards, collections, tag indexes) |
| `tags.js` | Tag index utilities — build, compact, expand, and split indexes |
| `constants.js` | Scryfall API endpoint URLs |
| `index.js` | Public API — re-exports from all modules |

## API

### constants.js

- **`ORACLE_TAGS_URL`** — Scryfall oracle-tag bulk-data metadata endpoint.
- **`ILLUSTRATION_TAGS_URL`** — Scryfall art-tag bulk-data metadata endpoint.
- **`SCRYFALL_CARD_API`** — Base Scryfall cards API URL.

### tags.js

- **`buildReverseIndex(tags, idKey)`** → `Map<string, string[]>`
  Builds a reverse index mapping card IDs to their tag names.

- **`extractTagSlugs(data)`** → `string[]`
  Extracts sorted unique search slugs from a Scryfall tag dataset.

- **`buildCompactIndex(reverseIndex)`** → `{ t: string[], n?: Record<number, string>, d: Record<string, number[]> }`
  Compresses a reverse index into slugs, differing display names, and ID arrays.

- **`expandCompactIndex(...compacts)`** → `Map`
  Expands one or more compact indexes back into a merged lookup map.

- **`splitCompactIndex(compact, n)`** → `Array`
  Splits a compact index into `n` roughly equal chunks (sharing the same `t` array).

### api.js

All API functions accept a `fetchFn` parameter (typically `globalThis.fetch`) and an `options` object for URL/header overrides.

- **`fetchTagIndexes(fetchFn, options?)`** → `Promise<{ oracleIndex, illustrationIndex, oracleTagNames, artTagNames }>`
  Resolves both Scryfall bulk-data download URLs, fetches the tag datasets, and builds reverse indexes. Options: `{ oracleUrl, illustrationUrl, headers }`.

- **`fetchCard(set, cn, fetchFn, options?)`** → `Promise<{ oracleId, illustrationId }>`
  Fetches a single card by set code and collector number. Options: `{ apiUrl, headers }`.

- **`fetchCardByName(name, fetchFn, options?)`** → `Promise<{ oracleId, illustrationId }>`
  Fetches a card by exact name. Options: `{ apiUrl, headers }`.

- **`fetchCardCollection(cards, fetchFn, options?)`** → `Promise<Map<string, { oracleId, illustrationId }>>`
  Batch-fetches cards via the Scryfall collection endpoint. Automatically handles batching (75 cards/request) and rate limiting. Options: `{ apiUrl, headers, batchSize, delayMs }`.

## Usage

```js
import { fetchCard, fetchTagIndexes } from './scryfall/index.js';

// Fetch tag indexes (in a service worker or Node.js)
const { oracleIndex, illustrationIndex } = await fetchTagIndexes(fetch);

// Look up a specific card
const { oracleId, illustrationId } = await fetchCard('neo', '234', fetch);
const artTags = illustrationIndex.get(illustrationId) || [];
const cardTags = oracleIndex.get(oracleId) || [];
```

```js
// Node.js script usage with custom headers
import { fetchCardCollection } from './scryfall/api.js';

const cards = [{ set: 'neo', cn: '234' }, { set: 'mom', cn: '1' }];
const results = await fetchCardCollection(cards, fetch, {
  headers: { 'User-Agent': 'MyApp/1.0' },
});
```
