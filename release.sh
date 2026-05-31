#!/usr/bin/env bash
set -euo pipefail

# MoxTags Release Script
# Creates a git tag, builds the extension for Chrome and Firefox,
# submits Firefox to AMO, signs a self-distributed Firefox XPI, uploads Chrome
# to the Web Store, packages release assets, and creates a draft GitHub release.
#
# By default, increments the minor version (e.g. v1.4.2 → v1.5.0).
# Use --patch to increment only the patch version (e.g. v1.4.2 → v1.4.3).
# Use --skip-chrome to skip Chrome Web Store upload/publish and keep the
# Chrome zip locally for manual Web Store upload.
# Use --skip-firefox-listed to skip public AMO submission and only sign the local XPI.
# Use --dryrun to preview what would happen without making any changes.
#
# Recovery notes:
#   If AMO or Chrome submission succeeds but a later step fails, do not re-run
#   the script unchanged: AMO version numbers are consumed per channel. Finish
#   the remaining git/GitHub release steps manually, or bump to a new version.
#
# Required environment variables:
#   AMO_JWT_ISSUER       — AMO API key (from https://addons.mozilla.org/developers/addon/api/key/)
#   AMO_JWT_SECRET       — AMO API secret
#   CHROME_CLIENT_ID     — Google API OAuth2 client ID (not required with --skip-chrome)
#   CHROME_CLIENT_SECRET — Google API OAuth2 client secret (not required with --skip-chrome)
#   CHROME_REFRESH_TOKEN — Google API OAuth2 refresh token (not required with --skip-chrome)
#
# Usage:
#   ./release.sh                        # bump minor version
#   ./release.sh --patch                # bump patch version
#   ./release.sh --skip-chrome          # build Chrome zip but skip Chrome Web Store API
#   ./release.sh --skip-firefox-listed  # skip public AMO submission
#   ./release.sh --dryrun               # preview minor bump
#   ./release.sh --patch --dryrun       # preview patch bump

# --- Constants ---

CHROME_EXTENSION_ID="baekakabcmcpmhoonggddlmikdcnmkni"
FIREFOX_ADDON_URL="${FIREFOX_ADDON_URL:-https://addons.mozilla.org/firefox/addon/moxtags/}"
AMO_METADATA_FILE="amo-metadata.json"

# --- Argument parsing ---

BUMP="minor"
DRYRUN=false
SKIP_CHROME=false
SKIP_FIREFOX_LISTED=false
for arg in "$@"; do
  case "$arg" in
    --patch)                BUMP="patch" ;;
    --skip-chrome)          SKIP_CHROME=true ;;
    --skip-firefox-listed)  SKIP_FIREFOX_LISTED=true ;;
    --dryrun)               DRYRUN=true ;;
    *)
      echo "Usage: $0 [--patch] [--skip-chrome] [--skip-firefox-listed] [--dryrun]"
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
FIREFOX_LOCAL_VERSION="${VERSION}.1"
FIREFOX_LOCAL_TAG="v${FIREFOX_LOCAL_VERSION}"

echo "Current version: $CURRENT → releasing $TAG ($BUMP bump)"

if $DRYRUN; then
  echo ""
  echo "[dry run] Would create tag: $TAG"
  echo "[dry run] Would build Chrome and Firefox extensions"
  if ! $SKIP_FIREFOX_LISTED; then
    echo "[dry run] Would submit Firefox extension to AMO listed channel with source archive"
  else
    echo "[dry run] Skipping public AMO submission (--skip-firefox-listed)"
  fi
  echo "[dry run] Would sign Firefox self-distributed XPI via AMO unlisted channel as $FIREFOX_LOCAL_TAG"
  if ! $SKIP_CHROME; then
    echo "[dry run] Would upload and publish Chrome extension to Chrome Web Store"
  else
    echo "[dry run] Would keep Chrome package for manual Web Store upload (--skip-chrome)"
  fi
  echo "[dry run] Would create: moxtags-chrome-${TAG}.zip, moxtags-firefox-${FIREFOX_LOCAL_TAG}.xpi"
  echo "[dry run] Would create draft GitHub release with both assets"
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

