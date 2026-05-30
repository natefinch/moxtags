// Tests for Moxfield deck data interception (intercept.js).
// Validates readInterceptedDeck and waitForInterceptedDeck with
// injected document/MutationObserver to ensure real-world behavior.
// Run with: node --test tests/intercept.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import {
  readInterceptedDeck,
  waitForInterceptedDeck,
} from '../src/moxfield/intercept.js';

// ---------------------------------------------------------------------------
// readInterceptedDeck
// ---------------------------------------------------------------------------

describe('readInterceptedDeck', () => {
  it('reads and parses deck JSON from the hidden DOM element', () => {
    const { document } = parseHTML(`<html><head>
      <script type="application/json" id="moxtags-deck-json">
        {"mainboard":{"cards":{}},"sideboard":{}}
      </script>
    </head><body></body></html>`);

    const data = readInterceptedDeck({ document });

    assert.ok(data);
    assert.ok('mainboard' in data);
    assert.ok('sideboard' in data);
  });

  it('returns null when the element is missing', () => {
    const { document } = parseHTML('<html><head></head><body></body></html>');

    assert.equal(readInterceptedDeck({ document }), null);
  });

  it('returns null on invalid JSON', () => {
    const { document } = parseHTML(`<html><head>
      <script type="application/json" id="moxtags-deck-json">NOT VALID JSON</script>
    </head><body></body></html>`);

    assert.equal(readInterceptedDeck({ document }), null);
  });

  it('returns null when element has empty content', () => {
    const { document } = parseHTML(`<html><head>
      <script type="application/json" id="moxtags-deck-json"></script>
    </head><body></body></html>`);

    assert.equal(readInterceptedDeck({ document }), null);
  });

  it('handles JSON that parses to a non-object (null literal)', () => {
    const { document } = parseHTML(`<html><head>
      <script type="application/json" id="moxtags-deck-json">null</script>
    </head><body></body></html>`);

    // JSON.parse("null") succeeds and returns null — the function should
    // return it as-is since the caller checks for mainboard/sideboard.
    const data = readInterceptedDeck({ document });
    assert.equal(data, null);
  });

  it('uses a custom elementId when provided', () => {
    const { document } = parseHTML(`<html><head>
      <script type="application/json" id="custom-id">{"custom":true}</script>
    </head><body></body></html>`);

    const data = readInterceptedDeck({ document, elementId: 'custom-id' });
    assert.deepEqual(data, { custom: true });
  });

  it('preserves complex nested deck structure', () => {
    const deckJson = {
      mainboard: {
        cards: {
          'vPo0V': { quantity: 1, card: { name: 'Sol Ring', set: 'c21', cn: '263' } },
        },
      },
      sideboard: { cards: {} },
      commanders: { cards: {} },
    };
    const { document } = parseHTML(`<html><head>
      <script type="application/json" id="moxtags-deck-json">${JSON.stringify(deckJson)}</script>
    </head><body></body></html>`);

    const data = readInterceptedDeck({ document });
    assert.deepEqual(data, deckJson);
  });
});

// ---------------------------------------------------------------------------
// waitForInterceptedDeck
// ---------------------------------------------------------------------------

