#!/usr/bin/env node
// MoxTags build script — bundles src/ into dist/chrome/ and dist/firefox/.

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const BROWSERS = ['chrome', 'firefox'];
const ROOT = import.meta.dirname;

// Entry points bundled by esbuild (IIFE, no module runtime needed).
const BUNDLE_ENTRIES = ['background.js', 'content.js', 'scryfall_content.js', 'archidekt_content.js'];

// Files copied as-is (no bundling).
const COPY_FILES = ['page_hook.js', 'popup.js', 'popup.html', 'styles.css'];

function mergeManifests(browser) {
  const base = JSON.parse(readFileSync(join(ROOT, 'manifests', 'base.json'), 'utf-8'));
  const override = JSON.parse(readFileSync(join(ROOT, 'manifests', `${browser}.json`), 'utf-8'));
  return { ...base, ...override };
}

async function buildBrowser(browser) {
  const dist = join(ROOT, 'dist', browser);

  // Clean and create dist dir.
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  // Bundle entry points.
  for (const entry of BUNDLE_ENTRIES) {
    await esbuild.build({
      entryPoints: [join(ROOT, 'src', entry)],
      bundle: true,
      format: 'iife',
      outfile: join(dist, entry),
      target: 'es2020',
      minify: false,
      sourcemap: false,
    });
  }

  // Copy non-bundled files.
  const manifest = mergeManifests(browser);
  for (const file of COPY_FILES) {
    if (file === 'page_hook.js') {
      // Inject the version number into the placeholder.
      let src = readFileSync(join(ROOT, 'src', file), 'utf-8');
      src = src.replace('__MOXTAGS_VERSION__', manifest.version);
      writeFileSync(join(dist, file), src);
    } else {
      cpSync(join(ROOT, 'src', file), join(dist, file));
    }
  }

  // Copy icons.
  cpSync(join(ROOT, 'icons'), join(dist, 'icons'), { recursive: true });

  // Copy bundled tag data (if present).
  const dataDir = join(ROOT, 'src', 'data');
  if (existsSync(dataDir)) {
    cpSync(dataDir, join(dist, 'data'), { recursive: true });
  }

  // Merge and write manifest (already done above for version injection).
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`✔ Built ${browser} → dist/${browser}/`);
}

async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const targets = args.length > 0 ? args : BROWSERS;

  for (const browser of targets) {
    if (!BROWSERS.includes(browser)) {
      console.error(`Unknown browser: ${browser}. Use: ${BROWSERS.join(', ')}`);
      process.exit(1);
    }
    await buildBrowser(browser);
  }
}

await main().catch(err => {
  console.error(err);
  process.exit(1);
});

// ─── Watch mode ─────────────────────────────────────────────────────
if (process.argv.includes('--watch')) {
  const { watch } = await import('fs');
  const dirs = [join(ROOT, 'src'), join(ROOT, 'manifests'), join(ROOT, 'icons')];
  let timer = null;

  function rebuild() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        for (const browser of BROWSERS) await buildBrowser(browser);
      } catch (e) {
        console.error('Build error:', e.message);
      }
    }, 100);
  }

  for (const dir of dirs) {
    watch(dir, { recursive: true }, rebuild);
  }
  console.log('\n👀 Watching for changes… (Ctrl+C to stop)');
}
