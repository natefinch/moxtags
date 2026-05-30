// Reproduction test for double-injection bug on owned Moxfield deck pages.
//
// BUG: On an owned deck page, MoxTags injects Art Tags / Card Tags into
// BOTH the right-click context menu AND the card preview panel on the left.
// The preview panel injection is only supposed to happen on PUBLIC decks
// (where there is no context menu). On owned decks, only the context menu
// should receive tags.
//
// This test simulates the full injection flow that content.js performs:
//   1. Build an owned deck page DOM (search box present, preview panel visible)
//   2. Simulate a card mousedown (set currentCard)
//   3. Run the same detection functions content.js uses to find injection targets
//   4. Inject tags into every target found (simulating injectTagsIntoMenu)
//   5. Assert that tags appear in exactly ONE place
//
// Run with: node --test tests/double-injection.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import {
  findCardPreviewActionPanels,
  isCardMenu,
  findSmallestMenu,
  hasDeckSearchControls,
  isPublicDeckActionMenu,
  findAnchorItem,
} from '../src/moxfield/dom.js';
import { MENU_KEYWORDS } from '../src/moxfield/constants.js';

/**
 * Simulate what injectTagsIntoMenu does: append a .moxtags-injected wrapper
 * with Art Tags / Card Tags trigger elements into the insertion container.
 */
function simulateTagInjection(menu, { previewPanel = false } = {}) {
  const doc = menu.ownerDocument;
  const insertionContainer = previewPanel
    ? menu
    : (menu.querySelector(':scope > .dropdown-menu-parent') || menu);

  // Skip if already injected (same guard as the real code).
  if (insertionContainer.querySelector('.moxtags-injected')) return;

  const wrapper = doc.createElement('div');
  wrapper.className = previewPanel
    ? 'moxtags-injected moxtags-preview-injected d-grid gap-2'
    : 'moxtags-injected';
  wrapper.dataset.moxtagsCardKey = 'c21/263';

  const divider = doc.createElement('div');
  divider.className = 'dropdown-divider';
  wrapper.appendChild(divider);

  // Art Tags trigger.
  const artTrigger = doc.createElement('div');
  artTrigger.className = previewPanel
    ? 'btn btn-sm text-start btn-outline btn-outline-primary moxtags-trigger'
    : 'dropdown-item cursor-pointer no-outline moxtags-trigger';
  artTrigger.innerHTML = '<span class="moxtags-trigger-label">Art Tags</span><span class="moxtags-trigger-arrow">▸</span>';
  wrapper.appendChild(artTrigger);

  // Card Tags trigger.
  const cardTrigger = doc.createElement('div');
  cardTrigger.className = artTrigger.className;
  cardTrigger.innerHTML = '<span class="moxtags-trigger-label">Card Tags</span><span class="moxtags-trigger-arrow">▸</span>';
  wrapper.appendChild(cardTrigger);

  // Insert after "Add to Wish List" if found, else append at end.
  const leftCol = insertionContainer.querySelector('.d-flex.flex-nowrap > .d-inline-block:first-child');
  const wishListAnchor = (leftCol && findAnchorItem(leftCol, 'Add to Wish List'))
    || (previewPanel ? findAnchorItem(insertionContainer, 'Add to Wish List') : null);

  if (wishListAnchor) {
    wishListAnchor.after(wrapper);
  } else if (insertionContainer.lastElementChild) {
    insertionContainer.lastElementChild.after(wrapper);
  } else {
    insertionContainer.appendChild(wrapper);
  }
}

/**
 * Build a realistic owned-deck page DOM. Includes:
 * - Deck search box (#deckbox-search) — signals an owned deck
 * - Card preview panel (aside.deckview-image-container with .d-grid)
 * - A card list with decklist-card entries
 * - A visible two-column right-click context menu (dropdown-menu.show)
 */
