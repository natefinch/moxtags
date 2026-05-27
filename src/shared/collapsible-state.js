// Shared persistence for collapsed/expanded MoxTags tag sections.

const KEY_PREFIX = 'moxtags.collapsible';
const boundSectionsByKey = new Map();
const keyGenerations = new Map();
const latestExpandedByKey = new Map();

export function bindPersistentCollapsibleSection({
  site,
  section,
  toggle,
  body,
  defaultExpanded = true,
  storage = detectCollapsibleStateStorage(),
  onError = defaultOnError,
}) {
  if (!site || !section || !toggle || !body) {
    throw new TypeError('site, section, toggle, and body are required');
  }

  const key = buildCollapsibleStateKey(site, section);
  let userChanged = false;
  const loadGeneration = getKeyGeneration(key);

  function applyExpanded(expanded) {
    toggle.setAttribute('aria-expanded', String(expanded));
    body.hidden = !expanded;
  }

  function isExpanded() {
    return toggle.getAttribute('aria-expanded') === 'true';
  }

  applyExpanded(defaultExpanded);
  registerBoundSection(key, applyExpanded);
  if (latestExpandedByKey.has(key)) {
    applyExpanded(latestExpandedByKey.get(key));
  }

  storage.get(key)
    .then((storedExpanded) => {
      const latestExpanded = latestExpandedByKey.get(key);
      if (
        !userChanged
        && loadGeneration === getKeyGeneration(key)
        && typeof storedExpanded === 'boolean'
        && (typeof latestExpanded !== 'boolean' || latestExpanded === storedExpanded)
      ) {
        latestExpandedByKey.set(key, storedExpanded);
        applyExpandedToBoundSections(key, storedExpanded);
      }
    })
    .catch(err => onError('Could not load MoxTags collapsed section state', err));

  return function toggleExpanded() {
    userChanged = true;
    const expanded = !isExpanded();
    bumpKeyGeneration(key);
    latestExpandedByKey.set(key, expanded);
    applyExpandedToBoundSections(key, expanded);
    storage.set(key, expanded)
      .catch(err => onError('Could not save MoxTags collapsed section state', err));
    return expanded;
  };
}

export function buildCollapsibleStateKey(site, section) {
  return `${KEY_PREFIX}.${site}.${section}`;
}

export function createMemoryCollapsibleStateStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get(key) {
      return Promise.resolve(values.get(key));
    },
    set(key, value) {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

function registerBoundSection(key, applyExpanded) {
  let sections = boundSectionsByKey.get(key);
  if (!sections) {
    sections = new Set();
    boundSectionsByKey.set(key, sections);
  }
  sections.add(applyExpanded);
}

function applyExpandedToBoundSections(key, expanded) {
  const sections = boundSectionsByKey.get(key);
  if (!sections) return;
  for (const applyExpanded of sections) {
    applyExpanded(expanded);
  }
}

function getKeyGeneration(key) {
  return keyGenerations.get(key) || 0;
}

function bumpKeyGeneration(key) {
  keyGenerations.set(key, getKeyGeneration(key) + 1);
}

function detectCollapsibleStateStorage() {
  if (globalThis.chrome?.storage?.local) {
    return createChromeStorageAdapter(globalThis.chrome);
  }

  if (globalThis.localStorage) {
    return createLocalStorageAdapter(globalThis.localStorage);
  }

  return createUnavailableStorageAdapter();
}

function createChromeStorageAdapter(chromeApi) {
  return {
    get(key) {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.get(key, (result) => {
          const err = chromeApi.runtime?.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve(result?.[key]);
        });
      });
    },
    set(key, value) {
      return new Promise((resolve, reject) => {
        chromeApi.storage.local.set({ [key]: value }, () => {
          const err = chromeApi.runtime?.lastError;
          if (err) {
            reject(new Error(err.message));
            return;
          }
          resolve();
        });
      });
    },
  };
}

function createLocalStorageAdapter(localStorage) {
  return {
    get(key) {
      return Promise.resolve().then(() => {
        const value = localStorage.getItem(key);
        if (value === 'true') return true;
        if (value === 'false') return false;
        return undefined;
      });
    },
    set(key, value) {
      return Promise.resolve().then(() => {
        localStorage.setItem(key, String(value));
      });
    },
  };
}

function createUnavailableStorageAdapter() {
  return {
    get() {
      return Promise.reject(new Error('No browser storage API is available'));
    },
    set() {
      return Promise.reject(new Error('No browser storage API is available'));
    },
  };
}

function defaultOnError(message, err) {
  console.warn('[MoxTags]', message, err);
}
