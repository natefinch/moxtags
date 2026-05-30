# MoxTags Testing Plan

This plan tracks how MoxTags test coverage compares to the recommendations in `research/how-to-reliably-test-browser-extensions.md`, and what remains to make the suite even more representative of real browser behavior.

## Current Coverage

MoxTags now implements most of the high-confidence recommendations from the research document.

| Recommendation | Current status |
|---|---|
| Layer 1: pure unit tests | Implemented. `node:test` covers pure helpers, tag logic, card/deck parsing, API utilities, and shared query builders. |
| Layer 2: DOM/linkedom tests | Implemented. DOM helper tests cover Moxfield, Scryfall, Archidekt, injection regressions, MutationObserver behavior, and autocomplete UI. |
| Layer 3: real browser E2E | Started. Playwright loads the built Chrome extension under manifest-matched origins. |
| Build/manifest smoke tests | Implemented via `tests/build-smoke.test.js`. |
| Mock pages under manifest-matched origins | Implemented for initial Moxfield and Scryfall E2E through Playwright routing. |
| Mock extension/background traffic | Implemented and proven via Playwright route handling and real `chrome.runtime.sendMessage`. |
| Moxfield vertical flow | Implemented for owned-deck context menu injection, page hook data, background tag lookup, exact placement, and no preview double-injection. |
| Scryfall browser flow | Implemented for card-page tag section injection and click-to-search behavior. |
| `page_hook.js` fetch/XHR/postMessage tests | Implemented in `tests/page-hook.test.js`. |
| Background service-worker harness | Implemented in `tests/background.test.js`. |
| Tag autocomplete UI tests | Implemented in `tests/tag-autocomplete-ui.test.js`. |
| Stable extension-owned selectors | Started with `data-moxtags-*` attributes on key injected Moxfield and Scryfall UI. |
| CI pipeline | Implemented in `.github/workflows/test.yml` for unit, build smoke, Chromium E2E, and Firefox lint. |
| Firefox validation | Partially implemented via `web-ext lint`; full Firefox browser-flow E2E is not implemented. |
| Cross-browser WebDriver E2E | Not implemented. |
| Broad E2E surface coverage | Partially implemented. Moxfield owned deck and Scryfall card page are covered; Archidekt and additional Moxfield/Scryfall variants remain. |
| Network escape detection | Partially implemented through deterministic routes, but no explicit fail-on-unmocked-external-host guard exists yet. |
| Deterministic extension ID | Not needed yet; E2E discovers the loaded extension ID from the service worker. |
| Retry/flaky annotation policy | Not needed yet; current E2E tests are deterministic and stable. |

## Validation Commands

Use these commands when changing extension code or tests:

```bash
npm run test:unit
npm run test:build
npm run test:e2e
npm run test:firefox-lint
```

`npm run test:e2e` rebuilds the extension and runs Playwright Chromium tests against the built Chrome extension.

## Remaining Work, Prioritized

### 1. Expand Moxfield Chromium E2E Coverage

These are the highest-value next tests because Moxfield is the most complex SPA integration and has the most stateful injection behavior.

- Public/other-user deck preview panel injection.
- Search results Options dropdown injection.
- Search results long-layout standalone Art Tags/Card Tags buttons.
- Moxfield card detail page tag panels.
- Change Tags dialog integration.
- SPA rerender cases:
  - menu DOM replaced after opening.
  - deck search controls render late.
  - repeated MutationObserver scans do not duplicate UI.
  - stale `currentCard`/`lastOptionsCard` state is cleared.
- User-visible tag search behavior:
  - single tag click updates deck search.
  - checkbox multi-select updates deck search.
  - React-safe input updates are recognized by the page.

### 2. Add Archidekt Chromium E2E Coverage

Archidekt behavior is currently well covered by unit/DOM tests, but not by real browser extension tests.

- Right-click card menu under `#contextMenuOverlay`.
- Image/stacks three-dot card menu.
- Text-view three-dot card menu.
- Card details overlay tag sections before Legalities.
- Native Syntax Search overlay flow.
- Search-result query append behavior without duplicate tokens.
- Verify art tags never silently fall back to name lookup.

