// Release package smoke tests for local install and AMO source artifacts.
// Run with: npm run test:build

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const PACKAGE_SCRIPT = join(ROOT, 'scripts', 'package-release-assets.js');
const TEMP_ROOT = mkdtempSync(join(tmpdir(), 'moxtags-package-smoke-'));

after(() => {
  rmSync(TEMP_ROOT, { recursive: true, force: true });
});

function requireCommand(command) {
  const result = spawnSync(command, ['-v'], { stdio: 'ignore' });
  assert.equal(result.status, 0, `${command} is required for release package smoke tests`);
}

function packageAsset(...args) {
  execFileSync(process.execPath, [PACKAGE_SCRIPT, ...args], {
    cwd: ROOT,
    stdio: 'pipe',
  });
}

function archiveEntries(archive) {
  return execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
}

function readArchiveJson(archive, path) {
  return JSON.parse(execFileSync('unzip', ['-p', archive, path], { encoding: 'utf8' }));
}

function assertIncludes(entries, required) {
  for (const entry of required) {
    assert.ok(entries.includes(entry), `archive should include ${entry}`);
  }
}

function assertExcludes(entries, forbiddenPatterns) {
  for (const entry of entries) {
    for (const pattern of forbiddenPatterns) {
      assert.ok(!pattern.test(entry), `archive should not include ${entry}`);
    }
  }
}

function copyDistWithMetadata(browser) {
  const source = join(TEMP_ROOT, `${browser}-dist`);
  cpSync(join(DIST, browser), source, { recursive: true });
  writeFileSync(join(source, '.DS_Store'), 'finder metadata');
  mkdirSync(join(source, '__MACOSX'), { recursive: true });
  writeFileSync(join(source, '__MACOSX', 'ignored'), 'resource fork metadata');
  return source;
}

function installPackageForbiddenPatterns() {
  return [
    /^tests\//,
    /^src\//,
    /^manifests\//,
    /^node_modules\//,
    /^dist\//,
    /^\.github\//,
    /^\.agents\//,
    /^research\//,
    /^playwright-report\//,
    /^test-results\//,
    /^__MACOSX\//,
    /(^|\/)\./,
    /^build\.js$/,
    /^release\.sh$/,
    /^package(?:-lock)?\.json$/,
    /^README\.md$/,
    /^LICENSE$/,
    /^PRIVACY\.md$/,
    /\.test\.js$/,
  ];
}

