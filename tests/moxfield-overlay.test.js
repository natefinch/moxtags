// Tests for Moxfield card overlay helpers.
// Run with: node --test tests/moxfield-overlay.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import { extractCardOverlayInfo, findLegalityGrid } from '../src/moxfield/overlay.js';

function buildOverlay() {
  return parseHTML(`
    <div role="dialog" class="modal zoom show d-block modal-fullscreen">
      <div class="row">
        <div class="col-sm-6">
          <img alt="Domri, Anarch of Bolas">
        </div>
        <div class="col-sm-6">
          <h1 class="mb-0" lang="en">
            <a href="/cards/vrGga-domri-anarch-of-bolas">Domri, Anarch of Bolas</a>
          </h1>
          <hr class="my-4">
          <div class="d-flex">
            <div class="flex-grow-1">
              Bloomburrow Commander
              <span class="small text-muted ms-1">
                (<a class="text-caps text-muted" href="/search/cards?q=e%3Ablc">blc</a>)
              </span>
              <div class="text-capitalize text-muted small">#98,<span class="ms-1 text-capitalize">rare</span></div>
            </div>
          </div>
          <hr class="my-4">
          <div class="row row-sm-gutters">
            <div class="col-6 col-lg-4 d-flex"><span aria-label="Not Legal"></span><span>Alchemy</span></div>
            <div class="col-6 col-lg-4 d-flex"><span aria-label="Legal"></span><span>Brawl</span></div>
            <div class="col-6 col-lg-4 d-flex"><span aria-label="Legal"></span><span>Commander</span></div>
            <div class="col-6 col-lg-4 d-flex"><span aria-label="Legal"></span><span>Legacy</span></div>
          </div>
        </div>
      </div>
    </div>
  `).document.querySelector('[role="dialog"]');
}

describe('extractCardOverlayInfo', () => {
  it('extracts exact card identity from the overlay', () => {
    assert.deepEqual(extractCardOverlayInfo(buildOverlay()), {
      name: 'Domri, Anarch of Bolas',
      moxCardId: 'vrGga',
      set: 'blc',
      cn: '98',
    });
  });

  it('handles promo collector numbers with letters', () => {
    const { document } = parseHTML(`
      <div role="dialog" class="modal show">
        <div class="col-sm-6">
          <h1><a href="/cards/abcde-test-card">Test Card</a></h1>
          <div class="d-flex">
            <div class="flex-grow-1">
              Test Set <span>(<a href="/search/cards?q=e%3Apwar">pwar</a>)</span>
              <div class="text-capitalize text-muted small">#191p, rare</div>
            </div>
          </div>
          <div class="row">
            <span aria-label="Legal"></span>
            <span aria-label="Not Legal"></span>
            <span aria-label="Legal"></span>
            <span aria-label="Legal"></span>
          </div>
        </div>
      </div>
    `);

    assert.deepEqual(extractCardOverlayInfo(document.querySelector('[role="dialog"]')), {
      name: 'Test Card',
      moxCardId: 'abcde',
      set: 'pwar',
      cn: '191p',
    });
  });
});

describe('findLegalityGrid', () => {
  it('finds the format legality grid in the overlay', () => {
    const grid = findLegalityGrid(buildOverlay());

    assert.ok(grid);
    assert.ok(grid.textContent.includes('Commander'));
    assert.ok(grid.textContent.includes('Legacy'));
  });

  it('returns null without multiple legality status icons', () => {
    const { document } = parseHTML(`
      <div role="dialog">
        <div class="row">
          <div class="col-sm-6">
            <span aria-label="Legal"></span>
            <span aria-label="Not Legal"></span>
            <span aria-label="Legal"></span>
            <span aria-label="Legal"></span>
          </div>
        </div>
      </div>
    `);

    assert.equal(findLegalityGrid(document.querySelector('[role="dialog"]')), null);
  });
});
