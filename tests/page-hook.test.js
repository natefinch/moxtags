// Tests for page_hook.js running as a MAIN-world script.
// The hook is loaded as a raw script in a VM with a linkedom window so these
// tests exercise the actual IIFE and monkey-patching behavior.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const HOOK_SOURCE = readFileSync(new URL('../src/page_hook.js', import.meta.url), 'utf8');
const DECK_URL = 'https://api2.moxfield.com/v3/decks/all/test-deck';
const OTHER_URL = 'https://api2.moxfield.com/v3/not-a-deck/test-deck';
const CARD_URL = 'https://api2.moxfield.com/v2/cards/details/vPo0V';

const deckJson = {
  mainboard: {
    vPo0V: {
      card: { name: 'E2E Test Card', set: 'e2e', cn: '1' },
    },
  },
};

function flushAsync() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function createHarness({
  fetchImpl,
  xhrResponse = deckJson,
  xhrStatus = 200,
  xhrEvent = 'load',
} = {}) {
  const { window, document } = parseHTML('<!doctype html><html><head></head><body></body></html>');
  delete window.__MOXTAGS_PAGE_HOOK_INSTALLED__;

  const postedMessages = [];
  window.postMessage = (data) => {
    postedMessages.push(data);
    queueMicrotask(() => {
      const event = new window.Event('message');
      event.data = data;
      window.dispatchEvent(event);
    });
  };

  class FakeXMLHttpRequest extends window.EventTarget {
    open(method, url) {
      this.method = method;
      this.url = String(url);
    }

    send() {
      this.status = xhrStatus;
      this.responseText = typeof xhrResponse === 'string'
        ? xhrResponse
        : JSON.stringify(xhrResponse);
      this.dispatchEvent(new window.Event(xhrEvent));
    }
  }

  const calls = [];
  const defaultFetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    if (url === DECK_URL) {
      return new Response(JSON.stringify(deckJson), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === CARD_URL) {
      return new Response(JSON.stringify({ card: { set: 'C21', cn: '263' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  window.fetch = fetchImpl || defaultFetch;

  const sandbox = {
    window,
    document,
    XMLHttpRequest: FakeXMLHttpRequest,
    MutationObserver: window.MutationObserver,
    Request,
    Response,
    MessageEvent: window.MessageEvent,
    Event: window.Event,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    queueMicrotask,
  };

  vm.createContext(sandbox);
  const runHook = () => vm.runInContext(HOOK_SOURCE, sandbox, { filename: 'page_hook.js' });
  runHook();

  return { window, document, calls, postedMessages, XMLHttpRequest: FakeXMLHttpRequest, runHook };
}

function readPublishedDeck(document) {
  const el = document.getElementById('moxtags-deck-json');
  return el ? JSON.parse(el.textContent) : null;
}

describe('page_hook.js fetch interception', () => {
  it('publishes intercepted deck JSON from fetch responses', async () => {
    const { window, document } = createHarness();

    const response = await window.fetch(DECK_URL);
    assert.equal(response.ok, true);
    await flushAsync();

    assert.equal(document.documentElement.getAttribute('data-moxtags-deck'), 'ready');
    assert.deepEqual(readPublishedDeck(document), deckJson);
  });

  it('ignores non-deck API fetches', async () => {
    const { window, document } = createHarness();

    await window.fetch(OTHER_URL);
    await flushAsync();

    assert.equal(document.getElementById('moxtags-deck-json'), null);
    assert.equal(document.documentElement.getAttribute('data-moxtags-deck'), null);
  });

  it('does not publish a second deck until content script resets the ready attribute', async () => {
    const secondDeck = { mainboard: { abc: { card: { name: 'Second Card', set: 'abc', cn: '2' } } } };
    let currentDeck = deckJson;
    const { window, document } = createHarness({
      fetchImpl: async () => new Response(JSON.stringify(currentDeck), { status: 200 }),
    });

    await window.fetch(DECK_URL);
    await flushAsync();
    assert.deepEqual(readPublishedDeck(document), deckJson);

    currentDeck = secondDeck;
    await window.fetch(DECK_URL);
    await flushAsync();
    assert.deepEqual(readPublishedDeck(document), deckJson);

    document.documentElement.removeAttribute('data-moxtags-deck');
    await flushAsync();
    assert.equal(document.getElementById('moxtags-deck-json'), null);

    await window.fetch(DECK_URL);
    await flushAsync();
    assert.deepEqual(readPublishedDeck(document), secondDeck);
  });

  it('does not double-wrap fetch or double-publish data if injected twice', async () => {
    const { window, document, runHook } = createHarness();

    runHook();
    await window.fetch(DECK_URL);
    await flushAsync();

    assert.equal(document.querySelectorAll('#moxtags-deck-json').length, 1);
    assert.deepEqual(readPublishedDeck(document), deckJson);
  });

  it('preserves deck fetch rejections without publishing stale data', async () => {
    const { window, document } = createHarness({
      fetchImpl: async () => {
        throw new Error('network unavailable');
      },
    });

    await assert.rejects(() => window.fetch(DECK_URL), /network unavailable/);
    await flushAsync();

    assert.equal(document.getElementById('moxtags-deck-json'), null);
    assert.equal(document.documentElement.getAttribute('data-moxtags-deck'), null);
  });

  it('ignores non-JSON deck fetch responses', async () => {
    const { window, document } = createHarness({
      fetchImpl: async () => new Response('<html>not json</html>', { status: 200 }),
    });

    const response = await window.fetch(DECK_URL);
    assert.equal(response.ok, true);
    await flushAsync();

    assert.equal(document.getElementById('moxtags-deck-json'), null);
    assert.equal(document.documentElement.getAttribute('data-moxtags-deck'), null);
  });
});

describe('page_hook.js XHR interception', () => {
  it('publishes intercepted deck JSON from XMLHttpRequest responses', async () => {
    const { document, XMLHttpRequest } = createHarness();

    const xhr = new XMLHttpRequest();
    xhr.open('GET', DECK_URL);
    xhr.send();
    await flushAsync();

    assert.equal(document.documentElement.getAttribute('data-moxtags-deck'), 'ready');
    assert.deepEqual(readPublishedDeck(document), deckJson);
  });

  it('ignores aborted XHR deck requests', async () => {
    const { document, XMLHttpRequest } = createHarness({ xhrEvent: 'abort' });

    const xhr = new XMLHttpRequest();
    xhr.open('GET', DECK_URL);
    xhr.send();
    await flushAsync();

    assert.equal(document.getElementById('moxtags-deck-json'), null);
    assert.equal(document.documentElement.getAttribute('data-moxtags-deck'), null);
  });

  it('ignores invalid JSON XHR deck responses', async () => {
    const { document, XMLHttpRequest } = createHarness({ xhrResponse: '<html>not json</html>' });

    const xhr = new XMLHttpRequest();
    xhr.open('GET', DECK_URL);
    xhr.send();
    await flushAsync();

    assert.equal(document.getElementById('moxtags-deck-json'), null);
    assert.equal(document.documentElement.getAttribute('data-moxtags-deck'), null);
  });
});

describe('page_hook.js card lookup proxy', () => {
  function dispatchCardLookup(window, cardId, requestId) {
    const event = new window.Event('message');
    event.data = {
      type: 'moxtags-card-lookup',
      cardId,
      requestId,
    };
    window.dispatchEvent(event);
  }

  it('proxies card lookup requests and posts normalized set/cn results', async () => {
    const { window, calls } = createHarness();

    const resultPromise = new Promise(resolve => {
      window.addEventListener('message', function handler(event) {
        if (event.data?.type !== 'moxtags-card-result') return;
        window.removeEventListener('message', handler);
        resolve(event.data);
      });
    });

    dispatchCardLookup(window, 'vPo0V', 'req-1');

    const result = await resultPromise;

    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
      type: 'moxtags-card-result',
      requestId: 'req-1',
      cardId: 'vPo0V',
      set: 'c21',
      cn: '263',
    });
    assert.equal(calls.at(-1).url, CARD_URL);
    assert.equal(calls.at(-1).init.credentials, 'include');
  });

  it('posts an error result when the proxied lookup fails', async () => {
    const { window } = createHarness({
      fetchImpl: async () => new Response('not found', { status: 404 }),
    });

    const resultPromise = new Promise(resolve => {
      window.addEventListener('message', function handler(event) {
        if (event.data?.type !== 'moxtags-card-result') return;
        window.removeEventListener('message', handler);
        resolve(event.data);
      });
    });

    dispatchCardLookup(window, 'missing', 'req-404');

    const result = await resultPromise;

    assert.equal(result.type, 'moxtags-card-result');
    assert.equal(result.requestId, 'req-404');
    assert.equal(result.cardId, 'missing');
    assert.match(result.error, /HTTP 404/);
  });

  it('posts an error result when the proxied lookup fetch rejects', async () => {
    const { window } = createHarness({
      fetchImpl: async () => {
        throw new Error('lookup network failure');
      },
    });

    const resultPromise = new Promise(resolve => {
      window.addEventListener('message', function handler(event) {
        if (event.data?.type !== 'moxtags-card-result') return;
        window.removeEventListener('message', handler);
        resolve(event.data);
      });
    });

    dispatchCardLookup(window, 'missing', 'req-reject');

    const result = await resultPromise;
    assert.equal(result.type, 'moxtags-card-result');
    assert.equal(result.requestId, 'req-reject');
    assert.equal(result.cardId, 'missing');
    assert.match(result.error, /lookup network failure/);
  });

  it('handles concurrent proxied lookup requests independently', async () => {
    const { window } = createHarness({
      fetchImpl: async (input) => {
        const url = typeof input === 'string' ? input : input.url;
        const cardId = decodeURIComponent(url.split('/').pop());
        if (cardId === 'slow') {
          await new Promise(resolve => setTimeout(resolve, 5));
          return new Response(JSON.stringify({ card: { set: 'SLO', cn: '10' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ card: { set: 'FST', cn: '1' } }), { status: 200 });
      },
    });
    const results = [];
    const resultPromise = new Promise(resolve => {
      window.addEventListener('message', (event) => {
        if (event.data?.type !== 'moxtags-card-result') return;
        results.push(event.data);
        if (results.length === 2) resolve(results);
      });
    });

    dispatchCardLookup(window, 'slow', 'req-slow');
    dispatchCardLookup(window, 'fast', 'req-fast');

    await resultPromise;
    const byRequest = Object.fromEntries(results.map(result => [result.requestId, result]));
    assert.equal(byRequest['req-slow'].cardId, 'slow');
    assert.equal(byRequest['req-slow'].set, 'slo');
    assert.equal(byRequest['req-slow'].cn, '10');
    assert.equal(byRequest['req-fast'].cardId, 'fast');
    assert.equal(byRequest['req-fast'].set, 'fst');
    assert.equal(byRequest['req-fast'].cn, '1');
  });

  it('ignores unrelated postMessage events', async () => {
    const { window, calls, postedMessages } = createHarness();

    const event = new window.Event('message');
    event.data = { type: 'unrelated-message', cardId: 'vPo0V', requestId: 'ignored' };
    window.dispatchEvent(event);
    await flushAsync();

    assert.equal(calls.length, 0);
    assert.deepEqual(postedMessages, []);
  });
});
