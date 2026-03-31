// MoxTags — Shared constants used by both background and content scripts.

// Scryfall tag data API endpoints.
export const ORACLE_TAGS_URL = 'https://api.scryfall.com/private/tags/oracle';
export const ILLUSTRATION_TAGS_URL = 'https://api.scryfall.com/private/tags/illustration';
export const SCRYFALL_CARD_API = 'https://api.scryfall.com/cards';

// How often to refresh the tag data (roughly once per day).
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Autocomplete trigger prefixes.
export const ORACLE_PREFIXES = ['otag:', 'oracletag:', 'function:'];
export const ART_PREFIXES = ['art:', 'atag:', 'arttag:'];
export const ALL_PREFIXES = [...ORACLE_PREFIXES, ...ART_PREFIXES];

// Max visible autocomplete items before scrolling.
export const MAX_VISIBLE = 10;

// Moxfield deck board names.
export const BOARD_NAMES = [
  'mainboard', 'sideboard', 'commanders', 'companions',
  'signatureSpells', 'considering', 'attractions',
  'stickers', 'contraptions', 'planes', 'schemes', 'tokens',
];

// Menu detection keywords.
export const MENU_KEYWORDS = [
  'Switch Printing', 'Change Tags', 'View Details',
  'Copy Card Name', 'Change Mana Cost', 'Set as Deck Image',
  'Add One', 'Remove',
];
