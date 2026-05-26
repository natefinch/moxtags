// MoxTags — Extension-specific shared constants.
// Moxfield and Scryfall constants have moved to their respective packages.

// How often to refresh the tag data (roughly once per day).
export const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Autocomplete trigger prefixes.
export const ORACLE_PREFIXES = ['otag:', 'oracletag:', 'function:'];
export const ART_PREFIXES = ['art:', 'atag:', 'arttag:'];
export const ALL_PREFIXES = [...ORACLE_PREFIXES, ...ART_PREFIXES];

// Max visible autocomplete items before scrolling.
export const MAX_VISIBLE = 10;
