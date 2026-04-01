# Skill: Build and Verify

## Purpose
Standard workflow after making code changes to MoxTags. Build the extension bundles and run the test suite.

## Commands

### Build
```bash
node build.js
```
Produces IIFE bundles via esbuild:
- `dist/chrome/` — Chrome/Chromium extension
- `dist/firefox/` — Firefox extension

### Test
```bash
node --test tests/*.test.js
```
Runs all test files using Node's built-in test runner. Tests cover shared pure functions in `src/shared/`.

### Combined (preferred)
```bash
node build.js && node --test tests/*.test.js
```
Always run both after changes. Build failures are often caught before test failures.

### Watch mode
```bash
node build.js --watch
```
Rebuilds on file changes. Useful during iterative development — but still run tests manually.

## After Build
Remind the user to **reload the extension** in their browser to pick up the new build. The built files in `dist/` are what the browser loads.

## Test File Locations
| File | Tests |
|------|-------|
| `tests/tags.test.js` | Tag index parsing, tag matching |
| `tests/deck.test.js` | `buildCardMap` from deck JSON |
| `tests/autocomplete.test.js` | `filterAndSortTags`, `parseInput`, `renderCount` |
| `tests/card.test.js` | `parseCardIdFromHref` |

## Adding Tests
Tests are for **pure functions** in `src/shared/`. DOM interaction code in `content.js` is not unit-tested. When adding a new shared function, add corresponding tests in `tests/`.
