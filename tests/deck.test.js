// Tests for MoxTags deck data parsing.
// Run with: node --test tests/deck.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildCardMap } from '../src/shared/deck.js';

describe('buildCardMap', () => {
  it('parses v2 format (top-level boards with .card wrapper)', () => {
    const data = {
      mainboard: {
        'entry1': { card: { name: 'Lightning Bolt', set: 'lea', cn: '161' }, quantity: 4 },
        'entry2': { card: { name: 'Dark Ritual', set: 'lea', cn: '98' }, quantity: 4 },
      },
    };
    const map = buildCardMap(data);
    assert.ok(map);
    assert.equal(map.size, 2);
    assert.deepEqual(map.get('lightning bolt'), { name: 'Lightning Bolt', set: 'lea', cn: '161' });
    assert.deepEqual(map.get('dark ritual'), { name: 'Dark Ritual', set: 'lea', cn: '98' });
  });

  it('parses v3 format (boards under data.boards)', () => {
    const data = {
      boards: {
        mainboard: {
          cards: {
            'entry1': { name: 'Sol Ring', set: 'c21', cn: '263' },
          },
        },
      },
    };
    const map = buildCardMap(data);
    assert.ok(map);
    assert.deepEqual(map.get('sol ring'), { name: 'Sol Ring', set: 'c21', cn: '263' });
  });

  it('handles double-faced cards', () => {
    const data = {
      mainboard: {
        'entry1': { card: { name: 'Delver of Secrets // Insectile Aberration', set: 'isd', cn: '51' } },
      },
    };
    const map = buildCardMap(data);
    assert.ok(map);
    // Full name key
    assert.ok(map.has('delver of secrets // insectile aberration'));
    // Front face key
    assert.ok(map.has('delver of secrets'));
  });

  it('returns null for invalid data', () => {
    assert.equal(buildCardMap(null), null);
    assert.equal(buildCardMap('string'), null);
  });

  it('returns null for empty boards', () => {
    assert.equal(buildCardMap({ mainboard: {} }), null);
  });

  it('skips cards with missing set or cn', () => {
    const data = {
      mainboard: {
        'entry1': { card: { name: 'No Set', cn: '1' } },
        'entry2': { card: { name: 'No CN', set: 'lea' } },
        'entry3': { card: { name: 'Good Card', set: 'lea', cn: '1' } },
      },
    };
    const map = buildCardMap(data);
    assert.ok(map);
    assert.equal(map.size, 1);
    assert.ok(map.has('good card'));
  });

  it('handles multiple boards', () => {
    const data = {
      mainboard: {
        'e1': { card: { name: 'Sol Ring', set: 'c21', cn: '263' } },
      },
      sideboard: {
        'e2': { card: { name: 'Swords to Plowshares', set: 'lea', cn: '40' } },
      },
      commanders: {
        'e3': { card: { name: 'Atraxa', set: 'cm2', cn: '10' } },
      },
    };
    const map = buildCardMap(data);
    assert.ok(map);
    assert.equal(map.size, 3);
  });

  it('uses collector_number as fallback for cn', () => {
    const data = {
      mainboard: {
        'e1': { card: { name: 'Test Card', set: 'tst', collector_number: '42' } },
      },
    };
    const map = buildCardMap(data);
    assert.ok(map);
    assert.deepEqual(map.get('test card'), { name: 'Test Card', set: 'tst', cn: '42' });
  });
});
