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
const SCRYFALL_SEARCH_URL = 'https://scryfall.com/search?q=e2e';
const ARCHIDEKT_DECK_URL = 'https://archidekt.com/decks/e2e-archidekt';
const ARCHIDEKT_DECK_API_URL = 'https://archidekt.com/api/decks/e2e-archidekt/';
const TEST_ORACLE_ID = '7404c078-228b-4296-bf1f-62f57bf832d9';
const TEST_ILLUSTRATION_ID = '45859cfd-16b0-44d0-a2ff-2a9b1df5bccd';
const TEST_ORACLE_ID_2 = '89206da7-7474-4f66-b772-eb31e536b5ad';
const TEST_ILLUSTRATION_ID_2 = '3ca67e5f-fbb0-4458-97fc-183a8228ad09';

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

const archidektDeckCardMap = {
  e2eCard: {
    name: 'E2E Test Card',
    setCode: 'e2e',
    collectorNumber: '1',
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

function scryfallSearchFixtureHtml() {
  return `<!doctype html>
    <html>
      <head><title>Scryfall E2E Search Fixture</title></head>
      <body>
        <header>
          <form action="/search">
            <input id="header-search-field" name="q" type="search" value="">
          </form>
        </header>
        <main>
          <article class="card-profile" data-testid="scryfall-result-one">
            <a class="print-langs-item current" href="/card/e2e/1/e2e-test-card">English</a>
            <p class="card-text-artist">Illustrated by E2E Artist</p>
          </article>
          <article class="card-profile" data-testid="scryfall-result-two">
            <a class="print-langs-item current" href="/card/e2b/2/e2e-second-card">English</a>
            <p class="card-text-artist">Illustrated by Second E2E Artist</p>
          </article>
        </main>
      </body>
    </html>`;
}

function archidektDeckFixtureHtml() {
  const nextData = JSON.stringify({
    props: {
      pageProps: {
        redux: {
          deck: {
            cardMap: archidektDeckCardMap,
          },
        },
      },
    },
  });

  return `<!doctype html>
    <html>
      <head>
        <title>Archidekt E2E Deck Fixture</title>
        <style>
          button, img { display: inline-block; height: 24px; width: 120px; }
          img { width: 80px; }
        </style>
        <script>
          window.__lastSyntaxSearch = '';
          window.__syntaxSearchSubmissions = [];

          function installSyntaxSearchHandlers(root) {
            const form = root.querySelector('form');
            form.addEventListener('submit', event => {
              event.preventDefault();
              const input = form.querySelector('input[type="text"]');
              window.__lastSyntaxSearch = input.value;
              window.__syntaxSearchSubmissions.push(input.value);
            });
          }

          window.__openArchidektSearchOverlay = function(initialQuery = '') {
            let overlay = document.querySelector('[class*="globalOverlayStack_overlay"]');
            if (overlay) {
              const input = overlay.querySelector('input[type="text"]');
              if (input && initialQuery !== undefined) input.value = initialQuery;
              return overlay;
            }

            overlay = document.createElement('div');
            overlay.className = 'globalOverlayStack_overlay__fixture';
            overlay.innerHTML = \`
              <div class="searchV2_container__fixture">
                <button type="button" class="tabButtons_selected__fixture">Syntax search</button>
                <form class="scryfallSearchForm_form__fixture">
                  <div class="scryfallSearchForm_input__fixture">
                    <input type="text" placeholder="color:red cmc:1">
                  </div>
                  <button type="submit">Search</button>
                </form>
              </div>\`;
            document.body.appendChild(overlay);
            const input = overlay.querySelector('input[type="text"]');
            input.value = initialQuery;
            installSyntaxSearchHandlers(overlay);
            return overlay;
          };

          document.addEventListener('DOMContentLoaded', () => {
            document.getElementById('archidekt-card-search').addEventListener('click', () => {
              window.__openArchidektSearchOverlay('');
            });
          });
        </script>
      </head>
      <body>
        <button id="archidekt-card-search" type="button">Card Search</button>
        <main>
          <div class="deckCardWrapper_container__fixture basicCard_container__fixture" data-testid="archidekt-image-card">
            <img data-testid="archidekt-card-img" alt="E2E Test Card (e2e) 1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
            <button data-testid="archidekt-image-menu" type="button">Image menu</button>
          </div>
          <div class="deckCardWrapper_container__fixture contextMenu_wrapper__fixture" data-testid="archidekt-stack-card">
            <img alt="E2E Test Card (e2e) 1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
            <button data-testid="archidekt-stack-menu" type="button">Stack menu</button>
          </div>
          <div class="textViewCard_card__fixture" data-testid="archidekt-text-card">
            <button class="textViewCard_button__fixture" data-testid="archidekt-text-menu" title="E2E Test Card" type="button">
              <span class="textViewCard_cardName__fixture">E2E Test Card</span>
            </button>
          </div>
          <div class="textViewCard_card__fixture" data-testid="archidekt-unknown-card">
            <button class="textViewCard_button__fixture" data-testid="archidekt-unknown-menu" title="Unknown Text Card" type="button">
              <span class="textViewCard_cardName__fixture">Unknown Text Card</span>
            </button>
          </div>
        </main>
        <script id="__NEXT_DATA__" type="application/json">${nextData}</script>
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

  await context.route(ARCHIDEKT_DECK_URL, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: archidektDeckFixtureHtml(),
  }));

  await context.route(ARCHIDEKT_DECK_API_URL, route => {
    counters.archidektDeckApi = (counters.archidektDeckApi || 0) + 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cardMap: archidektDeckCardMap }),
    });
  });

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

  await context.route(SCRYFALL_SEARCH_URL, route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: scryfallSearchFixtureHtml(),
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

  await context.route('https://api.scryfall.com/cards/e2b/2', route => {
    counters.scryfallCardFallback = (counters.scryfallCardFallback || 0) + 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        oracle_id: TEST_ORACLE_ID_2,
        illustration_id: TEST_ILLUSTRATION_ID_2,
      }),
    });
  });

  await context.route('https://api.scryfall.com/private/tags/oracle', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: [
        { label: 'card-tag', oracle_ids: [TEST_ORACLE_ID] },
        { label: 'second-card-tag', oracle_ids: [TEST_ORACLE_ID_2] },
      ],
    }),
  }));

  await context.route('https://api.scryfall.com/private/tags/illustration', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: [
        { label: 'art-tag', illustration_ids: [TEST_ILLUSTRATION_ID] },
        { label: 'second-art-tag', illustration_ids: [TEST_ILLUSTRATION_ID_2] },
      ],
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

async function waitForArchidektReady(consoleMessages) {
  await expect.poll(() =>
    consoleMessages.some(text =>
      text.includes('[MoxTags Archidekt] Initializing for Archidekt deck page')
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

async function replaceOwnedDeckPreviewPanel(page) {
  await page.evaluate(() => {
    document.querySelector('.deckview-image-container')?.remove();

    const preview = document.createElement('aside');
    preview.className = 'deckview-image-container';
    preview.innerHTML = `
      <img alt="E2E Test Card" src="https://assets.moxfield.net/cards/card-vPo0V-normal.webp">
      <div class="d-grid gap-2 mt-4 mx-auto">
        <button class="btn btn-sm btn-outline-primary">
          <span><span>Add to Wish List</span></span>
        </button>
        <a class="btn btn-sm btn-primary" href="#">Buy @ TCGplayer</a>
      </div>`;
    document.body.appendChild(preview);
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

async function openArchidektMenuFor(page, selector, menuClass) {
  const target = page.locator(selector);
  await target.dispatchEvent('pointerdown', { bubbles: true, button: 2 });
  await target.dispatchEvent('contextmenu', { bubbles: true, button: 2 });
  await page.evaluate((className) => {
    document.getElementById('contextMenuOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'contextMenuOverlay';
    const menu = document.createElement('div');
    menu.className = className;
    menu.innerHTML = `
      <button class="archidekt-native-menu-button" type="button">Move to</button>
      <button class="archidekt-native-menu-button" type="button">Edit categories</button>
      <div class="menu_spacer__fixture"></div>
      <div class="archidekt-menu-footer">Ctrl + Right Click for standard menu</div>`;
    overlay.appendChild(menu);
    document.body.appendChild(overlay);
  }, menuClass);
}

async function appendArchidektDetailsOverlay(page) {
  await page.evaluate(() => {
    document.querySelector('[class*="cardDetailsOverlay_container"]')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'cardDetailsOverlay_container__fixture';
    overlay.innerHTML = `
      <img alt="E2E Test Card (e2e) 1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <h2 class="cardDetailsOverlay_title__fixture">E2E Test Card</h2>
      <div class="cardInfo_extraInfo__fixture">
        <div>Rarity: Rare</div>
        <div>Legalities:</div>
        <div>Commander: Legal</div>
      </div>`;
    document.body.appendChild(overlay);
  });
}

async function appendArchidektSearchResult(page, initialQuery) {
  await page.evaluate((query) => {
    const overlay = window.__openArchidektSearchOverlay(query);
    const container = overlay.querySelector('[class*="searchV2_container"]');
    const result = document.createElement('div');
    result.className = 'deckCardWrapper_container__fixture basicCard_container__fixture';
    result.setAttribute('data-testid', 'archidekt-search-result-card');
    result.innerHTML = `
      <img data-testid="archidekt-search-result-img" alt="E2E Test Card (e2e) 1" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <button data-testid="archidekt-search-result-menu" type="button">Result menu</button>`;
    container.appendChild(result);
  }, initialQuery);
}

async function expectArchidektMenuInjection(page, menuClass) {
  const menu = page.locator(`#contextMenuOverlay [class*="${menuClass}"]`);
  const injection = menu.locator('[data-moxtags-surface="archidekt-menu"]');
  await expect(injection).toHaveCount(1, { timeout: 15_000 });
  await expect(injection).toHaveAttribute('data-moxtags-card-key', 'e2e/1');
  await expect(injection.locator('[data-moxtags-trigger="art-tags"]')).toHaveCount(1);
  await expect(injection.locator('[data-moxtags-trigger="card-tags"]')).toHaveCount(1);
  await expect(injection.locator('.moxtags-archidekt-tag-link', { hasText: 'art-tag' }))
    .toHaveCount(1, { timeout: 15_000 });
  await expect(injection.locator('.moxtags-archidekt-tag-link', { hasText: 'card-tag' }))
    .toHaveCount(1, { timeout: 15_000 });
  return injection;
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

      await replaceOwnedDeckPreviewPanel(page);
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

  test('injects Archidekt right-click menu tags and opens native Syntax Search', async () => {
    const { context, close, counters, networkGuard } = await launchGuardedContext();
    const page = await context.newPage();
    const consoleMessages = [];
    page.on('console', msg => consoleMessages.push(msg.text()));

    try {
      await page.goto(ARCHIDEKT_DECK_URL, { waitUntil: 'domcontentloaded' });
      await waitForArchidektReady(consoleMessages);

      await openArchidektMenuFor(page, '[data-testid="archidekt-card-img"]', 'deckCardContextMenu_contextMenu__fixture');

      const injection = await expectArchidektMenuInjection(page, 'deckCardContextMenu_contextMenu');
      await expect.poll(async () => page.evaluate(() => {
        const injected = document.querySelector('#contextMenuOverlay [data-moxtags-surface="archidekt-menu"]');
        const footer = [...document.querySelectorAll('#contextMenuOverlay [class*="deckCardContextMenu_contextMenu"] > *')]
          .find(el => /Ctrl\s*\+\s*Right Click/i.test(el.textContent || ''));
        return Boolean(injected && footer && (injected.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING));
      })).toBe(true);

      await injection.locator('[data-moxtags-trigger="art-tags"]').hover();
      await injection.locator('.moxtags-archidekt-tag-link', { hasText: 'art-tag' }).click();

      await expect.poll(async () => page.evaluate(() => window.__lastSyntaxSearch))
        .toBe('art:art-tag');
      await expect(page.locator('[class*="globalOverlayStack_overlay"] input[type="text"]'))
        .toHaveValue('art:art-tag');
      expect(counters.archidektDeckApi).toBeGreaterThanOrEqual(1);
    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });

  test('injects Archidekt image and text menu variants without duplicates or name fallback', async () => {
    const { context, close, networkGuard } = await launchGuardedContext();
    const page = await context.newPage();
    const consoleMessages = [];
    page.on('console', msg => consoleMessages.push(msg.text()));

    try {
      await page.goto(ARCHIDEKT_DECK_URL, { waitUntil: 'domcontentloaded' });
      await waitForArchidektReady(consoleMessages);

      await openArchidektMenuFor(page, '[data-testid="archidekt-stack-menu"]', 'imageCard_extrasMenu__fixture');
      await expectArchidektMenuInjection(page, 'imageCard_extrasMenu');
      await page.evaluate(() => {
        document.querySelector('#contextMenuOverlay [class*="imageCard_extrasMenu"]')
          .setAttribute('data-rerender-probe', '1');
      });
      await expect(page.locator('#contextMenuOverlay [data-moxtags-surface="archidekt-menu"]')).toHaveCount(1);

      await openArchidektMenuFor(page, '[data-testid="archidekt-text-menu"]', 'textViewCard_dropdown__fixture');
      await expectArchidektMenuInjection(page, 'textViewCard_dropdown');

      await openArchidektMenuFor(page, '[data-testid="archidekt-unknown-menu"]', 'textViewCard_dropdown__fixture');
      await expect(page.locator('#contextMenuOverlay [data-moxtags-surface="archidekt-menu"]')).toHaveCount(0);
    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });

  test('injects Archidekt card details sections before Legalities', async () => {
    const { context, close, networkGuard } = await launchGuardedContext();
    const page = await context.newPage();
    const consoleMessages = [];
    page.on('console', msg => consoleMessages.push(msg.text()));

    try {
      await page.goto(ARCHIDEKT_DECK_URL, { waitUntil: 'domcontentloaded' });
      await waitForArchidektReady(consoleMessages);
      await appendArchidektDetailsOverlay(page);

      const detailsTags = page.locator('[class*="cardInfo_extraInfo"] > [data-moxtags-surface="archidekt-details"]');
      await expect(detailsTags).toHaveCount(1, { timeout: 15_000 });
      await expect(detailsTags).toHaveAttribute('data-moxtags-card-key', 'e2e/1');
      await expect(page.locator('[class*="cardInfo_extraInfo"] > [data-moxtags-surface="archidekt-details"] + div', { hasText: 'Legalities:' }))
        .toHaveCount(1);
      await expect(detailsTags.locator('[data-moxtags-section="card-tags"]')).toHaveCount(1);
      await expect(detailsTags.locator('[data-moxtags-section="art-tags"]')).toHaveCount(1);
      await expect(detailsTags.locator('[data-moxtags-trigger="card-tags"]')).toHaveCount(1);
      await expect(detailsTags.locator('[data-moxtags-trigger="art-tags"]')).toHaveCount(1);
      await expect(detailsTags.locator('.moxtags-archidekt-details-tag-link', { hasText: 'card-tag' }))
        .toHaveCount(1, { timeout: 15_000 });
      await expect(detailsTags.locator('.moxtags-archidekt-details-tag-link', { hasText: 'art-tag' }))
        .toHaveCount(1, { timeout: 15_000 });
    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });

  test('appends Archidekt search-result tag queries without duplicate tokens', async () => {
    const { context, close, networkGuard } = await launchGuardedContext();
    const page = await context.newPage();
    const consoleMessages = [];
    page.on('console', msg => consoleMessages.push(msg.text()));

    try {
      await page.goto(ARCHIDEKT_DECK_URL, { waitUntil: 'domcontentloaded' });
      await waitForArchidektReady(consoleMessages);
      await appendArchidektSearchResult(page, 'type:creature art:art-tag');

      await openArchidektMenuFor(page, '[data-testid="archidekt-search-result-img"]', 'deckCardContextMenu_contextMenu__fixture');
      const injection = await expectArchidektMenuInjection(page, 'deckCardContextMenu_contextMenu');

      await injection.locator('[data-moxtags-trigger="art-tags"]').hover();
      await injection.locator('.moxtags-archidekt-tag-link', { hasText: 'art-tag' }).click();
      await expect.poll(async () => page.evaluate(() => window.__lastSyntaxSearch))
        .toBe('type:creature art:art-tag');

      await injection.locator('[data-moxtags-trigger="card-tags"]').hover();
      await injection.locator('.moxtags-archidekt-tag-link', { hasText: 'card-tag' }).click();
      await expect.poll(async () => page.evaluate(() => window.__lastSyntaxSearch))
        .toBe('type:creature art:art-tag otag:card-tag');
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

  test('injects Scryfall search-result tag sections with batch fallback and search links', async () => {
    const { context, close, counters, networkGuard } = await launchGuardedContext();
    const page = await context.newPage();

    try {
      await page.goto(SCRYFALL_SEARCH_URL, { waitUntil: 'domcontentloaded' });

      const sections = page.locator('.card-profile p.card-text-artist + section[data-moxtags-surface="scryfall-card"]');
      await expect(sections).toHaveCount(2, { timeout: 15_000 });
      await expect(sections.nth(0)).toHaveAttribute('data-moxtags-card-key', 'e2e/1');
      await expect(sections.nth(1)).toHaveAttribute('data-moxtags-card-key', 'e2b/2');

      await expect(sections.nth(0).locator('[data-moxtags-section="card-tags"]')).toHaveCount(1);
      await expect(sections.nth(0).locator('[data-moxtags-section="art-tags"]')).toHaveCount(1);
      await expect(sections.nth(0).locator('.moxtags-scryfall-tag-link', { hasText: 'card-tag' }))
        .toHaveCount(1);
      await expect(sections.nth(0).locator('.moxtags-scryfall-tag-link', { hasText: 'art-tag' }))
        .toHaveCount(1);
      await expect(sections.nth(1).locator('.moxtags-scryfall-tag-link', { hasText: 'second-card-tag' }))
        .toHaveCount(1);
      await expect(sections.nth(1).locator('.moxtags-scryfall-tag-link', { hasText: 'second-art-tag' }))
        .toHaveCount(1);

      expect(counters.scryfallCollection).toBe(1);
      expect(counters.scryfallCardFallback).toBe(1);
      await expect(sections.locator('input[type="checkbox"]')).toHaveCount(0);
      await expect(sections.locator('button', { hasText: /search/i })).toHaveCount(0);

      const searchField = page.locator('#header-search-field');
      await sections.nth(0).locator('.moxtags-scryfall-tag-link', { hasText: 'card-tag' }).click();
      await expect(searchField).toHaveValue('otag:card-tag');
      await sections.nth(0).locator('.moxtags-scryfall-tag-link', { hasText: 'art-tag' }).click();
      await expect(searchField).toHaveValue('otag:card-tag art:art-tag');
      await sections.nth(0).locator('.moxtags-scryfall-tag-link', { hasText: 'card-tag' }).click();
      await expect(searchField).toHaveValue('otag:card-tag art:art-tag');

      await expect(sections.nth(0).locator('[data-moxtags-trigger="card-tags"]'))
        .toHaveAttribute('aria-expanded', 'true');
      await sections.nth(0).locator('[data-moxtags-trigger="card-tags"]').click();
      await expect(sections.nth(0).locator('[data-moxtags-section="card-tags"] .moxtags-scryfall-section-body'))
        .toBeHidden();
      await expect(sections.nth(1).locator('[data-moxtags-section="card-tags"] .moxtags-scryfall-section-body'))
        .toBeHidden();
      await expect(sections.nth(1).locator('[data-moxtags-trigger="card-tags"]'))
        .toHaveAttribute('aria-expanded', 'false');
    } finally {
      networkGuard.assertNoEscapes();
      await close();
    }
  });
});
