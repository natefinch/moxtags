# Skill: Menu Injection

## Purpose
Add new UI elements to Moxfield's context menus or Options dropdowns.

## Menu Types

### Deck Page Context Menu (two-column, right-click)
- Structure: `div.dropdown-menu.show > div.dropdown-menu-parent > div.d-flex.flex-nowrap > div.d-inline-block` (two children: left and right columns)
- Left column ends with "Add to Wish List"
- Right column ends with "Sell on Card Kingdom"
- **Insert into the left column** after a specific anchor item

### Search Page Options Menu (single-column, button click)
- Structure: `div.dropdown-menu.show > div.dropdown-menu-parent > a, a, a...`
- Ends with "Buy on Mana Pool"
- Insert after "Buy on Mana Pool" or fall back to last child

## Procedure

### 1. Find the insertion point
Use `findAnchorItem(container, text)` to locate a menu item by its visible text:
```js
const leftCol = menu.querySelector('.d-flex.flex-nowrap > .d-inline-block:first-child');
const anchor = leftCol && findAnchorItem(leftCol, 'Add to Wish List');
```
For single-column menus:
```js
const anchor = findAnchorItem(menu, 'Buy on Mana Pool');
insertionPoint = anchor || menu.lastElementChild;
```

### 2. Create a wrapper
Always wrap injected elements in a `div.moxtags-injected`:
```js
const wrapper = document.createElement('div');
wrapper.className = 'moxtags-injected';
```
This class is used for cleanup and to prevent re-injection.

### 3. Add a divider
```js
const divider = document.createElement('div');
divider.className = 'moxtags-divider';
wrapper.appendChild(divider);
```

### 4. Insert after the anchor
```js
insertionPoint.after(wrapper);
```

### 5. Clean up on menu close
Set up a MutationObserver to reset state when the menu is removed:
```js
const cleanupObs = new MutationObserver(() => {
  if (!document.body.contains(menu)) {
    cleanupObs.disconnect();
    injecting = false;
    currentCard = null;  // CRITICAL: prevent stale card identity
  }
});
cleanupObs.observe(document.body, { childList: true, subtree: true });
```

## Key Pitfalls

### Stale `currentCard`
The general `mousedown` handler walks up the DOM and can match ANY visible card name — not just the one clicked. Always:
- Clear `currentCard` in the Options-specific mousedown handler
- Prefer `lastOptionsCard` over `currentCard` for portal menus
- Reset `currentCard = null` when menus close

### Debounce with `injecting` flag
Multiple detection paths (MutationObserver, polling, attribute changes) can fire for the same menu. Guard with the `injecting` flag and reset it on cleanup.

### Portal menus
Moxfield renders dropdown menus as React portals appended to `<body>`, not inside the card container. The menu must be matched to a card via tracked state (`lastOptionsCard`), not DOM ancestry.

## Styles
All styles are in `src/styles.css`. Use existing `moxtags-*` CSS classes. The design uses dark theme colors to match Moxfield (`#2b2b2b` backgrounds, `rgba(255,255,255,0.08)` hover).
