import { test, expect } from '@playwright/test';
import { installNetworkGuard, launchExtensionContext } from './extension-fixture.js';

const DECK_ID = 'e2e-deck';
const DECK_V2_URL = `https://api2.moxfield.com/v2/decks/all/${DECK_ID}`;
const DECK_V3_URL = `https://api2.moxfield.com/v3/decks/all/${DECK_ID}`;
const MOXFIELD_URL = `https://www.moxfield.com/decks/${DECK_ID}`;
const PUBLIC_DECK_URL = 'https://www.moxfield.com/decks/public-e2e-deck';
const SEARCH_OPTIONS_URL = 'https://www.moxfield.com/search/cards?q=e2e-options';
const SEARCH_LONG_URL = 'https://www.moxfield.com/search/cards?q=e2e-long';
const MOXFIELD_CARD_URL = 'https://www.moxfield.com/cards/vPo0V-e2e-test-card';
const CARD_DETAILS_URL = 'https://api2.moxfield.com/v2/cards/details/vPo0V';
const SCRYFALL_CARD_URL = 'https://scryfall.com/card/e2e/1/e2e-test-card';
const TEST_ORACLE_ID = '7404c078-228b-4296-bf1f-62f57bf832d9';
const TEST_ILLUSTRATION_ID = '45859cfd-16b0-44d0-a2ff-2a9b1df5bccd';

const deckJson = {
  mainboard: {
    vPo0V: {
      quantity: 1,
      card: {
        name: 'E2E Test Card',
        set: 'e2e',
        cn: '1',
      },
    },
  },
};

function moxfieldFixtureHtml() {
  return `<!doctype html>
    <html>
      <head>
        <title>MoxTags E2E Moxfield Fixture</title>
        <script>
          window.__fixtureDeckFetchDone = false;
          fetch('${DECK_V2_URL}')
            .then(response => response.json())
            .then(data => { window.__fixtureDeckFetchDone = Boolean(data.mainboard); })
            .catch(error => { window.__fixtureDeckFetchError = error.message; });
        </script>
      </head>
      <body>
        <form class="dropdown">
          <input id="deckbox-search" type="search" placeholder="Search for cards">
          <button class="btn btn-primary" type="submit">Search</button>
        </form>
        <aside class="deckview-image-container">
          <img alt="E2E Test Card" src="https://assets.moxfield.net/cards/card-vPo0V-normal.webp">
          <div class="d-grid gap-2 mt-4 mx-auto">
            <button class="btn btn-sm btn-outline-primary">
              <span><span>Add to Wish List</span></span>
            </button>
            <a class="btn btn-sm btn-primary" href="#">Buy @ TCGplayer</a>
          </div>
        </aside>
        <div class="decklist-card" data-hash="vPo0V">
          <a href="/cards/vPo0V-e2e-test-card"><img alt="E2E Test Card" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a>
          <span data-testid="deck-card-name">E2E Test Card</span>
        </div>
      </body>
    </html>`;
}

function scryfallCardFixtureHtml() {
  return `<!doctype html>
    <html>
      <head><title>E2E Test Card · Scryfall</title></head>
      <body>
        <input id="header-search-field" type="search" value="">
        <main>
          <article class="card-profile">
            <a class="print-langs-item current" href="/card/e2e/1/e2e-test-card">English</a>
            <div class="card-text">
              <p class="card-text-title">E2E Test Card</p>
              <p class="card-text-artist">Illustrated by Test Artist</p>
            </div>
          </article>
        </main>
      </body>
    </html>`;
}

function publicDeckFixtureHtml() {
  return `<!doctype html>
    <html>
      <head><title>Public Moxfield Deck Fixture</title></head>
      <body>
        <aside class="deckview-image-container">
          <img alt="E2E Test Card" src="https://assets.moxfield.net/cards/card-vPo0V-normal.webp">
          <div class="d-grid gap-2 mt-4 mx-auto">
            <button class="btn btn-sm btn-outline-primary">
              <span><span>Add to Wish List</span></span>
            </button>
            <a class="btn btn-sm btn-primary" href="#">Buy @ TCGplayer</a>
          </div>
        </aside>
      </body>
    </html>`;
}