function buildOwnedDeckPage() {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>
    <!-- Deck search box — indicates an owned deck -->
    <form class="dropdown">
      <input id="deckbox-search" type="search" placeholder="Search for cards">
    </form>

    <!-- Card preview panel on the left — always visible on deck pages -->
    <aside class="deckview-image-container">
      <img alt="Sol Ring" src="https://assets.moxfield.net/cards/card-vPo0V-normal.webp?318604914">
      <div class="d-grid gap-2 mt-4 mx-auto">
        <button class="btn btn-sm btn-outline-primary">
          <span><span>Add to Wish List</span></span>
        </button>
        <a class="btn btn-sm btn-primary" href="#">Buy @ TCGplayer</a>
      </div>
    </aside>

    <!-- Deck card list -->
    <div class="board-container" data-board="mainboard">
      <div class="decklist-card" data-hash="vPo0V">
        <a href="/cards/vPo0V-sol-ring">
          <img class="img-card" alt="Sol Ring" src="card.webp">
        </a>
      </div>
    </div>

    <!-- Two-column right-click context menu (React portal on body) -->
    <div class="dropdown-menu show" style="position: absolute;">
      <div class="dropdown-menu-parent" tabindex="-1">
        <div class="d-flex flex-nowrap">
          <div class="d-inline-block">
            <a class="dropdown-item cursor-pointer no-outline">Add to Another Deck...</a>
            <a class="dropdown-item cursor-pointer no-outline">Add to Collection</a>
            <a class="dropdown-item cursor-pointer no-outline">Add to Wish List</a>
            <a class="dropdown-item cursor-pointer no-outline">Switch Printing</a>
            <a class="dropdown-item cursor-pointer no-outline">Change Tags</a>
            <div class="dropdown-divider"></div>
            <a class="dropdown-item cursor-pointer no-outline">View Details</a>
            <a class="dropdown-item cursor-pointer no-outline">Copy Card Name</a>
          </div>
          <div class="d-inline-block dropdown-column-divider">
            <a class="dropdown-item cursor-pointer no-outline">Add One</a>
            <a class="dropdown-item cursor-pointer no-outline">Remove</a>
            <a class="dropdown-item cursor-pointer no-outline">Set as Deck Image</a>
          </div>
        </div>
      </div>
    </div>
  </body></html>`);

  return document;
}

/**
 * Build a public (other-user) deck page DOM. Identical card preview panel
 * but NO deck search box and a single-column action menu instead of the
 * two-column context menu.
 */
function buildPublicDeckPage() {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>
    <!-- NO deck search box — this is someone else's deck -->

    <!-- Card preview panel on the left -->
    <aside class="deckview-image-container">
      <img alt="Sol Ring" src="https://assets.moxfield.net/cards/card-vPo0V-normal.webp?318604914">
      <div class="d-grid gap-2 mt-4 mx-auto">
        <button class="btn btn-sm btn-outline-primary">
          <span><span>Add to Wish List</span></span>
        </button>
        <a class="btn btn-sm btn-primary" href="#">Buy @ TCGplayer</a>
      </div>
    </aside>
  </body></html>`);

  return document;
}

/**
 * Simulate what content.js onMutations + onMouseDown does: find all
 * injection targets and inject into each one. Returns the count of
 * .moxtags-injected elements in the DOM after injection.
 *
 * This mirrors the content.js scan order:
 *   - scanForMenu(body) → finds context menus via isCardMenu
 *   - scanForCardPreviewPanel(body) → finds preview panels
 */
