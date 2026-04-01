# Skill: Moxfield DOM Inspection

## Purpose
Inspect Moxfield's live DOM structure to understand layout, find insertion points, or debug UI injection issues.

## Constraints
- Moxfield's CSP blocks `unsafe-eval` — **InspectorJake's `run_javascript` will fail**.
- Do NOT attempt `run_javascript` or `Playwright-browser_evaluate` on Moxfield pages.

## Procedure

### 1. Get page overview
Use `Inspector-Jake-get_page_info` to get the ARIA accessibility tree with element refs:
```
Inspector-Jake-get_page_info()
```

### 2. Scope to a specific area
Pass a CSS selector to narrow the tree:
```
Inspector-Jake-get_page_info(selector: ".dropdown-menu.show")
Inspector-Jake-get_page_info(selector: "#deckbox-search")
Inspector-Jake-get_page_info(selector: ".decklist-card")
```

### 3. Take screenshots
Use `Inspector-Jake-capture_screenshot` for visual context:
```
Inspector-Jake-capture_screenshot()                          # viewport
Inspector-Jake-capture_screenshot(selector: ".dropdown-menu") # specific element
```

### 4. Interact with elements
Click elements by ref (from get_page_info) to open menus/popups:
```
Inspector-Jake-click_element(ref: "s1e42")
```

### 5. Check console logs
MoxTags logs with `[MoxTags]` prefix:
```
Inspector-Jake-get_console_logs(types: ["log", "warn", "error"])
```

## Common Selectors
| Element | Selector |
|---------|----------|
| Search box | `#deckbox-search` |
| Deck context menu | `.dropdown-menu.show` |
| Card in deck list | `.decklist-card` |
| Card name (hidden) | `.decklist-card-phantomsearch` |
| Options toggle | `.dropdown-toggle` |
| MoxTags injection | `.moxtags-injected` |
| Tag submenu | `.moxtags-submenu` |
