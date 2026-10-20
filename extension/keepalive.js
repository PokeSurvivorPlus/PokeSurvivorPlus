// Runs in the extension's isolated world (the page world can't reach
// the browser's runtime APIs; that's what the `B` shim is for): asks
// the background worker to protect this
// tab, and passes a few requests from PokeSurvivor Plus (in the page) to it:
// closing the tab ("Quit") and downloading the tier list.
/* global browser */
const B = (typeof browser !== 'undefined') ? browser : chrome;
const ask = (m) => { try { return B.runtime.sendMessage(m); } catch (e) { return Promise.reject(e); } };
ask({ psmod: 'nodiscard' }).catch(() => {});
window.addEventListener('message', (e) => {
  const d = e.source === window && e.data;
  if (!d || typeof d.psmodBridge !== 'string') return;
  const answer = (res) => window.postMessage({ psmodBridgeRes: d.psmodBridge, id: d.id, res }, location.origin);
  if (d.psmodBridge === 'closeTab') ask({ psmod: 'closeTab' }).catch(() => {});
  else if (d.psmodBridge === 'tiers') ask({ psmod: 'tiers' }).then((r) => answer(r || { ok: false, err: 'no answer' }), (err) => answer({ ok: false, err: String((err && err.message) || err) }));
});