function searchOptionsFixtureHtml() {
  return `<!doctype html>
    <html>
      <head><title>Moxfield Search Options Fixture</title></head>
      <body>
        <div class="decklist-card">
          <div class="decklist-card-phantomsearch">E2E Test Card</div>
          <a href="/cards/vPo0V-e2e-test-card"><img alt="E2E Test Card" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></a>
          <div class="dropdown"><button type="button" class="dropdown-toggle">Options</button></div>
        </div>
      </body>
    </html>`;
}

function longLayoutFixtureHtml() {
  return `<!doctype html>
    <html>
      <head><title>Moxfield Long Layout Fixture</title></head>
      <body><main id="results"></main></body>
    </html>`;
}

function cardPageFixtureHtml() {
  return `<!doctype html>
    <html>
      <head><title>E2E Test Card · Moxfield</title></head>
      <body>
        <main>
          <div class="row">
            <div class="col-md-8">
              <h1><strong>E2E Test Card</strong></h1>
              <div class="d-flex">
                <a href="/search/cards?q=e:e2e">E2E</a>
                <span># 1</span>
              </div>
            </div>
          </div>
          <h3>Format Legalities</h3>
          <div class="row">
            <div class="col"><span aria-label="Legal"></span></div>
            <div class="col"><span aria-label="Legal"></span></div>
            <div class="col"><span aria-label="Not Legal"></span></div>
            <div class="col"><span aria-label="Banned"></span></div>
          </div>
        </main>
      </body>
    </html>`;
}

async function installDeterministicRoutes(context, counters) {
  await context.route('**/favicon.ico', route => route.fulfill({
    status: 204,
    body: '',
  }));

  await context.route('https://assets.moxfield.net/**', route => route.fulfill({
    status: 204,
    body: '',
  }));

  await context.route(MOXFIELD_URL, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: moxfieldFixtureHtml(),
  }));

  await context.route(PUBLIC_DECK_URL, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: publicDeckFixtureHtml(),
  }));

  await context.route(SEARCH_OPTIONS_URL, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: searchOptionsFixtureHtml(),
  }));

  await context.route(SEARCH_LONG_URL, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: longLayoutFixtureHtml(),
  }));

  await context.route(MOXFIELD_CARD_URL, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: cardPageFixtureHtml(),
  }));

  await context.route('https://api2.moxfield.com/v2/decks/all/**', route => {
    counters.deckV2 += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(deckJson),
    });
  });

  await context.route('https://api2.moxfield.com/v3/decks/all/**', route => {
    counters.deckV3 += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(deckJson),
    });
  });

  await context.route(CARD_DETAILS_URL, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ card: { set: 'e2e', cn: '1' } }),
  }));

  await context.route(SCRYFALL_CARD_URL, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: scryfallCardFixtureHtml(),
  }));

  await context.route('https://api.scryfall.com/cards/collection', async route => {
    counters.scryfallCollection = (counters.scryfallCollection || 0) + 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [{
          set: 'e2e',
          collector_number: '1',
          oracle_id: TEST_ORACLE_ID,
          illustration_id: TEST_ILLUSTRATION_ID,
        }],
      }),
    });
  });

  await context.route('https://api.scryfall.com/cards/e2e/1', route => {
    counters.scryfallCard = (counters.scryfallCard || 0) + 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        oracle_id: TEST_ORACLE_ID,
        illustration_id: TEST_ILLUSTRATION_ID,
      }),
    });
  });

  await context.route('https://api.scryfall.com/private/tags/oracle', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: [{ label: 'card-tag', oracle_ids: [TEST_ORACLE_ID] }],
    }),
  }));

  await context.route('https://api.scryfall.com/private/tags/illustration', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: [{ label: 'art-tag', illustration_ids: [TEST_ILLUSTRATION_ID] }],
    }),
  }));
}

