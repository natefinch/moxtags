// Scryfall page helpers (pure logic, no browser APIs).

/**
 * Extract the set code and collector number from a Scryfall card page path.
 *
 * Handles paths like:
 *   /card/afr/132/battle-cry-goblin
 *   /card/afr/132
 *   /card/plst/AFR-132
 *
 * @param {string} pathname - URL pathname from location.pathname.
 * @returns {{ set: string, cn: string }|null}
 */
export function parseCardIdentityFromPath(pathname) {
  if (!pathname || typeof pathname !== 'string') return null;

  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'card') return null;

  let set;
  let cn;
  try {
    set = decodeURIComponent(parts[1] || '').toLowerCase();
    cn = decodeURIComponent(parts[2] || '');
  } catch {
    return null;
  }
  if (!set || !cn) return null;

  return { set, cn };
}

/**
 * Extract the set code and collector number from a Scryfall card URL.
 *
 * @param {string} href - Absolute or relative Scryfall card URL.
 * @param {string} [base] - Base URL for resolving relative URLs.
 * @returns {{ set: string, cn: string }|null}
 */
export function parseCardIdentityFromHref(href, base = 'https://scryfall.com') {
  if (!href || typeof href !== 'string') return null;

  let url;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }

  return parseCardIdentityFromPath(url.pathname);
}

/**
 * Build a Scryfall search URL for a query string.
 *
 * @param {string} query - Scryfall search query.
 * @param {string} [origin] - Scryfall origin to link to.
 * @returns {string}
 */
export function buildScryfallSearchUrl(query, origin = 'https://scryfall.com') {
  return `${origin}/search?q=${encodeURIComponent(query)}`;
}

/**
 * Build a Scryfall search URL for a single Tagger tag.
 *
 * @param {string} prefix - Scryfall tag search prefix, e.g. "otag" or "art".
 * @param {string} slug - Tag slug/name.
 * @param {string} [origin] - Scryfall origin to link to.
 * @returns {string}
 */
export function buildTagSearchUrl(prefix, slug, origin) {
  return buildScryfallSearchUrl(buildTagQueryToken(prefix, slug), origin);
}

/**
 * Build the Scryfall query token for a single Tagger tag.
 *
 * @param {string} prefix - Scryfall tag search prefix, e.g. "otag" or "art".
 * @param {string} slug - Tag slug/name.
 * @returns {string}
 */
export function buildTagQueryToken(prefix, slug) {
  return `${prefix}:${slug}`;
}

/**
 * Append a tag token to an existing Scryfall search query.
 *
 * @param {string} query - Existing search query.
 * @param {string} prefix - Scryfall tag search prefix.
 * @param {string} slug - Tag slug/name.
 * @returns {string}
 */
export function appendTagToSearchQuery(query, prefix, slug) {
  const token = buildTagQueryToken(prefix, slug);
  const trimmed = typeof query === 'string' ? query.trim() : '';
  if (!trimmed) return token;
  if (trimmed.split(/\s+/).includes(token)) return trimmed;
  return `${trimmed} ${token}`;
}

/**
 * Build a Scryfall search URL for multiple checked Tagger tags.
 *
 * @param {Array<{ prefix: string, slug: string }>} tags - Checked tags.
 * @param {string} [origin] - Scryfall origin to link to.
 * @returns {string}
 */
export function buildCombinedTagSearchUrl(tags, origin) {
  const query = tags.map(tag => buildTagQueryToken(tag.prefix, tag.slug)).join(' ');
  return buildScryfallSearchUrl(query, origin);
}
