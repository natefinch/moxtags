import { parseCardIdFromHref } from './card.js';

const LEGALITY_STATUS_SELECTOR = '[aria-label="Legal"], [aria-label="Not Legal"], [aria-label="Restricted"], [aria-label="Banned"]';

/**
 * Extract card identity from Moxfield's card view overlay.
 *
 * @param {Element} overlay
 * @returns {{ name: string|null, moxCardId: string|null, set: string|null, cn: string|null }}
 */
export function extractCardOverlayInfo(overlay) {
  const titleLink = overlay?.querySelector?.('h1 a[href*="/cards/"]') || null;
  const name = titleLink?.textContent?.trim() || null;
  const moxCardId = titleLink ? parseCardIdFromHref(titleLink.getAttribute('href')) : null;
  const setLink = findCurrentPrintingSetLink(overlay, titleLink);
  const set = parseSetCodeFromSearchHref(setLink?.getAttribute('href')) || setLink?.textContent?.trim()?.toLowerCase() || null;
  const cn = extractCollectorNumberNearSetLink(setLink);

  return { name, moxCardId, set, cn };
}

/**
 * Find the format legality grid in Moxfield's card view overlay.
 *
 * @param {Element} overlay
 * @returns {Element|null}
 */
export function findLegalityGrid(overlay) {
  const rows = overlay?.querySelectorAll?.('.row') || [];
  for (const row of rows) {
    const legalityColumns = [...row.children].filter(isLegalityColumn);
    if (legalityColumns.length >= 4) return row;
  }
  return null;
}

function isLegalityColumn(el) {
  const className = String(el?.className || '');
  if (!/(^|\s)col(?:-|$)/.test(className)) return false;
  return Boolean(el.querySelector?.(LEGALITY_STATUS_SELECTOR));
}

function findCurrentPrintingSetLink(overlay, titleLink) {
  const scope = titleLink?.closest?.('.col-sm-6') || overlay;
  const links = [...(scope?.querySelectorAll?.('a[href*="/search/cards?q="]') || [])];
  const titleIndex = titleLink ? documentOrderIndex(scope, titleLink) : -1;

  return links.find(link => {
    if (!parseSetCodeFromSearchHref(link.getAttribute('href'))) return false;
    if (titleIndex < 0) return true;
    return documentOrderIndex(scope, link) > titleIndex;
  }) || null;
}

function documentOrderIndex(scope, node) {
  const all = [...(scope?.querySelectorAll?.('*') || [])];
  return all.indexOf(node);
}

function parseSetCodeFromSearchHref(href) {
  if (!href || typeof href !== 'string') return null;
  const url = new URL(href, 'https://moxfield.com');
  const q = url.searchParams.get('q') || '';
  const match = q.match(/(?:^|\s)e:([a-z0-9]+)/i);
  return match?.[1]?.toLowerCase() || null;
}

function extractCollectorNumberNearSetLink(setLink) {
  if (!setLink) return null;
  const row = setLink.closest?.('.d-flex') || setLink.parentElement;
  const text = row?.textContent || '';
  const match = text.match(/#\s*([^,\s]+)/);
  return match?.[1]?.trim() || null;
}
