# Skill: Cross-World Messaging

## Purpose
Add new message types for communication between the extension's three layers: content.js (ISOLATED world), page_hook.js (MAIN world), and background.js (service worker).

## Communication Channels

```
content.js  ←— chrome.runtime.sendMessage —→  background.js
content.js  ←— window.postMessage ————————→  page_hook.js
```

- **content.js ↔ background.js**: Use `chrome.runtime.sendMessage` / `chrome.runtime.onMessage`
- **content.js ↔ page_hook.js**: Use `window.postMessage` / `window.addEventListener('message', ...)`. Messages cross the ISOLATED ↔ MAIN world boundary via the shared DOM.

## When to Use Each Channel

| Need | Channel | Why |
|------|---------|-----|
| Scryfall API call | content → background | background has network access, no CORS issues |
| Moxfield API call | content → page_hook | page_hook runs in MAIN world with user's session cookies; Cloudflare blocks all other callers |
| Deck data from intercepted fetch | page_hook → content (via DOM element) | page_hook writes JSON to a hidden `#moxtags-deck-json` element |

## Adding a content.js ↔ background.js Message

### 1. Background handler (src/background.js)
Add a case in the `onMessage` listener:
```js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'myNewType') {
    doSomethingAsync(msg.param).then(result => {
      sendResponse({ ok: true, data: result });
    }).catch(err => {
      sendResponse({ ok: false, error: err.message });
    });
    return true; // keep channel open for async response
  }
});
```

### 2. Content.js caller
```js
chrome.runtime.sendMessage({ type: 'myNewType', param: value }, (resp) => {
  if (chrome.runtime.lastError) { /* handle */ }
  if (resp?.ok) { /* use resp.data */ }
});
```

## Adding a content.js ↔ page_hook.js Message

### 1. Page hook listener (src/page_hook.js)
```js
window.addEventListener('message', async (event) => {
  if (event.source !== window || event.data?.type !== 'moxtags-my-request') return;
  const { requestId, param } = event.data;
  try {
    const resp = await fetch(`https://api2.moxfield.com/v3/some/endpoint/${param}`);
    const data = await resp.json();
    window.postMessage({ type: 'moxtags-my-response', requestId, data });
  } catch (err) {
    window.postMessage({ type: 'moxtags-my-response', requestId, error: err.message });
  }
});
```

### 2. Content.js caller
Use a Promise wrapper with a `requestId` for correlation:
```js
function myProxyCall(param) {
  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).slice(2);
    const handler = (event) => {
      if (event.data?.type !== 'moxtags-my-response') return;
      if (event.data.requestId !== requestId) return;
      window.removeEventListener('message', handler);
      clearTimeout(timer);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.data);
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('Timeout'));
    }, 5000);
    window.addEventListener('message', handler);
    window.postMessage({ type: 'moxtags-my-request', requestId, param });
  });
}
```

## Naming Convention
- Message types use `moxtags-` prefix for postMessage (to avoid collisions with page scripts)
- Message types use camelCase for chrome.runtime messages (e.g., `fetchTags`, `fetchTagsByName`, `prefetchDeck`)
- Response types mirror request types with a `-result` or `-response` suffix for postMessage

## Existing Message Types
| Type | Channel | Direction |
|------|---------|-----------|
| `fetchTags` | chrome.runtime | content → background |
| `fetchTagsByName` | chrome.runtime | content → background |
| `prefetchDeck` | chrome.runtime | content → background |
| `moxtags-card-lookup` | postMessage | content → page_hook |
| `moxtags-card-result` | postMessage | page_hook → content |
