// Tests for MoxTags long-layout detection helpers.
// Run with: node --test tests/longlayout.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { findUnprocessedMoreOptionsButtons, findUnprocessedCardSearchRows, extractCardInfoFromRow } from '../src/moxfield/longlayout.js';

/**
 * Build a minimal long-layout card row matching the Moxfield DOM structure.
 * Accepts overrides for card-specific values.
 */
function buildCardRow(doc, { cardId = 'yDv34', slug = 'aang-airbending-master', cardName = 'Aang, Airbending Master' } = {}) {
  const row = doc.createElement('div');
  row.className = 'row justify-content-center';

  // Image column.
  const imgCol = doc.createElement('div');
  imgCol.className = 'col-12 col-md-auto text-center mb-3';
  const imgLink = doc.createElement('a');
  imgLink.href = `/cards/${cardId}-${slug}`;
  const img = doc.createElement('img');
  img.alt = cardName;
  img.className = 'img-card img-fluid cursor-pointer';
  imgLink.appendChild(img);
  imgCol.appendChild(imgLink);
  row.appendChild(imgCol);

  // Details column.
  const detCol = doc.createElement('div');
  detCol.className = 'col-12 col-md';
  const h3 = doc.createElement('h3');
  const nameLink = doc.createElement('a');
  nameLink.href = `/cards/${cardId}-${slug}`;
  nameLink.textContent = cardName;
  h3.appendChild(nameLink);
  detCol.appendChild(h3);
  row.appendChild(detCol);

  // Button column.
  const btnCol = doc.createElement('div');
  btnCol.className = 'col-9 col-sm-7 col-md-3 px-5 px-md-3';

  for (const label of ['Add to Main Deck', 'Add to Sideboard', 'Add to Considering']) {
    const wrap = doc.createElement('div');
    wrap.className = 'mb-2';
    const btn = doc.createElement('button');
    btn.className = 'btn w-100 btn-secondary';
    btn.type = 'button';
    const span = doc.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
    wrap.appendChild(btn);
    btnCol.appendChild(wrap);
  }

  // "More Options" button (unwrapped, with caret icon).
  const moreBtn = doc.createElement('button');
  moreBtn.className = 'btn w-100 btn-secondary';
  const moreSpan = doc.createElement('span');
  moreSpan.textContent = 'More Options';
  const caret = doc.createElement('span');
  caret.className = 'fa-solid fa-caret-down ms-1';
  moreSpan.appendChild(caret);
  moreBtn.appendChild(moreSpan);
  btnCol.appendChild(moreBtn);

  row.appendChild(btnCol);
  return row;
}

// ─── findUnprocessedMoreOptionsButtons ───────────────────────────────

describe('findUnprocessedMoreOptionsButtons', () => {
  it('finds a More Options button in a card row', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const row = buildCardRow(doc);
    doc.body.appendChild(row);

    const results = findUnprocessedMoreOptionsButtons(row);
    assert.equal(results.length, 1);
    assert.ok(results[0].button.textContent.includes('More Options'));
    assert.equal(results[0].row, row);
  });

  it('finds multiple buttons across multiple card rows', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const container = doc.createElement('div');
    container.appendChild(buildCardRow(doc, { cardId: 'abc', cardName: 'Card A' }));
    container.appendChild(buildCardRow(doc, { cardId: 'def', cardName: 'Card B' }));
    doc.body.appendChild(container);

    const results = findUnprocessedMoreOptionsButtons(container);
    assert.equal(results.length, 2);
  });

  it('skips already-processed rows', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const row = buildCardRow(doc);
    doc.body.appendChild(row);

    // Simulate already-processed: add a .moxtags-long-btn-wrapper sibling.
    const btnCol = row.querySelector('.col-9');
    const marker = doc.createElement('div');
    marker.className = 'moxtags-long-btn-wrapper';
    btnCol.appendChild(marker);

    const results = findUnprocessedMoreOptionsButtons(row);
    assert.equal(results.length, 0);
  });

  it('returns empty array when no More Options button exists', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const div = doc.createElement('div');
    const btn = doc.createElement('button');
    btn.textContent = 'Some Other Button';
    div.appendChild(btn);
    doc.body.appendChild(div);

    const results = findUnprocessedMoreOptionsButtons(div);
    assert.equal(results.length, 0);
  });

  it('skips a button not inside a .row', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const div = doc.createElement('div');
    const btn = doc.createElement('button');
    btn.textContent = 'More Options';
    div.appendChild(btn);
    doc.body.appendChild(div);

    const results = findUnprocessedMoreOptionsButtons(div);
    assert.equal(results.length, 0);
  });

  it('detects when root element itself is a More Options button', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const row = buildCardRow(doc);
    doc.body.appendChild(row);

    // Select the direct-child button of the button column (not wrapped in div.mb-2).
    const btns = [...row.querySelectorAll('button')];
    const btn = btns.find(b => b.textContent.includes('More Options'));
    const results = findUnprocessedMoreOptionsButtons(btn);
    assert.equal(results.length, 1);
    assert.equal(results[0].button, btn);
  });
});

// ─── extractCardInfoFromRow ──────────────────────────────────────────