function runInjectionCycle(document, deckId) {
  const injected = [];

  // Phase 1: scanForMenu — walk all elements looking for card menus.
  // (Simplified: content.js only scans mutation targets, but the polling
  // fallback scans body children. We scan all body descendants.)
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('.moxtags-injected')) continue;
    if (isCardMenu(el, MENU_KEYWORDS)) {
      const menu = findSmallestMenu(el, MENU_KEYWORDS) || el;
      if (!menu.querySelector('.moxtags-injected')) {
        simulateTagInjection(menu);
        injected.push({ type: 'menu', element: menu });
      }
      break; // content.js returns after first menu found
    }
  }

  // Phase 2: scanForCardPreviewPanel — find preview action panels.
  // content.js calls this on every mousedown via pollForCardPreviewPanel().
  const previewPanels = findCardPreviewActionPanels(document.body);
  for (const panel of previewPanels) {
    if (!panel.querySelector('.moxtags-injected')) {
      simulateTagInjection(panel, { previewPanel: true });
      injected.push({ type: 'preview', element: panel });
    }
  }

  return injected;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('owned deck: injection targets', () => {
  it('tags should appear in exactly ONE place after the injection cycle', () => {
    const document = buildOwnedDeckPage();
    const deckId = 'test-deck-id';

    // Sanity: this IS an owned deck page.
    assert.equal(hasDeckSearchControls(document, deckId), true,
      'precondition: page should be detected as an owned deck');

    // Sanity: the context menu IS a card menu.
    const menu = document.querySelector('.dropdown-menu.show');
    assert.ok(isCardMenu(menu, MENU_KEYWORDS),
      'precondition: the two-column dropdown should be detected as a card menu');

    // Run the full injection cycle (simulating content.js behavior).
    const targets = runInjectionCycle(document, deckId);

    // Count all .moxtags-injected elements in the entire page.
    const allInjections = document.querySelectorAll('.moxtags-injected');

    // EXPECTED: Tags should appear in exactly 1 place — the context menu.
    // BUG: Tags currently appear in 2 places — the context menu AND the
    // card preview panel. This test will FAIL until the bug is fixed.
    assert.equal(allInjections.length, 1,
      `Expected exactly 1 injection site (the context menu), but found ${allInjections.length}. ` +
      `Injection targets: ${targets.map(t => t.type).join(', ')}. ` +
      'The card preview panel should NOT receive tags on owned decks.');

    // The single injection should be in the context menu, not the preview panel.
    const menuInjection = menu.querySelector('.moxtags-injected');
    assert.ok(menuInjection, 'The context menu should contain the injected tags');

    const previewPanel = document.querySelector('.deckview-image-container .moxtags-injected');
    assert.equal(previewPanel, null,
      'The card preview panel should NOT contain injected tags on an owned deck');
  });

  it('the injected tags in the context menu should contain Art Tags and Card Tags triggers', () => {
    const document = buildOwnedDeckPage();

    runInjectionCycle(document, 'test-deck-id');

    const menu = document.querySelector('.dropdown-menu.show');
    const wrapper = menu.querySelector('.moxtags-injected');

    // Even if the double-injection bug exists, the menu injection should
    // have the correct structure.
    assert.ok(wrapper, 'injection wrapper should exist in the menu');

    const labels = [...wrapper.querySelectorAll('.moxtags-trigger-label')]
      .map(el => el.textContent);
    assert.ok(labels.includes('Art Tags'), 'should have Art Tags trigger');
    assert.ok(labels.includes('Card Tags'), 'should have Card Tags trigger');
  });
});

describe('public deck: injection targets', () => {
  it('tags should appear in the card preview panel (the only injection target)', () => {
    const document = buildPublicDeckPage();

    // Sanity: this is NOT an owned deck.
    assert.equal(hasDeckSearchControls(document, 'test-deck'), false,
      'precondition: page should NOT be detected as an owned deck');

    // No context menu exists on public deck pages (only the preview panel).
    const menu = document.querySelector('.dropdown-menu.show');
    assert.equal(menu, null, 'precondition: no context menu on public deck');

    // Run injection.
    const targets = runInjectionCycle(document, 'test-deck');

    // On a public deck, the preview panel IS the correct injection target.
    const allInjections = document.querySelectorAll('.moxtags-injected');
    assert.equal(allInjections.length, 1,
      'Expected exactly 1 injection site (the preview panel)');
    assert.equal(targets[0].type, 'preview',
      'The injection target should be the preview panel');

    // Verify it has the preview-panel styling.
    const previewInjection = document.querySelector('.moxtags-preview-injected');
    assert.ok(previewInjection, 'injection should use preview panel styling');
  });
});
