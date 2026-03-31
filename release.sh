#!/usr/bin/env bash
set -euo pipefail

# MoxTags Release Script
# Creates a git tag, builds the extension for Chrome and Firefox,
# packages both into zips, and uploads them to GitHub as a draft release.
#
# By default, increments the minor version (e.g. v1.4.2 → v1.5.0).
# Use --patch to increment only the patch version (e.g. v1.4.2 → v1.4.3).
# Use --dryrun to preview what would happen without making any changes.
#
# Usage:
#   ./release.sh                   # bump minor version
#   ./release.sh --patch           # bump patch version
#   ./release.sh --dryrun          # preview minor bump
#   ./release.sh --patch --dryrun  # preview patch bump

# --- Argument parsing ---

BUMP="minor"
DRYRUN=false
for arg in "$@"; do
  case "$arg" in
    --patch)  BUMP="patch" ;;
    --dryrun) DRYRUN=true ;;
    *)
      echo "Usage: $0 [--patch] [--dryrun]"
      echo "  Unknown argument: $arg"
      exit 1
      ;;
  esac
done

# Read current version from manifests/base.json
CURRENT=$(node -e "import{readFileSync as r}from'fs';console.log(JSON.parse(r('manifests/base.json','utf8')).version)")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

if [[ "$BUMP" == "patch" ]]; then
  VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
else
  VERSION="${MAJOR}.$((MINOR + 1)).0"
fi

TAG="v${VERSION}"

echo "Current version: $CURRENT → releasing $TAG ($BUMP bump)"

if $DRYRUN; then
  echo ""
  echo "[dry run] Would create tag: $TAG"
  echo "[dry run] Would build Chrome and Firefox extensions"
  echo "[dry run] Would create zips: moxtags-chrome-${TAG}.zip, moxtags-firefox-${TAG}.zip"
  echo ""
  echo "[dry run] No changes made."
  exit 0
fi

# --- Preflight checks ---

if ! command -v gh &>/dev/null; then
  echo "Error: GitHub CLI (gh) is required. Install it: https://cli.github.com"
  exit 1
fi

if ! command -v zip &>/dev/null; then
  echo "Error: zip is required."
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "Error: node is required."
  exit 1
fi

# Ensure we're in the repo root
if [[ ! -f manifests/base.json ]]; then
  echo "Error: must be run from the moxtags repo root (manifests/base.json not found)"
  exit 1
fi

# Check we're on the main branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: must be on the main branch to release (currently on: $BRANCH)"
  exit 1
fi

# Check for uncommitted changes
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: you have uncommitted changes. Please commit or stash them first."
  exit 1
fi

# Check tag doesn't already exist
if git rev-parse "$TAG" &>/dev/null; then
  echo "Error: tag $TAG already exists."
  exit 1
fi

# --- Update version ---

echo "Updating version to $VERSION..."

# Update manifests/base.json
node -e "
  import { readFileSync, writeFileSync } from 'fs';
  const json = JSON.parse(readFileSync('manifests/base.json', 'utf8'));
  json.version = '${VERSION}';
  writeFileSync('manifests/base.json', JSON.stringify(json, null, 2) + '\n');
  console.log('  manifests/base.json ✓');
"

# Update package.json
node -e "
  import { readFileSync, writeFileSync } from 'fs';
  const json = JSON.parse(readFileSync('package.json', 'utf8'));
  json.version = '${VERSION}';
  writeFileSync('package.json', JSON.stringify(json, null, 2) + '\n');
  console.log('  package.json ✓');
"

# --- Build ---

echo "Building extensions..."
node build.js

# --- Commit version bump & tag ---

git add manifests/base.json package.json
git commit -m "Release $TAG"
git tag -a "$TAG" -m "Release $TAG"

echo "Created tag $TAG"

# --- Package zips ---

CHROME_ZIP="moxtags-chrome-${TAG}.zip"
FIREFOX_ZIP="moxtags-firefox-${TAG}.zip"

echo "Packaging $CHROME_ZIP..."
(cd dist/chrome && zip -r "../../$CHROME_ZIP" .)
echo "  $(du -h "$CHROME_ZIP" | cut -f1) $CHROME_ZIP"

echo "Packaging $FIREFOX_ZIP..."
(cd dist/firefox && zip -r "../../$FIREFOX_ZIP" .)
echo "  $(du -h "$FIREFOX_ZIP" | cut -f1) $FIREFOX_ZIP"

# --- Push tag and create draft release ---

echo "Pushing tag to origin..."
git push origin main "$TAG"

echo "Creating draft release on GitHub..."
gh release create "$TAG" "$CHROME_ZIP" "$FIREFOX_ZIP" \
  --repo natefinch/moxtags \
  --title "MoxTags $TAG" \
  --notes "## Installation

### Chrome
1. Download **${CHROME_ZIP}** below
2. Unzip it to a folder
3. Open Chrome → \`chrome://extensions\`
4. Enable **Developer mode**
5. Click **Load unpacked** and select the unzipped folder

### Firefox
1. Download **${FIREFOX_ZIP}** below
2. Open Firefox → \`about:debugging#/runtime/this-firefox\`
3. Click **Load Temporary Add-on** and select the zip file (or any file inside it)" \
  --draft

# --- Cleanup ---

rm "$CHROME_ZIP" "$FIREFOX_ZIP"

echo ""
echo "Done! Draft release $TAG created at:"
echo "  https://github.com/natefinch/moxtags/releases/tag/$TAG"
echo ""
echo "Go to that URL to review and publish the release."
