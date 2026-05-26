// Moxfield page interaction — Deck data parsing (pure logic, no browser APIs).

import { BOARD_NAMES } from './constants.js';

/**
 * Walk every board in the deck JSON and build a card map.
 * Handles two API response shapes:
 *   v2: boards are top-level, entries have a `.card` wrapper
 *   v3: boards are nested under `data.boards`, entries are flat card objects
 *
 * @param {Object} data - The raw deck JSON from Moxfield API.
 * @param {Function} [logFn] - Optional logging function for debug output.
 * @returns {{ cardMap: Map, moxIds: Map }|null}
 *   cardMap: lowercase card name → { name, set, cn }
 *   moxIds: Moxfield card ID → { set, cn }
 *   Returns null if no cards found.
 */
export function buildCardMap(data, logFn) {
  const log = logFn || (() => {});

  if (!data || typeof data !== 'object') {
    log('buildCardMap: invalid data –', data === null ? 'null' : typeof data);
    return null;
  }

  const cardMap = new Map();
  const moxIds = new Map();

  log('buildCardMap: data top-level keys:', Object.keys(data).slice(0, 20).join(', '));

  // Determine where the boards live: under data.boards (v3) or top-level (v2).
  const boardSource = (data.boards && typeof data.boards === 'object')
    ? data.boards
    : data;
  log('buildCardMap: using', boardSource === data ? 'top-level' : 'data.boards', 'as board source');
  if (boardSource !== data) {
    log('buildCardMap: data.boards keys:', Object.keys(boardSource).join(', '));
  }

  for (const boardName of BOARD_NAMES) {
    let board = boardSource[boardName];
    if (!board || typeof board !== 'object') continue;

    // v3 wraps each board as { count: N, cards: { id: {...}, … } }.
    // Unwrap to the inner cards object if present.
    if (board.cards && typeof board.cards === 'object') {
      log('buildCardMap: board', boardName, 'has .cards wrapper (count:', board.count, ')');
      board = board.cards;
    }

    const keys = Object.keys(board);
    if (keys.length === 0) continue;
    log('buildCardMap: board', boardName, 'has', keys.length, 'entries');

    // Log the first entry's structure for debugging.
    const first = board[keys[0]];
    if (first) {
      const firstKeys = Object.keys(first);
      log('buildCardMap: first entry in', boardName, '– keys:',
        firstKeys.slice(0, 15).join(', '), firstKeys.length > 15 ? '(+more)' : '');
      if (first.card) {
        log('buildCardMap:   → has .card wrapper – card.name:', first.card.name,
          'set:', first.card.set, 'cn:', first.card.cn);
      } else if (first.name) {
        log('buildCardMap:   → flat entry – name:', first.name,
          'set:', first.set, 'cn:', first.cn);
      }
    }

    for (const moxId of keys) {
      const entry = board[moxId];
      // v2 format: { card: { name, set, cn, … }, quantity, … }
      // v3 format: the entry itself is the card object { name, set, cn, … }
      //   or sometimes: { quantity, boardType, card: { name, set, cn, … } }
      const card = entry?.card || entry;
      if (!card?.name) continue;

      const set = (card.set || card.setCode || '').toLowerCase();
      const cn  = String(card.cn || card.collector_number || card.collectorNumber || '');
      if (!set || !cn) {
        log('buildCardMap: skipping card', card.name, '– set:', set, 'cn:', cn);
        continue;
      }

      const info = { name: card.name, set, cn };
      cardMap.set(card.name.toLowerCase(), info);

      // Map the Moxfield card ID to set/cn for the persistent cache.
      moxIds.set(moxId, { set, cn });

      // For double-faced cards ("Front // Back"), also key by front face.
      if (card.name.includes(' // ')) {
        const front = card.name.split(' // ')[0].trim().toLowerCase();
        if (!cardMap.has(front)) cardMap.set(front, info);
      }
    }
  }

  log('Card lookup ready –', cardMap.size, 'entries,', moxIds.size, 'moxfield IDs');
  return cardMap.size > 0 ? { cardMap, moxIds } : null;
}
