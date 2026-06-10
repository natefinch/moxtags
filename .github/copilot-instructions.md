# MoxTags — Copilot Instructions

## Project Overview

MoxTags is a browser extension that injects Scryfall Tagger art/card tags into Moxfield (MTG deck builder) UI elements — context menus, Options dropdowns, tag dialogs, and search autocomplete — as well as Scryfall card/search pages and Archidekt deck card menus/details.

## Architecture

The extension uses content scripts plus a background service worker across different execution contexts:

- **`src/content.js`** — Runs in the **ISOLATED world**. Handles all DOM inspection and injection (menus, dialogs, autocomplete). Communicates with background.js via `chrome.runtime.sendMessage` and with page_hook.js via `window.postMessage`.
- **`src/scryfall_content.js`** — Runs in the **ISOLATED world** on Scryfall card and full search-result pages. Injects card/art tag sections under each `p.card-text-artist` and uses background.js for tag lookup.
- **`src/archidekt_content.js`** — Runs in the **ISOLATED world** on Archidekt deck pages. Injects Archidekt-styled Art Tags/Card Tags flyout submenus into card context menus and collapsed tag sections into card details, using exact printing identity from card image alt text or embedded deck card data.
- **`src/page_hook.js`** — Runs in the **MAIN world** (injected at `document_start`). Intercepts `fetch`/`XHR` to capture deck JSON data. Also proxies Moxfield API calls on behalf of content.js, since it has access to the user's authenticated session cookies.
- **`src/background.js`** — Service worker. Handles Scryfall API calls, tag index caching, and card data lookups.

Shared pure functions live in `src/shared/` (e.g., `autocomplete.js`, `archidekt-page.js`, `scryfall-page.js`, `constants.js`).

## Build & Test

```bash
node scripts/fetch-tags.js # download Scryfall tag data → src/data/ (run before releases)
node build.js              # esbuild IIFE bundles → dist/chrome/ and dist/firefox/
node build.js --watch      # watch mode
node --test tests/*.test.js # run all tests
```

## Moxfield Constraints

### CSP Restrictions
Moxfield's Content Security Policy blocks `unsafe-eval`. This means:
- **InspectorJake's `run_javascript` will fail** on Moxfield pages. Use `get_page_info` and `capture_screenshot` instead.
- Any code evaluation in the page context must go through `page_hook.js` (MAIN world script), not injected `<script>` tags.

### Moxfield API Access
The Moxfield API (`api2.moxfield.com`) is behind Cloudflare WAF. Requests from the background service worker or content script are blocked with 403. **All Moxfield API calls must be proxied through `page_hook.js`** via `postMessage`, which runs in the MAIN world with the user's authenticated session cookies.

### React Input Values
Moxfield is a React app. Setting `input.value` directly does not trigger React state updates. To programmatically change an input value:
```js
const nativeSetter = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype, 'value'
).set;
nativeSetter.call(input, newValue);
input.dispatchEvent(new Event('input', { bubbles: true }));
```

## Moxfield DOM Patterns

### Search Box
- Input: `#deckbox-search` inside `form.dropdown`
- Search button: `button.btn-primary` within the same form

### Deck Page Context Menu (two-column)
```
div.dropdown-menu.show
  div.dropdown-menu-parent
    div.d-flex.flex-nowrap
      div.d-inline-block           ← LEFT column (ends with "Add to Wish List")
      div.d-inline-block.dropdown-column-divider  ← RIGHT column
```
MoxTags injects into the left column after "Add to Wish List".

### Search Page Options Menu (single-column)
```
div.dropdown-menu.show
  div.dropdown-menu-parent
    a "Add to Main Deck"
    ...
    a "Buy on Mana Pool"
```
MoxTags injects after "Buy on Mana Pool", falling back to the last child.

### Search Results Long Layout
```
div.row.justify-content-center
  div.col-12.col-md-auto          ← card image (a[href="/cards/{id}-slug"] > img.img-card)
  div.col-12.col-md               ← card details (h3 > a, type, text, price)
  div.col-9.col-sm-7.col-md-3     ← action buttons
    div.mb-2 > button "Add to Main Deck"
    div.mb-2 > button "Add to Sideboard"
    div.mb-2 > button "Add to Considering"
    button "More Options ▾"
```
MoxTags adds "Art Tags" and "Card Tags" buttons after "More Options", styled with Bootstrap classes (`btn btn-secondary w-100`) to match. Each opens a dropdown popup with tags loaded lazily on first click. Card identity is extracted from the `/cards/{id}-slug` link in the row.

## Card Identity Resolution

Two tracking mechanisms identify which card was clicked:

- **`currentCard`** — Set by the general `mousedown` handler, which walks up the DOM and matches text against `cardMap` (deck cards with known set/collector number).
- **`lastOptionsCard`** — Set by the Options-specific `mousedown` handler on `.dropdown-toggle` clicks, which reads the card name from `.decklist-card-phantomsearch`.

