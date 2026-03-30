#!/usr/bin/env bash
set -euo pipefail

# MoxTags Release Script
# Creates a git tag, builds the extension, packages it into a zip, and
# uploads it to GitHub as a draft release.
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

# Read current version from manifest.json
CURRENT=$(node -e "import{readFileSync as r}from'fs';console.log(JSON.parse(r('manifest.json','utf8')).version)")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

if [[ "$BUMP" == "patch" ]]; then
  VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
else
  VERSION="${MAJOR}.$((MINOR + 1)).0"
fi

TAG="v${VERSION}"

# Files included in the release zip (only what's needed to run the extension)
ZIP_FILES=(
  icons/
  background.js
  content.js
  manifest.json
  page_hook.js
  popup.html
  popup.js
  styles.css
)

echo "Current version: $CURRENT → releasing $TAG ($BUMP bump)"

if $DRYRUN; then
  echo ""
  echo "[dry run] Would create tag: $TAG"
  echo "[dry run] Would create zip: moxtags-${TAG}.zip containing:"
  for f in "${ZIP_FILES[@]}"; do
    echo "  $f"
  done
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

# Ensure we're in the repo root
if [[ ! -f manifest.json ]]; then
  echo "Error: must be run from the moxtags repo root (manifest.json not found)"
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

# --- Update version in manifest.json ---

echo "Updating version to $VERSION..."

# Use node for reliable JSON editing
node -e "
  import { readFileSync, writeFileSync } from 'fs';
  const json = JSON.parse(readFileSync('manifest.json', 'utf8'));
  json.version = '${VERSION}';
  writeFileSync('manifest.json', JSON.stringify(json, null, 2) + '\n');
  console.log('  manifest.json ✓');
"

# --- Commit version bump & tag ---

git add manifest.json
git commit -m "Release $TAG"
git tag -a "$TAG" -m "Release $TAG"

echo "Created tag $TAG"

# --- Package zip ---

ZIPFILE="moxtags-${TAG}.zip"

echo "Packaging $ZIPFILE..."

# Only include files needed to run the extension (no source, tests, build tools, docs)
zip -r "$ZIPFILE" "${ZIP_FILES[@]}"

echo "  $(du -h "$ZIPFILE" | cut -f1) $ZIPFILE"

# --- Push tag and create draft release ---

echo "Pushing tag to origin..."
git push origin main "$TAG"

echo "Creating draft release on GitHub..."
gh release create "$TAG" "$ZIPFILE" \
  --repo natefinch/moxtags \
  --title "MoxTags $TAG" \
  --notes "## Installation

1. Download **${ZIPFILE}** below
2. Unzip it to a folder
3. Open Chrome → \`chrome://extensions\`
4. Enable **Developer mode**
5. Click **Load unpacked** and select the unzipped folder" \
  --draft

# --- Cleanup ---

rm "$ZIPFILE"

echo ""
echo "Done! Draft release $TAG created at:"
echo "  https://github.com/natefinch/moxtags/releases/tag/$TAG"
echo ""
echo "Go to that URL to review and publish the release."
