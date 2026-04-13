# MoxTags

<img width="400" height="905" alt="image" align="right" src="https://github.com/user-attachments/assets/a9f14f67-ef6a-4138-8c11-e9fd86b72ed0" />

A browser extension (Chrome and Firefox) that adds **Scryfall Tagger** art
tags and card tags to the card context menus on
[Moxfield](https://moxfield.com), letting you easily see and search by those tags, as well as adding tag auto-complete in
search bars.

(Not affiliated with Scryfall, Moxfield, or Wizards of the Coast)

### Why tag-based search matters for deck building

Traditional text-based search works when you know exactly what you're looking for. But deck building is often about discovery — finding cards you didn't know existed that happen to do exactly what your deck needs. A search for "draw a card" won't find Rhystic Study. A search for "destroy target creature" won't find Toxic Deluge. But the scryfall tags "card-draw" and "board-wipe" will find all of them and more, because the tags describe function, not wording.

That's where Scryfall's Tagger system shines. Thousands of Magic: The Gathering cards have been tagged by the community with intuitive functional labels like "ramp," "card-draw," "sacrifice-outlet," "board-wipe," and hundreds more. These tags capture what a card does, not just what it says, which means you can find cards by role and function rather than trying to guess every possible wording.

The problem? Moxfield doesn't surface these tags anywhere. You'd have to leave your deck, go to Scryfall, look up each card, check its tags, and then switch back to Moxfield and manually search by those tags — constantly switching back and forth between sites. MoxTags eliminates that friction entirely.

## Install

### Chrome

1. Download the `moxtags-chrome-vX.Y.Z.zip` file from the [latest release](./releases)
2. Unzip it to a folder
3. Open Chrome → `chrome://extensions`
4. Enable **Developer mode**
5. Click **Load unpacked** and select the unzipped folder

### Firefox

Requires Firefox 128 or later.

1. Download the `moxtags-firefox-vX.Y.Z.xpi` file from the [latest release](./releases)
2. Open Firefox → `about:addons`
3. Click the gear icon (⚙) → **Install Add-on From File…**
4. Select the downloaded `.xpi` file

<img width="313" height="227" alt="image" src="https://github.com/user-attachments/assets/d921c482-58e9-4af8-bd57-c912543548c9" />

## Features

### Search By Scryfall Tags From Right Click Menu

Right-click any card in your Moxfield deck list or hit the card's dropdown arrow, and you'll see two new submenus at the bottom of the menu: Art Tags and Card Tags. Art Tags are specific to the particular printing and illustration of a card (useful for tracking artists, visual themes, and art-specific details). Card Tags describe the card's mechanical function and are shared across all printings.

Each submenu lists every Scryfall Tagger tag associated with that card. Click any tag to instantly search your deck for other cards sharing that same tag. Even better, you can check multiple tags and search for the combination — perfect for narrowing down exactly the kind of card you need.

For example, right-click your Commander and see that it's tagged with "sacrifice-outlet" and "aristocrats." Click either tag to discover which other cards in your deck share those synergies, or head to Scryfall to search the full card database for more options that fit the same role.

### Tab Completion for Searches

<p  align="center"><img width="531" height="569" alt="image" src="https://github.com/user-attachments/assets/9c048386-4015-4c1c-9389-c8e8bbcb04b6" />
</p>

### Add Scryfall Tags as Moxfield Tags

<p  align="center"><img width="500" height="781" alt="image" src="https://github.com/user-attachments/assets/fa355790-aca3-45e9-95b9-fb6eb451d246" /></p>

### Scryfall Tags on Search Results

- Click the 'Options' menu on image search results to find submenus for card tags. 

<img width="375" height="923" alt="image" src="https://github.com/user-attachments/assets/90b917b4-957f-4e76-bd40-23760306c8d6" />


- On text search results, image and card tags are added as dropdown menus.

<img width="600" height="669" alt="image" src="https://github.com/user-attachments/assets/45715033-d68d-4980-9f12-97d88e0bf501" />



## License

MIT