# Check store credentials
missing=()
[[ -z "${AMO_JWT_ISSUER:-}" ]]       && missing+=("AMO_JWT_ISSUER")
[[ -z "${AMO_JWT_SECRET:-}" ]]       && missing+=("AMO_JWT_SECRET")
if ! $SKIP_CHROME; then
  [[ -z "${CHROME_CLIENT_ID:-}" ]]     && missing+=("CHROME_CLIENT_ID")
  [[ -z "${CHROME_CLIENT_SECRET:-}" ]] && missing+=("CHROME_CLIENT_SECRET")
  [[ -z "${CHROME_REFRESH_TOKEN:-}" ]] && missing+=("CHROME_REFRESH_TOKEN")
fi
if (( ${#missing[@]} > 0 )); then
  echo "Error: missing required environment variables:"
  printf '  %s\n' "${missing[@]}"
  echo ""
  echo "AMO credentials:    https://addons.mozilla.org/developers/addon/api/key/"
  if ! $SKIP_CHROME; then
    echo "Chrome credentials: https://developer.chrome.com/docs/webstore/using-api"
  fi
  exit 1
fi

# Ensure we're in the repo root
if [[ ! -f manifests/base.json ]]; then
  echo "Error: must be run from the moxtags repo root (manifests/base.json not found)"
  exit 1
fi

if ! $SKIP_FIREFOX_LISTED && [[ ! -f "$AMO_METADATA_FILE" ]]; then
  echo "Error: $AMO_METADATA_FILE is required for public AMO submission"
  exit 1
fi

if [[ ! -d src/data ]] || ! compgen -G "src/data/*.js" > /dev/null; then
  echo "Error: src/data tag indexes are required for release builds."
  echo "Run: node scripts/fetch-tags.js"
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

TMP_DIRS=()
cleanup_tmp() {
  for dir in "${TMP_DIRS[@]}"; do
    rm -rf "$dir"
  done
}
trap cleanup_tmp EXIT

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

# --- Package Chrome zip (needed for CWS upload and GitHub release) ---

CHROME_ZIP="moxtags-chrome-${TAG}.zip"

echo "Packaging $CHROME_ZIP..."
node scripts/package-release-assets.js chrome --out "$CHROME_ZIP"
echo "  $(du -h "$CHROME_ZIP" | cut -f1) $CHROME_ZIP"

# --- Submit Firefox extension to AMO and sign local XPI ---

FIREFOX_XPI="moxtags-firefox-${FIREFOX_LOCAL_TAG}.xpi"
SOURCE_ZIP="moxtags-source-${TAG}.zip"

if ! $SKIP_FIREFOX_LISTED; then
  echo "Packaging $SOURCE_ZIP for AMO source review..."
  node scripts/package-release-assets.js source --tag "$TAG" --out "$SOURCE_ZIP"
  echo "  $(du -h "$SOURCE_ZIP" | cut -f1) $SOURCE_ZIP"

  echo "Submitting Firefox extension to AMO listed channel..."
  rm -rf web-ext-artifacts-listed
  npx web-ext sign \
    --source-dir=dist/firefox/ \
    --artifacts-dir=web-ext-artifacts-listed/ \
    --channel=listed \
    --amo-metadata="$AMO_METADATA_FILE" \
    --upload-source-code="$SOURCE_ZIP" \
    --approval-timeout=0 \
    --no-input \
    --api-key="$AMO_JWT_ISSUER" \
    --api-secret="$AMO_JWT_SECRET"
  rm -rf web-ext-artifacts-listed
else
  echo "Skipping public AMO submission (--skip-firefox-listed)"
fi

FIREFOX_LOCAL_TMP="$(mktemp -d)"
TMP_DIRS+=("$FIREFOX_LOCAL_TMP")
node scripts/package-release-assets.js firefox-dir --version "$FIREFOX_LOCAL_VERSION" --out-dir "$FIREFOX_LOCAL_TMP/firefox"

echo "Signing Firefox self-distributed XPI via AMO (unlisted, version $FIREFOX_LOCAL_VERSION)..."
rm -rf web-ext-artifacts
npx web-ext sign \
  --source-dir="$FIREFOX_LOCAL_TMP/firefox/" \
  --artifacts-dir=web-ext-artifacts/ \
  --channel=unlisted \
  --no-input \
  --api-key="$AMO_JWT_ISSUER" \
  --api-secret="$AMO_JWT_SECRET"

# Find the signed .xpi and rename to our convention.
SIGNED_XPI=$(find web-ext-artifacts/ -name '*.xpi' -print -quit)
if [[ -z "$SIGNED_XPI" ]]; then
  echo "Error: web-ext sign did not produce an .xpi file"
  rm -rf web-ext-artifacts/
  exit 1
fi
mv "$SIGNED_XPI" "$FIREFOX_XPI"
rm -rf web-ext-artifacts/
echo "  $(du -h "$FIREFOX_XPI" | cut -f1) $FIREFOX_XPI"

# --- Upload Chrome extension to Web Store ---

if ! $SKIP_CHROME; then
  echo "Uploading Chrome extension to Web Store..."
  npx chrome-webstore-upload upload \
    --source "$CHROME_ZIP" \
    --extension-id "$CHROME_EXTENSION_ID" \
    --client-id "$CHROME_CLIENT_ID" \
    --client-secret "$CHROME_CLIENT_SECRET" \
    --refresh-token "$CHROME_REFRESH_TOKEN"

  echo "Publishing Chrome extension..."
  npx chrome-webstore-upload publish \
    --extension-id "$CHROME_EXTENSION_ID" \
    --client-id "$CHROME_CLIENT_ID" \
    --client-secret "$CHROME_CLIENT_SECRET" \
    --refresh-token "$CHROME_REFRESH_TOKEN"
else
  echo "Skipping Chrome Web Store upload (--skip-chrome); $CHROME_ZIP will be kept for manual upload"
fi

# --- Commit version bump & tag ---

git add manifests/base.json package.json
git commit -m "Release $TAG"
git tag -a "$TAG" -m "Release $TAG"

echo "Created tag $TAG"

# --- Push tag and create draft release ---

echo "Pushing tag to origin..."
git push origin main "$TAG"

echo "Creating draft release on GitHub..."
gh release create "$TAG" "$CHROME_ZIP" "$FIREFOX_XPI" \
  --repo natefinch/moxtags \
  --title "MoxTags $TAG" \
  --notes "## Installation

### Chrome
Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/moxtags/${CHROME_EXTENSION_ID}) once the store review is complete.

Manual install is also available if the Web Store review is delayed:
1. Download **${CHROME_ZIP}** below
2. Unzip it to a folder
3. Open Chrome → \`chrome://extensions\`
4. Enable **Developer mode**
5. Click **Load unpacked** and select the unzipped folder

### Firefox
Install from [Firefox Add-ons](${FIREFOX_ADDON_URL}) once AMO review is complete.

Manual install is also available with the signed self-distributed XPI:
1. Download **${FIREFOX_XPI}** below
2. Open Firefox → \`about:addons\`
3. Click the gear icon (⚙) → **Install Add-on From File…**
4. Select the downloaded \`.xpi\` file

Note: the downloadable Firefox XPI uses AMO's unlisted signing channel and has internal version ${FIREFOX_LOCAL_VERSION}; AMO requires distinct version numbers between listed and unlisted channels." \
  --draft

# --- Cleanup ---

if ! $SKIP_CHROME; then
  rm "$CHROME_ZIP"
else
  echo "Chrome package ready for manual Web Store upload: $CHROME_ZIP"
fi
rm "$FIREFOX_XPI"
if [[ -f "$SOURCE_ZIP" ]]; then
  rm "$SOURCE_ZIP"
fi

echo ""
echo "Done! Draft release $TAG created at:"
echo "  https://github.com/natefinch/moxtags/releases/tag/$TAG"
echo ""
echo "Go to that URL to review and publish the release."
