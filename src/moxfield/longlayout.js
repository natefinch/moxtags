// Moxfield page interaction — Long layout detection helpers (pure logic with minimal DOM).
//
// These helpers detect and extract card information from Moxfield's search
// results "long" layout, where each card is a full-width row with action
// buttons in a side column.

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
