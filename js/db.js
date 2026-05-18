/**
 * db.js — Data layer for CJ CPS Dashboard
 *
 * READS:  Direct fetch from published Google Sheet CSV — no auth, no API key
 * WRITES: POST to Google Apps Script web app — no auth, no API key
 *
 * After deploying the Apps Script, paste the web app URL below.
 */

const DB = (() => {
  const SHEET_ID        = '1kfTJd5Kj6FkRdOzYD3RR8Z8VteiJ9kypiPgIw3I2ifE';
  const APPS_SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_URL_HERE';

  // ── READ via Apps Script GET ─────────────────────────────────────────
  async function getActuals() {
    const url = `${APPS_SCRIPT_URL}?action=getActuals&t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load actuals');
    return res.json();
  }

  async function getAdvertisers() {
    const url = `${APPS_SCRIPT_URL}?action=getAdvertisers&t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load advertisers');
    return res.json();
  }

  // ── WRITE via Apps Script POST ───────────────────────────────────────
  async function post(payload) {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Apps Script write failed: ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async function saveActuals(data) {
    return post({ action: 'writeActuals', ...data });
  }

  async function saveAdvertisers(advertisers) {
    return post({ action: 'writeAdvertisers', advertisers });
  }

  async function clearActuals() {
    return post({ action: 'clearActuals' });
  }

  return { getActuals, getAdvertisers, saveActuals, saveAdvertisers, clearActuals };
})();
