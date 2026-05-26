// Tests for Scryfall page helpers.
// Run with: node --test tests/scryfall-page.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCardIdentityFromHref,
  parseCardIdentityFromPath,
  appendTagToSearchQuery,
  buildScryfallSearchUrl,
  buildTagQueryToken,
  buildTagSearchUrl,
  buildCombinedTagSearchUrl,
} from '../src/shared/scryfall-page.js';

describe('parseCardIdentityFromPath', () => {
  it('extracts set and collector number from a card path with slug', () => {
    assert.deepEqual(
      parseCardIdentityFromPath('/card/afr/132/battle-cry-goblin'),
      { set: 'afr', cn: '132' }
    );
  });

  it('extracts set and collector number from a card path without slug', () => {
    assert.deepEqual(
      parseCardIdentityFromPath('/card/AFR/132'),
      { set: 'afr', cn: '132' }
    );
  });

  it('handles non-numeric collector numbers', () => {
    assert.deepEqual(
      parseCardIdentityFromPath('/card/plst/AFR-132/battle-cry-goblin'),
      { set: 'plst', cn: 'AFR-132' }
    );
    assert.deepEqual(
      parseCardIdentityFromPath('/card/who/1a/example-card'),
      { set: 'who', cn: '1a' }
    );
  });

  it('decodes URL-encoded collector numbers', () => {
    assert.deepEqual(
      parseCardIdentityFromPath('/card/sld/1234%E2%98%85/example-card'),
      { set: 'sld', cn: '1234\u2605' }
    );
  });

  it('returns null for non-card paths and invalid input', () => {
    assert.equal(parseCardIdentityFromPath('/search?q=otag%3Aramp'), null);
    assert.equal(parseCardIdentityFromPath('/card/afr'), null);
    assert.equal(parseCardIdentityFromPath('/card/afr/%E0%A4%A'), null);
    assert.equal(parseCardIdentityFromPath(null), null);
    assert.equal(parseCardIdentityFromPath({}), null);
  });
});

describe('parseCardIdentityFromHref', () => {
  it('extracts identity from absolute and relative card URLs', () => {
    assert.deepEqual(
      parseCardIdentityFromHref('https://scryfall.com/card/neo/A-131/a-akki-ronin'),
      { set: 'neo', cn: 'A-131' }
    );
    assert.deepEqual(
      parseCardIdentityFromHref('/card/40k/86%E2%98%85/aberrant', 'https://scryfall.com'),
      { set: '40k', cn: '86\u2605' }
    );
  });

  it('handles localized card URLs', () => {
    assert.deepEqual(
      parseCardIdentityFromHref('/card/afr/132/es/goblin-del-grito-de-guerra-(battle-cry-goblin)', 'https://scryfall.com'),
      { set: 'afr', cn: '132' }
    );
  });

  it('returns null for invalid URLs and non-card paths', () => {
    assert.equal(parseCardIdentityFromHref('https://scryfall.com/search?q=otag%3Aramp'), null);
    assert.equal(parseCardIdentityFromHref('http://%'), null);
    assert.equal(parseCardIdentityFromHref(null), null);
  });
});

describe('Scryfall search URL builders', () => {
  it('builds a tag query token', () => {
    assert.equal(buildTagQueryToken('otag', 'attack-trigger'), 'otag:attack-trigger');
  });

  it('builds a search URL for an arbitrary query', () => {
    assert.equal(
      buildScryfallSearchUrl('otag:attack-trigger'),
      'https://scryfall.com/search?q=otag%3Aattack-trigger'
    );
  });

  it('builds a search URL for one tag', () => {
    assert.equal(
      buildTagSearchUrl('art', 'goblin', 'https://scryfall.com'),
      'https://scryfall.com/search?q=art%3Agoblin'
    );
  });

  it('builds a combined search URL for checked tags', () => {
    assert.equal(
      buildCombinedTagSearchUrl([
        { prefix: 'otag', slug: 'attack-trigger' },
        { prefix: 'art', slug: 'goblin' },
      ], 'https://scryfall.com'),
      'https://scryfall.com/search?q=otag%3Aattack-trigger%20art%3Agoblin'
    );
  });
});

describe('appendTagToSearchQuery', () => {
  it('appends a tag token to an existing query', () => {
    assert.equal(
      appendTagToSearchQuery('otag:hand-neutral', 'otag', 'draw'),
      'otag:hand-neutral otag:draw'
    );
  });

  it('uses the tag token when the query is empty', () => {
    assert.equal(appendTagToSearchQuery('', 'art', 'goblin'), 'art:goblin');
  });

  it('does not duplicate an existing exact token', () => {
    assert.equal(
      appendTagToSearchQuery('otag:draw art:goblin', 'otag', 'draw'),
      'otag:draw art:goblin'
    );
  });
});
