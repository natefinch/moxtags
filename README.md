<p align="center"><img width="273" height="773" alt="image"  src="https://github.com/user-attachments/assets/5b4386cf-3e44-472f-a92d-51ddb96234b2" /></p>

A browser extension (Chrome and Firefox) that adds **Scryfall Tagger** art
tags and card tags to the card context menus on
[Moxfield](https://moxfield.com) as well as adding tag auto-complete in
search bars.

## MoxTags

MoxTags brings Scryfall Tagger's community-curated tags directly into your Moxfield deck building experience.

When you're building a deck on Moxfield, finding the right cards to fill a role can be surprisingly difficult. You know you need more ramp, or more removal, or another sacrifice outlet — but crafting the perfect search query is an exercise in frustration. Cards that do similar things are often worded completely differently, and even the most carefully written search will inevitably miss options you didn't think to look for.

### Why tag-based search matters for deck building

Traditional text-based search works when you know exactly what you're looking for. But deck building is often about discovery — finding cards you didn't know existed that happen to do exactly what your deck needs. A search for "draw a card" won't find Rhystic Study. A search for "destroy target creature" won't find Toxic Deluge. But the scryfall tags "card-draw" and "board-wipe" will find all of them and more, because the tags describe function, not wording.

That's where Scryfall's Tagger system shines. Thousands of Magic: The Gathering cards have been tagged by the community with intuitive functional labels like "ramp," "card-draw," "sacrifice-outlet," "board-wipe," and hundreds more. These tags capture what a card does, not just what it says, which means you can find cards by role and function rather than trying to guess every possible wording.

The problem? Moxfield doesn't surface these tags anywhere. You'd have to leave your deck, go to Scryfall, look up each card, check its tags, and then switch back to Moxfield and manually search by those tags — constantly switching back and forth between sites. MoxTags eliminates that friction entirely.

## Install

### Chrome

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/moxtags/baekakabcmcpmhoonggddlmikdcnmkni).

<details><summary>Manual install (developer mode)</summary>

1. Download the `moxtags-chrome-vX.Y.Z.zip` file from the [latest release](./releases)
2. Unzip it to a folder
3. Open Chrome → `chrome://extensions`
4. Enable **Developer mode**
5. Click **Load unpacked** and select the unzipped folder

</details>

### Firefox

Requires Firefox 128 or later.

1. Download the `moxtags-firefox-vX.Y.Z.xpi` file from the [latest release](./releases)
2. Open Firefox → `about:addons`
3. Click the gear icon (⚙) → **Install Add-on From File…**
4. Select the downloaded `.xpi` file

Note that the first time you install MoxTags, it ships with a bundled snapshot of the tag data so tags are available immediately. It will automatically refresh this data from Scryfall in the background. You can check on the status by clicking on the MoxTags toolbar button in your list of extensions.

<img width="313" height="227" alt="image" src="https://github.com/user-attachments/assets/d921c482-58e9-4af8-bd57-c912543548c9" />

## Features

### Search By Scryfall Tags From Right Click Menu

<p align="center"><img width="600" height="828" alt="Image" src="https://github.com/user-attachments/assets/267dd949-2cee-46c2-97c3-132904beb610" /></p>

Right-click any card in your Moxfield deck list or hit the card's dropdown arrow, and you'll see two new submenus at the bottom of the menu: Art Tags and Card Tags. Art Tags are specific to the particular printing and illustration of a card (useful for tracking artists, visual themes, and art-specific details). Card Tags describe the card's mechanical function and are shared across all printings.

Each submenu lists every Scryfall Tagger tag associated with that card. Click any tag to instantly search your deck for other cards sharing that same tag. Even better, you can check multiple tags and search for the combination — perfect for narrowing down exactly the kind of card you need.

For example, right-click your Commander and see that it's tagged with "sacrifice-outlet" and "aristocrats." Click either tag to discover which other cards in your deck share those synergies, or head to Scryfall to search the full card database for more options that fit the same role.

### Tab Completion for Searches

<p  align="center"><img width="531" height="569" alt="image" src="https://github.com/user-attachments/assets/9c048386-4015-4c1c-9389-c8e8bbcb04b6" />
</p>

### Add Scryfall Tags as Moxfield Tags

<p  align="center"><img width="500" height="781" alt="image" src="https://github.com/user-attachments/assets/fa355790-aca3-45e9-95b9-fb6eb451d246" /></p>

### Scryfall Tags on Search Results

<p  align="center"><img width="434" height="718" alt="image" src="https://github.com/user-attachments/assets/fc6f1477-146f-40bb-88d8-f43db037ba0f" /></p>
<br/>
<p  align="center"><img width="640" height="526" alt="image" src="https://github.com/user-attachments/assets/c53037c7-65b5-40e3-864c-17acbbe6dc98" /></p>


## License

MIT

## Development

### Prerequisites

- Node.js (for building and testing)

### Setup

```bash
npm install
```

### Build

```bash
npm run build          # Build both Chrome and Firefox
npm run build:chrome   # Build Chrome only
npm run build:firefox  # Build Firefox only
```

Built extensions are output to `dist/chrome/` and `dist/firefox/`.

### Test

```bash
npm test
```

### Release

```bash
node scripts/fetch-tags.js # Update bundled Scryfall tag data before releasing
./release.sh           # Bump minor version, build, tag, and create draft GitHub release
./release.sh --patch   # Bump patch version only
./release.sh --dryrun  # Preview what would happen
```

### Architecture

See [DESIGN.md](DESIGN.md) for detailed architecture documentation.
