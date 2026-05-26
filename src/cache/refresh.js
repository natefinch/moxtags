// Cache — Refresh scheduling via chrome.alarms.

/**
 * Schedule a periodic refresh alarm with random jitter.
 *
 * @param {string} alarmName - Name for the chrome.alarms entry.
 * @param {number} intervalMinutes - Base interval in minutes (e.g., 24 * 60).
 * @param {number} [jitterMinutes] - Random jitter window in minutes (default 60).
 */
export function scheduleRefresh(alarmName, intervalMinutes, jitterMinutes = 60) {
  const jitter = Math.floor(Math.random() * jitterMinutes);
  const delayMinutes = intervalMinutes + jitter;
  chrome.alarms.create(alarmName, { delayInMinutes: delayMinutes });
  return delayMinutes;
}

/**
 * Register a handler for the refresh alarm.
 *
 * @param {string} alarmName - Name of the alarm to listen for.
 * @param {Function} callback - Async function to run when the alarm fires.
 *   Should return a Promise. On success, the alarm is rescheduled.
 *   On failure, a retry is scheduled after `retryMinutes`.
 * @param {Object} [options]
 * @param {number} [options.intervalMinutes] - Reschedule interval (default 24 * 60).
 * @param {number} [options.retryMinutes] - Retry interval on failure (default 60).
 * @param {number} [options.jitterMinutes] - Jitter for rescheduling (default 60).
 */
export function onRefreshAlarm(alarmName, callback, options = {}) {
  const intervalMinutes = options.intervalMinutes || 24 * 60;
  const retryMinutes = options.retryMinutes || 60;
  const jitterMinutes = options.jitterMinutes || 60;

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== alarmName) return;
    callback()
      .then(() => scheduleRefresh(alarmName, intervalMinutes, jitterMinutes))
      .catch(err => {
        console.warn(`[Cache] Scheduled refresh '${alarmName}' failed:`, err.message);
        chrome.alarms.create(alarmName, { delayInMinutes: retryMinutes });
      });
  });
}
