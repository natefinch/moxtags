# Skill: Design Doc Update

## Purpose
Keep DESIGN.md in sync after code changes. The design doc is the primary reference for how MoxTags works.

## When to Update
Update DESIGN.md when:
- Adding a new feature or UI element
- Changing an existing behavior (e.g., navigation → in-page search)
- Adding new message types or API calls
- Changing menu structure or injection logic
- Modifying the data flow between layers

Do NOT update for:
- Pure bug fixes that don't change intended behavior
- Internal refactors that don't change the external contract
- Test-only changes

## Document Structure
DESIGN.md is organized into these major sections:

| Section | Covers |
|---------|--------|
| **Extension Architecture** | 3-layer design, manifest, world contexts |
| **Data Flow** | How deck data and tags flow through the system |
| **Card Identity Resolution** | cardMap, Moxfield card ID lookup, name fallback |
| **Menu Detection & Tag Injection** | Click tracking, dropdown detection, injection logic |
| **UI Rendering** | Submenu structure, search links, flyout positioning, styles |
| **Search Box Tag Autocomplete** | Autocomplete popup, prefix matching, keyboard nav |
| **Message Protocol** | All chrome.runtime and postMessage types |
| **External API Contracts** | Scryfall and Moxfield API endpoints |
| **Data Flow Diagram** | ASCII diagram of all communication channels |
| **Project Structure** | File listing with descriptions |
| **Design Decisions & Trade-offs** | Rationale for key choices |

## Procedure

### 1. Identify affected sections
Read through the section headings and find which ones are impacted by your changes.

### 2. Update inline
Edit the relevant paragraphs, code blocks, or tables. Keep the existing style:
- Use fenced code blocks for HTML/JS examples
- Use tables for structured data (message types, API endpoints)
- Use numbered lists for sequential procedures
- Reference source files with inline backticks: `` `src/content.js` ``

### 3. Update code examples
If you changed DOM structure, button text, class names, or HTML output, update the corresponding code blocks in DESIGN.md (especially under "Submenu Structure").

### 4. Check cross-references
Sections reference each other with markdown links like `[Card Identity Resolution](#card-identity-resolution)`. Verify links still work if you renamed or moved sections.

### 5. Don't duplicate DESIGN.md content
The `.github/copilot-instructions.md` file contains a condensed summary for Copilot. If your DESIGN.md changes affect the instructions file, update both.
