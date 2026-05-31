// Tests for Moxfield DOM helpers.
// Run with: node --test tests/dom.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

import {
  extractCardIdFromCardPreviewPanel,
  extractCardInfoFromSearchResultCard,
  findCardPreviewActionPanels,
  findSmallestMenu,
  hasDeckSearchControls,
  isCardMenu,
  isPublicDeckActionMenu,
} from '../src/moxfield/dom.js';
import { MENU_KEYWORDS } from '../src/moxfield/constants.js';

function parseExampleHtml(filename) {
  return parseHTML(readFileSync(new URL(`../examples/${filename}`, import.meta.url), 'utf8'));
}

describe('findCardPreviewActionPanels', () => {
  it('finds the public-deck preview action panel', () => {
    const { document } = parseHTML(`
      <aside class="deckview-image-container">
        <img alt="Front" src="https://assets.moxfield.net/cards/card-vPo0V-normal.webp?318604914">
        <div class="d-grid gap-2 mt-4 mx-auto">
          <button class="btn btn-sm btn-outline-primary">
            <span><span>Add to Wish List</span></span>
          </button>
          <a class="btn btn-sm btn-primary">Buy @ TCGplayer</a>
        </div>
      </aside>
    `);

    const panels = findCardPreviewActionPanels(document.body);

    assert.equal(panels.length, 1);
    assert.ok(panels[0].classList.contains('d-grid'));
  });

  it('does not match unrelated token wish list controls', () => {
    const { document } = parseHTML(`
      <div class="cursor-pointer">
        <div class="float-end"><a>Add Tokens to Wish List</a></div>
      </div>
    `);

    assert.deepEqual(findCardPreviewActionPanels(document.body), []);
  });

  it('does not match a newly replaced preview subtree on owned decks', () => {
    const { document } = parseHTML(`
      <form><input id="deckbox-search" type="search"></form>
      <aside class="deckview-image-container">
        <img alt="Front" src="https://assets.moxfield.net/cards/card-vPo0V-normal.webp">
        <div class="d-grid gap-2 mt-4 mx-auto">
          <button class="btn btn-sm btn-outline-primary">
            <span><span>Add to Wish List</span></span>
          </button>
          <a class="btn btn-sm btn-primary">Buy @ TCGplayer</a>
        </div>
      </aside>
    `);
    const preview = document.querySelector('.deckview-image-container');

    assert.deepEqual(findCardPreviewActionPanels(preview), []);
  });
});

describe('extractCardIdFromCardPreviewPanel', () => {
  it('extracts the selected card ID from preview image assets', () => {
    const { document } = parseHTML(`
      <aside class="deckview-image-container">
        <img alt="Front" src="https://assets.moxfield.net/cards/card-vPo0V-normal.webp?318604914">
        <div class="d-grid gap-2 mt-4 mx-auto">
          <button><span>Add to Wish List</span></button>
        </div>
      </aside>
    `);

    const panel = document.querySelector('.d-grid');

    assert.equal(extractCardIdFromCardPreviewPanel(panel), 'vPo0V');
  });

  it('prefers card links when present', () => {
    const { document } = parseHTML(`
      <aside class="deckview-image-container">
        <a href="/cards/abc12-example-card">View Details</a>
        <img alt="Front" src="https://assets.moxfield.net/cards/card-vPo0V-normal.webp">
        <div class="d-grid"><button>Add to Wish List</button></div>
      </aside>
    `);

    assert.equal(extractCardIdFromCardPreviewPanel(document.querySelector('aside')), 'abc12');
  });
});

describe('extractCardInfoFromSearchResultCard', () => {
  it('extracts Moxfield card ID from deck search grid tiles not in the deck map', () => {
    const { document } = parseHTML(`
      <div class="decklist-card">
        <div class="decklist-card-phantomsearch  ">Dualcaster Mage</div>
        <a tabindex="0" class="d-inline-block" href="/cards/Lmr6x-dualcaster-mage">
          <img alt="Dualcaster Mage" src="card.webp">
        </a>
        <div class="dropdown"><a class="dropdown-toggle cursor-pointer no-outline">Options</a></div>
      </div>
    `);

    const info = extractCardInfoFromSearchResultCard(document.querySelector('.decklist-card'), new Map());

    assert.deepEqual(info, {
      name: 'Dualcaster Mage',
      set: null,
      cn: null,
      moxCardId: 'Lmr6x',
    });
  });

  it('keeps deck card identity while preserving the search result card ID', () => {
    const { document } = parseHTML(`
      <div class="decklist-card">
        <div class="decklist-card-phantomsearch">Shimmer Myr</div>
        <a href="/cards/AWdze-shimmer-myr">View Details</a>
      </div>
    `);
    const cardMap = new Map([
      ['shimmer myr', { name: 'Shimmer Myr', set: 'mb2', cn: '123' }],
    ]);

    const info = extractCardInfoFromSearchResultCard(document.querySelector('.decklist-card'), cardMap);

    assert.deepEqual(info, {
      name: 'Shimmer Myr',
      set: 'mb2',
      cn: '123',
      moxCardId: 'AWdze',
    });
  });
});

