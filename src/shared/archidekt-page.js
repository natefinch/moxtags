// Archidekt page helpers (pure logic, no browser APIs).

/**
 * Extract card name, set code, and collector number from an Archidekt card
 * image alt string.
 *
 * Archidekt renders card image alt text in the form:
 *   Card Name (set) collector-number
 *
 * The card name may itself contain parentheses, so this parses from the
 * rightmost "(set) number" suffix.
 *
 * @param {string} alt - Archidekt card image alt text.
 * @returns {{ name: string, set: string, cn: string }|null}
 */
export function parseCardIdentityFromAlt(alt) {
  if (typeof alt !== 'string') return null;

  const trimmed = alt.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(.+)\s+\(([^()\s]+)\)\s+(.+)$/);
  if (!match) return null;

  const [, rawName, rawSet, rawCn] = match;
  const name = rawName.trim();
  const set = rawSet.trim().toLowerCase();
  const cn = rawCn.trim();
  if (!name || !set || !cn) return null;

  return { name, set, cn };
}

/**
 * Extract exact card identity from Archidekt's embedded deck card data.
 *
 * @param {object} card - Archidekt deck.cardMap entry.
 * @returns {{ name: string, set: string, cn: string }|null}
 */
export function parseCardIdentityFromDeckCard(card) {
  if (!card || typeof card !== 'object') return null;

  const printing = card.card && typeof card.card === 'object' ? card.card : null;
  const oracleCard = card.oracleCard && typeof card.oracleCard === 'object'
    ? card.oracleCard
    : printing?.oracleCard && typeof printing.oracleCard === 'object'
      ? printing.oracleCard
      : null;
  const setData = printing?.set && typeof printing.set === 'object'
    ? printing.set
    : printing?.edition && typeof printing.edition === 'object'
      ? printing.edition
      : null;
  const name = String(
    card.displayName
    || card.name
    || printing?.displayName
    || printing?.name
    || oracleCard?.name
    || ''
  ).trim();
  const set = String(card.setCode || setData?.code || setData?.editioncode || '').trim().toLowerCase();
  const cn = String(card.collectorNumber || printing?.collectorNumber || '').trim();
  if (!name || !set || !cn) return null;

  return { name, set, cn };
}

/**
 * Build an Archidekt Syntax Search token for a Scryfall Tagger tag.
 *
 * Archidekt's Syntax Search accepts the same `otag:` and `art:` query tokens
 * that Scryfall uses for Tagger searches.
 *
 * @param {string} prefix - Tag query prefix, e.g. "otag" or "art".
 * @param {string} slug - Tag slug/name.
 * @returns {string}
 */
export function buildArchidektTagQuery(prefix, slug) {
  if (typeof prefix !== 'string' || typeof slug !== 'string') return '';

  const trimmedPrefix = prefix.trim();
  const trimmedSlug = slug.trim();
  if (!trimmedPrefix || !trimmedSlug) return '';

  return `${trimmedPrefix}:${trimmedSlug}`;
}

/**
 * Build an Archidekt Syntax Search query from multiple Scryfall Tagger tags.
 *
 * @param {Array<{ prefix: string, slug: string }>} tags - Tags to combine.
 * @returns {string}
 */
export function buildArchidektCombinedTagQuery(tags) {
  if (!Array.isArray(tags)) return '';

  return tags
    .map(tag => buildArchidektTagQuery(tag?.prefix, tag?.slug))
    .filter(Boolean)
    .join(' ');
}

/**
 * Append one or more Tagger query tokens to an existing Archidekt Syntax Search
 * query, preserving the current query and avoiding exact duplicate tokens.
 *
 * @param {string} existingQuery - Current Archidekt Syntax Search query.
 * @param {string} tagQuery - One or more whitespace-separated tag tokens.
 * @returns {string}
 */
export function appendArchidektTagQuery(existingQuery, tagQuery) {
  const existing = typeof existingQuery === 'string' ? existingQuery.trim() : '';
  const additions = typeof tagQuery === 'string'
    ? tagQuery.trim().split(/\s+/).filter(Boolean)
    : [];

  if (additions.length === 0) return existing;
  if (!existing) return additions.join(' ');

  const tokens = existing.split(/\s+/);
  const tokenSet = new Set(tokens);
  for (const token of additions) {
    if (!tokenSet.has(token)) {
      tokens.push(token);
      tokenSet.add(token);
    }
  }

  return tokens.join(' ');
}
