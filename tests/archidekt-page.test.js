// Tests for Archidekt page helpers.
// Run with: node --test tests/archidekt-page.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  appendArchidektTagQuery,
  buildArchidektCombinedTagQuery,
  buildArchidektTagQuery,
  parseCardIdentityFromAlt,
  parseCardIdentityFromDeckCard,
} from '../src/shared/archidekt-page.js';

describe('parseCardIdentityFromAlt', () => {
  it('extracts card identity from Archidekt image alt text', () => {
    assert.deepEqual(
      parseCardIdentityFromAlt('Sophia, Dogged Detective (mkc) 8'),
      { name: 'Sophia, Dogged Detective', set: 'mkc', cn: '8' }
    );
  });

  it('handles double-faced card names', () => {
    assert.deepEqual(
      parseCardIdentityFromAlt('Glasspool Mimic // Glasspool Shore (znr) 60'),
      { name: 'Glasspool Mimic // Glasspool Shore', set: 'znr', cn: '60' }
    );
  });

  it('parses from the rightmost set and collector suffix', () => {
    assert.deepEqual(
      parseCardIdentityFromAlt('______ Goblin (foil etched) (und) 75'),
      { name: '______ Goblin (foil etched)', set: 'und', cn: '75' }
    );
  });

  it('handles promo collector numbers and whitespace', () => {
    assert.deepEqual(
      parseCardIdentityFromAlt('  Battle Cry Goblin (PLST) AFR-132  '),
      { name: 'Battle Cry Goblin', set: 'plst', cn: 'AFR-132' }
    );
  });

  it('handles token collector numbers', () => {
    assert.deepEqual(
      parseCardIdentityFromAlt('Goblin Token (tclb) 1'),
      { name: 'Goblin Token', set: 'tclb', cn: '1' }
    );
  });

  it('returns null for invalid alt text', () => {
    assert.equal(parseCardIdentityFromAlt('Sophia, Dogged Detective'), null);
    assert.equal(parseCardIdentityFromAlt(''), null);
    assert.equal(parseCardIdentityFromAlt(null), null);
  });
});

describe('parseCardIdentityFromDeckCard', () => {
  it('extracts card identity from Archidekt embedded deck data', () => {
    assert.deepEqual(
      parseCardIdentityFromDeckCard({
        name: 'Sophia, Dogged Detective',
        setCode: 'MKC',
        collectorNumber: '8',
      }),
      { name: 'Sophia, Dogged Detective', set: 'mkc', cn: '8' }
    );
  });

  it('prefers displayName when present', () => {
    assert.deepEqual(
      parseCardIdentityFromDeckCard({
        name: 'Split Card Backend Name',
        displayName: 'Displayed Split Card',
        setCode: 'abc',
        collectorNumber: '123a',
      }),
      { name: 'Displayed Split Card', set: 'abc', cn: '123a' }
    );
  });

  it('returns null for incomplete deck card data', () => {
    assert.equal(parseCardIdentityFromDeckCard({ name: 'Sol Ring', setCode: 'cmm' }), null);
    assert.equal(parseCardIdentityFromDeckCard(null), null);
  });
});

describe('Archidekt syntax tag queries', () => {
  it('builds single Tagger query tokens', () => {
    assert.equal(buildArchidektTagQuery('otag', 'attack-trigger'), 'otag:attack-trigger');
    assert.equal(buildArchidektTagQuery('art', 'goblin'), 'art:goblin');
  });

  it('builds combined Tagger syntax searches', () => {
    assert.equal(
      buildArchidektCombinedTagQuery([
        { prefix: 'otag', slug: 'attack-trigger' },
        { prefix: 'otag', slug: 'draw' },
      ]),
      'otag:attack-trigger otag:draw'
    );
  });

  it('ignores invalid tags in combined queries', () => {
    assert.equal(
      buildArchidektCombinedTagQuery([
        { prefix: 'otag', slug: 'draw' },
        { prefix: '', slug: 'ignored' },
        null,
        { prefix: 'art', slug: ' ' },
      ]),
      'otag:draw'
    );
  });

  it('appends tag queries to existing syntax searches', () => {
    assert.equal(
      appendArchidektTagQuery('type:creature color:w', 'otag:draw art:dog'),
      'type:creature color:w otag:draw art:dog'
    );
  });

  it('does not duplicate existing exact tag tokens when appending', () => {
    assert.equal(
      appendArchidektTagQuery('type:creature otag:draw', 'otag:draw art:dog'),
      'type:creature otag:draw art:dog'
    );
  });

  it('uses the tag query when appending to an empty search', () => {
    assert.equal(appendArchidektTagQuery('', 'otag:draw'), 'otag:draw');
  });
});
