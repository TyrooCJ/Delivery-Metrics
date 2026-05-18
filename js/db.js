/**
 * db.js — Data layer for CJ CPS Dashboard
 *
 * READS:  Apps Script GET — no auth, no API key
 * WRITES: Apps Script POST — no auth, no API key
 *
 * After deploying the Apps Script, paste the web app URL below.
 */

const DB = (() => {
  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzlKrLQlsoof12egwgDB5xyNx4hmbnjbqqIZPjtUiAarcrsgc6Doa2gvY1O3SEtXmmd/exec';

  // ── GET helper — redirect:follow required for Apps Script CORS ───────
  async function get(action) {
    const url = `${APPS_SCRIPT_URL}?action=${action}&t=${Date.now()}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Failed to load ${action} (${res.status})`);
    return res.json();
  }

  // ── POST helper ───────────────────────────────────────────────────────
  async function post(payload) {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Apps Script write failed: ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  // ── PUBLIC ────────────────────────────────────────────────────────────
  const getActuals      = ()      => get('getActuals');
  const getAdvertisers  = ()      => get('getAdvertisers');
  const getBlockedCIDs  = ()      => get('getBlockedCIDs').then(d => d.cids || []);
  const addBlockedCIDs  = entries => post({ action: 'addBlockedCIDs', entries });
  const saveActuals     = data    => post({ action: 'writeActuals', ...data });
  const saveAdvertisers = advs    => post({ action: 'writeAdvertisers', advertisers: advs });
  const clearActuals    = ()      => post({ action: 'clearActuals' });

  return { getActuals, getAdvertisers, getBlockedCIDs, addBlockedCIDs, saveActuals, saveAdvertisers, clearActuals };
})();
