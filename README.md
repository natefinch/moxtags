# MoxTags

A Chrome extension that adds **Scryfall Tagger** art tags and card tags to the
card context menus on [Moxfield](https://moxfield.com).

<img width="381" height="956" alt="Image" src="https://github.com/user-attachments/assets/dc35e64d-3406-4a9a-8fcb-6df788fe1a56" />

## How It Works

1. When you open a deck page on Moxfield, the extension fetches the deck data
   from the Moxfield API to learn each card's **set code** and **collector
   number**.
2. When you click the dropdown arrow (▼) next to a card in the deck list,
   the extension detects the context menu and identifies which card you
   clicked on.
3. It fetches the tags for that exact printing from
   `https://tagger.scryfall.com/card/{set}/{number}`.
4. Two new sections — **Art Tags** and **Card Tags** — are appended to the
   bottom of the context menu.
5. Each tag is a clickable link that searches within the current deck using
   the Moxfield search syntax (e.g. `otag:activated-ability` for card tags,
   `art:armor` for art tags).

## Installation (Developer / Unpacked)

1. Clone or download this repository.
2. Open **Chrome** and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `moxtags` folder (the one
   containing `manifest.json`).
5. Navigate to any Moxfield deck page (e.g.
   `https://moxfield.com/decks/ArMO-boBaU2O0xO8qOBrSw`).
6. Click the dropdown arrow next to any card — you should see the tag
   sections at the bottom of the menu.

## Files

| File            | Purpose                                                    |
| --------------- | ---------------------------------------------------------- |
| `manifest.json` | Chrome Extension manifest (Manifest V3)                    |
| `background.js` | Service worker — proxies cross-origin fetch requests       |
| `content.js`    | Content script — deck data loading, menu detection, UI     |
| `styles.css`    | Styles for the injected tag sections                       |

## Notes

- The extension works for **public decks**. Private decks require
  authentication cookies that the background service worker does not
  currently forward — this may be added in a future version.
- Art tag search links use the `art:` prefix and card tag links use `otag:`.
  If Moxfield does not support `art:` in its deck search, those links may
  not filter correctly.
- Tag results are cached in memory for the session so re-opening a card's
  menu does not re-fetch from Scryfall Tagger.

## License

MIT
