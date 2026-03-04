// MoxTags - Background Service Worker
// Fetches card tags from Scryfall Tagger's GraphQL API.

const GRAPHQL_URL = 'https://tagger.scryfall.com/graphql';
const TAGGER_ORIGIN = 'https://tagger.scryfall.com';
const DNR_RULE_ID = 1;

const FETCH_CARD_QUERY = `
  query FetchCard($set: String!, $number: String!) {
    card: cardBySet(set: $set, number: $number) {
      name
      taggings {
        type
        tag {
          name
          slug
          namespace
          type
        }
      }
    }
  }
`;

let csrfToken = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetch') {
    doFetch(msg.url, msg.options || {})
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.type === 'fetchTags') {
    fetchTags(msg.set, msg.number)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ─── Simple proxy fetch (used for Moxfield API) ─────────────────────
async function doFetch(url, options) {
  try {
    const resp = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      credentials: 'omit',
    });
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}: ${resp.statusText}`, status: resp.status };
    }
    const body = await resp.text();
    return { ok: true, body, status: resp.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Tagger GraphQL fetch ───────────────────────────────────────────
async function fetchTags(set, number) {
  try {
    if (!csrfToken) {
      await refreshSession(set, number);
    }

    let result = await callGraphQL(set, number);

    // If the token expired / cookies invalid, refresh once and retry.
    if (!result.ok && result.csrf) {
      await refreshSession(set, number);
      result = await callGraphQL(set, number);
    }

    return result;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Fetch a Tagger page to establish a session cookie, extract the CSRF
 * token, then set up declarativeNetRequest rules so that subsequent
 * fetch() calls to /graphql carry the correct Cookie header and have
 * the extension's Origin header removed (Rails rejects foreign origins).
 */
async function refreshSession(set, number) {
  const pageUrl = `${TAGGER_ORIGIN}/card/${encodeURIComponent(set)}/${encodeURIComponent(number)}`;

  // credentials: 'include' stores the Set-Cookie in the browser jar.
  const resp = await fetch(pageUrl, { credentials: 'include' });
  const html = await resp.text();

  // Extract CSRF token from <meta name="csrf-token" content="...">.
  const match = html.match(/csrf-token"\s+content="([^"]+)"/);
  if (!match) {
    throw new Error('Could not extract CSRF token from Tagger page');
  }
  csrfToken = match[1];

  // Read the session cookies that were stored by the page fetch.
  const cookies = await chrome.cookies.getAll({ url: TAGGER_ORIGIN });
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  console.log('[MoxTags BG] CSRF token acquired. Cookies found:', cookies.length,
    cookies.map(c => c.name).join(', '));

  // Install a declarativeNetRequest session rule that:
  //  • Sets the Cookie header (fetch() silently drops manually-set Cookie)
  //  • Removes the Origin header (service worker sets it to chrome-extension://…
  //    which Rails CSRF protection rejects)
  const requestHeaders = [
    { header: 'origin', operation: 'remove' },
  ];
  if (cookieStr) {
    requestHeaders.push({ header: 'cookie', operation: 'set', value: cookieStr });
  }

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [DNR_RULE_ID],
    addRules: [{
      id: DNR_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders,
      },
      condition: {
        urlFilter: GRAPHQL_URL,
        resourceTypes: ['xmlhttprequest', 'other'],
      },
    }],
  });

  console.log('[MoxTags BG] declarativeNetRequest rule installed for /graphql');
}

async function callGraphQL(set, number) {
  // Cookie and Origin are handled by the declarativeNetRequest rule.
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    credentials: 'omit',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify({
      query: FETCH_CARD_QUERY,
      variables: { set, number },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.warn('[MoxTags BG] GraphQL error:', resp.status, text.substring(0, 200));
    if (resp.status === 422 || text.includes('authenticity token') || text.includes('invalid')) {
      csrfToken = null;
      return { ok: false, csrf: true, error: 'CSRF / session invalid' };
    }
    return { ok: false, error: `HTTP ${resp.status}: ${text.substring(0, 200)}` };
  }

  const json = await resp.json();
  if (!json.data?.card) {
    console.warn('[MoxTags BG] Card not found in Tagger response:', JSON.stringify(json).substring(0, 200));
    return { ok: false, error: 'Card not found in Tagger' };
  }

  // Categorise tags by namespace.
  const artTags = [];
  const cardTags = [];

  for (const tagging of json.data.card.taggings || []) {
    const tag = tagging.tag;
    if (!tag) continue;
    const entry = { name: tag.name, slug: tag.slug };
    if (tag.namespace === 'artwork') {
      artTags.push(entry);
    } else if (tag.namespace === 'card') {
      cardTags.push(entry);
    }
  }

  console.log('[MoxTags BG] Tags fetched:', artTags.length, 'art,', cardTags.length, 'card');
  return { ok: true, artTags, cardTags };
}
