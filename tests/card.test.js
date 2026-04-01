// Tests for MoxTags card identity utilities.
// Run with: node --test tests/card.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseCardIdFromHref } from '../src/shared/card.js';

describe('parseCardIdFromHref', () => {
  it('extracts ID from relative href with slug', () => {
    assert.equal(parseCardIdFromHref('/cards/kyerD-aesthir-glider'), 'kyerD');
  });

  it('extracts ID from relative href without slug', () => {
    assert.equal(parseCardIdFromHref('/cards/3GoR1'), '3GoR1');
  });

  it('extracts ID from full URL with slug', () => {
    assert.equal(
      parseCardIdFromHref('https://moxfield.com/cards/J9vBp-kappa-cannoneer'),
      'J9vBp'
    );
  });

  it('extracts ID with underscores and hyphens in the ID', () => {
    assert.equal(parseCardIdFromHref('/cards/a_b-card-name'), 'a_b');
  });

  it('handles numeric IDs', () => {
    assert.equal(parseCardIdFromHref('/cards/12345-some-card'), '12345');
  });

  it('returns null for non-card hrefs', () => {
    assert.equal(parseCardIdFromHref('/decks/abc123'), null);
    assert.equal(parseCardIdFromHref('/search/cards?q=e:dom'), null);
  });

  it('returns null for null/undefined/empty input', () => {
    assert.equal(parseCardIdFromHref(null), null);
    assert.equal(parseCardIdFromHref(undefined), null);
    assert.equal(parseCardIdFromHref(''), null);
  });

  it('returns null for non-string input', () => {
    assert.equal(parseCardIdFromHref(42), null);
    assert.equal(parseCardIdFromHref({}), null);
  });
});
