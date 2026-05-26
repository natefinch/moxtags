# cache

Storage and caching layer for persisting extension data in `chrome.storage.local`. Domain-aware — understands the shapes of tag indexes, card maps, and Moxfield ID caches — but agnostic about where the data comes from.

## Files

| File | Purpose |
|------|---------|
| `storage.js` | Promisified `chrome.storage.local` wrapper |
| `tag-index.js` | Persist and load Scryfall tag indexes with staleness check |
| `card-map.js` | Persist and load extra card map entries (beyond the bundled data) |
| `mox-ids.js` | Persist Moxfield card ID → set/cn mappings with debounced writes |
| `refresh.js` | Schedule and handle `chrome.alarms` for periodic data refresh |
| `index.js` | Public API — re-exports from all modules |

## API

### storage.js

Low-level promisified wrappers around `chrome.storage.local`:

- **`get(keys)`** → `Promise<Object>` — Read one or more keys.
- **`set(items)`** → `Promise<void>` — Write key/value pairs.
- **`remove(keys)`** → `Promise<void>` — Delete one or more keys.

### tag-index.js

- **`loadTagIndexes()`** → `Promise<{ oracleIndex, illustrationIndex, oracleTagNames, artTagNames, timestamp } | null>`
  Loads cached tag indexes from storage and expands compact format back into Maps. Returns `null` if no cached data exists.

- **`saveTagIndexes({ oracleIndex, illustrationIndex, oracleTagNames, artTagNames })`** → `Promise<void>`
  Compacts and saves tag indexes with a timestamp.

- **`isStale(timestamp, maxAge)`** → `boolean`
  Returns `true` if the cached data is older than `maxAge` ms, or if `timestamp` is null.

### card-map.js

- **`loadCardMapExtras()`** → `Promise<Map<string, { oracleId, illustrationId }>>`
  Loads extra card mappings (cards not in the bundled data) from storage.

- **`saveCardMapExtras(newEntries)`** → `Promise<void>`
  Merges new card entries into the stored extras, avoiding duplicates.

### mox-ids.js

- **`loadMoxIdCache()`** → `Promise<Map<string, { set, cn }>>`
  Loads the Moxfield card ID → set/collector number cache from storage.

- **`createMoxIdPersister(options?)`** → `{ persist, merge }`
  Creates a debounced persistence helper. Options: `{ debounceMs, logFn }`.
  - `persist(cache)` — Schedules a debounced write of the full cache to storage.
  - `merge(cache, newIds)` — Merges new entries into the in-memory cache and persists.

### refresh.js

- **`scheduleRefresh(alarmName, intervalMinutes, jitterMinutes?)`** → `number`
  Creates a `chrome.alarms` alarm with random jitter. Returns the scheduled delay in minutes.

- **`onRefreshAlarm(alarmName, callback, options?)`** → `void`
  Registers an alarm listener that calls `callback()` on fire. Automatically reschedules on success and retries (default: 60 min) on failure. Options: `{ intervalMinutes, retryMinutes, jitterMinutes }`.

## Usage

```js
import {
  loadTagIndexes, saveTagIndexes, isStale,
  scheduleRefresh, onRefreshAlarm,
} from './cache/index.js';

// Load cached tags, refresh if stale
const cached = await loadTagIndexes();
if (!cached || isStale(cached.timestamp, 24 * 60 * 60 * 1000)) {
  const fresh = await fetchTagIndexes(fetch);
  await saveTagIndexes(fresh);
}

// Set up periodic refresh
scheduleRefresh('tag-refresh', 24 * 60);
onRefreshAlarm('tag-refresh', async () => {
  const data = await fetchTagIndexes(fetch);
  await saveTagIndexes(data);
}, { intervalMinutes: 24 * 60, retryMinutes: 60 });
```
