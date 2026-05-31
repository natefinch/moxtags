// Tests for Moxfield standalone card page helpers.
// Run with: node --test tests/moxfield-cardpage.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import {
  extractCardPageInfo,
  findCardPagePrintingDetails,
  findFormatLegalitiesHeading,
} from '../src/moxfield/cardpage.js';

function buildCardPage() {
  return parseHTML(`
    <main>
      <div class="row">
        <div class="col-md-5 col-lg-4 col-xl-3 text-center mb-5">
          <img alt="Front" class="img-card img-fluid front"
               src="https://assets.moxfield.net/cards/card-0vGgm-normal.webp">
        </div>
        <div class="col-md-7 col-lg-8 col-xl-6 pe-xl-5">
          <div>
            <h1 class="mb-0" lang="en"><strong>Abandon Attachments</strong></h1>
            <p class="text-muted mb-4" lang="en">Instant — Lesson</p>
          </div>
          <hr class="my-4">
          <div class="d-flex">
            <div class="flex-grow-1">Avatar: The Last Airbender<span class="small text-muted ms-1"><span>(</span><span class="text-caps">tla</span><span>)</span></span>
              <div class="text-capitalize text-muted small">#205,<span class="ms-1 text-capitalize">common</span></div>
            </div>
            <div class="text-nowrap text-end d-inline-block align-top flex-shink-0">
              <span>$0.28</span><span>&nbsp;/&nbsp;</span><span>$0.38</span>
            </div>
          </div>
          <hr class="my-4">
          <div class="small text-center">60-day Price History</div>
          <div>Price chart placeholder</div>
          <hr class="my-4">
          <h3 class="mb-3"><strong>Format Legalities</strong></h3>
          <div class="row row-sm-gutters">
            <div class="col-6 col-lg-4 d-flex"><div class="flex-shrink-0 me-2"><span aria-label="Legal"></span></div><div class="flex-grow-1">Alchemy</div></div>
            <div class="col-6 col-lg-4 d-flex"><div class="flex-shrink-0 me-2"><span aria-label="Legal"></span></div><div class="flex-grow-1">Commander</div></div>
            <div class="col-6 col-lg-4 d-flex"><div class="flex-shrink-0 me-2"><span aria-label="Legal"></span></div><div class="flex-grow-1">Standard</div></div>
            <div class="col-6 col-lg-4 d-flex"><div class="flex-shrink-0 me-2"><span aria-label="Not Legal"></span></div><div class="flex-grow-1">Vintage</div></div>
          </div>
        </div>
      </div>
    </main>
  `).document.querySelector('main');
}

function buildCardPageWithSetLink() {
  return parseHTML(`
    <main>
      <div class="row">
        <div class="col-md-7 col-lg-8 col-xl-6 pe-xl-5">
          <h1 class="mb-0" lang="en"><strong>Domri, Anarch of Bolas</strong></h1>
          <hr class="my-4">
          <div class="d-flex">
            <div class="flex-grow-1">Bloomburrow Commander<span class="small text-muted ms-1">(<a class="text-caps text-muted" href="/search/cards?q=e%3Ablc">blc</a>)</span>
              <div class="text-capitalize text-muted small">#98,<span class="ms-1 text-capitalize">rare</span></div>
            </div>
          </div>
          <hr class="my-4">
          <h3 class="mb-3"><strong>Format Legalities</strong></h3>
          <div class="row row-sm-gutters">
            <div class="col-6 col-lg-4 d-flex"><div class="flex-shrink-0 me-2"><span aria-label="Legal"></span></div><div class="flex-grow-1">Commander</div></div>
            <div class="col-6 col-lg-4 d-flex"><div class="flex-shrink-0 me-2"><span aria-label="Legal"></span></div><div class="flex-grow-1">Legacy</div></div>
            <div class="col-6 col-lg-4 d-flex"><div class="flex-shrink-0 me-2"><span aria-label="Legal"></span></div><div class="flex-grow-1">Modern</div></div>
            <div class="col-6 col-lg-4 d-flex"><div class="flex-shrink-0 me-2"><span aria-label="Not Legal"></span></div><div class="flex-grow-1">Standard</div></div>
          </div>
        </div>
      </div>
    </main>
  `).document.querySelector('main');
}

describe('extractCardPageInfo', () => {
  it('extracts card identity from URL and page DOM with text-caps set code', () => {
    const container = buildCardPage();
    const result = extractCardPageInfo('/cards/0vGgm-abandon-attachments', container);
    assert.deepEqual(result, {
      name: 'Abandon Attachments',
      moxCardId: '0vGgm',
      set: 'tla',
      cn: '205',
    });
  });

  it('extracts card identity with a set link href', () => {
    const container = buildCardPageWithSetLink();
    const result = extractCardPageInfo('/cards/vrGga-domri-anarch-of-bolas', container);
    assert.deepEqual(result, {
      name: 'Domri, Anarch of Bolas',
      moxCardId: 'vrGga',
      set: 'blc',
      cn: '98',
    });
  });

  it('extracts moxCardId from pathname even without page content', () => {
    const empty = parseHTML('<main></main>').document.querySelector('main');
    const result = extractCardPageInfo('/cards/abc12-test-card', empty);
    assert.equal(result.moxCardId, 'abc12');
    assert.equal(result.name, null);
    assert.equal(result.set, null);
    assert.equal(result.cn, null);
  });

  it('returns null moxCardId for non-card paths', () => {
    const container = buildCardPage();
    const result = extractCardPageInfo('/decks/abc123', container);
    assert.equal(result.moxCardId, null);
  });
});

describe('findCardPagePrintingDetails', () => {
  it('finds the card printing detail row', () => {
    const container = buildCardPage();
    const details = findCardPagePrintingDetails(container);

    assert.ok(details);
    assert.match(details.textContent, /Avatar: The Last Airbender/);
    assert.match(details.textContent, /#205/);
  });

  it('returns null when no card printing detail row exists', () => {
    const container = parseHTML('<main><h3>Format Legalities</h3></main>').document.querySelector('main');
    assert.equal(findCardPagePrintingDetails(container), null);
  });
});

describe('findFormatLegalitiesHeading', () => {
  it('finds the Format Legalities heading', () => {
    const container = buildCardPage();
    const heading = findFormatLegalitiesHeading(container);
    assert.ok(heading);
    assert.equal(heading.textContent.trim(), 'Format Legalities');
  });

  it('returns null when no Format Legalities heading exists', () => {
    const container = parseHTML('<main><h3>Something Else</h3></main>').document.querySelector('main');
    assert.equal(findFormatLegalitiesHeading(container), null);
  });
});