### 3. Expand Scryfall Chromium E2E Coverage

The card page has a browser smoke test; search-result pages still need real-browser coverage.

- Full search page with multiple `.card-profile` results.
- Batch tag lookup via `prefetchDeck`.
- Missing batch entry fallback behavior.
- Collapsed/expanded state persistence.
- Multiple tag clicks append to the search field without duplicates.
- Verify no checkboxes or search buttons render on Scryfall pages.

### 4. Add Explicit Network Escape Detection

Current E2E uses deterministic routes, but tests should fail if any request escapes to an unmocked external host.

Recommended approach:

- Add a context-level route fallback.
- Allow only:
  - mocked fixture page URLs.
  - mocked `api2.moxfield.com` URLs.
  - mocked `api.scryfall.com` URLs.
  - extension URLs.
  - local static asset URLs if needed.
- Fail the test on unexpected external hosts.

This prevents accidental live-site/API dependencies from creeping into the suite.

### 5. Make `data-moxtags-*` Selectors Systematic

Stable selectors exist on some injected UI, but should be applied consistently.

Add attributes for:

- Moxfield menu injection wrappers.
- Moxfield preview panel wrappers.
- Moxfield long-layout buttons and menus.
- Moxfield card overlay sections.
- Scryfall card/search page sections.
- Archidekt menu flyouts and details sections.
- Trigger type: `art-tags` vs `card-tags`.
- Surface type: `moxfield-menu`, `moxfield-preview`, `moxfield-long-layout`, `scryfall-card`, `archidekt-menu`, etc.

Tests should use these selectors for locating extension-owned UI, while still asserting user-visible behavior and correct placement.

### 6. Add Firefox Browser-Flow E2E

Firefox package linting exists, but real Firefox E2E needs a separate runner.

Options:

- WebdriverIO with `browser.installAddOn()`.
- `web-ext run` plus WebDriver control.

Initial Firefox smoke set:

- Extension loads.
- Scryfall card page injects tags.
- Moxfield owned-deck menu injection works, if origin/mocking strategy supports it.
- Firefox manifest/background differences do not break behavior.

### 7. Extend Background Service Worker Tests

The background harness covers core message handling, but can go deeper into MV3 lifecycle behavior.

- Cold start with populated storage.
- Cache/index reload after global state loss.
- `prefetchDeck` partial failures.
- `refreshTags` success/failure and status state.
- Alarm-triggered refresh.
- Failed lookup does not poison cache.
- Async message handlers return `true` for every async `sendResponse` path.

### 8. Extend `page_hook.js` Tests

Current tests cover fetch, XHR, idempotency, and card lookup proxying. Add hostile timing/order cases:

- Fetch before content script listener is ready.
- Repeated page-hook injection.
- Aborted XHR.
- Fetch rejection.
- Non-JSON deck responses.
- Concurrent card lookup proxy requests.
- Unrelated `postMessage` events ignored.
- Proxy timeout/error propagation.

### 9. Add Release/Package Smoke Tests

Beyond manifest checks, verify distributable artifacts:

- Chrome and Firefox packages include required files.
- Packages exclude source tests, Playwright artifacts, and unrelated repo files.
- Local installation assets remain available.
- `web-ext lint` warnings are tracked intentionally.

## Suggested Execution Order

1. [x] Add network escape detection to the existing Playwright fixture.
2. [x] Expand Moxfield E2E to public deck, search results, long layout, and card page.
3. [x] Add systematic `data-moxtags-*` selectors for the surfaces under test.
4. [x] Add Archidekt E2E.
5. [x] Add Scryfall search-page E2E.
6. [x] Deepen background and page-hook hostile timing tests.
7. [x] Add Firefox WebDriver E2E.
8. [ ] Add release/package smoke tests.

## Current Assessment

The test suite now covers roughly 75-80% of the research recommendations by confidence value. The biggest remaining confidence gap is full Firefox browser-flow E2E. The next highest-value work is broader real-browser E2E coverage across Moxfield, Archidekt, and Scryfall page variants, plus network escape detection to guarantee the suite stays deterministic.
