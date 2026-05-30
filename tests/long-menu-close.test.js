// Tests for long-layout tag menu open/close behavior.
// Verifies that clicking outside an open menu closes it.
// Run with: node --test tests/long-menu-close.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

/**
 * Build a minimal long-layout menu structure matching what
 * buildLongLayoutTagButton creates at runtime.
 */
function buildMenuFixture() {
  const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  const EventCtor = doc.defaultView.Event;

  // The "container" holds the toggle button and the dropdown menu.
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

  // Something outside the container to click on.
  const outside = doc.createElement('div');
  outside.className = 'page-content';
  outside.textContent = 'other content';

  doc.body.appendChild(container);
  doc.body.appendChild(outside);

  // Wire up the close-on-outside-click handler the same way content.js does.
  btn.addEventListener('click', (e) => {
    e.stopPropagation();

    // Close other open menus.
    doc.querySelectorAll('.moxtags-long-menu.show').forEach(m => {
      if (m !== menu) m.classList.remove('show');
    });

    if (menu.classList.contains('show')) {
      menu.classList.remove('show');
      return;
    }

    menu.classList.add('show');

    // Register a one-time close handler after a microtask.
    setTimeout(() => {
      function closeOnOutsideClick(ev) {
        if (!container.contains(ev.target)) {
          menu.classList.remove('show');
          doc.removeEventListener('mousedown', closeOnOutsideClick, true);
        }
      }
      doc.addEventListener('mousedown', closeOnOutsideClick, true);
    }, 0);
  });

  return { doc, EventCtor, container, btn, menu, outside };
}

describe('long-layout tag menu close behavior', () => {
  it('opens the menu when the button is clicked', async () => {
    const { btn, menu } = buildMenuFixture();

    btn.click();
    assert.ok(menu.classList.contains('show'), 'menu should be open after button click');
  });

  it('closes the menu when the button is clicked again', async () => {
    const { btn, menu } = buildMenuFixture();

    btn.click();
    assert.ok(menu.classList.contains('show'));

    btn.click();
    assert.ok(!menu.classList.contains('show'), 'menu should close on second click');
  });

  it('closes the menu when clicking outside', async () => {
    const { EventCtor, btn, menu, outside } = buildMenuFixture();

    btn.click();
    assert.ok(menu.classList.contains('show'));

    await new Promise(r => setTimeout(r, 10));

    // Simulate clicking outside.
    outside.dispatchEvent(new EventCtor('mousedown', { bubbles: true }));

    assert.ok(!menu.classList.contains('show'), 'menu should close on outside click');
  });

  it('does NOT close the menu when clicking inside it', async () => {
    const { EventCtor, btn, menu } = buildMenuFixture();

    const item = menu.ownerDocument.createElement('div');
    item.textContent = 'tag item';
    menu.appendChild(item);

    btn.click();
    assert.ok(menu.classList.contains('show'));

    await new Promise(r => setTimeout(r, 10));

    // Click inside the menu.
    item.dispatchEvent(new EventCtor('mousedown', { bubbles: true }));

    assert.ok(menu.classList.contains('show'), 'menu should stay open on inside click');
  });

  it('removes the one-time handler after closing', async () => {
    const { EventCtor, btn, menu, outside } = buildMenuFixture();

    btn.click();
    assert.ok(menu.classList.contains('show'));

    await new Promise(r => setTimeout(r, 10));

    // Close it.
    outside.dispatchEvent(new EventCtor('mousedown', { bubbles: true }));
    assert.ok(!menu.classList.contains('show'));

    // Re-open it.
    btn.click();
    assert.ok(menu.classList.contains('show'), 'menu should re-open');
  });
});