describe('Moxfield example HTML fixtures', () => {
  it('extracts card identity from every search-page grid result card', () => {
    const { document } = parseExampleHtml('moxfield-searchpage.html');
    const cards = [...document.querySelectorAll('.decklist-card')];

    assert.equal(cards.length, 19);
    assert.equal(hasDeckSearchControls(document), true);

    const infos = cards.map(card => extractCardInfoFromSearchResultCard(card, new Map()));

    assert.deepEqual(infos[0], {
      name: 'Dualcaster Mage',
      set: null,
      cn: null,
      moxCardId: 'Lmr6x',
    });
    assert.deepEqual(infos.at(-1), {
      name: 'Hungering Yeti',
      set: null,
      cn: null,
      moxCardId: 'k7bl1',
    });
    assert.equal(infos.every(info => info?.name && info.moxCardId), true);
  });

  it('detects deck search ownership correctly in owned and other-user deck examples', () => {
    const owned = parseExampleHtml('moxfield-mydeck.html').document;
    const otherUser = parseExampleHtml('modefield-other-deck.html').document;

    assert.equal(hasDeckSearchControls(owned, 'zL7x27c810qw8_ftas9DDw'), true);
    assert.equal(hasDeckSearchControls(otherUser, 'zL7x27c810qw8_ftas9DDw'), false);
  });

  it('extracts selected preview card IDs from owned and other-user deck examples', () => {
    const owned = parseExampleHtml('moxfield-mydeck.html').document;
    const otherUser = parseExampleHtml('modefield-other-deck.html').document;

    // Owned decks should NOT return preview panels (tags go in the context menu).
    const ownedPanels = findCardPreviewActionPanels(owned.body);
    assert.equal(ownedPanels.length, 0);

    // Public (other-user) decks should return the preview panel.
    const otherPanels = findCardPreviewActionPanels(otherUser.body);
    assert.equal(otherPanels.length, 1);
    assert.equal(extractCardIdFromCardPreviewPanel(otherPanels[0]), 'VB1O3');
  });
});

describe('public deck dropdown detection', () => {
  const publicActionMenuHtml = `
    <div class="dropdown-menu show">
      <div class="dropdown-menu-parent" tabindex="-1">
        <a class="dropdown-item cursor-pointer no-outline">Add to Another Deck...</a>
        <a class="dropdown-item cursor-pointer no-outline">Add to Collection</a>
        <a class="dropdown-item cursor-pointer no-outline">Add to Wish List</a>
        <div class="dropdown-divider"></div>
        <a class="dropdown-item cursor-pointer no-outline">View Details</a>
        <a class="dropdown-item cursor-pointer no-outline">Copy Card Name</a>
        <div class="dropdown-divider"></div>
        <a class="dropdown-item">Buy on TCGplayer</a>
        <a class="dropdown-item">Buy on Card Kingdom</a>
        <a class="dropdown-item">Buy on Mana Pool</a>
      </div>
    </div>
  `;

  it('recognizes the single-column card action menu on decks owned by other users', () => {
    const { document } = parseHTML(`
      <div>
        ${publicActionMenuHtml}
      </div>
    `);

    const menu = document.querySelector('.dropdown-menu');

    assert.equal(isCardMenu(menu, MENU_KEYWORDS), true);
    assert.equal(findSmallestMenu(menu, MENU_KEYWORDS)?.className, 'dropdown-menu-parent');
    assert.equal(isPublicDeckActionMenu(menu, { root: document, deckId: 'abc123' }), true);
  });

  it('does not treat the same menu text as public when deck search controls exist', () => {
    const { document } = parseHTML(`
      <div>
        <form><input id="deckbox-search" type="search"></form>
        ${publicActionMenuHtml}
      </div>
    `);

    const menu = document.querySelector('.dropdown-menu');

    assert.equal(hasDeckSearchControls(document, 'abc123'), true);
    assert.equal(isPublicDeckActionMenu(menu, { root: document, deckId: 'abc123' }), false);
  });

  it('uses a same-deck edit link as an owned deck signal before search renders', () => {
    const { document } = parseHTML(`
      <div>
        <a href="/decks/abc123/edit">Edit</a>
        ${publicActionMenuHtml}
      </div>
    `);

    const menu = document.querySelector('.dropdown-menu');

    assert.equal(hasDeckSearchControls(document, 'abc123'), true);
    assert.equal(isPublicDeckActionMenu(menu, { root: document, deckId: 'abc123' }), false);
  });

  it('ignores edit links for a different deck', () => {
    const { document } = parseHTML(`
      <div>
        <a href="/decks/other-deck/edit">Edit</a>
        ${publicActionMenuHtml}
      </div>
    `);

    assert.equal(hasDeckSearchControls(document, 'abc123'), false);
  });
});
