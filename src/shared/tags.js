// MoxTags — Tag data utilities (pure logic, no browser APIs).

/**
 * Build a Map from id → [{name, slug}] from the tag data array.
 * Each tag has a `label` (used as both name and slug) and an array
 * of IDs under `idKey`.
 */
export function buildReverseIndex(tags, idKey) {
  const index = new Map();
  for (const tag of tags) {
    const entry = { name: tag.label, slug: tag.label };
    const ids = tag[idKey];
    if (!ids) continue;
    for (const id of ids) {
      let list = index.get(id);
      if (!list) {
        list = [];
        index.set(id, list);
      }
      list.push(entry);
    }
  }
  return index;
}

/**
 * Extract a sorted, deduplicated array of tag label strings from raw
 * Scryfall tag data.
 */
export function extractTagNames(data) {
  return [...new Set(data.map(t => t.label))].sort();
}
