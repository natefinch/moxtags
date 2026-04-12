// Tests for MoxTags tag data utilities.
// Run with: node --test tests/tags.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReverseIndex, extractTagNames,
  buildCompactIndex, expandCompactIndex, splitCompactIndex,
} from '../src/shared/tags.js';

describe('buildReverseIndex', () => {
  it('maps IDs to tag entries', () => {
    const tags = [
      { label: 'ramp', oracle_ids: ['uuid1', 'uuid2'] },
      { label: 'draw', oracle_ids: ['uuid2', 'uuid3'] },
    ];
    const index = buildReverseIndex(tags, 'oracle_ids');

    assert.deepEqual(index.get('uuid1'), [{ name: 'ramp', slug: 'ramp' }]);
    assert.deepEqual(index.get('uuid2'), [
      { name: 'ramp', slug: 'ramp' },
      { name: 'draw', slug: 'draw' },
    ]);
    assert.deepEqual(index.get('uuid3'), [{ name: 'draw', slug: 'draw' }]);
  });

  it('returns empty map for empty input', () => {
    const index = buildReverseIndex([], 'oracle_ids');
    assert.equal(index.size, 0);
  });

  it('skips tags with missing ID key', () => {
    const tags = [
      { label: 'ramp' },  // no oracle_ids
      { label: 'draw', oracle_ids: ['uuid1'] },
    ];
    const index = buildReverseIndex(tags, 'oracle_ids');
    assert.equal(index.size, 1);
    assert.deepEqual(index.get('uuid1'), [{ name: 'draw', slug: 'draw' }]);
  });

  it('works with illustration_ids key', () => {
    const tags = [
      { label: 'full-art', illustration_ids: ['ill1'] },
    ];
    const index = buildReverseIndex(tags, 'illustration_ids');
    assert.deepEqual(index.get('ill1'), [{ name: 'full-art', slug: 'full-art' }]);
  });
});

describe('extractTagNames', () => {
  it('returns sorted unique labels', () => {
    const data = [
      { label: 'ramp', oracle_ids: [] },
      { label: 'draw', oracle_ids: [] },
      { label: 'ramp', oracle_ids: [] },  // duplicate
      { label: 'artifact', oracle_ids: [] },
    ];
    assert.deepEqual(extractTagNames(data), ['artifact', 'draw', 'ramp']);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(extractTagNames([]), []);
  });
});

describe('buildCompactIndex', () => {
  it('produces compact indexed format', () => {
    const tags = [
      { label: 'draw', oracle_ids: ['uuid1', 'uuid2'] },
      { label: 'ramp', oracle_ids: ['uuid2'] },
    ];
    const index = buildReverseIndex(tags, 'oracle_ids');
    const compact = buildCompactIndex(index);

    assert.deepEqual(compact.t, ['draw', 'ramp']);
    assert.deepEqual(compact.d['uuid1'], [0]);       // draw
    assert.deepEqual(compact.d['uuid2'], [0, 1]);     // draw, ramp
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
      d: { uuid1: [0], uuid2: [0, 1] },
    };
    const index = expandCompactIndex(compact);

    assert.equal(index.size, 2);
    assert.deepEqual(index.get('uuid1'), [{ name: 'draw', slug: 'draw' }]);
    assert.deepEqual(index.get('uuid2'), [
      { name: 'draw', slug: 'draw' },
      { name: 'ramp', slug: 'ramp' },
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
      { label: 'ramp', oracle_ids: ['uuid1', 'uuid2'] },
      { label: 'draw', oracle_ids: ['uuid2', 'uuid3'] },
      { label: 'artifact', oracle_ids: ['uuid1'] },
    ];
    const original = buildReverseIndex(tags, 'oracle_ids');
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

  it('compact t array matches extractTagNames output', () => {
    const rawTags = [
      { label: 'ramp', oracle_ids: ['uuid1'] },
      { label: 'draw', oracle_ids: ['uuid2'] },
      { label: 'artifact', oracle_ids: ['uuid1'] },
    ];
    const index = buildReverseIndex(rawTags, 'oracle_ids');
    const compact = buildCompactIndex(index);
    const tagNames = extractTagNames(rawTags);

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
      { label: 'ramp', oracle_ids: ['uuid1', 'uuid2', 'uuid3'] },
      { label: 'draw', oracle_ids: ['uuid2', 'uuid3', 'uuid4'] },
      { label: 'artifact', oracle_ids: ['uuid1', 'uuid4'] },
    ];
    const original = buildReverseIndex(tags, 'oracle_ids');
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
