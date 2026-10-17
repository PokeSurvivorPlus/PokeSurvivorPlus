// PokeSurvivor Plus background worker.
//  - Keeps game tabs from being discarded by Chrome's memory saver, which
//    reloads the page and drops you out of a co-op run without any message.
//  - "Quit" on the main menu: closes the game tab (a page can't close a tab
//    it didn't open itself).
//  - Tier list badges: downloads the public ranking CSV from SurvivorTiers
//    (survivortiers.pages.dev, by @fildotai). The page itself can't fetch it
//    (different site), so the request is made here.
const TIERS_CSV = 'https://survivortiers.pages.dev/data/ranking.csv';

function parseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
// -> [[dex, rank, tier], ...]
function parseTiers(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  const head = parseCsvLine(lines.shift() || '').map((h) => h.trim().toLowerCase());
  const iDex = head.indexOf('dex'), iRank = head.indexOf('rank'), iTier = head.indexOf('tier');
  if (iDex < 0 || iRank < 0 || iTier < 0) throw new Error('unexpected columns: ' + head.slice(0, 6).join(','));
  const rows = [];
  for (const l of lines) {
    const c = parseCsvLine(l);
    const dex = parseInt(c[iDex], 10), rank = parseInt(c[iRank], 10), tier = String(c[iTier] || '').trim().toUpperCase();
    if (dex > 0 && rank > 0 && /^[SABCDEF]$/.test(tier)) rows.push([dex, rank, tier]);
  }
  if (rows.length < 50) throw new Error('only ' + rows.length + ' rows');
  return rows;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || typeof msg.psmod !== 'string') return;
  const tab = sender.tab && sender.tab.id != null ? sender.tab.id : null;
  if (msg.psmod === 'nodiscard' && tab != null) {
    chrome.tabs.update(tab, { autoDiscardable: false }).catch(() => {});
  } else if (msg.psmod === 'closeTab' && tab != null) {
    chrome.tabs.remove(tab).catch(() => {});
  } else if (msg.psmod === 'tiers') {
    fetch(TIERS_CSV, { cache: 'no-cache', credentials: 'omit' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))))
      .then((t) => reply({ ok: true, rows: parseTiers(t), at: Date.now() }))
      .catch((e) => reply({ ok: false, err: String((e && e.message) || e) }));
    return true; // answer comes later
  }
});
