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

/**
 * Build a compact indexed representation of a reverse index.
 * Output format: { t: string[], d: Record<string, number[]> }
 * where `t` is a sorted array of unique tag labels, and `d` maps
 * each ID to an array of indices into `t`.
 */
export function buildCompactIndex(reverseIndex) {
  const allLabels = new Set();
  for (const tags of reverseIndex.values()) {
    for (const tag of tags) allLabels.add(tag.name);
  }
  const labels = [...allLabels].sort();
  const labelToIdx = new Map(labels.map((l, i) => [l, i]));

  const d = {};
  for (const [id, tags] of reverseIndex) {
    d[id] = tags.map(tag => labelToIdx.get(tag.name));
  }
  return { t: labels, d };
}

/**
 * Expand one or more compact indexed objects back into a single
 * Map<id, [{name, slug}]>.
 * Each input has format: { t: string[], d: Record<string, number[]> }
 * When multiple compacts are provided their entries are merged.
 */
export function expandCompactIndex(...compacts) {
  const index = new Map();
  for (const { t, d } of compacts) {
    for (const [id, indices] of Object.entries(d)) {
      const entries = indices.map(i => ({ name: t[i], slug: t[i] }));
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
    parts.push({ t: compact.t, d });
  }
  return parts;
}
