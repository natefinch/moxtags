// Tests for the MV3 background service worker message handlers.
// Loads src/background.js with mocked chrome APIs and fetch.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ORACLE_ID = 'oracle-e2e';
const ILLUSTRATION_ID = 'illustration-e2e';

function makeStorageArea() {
  const store = new Map();
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

async function loadBackground({ fetchImpl } = {}) {
  const messageListeners = [];
  const installedListeners = [];
  const startupListeners = [];
  const alarmListeners = [];
  const storageLocal = makeStorageArea();
  const sessionRules = [];

  globalThis.self = globalThis;
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
  globalThis.importScripts = () => {};

  globalThis.fetch = fetchImpl || (async (url) => {
    const textUrl = String(url);
    if (textUrl.includes('/cards/abc/1')) {
      return new Response(JSON.stringify({
        oracle_id: ORACLE_ID,
        illustration_id: ILLUSTRATION_ID,
      }), { status: 200 });
    }
    if (textUrl.includes('/cards/named?')) {
      return new Response(JSON.stringify({
        oracle_id: ORACLE_ID,
        illustration_id: ILLUSTRATION_ID,
      }), { status: 200 });
    }
    if (textUrl.includes('/private/tags/oracle')) {
      return new Response(JSON.stringify({
        data: [{ label: 'card-tag', oracle_ids: [ORACLE_ID] }],
      }), { status: 200 });
    }
    if (textUrl.includes('/private/tags/illustration')) {
      return new Response(JSON.stringify({
        data: [{ label: 'art-tag', illustration_ids: [ILLUSTRATION_ID] }],
      }), { status: 200 });
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
      create: () => {},
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
});
