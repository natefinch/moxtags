// Tests for Moxfield card lookup API proxy (api.js).
// Validates lookupCardByMoxfieldId with an injected FakeWindow that simulates
// the postMessage roundtrip between the ISOLATED content script and
// MAIN-world page_hook.js.
// Run with: node --test tests/api.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { lookupCardByMoxfieldId } from '../src/moxfield/api.js';

/**
 * Minimal window-like object that supports addEventListener, removeEventListener,
 * and postMessage. postMessage dispatches a MessageEvent asynchronously via
 * queueMicrotask, matching real browser behavior.
 */
class FakeWindow extends EventTarget {
  postMessage(data) {
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent('message', { data }));
    });
  }
}

/**
 * Install a responder on the fake window that automatically replies to
 * moxtags-card-lookup messages, simulating page_hook.js behavior.
 */
function installResponder(win, responseMap = {}, { delay = 0 } = {}) {
  win.addEventListener('message', (e) => {
    if (e.data?.type !== 'moxtags-card-lookup') return;
    const cardId = e.data.cardId;
    const requestId = e.data.requestId;
    const response = responseMap[cardId];

    const reply = response
      ? { type: 'moxtags-card-result', requestId, cardId, ...response }
      : { type: 'moxtags-card-result', requestId, cardId, error: 'not found' };

    if (delay > 0) {
      setTimeout(() => win.postMessage(reply), delay);
    } else {
      win.postMessage(reply);
    }
  });
}

// ---------------------------------------------------------------------------
// Cache behavior
// ---------------------------------------------------------------------------

describe('lookupCardByMoxfieldId — cache', () => {
  it('returns cached result immediately without sending postMessage', async () => {
    const win = new FakeWindow();
    let messageSent = false;
    const originalPostMessage = win.postMessage.bind(win);
    win.postMessage = (data) => {
      messageSent = true;
      originalPostMessage(data);
    };

    const cache = new Map([['vPo0V', { set: 'c21', cn: '263' }]]);

    const result = await lookupCardByMoxfieldId('vPo0V', { cache, window: win });

    assert.deepEqual(result, { set: 'c21', cn: '263' });
    assert.equal(messageSent, false, 'should not send postMessage for cached result');
  });

  it('returns null for uncached cardId when no responder exists (timeout)', async () => {
    const win = new FakeWindow();
    const cache = new Map();

    const result = await lookupCardByMoxfieldId('unknown', {
      cache,
      window: win,
      timeoutMs: 30,
    });

    assert.equal(result, null);
  });

  it('does not populate cache on failed lookup', async () => {
    const win = new FakeWindow();
    const cache = new Map();
    installResponder(win, { 'bad': { error: 'API error' } });

    await lookupCardByMoxfieldId('bad', { cache, window: win, timeoutMs: 200 });

    assert.equal(cache.has('bad'), false, 'failed lookup should not be cached');
  });

  it('populates cache after successful lookup', async () => {
    const win = new FakeWindow();
    const cache = new Map();
    installResponder(win, { 'vPo0V': { set: 'c21', cn: '263' } });

    const result = await lookupCardByMoxfieldId('vPo0V', {
      cache,
      window: win,
      timeoutMs: 200,
    });

    assert.deepEqual(result, { set: 'c21', cn: '263' });
    assert.deepEqual(cache.get('vPo0V'), { set: 'c21', cn: '263' });
  });
});

// ---------------------------------------------------------------------------
// postMessage roundtrip
// ---------------------------------------------------------------------------

