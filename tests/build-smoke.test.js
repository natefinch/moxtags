// Build/package smoke tests for the generated browser extension artifacts.
// Run with: npm run test:build

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function distPath(browser, ...parts) {
  return join(DIST, browser, ...parts);
}

function assertFileExists(path, message = `${path} should exist`) {
  assert.ok(existsSync(path), message);
  assert.ok(statSync(path).isFile(), `${path} should be a file`);
}

function assertDirExists(path, message = `${path} should exist`) {
  assert.ok(existsSync(path), message);
  assert.ok(statSync(path).isDirectory(), `${path} should be a directory`);
}

function assertManifestReferencedFilesExist(browser, manifest) {
  for (const iconPath of Object.values(manifest.icons || {})) {
    assertFileExists(distPath(browser, iconPath), `${browser} icon ${iconPath} should exist`);
  }

  if (manifest.action?.default_popup) {
    assertFileExists(
      distPath(browser, manifest.action.default_popup),
      `${browser} popup should exist`,
    );
  }

  for (const script of manifest.background?.scripts || []) {
    assertFileExists(distPath(browser, script), `${browser} background script ${script} should exist`);
  }

  if (manifest.background?.service_worker) {
    assertFileExists(
      distPath(browser, manifest.background.service_worker),
      `${browser} service worker should exist`,
    );
  }

  for (const contentScript of manifest.content_scripts || []) {
    for (const js of contentScript.js || []) {
      assertFileExists(distPath(browser, js), `${browser} content script ${js} should exist`);
    }
    for (const css of contentScript.css || []) {
      assertFileExists(distPath(browser, css), `${browser} stylesheet ${css} should exist`);
    }
  }
}

function findContentScript(manifest, jsFile) {
  return manifest.content_scripts.find(script => script.js?.includes(jsFile));
}

describe('built extension artifacts', () => {
  for (const browser of ['chrome', 'firefox']) {
    it(`builds ${browser} manifest and referenced files`, () => {
      const manifestPath = distPath(browser, 'manifest.json');
      assertFileExists(manifestPath);

      const manifest = readJson(manifestPath);
      assert.equal(manifest.manifest_version, 3);
      assert.equal(manifest.name, 'MoxTags');
      assert.equal(typeof manifest.version, 'string');
      assertManifestReferencedFilesExist(browser, manifest);

      assertFileExists(distPath(browser, 'popup.js'));
      assertFileExists(distPath(browser, 'popup.html'));
      assertFileExists(distPath(browser, 'styles.css'));
      assertDirExists(distPath(browser, 'icons'));
    });
  }

  it('builds Chrome with an MV3 service worker background', () => {
    const manifest = readJson(distPath('chrome', 'manifest.json'));

    assert.deepEqual(manifest.background, { service_worker: 'background.js' });
    assertFileExists(distPath('chrome', 'background.js'));
  });

  it('builds Firefox with background scripts and Gecko ID', () => {
    const manifest = readJson(distPath('firefox', 'manifest.json'));

    assert.ok(manifest.background?.scripts?.includes('background.js'));
    assert.ok(manifest.background.scripts.includes('data/oracle-tags.js'));
    assert.ok(manifest.background.scripts.includes('data/illustration-tags-1.js'));
    assert.ok(manifest.background.scripts.includes('data/illustration-tags-2.js'));
    assert.equal(manifest.browser_specific_settings?.gecko?.id, 'moxtags@natefinch.com');
    assertFileExists(distPath('firefox', 'background.js'));
  });

  it('injects page_hook.js in the MAIN world at document_start on Moxfield', () => {
    for (const browser of ['chrome', 'firefox']) {
      const manifest = readJson(distPath(browser, 'manifest.json'));
      const pageHook = findContentScript(manifest, 'page_hook.js');

      assert.ok(pageHook, `${browser} should include page_hook.js`);
      assert.ok(pageHook.matches.includes('https://www.moxfield.com/decks/*'));
      assert.ok(pageHook.matches.includes('https://www.moxfield.com/search/*'));
      assert.ok(pageHook.matches.includes('https://www.moxfield.com/cards/*'));
      assert.equal(pageHook.run_at, 'document_start');
      assert.equal(pageHook.world, 'MAIN');
    }
  });

  it('injects Moxfield content.js and styles at document_idle', () => {
    for (const browser of ['chrome', 'firefox']) {
      const manifest = readJson(distPath(browser, 'manifest.json'));
      const moxfieldContent = findContentScript(manifest, 'content.js');

      assert.ok(moxfieldContent, `${browser} should include content.js`);
      assert.ok(moxfieldContent.matches.includes('https://www.moxfield.com/decks/*'));
      assert.ok(moxfieldContent.matches.includes('https://www.moxfield.com/search/*'));
      assert.ok(moxfieldContent.matches.includes('https://www.moxfield.com/cards/*'));
      assert.deepEqual(moxfieldContent.css, ['styles.css']);
      assert.equal(moxfieldContent.run_at, 'document_idle');
    }
  });

  it('keeps Scryfall and Archidekt content script matches', () => {
    for (const browser of ['chrome', 'firefox']) {
      const manifest = readJson(distPath(browser, 'manifest.json'));
      const scryfall = findContentScript(manifest, 'scryfall_content.js');
      assert.ok(scryfall, `${browser} should include scryfall_content.js`);
      assert.ok(scryfall, `${browser} should include scryfall_content.js`);
      assert.ok(scryfall.matches.includes('https://scryfall.com/*'));
      assert.ok(scryfall.matches.includes('https://www.scryfall.com/*'));
      assert.deepEqual(scryfall.css, ['styles.css']);

      const archidekt = findContentScript(manifest, 'archidekt_content.js');
      assert.ok(archidekt, `${browser} should include archidekt_content.js`);
      assert.ok(archidekt.matches.includes('https://archidekt.com/*'));
      assert.ok(archidekt.matches.includes('https://www.archidekt.com/*'));
      assert.deepEqual(archidekt.css, ['styles.css']);
    }
  });

  it('replaces page_hook.js version placeholder during build', () => {
    for (const browser of ['chrome', 'firefox']) {
      const manifest = readJson(distPath(browser, 'manifest.json'));
      const pageHook = readFileSync(distPath(browser, 'page_hook.js'), 'utf8');

      assert.ok(!pageHook.includes('__MOXTAGS_VERSION__'));
      assert.ok(pageHook.includes(manifest.version));
    }
  });
});