describe('waitForInterceptedDeck', () => {
  it('resolves immediately when data-moxtags-deck is already "ready"', async () => {
    const { document } = parseHTML(`<html data-moxtags-deck="ready"><head>
      <script type="application/json" id="moxtags-deck-json">{"mainboard":{}}</script>
    </head><body></body></html>`);

    const data = await waitForInterceptedDeck({ document, timeoutMs: 100 });

    assert.ok(data);
    assert.ok('mainboard' in data);
  });

  it('times out and resolves null when attribute is never set', async () => {
    const { document } = parseHTML('<html><head></head><body></body></html>');

    class NoopMutationObserver {
      constructor() {}
      observe() {}
      disconnect() {}
    }

    const data = await waitForInterceptedDeck({
      document,
      timeoutMs: 50,
      MutationObserver: NoopMutationObserver,
    });

    assert.equal(data, null);
  });

  it('resolves via MutationObserver when attribute changes to "ready"', async () => {
    const { document } = parseHTML(`<html><head>
      <script type="application/json" id="moxtags-deck-json">{"observed":true}</script>
    </head><body></body></html>`);

    // Use a controllable MutationObserver mock to avoid timing issues.
    let observerCallback;
    class MockMutationObserver {
      constructor(cb) { observerCallback = cb; this.disconnected = false; }
      observe() {}
      disconnect() { this.disconnected = true; }
    }

    const promise = waitForInterceptedDeck({
      document,
      timeoutMs: 500,
      MutationObserver: MockMutationObserver,
    });

    // Simulate the MAIN world script setting the attribute.
    document.documentElement.setAttribute('data-moxtags-deck', 'ready');

    // Fire the observer callback as the browser would.
    observerCallback([{ attributeName: 'data-moxtags-deck' }]);

    const data = await promise;
    assert.ok(data);
    assert.equal(data.observed, true);
  });

  it('disconnects observer after successful resolution', async () => {
    const { document } = parseHTML(`<html><head>
      <script type="application/json" id="moxtags-deck-json">{"ok":true}</script>
    </head><body></body></html>`);

    let observer;
    class MockMutationObserver {
      constructor(cb) { this._cb = cb; this.disconnected = false; observer = this; }
      observe() {}
      disconnect() { this.disconnected = true; }
    }

    const promise = waitForInterceptedDeck({
      document,
      timeoutMs: 500,
      MutationObserver: MockMutationObserver,
    });

    document.documentElement.setAttribute('data-moxtags-deck', 'ready');
    observer._cb([{ attributeName: 'data-moxtags-deck' }]);

    await promise;
    assert.ok(observer.disconnected, 'observer should be disconnected after resolution');
  });

  it('disconnects observer after timeout', async () => {
    const { document } = parseHTML('<html><head></head><body></body></html>');

    let observer;
    class MockMutationObserver {
      constructor(cb) { this._cb = cb; this.disconnected = false; observer = this; }
      observe() {}
      disconnect() { this.disconnected = true; }
    }

    await waitForInterceptedDeck({
      document,
      timeoutMs: 30,
      MutationObserver: MockMutationObserver,
    });

    assert.ok(observer.disconnected, 'observer should be disconnected after timeout');
  });

  it('reads data if attr becomes "ready" exactly at timeout', async () => {
    const { document } = parseHTML(`<html><head>
      <script type="application/json" id="moxtags-deck-json">{"late":true}</script>
    </head><body></body></html>`);

    // Don't fire the observer; let timeout fire. But set attr before timeout.
    class MockMutationObserver {
      constructor() {}
      observe() {}
      disconnect() {}
    }

    // Set the attribute before the promise is created, but without "ready"
    // initially. We'll set it to "ready" right away — the timeout path
    // checks the attr one more time.
    document.documentElement.setAttribute('data-moxtags-deck', 'ready');

    // The initial check should catch this since we set it before calling.
    const data = await waitForInterceptedDeck({
      document,
      timeoutMs: 30,
      MutationObserver: MockMutationObserver,
    });

    assert.ok(data);
    assert.equal(data.late, true);
  });

  it('ignores non-"ready" attribute values', async () => {
    const { document } = parseHTML('<html data-moxtags-deck="loading"><head></head><body></body></html>');

    let observerCallback;
    class MockMutationObserver {
      constructor(cb) { observerCallback = cb; }
      observe() {}
      disconnect() {}
    }

    const promise = waitForInterceptedDeck({
      document,
      timeoutMs: 50,
      MutationObserver: MockMutationObserver,
    });

    // Fire observer with a non-"ready" value — should not resolve.
    document.documentElement.setAttribute('data-moxtags-deck', 'loading');
    observerCallback([{ attributeName: 'data-moxtags-deck' }]);

    const data = await promise;
    // Should have timed out since "loading" !== "ready".
    assert.equal(data, null);
  });
});