describe('release package smoke artifacts', () => {
  it('packages the Chrome local-install zip with required extension files only', () => {
    requireCommand('zip');
    requireCommand('unzip');

    const chromeDist = copyDistWithMetadata('chrome');
    const archive = join(TEMP_ROOT, 'moxtags-chrome-vtest.zip');
    packageAsset('chrome', '--source-dir', chromeDist, '--out', archive);

    assert.ok(existsSync(archive), 'Chrome local-install zip should be created');
    const entries = archiveEntries(archive);
    assertIncludes(entries, [
      'manifest.json',
      'background.js',
      'content.js',
      'page_hook.js',
      'scryfall_content.js',
      'archidekt_content.js',
      'popup.html',
      'popup.js',
      'styles.css',
      'icons/moxtags-gem-16.png',
      'icons/moxtags-gem-32.png',
      'icons/moxtags-gem-48.png',
      'icons/moxtags-gem-128.png',
      'data/oracle-tags.js',
      'data/illustration-tags-1.js',
      'data/illustration-tags-2.js',
      'data/card-map-ids.json',
      'data/card-map-sets.json',
    ]);
    assertExcludes(entries, installPackageForbiddenPatterns());

    const manifest = readArchiveJson(archive, 'manifest.json');
    assert.deepEqual(manifest.background, { service_worker: 'background.js' });
  });

  it('defaults the Chrome package name to the manifest version', () => {
    requireCommand('zip');

    const archiveName = `moxtags-chrome-v${JSON.parse(readFileSync(join(ROOT, 'manifests/base.json'), 'utf8')).version}.zip`;
    const archive = join(ROOT, archiveName);
    rmSync(archive, { force: true });

    try {
      packageAsset('chrome');
      assert.ok(existsSync(archive), 'Chrome package should default to a versioned zip name');
    } finally {
      rmSync(archive, { force: true });
    }
  });

  it('packages the Firefox local-install XPI shape with the local version suffix', () => {
    requireCommand('zip');
    requireCommand('unzip');

    const firefoxDist = copyDistWithMetadata('firefox');
    const baseManifest = JSON.parse(readFileSync(join(firefoxDist, 'manifest.json'), 'utf8'));
    const localVersion = `${baseManifest.version}.1`;
    const archive = join(TEMP_ROOT, 'moxtags-firefox-vtest.1.xpi');
    packageAsset('firefox-xpi', '--source-dir', firefoxDist, '--version', localVersion, '--out', archive);

    assert.ok(existsSync(archive), 'Firefox local-install XPI smoke artifact should be created');
    const entries = archiveEntries(archive);
    assertIncludes(entries, [
      'manifest.json',
      'background.js',
      'content.js',
      'page_hook.js',
      'scryfall_content.js',
      'archidekt_content.js',
      'popup.html',
      'popup.js',
      'styles.css',
      'icons/moxtags-gem-16.png',
      'icons/moxtags-gem-32.png',
      'icons/moxtags-gem-48.png',
      'icons/moxtags-gem-128.png',
      'data/oracle-tags.js',
      'data/illustration-tags-1.js',
      'data/illustration-tags-2.js',
      'data/card-map-ids.json',
      'data/card-map-sets.json',
    ]);
    assertExcludes(entries, installPackageForbiddenPatterns());

    const manifest = readArchiveJson(archive, 'manifest.json');
    assert.equal(manifest.version, localVersion);
    assert.ok(manifest.background?.scripts?.includes('background.js'));
    assert.ok(manifest.background.scripts.includes('data/oracle-tags.js'));
    assert.equal(manifest.browser_specific_settings?.gecko?.id, 'moxtags@natefinch.com');
  });

  it('packages the AMO source archive with rebuild inputs and without test artifacts', () => {
    requireCommand('zip');
    requireCommand('unzip');

    const tag = 'vpackage-smoke';
    const archive = join(TEMP_ROOT, 'moxtags-source-vpackage-smoke.zip');
    packageAsset('source', '--tag', tag, '--out', archive);

    assert.ok(existsSync(archive), 'AMO source package should be created');
    const entries = archiveEntries(archive);
    const prefix = `moxtags-source-${tag}/`;
    assertIncludes(entries, [
      `${prefix}AMO_BUILD.md`,
      `${prefix}build.js`,
      `${prefix}package.json`,
      `${prefix}package-lock.json`,
      `${prefix}manifests/base.json`,
      `${prefix}manifests/chrome.json`,
      `${prefix}manifests/firefox.json`,
      `${prefix}src/background.js`,
      `${prefix}src/page_hook.js`,
      `${prefix}src/data/oracle-tags.js`,
      `${prefix}icons/moxtags-gem-128.png`,
      `${prefix}README.md`,
      `${prefix}LICENSE`,
      `${prefix}PRIVACY.md`,
    ]);
    assertExcludes(entries, [
      new RegExp(`^${prefix}tests/`),
      new RegExp(`^${prefix}dist/`),
      new RegExp(`^${prefix}node_modules/`),
      new RegExp(`^${prefix}\\.github/`),
      new RegExp(`^${prefix}\\.agents/`),
      new RegExp(`^${prefix}research/`),
      new RegExp(`^${prefix}playwright-report/`),
      new RegExp(`^${prefix}test-results/`),
      new RegExp(`^${prefix}web-ext-artifacts`),
      /^__MACOSX\//,
      /(^|\/)\.DS_Store$/,
      /\.zip$/,
      /\.xpi$/,
      /\.test\.js$/,
    ]);

    const instructions = execFileSync('unzip', ['-p', archive, `${prefix}AMO_BUILD.md`], { encoding: 'utf8' });
    assert.ok(instructions.includes(`MoxTags ${tag}`));
    assert.ok(instructions.includes('node build.js firefox'));
    assert.ok(instructions.includes('src/data/'));
  });
});
