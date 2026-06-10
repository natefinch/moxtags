// Tests for Scryfall API interaction functions (scryfall/api.js).
// All functions accept a fetchFn for dependency injection, so we test
// with mock fetch implementations — no network calls needed.
// Run with: node --test tests/scryfall-api.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchTagIndexes,
  fetchCard,
  fetchCardByName,
  fetchCardCollection,
} from '../src/scryfall/api.js';

/** Create a mock Response object. */
function mockResponse(body, { status = 200, ok = true } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Create a mock fetch that returns canned responses by URL pattern. */
function createMockFetch(routes = {}) {
  return async (url, init) => {
    for (const [pattern, handler] of Object.entries(routes)) {
      if (url.includes(pattern)) {
        return typeof handler === 'function' ? handler(url, init) : handler;
      }
    }
    return mockResponse({}, { status: 404, ok: false });
  };
}

// ---------------------------------------------------------------------------
// fetchTagIndexes
// ---------------------------------------------------------------------------

describe('fetchTagIndexes', () => {
  const oracleMetadata = { download_uri: 'https://data.example.com/oracle-tags.json' };
  const illustrationMetadata = { download_uri: 'https://data.example.com/art-tags.json' };
  const oracleData = [
    {
      label: 'Creature Removal',
      slug: 'creature-removal',
      taggings: [{ oracle_id: 'id-1' }, { oracle_id: 'id-2' }],
    },
    { label: 'Card Draw', slug: 'card-draw', taggings: [{ oracle_id: 'id-3' }] },
  ];
  const illustrationData = [
    { label: 'Mountain', slug: 'mountain', taggings: [{ illustration_id: 'ill-1' }] },
  ];

  it('fetches metadata and builds reverse indexes from both bulk-data files', async () => {
    const fetchFn = createMockFetch({
      'bulk-data/oracle_tags': mockResponse(oracleMetadata),
      'bulk-data/art_tags': mockResponse(illustrationMetadata),
      'oracle-tags.json': mockResponse(oracleData),
      'art-tags.json': mockResponse(illustrationData),
    });

    const result = await fetchTagIndexes(fetchFn);

    assert.ok(result.oracleIndex instanceof Map);
    assert.ok(result.illustrationIndex instanceof Map);
    assert.deepEqual(result.oracleIndex.get('id-1'), [{
      name: 'Creature Removal',
      slug: 'creature-removal',
    }]);
    assert.deepEqual(result.illustrationIndex.get('ill-1'), [{
      name: 'Mountain',
      slug: 'mountain',
    }]);
    assert.deepEqual(result.oracleTagNames, ['card-draw', 'creature-removal']);
    assert.deepEqual(result.artTagNames, ['mountain']);
  });

  it('throws on HTTP error from oracle metadata endpoint', async () => {
    const fetchFn = createMockFetch({
      'bulk-data/oracle_tags': mockResponse({}, { status: 500, ok: false }),
      'bulk-data/art_tags': mockResponse(illustrationMetadata),
    });

    await assert.rejects(
      () => fetchTagIndexes(fetchFn),
      /Tag metadata fetch failed/,
    );
  });

  it('throws when metadata omits a download URI', async () => {
    const fetchFn = createMockFetch({
      'bulk-data/oracle_tags': mockResponse({}),
      'bulk-data/art_tags': mockResponse(illustrationMetadata),
    });

    await assert.rejects(
      () => fetchTagIndexes(fetchFn),
      /missing a download_uri/,
    );
  });

  it('throws on HTTP error from a tag data file', async () => {
    const fetchFn = createMockFetch({
      'bulk-data/oracle_tags': mockResponse(oracleMetadata),
      'bulk-data/art_tags': mockResponse(illustrationMetadata),
      'oracle-tags.json': mockResponse({}, { status: 503, ok: false }),
      'art-tags.json': mockResponse(illustrationData),
    });

    await assert.rejects(
      () => fetchTagIndexes(fetchFn),
      /Tag data fetch failed/,
    );
  });

  it('uses custom URLs when provided', async () => {
    const urls = [];
    const fetchFn = async (url) => {
      urls.push(url);
      if (url.endsWith('/oracle')) {
        return mockResponse({ download_uri: 'https://downloads.example.com/oracle.json' });
      }
      if (url.endsWith('/illustration')) {
        return mockResponse({ download_uri: 'https://downloads.example.com/illustration.json' });
      }
      return mockResponse([]);
    };

    await fetchTagIndexes(fetchFn, {
      oracleUrl: 'https://custom.example.com/oracle',
      illustrationUrl: 'https://custom.example.com/illustration',
    });

    assert.ok(urls.includes('https://custom.example.com/oracle'));
    assert.ok(urls.includes('https://custom.example.com/illustration'));
    assert.ok(urls.includes('https://downloads.example.com/oracle.json'));
    assert.ok(urls.includes('https://downloads.example.com/illustration.json'));
  });

  it('passes headers and credentials: "omit" to every fetch', async () => {
    const capturedInits = [];
    const fetchFn = async (url, init) => {
      capturedInits.push(init);
      if (url.includes('oracle_tags')) {
        return mockResponse({ download_uri: 'https://downloads.example.com/oracle.json' });
      }
      if (url.includes('art_tags')) {
        return mockResponse({ download_uri: 'https://downloads.example.com/art.json' });
      }
      return mockResponse([]);
    };

    await fetchTagIndexes(fetchFn, { headers: { 'X-Test': 'yes' } });

    assert.equal(capturedInits.length, 4);
    for (const init of capturedInits) {
      assert.equal(init.credentials, 'omit');
      assert.equal(init.headers['X-Test'], 'yes');
    }
  });
});

// ---------------------------------------------------------------------------
// fetchCard
// ---------------------------------------------------------------------------

describe('fetchCard', () => {
  it('fetches a card by set/cn and returns oracle/illustration IDs', async () => {
    const cardData = {
      oracle_id: 'oracle-123',
      illustration_id: 'illust-456',
    };
    const fetchFn = createMockFetch({ 'cards/neo/42': mockResponse(cardData) });

    const result = await fetchCard('neo', '42', fetchFn);

    assert.deepEqual(result, { oracleId: 'oracle-123', illustrationId: 'illust-456' });
  });

  it('URL-encodes set code and collector number', async () => {
    let capturedUrl;
    const fetchFn = async (url) => {
      capturedUrl = url;
      return mockResponse({ oracle_id: 'a', illustration_id: 'b' });
    };

    await fetchCard('woe', '123★', fetchFn);

    assert.ok(capturedUrl.includes('woe'));
    assert.ok(capturedUrl.includes(encodeURIComponent('123★')));
  });

  it('throws on HTTP error', async () => {
    const fetchFn = createMockFetch({
      'cards/': mockResponse({}, { status: 404, ok: false }),
    });

    await assert.rejects(
      () => fetchCard('bad', '999', fetchFn),
      /HTTP 404/,
    );
  });

  it('handles cards with null illustration_id', async () => {
    const fetchFn = createMockFetch({
      'cards/': mockResponse({ oracle_id: 'o1', illustration_id: null }),
    });

    const result = await fetchCard('lea', '1', fetchFn);
    assert.equal(result.illustrationId, null);
  });
});

// ---------------------------------------------------------------------------
// fetchCardByName
// ---------------------------------------------------------------------------

describe('fetchCardByName', () => {
  it('fetches a card by exact name', async () => {
    const fetchFn = createMockFetch({
      'named': mockResponse({ oracle_id: 'o-bolt', illustration_id: 'i-bolt' }),
    });

    const result = await fetchCardByName('Lightning Bolt', fetchFn);

    assert.deepEqual(result, { oracleId: 'o-bolt', illustrationId: 'i-bolt' });
  });

  it('URL-encodes card names with special characters', async () => {
    let capturedUrl;
    const fetchFn = async (url) => {
      capturedUrl = url;
      return mockResponse({ oracle_id: 'a', illustration_id: 'b' });
    };

    await fetchCardByName("Izzet Charm // Izzet Charm", fetchFn);

    assert.ok(capturedUrl.includes(encodeURIComponent("Izzet Charm // Izzet Charm")));
  });

  it('throws on HTTP error (card not found)', async () => {
    const fetchFn = createMockFetch({
      'named': mockResponse({}, { status: 404, ok: false }),
    });

    await assert.rejects(
      () => fetchCardByName('Not A Real Card', fetchFn),
      /HTTP 404/,
    );
  });
});

// ---------------------------------------------------------------------------
// fetchCardCollection
// ---------------------------------------------------------------------------

describe('fetchCardCollection', () => {
  const mkCard = (set, cn, oracleId, illustrationId) => ({
    set, collector_number: cn, oracle_id: oracleId, illustration_id: illustrationId,
  });

  it('fetches a single batch of cards', async () => {
    const fetchFn = createMockFetch({
      'collection': mockResponse({
        data: [
          mkCard('neo', '42', 'o1', 'i1'),
          mkCard('mkm', '7', 'o2', 'i2'),
        ],
      }),
    });

    const cards = [{ set: 'neo', cn: '42' }, { set: 'mkm', cn: '7' }];
    const result = await fetchCardCollection(cards, fetchFn, { delayMs: 0 });

    assert.equal(result.size, 2);
    assert.deepEqual(result.get('neo/42'), { oracleId: 'o1', illustrationId: 'i1' });
    assert.deepEqual(result.get('mkm/7'), { oracleId: 'o2', illustrationId: 'i2' });
  });

  it('batches requests when cards exceed batchSize', async () => {
    let requestCount = 0;
    const allCards = [];
    for (let i = 0; i < 10; i++) {
      allCards.push({ set: 'tst', cn: String(i) });
    }

    const fetchFn = async (url, init) => {
      requestCount++;
      const body = JSON.parse(init.body);
      const responseCards = body.identifiers.map(id =>
        mkCard(id.set, id.collector_number, `o-${id.collector_number}`, `i-${id.collector_number}`)
      );
      return mockResponse({ data: responseCards });
    };

    const result = await fetchCardCollection(allCards, fetchFn, {
      batchSize: 3,
      delayMs: 0,
    });

    assert.equal(requestCount, 4, 'should make 4 requests for 10 cards with batchSize 3');
    assert.equal(result.size, 10);
    assert.deepEqual(result.get('tst/0'), { oracleId: 'o-0', illustrationId: 'i-0' });
    assert.deepEqual(result.get('tst/9'), { oracleId: 'o-9', illustrationId: 'i-9' });
  });

  it('handles exactly batchSize cards in a single request', async () => {
    let requestCount = 0;
    const cards = [{ set: 'a', cn: '1' }, { set: 'b', cn: '2' }, { set: 'c', cn: '3' }];

    const fetchFn = async (url, init) => {
      requestCount++;
      const body = JSON.parse(init.body);
      return mockResponse({
        data: body.identifiers.map(id =>
          mkCard(id.set, id.collector_number, 'o', 'i')
        ),
      });
    };

    await fetchCardCollection(cards, fetchFn, { batchSize: 3, delayMs: 0 });

    assert.equal(requestCount, 1, 'exact batchSize should be a single request');
  });

  it('continues on partial batch failure', async () => {
    let callNum = 0;
    const fetchFn = async (url, init) => {
      callNum++;
      if (callNum === 2) {
        // Second batch fails.
        return mockResponse({}, { status: 500, ok: false });
      }
      const body = JSON.parse(init.body);
      return mockResponse({
        data: body.identifiers.map(id =>
          mkCard(id.set, id.collector_number, `o-${id.collector_number}`, null)
        ),
      });
    };

    const cards = [];
    for (let i = 0; i < 6; i++) cards.push({ set: 'x', cn: String(i) });

    const result = await fetchCardCollection(cards, fetchFn, {
      batchSize: 2,
      delayMs: 0,
    });

    // Batch 1 (cn 0,1): success. Batch 2 (cn 2,3): fail. Batch 3 (cn 4,5): success.
    assert.equal(result.size, 4, 'should have results from successful batches only');
    assert.ok(result.has('x/0'));
    assert.ok(result.has('x/1'));
    assert.ok(!result.has('x/2'), 'failed batch cards should not be in results');
    assert.ok(!result.has('x/3'));
    assert.ok(result.has('x/4'));
    assert.ok(result.has('x/5'));
  });

  it('handles empty card list', async () => {
    let called = false;
    const fetchFn = async () => { called = true; return mockResponse({ data: [] }); };

    const result = await fetchCardCollection([], fetchFn, { delayMs: 0 });

    assert.equal(result.size, 0);
    assert.equal(called, false, 'should not make any requests for empty input');
  });

  it('handles network errors gracefully', async () => {
    const fetchFn = async () => { throw new Error('network error'); };
    const cards = [{ set: 'a', cn: '1' }];

    const result = await fetchCardCollection(cards, fetchFn, { delayMs: 0 });

    assert.equal(result.size, 0, 'network error should not throw, just return empty');
  });

  it('normalizes set codes to lowercase in result keys', async () => {
    const fetchFn = createMockFetch({
      'collection': mockResponse({
        data: [mkCard('NEO', '42', 'o1', 'i1')],
      }),
    });

    const result = await fetchCardCollection(
      [{ set: 'NEO', cn: '42' }],
      fetchFn,
      { delayMs: 0 },
    );

    assert.ok(result.has('neo/42'), 'set code should be lowercased in key');
    assert.ok(!result.has('NEO/42'));
  });

  it('skips cards with missing set or cn in response', async () => {
    const fetchFn = createMockFetch({
      'collection': mockResponse({
        data: [
          mkCard('neo', '42', 'o1', 'i1'),
          { oracle_id: 'o2', illustration_id: 'i2' }, // missing set/cn
          mkCard('', '1', 'o3', 'i3'), // empty set
        ],
      }),
    });

    const cards = [{ set: 'neo', cn: '42' }, { set: 'x', cn: '1' }, { set: 'y', cn: '2' }];
    const result = await fetchCardCollection(cards, fetchFn, { delayMs: 0 });

    assert.equal(result.size, 1, 'should only include cards with valid set/cn');
    assert.ok(result.has('neo/42'));
  });

  it('sends correct request body with POST method and Content-Type', async () => {
    let capturedInit;
    const fetchFn = async (url, init) => {
      capturedInit = init;
      return mockResponse({ data: [] });
    };

    await fetchCardCollection(
      [{ set: 'neo', cn: '42' }],
      fetchFn,
      { delayMs: 0 },
    );

    assert.equal(capturedInit.method, 'POST');
    assert.equal(capturedInit.headers['Content-Type'], 'application/json');
    assert.equal(capturedInit.credentials, 'omit');

    const body = JSON.parse(capturedInit.body);
    assert.deepEqual(body.identifiers, [{ set: 'neo', collector_number: '42' }]);
  });
});
