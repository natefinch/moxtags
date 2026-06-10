// Tests for MoxTags tag data utilities.
// Run with: node --test tests/tags.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReverseIndex, extractTagSlugs,
  buildCompactIndex, expandCompactIndex, splitCompactIndex,
} from '../src/scryfall/tags.js';

function oracleTag(label, slug, ...ids) {
  return { label, slug, taggings: ids.map(oracle_id => ({ oracle_id })) };
}

describe('buildReverseIndex', () => {
  it('maps IDs to tag entries', () => {
    const tags = [
      oracleTag('Ramp', 'ramp', 'uuid1', 'uuid2'),
      oracleTag('Card Draw', 'card-draw', 'uuid2', 'uuid3'),
    ];
    const index = buildReverseIndex(tags, 'oracle_id');

    assert.deepEqual(index.get('uuid1'), [{ name: 'Ramp', slug: 'ramp' }]);
    assert.deepEqual(index.get('uuid2'), [
      { name: 'Ramp', slug: 'ramp' },
      { name: 'Card Draw', slug: 'card-draw' },
    ]);
    assert.deepEqual(index.get('uuid3'), [{ name: 'Card Draw', slug: 'card-draw' }]);
  });

  it('returns empty map for empty input', () => {
    const index = buildReverseIndex([], 'oracle_id');
    assert.equal(index.size, 0);
  });

  it('skips taggings with missing ID key', () => {
    const tags = [
      { label: 'Ramp', slug: 'ramp', taggings: [{}] },
      oracleTag('Draw', 'draw', 'uuid1'),
    ];
    const index = buildReverseIndex(tags, 'oracle_id');
    assert.equal(index.size, 1);
    assert.deepEqual(index.get('uuid1'), [{ name: 'Draw', slug: 'draw' }]);
  });

  it('works with illustration_id key', () => {
    const tags = [
      { label: 'Full Art', slug: 'full-art', taggings: [{ illustration_id: 'ill1' }] },
    ];
    const index = buildReverseIndex(tags, 'illustration_id');
    assert.deepEqual(index.get('ill1'), [{ name: 'Full Art', slug: 'full-art' }]);
  });
});

describe('extractTagSlugs', () => {
  it('returns sorted unique slugs', () => {
    const data = [
      oracleTag('Ramp', 'ramp'),
      oracleTag('Card Draw', 'card-draw'),
      oracleTag('Ramp', 'ramp'),
      oracleTag('Artifact', 'artifact'),
    ];
    assert.deepEqual(extractTagSlugs(data), ['artifact', 'card-draw', 'ramp']);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(extractTagSlugs([]), []);
  });
});

describe('buildCompactIndex', () => {
  it('produces compact indexed format', () => {
    const tags = [
      oracleTag('Card Draw', 'card-draw', 'uuid1', 'uuid2'),
      oracleTag('Ramp', 'ramp', 'uuid2'),
    ];
    const index = buildReverseIndex(tags, 'oracle_id');
    const compact = buildCompactIndex(index);

    assert.deepEqual(compact.t, ['card-draw', 'ramp']);
    assert.deepEqual(compact.n, { 0: 'Card Draw', 1: 'Ramp' });
    assert.deepEqual(compact.d['uuid1'], [0]);
    assert.deepEqual(compact.d['uuid2'], [0, 1]);
  });

  it('handles empty index', () => {
    const compact = buildCompactIndex(new Map());
    assert.deepEqual(compact.t, []);
    assert.deepEqual(compact.d, {});
  });
});

describe('expandCompactIndex', () => {
  it('reconstructs Map from compact format', () => {
    const compact = {
      t: ['draw', 'ramp'],
      n: { 0: 'Card Draw', 1: 'Ramp' },
      d: { uuid1: [0], uuid2: [0, 1] },
    };
    const index = expandCompactIndex(compact);

    assert.equal(index.size, 2);
    assert.deepEqual(index.get('uuid1'), [{ name: 'Card Draw', slug: 'draw' }]);
    assert.deepEqual(index.get('uuid2'), [
      { name: 'Card Draw', slug: 'draw' },
      { name: 'Ramp', slug: 'ramp' },
    ]);
  });

  it('handles empty compact format', () => {
    const index = expandCompactIndex({ t: [], d: {} });
    assert.equal(index.size, 0);
  });
});

describe('compact index round-trip', () => {
  it('buildCompactIndex + expandCompactIndex reproduces original index', () => {
    const tags = [
      oracleTag('Ramp', 'ramp', 'uuid1', 'uuid2'),
      oracleTag('Card Draw', 'card-draw', 'uuid2', 'uuid3'),
      oracleTag('Artifact', 'artifact', 'uuid1'),
    ];
    const original = buildReverseIndex(tags, 'oracle_id');
    const compact = buildCompactIndex(original);
    const restored = expandCompactIndex(compact);

    assert.equal(restored.size, original.size);
    for (const [id, entries] of original) {
      const restoredEntries = restored.get(id);
      assert.ok(restoredEntries, `missing key: ${id}`);
      // Sort both by name for stable comparison (compact sorts labels).
      const sortedOrig = [...entries].sort((a, b) => a.name.localeCompare(b.name));
      const sortedRest = [...restoredEntries].sort((a, b) => a.name.localeCompare(b.name));
      assert.deepEqual(sortedRest, sortedOrig);
    }
  });

  it('compact t array matches extractTagSlugs output', () => {
    const rawTags = [
      oracleTag('Ramp', 'ramp', 'uuid1'),
      oracleTag('Card Draw', 'card-draw', 'uuid2'),
      oracleTag('Artifact', 'artifact', 'uuid1'),
    ];
    const index = buildReverseIndex(rawTags, 'oracle_id');
    const compact = buildCompactIndex(index);
    const tagNames = extractTagSlugs(rawTags);

    assert.deepEqual(compact.t, tagNames);
  });
});

describe('splitCompactIndex', () => {
  it('splits d entries across n parts with shared t array', () => {
    const compact = {
      t: ['draw', 'ramp'],
      d: { uuid1: [0], uuid2: [1], uuid3: [0, 1], uuid4: [1] },
    };
    const parts = splitCompactIndex(compact, 2);

    assert.equal(parts.length, 2);
    // Both parts share the same t array.
    assert.deepEqual(parts[0].t, compact.t);
    assert.deepEqual(parts[1].t, compact.t);
    // All keys distributed across parts.
    const allKeys = [
      ...Object.keys(parts[0].d),
      ...Object.keys(parts[1].d),
    ];
    assert.deepEqual(allKeys.sort(), Object.keys(compact.d).sort());
  });

  it('expanding split parts reproduces original index', () => {
    const tags = [
      oracleTag('Ramp', 'ramp', 'uuid1', 'uuid2', 'uuid3'),
      oracleTag('Card Draw', 'card-draw', 'uuid2', 'uuid3', 'uuid4'),
      oracleTag('Artifact', 'artifact', 'uuid1', 'uuid4'),
    ];
    const original = buildReverseIndex(tags, 'oracle_id');
    const compact = buildCompactIndex(original);
    const [p1, p2] = splitCompactIndex(compact, 2);
    const restored = expandCompactIndex(p1, p2);

    assert.equal(restored.size, original.size);
    for (const [id, entries] of original) {
      const sortedOrig = [...entries].sort((a, b) => a.name.localeCompare(b.name));
      const sortedRest = [...restored.get(id)].sort((a, b) => a.name.localeCompare(b.name));
      assert.deepEqual(sortedRest, sortedOrig);
    }
  });
});
