#!/usr/bin/env node
// Builds a compact card map from a Scryfall bulk data JSON file.
// Extracts set, collector_number, oracle_id, and illustration_id,
// deduplicates IDs, and writes a compact JSON file for bundling.
//
// Usage: node scripts/build-card-map.js <bulk-data.json>

import { createReadStream, writeFileSync, mkdirSync } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DATA_DIR = join(ROOT, 'src', 'data');

// Extract a JSON string value by key using indexOf (avoids regex on huge lines).
function extractField(line, key) {
  const needle = `"${key}":"`;
  const start = line.indexOf(needle);
  if (start === -1) return null;
  const valStart = start + needle.length;
  const valEnd = line.indexOf('"', valStart);
  if (valEnd === -1) return null;
  return line.substring(valStart, valEnd);
}

async function main() {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.error('Usage: node scripts/build-card-map.js <bulk-data.json>');
    process.exit(1);
  }

  console.log(`Reading ${inputFile}…`);

  // Collect unique (set, cn) → { oracle_id, illustration_id }.
  // Using a plain object to reduce Map overhead.
  const cards = Object.create(null); // "set/cn" → [oracle, illus]
  const rl = createInterface({
    input: createReadStream(inputFile),
    crlfDelay: Infinity,
  });
  let lineCount = 0;

  for await (const line of rl) {
    const set = extractField(line, 'set');
    const cn = extractField(line, 'collector_number');
    const oracle = extractField(line, 'oracle_id');
    if (!set || !cn || !oracle) continue;

    const key = `${set}/${cn}`;
    if (!(key in cards)) {
      const illus = extractField(line, 'illustration_id');
      cards[key] = [set, cn, oracle, illus];
    }
    lineCount++;
    if (lineCount % 100000 === 0) {
      console.log(`  …processed ${lineCount} cards`);
    }
  }

  const uniqueCount = Object.keys(cards).length;
  console.log(`Parsed ${lineCount} cards, ${uniqueCount} unique (set, cn) pairs`);

  // Build deduplicated, sorted arrays of unique IDs.
  const oracleSet = new Set();
  const illusSet = new Set();
  for (const key in cards) {
    const [, , oracle, illus] = cards[key];
    oracleSet.add(oracle);
    if (illus) illusSet.add(illus);
  }

  const oracleArr = [...oracleSet].sort();
  const illusArr = [...illusSet].sort();
  const oracleIdx = new Map(oracleArr.map((id, i) => [id, i]));
  const illusIdx = new Map(illusArr.map((id, i) => [id, i]));

  console.log(`Unique oracle_ids: ${oracleArr.length}`);
  console.log(`Unique illustration_ids: ${illusArr.length}`);

  // Build the set-grouped mapping: set → { cn: [oracle_index, illus_index] }
  const sets = Object.create(null);
  for (const key in cards) {
    const [set, cn, oracle, illus] = cards[key];
    if (!sets[set]) sets[set] = Object.create(null);
    const oi = oracleIdx.get(oracle);
    const ii = illus != null ? illusIdx.get(illus) : -1;
    sets[set][cn] = [oi, ii];
  }

  // Free intermediate data.
  for (const key in cards) delete cards[key];

  // Split into two files to stay under Firefox's 5 MB per-file limit.
  const idsData = { o: oracleArr, i: illusArr };
  const setsData = { s: sets };
  const idsJson = JSON.stringify(idsData);
  const setsJson = JSON.stringify(setsData);
  const idsMB = idsJson.length / 1024 / 1024;
  const setsMB = setsJson.length / 1024 / 1024;

  console.log(`IDs file: ${idsMB.toFixed(1)} MB`);
  console.log(`Sets file: ${setsMB.toFixed(1)} MB`);

  mkdirSync(DATA_DIR, { recursive: true });

  const idsPath = join(DATA_DIR, 'card-map-ids.json');
  writeFileSync(idsPath, idsJson + '\n');
  console.log(`✔ Wrote ${idsPath} (${idsMB.toFixed(1)} MB)`);

  const setsPath = join(DATA_DIR, 'card-map-sets.json');
  writeFileSync(setsPath, setsJson + '\n');
  console.log(`✔ Wrote ${setsPath} (${setsMB.toFixed(1)} MB)`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