describe('lookupCardByMoxfieldId — postMessage roundtrip', () => {
  it('resolves with set/cn from a successful response', async () => {
    const win = new FakeWindow();
    installResponder(win, { 'abc12': { set: 'mkm', cn: '42' } });

    const result = await lookupCardByMoxfieldId('abc12', {
      window: win,
      timeoutMs: 200,
    });

    assert.deepEqual(result, { set: 'mkm', cn: '42' });
  });

  it('resolves null on error response', async () => {
    const win = new FakeWindow();
    installResponder(win, { 'err1': { error: 'card not found' } });

    const result = await lookupCardByMoxfieldId('err1', {
      window: win,
      timeoutMs: 200,
    });

    assert.equal(result, null);
  });

  it('resolves null when response has missing set', async () => {
    const win = new FakeWindow();
    installResponder(win, { 'noset': { set: '', cn: '42' } });

    const result = await lookupCardByMoxfieldId('noset', {
      window: win,
      timeoutMs: 200,
    });

    assert.equal(result, null);
  });

  it('resolves null when response has missing cn', async () => {
    const win = new FakeWindow();
    installResponder(win, { 'nocn': { set: 'mkm', cn: '' } });

    const result = await lookupCardByMoxfieldId('nocn', {
      window: win,
      timeoutMs: 200,
    });

    assert.equal(result, null);
  });

  it('calls onResolved callback on success', async () => {
    const win = new FakeWindow();
    installResponder(win, { 'cb1': { set: 'neo', cn: '1' } });

    const resolved = [];
    await lookupCardByMoxfieldId('cb1', {
      window: win,
      timeoutMs: 200,
      onResolved: (cardId, result) => resolved.push({ cardId, result }),
    });

    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].cardId, 'cb1');
    assert.deepEqual(resolved[0].result, { set: 'neo', cn: '1' });
  });

  it('does not call onResolved on failure', async () => {
    const win = new FakeWindow();
    installResponder(win, { 'fail1': { error: 'nope' } });

    const resolved = [];
    await lookupCardByMoxfieldId('fail1', {
      window: win,
      timeoutMs: 200,
      onResolved: (cardId, result) => resolved.push({ cardId, result }),
    });

    assert.equal(resolved.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Timeout and cleanup
// ---------------------------------------------------------------------------

describe('lookupCardByMoxfieldId — timeout and cleanup', () => {
  it('resolves null after timeout', async () => {
    const win = new FakeWindow();
    // No responder installed — should timeout.

    const result = await lookupCardByMoxfieldId('timeout1', {
      window: win,
      timeoutMs: 30,
    });

    assert.equal(result, null);
  });

  it('removes message listener after successful resolution', async () => {
    const win = new FakeWindow();
    installResponder(win, { 'clean1': { set: 'lea', cn: '1' } });

    const listenersBefore = [];
    const originalAdd = win.addEventListener.bind(win);
    const originalRemove = win.removeEventListener.bind(win);
    let addCount = 0;
    let removeCount = 0;
    win.addEventListener = (...args) => { addCount++; return originalAdd(...args); };
    win.removeEventListener = (...args) => { removeCount++; return originalRemove(...args); };

    await lookupCardByMoxfieldId('clean1', { window: win, timeoutMs: 200 });

    assert.ok(addCount > 0, 'should have added a listener');
    assert.ok(removeCount > 0, 'should have removed the listener after resolution');
  });

  it('removes message listener after timeout', async () => {
    const win = new FakeWindow();

    let removeCount = 0;
    const originalRemove = win.removeEventListener.bind(win);
    win.removeEventListener = (...args) => { removeCount++; return originalRemove(...args); };

    await lookupCardByMoxfieldId('clean2', { window: win, timeoutMs: 30 });

    assert.ok(removeCount > 0, 'should have removed the listener after timeout');
  });
});

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

describe('lookupCardByMoxfieldId — concurrent lookups', () => {
  it('resolves the correct response for simultaneous lookups', async () => {
    const win = new FakeWindow();
    installResponder(win, {
      'card-A': { set: 'alpha', cn: '1' },
      'card-B': { set: 'beta', cn: '2' },
    });

    const [resultA, resultB] = await Promise.all([
      lookupCardByMoxfieldId('card-A', { window: win, timeoutMs: 200 }),
      lookupCardByMoxfieldId('card-B', { window: win, timeoutMs: 200 }),
    ]);

    assert.deepEqual(resultA, { set: 'alpha', cn: '1' });
    assert.deepEqual(resultB, { set: 'beta', cn: '2' });
  });

  it('ignores messages for unrelated request IDs', async () => {
    const win = new FakeWindow();
    // Install a responder that also sends an unrelated message.
    win.addEventListener('message', (e) => {
      if (e.data?.type !== 'moxtags-card-lookup') return;
      // Send an unrelated response first.
      win.postMessage({
        type: 'moxtags-card-result',
        requestId: 'wrong-request-id',
        cardId: e.data.cardId,
        set: 'wrong',
        cn: '999',
      });
      // Then send the correct one.
      win.postMessage({
        type: 'moxtags-card-result',
        requestId: e.data.requestId,
        cardId: e.data.cardId,
        set: 'right',
        cn: '1',
      });
    });

    const result = await lookupCardByMoxfieldId('target', {
      window: win,
      timeoutMs: 200,
    });

    assert.deepEqual(result, { set: 'right', cn: '1' });
  });

  it('ignores non-moxtags message events', async () => {
    const win = new FakeWindow();
    installResponder(win, { 'real': { set: 'a', cn: '1' } });

    // Dispatch an unrelated message.
    win.postMessage({ type: 'some-other-extension', data: 'noise' });

    const result = await lookupCardByMoxfieldId('real', {
      window: win,
      timeoutMs: 200,
    });

    assert.deepEqual(result, { set: 'a', cn: '1' });
  });
});
