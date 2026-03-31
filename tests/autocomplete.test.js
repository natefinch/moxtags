// Tests for MoxTags autocomplete filtering and match highlighting.
// Run with: node --test tests/autocomplete.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { filterAndSortTags, parseInput, renderCount, highlightTag } from '../src/shared/autocomplete.js';

// ─── Tests ───────────────────────────────────────────────────────────

const SAMPLE_TAGS = [
  'accounting',
  'add-counters',
  'add-counters-twice',
  'card-draw',
  'counters-matter',
  'draw-cards',
  'full-art',
  'full-body',
  'ramp',
  'ramp-artifact',
  'warrior',
  'water',
];

// ── Word-prefix matching ─────────────────────────────────────────────

describe('filterAndSortTags – word-prefix matching', () => {
  it('matches a word at the start of a tag', () => {
    const result = filterAndSortTags(SAMPLE_TAGS, 'add');
    assert.deepEqual(result, ['add-counters', 'add-counters-twice']);
  });

  it('matches a word in the middle of a tag', () => {
    const result = filterAndSortTags(SAMPLE_TAGS, 'count');
    assert.deepEqual(result, ['counters-matter', 'add-counters', 'add-counters-twice']);
  });

  it('does not match a substring that is not a word prefix', () => {
    const result = filterAndSortTags(SAMPLE_TAGS, 'ount');
    assert.deepEqual(result, []);
  });

  it('"count" does not match "accounting" (not a word prefix)', () => {
    const result = filterAndSortTags(SAMPLE_TAGS, 'count');
    assert.ok(!result.includes('accounting'));
  });

  it('matches are case-insensitive', () => {
    const tags = ['Draw-Cards', 'card-draw'];
    const result = filterAndSortTags(tags, 'Draw');
    assert.deepEqual(result, ['Draw-Cards', 'card-draw']);
  });

  it('returns empty for empty partial', () => {
    assert.deepEqual(filterAndSortTags(SAMPLE_TAGS, ''), []);
  });

  it('single-word tags match by prefix', () => {
    const result = filterAndSortTags(SAMPLE_TAGS, 'ram');
    assert.deepEqual(result, ['ramp', 'ramp-artifact']);
  });

  it('exact word match works', () => {
    const result = filterAndSortTags(SAMPLE_TAGS, 'ramp');
    assert.deepEqual(result, ['ramp', 'ramp-artifact']);
  });

  it('sorts whole-tag prefix matches before later-word matches', () => {
    const result = filterAndSortTags(SAMPLE_TAGS, 'count');
    // counters-matter starts with "count", so it comes first;
    // add-counters and add-counters-twice match a later word.
    assert.deepEqual(result, ['counters-matter', 'add-counters', 'add-counters-twice']);
  });

  it('sorts alphabetically within each group', () => {
    const tags = ['z-draw', 'draw-first', 'a-draw', 'draw-second'];
    const result = filterAndSortTags(tags, 'draw');
    assert.deepEqual(result, ['draw-first', 'draw-second', 'a-draw', 'z-draw']);
  });
});

// ── Render count cap ─────────────────────────────────────────────────

describe('renderCount – cap behavior', () => {
  it('caps at MAX_VISIBLE*5 for 1-char partial', () => {
    assert.equal(renderCount(200, 1), 50);
  });

  it('caps at MAX_VISIBLE*5 for 2-char partial', () => {
    assert.equal(renderCount(200, 2), 50);
  });

  it('no cap for 3-char partial', () => {
    assert.equal(renderCount(200, 3), 200);
  });

  it('no cap for longer partials', () => {
    assert.equal(renderCount(500, 5), 500);
  });

  it('returns actual count when below cap', () => {
    assert.equal(renderCount(10, 1), 10);
  });
});

// ── Input parsing ────────────────────────────────────────────────────

describe('parseInput – prefix detection', () => {
  it('detects otag: at start of input', () => {
    const r = parseInput('otag:ram', 8);
    assert.deepEqual(r, { prefix: 'otag:', partial: 'ram', wordStart: 0, isOracle: true });
  });

  it('detects art: mid-query', () => {
    const r = parseInput('cmc>3 art:full', 14);
    assert.deepEqual(r, { prefix: 'art:', partial: 'full', wordStart: 6, isOracle: false });
  });

  it('detects oracletag: prefix', () => {
    const r = parseInput('oracletag:draw', 14);
    assert.deepEqual(r, { prefix: 'oracletag:', partial: 'draw', wordStart: 0, isOracle: true });
  });

  it('detects function: prefix', () => {
    const r = parseInput('function:ramp', 13);
    assert.deepEqual(r, { prefix: 'function:', partial: 'ramp', wordStart: 0, isOracle: true });
  });

  it('detects atag: prefix as art', () => {
    const r = parseInput('atag:wa', 7);
    assert.deepEqual(r, { prefix: 'atag:', partial: 'wa', wordStart: 0, isOracle: false });
  });

  it('detects arttag: prefix as art', () => {
    const r = parseInput('arttag:full', 11);
    assert.deepEqual(r, { prefix: 'arttag:', partial: 'full', wordStart: 0, isOracle: false });
  });

  it('returns null for unrecognized prefix', () => {
    assert.equal(parseInput('color:red', 9), null);
  });

  it('returns null for plain text', () => {
    assert.equal(parseInput('hello world', 11), null);
  });

  it('handles prefix with empty partial', () => {
    const r = parseInput('otag:', 5);
    assert.deepEqual(r, { prefix: 'otag:', partial: '', wordStart: 0, isOracle: true });
  });

  it('handles cursor in middle of input', () => {
    const r = parseInput('otag:ramp cmc>3', 9);
    assert.deepEqual(r, { prefix: 'otag:', partial: 'ramp', wordStart: 0, isOracle: true });
  });
});

// ── Match highlighting ───────────────────────────────────────────────

describe('highlightTag – bold segments', () => {
  it('highlights a matching word at the start', () => {
    const segs = highlightTag('add-counters', 'add');
    assert.deepEqual(segs, [
      { text: 'add', bold: true },
      { text: '-', bold: false },
      { text: 'counters', bold: false },
    ]);
  });

  it('highlights a matching word in the middle', () => {
    const segs = highlightTag('add-counters', 'count');
    assert.deepEqual(segs, [
      { text: 'add', bold: false },
      { text: '-', bold: false },
      { text: 'count', bold: true },
      { text: 'ers', bold: false },
    ]);
  });

  it('highlights multiple matching words', () => {
    const segs = highlightTag('add-also-another', 'a');
    assert.deepEqual(segs, [
      { text: 'a', bold: true },
      { text: 'dd', bold: false },
      { text: '-', bold: false },
      { text: 'a', bold: true },
      { text: 'lso', bold: false },
      { text: '-', bold: false },
      { text: 'a', bold: true },
      { text: 'nother', bold: false },
    ]);
  });

  it('highlights a single-word tag fully when exact match', () => {
    const segs = highlightTag('ramp', 'ramp');
    assert.deepEqual(segs, [
      { text: 'ramp', bold: true },
    ]);
  });

  it('highlights partial match on single-word tag', () => {
    const segs = highlightTag('ramp', 'ram');
    assert.deepEqual(segs, [
      { text: 'ram', bold: true },
      { text: 'p', bold: false },
    ]);
  });

  it('does not highlight non-matching words', () => {
    const segs = highlightTag('card-draw', 'draw');
    assert.deepEqual(segs, [
      { text: 'card', bold: false },
      { text: '-', bold: false },
      { text: 'draw', bold: true },
    ]);
  });
});
