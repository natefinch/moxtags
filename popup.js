// MoxTags – Popup Script

const statusDot  = document.getElementById('statusDot');
const statusText  = document.getElementById('statusText');
const details     = document.getElementById('details');
const refreshBtn  = document.getElementById('refreshBtn');

// ─── Load status on open ─────────────────────────────────────────────
loadStatus();

refreshBtn.addEventListener('click', () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing…';
  chrome.runtime.sendMessage({ type: 'refreshTags' }, () => {
    // Brief delay so the background has time to start the fetch,
    // then poll until it finishes.
    setTimeout(pollUntilReady, 500);
  });
});

function pollUntilReady() {
  chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
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
  chrome.runtime.sendMessage({ type: 'getStatus' }, (resp) => {
    if (chrome.runtime.lastError || !resp) {
      statusDot.className = 'status-dot error';
      statusText.textContent = 'Cannot reach background worker';
      return;
    }
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

  // Build detail lines.
  let html = '';

  if (resp.tagDataTimestamp) {
    const date = new Date(resp.tagDataTimestamp);
    const ago = timeAgo(resp.tagDataTimestamp);
    html += `<div class="detail"><strong>Last downloaded:</strong> ${ago}</div>`;
    html += `<div class="detail" style="font-size:11px; color:#7f849c;">${date.toLocaleString()}</div>`;
  }

  if (resp.oracleCount != null) {
    html += `<div class="detail"><strong>Oracle IDs indexed:</strong> ${resp.oracleCount.toLocaleString()}</div>`;
  }
  if (resp.illustrationCount != null) {
    html += `<div class="detail"><strong>Illustration IDs indexed:</strong> ${resp.illustrationCount.toLocaleString()}</div>`;
  }

  if (resp.lastError) {
    html += `<div class="detail" style="color:#f38ba8;"><strong>Last error:</strong> ${escapeHtml(resp.lastError)}</div>`;
  }

  details.innerHTML = html;
}

// ─── Helpers ─────────────────────────────────────────────────────────
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

function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}