**Important:** Portal menus (appended to `<body>`) must prefer `lastOptionsCard` over `currentCard`. The general handler can incorrectly match ANY visible card name on the page (not just the clicked one). `currentCard` must be cleared when menus close and when the Options button is clicked to prevent stale state.

For search result cards not in the deck, the exact printing is resolved by extracting the Moxfield card ID from the "View Details" link in the dropdown, then proxying a `GET https://api2.moxfield.com/v2/cards/details/{cardId}` call through `page_hook.js`.

## Scryfall Page DOM Patterns

### Card and Full Search Pages
- Card profiles use `.card-profile` and artist credits use `p.card-text-artist`.
- MoxTags injects `section.card-text-box.moxtags-scryfall-tags.moxtags-injected` after the artist credit so Scryfall's native `.card-text-box` spacing applies.
- The injected Card Tags and Art Tags sections are collapsed by default and use `.moxtags-scryfall-chevron` for the disclosure indicator.
- Tag links should keep a real Scryfall search `href`, but clicks append the tag token to `#header-search-field` and dispatch `input`/`change` events.
- Do not render checkboxes or a search button on Scryfall pages; users build a query by clicking multiple tag links.
- Full search-result pages should batch visible card lookups with background `prefetchDeck` and only fall back to `fetchTags` for missing batch entries.

Card identity on Scryfall full search pages comes from `a.print-langs-item.current[href]`, falling back to another `/card/{set}/{collector_number}/...` link inside the same `.card-profile`.

## Archidekt DOM Patterns

### Deck Page Card Context Menu
- Card image alt text uses `Card Name (set) collector-number`, e.g. `Sophia, Dogged Detective (mkc) 8`.
- Text-view rows expose only card names in DOM; resolve those through `__NEXT_DATA__.props.pageProps.redux.deck.cardMap` when the name maps to a unique exact `{ setCode, collectorNumber }`.
- Parse the rightmost `(<set>) <collector>` suffix so names with parentheses and double-faced names still work.
- Card images live under class fragments like `basicCard_container`, `contextMenu_wrapper`, and `deckCardWrapper_container`; match CSS-module class fragments defensively, not full generated class names.
- The right-click card menu is portaled under `#contextMenuOverlay`.
- The right-click card menu panel class includes `deckCardContextMenu_contextMenu`; image/stacks three-dot card menus include `imageCard_extrasMenu`; text-view three-dot card menus include `textViewCard_dropdown`. Do not inject into category/section overflow menus unless a card identity was captured from the triggering card DOM.
- MoxTags injects a divider and two Archidekt-styled flyout submenus above the `Ctrl + Right Click for standard menu` footer when present.
- Tag links and combined checkbox searches should open Archidekt's Card Search overlay, click the `Syntax search` tab, populate the `scryfallSearchForm_input`/`phatInput_input` text input with `otag:`/`art:` syntax, dispatch React-safe input/change events, and submit the native search form.
- If the card menu was opened from a card inside Archidekt search results, append selected tag tokens to the current Syntax Search query instead of replacing it; avoid duplicate exact tokens.
- Do not silently fall back to name lookup for art tags, because name lookup resolves Scryfall's default printing and can show wrong illustration tags.

### Card Details Overlay
- Card details overlays use class fragments like `cardDetailsOverlay_container`; the Card Info tab body contains `cardInfo_extraInfo`.
- Insert `moxtags-archidekt-details-tags` immediately before the child row whose text is `Legalities:`.
- Resolve details identity from the overlay card image alt text first; only fall back to embedded deck data if the visible title maps to a unique exact printing.
- Details tag sections are collapsed Card Tags and Art Tags blocks with tag pills. Clicking a pill should run the same native Archidekt Syntax Search flow as menu tag links.

## Scryfall Tag Prefixes

- **Art tags**: prefix `art:` — Scryfall illustration tags (specific to a card's artwork)
- **Card tags**: prefix `otag:` — Scryfall oracle tags (shared across printings)
- Tag indexes: `api.scryfall.com/bulk-data/oracle_tags` and `.../art_tags`;
  each metadata response provides a `data.scryfall.io` download URL.

## Styling Guidelines

When injecting UI elements, prefer Moxfield's existing Bootstrap utility classes (`btn`, `btn-secondary`, `btn-primary`, `w-100`, `dropdown-menu`, `dropdown-item`, `mt-2`, `ms-1`, etc.) over custom CSS. This keeps injected elements visually consistent with surrounding Moxfield components and adapts to theme changes automatically. Only add custom `moxtags-*` CSS classes for behavior that Bootstrap doesn't cover (positioning, state toggling, scroll constraints).
