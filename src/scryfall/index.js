// Scryfall API interaction — Public API.

export {
  buildReverseIndex, extractTagNames,
  buildCompactIndex, expandCompactIndex, splitCompactIndex,
} from './tags.js';
export { ORACLE_TAGS_URL, ILLUSTRATION_TAGS_URL, SCRYFALL_CARD_API } from './constants.js';
export { fetchTagIndexes, fetchCard, fetchCardByName, fetchCardCollection } from './api.js';
