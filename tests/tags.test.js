// Tests for MoxTags tag data utilities.
// Run with: node --test tests/tags.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildReverseIndex, extractTagNames } from '../src/shared/tags.js';

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