async function launchGuardedContext(counters = { deckV2: 0, deckV3: 0 }) {
  const launched = await launchExtensionContext();
  // Playwright route handlers run in reverse registration order. Install the
  // catch-all guard first so later deterministic fixture routes win.
  const networkGuard = await installNetworkGuard(launched.context);
  await installDeterministicRoutes(launched.context, counters);
  return { ...launched, counters, networkGuard };
}

async function waitForDeckDataReady(page, consoleMessages) {
  await expect.poll(async () => page.evaluate(() =>
    document.documentElement.getAttribute('data-moxtags-deck')
  )).toBe('ready');

  await expect.poll(async () => page.evaluate(() =>
    Boolean(document.getElementById('moxtags-deck-json')?.textContent)
  )).toBe(true);

  await expect.poll(() =>
    consoleMessages.some(text =>
      text.includes('fetchDeckData: Strategy 1 SUCCESS')
      || text.includes('fetchDeckData: Strategy 2 SUCCESS')
    )
  ).toBe(true);
}

async function appendOwnedDeckContextMenu(page) {
  await page.evaluate(() => {
    const existing = document.querySelector('.dropdown-menu.show');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'dropdown-menu show';
    menu.innerHTML = `
      <div class="dropdown-menu-parent" tabindex="-1">
        <div class="d-flex flex-nowrap">
          <div class="d-inline-block">
            <a class="dropdown-item cursor-pointer no-outline">Add to Another Deck...</a>
            <a class="dropdown-item cursor-pointer no-outline">Add to Collection</a>
            <a class="dropdown-item cursor-pointer no-outline">Add to Wish List</a>
            <a class="dropdown-item cursor-pointer no-outline">Switch Printing</a>
            <a class="dropdown-item cursor-pointer no-outline">Change Tags</a>
            <div class="dropdown-divider"></div>
            <a class="dropdown-item cursor-pointer no-outline" href="/cards/vPo0V-e2e-test-card">View Details</a>
            <a class="dropdown-item cursor-pointer no-outline">Copy Card Name</a>
          </div>
          <div class="d-inline-block dropdown-column-divider">
            <a class="dropdown-item cursor-pointer no-outline">Add One</a>
            <a class="dropdown-item cursor-pointer no-outline">Remove</a>
            <a class="dropdown-item cursor-pointer no-outline">Set as Deck Image</a>
          </div>
        </div>
      </div>`;
    document.body.appendChild(menu);
  });
}

async function appendSearchOptionsMenu(page) {
  await page.evaluate(() => {
    const menu = document.createElement('div');
    menu.className = 'dropdown-menu show';
    menu.innerHTML = `
      <div class="dropdown-menu-parent" tabindex="-1">
        <a class="dropdown-item cursor-pointer no-outline">Add to Main Deck</a>
        <a class="dropdown-item cursor-pointer no-outline">Add to Sideboard</a>
        <a class="dropdown-item cursor-pointer no-outline">Add to Considering</a>
        <a class="dropdown-item cursor-pointer no-outline">Add to Wish List</a>
        <a class="dropdown-item cursor-pointer no-outline" href="/cards/vPo0V-e2e-test-card">View Details</a>
        <a class="dropdown-item cursor-pointer no-outline">Copy Card Name</a>
        <a class="dropdown-item">Buy on Mana Pool</a>
      </div>`;
    document.body.appendChild(menu);
  });
}

async function appendLongLayoutRow(page) {
  await page.evaluate(() => {
    const row = document.createElement('div');
    row.className = 'row justify-content-center';
    row.innerHTML = `
      <div class="col-12 col-md-auto text-center mb-3">
        <a href="/cards/vPo0V-e2e-test-card">
          <img class="img-card img-fluid cursor-pointer" alt="E2E Test Card" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
        </a>
      </div>
      <div class="col-12 col-md">
        <h3><a href="/cards/vPo0V-e2e-test-card">E2E Test Card</a></h3>
      </div>
      <div class="col-9 col-sm-7 col-md-3 px-5 px-md-3">
        <div class="mb-2"><button class="btn w-100 btn-secondary" type="button"><span>Add to Main Deck</span></button></div>
        <div class="mb-2"><button class="btn w-100 btn-secondary" type="button"><span>Add to Sideboard</span></button></div>
        <div class="mb-2"><button class="btn w-100 btn-secondary" type="button"><span>Add to Considering</span></button></div>
        <button class="btn w-100 btn-secondary" type="button"><span>More Options</span></button>
      </div>`;
    document.getElementById('results').appendChild(row);
  });
}

