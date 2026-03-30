// Tests for MoxTags autocomplete filtering and match highlighting.
// Run with: node --test tests/autocomplete.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Replicas of the filtering/highlighting logic from content.js ────

const ORACLE_PREFIXES = ['otag:', 'oracletag:', 'function:'];
const ART_PREFIXES = ['art:', 'atag:', 'arttag:'];
const ALL_PREFIXES = [...ORACLE_PREFIXES, ...ART_PREFIXES];
const MAX_VISIBLE = 10;

/**
 * Filter tags whose dash-delimited words have a prefix matching `partial`.
 * Mirrors showFilteredTags() in content.js.
 */
function filterTags(tagList, partial) {
  if (!partial) return [];
  const lowerPartial = partial.toLowerCase();
  const filtered = tagList.filter(t => {
    const words = t.toLowerCase().split('-');
    return words.some(w => w.startsWith(lowerPartial));
  });
  // Sort: whole-tag prefix matches first, then later-word matches, alphabetical within each.
  filtered.sort((a, b) => {
    const aPrefix = a.toLowerCase().startsWith(lowerPartial) ? 0 : 1;
    const bPrefix = b.toLowerCase().startsWith(lowerPartial) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return a.localeCompare(b);
  });
  return filtered;
}

/**
 * Compute the render count, matching renderAcDropdown() logic.
 */
function renderCount(filteredLength, partialLength) {
  if (partialLength >= 3) return filteredLength;
  return Math.min(filteredLength, MAX_VISIBLE * 5);
}

/**
 * Parse the input value at a cursor position and return the matched prefix
 * and partial, or null if no prefix is found. Mirrors onAcInput() logic.
 */
function parseInput(value, cursor) {
  let wordStart = cursor;
  while (wordStart > 0 && value[wordStart - 1] !== ' ') {
    wordStart--;
  }
  const word = value.substring(wordStart, cursor).toLowerCase();

  let matchedPrefix = null;
  for (const p of ALL_PREFIXES) {
    if (word.startsWith(p)) {
      matchedPrefix = p;
      break;
    }
  }
  if (!matchedPrefix) return null;

  const partial = word.substring(matchedPrefix.length);
  const isOracle = ORACLE_PREFIXES.includes(matchedPrefix);
  return { prefix: matchedPrefix, partial, wordStart, isOracle };
}

/**
 * Build highlighted segments for a tag given a partial.
 * Returns an array of { text, bold } objects.
 * Mirrors buildHighlightedTag() in content.js.
 */
function highlightTag(tag, partial) {
  const parts = tag.split('-');
  const pLen = partial.length;
  const segments = [];

  for (let i = 0; i < parts.length; i++) {
    if (i > 0) segments.push({ text: '-', bold: false });
    const word = parts[i];
    if (word.toLowerCase().startsWith(partial)) {
      segments.push({ text: word.substring(0, pLen), bold: true });
      if (word.length > pLen) {
        segments.push({ text: word.substring(pLen), bold: false });
      }
    } else {
      segments.push({ text: word, bold: false });
    }
  }
  return segments;
}

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

describe('filterTags – word-prefix matching', () => {
  it('matches a word at the start of a tag', () => {
    const result = filterTags(SAMPLE_TAGS, 'add');
    assert.deepEqual(result, ['add-counters', 'add-counters-twice']);
  });

  it('matches a word in the middle of a tag', () => {
    const result = filterTags(SAMPLE_TAGS, 'count');
    assert.deepEqual(result, ['counters-matter', 'add-counters', 'add-counters-twice']);
  });

  it('does not match a substring that is not a word prefix', () => {
    const result = filterTags(SAMPLE_TAGS, 'ount');
    assert.deepEqual(result, []);
  });

  it('"count" does not match "accounting" (not a word prefix)', () => {
    const result = filterTags(SAMPLE_TAGS, 'count');
    assert.ok(!result.includes('accounting'));
  });

  it('matches are case-insensitive', () => {
    const tags = ['Draw-Cards', 'card-draw'];
    const result = filterTags(tags, 'Draw');
    assert.deepEqual(result, ['Draw-Cards', 'card-draw']);
  });

  it('returns empty for empty partial', () => {
    assert.deepEqual(filterTags(SAMPLE_TAGS, ''), []);
  });

  it('single-word tags match by prefix', () => {
    const result = filterTags(SAMPLE_TAGS, 'ram');
    assert.deepEqual(result, ['ramp', 'ramp-artifact']);
  });

  it('exact word match works', () => {
    const result = filterTags(SAMPLE_TAGS, 'ramp');
    assert.deepEqual(result, ['ramp', 'ramp-artifact']);
  });

  it('sorts whole-tag prefix matches before later-word matches', () => {
    const result = filterTags(SAMPLE_TAGS, 'count');
    // counters-matter starts with "count", so it comes first;
    // add-counters and add-counters-twice match a later word.
    assert.deepEqual(result, ['counters-matter', 'add-counters', 'add-counters-twice']);
  });

  it('sorts alphabetically within each group', () => {
    const tags = ['z-draw', 'draw-first', 'a-draw', 'draw-second'];
    const result = filterTags(tags, 'draw');
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
