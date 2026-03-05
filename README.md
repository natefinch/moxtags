<p align="center"><img width="273" height="773" alt="image"  src="https://github.com/user-attachments/assets/5b4386cf-3e44-472f-a92d-51ddb96234b2" /></p>


A Chrome extension that adds **Scryfall Tagger** art tags and card tags to the
card context menus on [Moxfield](https://moxfield.com).

<p align="center"><img width="531" height="828" alt="Image" src="https://github.com/user-attachments/assets/267dd949-2cee-46c2-97c3-132904beb610" /></p>

## MoxTags
MoxTags brings Scryfall Tagger's community-curated tags directly into your Moxfield deck building experience.

When you're building a deck on Moxfield, finding the right cards to fill a role can be surprisingly difficult. You know you need more ramp, or more removal, or another sacrifice outlet — but crafting the perfect search query is an exercise in frustration. Cards that do similar things are often worded completely differently, and even the most carefully written search will inevitably miss options you didn't think to look for.

That's where Scryfall's Tagger system shines. Thousands of Magic: The Gathering cards have been tagged by the community with intuitive functional labels like "ramp," "card-draw," "sacrifice-outlet," "board-wipe," and hundreds more. These tags capture what a card does, not just what it says, which means you can find cards by role and function rather than trying to guess every possible wording.

The problem? Moxfield doesn't surface these tags anywhere. You'd have to leave your deck, go to Scryfall, look up each card, check its tags, and then manually search by those tags — constantly switching back and forth between sites. MoxTags eliminates that friction entirely.

### How it works:

Right-click any card in your Moxfield deck list and you'll see two new submenus in the context menu: Art Tags and Card Tags. Art Tags are specific to the particular printing and illustration of a card (useful for tracking artists, visual themes, and art-specific details). Card Tags describe the card's mechanical function and are shared across all printings.

Each submenu lists every Scryfall Tagger tag associated with that card. Click any tag to instantly search your deck for other cards sharing that same tag. Even better, you can check multiple tags and search for the combination — perfect for narrowing down exactly the kind of card you need.

For example, right-click your Commander and see that it's tagged with "sacrifice-outlet" and "aristocrats." Click either tag to discover which other cards in your deck share those synergies, or head to Scryfall to search the full card database for more options that fit the same role.

### Key features:

• Art tags and card tags for every card in your deck, right in the context menu
• Multi-tag search — check multiple tags and search for cards matching any combination
• Works with private decks — MoxTags reads your deck data as the page loads, so it works even with decks that aren't shared publicly
• Printing-aware — different printings of the same card can have different art tags, and MoxTags respects which specific version is in your deck
• Fast and lightweight — tag data is cached locally and refreshed daily, so lookups are nearly instant
• No account required — MoxTags uses Scryfall's public tag data and doesn't require you to log into anything

### Why tag-based search matters for deck building:

Traditional text-based search works when you know exactly what you're looking for. But deck building is often about discovery — finding cards you didn't know existed that happen to do exactly what your deck needs. A search for "draw a card" won't find Rhystic Study. A search for "destroy target creature" won't find Toxic Deluge. But the tags "card-draw" and "board-wipe" will find all of them and more, because the tags describe function, not wording.

MoxTags puts that discovery power right where you're already building your deck.

## Technical Details

1. When you open a deck page on Moxfield, the extension fetches the deck data
   from the Moxfield API to learn each card's **set code** and **collector
   number**.
2. When you click the dropdown arrow (▼) next to a card in the deck list,
   the extension detects the context menu and identifies which card you
   clicked on.
3. It looks up the tags for that card from the locally cached Scryfall tag
   data (see [Tag Data Cache](#tag-data-cache) below).
4. Two new sections — **Art Tags** and **Card Tags** — are appended to the
   bottom of the context menu.
5. Each tag is a clickable link that searches within the current deck using
   the Moxfield search syntax (e.g. `otag:activated-ability` for card tags,
   `art:armor` for art tags).
6. Or you can select the checkboxes next to multiple tags to search by all checked tags.

## Installation (Developer / Unpacked)

1. Clone or download this repository (go to the green `Code` button in the upper right and click `Download Zip`).
2. Open **Chrome** and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `moxtags` folder (the one
   containing `manifest.json`).
5. Navigate to any Moxfield deck page (e.g.
   `https://moxfield.com/decks/ArMO-boBaU2O0xO8qOBrSw`).
6. Click the dropdown arrow next to any card — you should see the tag
   sections at the bottom of the menu.

## Files

| File            | Purpose                                                         |
| --------------- | --------------------------------------------------------------- |
| `manifest.json` | Chrome Extension manifest (Manifest V3)                         |
| `background.js` | Service worker — tag data caching, batch prefetch, proxy fetch  |
| `content.js`    | Content script — deck data loading, menu detection, UI          |
| `styles.css`    | Styles for the injected tag sections                            |
| `popup.html`    | Toolbar popup — tag cache status UI                             |
| `popup.js`      | Toolbar popup logic — queries background for cache status       |
| `page_hook.js`  | Page-context hook — captures Moxfield auth for private decks    |

## Tag Data Cache

MoxTags downloads the full Scryfall tag dataset (oracle tags and illustration
tags) and stores it locally using Chrome's `storage.local` API. This means tag
lookups are fast — no network request is needed when you open a card's context
menu.

- **Initial download** happens automatically the first time you use the
  extension (or if you clear extension storage). The two tag files are ~5 MB
  combined.
- **Daily refresh** — an alarm fires roughly every 24 hours (with a random
  jitter of up to 60 minutes) to re-download the tag data so it stays
  current.
- **Per-deck prefetch** — when you open a deck page, the extension
  batch-fetches each card's `oracle_id` and `illustration_id` from
  Scryfall's `/cards/collection` endpoint (up to 75 cards per request).
  Tags for every card in the deck are resolved against the cached indexes
  and stored in memory, so opening a card's menu is instant.

### Toolbar Button

Click the **MoxTags** icon in the Chrome toolbar to see a status popup:

| Indicator | Meaning |
|---|---|
| 🟢 Green dot | Tag cache is ready — shows how long ago it was downloaded |
| 🟡 Pulsing yellow dot | Tag data is currently being downloaded |
| ⚪ Grey dot | No tag data has been cached yet |
| 🔴 Red dot | Unable to reach the background worker / last refresh failed |

The popup also shows:
- **Last downloaded** — relative time (e.g. "3h 12m ago") and absolute
  timestamp of the most recent successful cache refresh.
- **Oracle IDs indexed** / **Illustration IDs indexed** — the number of
  unique IDs in each reverse index, so you can confirm the data loaded
  correctly.
- **Refresh tag data now** button — triggers an immediate re-download of the
  tag data without waiting for the next scheduled alarm.

## Notes

- The extension works for both **public and private decks**. For private
  decks, a small page-context hook (`page_hook.js`) captures the
  `Authorization` header that Moxfield's own JavaScript sends to its API.
  The content script then reuses that token (along with session cookies)
  when fetching deck data. If the token isn't available (e.g. logged out),
  the extension falls back to an unauthenticated request, which works for
  public decks.
- Art tag search links use the `art:` prefix and card tag links use `otag:`.

## License

MIT
