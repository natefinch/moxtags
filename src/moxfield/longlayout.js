// Moxfield page interaction — Long layout detection helpers (pure logic with minimal DOM).
//
// These helpers detect and extract card information from Moxfield's search
// results "long" layout, where each card is a full-width row with action
// buttons in a side column.
//
// Two variants exist:
// - Deck search: action column has "Add to Main Deck", …, "More Options ▾"
// - Card search: action column has "Create Deck with…", …, "Add to Wish List"
// Both use the same `.row` structure with img.img-card in the first column.

import { parseCardIdFromHref } from './card.js';

/**
 * Find all "More Options" buttons in a container that haven't already been
 * processed (i.e., no sibling .moxtags-long-btn-wrapper exists).
 *
 * @param {Element} root - The DOM element to search within.
 * @returns {{ button: Element, row: Element }[]} Array of unprocessed
 *   More Options buttons and their parent card rows.
 */
export function findUnprocessedMoreOptionsButtons(root) {
  const results = [];
  const buttons = root.tagName === 'BUTTON' ? [root] : [];
  if (root.querySelectorAll) {
    buttons.push(...root.querySelectorAll('button'));
  }

  for (const btn of buttons) {
    if (!btn.textContent?.trim().startsWith('More Options')) continue;

    const col = btn.parentElement;
    if (!col || col.querySelector('.moxtags-long-btn-wrapper')) continue;

    const row = btn.closest('.row');
    if (!row) continue;

    results.push({ button: btn, row });
  }
  return results;
}

/**
 * Find card search text-layout rows whose action column contains
 * "Add to Wish List" but no "More Options" (to avoid double-processing
 * deck search rows which are handled by findUnprocessedMoreOptionsButtons).
 *
 * @param {Element} root - The DOM element to search within.
 * @returns {{ button: Element, row: Element }[]} Array of unprocessed
 *   rows with the "Add to Wish List" button as the anchor.
 */
export function findUnprocessedCardSearchRows(root) {
  const results = [];
  const buttons = root.tagName === 'BUTTON' ? [root] : [];
  if (root.querySelectorAll) {
    buttons.push(...root.querySelectorAll('button'));
  }

  for (const btn of buttons) {
    const text = btn.textContent?.replace(/\s+/g, ' ').trim();
    if (text !== 'Add to Wish List') continue;

    const row = btn.closest('.row');
    if (!row) continue;
    // Must be a card row (has an img.img-card or an h3 with a card link).
    if (!row.querySelector('img.img-card') && !row.querySelector('h3 a[href*="/cards/"]')) continue;
    // Skip rows that also have "More Options" (deck search long layout).
    if (row.textContent?.includes('More Options')) continue;

    // Find the button container that holds all the action buttons.
    const btnContainer = btn.closest('.d-flex') || btn.parentElement;
    if (!btnContainer || btnContainer.querySelector('.moxtags-long-btn-wrapper')) continue;

    results.push({ button: btn, row });
  }
  return results;
}

/**
 * Extract card identity info from a long-layout card row.
 *
 * Returns the Moxfield card ID (from /cards/{id}-slug links) and the
 * card name (from img alt text or heading link text).
 *
 * @param {Element} row - The .row element containing a single card.
 * @returns {{ moxCardId: string|null, cardName: string|null }}
 */
export function extractCardInfoFromRow(row) {
  const cardLink = row.querySelector('a[href*="/cards/"]');
  const moxCardId = cardLink ? parseCardIdFromHref(cardLink.getAttribute('href')) : null;
  const cardName = row.querySelector('img.img-card')?.alt
    || row.querySelector('h3 a')?.textContent?.trim()
    || null;
  return { moxCardId, cardName };
}