describe('extractCardInfoFromRow', () => {
  it('extracts card ID and name from a standard card row', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const row = buildCardRow(doc);
    doc.body.appendChild(row);

    const info = extractCardInfoFromRow(row);
    assert.equal(info.moxCardId, 'yDv34');
    assert.equal(info.cardName, 'Aang, Airbending Master');
  });

  it('extracts card name from h3 link when img has no alt', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const row = buildCardRow(doc, { cardName: 'Sol Ring' });
    // Remove the img alt.
    const img = row.querySelector('img.img-card');
    img.removeAttribute('alt');
    doc.body.appendChild(row);

    const info = extractCardInfoFromRow(row);
    assert.equal(info.cardName, 'Sol Ring');
  });

  it('returns null card ID when no /cards/ link exists', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const row = doc.createElement('div');
    row.className = 'row';
    const h3 = doc.createElement('h3');
    const a = doc.createElement('a');
    a.href = '/decks/xyz';
    a.textContent = 'Some Card';
    h3.appendChild(a);
    row.appendChild(h3);
    doc.body.appendChild(row);

    const info = extractCardInfoFromRow(row);
    assert.equal(info.moxCardId, null);
  });

  it('returns null card name when no img or h3 link exists', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const row = doc.createElement('div');
    row.className = 'row';
    doc.body.appendChild(row);

    const info = extractCardInfoFromRow(row);
    assert.equal(info.moxCardId, null);
    assert.equal(info.cardName, null);
  });

  it('handles different card ID formats', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const row = buildCardRow(doc, { cardId: 'vPZda', slug: 'aang-air-nomad', cardName: 'Aang, Air Nomad' });
    doc.body.appendChild(row);

    const info = extractCardInfoFromRow(row);
    assert.equal(info.moxCardId, 'vPZda');
    assert.equal(info.cardName, 'Aang, Air Nomad');
  });
});

// ─── Card search text layout helpers ─────────────────────────────────

/**
 * Build a card search text-layout row (uses "Add to Wish List" instead
 * of "More Options").
 */
function buildCardSearchRow(doc, { cardId = 'j43RR', slug = 'ajani-outland-chaperone', cardName = 'Ajani, Outland Chaperone' } = {}) {
  const row = doc.createElement('div');
  row.className = 'row justify-content-center';

  // Image column.
  const imgCol = doc.createElement('div');
  imgCol.className = 'col-12 col-md-auto text-center mb-3';
  const imgLink = doc.createElement('a');
  imgLink.href = `/cards/${cardId}-${slug}`;
  const img = doc.createElement('img');
  img.alt = cardName;
  img.className = 'img-card img-fluid cursor-pointer';
  imgLink.appendChild(img);
  imgCol.appendChild(imgLink);
  row.appendChild(imgCol);

  // Details column.
  const detCol = doc.createElement('div');
  detCol.className = 'col-12 col-md';
  const h3 = doc.createElement('h3');
  const nameLink = doc.createElement('a');
  nameLink.href = `/cards/${cardId}-${slug}`;
  nameLink.textContent = cardName;
  h3.appendChild(nameLink);
  detCol.appendChild(h3);
  row.appendChild(detCol);

  // Button column.
  const btnCol = doc.createElement('div');
  btnCol.className = 'col-9 col-sm-7 col-md-3 px-5 px-md-3';
  const btnContainer = doc.createElement('div');
  btnContainer.className = 'd-flex flex-column gap-2 mt-3 mt-sm-5';

  for (const label of ['Create Deck with...', 'Add to Deck', 'Add to Package', 'Add to Wish List']) {
    const btn = doc.createElement('button');
    btn.className = 'btn w-100 btn-secondary';
    const span = doc.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
    btnContainer.appendChild(btn);
  }

  btnCol.appendChild(btnContainer);
  row.appendChild(btnCol);
  return row;
}

describe('findUnprocessedCardSearchRows', () => {
  it('finds card search text rows with Add to Wish List', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const row = buildCardSearchRow(doc);
    doc.body.appendChild(row);

    const results = findUnprocessedCardSearchRows(row);
    assert.equal(results.length, 1);
    assert.ok(results[0].button.textContent.includes('Add to Wish List'));
    assert.equal(results[0].row, row);
  });

  it('finds multiple card search rows', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const container = doc.createElement('div');
    container.appendChild(buildCardSearchRow(doc, { cardId: 'aaa', cardName: 'Card A' }));
    container.appendChild(buildCardSearchRow(doc, { cardId: 'bbb', cardName: 'Card B' }));
    doc.body.appendChild(container);

    const results = findUnprocessedCardSearchRows(container);
    assert.equal(results.length, 2);
  });

  it('skips already-processed rows', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const row = buildCardSearchRow(doc);
    doc.body.appendChild(row);

    const btnContainer = row.querySelector('.d-flex');
    const marker = doc.createElement('div');
    marker.className = 'moxtags-long-btn-wrapper';
    btnContainer.appendChild(marker);

    const results = findUnprocessedCardSearchRows(row);
    assert.equal(results.length, 0);
  });

  it('does not match deck long-layout rows that have More Options', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    // buildCardRow creates a deck-style row with "More Options" button.
    const row = buildCardRow(doc);
    doc.body.appendChild(row);

    const results = findUnprocessedCardSearchRows(row);
    assert.equal(results.length, 0);
  });

  it('does not match rows without card images or card links', () => {
    const { document: doc } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const row = doc.createElement('div');
    row.className = 'row';
    const btn = doc.createElement('button');
    btn.textContent = 'Add to Wish List';
    row.appendChild(btn);
    doc.body.appendChild(row);

    const results = findUnprocessedCardSearchRows(row);
    assert.equal(results.length, 0);
  });
});
