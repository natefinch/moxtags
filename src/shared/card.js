// MoxTags — Card identity utilities (pure logic, no browser APIs).

/**
 * Extract a Moxfield card ID from a card page href.
 * Handles formats like:
 *   /cards/kyerD-aesthir-glider  → "kyerD"
 *   /cards/3GoR1                 → "3GoR1"
 *   https://moxfield.com/cards/J9vBp-kappa-cannoneer → "J9vBp"
 *
 * @param {string} href - The href to parse.
 * @returns {string|null} The Moxfield card ID, or null if not found.
 */
export function parseCardIdFromHref(href) {
  if (!href || typeof href !== 'string') return null;
  const m = href.match(/\/cards\/([A-Za-z0-9_-]+?)(?:-|$)/);
  return m ? m[1] : null;
}
