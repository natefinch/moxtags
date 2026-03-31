// MoxTags — Autocomplete logic (pure logic, no browser APIs).

import { ORACLE_PREFIXES, ART_PREFIXES, ALL_PREFIXES, MAX_VISIBLE } from './constants.js';

/**
 * Parse the input value at a cursor position and return the matched prefix
 * and partial, or null if no prefix is found.
 *
 * @param {string} value - The full input value.
 * @param {number} cursor - The cursor position (selectionStart).
 * @returns {{ prefix: string, partial: string, wordStart: number, isOracle: boolean }|null}
 */
export function parseInput(value, cursor) {
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
 * Filter and sort tags by word-prefix matching.
 *
 * Tags are matched if any dash-delimited word starts with the partial.
 * Results are sorted with whole-tag prefix matches first, then
 * later-word matches, alphabetical within each group.
 *
 * @param {string[]} tagList - Sorted array of tag name strings.
 * @param {string} partial - The typed text after the prefix colon.
 * @returns {string[]} Filtered and sorted tag names.
 */
export function filterAndSortTags(tagList, partial) {
  if (!partial) return [];
  const lowerPartial = partial.toLowerCase();

  const filtered = tagList.filter(t => {
    const lower = t.toLowerCase();
    if (lower.startsWith(lowerPartial)) return true;
    for (let i = lower.indexOf('-'); i !== -1; i = lower.indexOf('-', i + 1)) {
      if (lower.startsWith(lowerPartial, i + 1)) return true;
    }
    return false;
  });

  filtered.sort((a, b) => {
    const aPrefix = a.toLowerCase().startsWith(lowerPartial) ? 0 : 1;
    const bPrefix = b.toLowerCase().startsWith(lowerPartial) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return a.localeCompare(b);
  });

  return filtered;
}

/**
 * Compute how many items to render in the dropdown.
 * Capped for short partials (1-2 chars) to avoid DOM bloat; uncapped at 3+.
 *
 * @param {number} filteredLength - Total number of matching tags.
 * @param {number} partialLength - Length of the typed partial.
 * @returns {number}
 */
export function renderCount(filteredLength, partialLength) {
  if (partialLength >= 3) return filteredLength;
  return Math.min(filteredLength, MAX_VISIBLE * 5);
}

/**
 * Build highlighted segments for a tag given a partial.
 * Returns an array of { text, bold } objects representing the tag name
 * with the matched portion of each matching word in bold.
 *
 * @param {string} tag - The full tag name.
 * @param {string} partial - The lowercase partial to highlight.
 * @returns {{ text: string, bold: boolean }[]}
 */
export function highlightTag(tag, partial) {
  const lowerTag = tag.toLowerCase();
  const pLen = partial.length;

  // Find all word-boundary positions where partial matches
  const matchPositions = [];
  const wordStarts = [0];
  for (let i = 0; i < lowerTag.length; i++) {
    if (lowerTag[i] === '-') wordStarts.push(i + 1);
  }
  for (const pos of wordStarts) {
    if (lowerTag.startsWith(partial, pos)) {
      matchPositions.push(pos);
    }
  }

  if (matchPositions.length === 0) {
    return [{ text: tag, bold: false }];
  }

  const segments = [];
  let cursor = 0;
  for (const pos of matchPositions) {
    if (pos > cursor) {
      segments.push({ text: tag.substring(cursor, pos), bold: false });
    }
    const boldStart = Math.max(pos, cursor);
    const boldEnd = pos + pLen;
    if (boldEnd > boldStart) {
      segments.push({ text: tag.substring(boldStart, boldEnd), bold: true });
    }
    cursor = boldEnd;
  }
  if (cursor < tag.length) {
    segments.push({ text: tag.substring(cursor), bold: false });
  }
  return segments;
}
