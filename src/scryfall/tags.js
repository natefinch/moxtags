// Scryfall API interaction — Tag data utilities (pure logic, no browser APIs).

/**
 * Build a Map from id → [{name, slug}] from the tag data array.
 * Each tag has a display `label`, search `slug`, and `taggings` array
 * whose entries contain an ID under `idKey`.
 */
export function buildReverseIndex(tags, idKey) {
  const index = new Map();
  for (const tag of tags) {
    const entry = { name: tag.label, slug: tag.slug };
    for (const tagging of tag.taggings || []) {
      const id = tagging[idKey];
      if (!id) continue;
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
 * Extract a sorted, deduplicated array of tag slug strings from raw
 * Scryfall tag data.
 */
export function extractTagSlugs(data) {
  return [...new Set(data.map(t => t.slug))].sort();
}

/**
 * Build a compact indexed representation of a reverse index.
 * Output format: { t: string[], n?: Record<number, string>, d: Record<string, number[]> }
 * where `t` contains sorted slugs, optional `n` maps indices to differing
 * display names, and `d` maps each ID to indices into `t`.
 */
export function buildCompactIndex(reverseIndex) {
  const tagsBySlug = new Map();
  for (const tags of reverseIndex.values()) {
    for (const tag of tags) tagsBySlug.set(tag.slug, tag.name);
  }
  const slugs = [...tagsBySlug.keys()].sort();
  const slugToIdx = new Map(slugs.map((slug, i) => [slug, i]));

  const d = {};
  for (const [id, tags] of reverseIndex) {
    d[id] = tags.map(tag => slugToIdx.get(tag.slug));
  }
  const compact = { t: slugs, d };
  const names = {};
  for (let i = 0; i < slugs.length; i++) {
    const name = tagsBySlug.get(slugs[i]);
    if (name !== slugs[i]) names[i] = name;
  }
  if (Object.keys(names).length > 0) compact.n = names;
  return compact;
}

/**
 * Expand one or more compact indexed objects back into a single
 * Map<id, [{name, slug}]>.
 * Each input has format: { t: string[], d: Record<string, number[]> }
 * When multiple compacts are provided their entries are merged.
 */
export function expandCompactIndex(...compacts) {
  const index = new Map();
  for (const { t, n, d } of compacts) {
    for (const [id, indices] of Object.entries(d)) {
      const entries = indices.map(i => ({ name: n?.[i] || t[i], slug: t[i] }));
      const existing = index.get(id);
      if (existing) {
        existing.push(...entries);
      } else {
        index.set(id, entries);
      }
    }
  }
  return index;
}

/**
 * Split a compact index into `n` roughly-equal parts.
 * Each part shares the same `t` array; the `d` entries are distributed.
 */
export function splitCompactIndex(compact, n) {
  const keys = Object.keys(compact.d);
  const parts = [];
  const chunkSize = Math.ceil(keys.length / n);
  for (let i = 0; i < n; i++) {
    const chunk = keys.slice(i * chunkSize, (i + 1) * chunkSize);
    const d = {};
    for (const k of chunk) d[k] = compact.d[k];
    parts.push({ t: compact.t, ...(compact.n ? { n: compact.n } : {}), d });
  }
  return parts;
}