test.describe('Playwright extension foundation', () => {
  test('loads the built extension on a manifest-matched Moxfield origin', async () => {
    const { context, extensionId, close, counters, networkGuard } = await launchGuardedContext();

    const page = await context.newPage();
    const consoleMessages = [];
    page.on('console', msg => consoleMessages.push(msg.text()));

    try {
      await page.goto(MOXFIELD_URL, { waitUntil: 'domcontentloaded' });

      await expect.poll(async () => page.evaluate(() =>
        document.documentElement.getAttribute('data-moxtags-deck')
      )).toBe('ready');

      await expect.poll(async () => page.evaluate(() =>
        Boolean(document.getElementById('moxtags-deck-json')?.textContent)
      )).toBe(true);

      await waitForDeckDataReady(page, consoleMessages);

      const interceptedDeck = await page.evaluate(() =>
        JSON.parse(document.getElementById('moxtags-deck-json').textContent)
      );
      expect(interceptedDeck.mainboard.vPo0V.card.name).toBe('E2E Test Card');

      await expect.poll(async () => page.evaluate(() => window.__fixtureDeckFetchDone))
        .toBe(true);

      expect(extensionId).toMatch(/^[a-p]{32}$/);
      expect(counters.deckV2).toBeGreaterThanOrEqual(1);

      await expect.poll(() =>
        consoleMessages.some(text => text.includes('[MoxTags Hook] Page hook loaded'))
      ).toBe(true);
      await expect.poll(() =>
        consoleMessages.some(text => text.includes('[MoxTags] Content script loaded'))
      ).toBe(true);

    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });

  test('mocks background service-worker fetches through the real runtime message handler', async () => {
    const { context, extensionId, close, counters, networkGuard } = await launchGuardedContext();

    const extensionPage = await context.newPage();

    try {
      await extensionPage.goto(`chrome-extension://${extensionId}/popup.html`);

      const response = await extensionPage.evaluate(async (url) => {
        return await new Promise(resolve => {
          chrome.runtime.sendMessage({ type: 'fetch', url }, resolve);
        });
      }, DECK_V3_URL);

      expect(response.ok).toBe(true);
      expect(JSON.parse(response.body).mainboard.vPo0V.card.name).toBe('E2E Test Card');
      expect(counters.deckV3).toBeGreaterThanOrEqual(1);

    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });

  test('injects card and art tags into an owned-deck context menu only', async () => {
    const { context, close, networkGuard } = await launchGuardedContext();

    const page = await context.newPage();
    const consoleMessages = [];
    page.on('console', msg => consoleMessages.push(msg.text()));

    try {
      await page.goto(MOXFIELD_URL, { waitUntil: 'domcontentloaded' });
      await waitForDeckDataReady(page, consoleMessages);

      await page.locator('[data-testid="deck-card-name"]').dispatchEvent('mousedown', {
        bubbles: true,
        button: 2,
      });
      await appendOwnedDeckContextMenu(page);

      const menuInjection = page.locator('.dropdown-menu.show [data-moxtags-surface="moxfield-menu"]');
      await expect(menuInjection).toHaveCount(1);

      await expect(menuInjection.locator('[data-moxtags-trigger="art-tags"] .moxtags-trigger-label', { hasText: 'Art Tags' }))
        .toHaveCount(1);
      await expect(menuInjection.locator('[data-moxtags-trigger="card-tags"] .moxtags-trigger-label', { hasText: 'Card Tags' }))
        .toHaveCount(1);

      await expect(page.locator('.deckview-image-container [data-moxtags-surface]')).toHaveCount(0);
      await expect(page.locator('[data-moxtags-surface]')).toHaveCount(1);

      await page.evaluate(() => {
        const menu = document.querySelector('.dropdown-menu.show');
        menu.setAttribute('data-rerender-probe', String(Date.now()));
      });
      await expect(page.locator('.dropdown-menu.show .moxtags-injected')).toHaveCount(1);

    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });

  test('injects card and art tags into the public deck preview panel only', async () => {
    const { context, close, networkGuard } = await launchGuardedContext();
    const page = await context.newPage();

    try {
      await page.goto(PUBLIC_DECK_URL, { waitUntil: 'domcontentloaded' });
      await page.locator('body').dispatchEvent('mousedown', { bubbles: true });

      const previewInjection = page.locator('.deckview-image-container [data-moxtags-surface="moxfield-preview"]');
      await expect(previewInjection).toHaveCount(1, { timeout: 15_000 });
      await expect(previewInjection.locator(':scope > [data-moxtags-trigger="art-tags"]')).toHaveCount(1);
      await expect(previewInjection.locator(':scope > [data-moxtags-trigger="card-tags"]')).toHaveCount(1);
      await expect(page.locator('.dropdown-menu.show [data-moxtags-surface]')).toHaveCount(0);
      await expect(page.locator('[data-moxtags-surface]')).toHaveCount(1);
    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });

  test('injects into a Moxfield search result Options dropdown without duplicates', async () => {
    const { context, close, networkGuard } = await launchGuardedContext();
    const page = await context.newPage();

    try {
      await page.goto(SEARCH_OPTIONS_URL, { waitUntil: 'domcontentloaded' });

      await page.locator('.dropdown-toggle').dispatchEvent('mousedown', {
        bubbles: true,
        button: 0,
      });
      await appendSearchOptionsMenu(page);

      const menuInjection = page.locator('.dropdown-menu.show [data-moxtags-surface="moxfield-menu"]');
      await expect(menuInjection).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator('.dropdown-menu.show a', { hasText: 'Buy on Mana Pool' }).locator('+ [data-moxtags-surface="moxfield-menu"]')).toHaveCount(1);
      await expect(menuInjection.locator('[data-moxtags-trigger="art-tags"]')).toHaveCount(1);
      await expect(menuInjection.locator('[data-moxtags-trigger="card-tags"]')).toHaveCount(1);

      await page.evaluate(() => {
        document.querySelector('.dropdown-menu.show').setAttribute('data-rerender-probe', '1');
      });
      await expect(page.locator('.dropdown-menu.show [data-moxtags-surface="moxfield-menu"]')).toHaveCount(1);
      await expect(page.locator('.deckview-image-container [data-moxtags-surface]')).toHaveCount(0);
    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });

  test('injects long-layout Art/Card tag buttons and lazily renders tag menu', async () => {
    const { context, close, networkGuard } = await launchGuardedContext();
    const page = await context.newPage();

    try {
      await page.goto(SEARCH_LONG_URL, { waitUntil: 'domcontentloaded' });
      await appendLongLayoutRow(page);

      const longSurface = page.locator('[data-moxtags-surface="moxfield-long-layout"]');
      await expect(longSurface).toHaveCount(1, { timeout: 15_000 });
      await expect(longSurface.locator('[data-moxtags-trigger="art-tags"]')).toHaveCount(1);
      await expect(longSurface.locator('[data-moxtags-trigger="card-tags"]')).toHaveCount(1);

      await expect(page.locator('.col-md-3 > button', { hasText: 'More Options' })).toHaveCount(1);
      await expect(page.locator('.col-md-3 > button + [data-moxtags-surface="moxfield-long-layout"]')).toHaveCount(1);

      await longSurface.locator('[data-moxtags-trigger="art-tags"] > button').click();
      const longMenu = page.locator('[data-moxtags-surface="moxfield-long-layout-menu"].show');
      await expect(longMenu).toHaveCount(1);
      await expect(longMenu.locator('.moxtags-tag-item', { hasText: 'art-tag' })).toHaveCount(1, { timeout: 15_000 });

      await longSurface.locator('[data-moxtags-trigger="art-tags"] > button').click();
      await expect(page.locator('[data-moxtags-surface="moxfield-long-layout-menu"].show')).toHaveCount(0);

      await longSurface.locator('[data-moxtags-trigger="card-tags"] > button').click();
      await expect(page.locator('[data-moxtags-surface="moxfield-long-layout-menu"].show .moxtags-tag-item', { hasText: 'card-tag' })).toHaveCount(1, { timeout: 15_000 });

      await page.evaluate(() => {
        document.getElementById('results').setAttribute('data-rerender-probe', '1');
      });
      await expect(page.locator('[data-moxtags-surface="moxfield-long-layout"]')).toHaveCount(1);
    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });

  test('injects card-page tag sections before Format Legalities', async () => {
    const { context, close, networkGuard } = await launchGuardedContext();
    const page = await context.newPage();

    try {
      await page.goto(MOXFIELD_CARD_URL, { waitUntil: 'domcontentloaded' });

      const cardPageTags = page.locator('[data-moxtags-surface="moxfield-card-page"]');
      await expect(cardPageTags).toHaveCount(1, { timeout: 15_000 });
      await expect(page.locator('main > [data-moxtags-surface="moxfield-card-page"] + hr + h3', { hasText: 'Format Legalities' })).toHaveCount(1);
      await expect(cardPageTags.locator('[data-moxtags-section="card-tags"]')).toHaveCount(1);
      await expect(cardPageTags.locator('[data-moxtags-section="art-tags"]')).toHaveCount(1);
      await expect(cardPageTags.locator('[data-moxtags-trigger="card-tags"]')).toHaveCount(1);
      await expect(cardPageTags.locator('[data-moxtags-trigger="art-tags"]')).toHaveCount(1);
      await expect(cardPageTags.locator('.moxtags-moxfield-overlay-tag-link', { hasText: 'card-tag' })).toHaveCount(1);
      await expect(cardPageTags.locator('.moxtags-moxfield-overlay-tag-link', { hasText: 'art-tag' })).toHaveCount(1);
    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });

  test('injects Scryfall card-page tag sections after the artist credit', async () => {
    const { context, close, networkGuard } = await launchGuardedContext();

    const page = await context.newPage();

    try {
      await page.goto(SCRYFALL_CARD_URL, { waitUntil: 'domcontentloaded' });

      const injected = page.locator('p.card-text-artist + section[data-moxtags-surface="scryfall-card"]');
      await expect(injected).toHaveCount(1);
      await expect(injected.locator('.moxtags-scryfall-toggle-label', { hasText: 'Card Tags' }))
        .toHaveCount(1, { timeout: 15_000 });
      await expect(injected.locator('.moxtags-scryfall-toggle-label', { hasText: 'Art Tags' }))
        .toHaveCount(1, { timeout: 15_000 });
      await expect(injected.locator('a.moxtags-scryfall-tag-link')).toHaveCount(2, { timeout: 15_000 });

      await injected.locator('a.moxtags-scryfall-tag-link', { hasText: 'card-tag' }).click();
      await expect(page.locator('#header-search-field')).toHaveValue('otag:card-tag');

    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });

  test('network guard reports unmocked page and service-worker requests', async () => {
    const { context, serviceWorker, close, networkGuard } = await launchGuardedContext();
    const page = await context.newPage();

    try {
      await page.goto(MOXFIELD_URL, { waitUntil: 'domcontentloaded' });

      await page.evaluate(async () => {
        await fetch('https://unexpected.example.com/page-probe').catch(() => null);
      });
      await serviceWorker.evaluate(async () => {
        await fetch('https://unexpected.example.com/service-worker-probe').catch(() => null);
      });

      expect(networkGuard.violations.map(v => v.url)).toEqual(expect.arrayContaining([
        'https://unexpected.example.com/page-probe',
        'https://unexpected.example.com/service-worker-probe',
      ]));
      // This proof is load-bearing: it verifies Playwright is still routing
      // both page and MV3 service-worker fetches through the guard.
    } finally {
      await close();
    }
  });
});
