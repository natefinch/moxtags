// Tests for Archidekt page helpers.
// Run with: node --test tests/archidekt-page.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

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

  it('extracts card identity from Archidekt API deck data', () => {
    assert.deepEqual(
      parseCardIdentityFromDeckCard({
        oracleCard: { name: 'Counterspell' },
        card: {
          name: 'Counterspell',
          set: { code: '2XM' },
          collectorNumber: '63',
        },
      }),
      { name: 'Counterspell', set: '2xm', cn: '63' }
    );
  });

  it('extracts card identity from Archidekt current deck API cards array entries', () => {
    assert.deepEqual(
      parseCardIdentityFromDeckCard({
        card: {
          collectorNumber: 'XLN-46',
          edition: { editioncode: 'PLST' },
          oracleCard: { name: 'Arcane Adaptation' },
        },
      }),
      { name: 'Arcane Adaptation', set: 'plst', cn: 'XLN-46' }
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

describe('Archidekt content script startup', () => {
  it('starts on non-deck pages so SPA navigation can activate deck hooks later', async () => {
    const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const observed = [];
    const intervals = [];
    const listeners = [];
    const originals = {
      document: globalThis.document,
      window: globalThis.window,
      history: globalThis.history,
      location: globalThis.location,
      MutationObserver: globalThis.MutationObserver,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
    };

    class FakeMutationObserver {
      observe(target, options) {
        observed.push({ target, options });
      }

      disconnect() {}
    }

    try {
      globalThis.document = document;
      globalThis.window = {
        addEventListener(type, handler) {
          listeners.push({ type, handler });
        },
      };
      globalThis.history = {
        pushState() {},
        replaceState() {},
      };
      globalThis.location = {
        href: 'https://archidekt.com/',
        pathname: '/',
      };
      globalThis.MutationObserver = FakeMutationObserver;
      globalThis.setInterval = (handler, delay) => {
        intervals.push({ handler, delay });
        return intervals.length;
      };
      globalThis.clearInterval = () => {};

      await import(`../src/archidekt_content.js?startup=${Date.now()}`);

      assert.deepEqual(
        listeners.map(listener => listener.type).sort(),
        ['hashchange', 'popstate']
      );
      assert.equal(intervals.length, 1);
      assert.equal(intervals[0].delay, 1000);
      assert.equal(observed.length, 1);
      assert.equal(observed[0].target, document.documentElement);
      assert.deepEqual(observed[0].options, { childList: true, subtree: true });
    } finally {
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) {
          delete globalThis[key];
        } else {
          globalThis[key] = value;
        }
      }
    }
  });
});
