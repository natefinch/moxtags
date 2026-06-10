// Firefox browser-flow E2E smoke tests.
//
// This test loads the built Firefox extension through geckodriver/Selenium and
// serves deterministic local Scryfall fixtures. The temporary test extension
// keeps production code intact but adds localhost match/host permissions and
// points background Scryfall API calls at the local fixture server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { start as startGeckodriver } from 'geckodriver';

const ROOT = new URL('../..', import.meta.url).pathname;
const FIREFOX_DIST = join(ROOT, 'dist', 'firefox');
const ORACLE_ID = 'firefox-oracle-e2e';
const ILLUSTRATION_ID = 'firefox-illustration-e2e';

const firefoxBinary = findFirefoxBinary();

test('Firefox WebDriver loads the extension and injects Scryfall card tags', {
  skip: firefoxBinary ? false : 'Firefox binary not found',
}, async () => {
  assert.ok(existsSync(join(FIREFOX_DIST, 'manifest.json')), 'dist/firefox must be built before running Firefox E2E');

  let fixture;
  let extensionDir;
  let geckodriver;
  let driver;

  try {
    fixture = await startFixtureServer();
    extensionDir = prepareFirefoxTestExtension(fixture.origin);
    geckodriver = await startDriverServer();

    const options = new firefox.Options()
      .setBinary(firefoxBinary)
      .addArguments('-headless')
      .setPreference('xpinstall.signatures.required', false)
      .setPreference('extensions.install.requireBuiltInCerts', false);

    driver = await new Builder()
      .forBrowser('firefox')
      .setFirefoxOptions(options)
      .usingServer(geckodriver.url)
      .build();

    await driver.installAddon(extensionDir, true);
    await driver.get(`${fixture.origin}/card/e2e/1/firefox-e2e-card`);

    const section = await driver.wait(
      until.elementLocated(By.css('p.card-text-artist + section[data-moxtags-surface="scryfall-card"]')),
      15_000
    );
    assert.equal(await section.getAttribute('data-moxtags-card-key'), 'e2e/1');

    await driver.wait(
      until.elementLocated(By.xpath('//section[@data-moxtags-card-key="e2e/1"]//a[normalize-space()="firefox-card-tag"]')),
      15_000
    );
    await driver.wait(
      until.elementLocated(By.xpath('//section[@data-moxtags-card-key="e2e/1"]//a[normalize-space()="firefox-art-tag"]')),
      15_000
    );

    await driver
      .findElement(By.xpath('//section[@data-moxtags-card-key="e2e/1"]//a[normalize-space()="firefox-card-tag"]'))
      .click();
    const searchField = await driver.findElement(By.css('#header-search-field'));
    await driver.wait(async () =>
      (await searchField.getAttribute('value')) === 'otag:firefox-card-tag'
    , 5_000);

    assert.deepEqual(fixture.apiRequests.sort(), [
      '/api.scryfall.com/cards/e2e/1',
      '/api.scryfall.com/bulk-data/art_tags',
      '/api.scryfall.com/bulk-data/oracle_tags',
      '/api.scryfall.com/download/art_tags',
      '/api.scryfall.com/download/oracle_tags',
    ].sort());
  } finally {
    if (driver) await driver.quit();
    geckodriver?.process.kill();
    if (fixture) await fixture.close();
    if (extensionDir) rmSync(extensionDir, { recursive: true, force: true });
  }
});

function findFirefoxBinary() {
  if (process.env.FIREFOX_BIN) return process.env.FIREFOX_BIN;

  const candidates = [
    'firefox',
    '/Applications/Firefox.app/Contents/MacOS/firefox',
  ];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (result.status === 0) return candidate;
  }
  return null;
}

async function startFixtureServer() {
  const apiRequests = [];
  const server = createServer((req, res) => {
    const path = req.url || '/';
    if (path === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    if (path.startsWith('/card/e2e/1/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(scryfallCardHtml());
      return;
    }
    if (path.startsWith('/api.scryfall.com/')) {
      apiRequests.push(path);
      serveScryfallApi(path, res, `http://${req.headers.host}`);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`No fixture for ${path}`);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    apiRequests,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function scryfallCardHtml() {
  return `<!doctype html>
    <html>
      <head><title>Firefox Scryfall Fixture</title></head>
      <body>
        <header>
          <form action="/search">
            <input id="header-search-field" name="q" type="search" value="">
          </form>
        </header>
        <main>
          <article class="card-profile">
            <p class="card-text-artist">Illustrated by Firefox E2E Artist</p>
          </article>
        </main>
      </body>
    </html>`;
}

function serveScryfallApi(path, res, origin) {
  if (path === '/api.scryfall.com/cards/e2e/1') {
    sendJson(res, {
      oracle_id: ORACLE_ID,
      illustration_id: ILLUSTRATION_ID,
    });
    return;
  }
  if (path === '/api.scryfall.com/bulk-data/oracle_tags') {
    sendJson(res, {
      download_uri: `${origin}/api.scryfall.com/download/oracle_tags`,
    });
    return;
  }
  if (path === '/api.scryfall.com/bulk-data/art_tags') {
    sendJson(res, {
      download_uri: `${origin}/api.scryfall.com/download/art_tags`,
    });
    return;
  }
  if (path === '/api.scryfall.com/download/oracle_tags') {
    sendJson(res, [
      { label: 'firefox-card-tag', slug: 'firefox-card-tag', taggings: [{ oracle_id: ORACLE_ID }] },
    ]);
    return;
  }
  if (path === '/api.scryfall.com/download/art_tags') {
    sendJson(res, [
      { label: 'firefox-art-tag', slug: 'firefox-art-tag', taggings: [{ illustration_id: ILLUSTRATION_ID }] },
    ]);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(`No API fixture for ${path}`);
}

function sendJson(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function prepareFirefoxTestExtension(apiOrigin) {
  const extensionDir = mkdtempSync(join(tmpdir(), 'moxtags-firefox-e2e-extension-'));
  cpSync(FIREFOX_DIST, extensionDir, { recursive: true });

  const manifestPath = join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const contentScript of manifest.content_scripts || []) {
    if (contentScript.js?.includes('scryfall_content.js')) {
      contentScript.matches = [...new Set([
        ...contentScript.matches,
        'http://127.0.0.1/*',
      ])];
    }
  }
  manifest.host_permissions = [...new Set([
    ...(manifest.host_permissions || []),
    'http://127.0.0.1/*',
  ])];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const backgroundPath = join(extensionDir, 'background.js');
  const background = readFileSync(backgroundPath, 'utf8');
  const patched = background.replaceAll('https://api.scryfall.com', `${apiOrigin}/api.scryfall.com`);
  assert.notEqual(patched, background, 'test extension should redirect Scryfall API calls to fixture server');
  writeFileSync(backgroundPath, patched);

  return extensionDir;
}

async function startDriverServer() {
  const port = await findFreePort();
  const cp = await startGeckodriver({ port, host: '127.0.0.1', binary: firefoxBinary });
  const url = `http://127.0.0.1:${port}`;
  await waitForWebDriver(url);
  return { process: cp, url };
}

async function findFreePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForWebDriver(url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/status`);
      if (response.ok) return;
    } catch {
      // geckodriver is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for geckodriver at ${url}`);
}
