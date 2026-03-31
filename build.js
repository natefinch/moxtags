#!/usr/bin/env node
// MoxTags build script — bundles src/ into dist/chrome/ and dist/firefox/.

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join } from 'path';

const BROWSERS = ['chrome', 'firefox'];
const ROOT = import.meta.dirname;

// Entry points bundled by esbuild (IIFE, no module runtime needed).
const BUNDLE_ENTRIES = ['background.js', 'content.js'];

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
  for (const file of COPY_FILES) {
    cpSync(join(ROOT, 'src', file), join(dist, file));
  }

  // Copy icons.
  cpSync(join(ROOT, 'icons'), join(dist, 'icons'), { recursive: true });

  // Merge and write manifest.
  const manifest = mergeManifests(browser);
  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`✔ Built ${browser} → dist/${browser}/`);
}

async function main() {
  const targets = process.argv[2]
    ? [process.argv[2]]
    : BROWSERS;

  for (const browser of targets) {
    if (!BROWSERS.includes(browser)) {
      console.error(`Unknown browser: ${browser}. Use: ${BROWSERS.join(', ')}`);
      process.exit(1);
    }
    await buildBrowser(browser);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
