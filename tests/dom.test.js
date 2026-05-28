// Tests for Moxfield DOM helpers.
// Run with: node --test tests/dom.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import {
  extractCardIdFromCardPreviewPanel,
  findCardPreviewActionPanels,
  findSmallestMenu,
  isCardMenu,
} from '../src/moxfield/dom.js';
import { MENU_KEYWORDS } from '../src/moxfield/constants.js';

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

describe('public deck dropdown detection', () => {
  it('recognizes the single-column card action menu on decks owned by other users', () => {
    const { document } = parseHTML(`
      <div>
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
      </div>
    `);

    const menu = document.querySelector('.dropdown-menu');

    assert.equal(isCardMenu(menu, MENU_KEYWORDS), true);
    assert.equal(findSmallestMenu(menu, MENU_KEYWORDS)?.className, 'dropdown-menu-parent');
  });
});
