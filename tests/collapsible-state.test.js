// Tests for persisted collapsible tag-section state.
// Run with: node --test tests/collapsible-state.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

import {
  bindPersistentCollapsibleSection,
  buildCollapsibleStateKey,
  createMemoryCollapsibleStateStorage,
} from '../src/shared/collapsible-state.js';

function buildSection() {
  const { document } = parseHTML('<button type="button"></button><div></div>');
  return {
    toggle: document.querySelector('button'),
    body: document.querySelector('div'),
  };
}

function tick() {
  return Promise.resolve();
}

describe('buildCollapsibleStateKey', () => {
  it('scopes section state by website and section', () => {
    assert.equal(
      buildCollapsibleStateKey('scryfall', 'card-tags'),
      'moxtags.collapsible.scryfall.card-tags'
    );
    assert.notEqual(
      buildCollapsibleStateKey('scryfall', 'card-tags'),
      buildCollapsibleStateKey('moxfield', 'card-tags')
    );
  });
});

describe('bindPersistentCollapsibleSection', () => {
  it('defaults to expanded when no stored state exists', async () => {
    const { toggle, body } = buildSection();
    bindPersistentCollapsibleSection({
      site: 'default-site',
      section: 'card-tags',
      toggle,
      body,
      storage: createMemoryCollapsibleStateStorage(),
    });

    await tick();

    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(body.hidden, false);
  });

  it('applies saved expanded state', async () => {
    const { toggle, body } = buildSection();
    const storage = createMemoryCollapsibleStateStorage({
      [buildCollapsibleStateKey('archidekt', 'art-tags')]: true,
    });

    bindPersistentCollapsibleSection({
      site: 'archidekt',
      section: 'art-tags',
      toggle,
      body,
      storage,
    });

    await tick();

    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(body.hidden, false);
  });

  it('applies saved collapsed state', async () => {
    const { toggle, body } = buildSection();
    const storage = createMemoryCollapsibleStateStorage({
      [buildCollapsibleStateKey('collapsed-site', 'card-tags')]: false,
    });

    bindPersistentCollapsibleSection({
      site: 'collapsed-site',
      section: 'card-tags',
      toggle,
      body,
      storage,
    });

    await tick();

    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(body.hidden, true);
  });

  it('persists toggled state', async () => {
    const { toggle, body } = buildSection();
    const storage = createMemoryCollapsibleStateStorage();
    const toggleExpanded = bindPersistentCollapsibleSection({
      site: 'moxfield',
      section: 'card-tags',
      toggle,
      body,
      storage,
    });

    toggleExpanded();
    await tick();

    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(body.hidden, true);
    assert.equal(storage.values.get(buildCollapsibleStateKey('moxfield', 'card-tags')), false);
  });

  it('syncs matching sections already rendered on the page', async () => {
    const first = buildSection();
    const second = buildSection();
    const storage = createMemoryCollapsibleStateStorage();
    const toggleFirst = bindPersistentCollapsibleSection({
      site: 'scryfall',
      section: 'card-tags',
      toggle: first.toggle,
      body: first.body,
      storage,
    });
    bindPersistentCollapsibleSection({
      site: 'scryfall',
      section: 'card-tags',
      toggle: second.toggle,
      body: second.body,
      storage,
    });

    toggleFirst();
    await tick();

    assert.equal(first.toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(first.body.hidden, true);
    assert.equal(second.toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(second.body.hidden, true);
  });

  it('applies the latest in-memory state to matching sections rendered before storage catches up', async () => {
    const key = buildCollapsibleStateKey('race-site', 'card-tags');
    const storage = {
      values: new Map([[key, false]]),
      get(requestedKey) {
        return Promise.resolve(this.values.get(requestedKey));
      },
      set(requestedKey, value) {
        this.pendingSet = { key: requestedKey, value };
        return new Promise(() => {});
      },
    };

    const first = buildSection();
    const toggleFirst = bindPersistentCollapsibleSection({
      site: 'race-site',
      section: 'card-tags',
      toggle: first.toggle,
      body: first.body,
      storage,
    });
    await tick();

    toggleFirst();

    const second = buildSection();
    bindPersistentCollapsibleSection({
      site: 'race-site',
      section: 'card-tags',
      toggle: second.toggle,
      body: second.body,
      storage,
    });
    await tick();

    assert.equal(second.toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(second.body.hidden, false);
  });

  it('does not let late-loaded state overwrite a user click', async () => {
    const { toggle, body } = buildSection();
    let resolveStored;
    const storage = {
      values: new Map(),
      get() {
        return new Promise(resolve => {
          resolveStored = resolve;
        });
      },
      set(key, value) {
        this.values.set(key, value);
        return Promise.resolve();
      },
    };

    const toggleExpanded = bindPersistentCollapsibleSection({
      site: 'scryfall',
      section: 'art-tags',
      toggle,
      body,
      storage,
      defaultExpanded: false,
    });

    toggleExpanded();
    resolveStored(false);
    await tick();

    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(body.hidden, false);
  });
});
