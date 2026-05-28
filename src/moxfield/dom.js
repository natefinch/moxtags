// Moxfield page interaction — DOM scraping and interaction utilities.
//
// Generic utilities for reading Moxfield page structure. These functions
// accept dependencies (cardMap, keywords, etc.) as parameters and have
// no knowledge of what the caller does with the results.

import { parseCardIdFromHref } from './card.js';

/**
 * Extract the deck ID from a Moxfield URL pathname.
 *
 * @param {string} pathname - The URL pathname (e.g., "/decks/abc123/").
 * @returns {string|null} The deck ID, or null if not a deck page.
 */
export function extractDeckId(pathname) {
  const m = pathname.match(/\/decks\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/**
 * Walk up from the clicked element and look for an element whose
 * trimmed textContent exactly matches a card name in the card map.
 *
 * @param {Element} el - The DOM element to start from.
 * @param {Map} cardMap - Map of lowercase card name → card info.
 * @returns {string|null} The matched card name, or null.
 */
export function identifyCard(el, cardMap) {
  let node = el;
  for (let i = 0; i < 15 && node && node !== document.body; i++) {
    const found = scanForCardName(node, cardMap);
    if (found) return found;
    node = node.parentElement;
  }
  return null;
}

/**
 * Scan an element and its children for text that matches a card name.
 *
 * @param {Element} root - The DOM element to search within.
 * @param {Map} cardMap - Map of lowercase card name → card info.
 * @returns {string|null} The matched card name text, or null.
 */
export function scanForCardName(root, cardMap) {
  const candidates = [root, ...root.querySelectorAll('a, span, div, td, button')];
  for (const el of candidates) {
    const t = el.textContent?.trim();
    if (t && t.length >= 2 && t.length <= 120 && cardMap.has(t.toLowerCase())) {
      return t;
    }
  }
  return null;
}

/**
 * Check if an element looks like a Moxfield card context menu.
 *
 * @param {Element} el - The DOM element to check.
 * @param {string[]} menuKeywords - Array of text keywords that identify a card menu.
 * @param {number} [minHits] - Minimum keyword hits to consider it a menu (default 3).
 * @returns {boolean}
 */
export function isCardMenu(el, menuKeywords, minHits = 3) {
  const doc = el?.ownerDocument;
  if (!el || el === doc?.body || el === doc?.documentElement) return false;
  if (el.closest?.('.moxtags-injected') || el.closest?.('.moxtags-submenu')) return false;
  const text = el.textContent || '';
  if (text.length < 20 || text.length > 8000) return false;
  let hits = 0;
  for (const kw of menuKeywords) {
    if (text.includes(kw)) hits++;
  }
  return hits >= minHits;
}

/**
 * Find the smallest (most specific) element in the subtree that
 * matches the card-menu heuristic.
 *
 * @param {Element} root - The root element to search.
 * @param {string[]} menuKeywords - Menu keyword array.
 * @returns {Element|null}
 */
export function findSmallestMenu(root, menuKeywords) {
  if (!isCardMenu(root, menuKeywords)) return null;
  for (const child of root.children) {
    const deeper = findSmallestMenu(child, menuKeywords);
    if (deeper) return deeper;
  }
  return root;
}

/**
 * Find public-deck card action panels shown in Moxfield's left card preview.
 *
 * Public decks do not show the editable two-column context menu. Instead,
 * selecting/right-clicking a card updates the persistent preview panel with
 * "Add to Wish List" and buy buttons.
 *
 * @param {Element} root - The root element to search.
 * @returns {Element[]} Action containers that can accept injected controls.
 */
export function findCardPreviewActionPanels(root) {
  if (!root?.querySelectorAll && !root?.matches) return [];

  const containers = [];
  if (root.matches?.('.deckview-image-container')) {
    containers.push(root);
  }
  const closest = root.closest?.('.deckview-image-container');
  if (closest && !containers.includes(closest)) {
    containers.push(closest);
  }
  if (root.querySelectorAll) {
    for (const container of root.querySelectorAll('.deckview-image-container')) {
      if (!containers.includes(container)) containers.push(container);
    }
  }

  const panels = [];
  for (const container of containers) {
    for (const panel of container.querySelectorAll('.d-grid')) {
      if (findAnchorItem(panel, 'Add to Wish List')) {
        panels.push(panel);
      }
    }
  }
  return panels;
}

/**
 * Find a menu item by its visible text. Returns the direct child of
 * `container` that contains the target text.
 *
 * @param {Element} container - The container element.
 * @param {string} text - The exact text to match.
 * @returns {Element|null}
 */
export function findAnchorItem(container, text) {
  const all = container.querySelectorAll('*');
  for (const el of all) {
    if (el.textContent?.trim() === text) {
      let item = el;
      while (item.parentElement && item.parentElement !== container) {
        item = item.parentElement;
      }
      if (item.parentElement === container) return item;
    }
  }
  return null;
}

/**
 * Extract the Moxfield card ID from a dropdown menu's "View Details" link.
 *
 * @param {Element} menu - The dropdown menu element.
 * @returns {string|null} The Moxfield card ID, or null.
 */
export function extractCardIdFromMenu(menu) {
  const links = menu.querySelectorAll('a[href*="/cards/"]');
  for (const link of links) {
    const id = parseCardIdFromHref(link.getAttribute('href'));
    if (id) return id;
  }
  return null;
}

/**
 * Extract the selected Moxfield card ID from a public-deck preview panel.
 *
 * @param {Element} panel - The preview action panel or ancestor.
 * @returns {string|null} The Moxfield card ID, or null.
 */
export function extractCardIdFromCardPreviewPanel(panel) {
  const linkId = extractCardIdFromMenu(panel);
  if (linkId) return linkId;

  const root = panel.closest?.('.deckview-image-container') || panel;
  const images = root.querySelectorAll?.('img[src*="/cards/card-"], img[src*="cards/card-"]') || [];
  for (const img of images) {
    const src = img.getAttribute('src') || '';
    const match = src.match(/\/cards\/card-([A-Za-z0-9_-]+?)(?:-|\.|$)/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Append a tag query to the Moxfield search box and trigger a search.
 * Uses the native value setter to trigger React state updates.
 *
 * @param {string} query - The search query to append.
 * @param {Object} [options]
 * @param {string} [options.inputSelector] - CSS selector for the search input (default: '#deckbox-search').
 * @param {string} [options.buttonSelector] - CSS selector for the submit button (default: 'button.btn-primary').
 * @returns {boolean} True if the search was triggered, false if the input was not found.
 */
export function addToSearchAndRun(query, options = {}) {
  const inputSelector = options.inputSelector || '#deckbox-search';
  const buttonSelector = options.buttonSelector || 'button.btn-primary';

  const input = document.querySelector(inputSelector);
  if (!input) return false;

  const current = input.value.trim();
  const newValue = current ? `${current} ${query}` : query;

  // Use the native value setter so React picks up the change.
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype, 'value'
  ).set;
  nativeSetter.call(input, newValue);
  input.dispatchEvent(new Event('input', { bubbles: true }));

  // Click the search button next to the input.
  const form = input.closest('form');
  const btn = form?.querySelector(buttonSelector);
  if (btn) {
    btn.click();
  }
  return true;
}
