#!/usr/bin/env node
// Shared release packaging helpers used by release.sh and smoke tests.

import { spawnSync } from 'node:child_process';
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
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const ZIP_EXCLUDES = ['__MACOSX/*', '*/.*', '.*'];
const SOURCE_ENTRIES = [
  'build.js',
  'package.json',
  'package-lock.json',
  'manifests',
  'src',
  'icons',
  'README.md',
  'LICENSE',
  'PRIVACY.md',
];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = rest[i + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    i += 1;
  }
  return options;
}

function requireOption(options, name) {
  if (!options[name]) throw new Error(`Missing required option --${name}`);
  return options[name];
}

function readReleaseVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'manifests', 'base.json'), 'utf8')).version;
}

function ensureZipAvailable() {
  const result = spawnSync('zip', ['-v'], { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    throw new Error('zip is required to package release assets');
  }
}

function zipDirectory({ cwd, entry, out }) {
  ensureZipAvailable();
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });

  const result = spawnSync(
    'zip',
    ['-r', '-X', out, entry, '-x', ...ZIP_EXCLUDES],
    {
      cwd,
      env: { ...process.env, COPYFILE_DISABLE: '1' },
      encoding: 'utf8',
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`zip failed for ${out}:\n${result.stdout}\n${result.stderr}`);
  }
}

function createChromePackage({ sourceDir = join(ROOT, 'dist', 'chrome'), out }) {
  assertDirectory(sourceDir);
  zipDirectory({ cwd: sourceDir, entry: '.', out });
}

function prepareFirefoxLocalDir({ sourceDir = join(ROOT, 'dist', 'firefox'), outDir, version }) {
  assertDirectory(sourceDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(dirname(outDir), { recursive: true });
  cpSync(sourceDir, outDir, { recursive: true });
  setFirefoxDistVersion(join(outDir, 'manifest.json'), version);
}

function createFirefoxXpi({ sourceDir = join(ROOT, 'dist', 'firefox'), out, version }) {
  const tmp = mkdtempSync(join(tmpdir(), 'moxtags-firefox-package-'));
  try {
    const prepared = join(tmp, 'firefox');
    prepareFirefoxLocalDir({ sourceDir, outDir: prepared, version });
    zipDirectory({ cwd: prepared, entry: '.', out });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function setFirefoxDistVersion(manifestPath, version) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

function createSourcePackage({ root = ROOT, tag, out }) {
  const tmp = mkdtempSync(join(tmpdir(), 'moxtags-source-package-'));
  try {
    const sourceName = `moxtags-source-${tag}`;
    const sourceDir = join(tmp, sourceName);
    mkdirSync(sourceDir, { recursive: true });

    for (const entry of SOURCE_ENTRIES) {
      const from = join(root, entry);
      if (!existsSync(from)) {
        throw new Error(`Required source package entry is missing: ${entry}`);
      }
      cpSync(from, join(sourceDir, entry), { recursive: true });
    }

    writeFileSync(join(sourceDir, 'AMO_BUILD.md'), amoBuildInstructions(tag));
    zipDirectory({ cwd: tmp, entry: sourceName, out });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function amoBuildInstructions(tag) {
  return `# AMO reviewer build instructions for MoxTags ${tag}

The submitted Firefox extension is generated from this source archive with
esbuild. The release build does not minify code.

## Environment

- Node.js 24.x and npm 11.x are compatible with Mozilla's default reviewer environment.
- The checked-in package-lock.json must be used.

## Build

\`\`\`bash
npm ci
node build.js firefox
\`\`\`

The build output is written to \`dist/firefox/\`. Compare that directory with
the submitted Firefox extension package.

Do not run \`node scripts/fetch-tags.js\` for review reproduction; this source
archive already includes the \`src/data/\` tag index files used for the release.
`;
}

function assertDirectory(path) {
  if (!existsSync(path)) throw new Error(`Directory does not exist: ${path}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  switch (options.command) {
    case 'chrome':
      createChromePackage({
        sourceDir: options['source-dir'] ? resolve(options['source-dir']) : undefined,
        out: resolve(options.out ?? `moxtags-chrome-v${readReleaseVersion()}.zip`),
      });
      break;
    case 'firefox-dir':
      prepareFirefoxLocalDir({
        sourceDir: options['source-dir'] ? resolve(options['source-dir']) : undefined,
        outDir: resolve(requireOption(options, 'out-dir')),
        version: requireOption(options, 'version'),
      });
      break;
    case 'firefox-xpi':
      createFirefoxXpi({
        sourceDir: options['source-dir'] ? resolve(options['source-dir']) : undefined,
        out: resolve(requireOption(options, 'out')),
        version: requireOption(options, 'version'),
      });
      break;
    case 'source':
      createSourcePackage({
        root: options.root ? resolve(options.root) : undefined,
        tag: requireOption(options, 'tag'),
        out: resolve(requireOption(options, 'out')),
      });
      break;
    default:
      throw new Error(
        'Usage: package-release-assets.js <chrome|firefox-dir|firefox-xpi|source> [options]\n' +
          '  chrome [--source-dir dist/chrome] [--out moxtags-chrome-vX.Y.Z.zip]',
      );
  }
}

await main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
