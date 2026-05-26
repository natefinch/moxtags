# moxfield

Reusable package for interacting with [Moxfield](https://www.moxfield.com/) pages — parsing deck data, detecting UI elements, reading intercepted network responses, and proxying API calls.

All functions use **dependency injection** for external state (card maps, logging, selectors) so they can be used outside the MoxTags extension context.

> **Note:** `page_hook.js` (MAIN-world fetch interceptor) is conceptually part of this package but lives at `src/page_hook.js` because it must be copied as-is to the dist directory — it cannot use ES module imports.

## Files

| File | Purpose |
|------|---------|
| `card.js` | Parse Moxfield card IDs from `/cards/{id}-{slug}` hrefs |
| `deck.js` | Build card lookup maps from Moxfield deck JSON |
| `longlayout.js` | Detect and extract card info from search-results "long" layout |
| `constants.js` | Moxfield-specific constants (board names, menu keywords) |
| `dom.js` | DOM utilities — menu detection, card identification, search box |
| `intercept.js` | Read deck data intercepted by the MAIN-world hook script |
| `api.js` | Look up card details via the Moxfield API (proxied through page_hook) |
| `index.js` | Public API — re-exports from all modules |

## API

### card.js

- **`parseCardIdFromHref(href)`** → `string | null`
  Extracts a Moxfield card ID from a `/cards/...` href.

### deck.js

- **`buildCardMap(data, logFn?)`** → `{ cardMap: Map, moxIds: Map } | null`
  Builds lookup maps from Moxfield deck JSON. `logFn` is an optional debug logger.

### longlayout.js

- **`findUnprocessedMoreOptionsButtons(root)`** → `{ button, row }[]`
  Finds unprocessed "More Options" buttons in long-layout search results.

- **`extractCardInfoFromRow(row)`** → `{ moxCardId, cardName }`
  Extracts the card ID and name from a long-layout card row.

### constants.js

- **`BOARD_NAMES`** — Known Moxfield deck board names (`mainboard`, `sideboard`, etc.)
- **`MENU_KEYWORDS`** — Text keywords used to heuristically detect card context menus.

### dom.js

- **`extractDeckId(pathname)`** → `string | null`
  Extracts the deck ID from a URL pathname like `/decks/abc123`.

- **`identifyCard(el, cardMap)`** → `string | null`
  Walks up the DOM from `el`, checking text against `cardMap` to identify a card.

- **`scanForCardName(root, cardMap)`** → `string | null`
  Scans an element subtree for text matching a card name in `cardMap`.

- **`isCardMenu(el, menuKeywords, minHits?)`** → `boolean`
  Heuristically determines whether an element is a Moxfield card context menu.

- **`findSmallestMenu(root, menuKeywords)`** → `Element | null`
  Recursively finds the most specific (smallest) matching menu element.

- **`findAnchorItem(container, text)`** → `Element | null`
  Finds the direct child of `container` whose text content matches `text`.

- **`extractCardIdFromMenu(menu)`** → `string | null`
  Extracts a Moxfield card ID from a dropdown's "View Details" link.

- **`addToSearchAndRun(query, options?)`** → `boolean`
  Appends `query` to the Moxfield search box and clicks the search button. Uses the native `HTMLInputElement` value setter to trigger React state updates. Options: `{ inputSelector, buttonSelector }`.

### intercept.js

- **`readInterceptedDeck(options?)`** → `Object | null`
  Reads intercepted deck JSON from a hidden DOM element. Options: `{ elementId, logFn }`.

- **`waitForInterceptedDeck(options?)`** → `Promise<Object | null>`
  Waits for the MAIN-world hook to signal that deck data is available, using a MutationObserver with timeout. Options: `{ elementId, attrName, timeoutMs, logFn }`.

### api.js

- **`lookupCardByMoxfieldId(cardId, options?)`** → `Promise<{ set, cn } | null>`
  Resolves a Moxfield card ID to its set/collector number by proxying a request through `page_hook.js` via `window.postMessage`. Options: `{ cache, onResolved, timeoutMs, logFn }`.

## Usage

```js
import {
  buildCardMap, extractDeckId, identifyCard,
  findSmallestMenu, readInterceptedDeck,
  MENU_KEYWORDS,
} from './moxfield/index.js';

const deckId = extractDeckId(location.pathname);
const deckJson = readInterceptedDeck({ logFn: console.log });
const { cardMap } = buildCardMap(deckJson, console.log);

const cardName = identifyCard(clickedElement, cardMap);
const menu = findSmallestMenu(portalRoot, MENU_KEYWORDS);
```
