// Runs in the extension's isolated world (the page world can't reach
// chrome.runtime): asks the background worker to protect this tab, and
// passes a few requests from PokeSurvivor Plus (in the page) to it:
// closing the tab ("Quit") and downloading the tier list.
const ask = (m) => { try { return chrome.runtime.sendMessage(m); } catch (e) { return Promise.reject(e); } };
ask({ psmod: 'nodiscard' }).catch(() => {});
window.addEventListener('message', (e) => {
  const d = e.source === window && e.data;
  if (!d || typeof d.psmodBridge !== 'string') return;
  const answer = (res) => window.postMessage({ psmodBridgeRes: d.psmodBridge, id: d.id, res }, location.origin);
  if (d.psmodBridge === 'closeTab') ask({ psmod: 'closeTab' }).catch(() => {});
  else if (d.psmodBridge === 'tiers') ask({ psmod: 'tiers' }).then((r) => answer(r || { ok: false, err: 'no answer' }), (err) => answer({ ok: false, err: String((err && err.message) || err) }));
});
