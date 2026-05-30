// Tests for shared tag autocomplete DOM controller.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { createTagAutocomplete } from '../src/shared/tag-autocomplete-ui.js';

let previousGlobals = null;

function installDom(html = '<!doctype html><html><body><input id="q"></body></html>') {
  const { window, document } = parseHTML(html);
  previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    Element: globalThis.Element,
    HTMLInputElement: globalThis.HTMLInputElement,
    HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
    Event: globalThis.Event,
    KeyboardEvent: globalThis.KeyboardEvent,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };

  globalThis.window = window;
  globalThis.document = document;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.Element = window.Element;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.HTMLTextAreaElement = window.HTMLTextAreaElement;
  globalThis.Event = window.Event;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);

  window.HTMLInputElement.prototype.setSelectionRange = function (start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  };
  window.HTMLInputElement.prototype.focus = function () {};
  window.Element.prototype.scrollIntoView = function () {};

  return { window, document };
}

afterEach(() => {
  if (!previousGlobals) return;
  for (const [key, value] of Object.entries(previousGlobals)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  previousGlobals = null;
});

function createController(input, options = {}) {
  let sendCount = 0;
  const controller = createTagAutocomplete({
    findInputs: () => [input],
    observeMutations: false,
    sendMessage: (message, callback) => {
      sendCount++;
      assert.deepEqual(message, { type: 'getTagNames' });
      callback({
        ok: true,
        oracleTagNames: ['card-advantage', 'card-draw', 'creature-removal'],
        artTagNames: ['black-and-white', 'landscape', 'water'],
      });
    },
    ...options,
  });
  return { controller, getSendCount: () => sendCount };
}

function setInput(input, value) {
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function keydown(input, key) {
  const event = new Event('keydown', { bubbles: true, cancelable: true });
  event.key = key;
  input.dispatchEvent(event);
  return event;
}

describe('createTagAutocomplete', () => {
  it('renders oracle tag suggestions after loading tag names', async () => {
    const { document } = installDom();
    const input = document.getElementById('q');
    const { controller, getSendCount } = createController(input);

    controller.setup();
    setInput(input, 'otag:card');
    await new Promise(resolve => setTimeout(resolve, 0));

    const dropdown = document.querySelector('.moxtags-autocomplete');
    assert.ok(dropdown);
    assert.equal(getSendCount(), 1);
    assert.deepEqual(
      [...dropdown.querySelectorAll('.moxtags-autocomplete-item')].map(el => el.textContent),
      ['card-advantage', 'card-draw'],
    );
  });

  it('selects the highlighted item with Enter and dispatches input/change', async () => {
    const { document } = installDom();
    const input = document.getElementById('q');
    const events = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    const { controller } = createController(input, {
      selectOnEnter: true,
      dispatchChangeOnSelect: true,
    });

    controller.setup();
    setInput(input, 'art:black');
    await new Promise(resolve => setTimeout(resolve, 0));

    keydown(input, 'Enter');

    assert.equal(input.value, 'art:black-and-white ');
    assert.deepEqual(events.slice(-2), ['input', 'change']);
    assert.equal(document.querySelector('.moxtags-autocomplete'), null);
  });

  it('uses arrow keys to change the highlighted item before Tab selection', async () => {
    const { document } = installDom();
    const input = document.getElementById('q');
    const { controller } = createController(input);

    controller.setup();
    setInput(input, 'otag:card');
    await new Promise(resolve => setTimeout(resolve, 0));

    keydown(input, 'ArrowDown');
    keydown(input, 'Tab');

    assert.equal(input.value, 'otag:card-draw ');
  });

  it('closes suggestions on Escape without mutating the input', async () => {
    const { document } = installDom();
    const input = document.getElementById('q');
    const { controller } = createController(input);

    controller.setup();
    setInput(input, 'otag:card');
    await new Promise(resolve => setTimeout(resolve, 0));

    keydown(input, 'Escape');

    assert.equal(input.value, 'otag:card');
    assert.equal(document.querySelector('.moxtags-autocomplete'), null);
  });

  it('does not attach duplicate listeners when setup runs repeatedly', async () => {
    const { document } = installDom();
    const input = document.getElementById('q');
    const { controller, getSendCount } = createController(input);

    controller.setup();
    controller.setup();
    setInput(input, 'otag:card');
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(getSendCount(), 1);
    assert.equal(document.querySelectorAll('.moxtags-autocomplete').length, 1);
  });

  it('detach removes dropdown and event listeners', async () => {
    const { document } = installDom();
    const input = document.getElementById('q');
    const { controller } = createController(input);

    controller.setup();
    setInput(input, 'otag:card');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(document.querySelector('.moxtags-autocomplete'));

    controller.detach();
    assert.equal(document.querySelector('.moxtags-autocomplete'), null);

    setInput(input, 'otag:creature');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(document.querySelector('.moxtags-autocomplete'), null);
  });
});
