// Tests for the MV3 background service worker message handlers.
// Loads src/background.js with mocked chrome APIs and fetch.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ORACLE_ID = 'oracle-e2e';
const ILLUSTRATION_ID = 'illustration-e2e';
const SECOND_ORACLE_ID = 'oracle-second';
const SECOND_ILLUSTRATION_ID = 'illustration-second';

function makeStorageArea(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    async get(keys) {
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map(key => [key, store.get(key)]));
      }
      if (typeof keys === 'string') return { [keys]: store.get(keys) };
      return Object.fromEntries(store.entries());
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    },
    _store: store,
  };
}

function storedIndexes({
  oracleId = ORACLE_ID,
  illustrationId = ILLUSTRATION_ID,
  cardTag = 'stored-card-tag',
  artTag = 'stored-art-tag',
  timestamp = Date.now(),
} = {}) {
  return {
    oracleIndex: [[oracleId, [{ name: cardTag, slug: cardTag }]]],
    illustrationIndex: [[illustrationId, [{ name: artTag, slug: artTag }]]],
    oracleTagNames: [cardTag],
    artTagNames: [artTag],
    tagDataTimestamp: timestamp,
  };
}

function flushAsync() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function loadBackground({ fetchImpl, storageSeed = {}, bundledData = true } = {}) {
  const messageListeners = [];
  const installedListeners = [];
  const startupListeners = [];
  const alarmListeners = [];
  const alarmsCreated = [];
  const storageLocal = makeStorageArea(storageSeed);
  const sessionRules = [];

  globalThis.self = globalThis;
  if (bundledData) {
    globalThis.__MOXTAGS_ORACLE = {
      t: ['card-tag'],
      d: { [ORACLE_ID]: [0] },
    };
    globalThis.__MOXTAGS_ILLUS_1 = {
      t: ['art-tag'],
      d: { [ILLUSTRATION_ID]: [0] },
    };
    globalThis.__MOXTAGS_ILLUS_2 = {
      t: ['art-tag'],
      d: {},
    };
  } else {
    delete globalThis.__MOXTAGS_ORACLE;
    delete globalThis.__MOXTAGS_ILLUS_1;
    delete globalThis.__MOXTAGS_ILLUS_2;
  }
  globalThis.importScripts = () => {};

  globalThis.fetch = fetchImpl || (async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('/cards/abc/1')) {
      return new Response(JSON.stringify({
        oracle_id: ORACLE_ID,
        illustration_id: ILLUSTRATION_ID,
      }), { status: 200 });
    }
    if (textUrl.includes('/cards/def/2')) {
      return new Response(JSON.stringify({
        oracle_id: SECOND_ORACLE_ID,
        illustration_id: SECOND_ILLUSTRATION_ID,
      }), { status: 200 });
    }
    if (textUrl.includes('/cards/named?')) {
      return new Response(JSON.stringify({
        oracle_id: ORACLE_ID,
        illustration_id: ILLUSTRATION_ID,
      }), { status: 200 });
    }
    if (textUrl.includes('/bulk-data/oracle_tags')) {
      return new Response(JSON.stringify({
        download_uri: 'https://data.scryfall.io/oracle-tags/test.json',
      }), { status: 200 });
    }
    if (textUrl.includes('/bulk-data/art_tags')) {
      return new Response(JSON.stringify({
        download_uri: 'https://data.scryfall.io/art-tags/test.json',
      }), { status: 200 });
    }
    if (textUrl.includes('/oracle-tags/test.json')) {
      return new Response(JSON.stringify([
        { label: 'card-tag', slug: 'card-tag', taggings: [{ oracle_id: ORACLE_ID }] },
      ]), { status: 200 });
    }
    if (textUrl.includes('/art-tags/test.json')) {
      return new Response(JSON.stringify([
        { label: 'art-tag', slug: 'art-tag', taggings: [{ illustration_id: ILLUSTRATION_ID }] },
      ]), { status: 200 });
    }
    if (textUrl.startsWith('chrome-extension://')) {
      return new Response('{}', { status: 404 });
    }
    return new Response('background body', { status: 200 });
  });

  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: '1.8.0' }),
      getURL: path => `chrome-extension://moxtags/${path}`,
      onMessage: { addListener: fn => messageListeners.push(fn) },
      onInstalled: { addListener: fn => installedListeners.push(fn) },
      onStartup: { addListener: fn => startupListeners.push(fn) },
      lastError: null,
    },
    storage: { local: storageLocal },
    alarms: {
      create: (name, info) => alarmsCreated.push({ name, info }),
      onAlarm: { addListener: fn => alarmListeners.push(fn) },
    },
    declarativeNetRequest: {
      updateSessionRules: rules => sessionRules.push(rules),
    },
  };

  await import(`../src/background.js?test=${Date.now()}-${Math.random()}`);

  return {
    listener: messageListeners[0],
    installedListeners,
    startupListeners,
    alarmListeners,
    alarmsCreated,
    storageLocal,
    sessionRules,
  };
}

