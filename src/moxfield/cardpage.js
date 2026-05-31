// Moxfield card page — identity extraction helpers (pure logic, minimal DOM).
//
// Standalone card pages live at /cards/{id}-slug and display a single card
// with set info, legalities, rulings, etc.  These helpers extract the card
// identity from the URL and DOM so tags can be injected.

import { parseCardIdFromHref } from './card.js';
import { parseSetCodeFromSearchHref, extractCollectorNumberNearSetLink } from './overlay.js';

/**
 * Extract card identity from a Moxfield standalone card page.
 *
 * @param {string} pathname - The URL pathname (e.g., "/cards/0vGgm-abandon-attachments").
 * @param {Element|Document} container - The DOM root to search within.
 * @returns {{ name: string|null, moxCardId: string|null, set: string|null, cn: string|null }}
 */
export function extractCardPageInfo(pathname, container) {
  const moxCardId = parseCardIdFromHref(pathname);
  const name = container.querySelector?.('h1 strong')?.textContent?.trim()
    || container.querySelector?.('h1')?.textContent?.trim()
    || null;

  let set = null;
  let cn = null;

  // Scope the set/cn search near the h1 to avoid picking up unrelated links.
  const h1 = container.querySelector?.('h1');
  const detailCol = h1?.closest?.('[class*="col-md"]') || h1?.parentElement?.parentElement;

  if (detailCol) {
    const setLink = detailCol.querySelector?.('a[href*="/search/cards?q="]');
    if (setLink) {
      set = parseSetCodeFromSearchHref(setLink.getAttribute('href'));
      cn = extractCollectorNumberNearSetLink(setLink);
    }
    if (!set) {
      const textCaps = detailCol.querySelector?.('.text-caps');
      set = textCaps?.textContent?.trim()?.toLowerCase() || null;
    }
    if (!cn) {
      // Fallback: find the collector number from "#NNN" text near the set info.
      const flexRow = detailCol.querySelector?.('.d-flex');
      const text = flexRow?.textContent || '';
      const cnMatch = text.match(/#\s*([^,\s]+)/);
      cn = cnMatch?.[1]?.trim() || null;
    }
  }

  return { name, moxCardId, set, cn };
}

/**
 * Find the "Format Legalities" heading on a card page.
 *
 * @param {Element|Document} container - The DOM root to search within.
 * @returns {Element|null} The heading element, or null.
 */
export function findFormatLegalitiesHeading(container) {
  const headings = container.querySelectorAll?.('h3') || [];
  for (const h of headings) {
    if (h.textContent?.trim() === 'Format Legalities') return h;
  }
  return null;
}

/**
 * Find the card's printed set/collector/pricing details row on a card page.
 *
 * @param {Element|Document} container - The DOM root to search within.
 * @returns {Element|null} The printing detail row, or null.
 */
export function findCardPagePrintingDetails(container) {
  const h1 = container.querySelector?.('h1');
  const detailCol = h1?.closest?.('[class*="col-md"]') || h1?.parentElement?.parentElement || container;
  const rows = detailCol.querySelectorAll?.('.d-flex') || [];
  for (const row of rows) {
    const text = row.textContent || '';
    const hasCollectorNumber = /#\s*\S+/.test(text);
    const hasSetCode = Boolean(
      row.querySelector?.('.text-caps')
      || row.querySelector?.('a[href*="/search/cards?q="]')
      || row.querySelector?.('svg title')
    );
    if (hasCollectorNumber && hasSetCode) return row;
  }
  return null;
}
