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

function createHarness({ fetchImpl, xhrResponse = deckJson } = {}) {
  const { window, document } = parseHTML('<!doctype html><html><head></head><body></body></html>');

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
      this.status = 200;
      this.responseText = JSON.stringify(xhrResponse);
      this.dispatchEvent(new window.Event('load'));
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
  vm.runInContext(HOOK_SOURCE, sandbox, { filename: 'page_hook.js' });

  return { window, document, calls, postedMessages, XMLHttpRequest: FakeXMLHttpRequest };
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
});

describe('page_hook.js card lookup proxy', () => {
  it('proxies card lookup requests and posts normalized set/cn results', async () => {
    const { window, calls } = createHarness();

    const resultPromise = new Promise(resolve => {
      window.addEventListener('message', function handler(event) {
        if (event.data?.type !== 'moxtags-card-result') return;
        window.removeEventListener('message', handler);
        resolve(event.data);
      });
    });

    const event = new window.Event('message');
    event.data = {
      type: 'moxtags-card-lookup',
      cardId: 'vPo0V',
      requestId: 'req-1',
    };
    window.dispatchEvent(event);

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

    const event = new window.Event('message');
    event.data = {
      type: 'moxtags-card-lookup',
      cardId: 'missing',
      requestId: 'req-404',
    };
    window.dispatchEvent(event);

    const result = await resultPromise;

    assert.equal(result.type, 'moxtags-card-result');
    assert.equal(result.requestId, 'req-404');
    assert.equal(result.cardId, 'missing');
    assert.match(result.error, /HTTP 404/);
  });
});
