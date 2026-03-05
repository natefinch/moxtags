# MoxTags — Design & Implementation

This document describes the architecture, data flow, and implementation details
of the MoxTags Chrome extension. It is intended for developers maintaining the
code and for AI tools that need to understand how the system works.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Extension Manifest & Execution Contexts](#extension-manifest--execution-contexts)
- [Startup & Initialization Flow](#startup--initialization-flow)
- [Deck Data Acquisition](#deck-data-acquisition)
- [Tag Data Pipeline](#tag-data-pipeline)
- [Card Identity Resolution](#card-identity-resolution)
- [Menu Detection & Tag Injection](#menu-detection--tag-injection)
- [UI Rendering](#ui-rendering)
- [SPA Navigation Handling](#spa-navigation-handling)
- [Popup UI](#popup-ui)
- [Message Protocol](#message-protocol)
- [External API Contracts](#external-api-contracts)
- [Data Flow Diagram](#data-flow-diagram)
- [Key Design Decisions](#key-design-decisions)

---

## Architecture Overview

MoxTags is a Manifest V3 Chrome extension with four execution contexts:

1. **MAIN world content script** (`page_hook.js`) — runs in the page's own
   JavaScript context to intercept Moxfield API responses.
2. **ISOLATED world content script** (`content.js`) — runs in the extension's
   isolated context on Moxfield deck pages; handles deck parsing, menu
   detection, and UI injection.
3. **Background service worker** (`background.js`) — manages Scryfall tag data
   caching, card identity resolution, and acts as a proxy for cross-origin
   fetches.
4. **Popup** (`popup.html` + `popup.js`) — toolbar button UI that displays
   cache status and provides a manual refresh control.

These contexts communicate via two mechanisms:
- **DOM-based message passing** between `page_hook.js` (MAIN world) and
  `content.js` (ISOLATED world) using a hidden DOM element and an HTML
  attribute as a signaling flag.
- **`chrome.runtime.sendMessage`** between `content.js`/`popup.js` and the
  background service worker.

---

## Extension Manifest & Execution Contexts

Defined in [manifest.json](manifest.json):

### Content Scripts

Two content script entries are registered, both matching Moxfield deck pages
(`https://moxfield.com/decks/*` and `https://www.moxfield.com/decks/*`):

1. **`page_hook.js`** ([manifest.json#L17-L24](manifest.json#L17-L24))
   - `run_at: "document_start"` — injected before the page's own scripts run.
   - `world: "MAIN"` — shares the page's JavaScript context, enabling it to
     monkey-patch `window.fetch` and `XMLHttpRequest`.

2. **`content.js` + `styles.css`** ([manifest.json#L25-L34](manifest.json#L25-L34))
   - `run_at: "document_idle"` — injected after the DOM is ready.
   - Runs in the default ISOLATED world, with access to Chrome extension APIs
     (`chrome.runtime.sendMessage`).

### Permissions

- `storage` + `unlimitedStorage` — for persisting Scryfall tag indexes in
  `chrome.storage.local` ([manifest.json#L6-L9](manifest.json#L6-L9)).
- `alarms` — for scheduling daily tag data refresh.
- `host_permissions` for `api2.moxfield.com` and `api.scryfall.com`
  ([manifest.json#L10-L14](manifest.json#L10-L14)) — allows the background
  service worker to make cross-origin requests to both APIs.

### Background Service Worker

`background.js` is registered as the service worker
([manifest.json#L35-L37](manifest.json#L35-L37)). It handles all network
requests to external APIs and manages the tag data cache.

---

## Startup & Initialization Flow

### Background Worker Startup

On `chrome.runtime.onInstalled` and `chrome.runtime.onStartup`
([background.js#L25-L31](background.js#L25-L31)), the worker calls
`scheduleRefresh()` to set up a `chrome.alarms` timer for the next tag data
refresh. Tag indexes are **not** loaded at startup — they are loaded lazily on
the first `fetchTags` or `prefetchDeck` call via `ensureIndexes()`
([background.js#L219-L240](background.js#L219-L240)).

### Page Hook Startup

`page_hook.js` runs at `document_start` in the MAIN world. On load, it
immediately:
1. Saves references to the original `window.fetch` and
   `XMLHttpRequest.prototype.open`
   ([page_hook.js#L89](page_hook.js#L89),
    [page_hook.js#L131](page_hook.js#L131)).
2. Replaces them with wrapper functions that intercept responses matching the
   deck API URL pattern `/v[23]/decks/all/<id>`
   ([page_hook.js#L12](page_hook.js#L12)).
3. Sets up a `MutationObserver` to detect when the content script resets the
   `data-moxtags-deck` attribute (for SPA navigation)
   ([page_hook.js#L166-L183](page_hook.js#L166-L183)).

### Content Script Startup

`content.js` runs at `document_idle` in the ISOLATED world. The `init()`
function ([content.js#L22-L45](content.js#L22-L45)):
1. Extracts the deck ID from the URL via `extractDeckId()`
   ([content.js#L66-L69](content.js#L66-L69)).
2. Calls `fetchDeckData()` to load the card list (see
   [Deck Data Acquisition](#deck-data-acquisition)).
3. Registers a `mousedown` listener on the document for card click tracking
   ([content.js#L31](content.js#L31)).
4. Creates a `MutationObserver` on `document.body` to detect dynamically
   inserted context menus
   ([content.js#L34-L42](content.js#L34-L42)).
5. Starts a URL-polling interval via `watchNavigation()` for SPA navigation
   detection ([content.js#L44](content.js#L44)).

---

## Deck Data Acquisition

The content script needs each card's `set` code and `collector_number` (`cn`)
to look up tags. This data comes from the Moxfield deck API response.
`fetchDeckData()` ([content.js#L147-L196](content.js#L147-L196)) uses two
strategies in parallel:

### Strategy 1: Direct API Fetch (Public Decks)

The content script asks the background worker to fetch the deck JSON from
Moxfield's public API. It tries two URL versions sequentially:
- `https://api2.moxfield.com/v3/decks/all/<deckId>`
- `https://api2.moxfield.com/v2/decks/all/<deckId>`

These are unauthenticated requests (`credentials: 'omit'`), proxied through
the background worker's `doFetch()` function
([background.js#L89-L102](background.js#L89-L102)) because content scripts
cannot make cross-origin requests directly. The content script communicates
with the worker via `bgFetch()` ([content.js#L698-L710](content.js#L698-L710)),
sending a `{ type: 'fetch', url }` message.

### Strategy 2: Intercepted Response (Private Decks)

Simultaneously with Strategy 1, the content script starts waiting for
intercepted deck data via `waitForInterceptedDeck()`
([content.js#L98-L143](content.js#L98-L143)). This sets up a
`MutationObserver` watching for the `data-moxtags-deck` attribute on `<html>`
to become `"ready"`, with a 12-second timeout.

When Moxfield's own JavaScript fetches the deck (using the user's auth), the
monkey-patched `fetch`/`XHR` in `page_hook.js` clones the response, parses it,
validates it looks like deck data via `checkAndPublish()`
([page_hook.js#L55-L84](page_hook.js#L55-L84)), and stores the JSON in a
hidden `<script id="moxtags-deck-json" type="application/json">` element
([page_hook.js#L22-L52](page_hook.js#L22-L52)). It then sets
`data-moxtags-deck="ready"` on `<html>`.

The content script's `readInterceptedDeck()`
([content.js#L76-L93](content.js#L76-L93)) reads the JSON from that DOM
element.

**Important:** No authentication tokens, cookies, or headers are captured or
forwarded. Only the **response body** (deck JSON) is read.

### Strategy Selection

If Strategy 1 succeeds (public deck), the intercepted data is ignored. If
Strategy 1 fails (403 for private deck), the content script falls back to the
intercepted data from Strategy 2. If both fail after the timeout, deck data
loading fails and tag injection will not work.

### Building the Card Map

Once deck JSON is obtained (from either strategy), `buildCardMap()`
([content.js#L205-L283](content.js#L205-L283)) walks all boards in the
response and populates the `cardMap` (`Map<lowercase card name, { name, set, cn }>`).

It handles two API response shapes:
- **v2:** Boards are top-level properties; entries have a `.card` wrapper
  (e.g. `{ card: { name, set, cn }, quantity }`)
- **v3:** Boards may be nested under `data.boards`; entries can be flat card
  objects or wrapped.

The recognized board names are: `mainboard`, `sideboard`, `commanders`,
`companions`, `signatureSpells`, `considering`, `attractions`, `stickers`,
`contraptions`, `planes`, `schemes`, `tokens`
([content.js#L211-L215](content.js#L211-L215)).

For double-faced cards (`"Front // Back"`), the front face name is also
added as a key so clicks on truncated card names still resolve
([content.js#L273-L277](content.js#L273-L277)).

---

## Tag Data Pipeline

### Scryfall Tag Indexes

The background worker downloads two bulk tag files from Scryfall's private API:
- `https://api.scryfall.com/private/tags/oracle` — card/oracle tags
- `https://api.scryfall.com/private/tags/illustration` — art/illustration tags

These are defined as constants at
[background.js#L4-L5](background.js#L4-L5).

Each file contains an array of tag objects, where each tag has a `label`
(string) and an array of IDs (`oracle_ids` or `illustration_ids`) that the
tag applies to.

### Reverse Index Construction

`refreshTagData()` ([background.js#L249-L289](background.js#L249-L289))
fetches both files, then calls `buildReverseIndex()`
([background.js#L297-L313](background.js#L297-L313)) to invert them:

- Input: `[ { label: "ramp", oracle_ids: ["uuid1", "uuid2", ...] }, ... ]`
- Output: `Map<"uuid1", [{ name: "ramp", slug: "ramp" }]>`,
  `Map<"uuid2", [{ name: "ramp", slug: "ramp" }]>`, etc.

Two indexes are built:
- `oracleIndex`: `oracle_id → [{ name, slug }]`
- `illustrationIndex`: `illustration_id → [{ name, slug }]`

### Persistence

The indexes are serialized as arrays of `[key, value]` entries and stored in
`chrome.storage.local` along with a `tagDataTimestamp`
([background.js#L278-L284](background.js#L278-L284)). On subsequent loads,
`ensureIndexes()` restores them from storage without re-fetching
([background.js#L225-L237](background.js#L225-L237)).

### Refresh Schedule

`scheduleRefresh()` ([background.js#L321-L329](background.js#L321-L329))
creates a `chrome.alarms` timer for 24 hours + 0–60 minutes of random jitter.
When the alarm fires ([background.js#L331-L339](background.js#L331-L339)), the
indexes are refreshed and a new alarm is scheduled. On failure, a retry is
scheduled in 1 hour.

Stale data is also detected opportunistically: when `ensureIndexes()` loads
data from storage, it checks the age against `REFRESH_INTERVAL_MS` (24 hours)
and triggers a non-blocking background refresh if the data is too old
([background.js#L233-L237](background.js#L233-L237)).

---

## Card Identity Resolution

### The Problem

The Scryfall tag indexes are keyed by `oracle_id` and `illustration_id`, but
Moxfield deck data only provides `set` and `collector_number` for each card.
A translation step is needed.

### Batch Prefetch

After `buildCardMap()` succeeds, `prefetchAllTags()`
([content.js#L287-L312](content.js#L287-L312)) collects all unique
`{ set, cn }` pairs from the card map and sends them to the background
worker as a `prefetchDeck` message.

The background worker's `prefetchDeck()`
([background.js#L142-L210](background.js#L142-L210)):

1. Filters out cards already in `cardIdCache` (in-memory `Map<"set/cn",
   { oracleId, illustrationId }>` at
   [background.js#L21](background.js#L21)).
2. Batches remaining cards into groups of 75 (Scryfall's collection endpoint
   limit).
3. POSTs each batch to `https://api.scryfall.com/cards/collection` with
   `{ identifiers: [{ set, collector_number }] }`
   ([background.js#L163-L167](background.js#L163-L167)).
4. Caches the `oracle_id` and `illustration_id` from each response card into
   `cardIdCache` ([background.js#L175-L181](background.js#L175-L181)).
5. Waits 100ms between batches to respect Scryfall's rate-limiting guidance
   ([background.js#L189-L191](background.js#L189-L191)).
6. Resolves tags for all requested cards against the cached indexes and
   returns the result as `{ ok: true, tags: { "set/cn": { artTags, cardTags } } }`
   ([background.js#L196-L210](background.js#L196-L210)).

The content script stores these resolved tags in `tagCache`
([content.js#L302-L305](content.js#L302-L305)), so subsequent menu opens are
instant.

### Single-Card Fallback

If a card was not covered by the batch prefetch (e.g. the prefetch failed or
the card was missed), `fetchTags()`
([background.js#L104-L135](background.js#L104-L135)) fetches a single card
from `https://api.scryfall.com/cards/<set>/<cn>` to resolve its IDs on demand.

---

## Menu Detection & Tag Injection

### Click Tracking

The content script listens for `mousedown` events on the document
([content.js#L31](content.js#L31)). When fired, `onMouseDown()`
([content.js#L315-L323](content.js#L315-L323)) calls `identifyCard()`,
which walks up the DOM from the click target (up to 15 levels), scanning
each ancestor's children for text that exactly matches a card name in
`cardMap` ([content.js#L330-L339](content.js#L330-L339),
[content.js#L341-L350](content.js#L341-L350)). If found, `currentCard` is
set to that card's `{ name, set, cn }` info.

### Menu Detection — Three Layers

Moxfield renders context menus dynamically (likely via React portals). The
extension uses three detection strategies:

#### 1. MutationObserver (primary)

The observer registered at init time
([content.js#L34-L42](content.js#L34-L42)) watches `document.body` for:
- `childList` changes (new nodes added)
- `attributes` changes on `class`, `style`, `aria-hidden`, `hidden`

The `onMutations()` handler ([content.js#L353-L366](content.js#L353-L366))
scans added nodes and attribute-changed targets via `scanForMenu()`, which
checks the element and its descendants, then walks up to parents
([content.js#L368-L389](content.js#L368-L389)).

#### 2. Click Polling (fallback)

A `click` listener ([content.js#L434-L439](content.js#L434-L439)) fires
`pollForMenu()` at 100ms, 300ms, and 600ms delays to catch menus that the
`MutationObserver` might miss. It searches using targeted CSS selectors
(`[role="menu"]`, `[data-radix-popper-content-wrapper]`, class-name
patterns, etc.) and a broader body-child walk
([content.js#L441-L468](content.js#L441-L468)).

#### 3. Smallest-Menu Refinement

`findSmallestMenu()` ([content.js#L475-L483](content.js#L475-L483))
recursively finds the most specific (deepest) element that matches the menu
heuristic, avoiding injection into an overly broad parent container.

### Menu Heuristic

`isCardMenu()` ([content.js#L407-L420](content.js#L407-L420)) identifies a
card context menu by checking whether an element's `textContent` contains
at least 3 of these known Moxfield menu item strings
([content.js#L398-L405](content.js#L398-L405)):
- "Switch Printing", "Change Tags", "View Details", "Copy Card Name",
  "Change Mana Cost", "Set as Deck Image", "Add One", "Remove"

Elements with too-short (<20 chars) or too-long (>8000 chars) text, or
elements that are part of a previously injected MoxTags section
(`.moxtags-injected`, `.moxtags-submenu`), are excluded.

### Tag Injection

`injectTagsIntoMenu()` ([content.js#L486-L542](content.js#L486-L542)):
1. Debounces via the `injecting` flag to prevent multiple simultaneous
   injections.
2. Removes any previous `.moxtags-injected` elements from the menu.
3. Finds the "Buy on Mana Pool" menu item as an insertion anchor via
   `findAnchorItem()` ([content.js#L549-L563](content.js#L549-L563)),
   falling back to the menu's last child.
4. Creates a wrapper `<div class="moxtags-injected">` with a divider and
   a "Loading tags…" indicator.
5. Inserts the wrapper after the anchor element.
6. Sets up a cleanup observer that resets the `injecting` flag when the
   menu is removed from the DOM
   ([content.js#L516-L521](content.js#L516-L521)).
7. Looks up tags from `tagCache`; if missing, calls `loadTags()` which
   sends a `fetchTags` message to the background worker
   ([content.js#L566-L583](content.js#L566-L583)).
8. Replaces the loader with rendered tag submenus via `renderSubmenus()`.

---

## UI Rendering

### Submenu Structure

`renderSubmenus()` ([content.js#L586-L600](content.js#L586-L600)) creates
up to two submenu triggers — "Art Tags" (prefix `art`) and "Card Tags"
(prefix `otag`) — or a "No tags found" message if both are empty.

`buildSubmenuTrigger()` ([content.js#L602-L688](content.js#L602-L688))
builds each trigger as:

```
<div class="moxtags-trigger">
  <span class="moxtags-trigger-label">Art Tags</span>
  <span class="moxtags-trigger-arrow">▸</span>
  <span class="moxtags-trigger-count">(5)</span>
  <div class="moxtags-submenu">
    <button class="moxtags-search-btn" style="display:none">Search</button>
    <div class="moxtags-tag-row">
      <input type="checkbox" class="moxtags-tag-cb">
      <a class="moxtags-tag-item" href="...">tag-name</a>
    </div>
    ...
  </div>
</div>
```

### Search Links

Each individual tag link navigates to the current deck's search page:
`{deckUrl}/search?q={prefix}:{slug}` (e.g.
`/decks/abc123/search?q=otag:ramp`).

The multi-select "Search (N)" button combines all checked tags:
`{deckUrl}/search?q={prefix}:{slug1} {prefix}:{slug2} ...`
([content.js#L645-L649](content.js#L645-L649)).

### Flyout Positioning

`positionSubmenu()` ([content.js#L690-L708](content.js#L690-L708))
positions the flyout submenu on `mouseenter`:
- Default: opens to the right (`left: 100%`).
- Flips to left (`right: 100%`) if it would overflow the viewport width.
- Shifts upward if it would overflow the viewport height.

### Styles

All injected styles are defined in [styles.css](styles.css). The design uses
a dark theme to match Moxfield's UI:
- Semi-transparent white text on dark backgrounds (`#2b2b2b`)
- Purple accent color for checkboxes and the search button (`#5b21b6` /
  `#7c3aed`)
- Thin custom scrollbar for the submenu
- Hover highlights via `rgba(255, 255, 255, 0.08)` backgrounds

---

## SPA Navigation Handling

Moxfield is a single-page application, so navigating between decks doesn't
trigger a full page reload.

### Content Script Side

`watchNavigation()` ([content.js#L714-L721](content.js#L714-L721)) polls
`location.href` every 1 second. When the URL changes:
1. `cleanup()` ([content.js#L47-L64](content.js#L47-L64)) disconnects the
   MutationObserver, removes event listeners, clears all state maps, removes
   the stale `moxtags-deck-json` element, and removes the
   `data-moxtags-deck` attribute from `<html>`.
2. `init()` re-runs for the new deck ID.

### Page Hook Side

The page hook sets up its own `MutationObserver`
([page_hook.js#L166-L183](page_hook.js#L166-L183)) watching for the removal
of the `data-moxtags-deck` attribute. When content.js removes it during
cleanup, the hook resets its `deckDataPublished` flag, allowing it to
intercept the next deck's API response.

---

## Popup UI

The toolbar popup ([popup.html](popup.html) + [popup.js](popup.js)) provides
a status display for the tag data cache.

### Status Indicator

`renderStatus()` ([popup.js#L42-L96](popup.js#L42-L96)) sets the dot color
based on the background worker's state:
- **Green (`.ready`):** Tag data is cached; shows download timestamp.
- **Yellow pulsing (`.loading`):** Tag data is currently being downloaded.
- **Grey (`.unknown`):** No tag data has been cached yet.
- **Red (`.error`):** Cannot communicate with the background worker.

### Refresh Button

Clicking "Refresh tag data now" sends a `refreshTags` message to the
background worker, then polls via `pollUntilReady()`
([popup.js#L18-L28](popup.js#L18-L28)) at 800ms intervals until
`resp.refreshing` becomes false.

---

## Message Protocol

All messages use `chrome.runtime.sendMessage` with a `type` field.

| Message Type     | Sender        | Receiver   | Payload                                  | Response                                         |
|------------------|---------------|------------|------------------------------------------|--------------------------------------------------|
| `fetch`          | `content.js`  | `background.js` | `{ url, options? }`                 | `{ ok, body?, error?, status? }`                 |
| `fetchTags`      | `content.js`  | `background.js` | `{ set, number }`                   | `{ ok, artTags?, cardTags?, error? }`            |
| `prefetchDeck`   | `content.js`  | `background.js` | `{ cards: [{ set, cn }] }`          | `{ ok, tags?: { "set/cn": { artTags, cardTags } }, error? }` |
| `getStatus`      | `popup.js`    | `background.js` | (none)                               | `{ refreshing, tagDataTimestamp, oracleCount, illustrationCount, lastError }` |
| `refreshTags`    | `popup.js`    | `background.js` | (none)                               | `{ ok, error? }`                                 |

All message handlers in [background.js#L35-L73](background.js#L35-L73)
return `true` from the `onMessage` listener to indicate asynchronous
`sendResponse` usage.

---

## External API Contracts

### Moxfield Deck API

- **Base URL:** `https://api2.moxfield.com`
- **Endpoints used:**
  - `GET /v3/decks/all/{deckId}` (tried first)
  - `GET /v2/decks/all/{deckId}` (fallback)
- **Auth:** Unauthenticated (public decks only). For private decks, the
  response is read from Moxfield's own authenticated fetch via interception.
- **Response shape:** JSON object containing board properties (`mainboard`,
  `sideboard`, `commanders`, etc.), each containing card entries with `name`,
  `set`, and `cn`/`collector_number` fields.

### Scryfall Tag Data API

- **Oracle tags:** `GET https://api.scryfall.com/private/tags/oracle`
- **Illustration tags:** `GET https://api.scryfall.com/private/tags/illustration`
- **Response shape:** `{ data: [{ label: string, oracle_ids|illustration_ids: string[] }] }`
- **Size:** ~5 MB combined.

### Scryfall Card Collection API

- **Endpoint:** `POST https://api.scryfall.com/cards/collection`
- **Body:** `{ identifiers: [{ set, collector_number }] }` (max 75 per request)
- **Response:** `{ data: [{ set, collector_number, oracle_id, illustration_id, ... }] }`
- **Rate limit:** 50–100ms between requests (extension uses 100ms).

### Scryfall Single Card API (fallback only)

- **Endpoint:** `GET https://api.scryfall.com/cards/{set}/{collector_number}`
- **Used when:** A card is not in the prefetch cache (edge case / fallback).

---

## Data Flow Diagram

```
┌────────────────────────────────────────────────────────────┐
│                    Moxfield Deck Page                       │
│                                                             │
│  ┌──────────────────┐     DOM element     ┌──────────────┐ │
│  │  page_hook.js    │ ──────────────────► │  content.js   │ │
│  │  (MAIN world)    │  <script> + attr    │  (ISOLATED)   │ │
│  │                  │                      │               │ │
│  │  Intercepts      │                      │  Reads deck   │ │
│  │  fetch/XHR       │                      │  Detects menu │ │
│  │  responses       │                      │  Injects tags │ │
│  └──────────────────┘                      └───────┬───────┘ │
│                                                     │        │
└─────────────────────────────────────────────────────┼────────┘
                                                      │
                                     chrome.runtime.sendMessage
                                                      │
                                                      ▼
                                          ┌───────────────────┐
                                          │  background.js     │
                                          │  (Service Worker)  │
                                          │                    │
                                          │  • Proxy fetch     │
                                          │  • Tag indexes     │
                                          │  • Card ID cache   │
                                          │  • Batch prefetch  │
                                          └────────┬──────────┘
                                                   │
                                              fetch()
                                                   │
                               ┌───────────────────┼───────────────────┐
                               ▼                   ▼                   ▼
                      ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
                      │ Moxfield API │   │ Scryfall     │   │ Scryfall     │
                      │ (deck data)  │   │ /tags/*      │   │ /cards/*     │
                      └──────────────┘   └──────────────┘   └──────────────┘
```

---

## Key Design Decisions

### Why two content scripts in different worlds?

`page_hook.js` must run in the MAIN world to monkey-patch `window.fetch` and
`XMLHttpRequest`, since the ISOLATED world has its own copies of these globals.
However, MAIN world scripts cannot use Chrome extension APIs. `content.js`
runs in the ISOLATED world to access `chrome.runtime.sendMessage` for
communicating with the background worker. The two scripts communicate through
the DOM, which is shared across worlds.

### Why intercept responses instead of capturing auth tokens?

The extension only reads **response bodies**, never request headers or auth
tokens. This avoids security and ToS concerns while still supporting private
decks. The page already has the deck data — the extension simply reads a copy
of it.

### Why use a background worker as a fetch proxy?

Content scripts in the ISOLATED world are subject to the page's
Content-Security-Policy and cannot make cross-origin requests to
`api2.moxfield.com` or `api.scryfall.com`. The background service worker has
its own origin and can make these requests freely, governed only by
`host_permissions` in the manifest.

### Why cache tag data locally instead of querying per-card?

Scryfall's bulk tag files contain every tag for every card. Downloading them
once (~5 MB) and building in-memory indexes means that tag lookups are a
simple `Map.get()` — no network round-trip needed when opening a context menu.
The trade-off is storage space and an initial download, which is acceptable
given the `unlimitedStorage` permission.

### Why batch prefetch card IDs?

Moxfield provides `set/collector_number` but the tag indexes are keyed by
`oracle_id`/`illustration_id`. Scryfall's `/cards/collection` endpoint
resolves up to 75 cards per request. Prefetching the entire deck at load time
(rather than per-card on menu open) ensures that opening any card's context
menu is instant. For a 100-card deck, this requires only 2 batch requests.

### Why three menu detection strategies?

Moxfield uses React, which can insert elements via portals that may not
trigger `MutationObserver` in all cases. The three-layer approach
(MutationObserver → click polling with targeted selectors → body-child walk)
provides robust detection across different React rendering paths and timing.
