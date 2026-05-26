#!/usr/bin/env node
// Fetches Scryfall tag data and writes compact indexed JS files
// to src/data/ for bundling into the extension.
//
// Run before releases: node scripts/fetch-tags.js

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { buildReverseIndex, buildCompactIndex, splitCompactIndex } from '../src/scryfall/tags.js';
import { ORACLE_TAGS_URL, ILLUSTRATION_TAGS_URL } from '../src/scryfall/constants.js';

const ROOT = join(import.meta.dirname, '..');
const DATA_DIR = join(ROOT, 'src', 'data');

function writeJsData(path, globalName, data) {
  const json = JSON.stringify(data);
  writeFileSync(path, `self.${globalName}=${json};\n`);
  return json.length;
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  console.log('Fetching oracle tags…');
  const oracleResp = await fetch(ORACLE_TAGS_URL, { credentials: 'omit' });
  if (!oracleResp.ok) throw new Error(`Oracle fetch failed: HTTP ${oracleResp.status}`);
  const oracleData = await oracleResp.json();

  console.log('Fetching illustration tags…');
  const illusResp = await fetch(ILLUSTRATION_TAGS_URL, { credentials: 'omit' });
  if (!illusResp.ok) throw new Error(`Illustration fetch failed: HTTP ${illusResp.status}`);
  const illusData = await illusResp.json();

  // Build reverse indexes using the same logic as background.js.
  const oracleIndex = buildReverseIndex(oracleData.data, 'oracle_ids');
  const illusIndex = buildReverseIndex(illusData.data, 'illustration_ids');

  console.log(`Oracle: ${oracleData.data.length} tags, ${oracleIndex.size} unique IDs`);
  console.log(`Illustration: ${illusData.data.length} tags, ${illusIndex.size} unique IDs`);

  // Convert to compact indexed format.
  const oracleCompact = buildCompactIndex(oracleIndex);
  const illusCompact = buildCompactIndex(illusIndex);

  // Split illustration index into two files to stay under Firefox's 5 MB
  // per-file validation limit.
  const [illusPart1, illusPart2] = splitCompactIndex(illusCompact, 2);

  // Write as JS files that set self.* globals (loaded via importScripts).
  const oraclePath = join(DATA_DIR, 'oracle-tags.js');
  const illusPath1 = join(DATA_DIR, 'illustration-tags-1.js');
  const illusPath2 = join(DATA_DIR, 'illustration-tags-2.js');

  const oracleSize = writeJsData(oraclePath, '__MOXTAGS_ORACLE', oracleCompact);
  const illusSize1 = writeJsData(illusPath1, '__MOXTAGS_ILLUS_1', illusPart1);
  const illusSize2 = writeJsData(illusPath2, '__MOXTAGS_ILLUS_2', illusPart2);

  console.log(`\n✔ Wrote ${oraclePath} (${(oracleSize / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`✔ Wrote ${illusPath1} (${(illusSize1 / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`✔ Wrote ${illusPath2} (${(illusSize2 / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
