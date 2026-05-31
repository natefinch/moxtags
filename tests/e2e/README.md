# Webpage E2E tests

These Playwright tests load the built Chrome extension in Chromium and exercise the real content scripts, page hook, background service worker, runtime messaging, DOM mutation observers, and Scryfall tag lookup flow against deterministic fixture pages.

Run them with:

```bash
npm run test:e2e
```

That command rebuilds `dist/chrome/` before launching Chromium.

## Harness

`extension-fixture.js` starts Chromium with `dist/chrome/` installed as an MV3 extension. Each test gets a fresh persistent browser profile so extension storage, service workers, and page state do not leak between tests.

The tests install a catch-all network guard before installing deterministic routes. Playwright invokes route handlers in reverse registration order, so the mocked fixture routes win and every unmocked page or service-worker request is recorded as a failure. This keeps the suite offline and proves that code paths under test are using the expected mocked APIs.

## Mocked data

`playwright-foundation.spec.js` serves small fixture pages for:

- Moxfield owned deck, public deck preview, search Options dropdown, long-layout search result, and card page.
- Archidekt deck page, card menus, card details overlay, and native Syntax Search overlay.
- Scryfall card page and search results page.

The Scryfall API routes return deterministic card identities and tag indexes:

- `card-tag` is tied to the first test card's oracle ID.
- `art-tag` is tied to the first test card's illustration ID.
- `second-card-tag` and `second-art-tag` are tied to the second Scryfall search-result card.

## What the tests cover

| Test | What it proves |
| --- | --- |
| `loads the built extension on a manifest-matched Moxfield origin` | The built extension loads on Moxfield, the page hook and isolated content script both run, deck JSON is captured/proxied, and the extension ID/service worker are available. |
| `mocks background service-worker fetches through the real runtime message handler` | Extension pages can call the background script through `chrome.runtime.sendMessage`, and background fetches are intercepted by the deterministic route layer. |
| `injects card and art tags into an owned-deck context menu only` | Moxfield owned-deck right-click menus get one tag injection in the menu, not in the preview panel, and menu rescans do not duplicate injected UI. |
| `injects card and art tags into the public deck preview panel only` | Public deck preview panels get the preview tag controls, while absent dropdown menus do not receive stray menu injections. |
| `injects into a Moxfield search result Options dropdown without duplicates` | Search-result Options dropdowns resolve exact printing identity from the View Details link, inject after `Buy on Mana Pool`, and avoid duplicate injection after mutations. |
| `injects long-layout Art/Card tag buttons and lazily renders tag menu` | Moxfield long-layout search rows get Art Tags/Card Tags buttons after More Options, lazily fetch/render the selected tag menu, toggle it closed/open, and avoid duplicate surface injection. |
| `injects card-page tag sections before Format Legalities` | Moxfield card pages render collapsible Card Tags and Art Tags sections in the expected location before Format Legalities with the expected tag links. |
| `injects Archidekt right-click menu tags and opens native Syntax Search` | Archidekt right-click card menus resolve image-alt identity, insert tag submenus before the native footer, fetch tags through the background, and clicking an art tag opens/populates the native Syntax Search overlay. |
| `injects Archidekt image and text menu variants without duplicates or name fallback` | Archidekt image/stack and text-view three-dot menus are recognized, text-view identity resolves through deck data, menu mutations do not duplicate injections, and unknown text cards do not silently fall back to name lookup. |
| `injects Archidekt card details sections before Legalities` | Archidekt card details overlays resolve exact card identity from the overlay image and insert collapsed Card Tags/Art Tags sections immediately before the Legalities row. |
| `appends Archidekt search-result tag queries without duplicate tokens` | Archidekt card menus opened inside the Card Search overlay append tag tokens to the existing Syntax Search query and do not duplicate an already-present exact tag token. |
| `injects Scryfall card-page tag sections after the artist credit` | Scryfall card pages resolve identity from the URL, inject after the artist credit, render Card Tags/Art Tags links, and clicking a tag appends the right token to Scryfall's header search field. |
| `network guard reports unmocked page and service-worker requests` | The guard catches unexpected network requests from both normal page fetches and MV3 service-worker fetches. This is a proof test for the guard itself. |
| `injects Scryfall search-result tag sections with batch fallback and search links` | Scryfall search pages scan multiple card profiles, use one collection batch lookup, fall back to per-card lookup for a missing batch entry, render links only (no checkboxes/search button), append/dedupe search tokens, and propagate collapsible state across matching sections. |

## What these tests intentionally do not cover

- Firefox extension loading. Firefox coverage is tracked separately in `testing-plan.md`.
- Real network behavior against Moxfield, Archidekt, or Scryfall. The suite is intentionally deterministic and offline.
- Visual theme differences. The assertions focus on DOM placement, selectors, and user-observable behavior rather than screenshots.
