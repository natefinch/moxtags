// Tests for the extracted installMenuToggle function (shared/menu-toggle.js).
// Tests the ACTUAL source code instead of a reimplemented copy.
// Run with: node --test tests/long-menu-close.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { installMenuToggle } from '../src/shared/menu-toggle.js';

/**
 * Build a minimal DOM fixture and install the menu toggle via the
 * actual source function, then return references for assertions.
 */
function buildMenuFixture() {
  const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  const EventCtor = doc.defaultView.Event;

  const container = doc.createElement('div');
  container.className = 'moxtags-long-tag-container mt-2';

  const btn = doc.createElement('button');
  btn.className = 'btn w-100 btn-secondary';
  btn.type = 'button';
  btn.textContent = 'Art Tags';
  container.appendChild(btn);

  const menu = doc.createElement('div');
  menu.className = 'dropdown-menu moxtags-long-menu';
  container.appendChild(menu);

  const outside = doc.createElement('div');
  outside.className = 'page-content';
  outside.textContent = 'other content';

  doc.body.appendChild(container);
  doc.body.appendChild(outside);

  const callbacks = { openCount: 0, closeCount: 0 };

  // Install the ACTUAL toggle handler from source.
  installMenuToggle({
    button: btn,
    menu,
    container,
    document: doc,
    onOpen: () => callbacks.openCount++,
    onClose: () => callbacks.closeCount++,
  });

  return { doc, EventCtor, container, btn, menu, outside, callbacks };
}

describe('installMenuToggle', () => {
  it('opens the menu when the button is clicked', () => {
    const { btn, menu, callbacks } = buildMenuFixture();

    btn.click();

    assert.ok(menu.classList.contains('show'), 'menu should be open after button click');
    assert.equal(callbacks.openCount, 1, 'onOpen should fire once');
  });

  it('closes the menu when the button is clicked again (toggle)', () => {
    const { btn, menu, callbacks } = buildMenuFixture();

    btn.click();
    assert.ok(menu.classList.contains('show'));

    btn.click();
    assert.ok(!menu.classList.contains('show'), 'menu should close on second click');
    assert.equal(callbacks.closeCount, 1, 'onClose should fire once');
  });

  it('closes the menu when clicking outside the container', async () => {
    const { EventCtor, btn, menu, outside, callbacks } = buildMenuFixture();

    btn.click();
    assert.ok(menu.classList.contains('show'));

    // Wait for the setTimeout(0) that registers the outside-click handler.
    await new Promise(r => setTimeout(r, 10));

    outside.dispatchEvent(new EventCtor('mousedown', { bubbles: true }));

    assert.ok(!menu.classList.contains('show'), 'menu should close on outside click');
    assert.equal(callbacks.closeCount, 1);
  });

  it('does NOT close the menu when clicking inside the container', async () => {
    const { EventCtor, btn, menu } = buildMenuFixture();

    const item = menu.ownerDocument.createElement('div');
    item.textContent = 'tag item';
    menu.appendChild(item);

    btn.click();
    assert.ok(menu.classList.contains('show'));

    await new Promise(r => setTimeout(r, 10));

    item.dispatchEvent(new EventCtor('mousedown', { bubbles: true }));

    assert.ok(menu.classList.contains('show'), 'menu should stay open on inside click');
  });

  it('removes the one-time handler after closing, allowing re-open', async () => {
    const { EventCtor, btn, menu, outside, callbacks } = buildMenuFixture();

    btn.click();
    assert.ok(menu.classList.contains('show'));

    await new Promise(r => setTimeout(r, 10));

    // Close via outside click.
    outside.dispatchEvent(new EventCtor('mousedown', { bubbles: true }));
    assert.ok(!menu.classList.contains('show'));

    // Re-open.
    btn.click();
    assert.ok(menu.classList.contains('show'), 'menu should re-open');
    assert.equal(callbacks.openCount, 2, 'onOpen should fire again on re-open');
  });

  it('closes other open menus when a new one opens', () => {
    const { doc, btn, menu } = buildMenuFixture();

    // Create a second menu that is already open.
    const otherMenu = doc.createElement('div');
    otherMenu.className = 'dropdown-menu moxtags-long-menu show';
    doc.body.appendChild(otherMenu);

    btn.click();

    assert.ok(menu.classList.contains('show'), 'new menu should open');
    assert.ok(!otherMenu.classList.contains('show'), 'other menu should close');
  });

  it('does not register duplicate outside-click handlers on rapid clicks', async () => {
    const { btn, menu, outside, EventCtor, callbacks } = buildMenuFixture();

    // Open.
    btn.click();
    assert.ok(menu.classList.contains('show'));

    // Close immediately (before setTimeout fires).
    btn.click();
    assert.ok(!menu.classList.contains('show'));

    // Open again.
    btn.click();
    assert.ok(menu.classList.contains('show'));

    // Let all setTimeout(0) handlers run.
    await new Promise(r => setTimeout(r, 20));

    // Single outside click should close once, not multiple times.
    outside.dispatchEvent(new EventCtor('mousedown', { bubbles: true }));
    assert.ok(!menu.classList.contains('show'));
  });

  it('stopPropagation prevents the click from bubbling up', () => {
    const { doc, btn, menu } = buildMenuFixture();

    let bodyClicked = false;
    doc.body.addEventListener('click', () => { bodyClicked = true; });

    btn.click();

    assert.ok(menu.classList.contains('show'));
    assert.equal(bodyClicked, false, 'click should not bubble past the button');
  });
});
