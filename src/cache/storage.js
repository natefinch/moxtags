// Cache — Promisified wrapper around chrome.storage.local.

/**
 * Get values from chrome.storage.local.
 * @param {string|string[]} keys - Key(s) to retrieve.
 * @returns {Promise<Object>} Object with key-value pairs.
 */
export function get(keys) {
  return chrome.storage.local.get(keys);
}

/**
 * Set values in chrome.storage.local.
 * @param {Object} items - Key-value pairs to store.
 * @returns {Promise<void>}
 */
export function set(items) {
  return chrome.storage.local.set(items);
}

/**
 * Remove values from chrome.storage.local.
 * @param {string|string[]} keys - Key(s) to remove.
 * @returns {Promise<void>}
 */
export function remove(keys) {
  return chrome.storage.local.remove(keys);
}