function sendMessage(listener, message) {
  let keepAlive;
  const response = new Promise(resolve => {
    keepAlive = listener(message, {}, resolve);
  });
  return { keepAlive, response };
}

describe('background message handling', () => {
  it('handles fetch messages asynchronously and returns true', async () => {
    const { listener } = await loadBackground();

    const { keepAlive, response } = sendMessage(listener, {
      type: 'fetch',
      url: 'https://example.test/data',
    });

    assert.equal(keepAlive, true);
    assert.deepEqual(await response, {
      ok: true,
      status: 200,
      body: 'background body',
    });
  });

  it('handles fetchTags with bundled indexes and Scryfall card fallback', async () => {
    const { listener } = await loadBackground();

    const { keepAlive, response } = sendMessage(listener, {
      type: 'fetchTags',
      set: 'abc',
      number: '1',
    });

    assert.equal(keepAlive, true);
    const result = await response;
    assert.equal(result.ok, true);
    assert.deepEqual(result.artTags, [{ name: 'art-tag', slug: 'art-tag' }]);
    assert.deepEqual(result.cardTags, [{ name: 'card-tag', slug: 'card-tag' }]);
    assert.equal(typeof result.cacheLoading, 'boolean');
  });

  it('handles fetchTagsByName through the named Scryfall endpoint', async () => {
    const { listener } = await loadBackground();

    const { keepAlive, response } = sendMessage(listener, {
      type: 'fetchTagsByName',
      name: 'Any Card',
    });

    assert.equal(keepAlive, true);
    const result = await response;
    assert.equal(result.ok, true);
    assert.deepEqual(result.artTags, [{ name: 'art-tag', slug: 'art-tag' }]);
    assert.deepEqual(result.cardTags, [{ name: 'card-tag', slug: 'card-tag' }]);
    assert.equal(typeof result.cacheLoading, 'boolean');
  });

  it('registers install/startup/alarm handlers and updates the Scryfall User-Agent rule', async () => {
    const { installedListeners, startupListeners, alarmListeners, sessionRules } = await loadBackground();

    assert.equal(installedListeners.length, 1);
    assert.equal(startupListeners.length, 1);
    assert.equal(alarmListeners.length, 1);

    installedListeners[0]();

    assert.equal(sessionRules.length, 1);
    assert.equal(sessionRules[0].addRules[0].condition.requestDomains[0], 'api.scryfall.com');
    assert.equal(sessionRules[0].addRules[0].action.requestHeaders[0].value, 'MoxTags/1.8.0');
  });

  it('loads tag names and returns status after indexes are initialized', async () => {
    const { listener } = await loadBackground();

    const names = sendMessage(listener, { type: 'getTagNames' });
    assert.equal(names.keepAlive, true);
    assert.deepEqual(await names.response, {
      ok: true,
      oracleTagNames: ['card-tag'],
      artTagNames: ['art-tag'],
    });

    const { keepAlive, response } = sendMessage(listener, { type: 'getStatus' });

    assert.equal(keepAlive, true);
    const status = await response;
    assert.equal(status.oracleCount, 1);
    assert.equal(status.illustrationCount, 1);
  });

  it('returns true for every asynchronous message path', async () => {
    const { listener } = await loadBackground();
    const messages = [
      { type: 'fetch', url: 'https://example.test/data' },
      { type: 'fetchTags', set: 'abc', number: '1' },
      { type: 'fetchTagsByName', name: 'Any Card' },
      { type: 'prefetchDeck', cards: [{ set: 'abc', cn: '1' }] },
      { type: 'getStatus' },
      { type: 'refreshTags' },
      { type: 'getTagNames' },
    ];

    for (const message of messages) {
      const { keepAlive, response } = sendMessage(listener, message);
      assert.equal(keepAlive, true, `${message.type} should keep the message channel alive`);
      await response;
    }
  });

  it('cold-starts from persisted indexes when bundled globals are unavailable', async () => {
    const { listener } = await loadBackground({
      bundledData: false,
      storageSeed: storedIndexes(),
      fetchImpl: async (url) => {
        throw new Error(`unexpected fetch for ${url}`);
      },
    });

    const names = sendMessage(listener, { type: 'getTagNames' });
    assert.equal(names.keepAlive, true);
    assert.deepEqual(await names.response, {
      ok: true,
      oracleTagNames: ['stored-card-tag'],
      artTagNames: ['stored-art-tag'],
    });

    const status = await sendMessage(listener, { type: 'getStatus' }).response;
    assert.equal(status.oracleCount, 1);
    assert.equal(status.illustrationCount, 1);
  });

  it('keeps prefetchDeck results for cards resolved before partial collection misses', async () => {
    const { listener } = await loadBackground({
      fetchImpl: async (url) => {
        const textUrl = String(url);
        if (textUrl.startsWith('chrome-extension://')) {
          return new Response('{}', { status: 404 });
        }
        if (textUrl.includes('/cards/collection')) {
          return new Response(JSON.stringify({
            data: [{
              set: 'abc',
              collector_number: '1',
              oracle_id: ORACLE_ID,
              illustration_id: ILLUSTRATION_ID,
            }],
          }), { status: 200 });
        }
        return new Response('unexpected', { status: 500 });
      },
    });

    const { keepAlive, response } = sendMessage(listener, {
      type: 'prefetchDeck',
      cards: [{ set: 'abc', cn: '1' }, { set: 'missing', cn: '9' }],
    });

    assert.equal(keepAlive, true);
    const result = await response;
    assert.equal(result.ok, true);
    assert.deepEqual(Object.keys(result.tags), ['abc/1']);
    assert.deepEqual(result.tags['abc/1'].cardTags, [{ name: 'card-tag', slug: 'card-tag' }]);
  });

  it('does not poison the card cache after a failed exact lookup', async () => {
    let exactLookups = 0;
    const { listener } = await loadBackground({
      fetchImpl: async (url) => {
        const textUrl = String(url);
        if (textUrl.startsWith('chrome-extension://')) {
          return new Response('{}', { status: 404 });
        }
        if (textUrl.includes('/cards/miss/1')) {
          exactLookups++;
          if (exactLookups === 1) {
            return new Response('temporary failure', { status: 503 });
          }
          return new Response(JSON.stringify({
            oracle_id: ORACLE_ID,
            illustration_id: ILLUSTRATION_ID,
          }), { status: 200 });
        }
        return new Response('unexpected', { status: 500 });
      },
    });

    const first = await sendMessage(listener, { type: 'fetchTags', set: 'miss', number: '1' }).response;
    assert.equal(first.ok, false);
    assert.match(first.error, /HTTP 503/);

    const second = await sendMessage(listener, { type: 'fetchTags', set: 'miss', number: '1' }).response;
    assert.equal(second.ok, true);
    assert.deepEqual(second.cardTags, [{ name: 'card-tag', slug: 'card-tag' }]);
    assert.equal(exactLookups, 2);
  });

  it('updates refreshTags status on success and failure', async () => {
    const success = await loadBackground({ bundledData: false });
    const successResult = await sendMessage(success.listener, { type: 'refreshTags' }).response;
    assert.deepEqual(successResult, { ok: true });

    const successStatus = await sendMessage(success.listener, { type: 'getStatus' }).response;
    assert.equal(successStatus.oracleCount, 1);
    assert.equal(successStatus.illustrationCount, 1);
    assert.equal(successStatus.lastError, null);

    const failure = await loadBackground({
      bundledData: false,
      fetchImpl: async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('/bulk-data/oracle_tags')) {
          return new Response('no oracle tags', { status: 503 });
        }
        if (textUrl.includes('/bulk-data/art_tags')) {
          return new Response(JSON.stringify({
            download_uri: 'https://data.scryfall.io/art-tags/test.json',
          }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      },
    });

    const failureResult = await sendMessage(failure.listener, { type: 'refreshTags' }).response;
    assert.equal(failureResult.ok, false);
    assert.match(failureResult.error, /oracle=503/);

    const failureStatus = await sendMessage(failure.listener, { type: 'getStatus' }).response;
    assert.match(failureStatus.lastError, /oracle=503/);
    assert.equal(failureStatus.refreshing, false);
  });

  it('runs alarm-triggered refreshes and schedules success and retry alarms', async () => {
    const success = await loadBackground({ bundledData: false });
    success.alarmListeners[0]({ name: 'refreshTagData' });
    await flushAsync();

    assert.equal(success.alarmsCreated.length, 1);
    assert.equal(success.alarmsCreated[0].name, 'refreshTagData');
    assert.ok(success.alarmsCreated[0].info.delayInMinutes >= 24 * 60);

    const failure = await loadBackground({
      bundledData: false,
      fetchImpl: async () => new Response('tag API unavailable', { status: 500 }),
    });
    failure.alarmListeners[0]({ name: 'refreshTagData' });
    await flushAsync();

    assert.deepEqual(failure.alarmsCreated, [{
      name: 'refreshTagData',
      info: { delayInMinutes: 60 },
    }]);
  });
});
