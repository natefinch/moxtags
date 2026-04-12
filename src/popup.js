// MoxTags – Popup Script

console.log('[MoxTags Popup] Popup opened');

const statusDot  = document.getElementById('statusDot');
const statusText  = document.getElementById('statusText');
const details     = document.getElementById('details');
const refreshBtn  = document.getElementById('refreshBtn');

// ─── Load status on open ─────────────────────────────────────────────
loadStatus();

refreshBtn.addEventListener('click', () => {
  console.log('[MoxTags Popup] Refresh button clicked');
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing…';
  chrome.runtime.sendMessage({ type: 'refreshTags' }, () => {
    console.log('[MoxTags Popup] refreshTags message sent, polling…');
    // Brief delay so the background has time to start the fetch,
    // then poll until it finishes.
    setTimeout(pollUntilReady, 500);
  });
});

function pollUntilReady() {
  chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
    console.log('[MoxTags Popup] getStatus response:', JSON.stringify(resp));
    renderStatus(resp);
    if (resp?.refreshing) {
      setTimeout(pollUntilReady, 800);
    } else {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Refresh tag data now';
    }
  });
}

function loadStatus() {
  console.log('[MoxTags Popup] Loading initial status…');
  chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      console.warn('[MoxTags Popup] Cannot reach background:', chrome.runtime.lastError?.message);
      statusDot.className = 'status-dot error';
      statusText.textContent = 'Cannot reach background worker';
      return;
    }
    console.log('[MoxTags Popup] Initial status:', JSON.stringify(resp));
    renderStatus(resp);
  });
}

function renderStatus(resp) {
  if (!resp) return;

  if (resp.refreshing) {
    statusDot.className = 'status-dot loading';
    statusText.textContent = 'Downloading tag data…';
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Refreshing…';
  } else if (resp.tagDataTimestamp) {
    statusDot.className = 'status-dot ready';
    statusText.textContent = 'Tag cache ready';
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh tag data now';
  } else {
    statusDot.className = 'status-dot unknown';
    statusText.textContent = 'No tag data cached yet';
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh tag data now';
  }

  // Build detail lines using DOM methods (avoids innerHTML for AMO compliance).
  details.textContent = '';

  if (resp.tagDataTimestamp) {
    const date = new Date(resp.tagDataTimestamp);
    const ago = timeAgo(resp.tagDataTimestamp);
    details.append(detailLine('Last downloaded:', ' ' + ago));
    const dateDiv = document.createElement('div');
    dateDiv.className = 'detail';
    dateDiv.style.fontSize = '11px';
    dateDiv.style.color = '#7f849c';
    dateDiv.textContent = date.toLocaleString();
    details.append(dateDiv);
  }

  if (resp.oracleCount != null) {
    details.append(detailLine('Oracle IDs indexed:', ' ' + resp.oracleCount.toLocaleString()));
  }
  if (resp.illustrationCount != null) {
    details.append(detailLine('Illustration IDs indexed:', ' ' + resp.illustrationCount.toLocaleString()));
  }

  if (resp.lastError) {
    const div = detailLine('Last error:', ' ' + resp.lastError);
    div.style.color = '#f38ba8';
    details.append(div);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────
function detailLine(label, value) {
  const div = document.createElement('div');
  div.className = 'detail';
  const strong = document.createElement('strong');
  strong.textContent = label;
  div.append(strong, value);
  return div;
}

function timeAgo(ts) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60)   return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)   return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)     return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}


