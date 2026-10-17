// PokeSurvivor Plus (formerly PokéSurvivor Mod): damage meter (per player and per move), field of view,
// minimap, alerts, run summaries, gacha helpers.
//
// Runs in the page's own JS world at document_start, before the game's
// deferred bundle. The game keeps all its modules (Camera, Net, Coop, Game...)
// on a private object inside a closure, so we catch that object the moment the
// bundle assigns `ns.Camera = {...}` through a one-shot setter on
// Object.prototype.
(() => {
  'use strict';
  if (window.__psmod) return;
  window.__psmod = true;

  const LS = 'psmod:';
  const PLUS_VERSION = '1.0.0';   // keep in step with manifest.json
  const load = (k, d) => { try { const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch {} };

  let NS = null;

  Object.defineProperty(Object.prototype, 'Camera', {
    configurable: true,
    get() { return undefined; },
    set(v) {
      Object.defineProperty(this, 'Camera', { value: v, writable: true, configurable: true, enumerable: true });
      if (NS || !this || !('LIFT' in this) || !('U' in this)) return;
      delete Object.prototype.Camera;
      NS = this;
      window.__psmodNS = NS; // handy for poking around from DevTools
      // Net is assigned later in this same script run, and Coop registers
      // its peer listener right after, so it has to be patched on arrival.
      trapModule('Net', patchNet);
      setupFov(v);
      waitFor(() => NS.Net && NS.Coop && NS.Game, setupMeter);
    },
  });

  function trapModule(name, fn) {
    Object.defineProperty(NS, name, {
      configurable: true,
      enumerable: true,
      get() { return undefined; },
      set(v) {
        Object.defineProperty(NS, name, { value: v, writable: true, configurable: true, enumerable: true });
        try { fn(v); } catch (err) { featFail('module:' + name, err); }
      },
    });
  }

  // ---- safety net
  // Every part of PokeSurvivor Plus that hooks into the game is a "feature".
  // Each waits for the game pieces it needs; if they never show up (the game
  // changed), or setting it up throws, or it keeps failing while drawing,
  // that one feature is switched off, the game carries on as without the
  // extension, and a notice points to Settings → Extras → Status.
  const FEATURE_LABEL = {
    setupVersionTag: 'Version on the menu', endless: 'Endless mode', setupEndless: 'Endless mode',
    setupUpgLayout: 'Upgrades layout and move shortcuts',
    setupSettingsSearch: 'Settings search', settingsSearch: 'Settings search', setupAchSearch: 'Achievement search', achSearch: 'Achievement search',
    setupFriendSearch: 'Friend search', setupUpgSearch: 'Upgrades search',
    setupMeter: 'Damage meter and co-op data', setupHud: 'Redesigned HUD', hud: 'Redesigned HUD (drawing)',
    minimap: 'Minimap', setupSpectate: 'Spectate while down', setupKeepMove: 'Keep your selected attack',
    setupMoveTracking: 'Damage per attack', setupThiefArrow: 'Thief arrows', setupLevelUpPause: 'Pause during level-up',
    setupShinySound: 'Shiny sound', setupRepertorio: 'Repertoire option', translations: 'Translation fixes',
    setupMaxAll: 'Max all upgrades', setupGacha: 'Faster gacha', setupBanners: 'Event banner filter', setupFx: 'Attack effect settings',
    setupFavArrows: 'Favourites on the menu', partyLevels: 'Party levels', setupGear: 'Settings gear icon',
    setupCoopExtras: 'Co-op pause and chat', setupTips: 'HUD tooltips', setupLevelUpSize: 'Level-up screen size',
    setupDexNational: 'National Pokédex', setupExtras: 'Settings tabs', applyCb: 'Colour blind filter',
    setupDexExtras: 'Pokémon search, filters and favourites', setupParty: 'Party on the main menu', setupLogoPlus: 'Logo',
    setupPings: 'Co-op pings', setupDetail: 'Pokémon detail page', setupNews: 'What’s new', setupTour: 'Welcome tour',
    setupAudioPct: 'Audio percentages', pings: 'Co-op pings (drawing)',
    menuItems: 'Stats, Quit and menu layout', setupStatsScreen: 'Stats screen', setupLobbyMenu: 'Room on the main menu', setupDexSort: 'Pokémon sorting', hitboxes: 'Hitboxes', setupFps: 'FPS counter', chestMeter: 'Big chest meter', setupProfile: 'Player profiles', setupGachaLook: 'Gacha buttons', setupSplash: 'Main menu splash text', notif: 'Notification settings', tiers: 'Tier list letters', moveList: 'Learnable moves list',
    chatBubbles: 'Chat over heads', padHints: 'Controller button prompts', setupMusic: 'More music', music: 'More music (playing)',
  };
  const FEATURES = new Map();     // key -> { key, label, status: pending|ok|missing|broken, err }
  // What shows on screen (Settings → Notifications).
  const NOTIF_DEF = { shiny: true, down: true, records: true, conn: true, pad: true, ach: true, rank: true, np: true, mates: true, bosses: true, rift: true, thief: true };
  const notif = Object.assign({}, NOTIF_DEF, (() => { try { return JSON.parse(localStorage.getItem('psmod:notif')) || {}; } catch { return {}; } })());
  const feat = (key) => {
    let f = FEATURES.get(key);
    if (!f) { f = { key, label: FEATURE_LABEL[key] || key, status: 'pending', err: '' }; FEATURES.set(key, f); }
    return f;
  };
  const featOn = (key) => { const f = FEATURES.get(key); return !f || (f.status !== 'broken' && f.status !== 'missing'); };
  let safetyNoticeAt = 0;
  function featFail(key, err, kind = 'broken') {
    const f = feat(key);
    if (f.status === 'broken' || (f.status === 'missing' && kind === 'missing')) return;
    f.status = kind;
    f.err = String((err && err.message) || err || '').slice(0, 200);
    console.warn('[psmod] turned off: ' + f.label, err || '');
    // One notice, a few seconds after things settle.
    clearTimeout(safetyNoticeAt);
    safetyNoticeAt = setTimeout(() => {
      const off = [...FEATURES.values()].filter((x) => x.status === 'broken' || x.status === 'missing');
      if (off.length && typeof toast === 'function') {
        try { toast(`PokeSurvivor Plus turned off ${off.length} feature${off.length > 1 ? 's' : ''}`, '#ffb347', 'The game seems to have changed. The rest keeps working · Settings → Extras → Status'); } catch (_) { /* toasts not ready */ }
      }
    }, 2500);
  }
  function runFeature(key, fn) {
    try { fn(); const f = feat(key); if (f.status !== 'broken') f.status = 'ok'; }
    catch (err) { featFail(key, err); }
  }
  // Errors while drawing: a few are tolerated, a steady stream switches the feature off.
  const trips = new Map();
  function trip(key, err) {
    const now = performance.now(), g = trips.get(key) || { n: 0, t: now };
    if (now - g.t > 10000) { g.n = 0; g.t = now; }
    g.n++;
    trips.set(key, g);
    if (g.n === 1) console.warn('[psmod] ' + (FEATURE_LABEL[key] || key), err);
    if (g.n >= 20) featFail(key, err);
  }
  function waitFor(cond, fn, key) {
    key = key || fn.name || 'setup';
    const f = feat(key), t0 = Date.now();
    let late = false;
    const id = setInterval(() => {
      let ok = false;
      try { ok = !!cond(); } catch (_) { ok = false; }
      if (ok) { clearInterval(id); runFeature(key, fn); return; }
      // The game is up but what this feature needs isn't there.
      if (!late && Date.now() - t0 > 25000 && NS && NS.Game && NS.MenuUI) {
        late = true;
        if (f.status === 'pending') featFail(key, 'Needed game parts not found', 'missing');
      }
    }, 100);
  }
  // Health check: a few seconds after the game is up, the game functions each
  // feature relies on must still be there.
  const API_CHECKS = [
    ['hud', () => NS.HUD.draw && NS.Camera.left && NS.Camera.top && NS.EnemyMgr.all && NS.Icons.draw && NS.Game.player !== undefined],
    ['minimap', () => NS.World.propsInCircle && NS.Pickups.all && NS.EnemyMgr.all && NS.Camera.left],
    ['setupCoopExtras', () => NS.Coop.holdStart && NS.Coop.holdEnd && NS.Net.broadcast && NS.Net.toHost && NS.Net.on],
    ['setupLevelUpPause', () => NS.RunUI.showPause && NS.UI.hide],
    ['setupMaxAll', () => NS.Upgrades.LIST && NS.Upgrades.cost && NS.DB.upgradesOf && NS.DB.commit],
    ['setupFavArrows', () => NS.MenuUI.open && NS.DB.commit && NS.DB.ownsShiny],
    ['translations', () => NS.I18n.add && NS.RunUI.setWaiting],
    ['setupBanners', () => NS.Spawner.say],
    ['setupSpectate', () => NS.Camera.follow && NS.Coop.mates !== undefined],
    ['setupMeter', () => NS.Net.send && NS.Coop.players],
    ['setupPings', () => NS.Net.broadcast && NS.World.specialsNear],
  ];
  function healthCheck() {
    for (const [key, test] of API_CHECKS) {
      let ok = false;
      try { ok = !!test(); } catch (_) { ok = false; }
      if (!ok) featFail(key, 'Game parts it uses were not found', 'missing');
    }
  }
  setTimeout(function startHealth() { waitFor(() => NS && NS.Game && NS.MenuUI && NS.HUD, () => setTimeout(healthCheck, 4000), 'healthCheck'); }, 0);
  const onReady = (fn, key) => {
    const go = () => runFeature(key || fn.name, fn);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  };

  // ---------------------------------------------------------------- FOV
  // Camera.resize() picks scale = min(w / VIEW_W, h / MIN_VIEW_H); scaling
  // both reference sizes up shows proportionally more of the world.
  const FOV_MIN = 1, FOV_MAX = 1.7, FOV_STEP = 0.1;
  let fov = clampFov(load('fov', 1.4));
  let cam = null, baseW = 0, baseH = 0, lastResize = null;

  function clampFov(f) { return Math.round(Math.min(FOV_MAX, Math.max(FOV_MIN, +f || 1)) * 10) / 10; }

  function setupFov(c) {
    cam = c;
    baseW = c.VIEW_W;
    baseH = c.MIN_VIEW_H;
    const orig = c.resize;
    c.resize = function (...args) { lastResize = args; return orig.apply(this, args); };
    applyFov();
  }

  function setFov(f) { fov = clampFov(f); applyFov(); }

  function applyFov() {
    cam.VIEW_W = baseW * fov;
    cam.MIN_VIEW_H = baseH * fov;
    if (lastResize) cam.resize(...lastResize);
    save('fov', fov);
    renderFov();
  }

  // ----------------------------------------------------------------- HUD
  // The game paints its HUD (name, HP, buffs, move slots, arrows) on the main
  // canvas with HUD.draw(ctx, width, height, player, team), in CSS pixels. We
  // scale the context and hand it a proportionally smaller width/height, so
  // everything grows and stays anchored to the same edges. The off-screen
  // arrows place themselves with Camera.scale, which we shrink by the same
  // factor for the duration of the call. The clickable areas (move slots...)
  // are registered from inside draw with Touch.addButton in HUD coordinates
  // and hit-tested against clientX/Y, so we scale those up by the same factor.
  // Touch screens keep the original size.
  const HUD_MIN = 1, HUD_MAX = 2;
  const clampHud = (v) => Math.round(Math.min(HUD_MAX, Math.max(HUD_MIN, +v || 1)) * 10) / 10;
  let hudScale = clampHud(load('hudScale', 1.4));

  function setHudScale(v) { hudScale = clampHud(v); save('hudScale', hudScale); renderHud(); }
  function renderHud() { refreshExtras(); }

  // 'new' = the mod's redesigned HUD, 'classic' = the game's own (scaled).
  let hudStyle = load('hudStyle', 'new');

  function setupHud() {
    const H = NS.HUD;
    const draw = H.draw;
    const T = NS.Touch;
    let btnK = 1, dropButtons = false;
    if (T && T.addButton) {
      const add = T.addButton;
      T.addButton = function (x, y, w, h, fn, pad = 6) {
        // The game's own move-slot buttons are replaced by ours in the new HUD.
        if (dropButtons) return;
        if (btnK === 1) return add.apply(this, arguments);
        return add.call(this, x * btnK, y * btnK, w * btnK, h * btnK, fn, pad * btnK);
      };
    }
    H.draw = function (ctx, w, h, pl) {
      const touch = !!(NS.Touch && NS.Touch.active);
      const k = touch ? 1 : hudScale;
      const C = NS.Camera, cs = C.scale;
      const fresh = !touch && hudStyle === 'new' && pl && pl.slots && featOn('hud');
      if (!fresh) hudHits = [];
      ctx.save();
      if (k !== 1) { ctx.scale(k, k); C.scale = cs / k; }
      btnK = k;
      try {
        const args = Array.prototype.slice.call(arguments);
        const W = w / k, Hh = h / k;
        args[1] = W; args[2] = Hh;
        // Where the minimap sits, in HUD coordinates, so arrows avoid it.
        mapHud = null;
        try {
          if (mapEl && !mapEl.classList.contains('psmod-hidden') && ctx.canvas) {
            const cr = ctx.canvas.getBoundingClientRect(), mr = mapEl.getBoundingClientRect();
            if (cr.width > 0 && mr.width > 0) {
              const f = w / cr.width / k;
              mapHud = { x: (mr.left - cr.left) * f, y: (mr.top - cr.top) * f, w: mr.width * f, h: mr.height * f };
            }
          }
        } catch (_) { mapHud = null; }
        if (!fresh) {
          const out = draw.apply(this, args);
          if (!touch && pl && pl.slots) drawSlotLevels(ctx, W, Hh, pl);
          if (pl && pings.length) { arrowSpots = []; try { drawPings(ctx, W, Hh, pl, 0, performance.now() / 1000); } catch (err) { trip('pings', err); } }
          if (bubbles.size) try { drawChatBubbles(ctx, W, Hh); } catch (err) { trip('chatBubbles', err); }
          try { drawWorldExtras(ctx, W, Hh, pl); } catch (err) { trip('hitboxes', err); }
          return out;
        }
        // New HUD: let the game draw everything except the parts we redraw.
        // Teammates are hidden from the game for this one call, so it skips
        // its co-op list and arrows (ours avoid the team cards).
        ctx.save();
        // One clip per area (clips intersect), so overlapping areas stay
        // hidden; a single even-odd path would show their overlap again.
        for (const r of replacedAreas(W, Hh, pl)) {
          ctx.beginPath();
          ctx.rect(0, 0, W, Hh);
          ctx.rect(r[0], r[1], r[2], r[3]);
          ctx.clip('evenodd');
        }
        dropButtons = true;
        hudFresh = true;
        const riftDesc = NS.Rift && Object.getOwnPropertyDescriptor(NS.Rift, 'rift');
        if (riftDesc && riftDesc.configurable) Object.defineProperty(NS.Rift, 'rift', { configurable: true, get: () => null });
        const hidden = [];
        if (NS.Coop && NS.Coop.active) for (const m of NS.Coop.mates) if (m.connected) { m.connected = false; hidden.push(m); }
        let out;
        try { out = draw.apply(this, args); } finally {
          for (const m of hidden) m.connected = true;
          dropButtons = false;
          hudFresh = false;
          if (riftDesc && riftDesc.configurable) Object.defineProperty(NS.Rift, 'rift', riftDesc);
          ctx.restore();
        }
        hudHitK = k;
        try { drawNewHud(ctx, W, Hh, pl); } catch (err) { trip('hud', err); }
        return out;
      } finally {
        btnK = 1;
        dropButtons = false;
        C.scale = cs;
        ctx.restore();
      }
    };
  }

  // Where the game draws what the new HUD replaces (from the game's HUD
  // layout): the XP strip on top, name / HP / boosts top-left, the weather
  // chip top-right, the boss bar, the "you're down" message, and the move bar
  // with the item slot, bond icon and active move's name.
  function replacedAreas(W, H, pl) {
    const out = [[0, 0, W, 8], [0, 8, 300, 74], [W - 320, 8, 320, 40], [W / 2 - 240, 14, 480, 50]];
    if (NS.Rift && NS.Rift.inArena) out.push([W / 2 - 160, 62, 320, 20]);
    const boss = NS.EnemyMgr && NS.EnemyMgr.all().some((e) => e.boss && !e.dead);
    if (boss) {
      const bw = Math.min(420, W - 80);
      out.push([(W - bw) / 2 - 6, 64, bw + 12, 22]);
      if (NS.Rift && NS.Rift.inArena) out.push([W / 2 - 160, 84, 320, 18]);
    }
    if (pl.dead) out.push([W / 2 - 320, H * 0.62 - 32, 640, 58]);
    const S = 54, GAP = 9, n = Math.max(1, pl.slots.length);
    const tw = n * S + (n - 1) * GAP, sx = (W - tw) / 2, sy = H - S - 18;
    const x0 = sx - S - 22, x1 = sx + tw + 80;
    out.push([x0, sy - 30, x1 - x0, H - sy + 30]);
    return out;
  }

  // ---- portraits (SpriteCollab, the same source as the game's sprites)
  // Emotions: Normal, plus Pain (just took a real hit) and Dizzy (down)
  // when the Pokémon has them; otherwise Normal is used.
  const PORTRAIT_BASE = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/portrait/';
  const portraits = new Map();
  function loadPortrait(dex, shiny, emo) {
    const key = `${dex}|${shiny ? 1 : 0}|${emo}`;
    let p = portraits.get(key);
    if (!p) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      p = { img, ok: false, bad: false };
      const tries = shiny ? [true, false] : [false];
      let i = 0;
      const next = () => {
        if (i >= tries.length) { p.bad = true; return; }
        img.src = PORTRAIT_BASE + String(dex).padStart(4, '0') + (tries[i++] ? '/0000/0001' : '') + '/' + emo + '.png';
      };
      img.onload = () => { p.ok = true; };
      img.onerror = next;
      next();
      portraits.set(key, p);
    }
    return p;
  }
  // Many Pokémon only have some faces in SpriteCollab: the closest one that
  // exists stands in (tried one after another, only when the last is missing).
  const EMO_ALT = {
    Pain: ['Pain', 'Stunned', 'Shouting', 'Teary-Eyed', 'Crying', 'Surprised', 'Worried', 'Sad'],
    Angry: ['Angry', 'Determined', 'Shouting'],
    Dizzy: ['Dizzy', 'Stunned', 'Pain', 'Sad'],
  };
  function emoImg(dex, shiny, emo) {
    for (const e of EMO_ALT[emo] || [emo]) {
      const p = loadPortrait(dex, shiny, e);
      if (p.ok) return p.img;
      if (!p.bad) return null;        // still loading: try the next one only if it's missing
    }
    return null;
  }
  // No face for it at all.
  const noEmo = (dex, shiny, emo) => (EMO_ALT[emo] || [emo]).every((e) => loadPortrait(dex, shiny, e).bad);
  function portraitImg(dex, shiny, emo = 'Normal') {
    if (!dex) return null;
    if (emo !== 'Normal') { const img = emoImg(dex, shiny, emo); if (img) return img; }
    const n = loadPortrait(dex, shiny, 'Normal');
    return n.ok ? n.img : null;
  }
  // Pain for a moment after losing health, Dizzy while down.
  const hurtUntil = new Map(), lastHp = new Map();
  function emotionFor(key, dex, shiny, hp, dead, maxHp) {
    if (dex) { emoImg(dex, shiny, 'Pain'); emoImg(dex, shiny, 'Dizzy'); }
    const now = performance.now();
    const prev = lastHp.get(key);
    lastHp.set(key, hp);
    if (dead) return 'Dizzy';
    // A real hit (not a health-drain tick or a co-op health correction).
    // maxHp 0 (bosses): any damage at all.
    const thr = maxHp ? Math.max(1, maxHp * 0.04) : 0;
    if (prev != null && hp < prev - thr) hurtUntil.set(key, now + 550);
    return (hurtUntil.get(key) || 0) > now ? 'Pain' : 'Normal';
  }

  // A boss is enraged below half health (the game sets ai.fury on the host;
  // other players don't get that flag, so the same rule stands in).
  const isEnraged = (e) => !!e && !!e.boss && (e.ai ? !!e.ai.fury : e.hp < (e.maxHp || 1) * 0.5);

  // ---- drawing helpers
  const HF = (wt, s) => `${wt} ${s}px Pixelify,"Segoe UI",system-ui,sans-serif`;
  const INK = '#0b1838', EDGE = '#e8eef8';
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Framed box: dark outline, light edge, filled inside.
  function frame(ctx, x, y, w, h, r, fill, edge = EDGE, lw = 2) {
    rr(ctx, x - 1.5, y - 1.5, w + 3, h + 3, r + 1.5);
    ctx.fillStyle = INK; ctx.fill();
    rr(ctx, x, y, w, h, r);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = lw; ctx.strokeStyle = edge; ctx.stroke();
  }
  // ---- bar look (Settings → Extras → Bars)
  const BAR_DEF = { hp: 'red', mate: 'red', boss: 'default', xp: 'blue', style: 'classic', hpNum: 'values', xpNum: 'off', bossNum: true, hpSize: 'normal', xpSize: 'normal' };
  const barSet = Object.assign({}, BAR_DEF, load('bars', {}));
  const BAR_COL = { red: '#e83a4a', green: '#46c96a', yellow: '#ffd23f', orange: '#ff8c3a', pink: '#ff6fb0', cyan: '#3ec8e8', blue: '#3f8cff', purple: '#a46bff' };
  const BAR_SIZE = { thin: 0.7, normal: 1, thick: 1.35 };
  const barK = (which) => BAR_SIZE[barSet[which]] || 1;
  // Colour for a health bar: a preset, the player's own colour, or by
  // health left (green → yellow → red).
  function hpColor(choice, frac, own) {
    if (choice === 'rainbow') return 'rainbow';
    if (choice === 'auto') return frac > 0.5 ? BAR_COL.green : frac > 0.25 ? BAR_COL.yellow : BAR_COL.red;
    if (choice === 'player') return own || BAR_COL.red;
    return BAR_COL[choice] || BAR_COL.red;
  }
  function shade(hex, amt) {
    const n = parseInt(String(hex).slice(1), 16);
    if (isNaN(n)) return hex;
    const f = (c) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt))));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => f(c).toString(16).padStart(2, '0')).join('');
  }
  // The filled part of a bar in the chosen style. `paint` (optional) is what
  // the classic / flat / segmented styles fill with (e.g. a gradient).
  function fillBar(ctx, x, y, w, h, frac, col, paint, segEvery = 0) {
    const fw = Math.round(w * Math.max(0, Math.min(1, frac || 0)));
    const style = barSet.style;
    const t = reduceMotion ? 0 : performance.now() / 1000;
    if (col === 'rainbow') {
      // Hues sliding along the bar.
      const g = ctx.createLinearGradient(x, 0, x + Math.max(w, 60), 0);
      for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${Math.round((t * 90 + i * 60) % 360)},85%,58%)`);
      paint = g;
      col = '#ff6fb0';
    }
    if (fw > 0) {
      if (style === 'gradient' && paint && typeof paint !== 'string' && col === '#ff6fb0') {
        ctx.fillStyle = paint; ctx.fillRect(x, y, fw, h);
        const sh = ctx.createLinearGradient(0, y, 0, y + h);
        sh.addColorStop(0, 'rgba(255,255,255,.45)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(0,0,0,.3)');
        ctx.fillStyle = sh;
      } else if (style === 'gradient') {
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, shade(col, 0.45)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.35));
        ctx.fillStyle = g;
      } else ctx.fillStyle = paint || col;
      ctx.fillRect(x, y, fw, h);
      if (style === 'classic' || style === 'segmented' || style === 'moving') {
        ctx.fillStyle = 'rgba(255,255,255,.28)';
        ctx.fillRect(x, y, fw, Math.max(1, Math.round(h * 0.25)));
      }
      if (style === 'moving') {
        // Diagonal stripes scrolling along the filled part.
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, fw, h); ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,.22)';
        const sw = Math.max(6, h * 1.2), off = (t * 28) % (sw * 2);
        for (let sx = x - h - sw * 2 + off; sx < x + fw + h; sx += sw * 2) {
          ctx.beginPath();
          ctx.moveTo(sx, y + h); ctx.lineTo(sx + h, y); ctx.lineTo(sx + h + sw, y); ctx.lineTo(sx + sw, y + h);
          ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
    }
    // Segments: every 10% (segmented style), or the bar's own marks (classic).
    const step = style === 'segmented' ? w / 10 : style === 'classic' ? segEvery : 0;
    if (step >= 4) {
      ctx.fillStyle = 'rgba(11,24,56,.6)';
      for (let sx = x + step; sx < x + w - 1; sx += step) ctx.fillRect(Math.round(sx), y, Math.max(1, Math.round(h / 6)), h);
    }
  }
  function bar(ctx, x, y, w, h, frac, col, back) {
    rr(ctx, x - 1.5, y - 1.5, w + 3, h + 3, 2.5);
    ctx.fillStyle = INK; ctx.fill();
    ctx.fillStyle = back;
    ctx.fillRect(x, y, w, h);
    fillBar(ctx, x, y, w, h, frac, col);
  }
  // Small rounded tag, returns its width.
  function pill(ctx, x, y, text, fg = '#fff', bg = INK, edge = EDGE, size = 8) {
    ctx.font = HF(700, size);
    const tw = Math.ceil(ctx.measureText(text).width) + 10, th = size + 5;
    rr(ctx, x, y, tw, th, th / 2);
    ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = 1.25; ctx.strokeStyle = edge; ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 5, y + th / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';
    return tw;
  }
  function outlined(ctx, text, x, y, fill, lw = 3) {
    ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(11,24,56,.9)'; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }
  function drawPortrait(ctx, x, y, size, dex, shiny, color, name, emo = 'Normal', down = false, edgeCol = null) {
    const ec = down ? '#ff5f6d' : edgeCol || EDGE;
    frame(ctx, x, y, size, size, 5, 'rgba(18,34,74,.95)', ec);
    rr(ctx, x + 2, y + 2, size - 4, size - 4, 3.5);
    ctx.fillStyle = color ? color + '55' : 'rgba(95,200,255,.3)';
    ctx.fill();
    const img = portraitImg(dex, shiny, emo);
    ctx.save();
    rr(ctx, x + 2, y + 2, size - 4, size - 4, 3.5);
    ctx.clip();
    if (img) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, x + 2, y + 2, size - 4, size - 4);
    } else {
      ctx.font = HF(800, Math.round(size * 0.45));
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(String(name || '?').charAt(0).toUpperCase(), x + size / 2, y + size * 0.66);
    }
    if (down) { ctx.fillStyle = 'rgba(120,10,30,.28)'; ctx.fillRect(x, y, size, size); }
    else if (emo === 'Pain') {
      // A Pokémon with no hurt face at all gets a stronger red flash instead.
      ctx.fillStyle = dex && noEmo(dex, shiny, 'Pain') ? 'rgba(255,40,60,.42)' : 'rgba(255,60,80,.18)';
      ctx.fillRect(x, y, size, size);
    }
    ctx.restore();
    rr(ctx, x, y, size, size, 5);
    ctx.lineWidth = 2; ctx.strokeStyle = ec; ctx.stroke();
  }
  // Portrait inside a circle (arrows, boss plate).
  function roundPortrait(ctx, cx, cy, r, dex, shiny, emo, edge, back) {
    ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = back; ctx.fill();
    const img = portraitImg(dex, shiny, emo);
    if (img) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r - 1, 0, Math.PI * 2); ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
    }
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 2; ctx.strokeStyle = edge; ctx.stroke();
    return !!img;
  }

  const BOOST = [
    ['atk', 'ATK', '#ff5f6d', '#5a1620'],
    ['def', 'DEF', '#7fb4ff', '#16305a'],
    ['spd', 'SPE', '#c9d3e6', '#2e3a52'],
    ['regen', 'REG', '#5fe08a', '#163d26'],
  ];

  // Hover areas for the tooltips (HUD coordinates; × hudHitK = CSS pixels).
  let hudHits = [], hudHitK = 1;

  function drawNewHud(ctx, W, H, pl) {
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    const T = NS.Touch, U = NS.U || {};
    const TYPE = U.TYPE_COLOR || {};
    const Icons = NS.Icons;
    const team = NS.Coop && NS.Coop.active;
    const myColor = pl.tagColor || '#5fc8ff';
    const now = performance.now(), t = now / 1000;
    const hits = [];

    // ---------- clock: time, biome, and what this run has collected ----------
    let clockBottom = 64;
    try { clockBottom = drawClockPanel(ctx, W, pl); } catch (err) { trip('hud', err); }
    // ---------- weather, under the clock ----------
    const wx = NS.Weather && NS.Weather.current;
    let underClock = clockBottom + 4;
    if (wx && wx.name) {
      ctx.font = HF(700, 9);
      const text = `${String(tr(wx.name)).toUpperCase()} · ${Math.ceil(wx.left || 0)}s`;
      const th = 15, tw = Math.ceil(ctx.measureText(text).width) + 28, tx = Math.round((W - tw) / 2), ty = clockBottom + 4;
      rr(ctx, tx, ty, tw, th, th / 2);
      ctx.fillStyle = 'rgba(11,24,56,.85)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = wx.color || EDGE; ctx.stroke();
      if (Icons && wx.icon) Icons.draw(ctx, wx.icon, tx + 5, ty + 2, 11);
      ctx.fillStyle = wx.color || '#fff';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(text, tx + 20, ty + th / 2 + 0.5);
      ctx.textBaseline = 'alphabetic';
      underClock = ty + th + 5;
      hits.push({ x: tx, y: ty, w: tw, h: th, kind: 'weather' });
    }

    // ---------- bosses ----------
    const bosses = NS.EnemyMgr ? NS.EnemyMgr.all().filter((e) => e.boss && !e.dead).slice(0, 2) : [];
    let bossY = underClock;
    bosses.forEach((e, i) => { bossY += drawBoss(ctx, W, bossY, e, i > 0, now) + 6; });

    // ---------- treasure thieves (Meowth / Gholdengo) ----------
    const thieves = trackThieves(now);
    bossY = drawThiefTags(ctx, W, bossY, thieves, now);
    // An open rift only gets its arrow (the card under the clock is gone).
    const rift = currentRift();

    // ---------- teammates, top-left ----------
    let cardsBottom = 0;
    if (team) {
      let y = 10;
      for (const m of NS.Coop.mates) {
        if (!m.connected || !m.pl) continue;
        const o = m.pl, net = o.net || {};
        const dead = !!(net.dead || o.dead);
        const hp = net.hp != null ? net.hp : o.hp, max = net.maxHp || o.maxHp || 1;
        const mon = o.mon || {};
        const emo = emotionFor('mate:' + m.uid, mon.dex, o.shiny, hp, dead, max);
        drawPortrait(ctx, 10, y, 36, mon.dex, o.shiny, m.color, mon.name, emo, dead);
        ctx.font = HF(800, 10);
        ctx.textAlign = 'left';
        outlined(ctx, m.name, 52, y + 9, m.color);
        // Typing, right after the name.
        // (The game draws icons at whole multiples of their 16 px art.)
        let tx = 52 + Math.ceil(ctx.measureText(m.name).width) + 5;
        if (Icons) for (const ty of (mon.types || []).slice(0, 2)) { Icons.draw(ctx, 'type:' + ty, tx, y - 4, 16); tx += 18; }
        const mh = Math.max(3, Math.round(6 * barK('hpSize')));
        bar(ctx, 52, y + 17 - mh / 2, 132, mh, dead ? 0 : hp / max, hpColor(barSet.mate, hp / max, m.color), 'rgba(60,12,20,.9)');
        // Held item (known when they and the host have the mod).
        const mi = (rows.get(m.uid) || {}).item;
        if (mi && Icons) {
          frame(ctx, 190, y + 4, 22, 22, 5, 'rgba(40,30,10,.92)', '#ffd23f', 1.5);
          Icons.draw(ctx, mi, 193, y + 7, 16);
          hits.push({ x: 190, y: y + 4, w: 22, h: 22, kind: 'mateItem', item: mi });
        }
        let px = 52;
        px += pill(ctx, px, y + 24, 'Lvl. ' + (pl.level || 1)) + 4;
        if (dead) pill(ctx, px, y + 24, 'DOWN', Math.sin(t * 8) > 0 ? '#ff8a96' : '#fff', '#5a1620', '#ff5f6d');
        else if (mon.name) pill(ctx, px, y + 24, mon.name);
        y += 46;
      }
      cardsBottom = y - 6;
    }

    // ---------- bottom block ----------
    const S = 50, GAP = 8, LIFT = 5;
    const n = Math.max(1, pl.slots.length, pl.maxMoves || 0);
    const itemW = pl.item ? 40 + GAP : 0;
    const groupW = S + GAP + n * S + (n - 1) * GAP + itemW;
    const x0 = Math.round((W - groupW) / 2);
    const XPH = Math.round(7 * barK('xpSize'));
    const HPH = Math.round(13 * barK('hpSize'));
    const rowY = Math.round(H - XPH - 18 - S);
    const hpY = rowY - LIFT - 8 - HPH;

    // EXP strip along the bottom edge.
    const xpF = Math.max(0, Math.min(1, pl.xpNext ? pl.xp / pl.xpNext : 0));
    ctx.fillStyle = INK;
    ctx.fillRect(0, H - XPH - 2, W, XPH + 2);
    ctx.fillStyle = 'rgba(20,40,90,.95)';
    ctx.fillRect(0, H - XPH, W, XPH);
    let xpPaint = null;
    const xpCol = barSet.xp === 'rainbow' ? 'rainbow' : barSet.xp === 'blue' ? '#3aa6ff' : BAR_COL[barSet.xp] || '#3aa6ff';
    if (barSet.xp === 'blue') { xpPaint = ctx.createLinearGradient(0, 0, W, 0); xpPaint.addColorStop(0, '#2f8cff'); xpPaint.addColorStop(1, '#4fd1ff'); }
    fillBar(ctx, 0, H - XPH, W, XPH, xpF, xpCol, xpPaint, 40);
    if (barSet.xpNum !== 'off' && pl.xpNext) {
      const pctTxt = Math.floor(xpF * 100) + '%';
      const text = barSet.xpNum === 'level' ? `LV ${pl.level || 1} · ${pctTxt}` : pctTxt;
      ctx.textAlign = 'right';
      if (XPH >= 10) { ctx.font = HF(800, XPH - 2); outlined(ctx, text, W - 8, H - 2, '#fff', 2); }
      else { ctx.font = HF(800, 8); outlined(ctx, text, W - 8, H - XPH - 5, '#cfe6ff', 2.5); }
    }

    // Boost chips (ATK / DEF / SPE / REG × stacks) and the altar power.
    let cx = x0;
    ctx.textAlign = 'left';
    for (const [key, label, fg, bg] of BOOST) {
      const b = pl.buffs && pl.buffs[key];
      if (!b || !(b.n > 0)) continue;
      cx += pill(ctx, cx, hpY - 16, `${label} ${b.n}x`, '#fff', bg, fg) + 4;
    }
    if (pl.power && pl.power.def) {
      cx += pill(ctx, cx, hpY - 16, `${String(tr(pl.power.def.name)).toUpperCase()} ${Math.ceil(pl.power.t)}s`, pl.power.def.color || '#fff') + 4;
    }

    // Active move's name, right end of the same line.
    const act = pl.slots[pl.active] || [];
    if (act[0]) {
      const fusedAct = act.length > 1;
      ctx.font = HF(800, 10);
      ctx.textAlign = 'right';
      outlined(ctx, fusedAct ? tr(act[0].name) + ' +' + (act.length - 1) : tr(act[0].name), x0 + groupW, hpY - 6, fusedAct ? '#ff8ad8' : TYPE[act[0].type] || '#fff');
    }

    // HP bar across the whole block.
    const hpF = Math.max(0, pl.hp) / (pl.maxHp || 1);
    bar(ctx, x0, hpY, groupW, HPH, hpF, hpColor(barSet.hp, hpF, myColor), 'rgba(60,12,20,.92)');
    if (barSet.hpNum !== 'off') {
      ctx.font = HF(800, Math.max(7, Math.min(11, HPH - 4)));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const text = barSet.hpNum === 'percent' ? Math.ceil(hpF * 100) + '%' : `${Math.ceil(Math.max(0, pl.hp))}/${Math.round(pl.maxHp)}`;
      outlined(ctx, text, x0 + groupW / 2, hpY + HPH / 2 + 1, '#fff', 2.5);
      ctx.textBaseline = 'alphabetic';
    }

    // Your portrait and level.
    const myDex = pl.mon && pl.mon.dex;
    const myEmo = emotionFor('me', myDex, pl.shiny, pl.hp, !!pl.dead, pl.maxHp);
    drawPortrait(ctx, x0, rowY, S, myDex, pl.shiny, myColor, pl.mon && pl.mon.name, myEmo, !!pl.dead);
    ctx.font = HF(700, 8);
    const lvl = 'Lvl. ' + (pl.level || 1);
    const lw = Math.ceil(ctx.measureText(lvl).width) + 10;
    pill(ctx, x0 + (S - lw) / 2, rowY + S - 2, lvl);

    // Move slots.
    const BOND = '#ff8ad8';
    const cdOf = (m) => (m.kind === 'orbit' ? 0 : Math.max(0, Math.min(1, m.t / (m.cd * (pl.cdMul || 1)))));
    for (let i = 0; i < n; i++) {
      const grp = pl.slots[i] || [];
      const m = grp[0];
      const fused = grp.length > 1;
      const on = i === pl.active && !!m;
      const x = x0 + S + GAP + i * (S + GAP);
      const y = on ? rowY - LIFT : rowY;
      const col = m ? TYPE[m.type] || '#8fa3c4' : '#4a5468';
      if (!m) {
        frame(ctx, x, y, S, S, 6, 'rgba(10,16,32,.55)', 'rgba(232,238,248,.3)', 1.5);
        continue;
      }
      hits.push({ x, y, w: S, h: S, kind: 'move', slot: i });
      if (T && T.addButton) T.addButton(x, y, S, S, () => { if (NS.Game.state === 'playing' && pl.active !== i) { pl.setActive(i); try { NS.Audio.sfx('click'); } catch {} } }, GAP / 2 + 2);
      frame(ctx, x, y, S, S, 6, on ? 'rgba(22,36,74,.97)' : 'rgba(12,20,40,.92)', fused ? BOND : m.evolved ? '#ffd23f' : on ? col : EDGE, on || fused || m.evolved ? 2.5 : 2);
      if (fused) {
        const Cc = 20, P = (S - Cc * 2) / 3;
        grp.forEach((gm, j) => {
          const ix = x + P + (j % 2) * (Cc + P), iy = y + P + Math.floor(j / 2) * (Cc + P);
          if (Icons) Icons.draw(ctx, 'move:' + gm.id, ix, iy, Cc);
          const f = cdOf(gm);
          if (f > 0) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(ix, iy, Cc, Cc * f); }
          ctx.font = HF(800, 7);
          ctx.textAlign = 'right';
          outlined(ctx, gm.evolved ? '★' : String(gm.lvl), ix + Cc + 1, iy + Cc, gm.evolved || gm.lvl >= ((gm.def && gm.def.maxLvl) || 5) ? '#ffd23f' : '#fff', 2);
        });
      } else {
        const f = cdOf(m);
        if (f > 0) {
          ctx.save();
          rr(ctx, x, y, S, S, 6); ctx.clip();
          ctx.fillStyle = 'rgba(0,0,0,.55)';
          ctx.fillRect(x, y, S, S * f);
          ctx.restore();
        }
        const fl = 1 - (now - (m.castAt || 0)) / 180;
        if (Icons) Icons.draw(ctx, 'move:' + m.id, x + (S - 28) / 2, y + (S - 28) / 2 - 1, 28);
        if (fl > 0) { ctx.save(); rr(ctx, x, y, S, S, 6); ctx.clip(); ctx.fillStyle = `rgba(255,255,255,${(fl * 0.4).toFixed(2)})`; ctx.fillRect(x, y, S, S); ctx.restore(); }
        // Level: number top-right and dots along the bottom.
        const max = (m.def && m.def.maxLvl) || 5;
        ctx.font = HF(800, 8);
        ctx.textAlign = 'right';
        outlined(ctx, m.evolved ? '★' : String(m.lvl), x + S - 4, y + 10, m.evolved || m.lvl >= max ? '#ffd23f' : '#fff', 2);
        const dw = 4, dg = 2, tw = max * dw + (max - 1) * dg;
        for (let d = 0; d < max; d++) {
          ctx.fillStyle = d < m.lvl ? col : 'rgba(255,255,255,.18)';
          ctx.fillRect(x + (S - tw) / 2 + d * (dw + dg), y + S - 7, dw, 3);
        }
      }
      ctx.font = HF(800, 8);
      ctx.textAlign = 'left';
      const padCode = showPadLabels() && binds['slot' + (i + 1)] && binds['slot' + (i + 1)][2];
      if (padCode) drawPadBadge(ctx, padCode, x + 2, y + 2, on);
      else outlined(ctx, slotLabel(i), x + 4, y + 10, fused ? BOND : on ? col : 'rgba(200,215,240,.85)', 2);
    }

    // Held item, after the moves.
    if (pl.item) {
      const ix = x0 + S + GAP + n * (S + GAP), iy = rowY + (S - 40) / 2;
      frame(ctx, ix, iy, 40, 40, 6, 'rgba(40,30,10,.92)', '#ffd23f');
      if (Icons) Icons.draw(ctx, pl.item, ix + 5, iy + 5, 30);
      hits.push({ x: ix, y: iy, w: 40, h: 40, kind: 'item' });
    }
    // Unused bonds.
    if (pl.bonds > 0 && Icons) {
      const bx = x0 + groupW + 10, by = rowY + S / 2 - 12;
      Icons.draw(ctx, 'bond', bx, by, 24);
      if (pl.bonds > 1) { ctx.font = HF(800, 10); ctx.textAlign = 'left'; outlined(ctx, '×' + pl.bonds, bx + 25, by + 20, BOND, 2); }
    }

    // Spectating: a tag above your HUD.
    const sm = specTarget();
    if (sm) {
      const many = specCandidates().length > 1;
      const keyL = (id) => { const b = binds[id] || []; return showPadLabels() && b[2] ? bareName(b[2]) : keyName(b[0]); };
      const text = `SPECTATING ${String(sm.name).toUpperCase()}${many ? ` · ${keyL('prev')}/${keyL('next')} TO SWITCH` : ''}${!NS.Coop.isHost && !hostHasPlus ? ' · LIMITED VIEW' : ''}`;
      ctx.font = HF(800, 9);
      const tw = Math.ceil(ctx.measureText(text).width) + 18, th = 16, tx = Math.round((W - tw) / 2), ty = hpY - 40;
      rr(ctx, tx, ty, tw, th, th / 2);
      ctx.fillStyle = 'rgba(11,24,56,.9)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = sm.color || EDGE; ctx.stroke();
      ctx.fillStyle = sm.color || '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, W / 2, ty + th / 2 + 0.5);
      ctx.textBaseline = 'alphabetic';
    }

    arrowSpots = [];
    try { drawWorldExtras(ctx, W, H, pl); } catch (err) { trip('hitboxes', err); }
    drawBossArrows(ctx, W, H, pl, cardsBottom, t);
    drawThiefArrows(ctx, W, H, pl, cardsBottom, t, thieves, now);
    drawRiftArrow(ctx, W, H, pl, cardsBottom, t, rift);
    try { drawPings(ctx, W, H, pl, cardsBottom, t); } catch (err) { trip('pings', err); }
    if (bubbles.size) try { drawChatBubbles(ctx, W, H); } catch (err) { trip('chatBubbles', err); }
    if (team) {
      drawMateArrows(ctx, W, H, pl, cardsBottom, t);
      drawReviving(ctx, W, hpY - 32, t);
      if (pl.dead) drawDowned(ctx, W, H, pl, t);
    }
    hudHits = hits;
    ctx.restore();
  }

  // ---- boss plate
  // A dark plate with a framed portrait, the name, a BOSS / LEGENDARY tag
  // and a health bar with a lingering "damage taken" trail and a white flash
  // on each hit. Glows red below 25%. Returns its height.
  const bossFx = new Map();
  function drawBoss(ctx, W, y, e, small, now) {
    const legend = !!(e.legend || e.judge || (NS.Rift && NS.Rift.inArena));
    const th = legend
      ? { edge: '#d7b8ff', glow: 'rgba(155,92,255,.85)', a: '#c99bff', b: '#7a3cff', plate: ['#2a1550', '#120824'], tag: 'LEGENDARY', tagBg: '#4b2a85', tagFg: '#f0e2ff' }
      : { edge: '#ffd23f', glow: 'rgba(255,120,60,.8)', a: '#ff7a4d', b: '#d81e3c', plate: ['#40121b', '#19070c'], tag: 'BOSS', tagBg: '#7a1626', tagFg: '#ffe7a0' };
    const bw = Math.min(small ? 240 : 320, W - 160), bh = small ? 19 : 24;
    const x = Math.round((W - bw) / 2);
    const R = small ? 10 : 14;
    const frac = Math.max(0, Math.min(1, e.hp / (e.maxHp || 1)));

    let st = bossFx.get(e.id);
    if (!st) { st = { trail: e.hp, last: e.hp, flash: 0, hold: 0, at: now }; bossFx.set(e.id, st); }
    // Short pause only on the first hit after a quiet moment; under steady
    // damage the trail keeps shrinking right behind the bar.
    if (e.hp < st.last) { if (st.trail <= st.last + 0.5) st.hold = now + 160; st.flash = 1; }
    st.last = e.hp;
    if (now > st.hold) st.trail -= Math.max((st.trail - e.hp) * 0.14, (e.maxHp || 1) * 0.003);
    if (st.trail < e.hp) st.trail = e.hp;
    st.flash = Math.max(0, st.flash - 0.07);
    st.at = now;
    if (bossFx.size > 8) for (const [id, s] of bossFx) if (now - s.at > 5000) bossFx.delete(id);

    const low = frac < 0.25;
    const pulse = 0.5 + 0.5 * Math.sin(now / 110);
    // Plate with glow.
    ctx.save();
    ctx.shadowColor = low ? `rgba(255,50,60,${0.55 + 0.45 * pulse})` : th.glow;
    ctx.shadowBlur = low ? 12 : 7;
    rr(ctx, x - 2, y - 2, bw + 4, bh + 4, 7);
    ctx.fillStyle = INK; ctx.fill();
    ctx.restore();
    const pg = ctx.createLinearGradient(0, y, 0, y + bh);
    pg.addColorStop(0, th.plate[0]); pg.addColorStop(1, th.plate[1]);
    rr(ctx, x, y, bw, bh, 6);
    ctx.fillStyle = pg; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = low && pulse > 0.5 ? '#ff5f6d' : th.edge; ctx.stroke();
    // Corner studs.
    ctx.fillStyle = th.edge;
    for (const [sx, sy] of [[x + 4, y + 4], [x + bw - 6, y + 4], [x + 4, y + bh - 6], [x + bw - 6, y + bh - 6]]) ctx.fillRect(sx, sy, 2, 2);

    const left = x + R + 9, right = x + bw - 8;
    // Name and tag.
    ctx.font = HF(800, small ? 7 : 8);
    ctx.textAlign = 'left';
    outlined(ctx, String(e.name || '').toUpperCase(), left, y + (small ? 8 : 9), '#fff', 2.5);
    ctx.font = HF(800, small ? 5 : 6);
    const enr = isEnraged(e), tagText = enr ? 'ENRAGED' : th.tag;
    const tagW = Math.ceil(ctx.measureText(tagText).width) + 10;
    const blink = enr && Math.sin(now / 140) > 0;
    pill(ctx, right - tagW, y + 2, tagText, enr ? (blink ? '#fff' : '#ffd0d0') : th.tagFg, enr ? '#8a0f1c' : th.tagBg, enr ? '#ff4a4a' : th.edge, small ? 5 : 6);
    // Health bar with damage trail and hit flash.
    const barY = y + (small ? 11 : 13), barH = small ? 4 : 6, barW = right - left;
    rr(ctx, left - 1.5, barY - 1.5, barW + 3, barH + 3, 2.5);
    ctx.fillStyle = INK; ctx.fill();
    ctx.fillStyle = 'rgba(30,6,12,.95)';
    ctx.fillRect(left, barY, barW, barH);
    const tf = Math.max(0, Math.min(1, st.trail / (e.maxHp || 1)));
    if (tf > frac) { ctx.fillStyle = 'rgba(255,236,170,.85)'; ctx.fillRect(left + barW * frac, barY, barW * (tf - frac), barH); }
    let fg = null;
    const bcol = barSet.boss === 'default' ? th.a : barSet.boss === 'rainbow' ? 'rainbow' : BAR_COL[barSet.boss] || th.a;
    if (barSet.boss === 'default') { fg = ctx.createLinearGradient(left, 0, left + barW, 0); fg.addColorStop(0, th.b); fg.addColorStop(1, th.a); }
    fillBar(ctx, left, barY, barW, barH, frac, bcol, fg);
    if (st.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${(st.flash * 0.55).toFixed(2)})`; ctx.fillRect(left, barY, Math.round(barW * frac), barH); }
    // Quarter marks under the bar.
    ctx.fillStyle = th.edge;
    for (const q of [0.25, 0.5, 0.75]) {
      const qx = Math.round(left + barW * q);
      ctx.fillRect(qx - 0.5, barY + barH + 1, 1, 2);
    }
    if (!small && barSet.bossNum) {
      ctx.font = HF(800, 6);
      ctx.textAlign = 'right';
      outlined(ctx, Math.ceil(frac * 100) + '%', right - 7 - tagW, y + 9, '#fff', 2);
    }
    // Portrait (rounded square like the rest of the HUD), overlapping the
    // left edge: angry face, pained face and a shake when it takes a hit.
    // Pained face whenever it takes damage.
    const emo = emotionFor('boss:' + e.id, e.dex, e.shiny, e.hp, false, 0);
    const hurt = emo === 'Pain';
    // Enraged (the game's own rule) → angry face between hits; a hit shows the
    // pained face, enraged or not, and it goes back once the hits stop.
    const mad = isEnraged(e);
    if (mad) emoImg(e.dex, e.shiny, 'Angry');
    const jx = hurt ? Math.round(Math.sin(now / 22) * 1.5) : 0, jy = hurt ? Math.round(Math.cos(now / 27)) : 0;
    const ps = R * 2 + 2;
    drawPortrait(ctx, x + 6 - ps / 2 + jx, y + bh / 2 - ps / 2 + jy, ps, e.dex, e.shiny, legend ? '#9b5cff' : '#ff5f3d', e.name, hurt ? 'Pain' : mad ? 'Angry' : 'Normal', false, hurt ? '#ffffff' : mad ? '#ff4a4a' : th.edge);
    // In a rift arena: the arena's countdown card, under the plate.
    if (!small && NS.Rift && NS.Rift.inArena && typeof NS.Rift.timeLeft === 'number') {
      const left = Math.max(0, NS.Rift.timeLeft);
      arenaTotal = Math.max(arenaTotal, left);
      return drawRiftCard(ctx, W, y + bh + 6, 'RIFT ARENA', 'Defeat the legendary', left, arenaTotal, left < 10) - y;
    }
    if (!(NS.Rift && NS.Rift.inArena)) arenaTotal = 0;
    return bh;
  }

  // ---- keep edge arrows off the minimap
  // If an arrow lands on the minimap, slide it along the screen edge to the
  // nearest side of the map that is still on screen.
  let mapHud = null;
  function avoidMap(ex, ey, M, W, H) {
    const r = mapHud;
    if (!r) return [ex, ey];
    const pad = M * 0.75;
    if (ex < r.x - pad || ex > r.x + r.w + pad || ey < r.y - pad || ey > r.y + r.h + pad) return [ex, ey];
    const opts = [
      [ex, r.y + r.h + pad], [ex, r.y - pad],
      [r.x - pad, ey], [r.x + r.w + pad, ey],
    ].filter(([x, y]) => x >= M && x <= W - M && y >= M && y <= H - M);
    if (!opts.length) return [ex, ey];
    opts.sort((p, q) => Math.hypot(p[0] - ex, p[1] - ey) - Math.hypot(q[0] - ex, q[1] - ey));
    return opts[0];
  }

  // ---- arrows that would overlap slide along the edge
  let arrowSpots = [];
  function spreadArrow(ex, ey, M, W, H) {
    const GAP = 62, side = ex <= M + 1 || ex >= W - M - 1;
    for (let tries = 0; tries < 8; tries++) {
      const hit = arrowSpots.find(([x, y]) => Math.hypot(x - ex, y - ey) < GAP);
      if (!hit) break;
      if (side) { const d = ey >= hit[1] ? 1 : -1; ey = hit[1] + d * GAP; if (ey > H - M - 125 || ey < M + 70) ey = hit[1] - d * GAP; }
      else { const d = ex >= hit[0] ? 1 : -1; ex = hit[0] + d * GAP; if (ex > W - M || ex < M) ex = hit[0] - d * GAP; }
    }
    arrowSpots.push([ex, ey]);
    return [ex, ey];
  }

  // ---- treasure thieves: Meowth (coins) and Gholdengo (a ×10 ticket)
  // The game spawns one now and then; it runs off after 15 s. The game's own
  // plain yellow arrow is hidden in the new HUD and replaced by a tag under
  // the clock (what it carries, time left as a draining bar) and an arrow in
  // the HUD's style: round portrait, gold ring, coin / ticket badge.
  const THIEF_LIFE = 15;
  const thiefSeen = new Map();   // id -> { e, first }
  let thiefDone = [];            // { name, dex, caught, at }
  let hudFresh = false;
  const isThief = (e) => e && e.behavior === 'thief';
  const thiefName = (e) => String(tr(e.name || ((NS.DEX_BY && NS.DEX_BY[e.dex]) || {}).name || 'Meowth'));
  const thiefTicket = (e) => (e.def && e.def.loot === 'ticket10') || e.dex === 1000;
  function thiefLeft(e, now) {
    if (typeof e.life === 'number' && !e.remote) return Math.max(0, e.life);
    const s = thiefSeen.get(e.id);
    return Math.max(0, THIEF_LIFE - (s ? (now - s.first) / 1000 : 0));
  }
  function trackThieves(now) {
    const live = NS.EnemyMgr ? NS.EnemyMgr.all().filter((e) => isThief(e) && !e.dead) : [];
    const ids = new Set(live.map((e) => e.id));
    for (const e of live) if (!thiefSeen.has(e.id)) thiefSeen.set(e.id, { e, first: now });
    for (const [id, s] of thiefSeen) {
      if (ids.has(id)) continue;
      thiefSeen.delete(id);
      const e = s.e;
      // Defeated (it dies with hp 0) or got away (removed while alive).
      thiefDone.push({ name: thiefName(e), ticket: thiefTicket(e), caught: !!e.dead || (e.hp || 0) <= 0, at: now });
    }
    thiefDone = thiefDone.filter((d) => now - d.at < 2600);
    return live;
  }
  // Rounded tag centred under the clock (same look as the weather tag),
  // optionally with time left draining along it. Returns the next y.
  // The clock, redrawn: a plate with the time, then one strip with the biome,
  // defeated, coins and the tickets picked up this run (game icons).
  function drawClockPanel(ctx, W, pl) {
    const st = NS.Game && NS.Game.st, Icons = NS.Icons;
    const time = st ? st.time || 0 : 0;
    const judg = NS.Judgment && NS.Judgment.active;
    ctx.save();
    // time plate
    ctx.font = HF(800, 22);
    const txt = clock(time);
    const pw = Math.max(96, Math.ceil(ctx.measureText(txt).width) + 44), ph = 30, px = Math.round((W - pw) / 2), py = 12;
    rr(ctx, px - 2, py - 2, pw + 4, ph + 4, 11); ctx.fillStyle = INK; ctx.fill();
    const g = ctx.createLinearGradient(0, py, 0, py + ph); g.addColorStop(0, '#2c519f'); g.addColorStop(1, '#16295e');
    rr(ctx, px, py, pw, ph, 9); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = judg ? '#ffd23f' : EDGE; rr(ctx, px, py, pw, ph, 9); ctx.stroke();
    if (Icons) Icons.draw(ctx, 'clock', px + 8, py + 8, 14);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    outlined(ctx, txt, px + pw / 2 + 8, py + ph / 2 + 1, '#fff', 3);
    ctx.textBaseline = 'alphabetic';
    // info strip
    let biome = '';
    try { biome = String(tr(NS.World.biomeName())).toUpperCase(); } catch (_) { biome = ''; }
    const items = [
      [skullIcon, fmt(pl.kills || 0), '#ffb3b3'],
      ['coin', fmt(pl.coins || 0), '#ffd23f'],
      ['ticket', '×' + (pl.t1 || 0), '#ffe58a'],
      ['ticket10', '×' + (pl.t10 || 0), '#d9a6ff'],
    ];
    ctx.font = HF(700, 9);
    const IS = 11, gap = 10;
    const bw = biome ? Math.ceil(ctx.measureText(biome).width) + 14 : 0;
    // Endless: a purple tag first; past 30:00 it shows how much tougher enemies are.
    const inf = endlessRun ? '∞ ENDLESS' : '';
    const iw = inf ? Math.ceil(ctx.measureText(inf).width) + 14 : 0;
    const widths = items.map(([, v]) => IS + 3 + Math.ceil(ctx.measureText(v).width));
    const sw = iw + bw + widths.reduce((a, b) => a + b, 0) + gap * items.length + 12;
    const sx = Math.round((W - sw) / 2), sy = py + ph + 5, sh = 16;
    rr(ctx, sx, sy, sw, sh, sh / 2); ctx.fillStyle = 'rgba(11,24,56,.85)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(244,248,255,.35)'; rr(ctx, sx, sy, sw, sh, sh / 2); ctx.stroke();
    let x = sx + 8;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    if (inf) { ctx.fillStyle = '#d2b8ff'; ctx.fillText(inf, x, sy + sh / 2 + 0.5); x += iw; ctx.fillStyle = 'rgba(244,248,255,.25)'; ctx.fillRect(x - gap / 2 - 1, sy + 4, 1, sh - 8); }
    if (biome) { ctx.fillStyle = '#b9cbf0'; ctx.fillText(biome, x, sy + sh / 2 + 0.5); x += bw; }
    items.forEach(([icon, v, col], i) => {
      if (biome || i) { ctx.fillStyle = 'rgba(244,248,255,.25)'; ctx.fillRect(x - gap / 2 - 1, sy + 4, 1, sh - 8); }
      if (typeof icon === 'function') { ctx.imageSmoothingEnabled = false; ctx.drawImage(icon(), x, sy + (sh - IS) / 2, IS, IS); }
      else if (Icons) Icons.draw(ctx, icon, x, sy + (sh - IS) / 2, IS);
      ctx.fillStyle = col; ctx.fillText(v, x + IS + 3, sy + sh / 2 + 0.5);
      x += widths[i] + gap;
    });
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
    return sy + sh;
  }
  function topTag(ctx, W, y, text, col, icon, frac = null, alpha = 1) {
    const Icons = NS.Icons;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = HF(700, 9);
    const th = 15, tw = Math.ceil(ctx.measureText(text).width) + 28, tx = Math.round((W - tw) / 2);
    rr(ctx, tx, y, tw, th, th / 2);
    ctx.fillStyle = 'rgba(11,24,56,.88)'; ctx.fill();
    if (frac != null) {
      ctx.save();
      rr(ctx, tx, y, tw, th, th / 2); ctx.clip();
      ctx.fillStyle = col + '40';
      ctx.fillRect(tx, y, Math.round(tw * frac), th);
      ctx.fillStyle = col;
      ctx.fillRect(tx, y + th - 2, Math.round(tw * frac), 2);
      ctx.restore();
    }
    rr(ctx, tx, y, tw, th, th / 2);
    ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
    if (icon && typeof icon === 'object') { ctx.imageSmoothingEnabled = false; ctx.drawImage(icon, tx + 5, y + 2, 11, 11); }
    else if (icon && Icons) Icons.draw(ctx, icon, tx + 5, y + 2, 11);
    ctx.fillStyle = col;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, tx + 20, y + th / 2 + 0.5);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
    return y + th + 5;
  }
  function drawThiefTags(ctx, W, y, live, now) {
    if (!notif.thief) return y;
    for (const e of live.slice(0, 2)) {
      const left = thiefLeft(e, now), ticket = thiefTicket(e);
      const urgent = left < 5 && Math.sin(now / 90) > 0;
      y = topTag(ctx, W, y, `${thiefName(e).toUpperCase()} · ${ticket ? '×10 TICKET' : 'COINS'} · CATCH IT! · ${Math.ceil(left)}s`,
        urgent ? '#ffb347' : '#ffd23f', ticket ? 'ticket10' : 'coin', left / THIEF_LIFE);
    }
    for (const d of thiefDone) {
      const age = (now - d.at) / 1000;
      y = topTag(ctx, W, y, d.caught ? `${d.name.toUpperCase()} CAUGHT!` : `${d.name.toUpperCase()} GOT AWAY`,
        d.caught ? '#ffd23f' : '#aab8d6', d.caught ? (d.ticket ? 'ticket10' : 'coin') : null, null, Math.min(1, (2.6 - age) * 2));
    }
    return y;
  }

  // ---- small pixel icons of our own (same outline and scale as the game's)
  function pixelIcon(rows, pal) {
    const cv = document.createElement('canvas');
    cv.width = rows[0].length; cv.height = rows.length;
    const g = cv.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((c, x) => { if (pal[c]) { g.fillStyle = pal[c]; g.fillRect(x, y, 1, 1); } }));
    return cv;
  }
  // Big chests: our opening bar replaces the game's thin ring around the chest.
  waitFor(() => NS && NS.World && typeof NS.World.drawProp === 'function', () => {
    const W = NS.World, orig = W.drawProp;
    W.drawProp = function (ctx, p) {
      if (p && p.type === 'bigchest' && p.open > 0 && featOn('chestMeter')) {
        const o = p.open;
        try { p.open = 0; return orig.apply(this, arguments); } finally { p.open = o; }
      }
      return orig.apply(this, arguments);
    };
  }, 'chestMeter');
  let skullCv = null;
  const skullIcon = () => skullCv || (skullCv = pixelIcon([
    '..kkkkkkkk..', '.kwwwwwwwwk.', 'kwwwwwwwwwgk', 'kwwwwwwwwwgk', 'kwkkkwwkkkgk', 'kwkkkwwkkkgk',
    'kwwkwwwwkwgk', '.kwwwkkwwgk.', '..kwwwwwgk..', '..kwkwkwkk..', '..kwkwkwgk..', '...kkkkkk...',
  ], { k: '#1b1528', w: '#f4f1e8', g: '#b9b2a0' }));
  let riftIconCv = null;
  const riftIcon = () => riftIconCv || (riftIconCv = pixelIcon([
    '...kkkkkk...', '..klllllmk..', '.kmmmmlllmk.', 'kmppppmllmpk', 'kppppppllmpk', 'kppmlwwllmpk',
    'kpmllwwlmppk', 'kpmllppppppk', 'kpmllmppppmk', '.kmlllmmmmk.', '..kmlllllk..', '...kkkkkk...',
  ], { k: '#1b1528', p: '#4a2296', m: '#9b5cff', l: '#d7b8ff', w: '#faf4ff' }));

  // ---- rifts: a tag under the clock while one is open, and an arrow in
  // the HUD's style (round badge with the rift icon, purple glow) instead
  // of the game's big triangle and its centre notice.
  const RIFT_COL = '#c9a6ff';
  let riftSeen = null;   // { r, ttl0 }
  function currentRift() {
    const r = NS.Rift && !NS.Rift.inArena ? NS.Rift.rift : null;
    if (!r) { riftSeen = null; return null; }
    if (!riftSeen || riftSeen.r !== r) riftSeen = { r, ttl0: Math.max(r.ttl || 1, 1) };
    return r;
  }
  function drawRiftTag(ctx, W, y, pl, r) {
    if (!notif.rift) return y;
    if (!r) return y;
    const left = Math.max(0, r.ttl || 0), metres = Math.round(Math.hypot(pl.x - r.x, pl.y - r.y) / 32);
    return drawRiftCard(ctx, W, y, 'RIFT OPEN', `${metres} m away`, left, riftSeen.ttl0, left < 8);
  }
  // A purple card: swirl badge, title, detail, time left and a draining bar.
  function drawRiftCard(ctx, W, y, title, detail, left, total, urgent) {
    const t = performance.now();
    const w = 196, h = 30, x = Math.round((W - w) / 2);
    const col = urgent && Math.sin(t / 110) > 0 ? '#ff9ad5' : RIFT_COL;
    ctx.save();
    // glow
    ctx.shadowColor = 'rgba(155,92,255,.55)'; ctx.shadowBlur = 10 + Math.sin(t / 400) * 4;
    rr(ctx, x, y, w, h, 9); ctx.fillStyle = 'rgba(28,14,58,.92)'; ctx.fill();
    ctx.shadowBlur = 0;
    const g = ctx.createLinearGradient(x, y, x, y + h); g.addColorStop(0, 'rgba(155,92,255,.35)'); g.addColorStop(1, 'rgba(155,92,255,.05)');
    rr(ctx, x, y, w, h, 9); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = col; rr(ctx, x, y, w, h, 9); ctx.stroke();
    // swirl badge, slowly turning
    ctx.save();
    ctx.translate(x + 15, y + h / 2); ctx.rotate(t / 900);
    ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fillStyle = '#1b1528'; ctx.fill();
    ctx.imageSmoothingEnabled = false; ctx.drawImage(riftIcon(), -8, -8, 16, 16);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.font = HF(800, 9); outlined(ctx, title, x + 31, y + 12, col, 2.5);
    ctx.font = HF(700, 8); outlined(ctx, detail, x + 31, y + 23, '#e2d0ff', 2.5);
    ctx.textAlign = 'right';
    ctx.font = HF(800, 13); outlined(ctx, clock(Math.ceil(left)), x + w - 9, y + 19, '#fff', 3);
    // draining bar along the bottom
    const f = Math.max(0, Math.min(1, total ? left / total : 0));
    ctx.save(); rr(ctx, x, y, w, h, 9); ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x, y + h - 3, w, 3);
    ctx.fillStyle = col; ctx.fillRect(x, y + h - 3, Math.round(w * f), 3);
    ctx.restore();
    ctx.restore();
    return y + h + 6;
  }
  let arenaTotal = 0;
  function drawRiftArrow(ctx, W, H, pl, cardsBottom, t, r) {
    if (!notif.rift) return;
    const cam = NS.Camera;
    if (!r || !cam || !cam.left) return;
    const left = Math.max(0, r.ttl || 0);
    const col = left < 8 && Math.sin(t * 9) > 0 ? '#ff9ad5' : RIFT_COL;
    const sx = (r.x - cam.left()) * cam.scale, sy = (r.y - 40 - cam.top()) * cam.scale;
    if (sx > 0 && sx < W && sy > 0 && sy < H) {
      // On screen: a small tag over the portal that bobs gently.
      const bob = Math.abs(Math.sin(t * 3)) * 4;
      ctx.font = HF(800, 9);
      const text = 'RIFT · ' + Math.ceil(left) + 's', tw = Math.ceil(ctx.measureText(text).width) + 24, th = 15;
      const tx = Math.round(sx - tw / 2), ty = Math.round(sy - 40 - th - bob);
      rr(ctx, tx, ty, tw, th, th / 2);
      ctx.fillStyle = 'rgba(11,24,56,.88)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
      ctx.imageSmoothingEnabled = false; ctx.drawImage(riftIcon(), tx + 4, ty + 2, 11, 11);
      ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(text, tx + 19, ty + th / 2 + 0.5);
      ctx.textBaseline = 'alphabetic';
      // Little pointer down to it.
      ctx.beginPath(); ctx.moveTo(sx - 5, ty + th + 1); ctx.lineTo(sx + 5, ty + th + 1); ctx.lineTo(sx, ty + th + 7); ctx.closePath();
      ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke(); ctx.fillStyle = col; ctx.fill();
      return;
    }
    const M = 44;
    let ex = Math.max(M, Math.min(W - M, sx)), ey = Math.max(M + 70, Math.min(H - M - 125, sy));
    if (cardsBottom && ex < 230 + M && ey < cardsBottom + M) ey = cardsBottom + M;
    [ex, ey] = avoidMap(ex, ey, M, W, H);
    [ex, ey] = spreadArrow(ex, ey, M, W, H);
    const a = Math.atan2(sy - ey, sx - ex), ca = Math.cos(a), sa = Math.sin(a);
    const beat = 0.5 + 0.5 * Math.sin(t * 6);
    ctx.save();
    ctx.translate(ex, ey);
    const glow = ctx.createRadialGradient(0, 0, 8, 0, 0, 32 + beat * 5);
    glow.addColorStop(0, 'rgba(155,92,255,.5)'); glow.addColorStop(1, 'rgba(155,92,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, 36 + beat * 5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(ca * 31, sa * 31);
    ctx.lineTo(Math.cos(a + 2.4) * 15, Math.sin(a + 2.4) * 15);
    ctx.lineTo(Math.cos(a - 2.4) * 15, Math.sin(a - 2.4) * 15);
    ctx.closePath();
    ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.fillStyle = col; ctx.fill();
    // Badge: the rift icon in a dark circle with a purple ring, slowly turning.
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fillStyle = 'rgba(40,16,82,.95)'; ctx.fill();
    ctx.save();
    ctx.rotate(t * 1.6);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(riftIcon(), -12, -12, 24, 24);
    ctx.restore();
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke();
    ctx.font = HF(800, 11);
    ctx.textAlign = ca > 0.3 ? 'right' : ca < -0.3 ? 'left' : 'center';
    const metres = Math.round(Math.hypot(pl.x - r.x, pl.y - r.y) / 32);
    outlined(ctx, `Rift · ${metres} m · ${Math.ceil(left)}s`, -ca * 32, -sa * 28 + 4, col, 3);
    ctx.restore();
  }
  function drawThiefArrows(ctx, W, H, pl, cardsBottom, t, live, now) {
    if (!notif.thief) return;
    const cam = NS.Camera;
    if (!cam || !cam.left || !live.length) return;
    const Icons = NS.Icons;
    for (const e of live) {
      const left = thiefLeft(e, now), ticket = thiefTicket(e);
      const sx = (e.x - cam.left()) * cam.scale, sy = (e.y - (e.bodyH || 24) * 0.5 - cam.top()) * cam.scale;
      const col = left < 5 && Math.sin(t * 11) > 0 ? '#ffb347' : '#ffd23f';
      if (sx > 0 && sx < W && sy > 0 && sy < H) {
        // On screen: a small timer over its head.
        const hy = (e.y - (e.bodyH || 24) - cam.top()) * cam.scale - 14;
        ctx.font = HF(800, 9);
        const text = Math.ceil(left) + 's', tw = Math.ceil(ctx.measureText(text).width) + 22, th = 14;
        const tx = Math.round(sx - tw / 2), ty = Math.round(hy - th);
        rr(ctx, tx, ty, tw, th, th / 2);
        ctx.fillStyle = 'rgba(11,24,56,.85)'; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
        if (Icons) Icons.draw(ctx, ticket ? 'ticket10' : 'coin', tx + 4, ty + 2, 10);
        ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(text, tx + 17, ty + th / 2 + 0.5);
        ctx.textBaseline = 'alphabetic';
        continue;
      }
      const M = 44;
      let ex = Math.max(M, Math.min(W - M, sx)), ey = Math.max(M + 70, Math.min(H - M - 125, sy));
      if (cardsBottom && ex < 230 + M && ey < cardsBottom + M) ey = cardsBottom + M;
      [ex, ey] = avoidMap(ex, ey, M, W, H);
      [ex, ey] = spreadArrow(ex, ey, M, W, H);
      const a = Math.atan2(sy - ey, sx - ex), ca = Math.cos(a), sa = Math.sin(a);
      const beat = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.save();
      ctx.translate(ex, ey);
      // Soft gold glow.
      const glow = ctx.createRadialGradient(0, 0, 8, 0, 0, 30 + beat * 4);
      glow.addColorStop(0, 'rgba(255,210,63,.45)'); glow.addColorStop(1, 'rgba(255,210,63,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, 34 + beat * 4, 0, Math.PI * 2); ctx.fill();
      // Pointer.
      ctx.beginPath();
      ctx.moveTo(ca * 31, sa * 31);
      ctx.lineTo(Math.cos(a + 2.4) * 15, Math.sin(a + 2.4) * 15);
      ctx.lineTo(Math.cos(a - 2.4) * 15, Math.sin(a - 2.4) * 15);
      ctx.closePath();
      ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.stroke();
      ctx.fillStyle = col; ctx.fill();
      // Portrait with a gold ring, and what it carries as a badge.
      if (!roundPortrait(ctx, 0, 0, 14, e.dex, false, 'Normal', col, 'rgba(60,44,8,.92)')) {
        ctx.font = HF(800, 13); ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText(thiefName(e).charAt(0).toUpperCase(), 0, 5);
      }
      if (Icons) {
        ctx.beginPath(); ctx.arc(10, 10, 7, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
        Icons.draw(ctx, ticket ? 'ticket10' : 'coin', 4, 4, 12);
      }
      ctx.font = HF(800, 11);
      ctx.textAlign = ca > 0.3 ? 'right' : ca < -0.3 ? 'left' : 'center';
      const metres = Math.round(Math.hypot(pl.x - e.x, pl.y - e.y) / 32);
      outlined(ctx, `${thiefName(e)} · ${metres} m · ${Math.ceil(left)}s`, -ca * 32, -sa * 28 + 4, col, 3);
      ctx.restore();
    }
  }
  // The game's own thief arrow (in its event layer) is left out while the
  // new HUD draws its own.
  function setupThiefArrow() {
    const E = NS.Events, draw = E.drawHud;
    E.drawHud = function () {
      if (!hudFresh || !NS.EnemyMgr) return draw.apply(this, arguments);
      const M = NS.EnemyMgr, all = M.all;
      M.all = function () { return all.apply(this, arguments).filter((e) => !isThief(e)); };
      try { return draw.apply(this, arguments); } finally { M.all = all; }
    };
  }
  waitFor(() => NS && NS.Events && NS.Events.drawHud, setupThiefArrow);

  // ---- arrows to bosses out of view
  // Unlike teammate arrows (round portrait, single pointer): a framed boss
  // portrait, a red pulsing halo and a gold double chevron, with "BOSS · N m".
  function drawBossArrows(ctx, W, H, pl, cardsBottom, t) {
    if (!notif.bosses) return;
    const cam = NS.Camera;
    if (!cam || !cam.left || !NS.EnemyMgr) return;
    for (const e of NS.EnemyMgr.all()) {
      if (!e.boss || e.dead) continue;
      const sx = (e.x - cam.left()) * cam.scale, sy = (e.y - (e.bodyH || 30) * 0.5 - cam.top()) * cam.scale;
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      const M = 48;
      let ex = Math.max(M, Math.min(W - M, sx)), ey = Math.max(M + 70, Math.min(H - M - 125, sy));
      if (cardsBottom && ex < 230 + M && ey < cardsBottom + M) ey = cardsBottom + M;
      [ex, ey] = avoidMap(ex, ey, M, W, H);
      [ex, ey] = spreadArrow(ex, ey, M, W, H);
      const a = Math.atan2(sy - ey, sx - ex), ca = Math.cos(a), sa = Math.sin(a);
      const legend = !!(e.legend || e.judge);
      const gold = legend ? '#d7b8ff' : '#ffd23f', red = legend ? '#9b5cff' : '#ff3048';
      const beat = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.globalAlpha = 0.22 + beat * 0.25;
      ctx.beginPath(); ctx.arc(0, 0, 30 + beat * 6, 0, Math.PI * 2); ctx.fillStyle = red; ctx.fill();
      ctx.globalAlpha = 1;
      const chev = (d, w, col) => {
        ctx.beginPath();
        ctx.moveTo(ca * (d + 12), sa * (d + 12));
        ctx.lineTo(ca * d + Math.cos(a + Math.PI / 2) * w, sa * d + Math.sin(a + Math.PI / 2) * w);
        ctx.lineTo(ca * (d + 4), sa * (d + 4));
        ctx.lineTo(ca * d + Math.cos(a - Math.PI / 2) * w, sa * d + Math.sin(a - Math.PI / 2) * w);
        ctx.closePath();
        ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.stroke();
        ctx.fillStyle = col; ctx.fill();
      };
      chev(22, 11, gold);
      chev(33 + beat * 3, 9, gold);
      drawPortrait(ctx, -14, -14, 28, e.dex, e.shiny, red, e.name, isEnraged(e) ? 'Angry' : 'Normal', false, gold);
      ctx.font = HF(800, 11);
      ctx.textAlign = ca > 0.3 ? 'right' : ca < -0.3 ? 'left' : 'center';
      const metres = Math.round(Math.hypot(pl.x - e.x, pl.y - e.y) / 32);
      outlined(ctx, (legend ? 'LEGENDARY · ' : 'BOSS · ') + metres + ' m', -ca * 34, -sa * 30 + 4, gold, 3);
      ctx.restore();
    }
  }

  // ---- arrows to teammates out of view
  // Same idea as the game's, with their portrait inside, kept clear of the
  // team cards (top-left) and the bottom HUD.
  function drawMateArrows(ctx, W, H, pl, cardsBottom, t) {
    if (!notif.mates) return;
    const cam = NS.Camera;
    if (!cam || !cam.left) return;
    const list = NS.Coop.mates.filter((m) => m.connected && m.pl);
    // While spectating, one more arrow: back to where you fell.
    const sm = specTarget();
    if (sm) list.push({ self: true, name: 'You', color: '#ff8a96', uid: 'me', pl, from: sm.pl });
    for (const m of list) {
      const o = m.pl, net = o.net || {};
      const sx = (o.x - cam.left()) * cam.scale, sy = (o.y - (o.bodyH || 30) * 0.5 - cam.top()) * cam.scale;
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      const M = 42;
      let ex = Math.max(M, Math.min(W - M, sx)), ey = Math.max(M + 70, Math.min(H - M - 125, sy));
      if (cardsBottom && ex < 230 + M && ey < cardsBottom + M) ey = cardsBottom + M;
      [ex, ey] = avoidMap(ex, ey, M, W, H);
      [ex, ey] = spreadArrow(ex, ey, M, W, H);
      const a = Math.atan2(sy - ey, sx - ex);
      const dead = !!(net.dead || o.dead);
      const blink = Math.sin(t * 8) > 0;
      const col = dead ? (blink ? '#ff5f6d' : '#ffd0d5') : m.color;
      const ref = m.self ? m.from : pl;
      const metres = Math.round(Math.hypot(ref.x - o.x, ref.y - o.y) / 32);
      ctx.save();
      ctx.translate(ex, ey);
      if (dead) {
        ctx.globalAlpha = 0.25 + (blink ? 0.2 : 0);
        ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fillStyle = '#ff5f6d'; ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 31, Math.sin(a) * 31);
      ctx.lineTo(Math.cos(a + 2.35) * 16, Math.sin(a + 2.35) * 16);
      ctx.lineTo(Math.cos(a - 2.35) * 16, Math.sin(a - 2.35) * 16);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 28, Math.sin(a) * 28);
      ctx.lineTo(Math.cos(a + 2.4) * 14, Math.sin(a + 2.4) * 14);
      ctx.lineTo(Math.cos(a - 2.4) * 14, Math.sin(a - 2.4) * 14);
      ctx.closePath(); ctx.fill();
      const mon = o.mon || {};
      const emo = dead ? 'Dizzy' : (hurtUntil.get(m.self ? 'me' : 'mate:' + m.uid) || 0) > performance.now() ? 'Pain' : 'Normal';
      if (!roundPortrait(ctx, 0, 0, 14, mon.dex, o.shiny, emo, col, 'rgba(11,24,56,.9)')) {
        ctx.font = HF(800, 13); ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText(String(m.name || '?').charAt(0).toUpperCase(), 0, 5);
      }
      const lx = -Math.cos(a) * 32, ly = -Math.sin(a) * 28 + 4;
      ctx.font = HF(800, 11);
      ctx.textAlign = Math.cos(a) > 0.3 ? 'right' : Math.cos(a) < -0.3 ? 'left' : 'center';
      outlined(ctx, (m.self ? 'You · ' : dead ? m.name + ' needs help! · ' : m.name + ' · ') + metres + ' m', lx, ly, col, 3);
      ctx.restore();
    }
  }

  // ---- you're down
  // Red pulse around the screen edge, and a plate with your dizzy portrait,
  // who can help (and how far), and the revive progress when someone is on it.
  function drawDowned(ctx, W, H, pl, t) {
    const RT = (NS.Player && NS.Player.REVIVE_TIME) || 3;
    const f = Math.max(0, Math.min(1, (pl.reviveT || 0) / RT));
    const reviving = f > 0;
    const players = NS.Coop.players ? NS.Coop.players() : [];
    const allDown = players.length > 0 && players.every((p) => p.dead);
    const beat = 0.5 + 0.5 * Math.sin(t * (reviving ? 6 : 3.2));
    // Edge pulse.
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(255,40,70,0)');
    vg.addColorStop(1, reviving ? `rgba(40,200,110,${0.22 + 0.18 * beat})` : `rgba(210,20,50,${0.3 + 0.22 * beat})`);
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    const pw = 230, ph = 56, px = Math.round(W / 2 - pw / 2), py = Math.round(H * 0.6 - ph / 2);
    const edge = reviving ? '#5fe08a' : '#ff5f6d';
    ctx.save();
    ctx.shadowColor = edge; ctx.shadowBlur = 7 + 6 * beat;
    frame(ctx, px, py, pw, ph, 7, 'rgba(14,20,44,.94)', edge, 2);
    ctx.restore();
    const dex = pl.mon && pl.mon.dex;
    drawPortrait(ctx, px + 8, py + 8, 40, dex, pl.shiny, pl.tagColor, pl.mon && pl.mon.name, 'Dizzy', !reviving);
    const tx = px + 56;
    ctx.textAlign = 'left';
    ctx.font = HF(800, 12);
    const title = allDown ? 'EVERYONE IS DOWN' : reviving ? 'BEING REVIVED!' : "YOU'RE DOWN";
    outlined(ctx, title, tx, py + 18, reviving ? '#8dffb4' : '#ff8a96', 3);
    ctx.font = HF(700, 7);
    let sub = 'Hang on, almost there…';
    if (!reviving) {
      let best = null;
      for (const m of NS.Coop.mates) {
        if (!m.connected || !m.pl || m.pl.dead || (m.pl.net && m.pl.net.dead)) continue;
        const d = Math.hypot(pl.x - m.pl.x, pl.y - m.pl.y);
        if (!best || d < best.d) best = { d, name: m.name };
      }
      sub = allDown ? 'The run ends if nobody gets up' : best ? `${best.name} can revive you · ${Math.round(best.d / 32)} m away` : 'Waiting for a teammate…';
    }
    outlined(ctx, sub, tx, py + 29, '#dfe8fb', 2);
    // Revive progress.
    const bx = tx, by = py + 37, bwid = pw - (tx - px) - 28;
    bar(ctx, bx, by, bwid, 8, f, '#5fe08a', 'rgba(10,40,24,.9)');
    if (reviving) {
      ctx.font = HF(800, 6); ctx.textAlign = 'center';
      outlined(ctx, Math.round(f * 100) + '%', bx + bwid / 2, by + 6.5, '#fff', 2);
    }
    if (NS.Icons) {
      const s = 11 + (reviving ? beat * 3 : beat * 1.5);
      NS.Icons.draw(ctx, 'heart', bx + bwid + 6 + (14 - s) / 2, by + 4 - s / 2, s);
    }
  }

  // ---- you're reviving someone
  function drawReviving(ctx, W, y, t) {
    const RT = (NS.Player && NS.Player.REVIVE_TIME) || 3;
    for (const m of NS.Coop.mates) {
      if (!m.connected || !m.pl) continue;
      const o = m.pl;
      const dead = !!(o.dead || (o.net && o.net.dead));
      const f = Math.max(0, Math.min(1, (o.reviveT || 0) / RT));
      if (!dead || f <= 0) continue;
      const bw = 190, x = Math.round(W / 2 - bw / 2);
      ctx.font = HF(800, 9);
      ctx.textAlign = 'center';
      outlined(ctx, 'REVIVING ' + String(m.name).toUpperCase(), W / 2, y - 4, '#8dffb4', 3);
      bar(ctx, x, y, bw, 7, f, '#5fe08a', 'rgba(10,40,24,.9)');
      return;
    }
  }

  // ---- tooltips for move slots and the held item
  let tipEl = null;
  const KIND_NAME = {
    projectile: 'Projectile', melee: 'Melee', beam: 'Beam', orbit: 'Orbit', nova: 'Nova', aura: 'Aura', buff: 'Boost',
    boomerang: 'Boomerang', chain: 'Chain', mine: 'Mines', meteor: 'Meteor', turret: 'Turret', dash: 'Dash', trail: 'Trail', cone: 'Cone',
  };
  const tr = (s) => { try { return NS.I18n && NS.I18n.t ? NS.I18n.t(s) : s; } catch { return s; } };
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  function moveTip(m, pl) {
    const TYPE = (NS.U && NS.U.TYPE_COLOR) || {};
    const col = TYPE[m.type] || '#8fa3c4';
    const max = (m.def && m.def.maxLvl) || 5;
    const atk = pl.atk || 1, cdm = pl.cdMul || 1;
    const rows = [];
    const row = (k, v) => rows.push(`<div class="kv"><span>${k}</span><b>${v}</b></div>`);
    if (m.kind === 'buff') {
      if (m.amount != null) row('Boost', `+${Math.round(m.amount * 100)}%`);
      if (m.dur) row('Lasts', `${m.dur.toFixed(1)} s`);
      if (m.stacks) row('Max stacks', m.stacks);
    } else if (m.dmg != null) {
      row('Damage', `${Math.round(m.dmg * atk)}${m.count > 1 ? ` × ${m.count}` : ''}`);
    }
    if (m.cd && m.kind !== 'orbit') row('Cooldown', `${(m.cd * cdm).toFixed(2)} s`);
    if (m.count > 1 && m.kind === 'orbit') row('Orbs', m.count);
    if (m.pierce > 0) row('Pierce', m.pierce);
    if (m.radius) row(m.kind === 'aura' || m.kind === 'orbit' ? 'Radius' : 'Range', Math.round(m.radius));
    if (m.dur && m.kind !== 'buff') row('Duration', `${m.dur.toFixed(1)} s`);
    if (m.burn) row('Effect', 'Burns');
    if (m.poison) row('Effect', 'Poisons');
    if (m.slow) row('Slows', `${Math.round(m.slow * 100)}%`);
    if (m.homing) row('Homing', 'Yes');
    if (m.knock) row('Knockback', Math.round(m.knock));
    let next = '';
    try { const nx = NS.Moves && NS.Moves.nextUpText && NS.Moves.nextUpText(m); if (nx) next = `<div class="nx">Next level: ${esc(tr(nx))}</div>`; } catch {}
    return `<div class="hd"><b style="color:${esc(col)}">${esc(tr(m.name))}${m.evolved ? ' ★' : ''}</b><span class="lv">Lv. ${m.lvl}/${max}</span></div>
      <div class="tags"><span style="background:${esc(col)}">${esc(cap(m.type))}</span><span>${esc(KIND_NAME[m.kind] || cap(m.kind))}</span></div>
      ${m.desc || (m.def && m.def.desc) ? `<div class="ds">${esc(tr(m.desc || m.def.desc))}</div>` : ''}
      <div class="st">${rows.join('')}</div>${next}`;
  }
  function itemTip(id) {
    const d = NS.Items && NS.Items.BY && NS.Items.BY[id];
    if (!d) return '';
    return `<div class="hd"><b style="color:#ffd23f">${esc(tr(d.name))}</b><span class="lv">Item</span></div>${d.desc ? `<div class="ds">${esc(tr(d.desc))}</div>` : ''}`;
  }
  // Weather: what it changes, and what that means for your Pokémon.
  function weatherTip(wx, pl) {
    const TC = (NS.U && NS.U.TYPE_COLOR) || {};
    const tname = (t) => cap(tr(t));
    const chip = (t) => `<span style="background:${TC[t] || '#777'}">${esc(tname(t))}</span>`;
    const rows = Object.entries(wx.mult || {}).map(([t, m]) => `<div class="kv"><span>${chip(t)} attacks</span><b style="color:${m >= 1 ? '#7dff9a' : '#ff8a96'}">×${m} damage</b></div>`);
    const mine = (pl && pl.mon && pl.mon.types) || [];
    let notes = [];
    if (wx.safe) notes.push(`Pokémon that aren’t ${wx.safe.map(tname).join(', ')} slowly lose health${wx.slow ? ' and move a little slower' : ''}.`);
    else if (wx.slow) notes.push('Pokémon move a little slower.');
    notes.push('Works the same for you, your teammates and the enemies.');
    let you = '';
    if (mine.length) {
      const hurt = wx.safe && !mine.some((t) => wx.safe.includes(t));
      you = hurt ? `Your ${mine.map(tname).join(' / ')} Pokémon is affected: watch your health.` : wx.safe ? `Your ${mine.map(tname).join(' / ')} Pokémon is safe from it.` : '';
    }
    return `<div class="hd"><b style="color:${wx.color || '#fff'}">${esc(tr(wx.name))}</b><span class="lv">${Math.ceil(wx.left || 0)} s left</span></div>
      <div class="st" style="margin-top:4px">${rows.join('')}</div>
      ${notes.map((n) => `<div class="ds" style="margin:4px 0 0">${esc(n)}</div>`).join('')}
      ${you ? `<div class="nx">${esc(you)}</div>` : ''}`;
  }
  function setupTips() {
    const st = document.createElement('style');
    st.textContent = `
#psmod-tip,#psmod-mtip{position:fixed;z-index:100002;pointer-events:none;width:max-content;max-width:250px;padding:7px 9px 8px;font:12px/1.3 var(--font,'Pixelify',system-ui,sans-serif);color:#fff;
  background:linear-gradient(#2c519f,#1a3170);border:2px solid #f4f8ff;outline:2px solid #0b1838;border-radius:8px;box-shadow:inset 0 0 0 2px #5b83d6,0 4px 0 #0a1430;text-shadow:1px 1px 0 #0a1430}
:is(#psmod-tip,#psmod-mtip)[hidden]{display:none}
:is(#psmod-tip,#psmod-mtip) .hd{display:flex;gap:10px;align-items:baseline;justify-content:space-between}
:is(#psmod-tip,#psmod-mtip) .hd b{font-size:13px}
:is(#psmod-tip,#psmod-mtip) .lv{color:#b9cbf0;font-size:11px;white-space:nowrap}
:is(#psmod-tip,#psmod-mtip) .tags{display:flex;gap:4px;margin:3px 0 4px}
:is(#psmod-tip,#psmod-mtip) .tags span{font-size:10px;padding:0 6px;border-radius:8px;background:#0b1838;text-shadow:none}
:is(#psmod-tip,#psmod-mtip) .ds{color:#dfe8fb;font-size:11px;margin-bottom:4px}
:is(#psmod-tip,#psmod-mtip) .st{display:grid;gap:1px}
:is(#psmod-tip,#psmod-mtip) .kv{display:flex;gap:12px;font-size:11px}
:is(#psmod-tip,#psmod-mtip) .kv span{flex:1;color:#b9cbf0}
:is(#psmod-tip,#psmod-mtip) .kv span span{display:inline-block;padding:0 6px;border-radius:7px;color:#fff;text-shadow:1px 1px 0 #0a1430;margin-right:2px}
:is(#psmod-tip,#psmod-mtip) .nx{margin-top:4px;color:#ffd23f;font-size:11px}
:is(#psmod-tip,#psmod-mtip) hr{border:0;border-top:1px solid rgba(255,255,255,.15);margin:6px 0}`;
    document.head.appendChild(st);
    tipEl = document.createElement('div');
    tipEl.id = 'psmod-tip';
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
    let lastKey = '';
    const hide = () => { if (!tipEl.hidden) tipEl.hidden = true; lastKey = ''; };
    addEventListener('mousemove', (e) => {
      const pl = me();
      if (!pl || hudStyle !== 'new' || !hudHits.length || !e.target || e.target.tagName !== 'CANVAS' || !NS.Game || NS.Game.state !== 'playing') return hide();
      const r = e.target.getBoundingClientRect();
      const hx = (e.clientX - r.left) / hudHitK, hy = (e.clientY - r.top) / hudHitK;
      const hit = hudHits.find((h) => hx >= h.x && hx <= h.x + h.w && hy >= h.y && hy <= h.y + h.h);
      if (!hit) return hide();
      const grp = hit.kind === 'move' ? pl.slots[hit.slot] || [] : null;
      const item = hit.kind === 'mateItem' ? hit.item : pl.item;
      const wx = hit.kind === 'weather' && NS.Weather && NS.Weather.current;
      const key = hit.kind === 'move' ? 'm' + hit.slot + ':' + grp.map((m) => m.id + m.lvl + (m.evolved ? 'e' : '')).join(',')
        : wx ? 'w' + wx.kind + Math.ceil(wx.left || 0) : 'i' + item;
      if (key !== lastKey) {
        lastKey = key;
        tipEl.innerHTML = hit.kind === 'move' ? grp.map((m) => moveTip(m, pl)).join('<hr>') : wx ? weatherTip(wx, pl) : itemTip(item);
      }
      if (!tipEl.innerHTML) return hide();
      tipEl.hidden = false;
      // Above the slot, centred on it, kept on screen.
      const sx = r.left + (hit.x + hit.w / 2) * hudHitK, sy = r.top + hit.y * hudHitK;
      const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
      tipEl.style.left = Math.max(6, Math.min(innerWidth - tw - 6, sx - tw / 2)) + 'px';
      tipEl.style.top = (hit.kind === 'mateItem' || hit.kind === 'weather' ? sy + hit.h * hudHitK + 8 : Math.max(6, sy - th - 14)) + 'px';
    }, true);
    addEventListener('blur', hide);
  }
  onReady(setupTips);

  // ---- level-up screen: same size every time
  // The box used to grow and shrink with each card's text (and jump when
  // the reroll button or the co-op waiting line came and went). Now it has
  // a fixed width, every card a fixed height (two lines of description;
  // hover a card for the full text), the reroll button keeps its space when
  // you run out, and in co-op the waiting line keeps its height.
  function setupLevelUpSize() {
    if (document.getElementById('psmod-lvl-css')) return;
    const st = document.createElement('style');
    st.id = 'psmod-lvl-css';
    st.textContent = `
#scr-levelup .box{width:min(640px,calc(100vw - 20px));box-sizing:border-box}
#scr-levelup .cards{width:100%;min-height:calc(var(--psm-card,86px) * 3 + 20px)}
#scr-levelup .card{height:var(--psm-card,86px);box-sizing:border-box;overflow:hidden;flex:0 0 auto}
#scr-levelup .card .txt{min-width:0;overflow:hidden}
#scr-levelup .card .nm{flex-wrap:nowrap;white-space:nowrap;overflow:hidden}
#scr-levelup .card .nm .tag-chip{flex:0 1 auto;overflow:hidden;text-overflow:ellipsis}
#scr-levelup .card .ds{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.25}
#scr-levelup #lvl-reroll.hidden{display:inline-block!important;visibility:hidden;pointer-events:none}
#scr-levelup #lvl-wait{min-height:1.3em}
@media (max-height:520px){#scr-levelup{--psm-card:64px}#scr-levelup .card{padding:6px 10px}#scr-levelup .card .ds{font-size:12px}#scr-levelup .card .nm{font-size:15px}}`;
    document.head.appendChild(st);
    // Full description on hover (it may be cut to two lines).
    const cards = document.getElementById('cards');
    if (cards) new MutationObserver(() => {
      for (const c of cards.querySelectorAll('.card')) {
        const ds = c.querySelector('.ds'), nm = c.querySelector('.nm');
        if (ds && !c.title) c.title = ((nm ? nm.textContent.trim() + '\n' : '') + ds.textContent.trim());
      }
    }).observe(cards, { childList: true });
  }
  onReady(setupLevelUpSize);

  // ---- pause menu from the level-up screen
  // Esc / P (Start on a controller) or the button opens the pause menu (with
  // Settings) over the cards; Continue goes back to them. The cards can't be
  // picked while it's open.
  let lvlPause = false;
  const isShown = (id) => { const el = document.getElementById(id); return !!el && !el.classList.contains('hidden'); };
  function openLvlPause() {
    if (lvlPause || !NS.RunUI || !isShown('scr-levelup')) return;
    lvlPause = true;
    try { NS.RunUI.showPause(!!(NS.Coop && NS.Coop.active)); } catch (_) { document.getElementById('scr-pause').classList.remove('hidden'); }
    document.getElementById('scr-levelup').classList.add('hidden');
    NS.Audio && NS.Audio.sfx('pause');
  }
  function closeLvlPause() {
    if (!lvlPause) return;
    lvlPause = false;
    document.getElementById('scr-pause').classList.add('hidden');
    if (NS.Game && NS.Game.state === 'levelup') document.getElementById('scr-levelup').classList.remove('hidden');
  }
  function setupLevelUpPause() {
    const box = document.querySelector('#scr-levelup .box'), resume = document.getElementById('btn-resume');
    if (!box || !resume || document.getElementById('psmod-lvl-pause')) return;
    const st = document.createElement('style');
    st.textContent = '#scr-levelup .box{position:relative}#psmod-lvl-pause{position:absolute;top:12px;right:12px}' +
      '@media (max-height:520px){#psmod-lvl-pause{top:6px;right:8px}}';
    document.head.appendChild(st);
    const b = document.createElement('button');
    b.id = 'psmod-lvl-pause';
    b.className = 'btn small ghost';
    b.dataset.sfx = 'none';
    b.title = 'Pause menu and settings (the cards wait for you)';
    box.appendChild(b);
    const label = () => {
      const pb = binds.pause || [];
      const k = showPadLabels() && pb[2] ? bareName(pb[2]) : 'Esc';
      const txt = `Pause · ${k}`;
      if (b.textContent !== txt) b.textContent = txt;
    };
    label();
    setInterval(() => { if (isShown('scr-levelup')) label(); }, 500);
    b.addEventListener('click', (e) => { e.stopPropagation(); b.blur(); openLvlPause(); });
    // Continue: back to the cards (if they're still waiting).
    resume.addEventListener('click', (e) => {
      if (!lvlPause) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (NS.Game && NS.Game.state === 'levelup') closeLvlPause();
      else { lvlPause = false; document.getElementById('scr-pause').classList.add('hidden'); }
    }, true);
    const quit = document.getElementById('btn-quit');
    if (quit) quit.addEventListener('click', () => { lvlPause = false; }, true);
  }
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    const pauseKey = e.code === 'Escape' || e.code === 'KeyP' || (binds.pause || []).slice(0, 2).includes(e.code);
    if (lvlPause) {
      // While the menu is open the cards don't take keys.
      if (isShown('scr-settings')) return;
      if (pauseKey && !e.repeat) closeLvlPause();
      if (pauseKey || /^(Digit|Numpad)\d$/.test(e.code) || e.code === 'KeyR') { e.stopImmediatePropagation(); e.preventDefault(); }
      return;
    }
    if (pauseKey && !e.repeat && isShown('scr-levelup') && !isShown('scr-settings') && NS.Game && NS.Game.state === 'levelup') {
      e.stopImmediatePropagation(); e.preventDefault();
      openLvlPause();
    }
  }, true);
  // The level-up can end without you (co-op: everyone else picked): drop it.
  setInterval(() => { if (lvlPause && NS.Game && NS.Game.state !== 'levelup' && !isShown('scr-pause')) lvlPause = false; }, 500);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => waitFor(() => NS && NS.RunUI, setupLevelUpPause));
  else waitFor(() => NS && NS.RunUI, setupLevelUpPause);

  // Learning a move switched you to it; now the move you had stays active
  // (unless it's your very first one).
  function setupKeepMove() {
    // Evolving a move keeps whichever attack you had selected.
    const M = NS.Moves;
    if (M && M.evolve && !M.evolve.__psm) {
      const evolve = M.evolve;
      M.evolve = function (m) {
        const p = me(), keep = p && p.slots ? p.slots[p.active] : null;
        const out = evolve.apply(this, arguments);
        if (p && keep && p.slots[p.active] !== keep) { const i = p.slots.indexOf(keep); if (i >= 0) p.active = i; }
        return out;
      };
      M.evolve.__psm = true;
    }
    const P = NS.Player.prototype, add = P.addMove;
    P.addMove = function () {
      const was = this.slots && this.slots[this.active];
      const out = add.apply(this, arguments);
      if (out && was && this === me() && this.slots[this.active] !== was) {
        const i = this.slots.indexOf(was);
        if (i >= 0) { this.active = i; try { NS.Projectiles.clearOrbs(this); } catch {} }
      }
      return out;
    };
  }

  // Fused slots show up to four small icons and no levels. Same layout as
  // the game's slot bar (54 px slots, 9 px apart, 18 px from the bottom, the
  // active one raised 6 px): we add a level badge to every move, gold when it
  // is maxed and a star when it has evolved.
  function drawSlotLevels(ctx, w, h, pl) {
    const S = 54, GAP = 9, ICON = 22;
    const n = Math.max(1, pl.slots.length);
    const x0 = (w - (n * S + GAP * (n - 1))) / 2;
    const y0 = h - S - 18;
    ctx.save();
    ctx.font = '700 10px Pixelify, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const badge = (m, cx, cy) => {
      const max = m.def ? m.def.maxLvl : 5;
      const text = m.evolved ? '★' : String(m.lvl);
      const bw = Math.max(11, ctx.measureText(text).width + 5), bh = 11;
      ctx.fillStyle = 'rgba(8,14,30,.92)';
      ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
      ctx.fillStyle = m.evolved || m.lvl >= max ? '#ffd23f' : '#ffffff';
      ctx.fillText(text, cx, cy + 0.5);
    };
    for (let i = 0; i < n; i++) {
      const g = pl.slots[i] || [];
      if (!g.length) continue;
      const x = x0 + (S + GAP) * i, y = i === pl.active ? y0 - 6 : y0;
      if (g.length > 1) {
        const pad = (S - 2 * ICON) / 3;
        g.forEach((m, j) => {
          const ix = x + pad + (j % 2) * (ICON + pad), iy = y + pad + Math.floor(j / 2) * (ICON + pad);
          badge(m, ix + ICON - 4, iy + ICON - 4);
        });
      } else {
        badge(g[0], x + S - 8, y + 8);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------- damage meter
  // Each player's own client already counts `player.dmgDealt` (never shown).
  // Clients with the mod piggyback that number on the state message they send
  // the host ({k:'f'} + psm); the host relays the whole table back the same
  // way. Unknown keys are ignored by the game, so unmodded friends are fine.
  // For mates without the mod the host estimates from the hit events ('h')
  // they send it, which is why the host should be someone with the mod.
  const rows = new Map(); // uid -> { dmg, est, live }
  let runPlayer = null, runId = 0, runTime = 0, lastFrame = 0;

  const me = () => (NS.Coop.active ? NS.Coop.local : NS.Game.player) || null;
  const myDmg = () => { const p = me(); return (p && p.dmgDealt) || 0; };
  const inRun = () => !!me() && NS.Game.state !== 'ui';
  // The minimap and damage panel step out of the way of the Settings screen.
  const settingsOpen = () => { const s = document.getElementById('scr-settings'); return !!s && !s.classList.contains('hidden'); };

  function row(uid) {
    let r = rows.get(uid);
    if (!r) rows.set(uid, (r = { dmg: 0, est: 0, live: false }));
    return r;
  }

  function wireTable() {
    const p = me();
    const t = { [NS.Net.uid]: [Math.round(myDmg()), 1, (p && p.item) || ''] };
    for (const [uid, r] of rows) {
      if (uid !== NS.Net.uid) t[uid] = [Math.round(r.live ? r.dmg : r.est), r.live ? 1 : 0, r.item || ''];
    }
    return t;
  }

  // ---- spectating while down
  // The camera follows a living teammate while you're down (switch with
  // previous / next attack), and snaps back to you once your revive is 75%
  // done. Your body stays where it fell.
  // In co-op the host only sends each player the enemies near their own
  // Pokémon. When the host also has PokeSurvivor Plus, it adds the enemies
  // near whoever you're watching (closest first, capped, only while you
  // spectate), so you see the fight; otherwise those enemies don't move on
  // your screen ("limited view").
  let specOn = load('spectate', true);
  let specUid = null, specActive = false, hostHasPlus = false;
  const watching = new Map(); // host: player uid -> uid they're watching
  const SPEC_ANIMS = ['Idle', 'Walk', 'Attack', 'Shoot', 'Charge', 'Hurt', 'Faint'];
  const SPEC_CAP = 70, SPEC_CAP_SLOW = 25, SPEC_R = 950;
  const isDown = (pl) => !!(pl && (pl.dead || (pl.net && pl.net.dead)));
  function specCandidates() {
    return NS.Coop && NS.Coop.active ? NS.Coop.mates.filter((m) => m.connected && m.pl && !isDown(m.pl)) : [];
  }
  function specTarget() {
    const p = me();
    if (!specOn || !p || !p.dead || !NS.Coop || !NS.Coop.active) return null;
    const RT = (NS.Player && NS.Player.REVIVE_TIME) || 3;
    if ((p.reviveT || 0) / RT >= 0.75) return null;
    const list = specCandidates();
    if (!list.length) return null;
    let m = list.find((x) => x.uid === specUid);
    if (!m) { m = list[0]; specUid = m.uid; }
    return m;
  }
  function specCycle(d) {
    const list = specCandidates();
    if (list.length < 2) return;
    const i = Math.max(0, list.findIndex((x) => x.uid === specUid));
    specUid = list[(i + d + list.length) % list.length].uid;
  }
  function setupSpectate() {
    const C = NS.Camera, follow = C.follow;
    C.follow = function (tx, ty, dt) {
      const m = specTarget();
      if (m) { specActive = true; return follow.call(this, m.pl.x, m.pl.y, dt); }
      if (specActive) {
        // Back to you right away, so you can get ready before you're up.
        specActive = false;
        const p = me();
        if (p) { this.x = p.x; this.y = p.y; }
      }
      return follow.apply(this, arguments);
    };
  }
  // Previous / next attack switch who you watch (keys, wheel, LB / RB all
  // arrive here as the game's Q / E), and don't reach the game meanwhile.
  for (const type of ['keydown', 'keyup']) {
    addEventListener(type, (e) => {
      if ((e.code !== 'KeyQ' && e.code !== 'KeyE') || !specTarget()) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (type === 'keydown' && !e.repeat) specCycle(e.code === 'KeyQ' ? -1 : 1);
    }, true);
  }
  // Host side: add positions of the enemies near the watched teammate to the
  // regular update for that player. Same format as the game's own list.
  function addWatchedEnemies(uid, m) {
    const w = watching.get(uid);
    if (!w || !Array.isArray(m.e)) return;
    const t = w === NS.Net.uid ? me() : (NS.Coop.mates.find((x) => x.uid === w) || {}).pl;
    if (!t) return;
    const have = new Set(m.e.map((a) => a[0]));
    const near = [];
    for (const e of NS.EnemyMgr.all()) {
      if (e.dead || e.remote || have.has(e.id)) continue;
      const dx = e.x - t.x, dy = e.y - t.y, d = dx * dx + dy * dy;
      if (d <= SPEC_R * SPEC_R) near.push([d, e]);
    }
    if (!near.length) return;
    near.sort((a, b) => a[0] - b[0]);
    const cap = NS.Net.slow && NS.Net.slow(uid) ? SPEC_CAP_SLOW : SPEC_CAP;
    for (let i = 0; i < near.length && i < cap; i++) {
      const e = near[i][1];
      const ai = e.anim ? SPEC_ANIMS.indexOf(e.anim.cur) : 0;
      m.e.push([e.id, Math.round(e.x), Math.round(e.y), Math.ceil(e.hp), ai < 0 ? 0 : ai, e.anim ? e.anim.dir : 0,
        (e.burn > 0 ? 1 : 0) | (e.poison > 0 ? 2 : 0) | (e.shield > 0 ? 4 : 0)]);
    }
  }

  function setupMeter() {
    const { Net, Coop } = NS;

    const toHost = Net.toHost;
    Net.toHost = function (m) {
      if (m && m.k === 'f') { m.psm = Math.round(myDmg()); const p = me(); m.psi = (p && p.item) || ''; const sm = specTarget(); if (sm) m.psw = sm.uid; }
      return toHost.apply(this, arguments);
    };
    const send = Net.send;
    Net.send = function (uid, m) {
      if (m && m.k === 'f' && Coop.isHost) { m.psm = wireTable(); addWatchedEnemies(uid, m); }
      return send.apply(this, arguments);
    };

    Net.on((from, m) => {
      if (!m || m.k !== 'f' || !Coop.active) return;
      if (Coop.isHost) {
        const r = row(from);
        if (typeof m.psm === 'number') { r.dmg = m.psm; r.live = true; }
        if (typeof m.psi === 'string') r.item = m.psi;
        if (m.psw) watching.set(from, m.psw); else watching.delete(from);
        if (Array.isArray(m.ev)) for (const e of m.ev) if (e && e[0] === 'h') r.est += +e[2] || 0;
      } else if (from === Net.hostUid && m.psm && typeof m.psm === 'object') {
        hostHasPlus = true;
        for (const uid in m.psm) {
          if (uid === Net.uid || !Array.isArray(m.psm[uid])) continue;
          const r = row(uid);
          r.dmg = +m.psm[uid][0] || 0;
          r.live = !!m.psm[uid][1];
          if (typeof m.psm[uid][2] === 'string') r.item = m.psm[uid][2];
        }
      }
    });

    buildPanel();
    buildMap();
    buildToasts();
    buildSummary();
    if (wasDiscarded && notif.conn) toast('The browser had closed the tab to save memory', '#ffcb3d', 'That is why it reloaded. Press Alt + L to view the log');
    waitFor(() => NS.Combat && NS.Projectiles && NS.Enemy && NS.Player && NS.EnemyMgr, setupMoveTracking);
    waitFor(() => NS.HUD && NS.HUD.draw && NS.Camera, setupHud);
    waitFor(() => NS.Camera && NS.Camera.follow, setupSpectate);
    waitFor(() => NS.Player && NS.Player.prototype && NS.Player.prototype.addMove, setupKeepMove);
  }

  // Run clock for DPS: the game's own run time when it exposes it (stops on
  // pause and level-up screens), else our own clock while state is 'playing'.
  function tickClock() {
    const now = performance.now();
    const dt = lastFrame ? Math.min(0.25, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    const p = me();
    if (p !== runPlayer) { runPlayer = p; runId++; rows.clear(); runTime = 0; runSeries = { step: SAMPLE_S, n: 0, players: {} }; onNewRun(); }
    const t = NS.Game.st && NS.Game.st.time;
    if (typeof t === 'number') runTime = t;
    else if (p && NS.Game.state === 'playing') runTime += dt;
    if (p && runTime >= (runSeries.n + 1) * runSeries.step) sampleRun();
    if (p) checkAlerts(p);
    checkRunEnd();
  }

  // ---- damage over time: every few seconds, each player's total so far
  const SAMPLE_S = 5, SAMPLE_MAX = 160;
  let runSeries = { step: SAMPLE_S, n: 0, players: {} };
  function sampleRun() {
    const S = runSeries;
    S.n++;
    for (const e of entries()) {
      const k = e.me ? '@me' : e.name;
      const row = S.players[k] || (S.players[k] = { name: e.name, color: e.color, me: !!e.me, pts: [] });
      while (row.pts.length < S.n - 1) row.pts.push(row.pts.length ? row.pts[row.pts.length - 1] : 0);
      row.pts.push(Math.round(e.dmg || 0));
    }
    // Long runs: halve the resolution instead of growing forever.
    if (S.n > SAMPLE_MAX) {
      for (const k in S.players) S.players[k].pts = S.players[k].pts.filter((_, i) => i % 2 === 1);
      S.n = Math.floor(S.n / 2);
      S.step *= 2;
    }
  }

  function entries() {
    const p = me();
    if (!p) return [];
    const list = [{
      name: (NS.Social && NS.Social.me && NS.Social.me.name) || 'You',
      color: p.tagColor || '#ffd23f',
      dmg: myDmg(),
      exact: true,
      me: true,
      hp: p.hp, maxHp: p.maxHp, dead: !!p.dead,
    }];
    if (NS.Coop.active) {
      for (const m of NS.Coop.mates) {
        if (!m.connected) continue;
        const r = rows.get(m.uid);
        const known = r && (r.live || NS.Coop.isHost);
        const n = (m.pl && m.pl.net) || {};
        list.push({ name: m.name, color: m.color, dmg: known ? (r.live ? r.dmg : r.est) : null, exact: !!(r && r.live), hp: n.hp, maxHp: n.maxHp, dead: !!n.dead });
      }
    }
    return list.sort((a, b) => (b.dmg ?? -1) - (a.dmg ?? -1));
  }

  // ----------------------------------------------------------------- UI
  const fmt = (n) => {
    if (n == null) return '?';
    if (n >= 1e6) return (n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) + 'M';
    if (n >= 1e5) return (n / 1e3).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'k';
    return Math.round(n).toLocaleString();
  };
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  // Damage panel, in the classic style: one row per player with damage,
  // damage per second and share of the team's damage; click your row for
  // damage per attack; your upgrades and multipliers are listed below. By default it only
  // shows while you hold Tab (Select toggles it on a controller), so it never
  // sits over the game; "Always on" in Settings > Extras keeps it up.
  let panel = null, body = null, timeLabel = null, buffsEl = null, lastHtml = '', lastBuffs = '';
  let showMoves = load('showMoves', false);
  let shown = load('shown', true);
  // Tab holds or toggles the panel; 'always' keeps it up. (Older saves had
  // a single panelMode setting.)
  let panelKey = load('panelKey', 'hold');
  let panelAlways = load('panelAlways', load('panelMode', 'hold') === 'always');
  let statsHeld = false, statsToggled = false;

  const CSS = `
#psmod{position:fixed;z-index:99999;width:272px;overflow:hidden;transform-origin:0 0;font:13px/1.25 var(--font,'Pixelify',system-ui,sans-serif);color:#fff;
  background:linear-gradient(#2c519f,#1a3170);border:2px solid #f4f8ff;outline:2px solid #0b1838;border-radius:8px;
  box-shadow:inset 0 0 0 2px #5b83d6,0 4px 0 #0a1430;user-select:none;-webkit-user-select:none}
#psmod.psmod-hidden{display:none}
#psmod .ps-head{display:flex;align-items:center;gap:6px;padding:6px 8px 4px;cursor:move;font-weight:700;letter-spacing:.06em}
#psmod .ps-head b{flex:1;color:#ffd23f}
#psmod .ps-time{font-weight:600;color:#b9cbf0}
#psmod .ps-rows{padding:0 6px 6px}
#psmod .ps-row{position:relative;margin:3px 0;padding:3px 6px;border-radius:4px;background:#0b1838;overflow:hidden}
#psmod .ps-bar{position:absolute;inset:0 auto 0 0;opacity:.35}
#psmod .ps-line{position:relative;display:flex;gap:6px;align-items:baseline}
#psmod .ps-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700}
#psmod .ps-dmg{font-weight:700}
#psmod .ps-sub{position:relative;display:flex;justify-content:space-between;font-size:11px;color:#b9cbf0}
#psmod .ps-empty{padding:6px;font-size:12px;color:#b9cbf0}
#psmod button{font:inherit;font-weight:700;color:#fff;background:#0b1838;border:2px solid #5b83d6;border-radius:4px;cursor:pointer;white-space:nowrap;flex:none}
#psmod button:hover{border-color:#ffd23f}
#psmod .ps-head button{height:20px;min-width:0;padding:0 5px;font-size:11px;letter-spacing:0}
#psmod .ps-head button.on{border-color:#ffd23f;color:#ffd23f}
#psmod .ps-row.me{cursor:pointer}
#psmod .ps-dead{color:#ff5f6d;font-weight:700}
#psmod .ps-moves{position:relative;margin-top:4px;display:grid;gap:2px;font-size:11.5px}
#psmod .ps-mv{display:flex;gap:6px}
#psmod .ps-mv span:first-child{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#psmod .ps-mv span:last-child{color:#b9cbf0;min-width:32px;text-align:right}
#psmod .ps-hint{position:relative;font-size:10.5px;color:#b9cbf0}
#psmod [hidden]{display:none!important}
#psmod .ps-buffs{padding:4px 8px 6px;border-top:2px solid #0b1838;font-size:11.5px;display:grid;gap:2px}
#psmod .ps-buffs h4{margin:4px 0 1px;font-size:11px;letter-spacing:.06em;color:#ffd23f}
#psmod .ps-buffs .kv{display:flex;gap:6px}
#psmod .ps-buffs .kv span:first-child{flex:1;color:#b9cbf0}
#psmod .ps-buffs .kv b{white-space:nowrap}
`;

  function buildPanel() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    panel = document.createElement('div');
    panel.id = 'psmod';
    panel.innerHTML = `
      <div class="ps-head"><b>DAMAGE</b><span class="ps-time">0:00</span></div>
      <div class="ps-rows"></div>
      <div class="ps-buffs"></div>`;
    document.body.appendChild(panel);
    body = panel.querySelector('.ps-rows');
    timeLabel = panel.querySelector('.ps-time');
    buffsEl = panel.querySelector('.ps-buffs');
    // Click your own row to see the damage of each of your moves.
    body.addEventListener('click', (e) => {
      if (!e.target.closest('.ps-row.me')) return;
      showMoves = !showMoves;
      save('showMoves', showMoves);
      render();
    });
    // Stop clicks reaching the game canvas underneath.
    for (const ev of ['pointerdown', 'mousedown', 'touchstart']) panel.addEventListener(ev, (e) => e.stopPropagation());

    // The game's HUD (name, HP, buffs and the co-op list) sits top-left and
    // grows with the HUD size, so the panel starts below it.
    makeDraggable(panel, panel.querySelector('.ps-head'), 'pos', () => ({ x: 12, y: Math.round(130 * hudScale) }));
    const update = () => { tickClock(); render(); };
    setInterval(update, 250);
    update();
  }

  // Hold (keys / mouse) or toggle (controller) the panel.
  function setStatsHeld(v) {
    if (statsHeld === v) return;
    statsHeld = v;
    if (panel) render();
  }
  function toggleStats() {
    statsToggled = !statsToggled;
    if (panel) render();
  }
  addEventListener('blur', () => setStatsHeld(false));

  // Drag `el` by `handle`, keep it on screen and remember where it was left.
  // `def` may be a function so it can depend on the window size. A position
  // closer to the right edge is saved as a distance from that edge, so things
  // parked on the right stay there when the window changes size.
  function makeDraggable(el, handle, key, def) {
    let pos = load(key, null) || (typeof def === 'function' ? def() : def);
    const place = () => {
      const w = el.offsetWidth, h = el.offsetHeight;
      const x = pos.right != null ? innerWidth - w - pos.right : pos.x;
      el.style.left = Math.max(0, Math.min(innerWidth - w, x)) + 'px';
      el.style.top = Math.max(0, Math.min(innerHeight - h, pos.y)) + 'px';
    };
    place();
    // Hidden elements have no size yet, so place again once they show up.
    new ResizeObserver(() => { if (el.offsetWidth) place(); }).observe(el);
    addEventListener('resize', place);

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, .ps-corner')) return;
      const dx = e.clientX - el.offsetLeft, dy = e.clientY - el.offsetTop;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => { pos = { x: ev.clientX - dx, y: ev.clientY - dy }; place(); };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        const l = el.offsetLeft, r = innerWidth - l - el.offsetWidth;
        pos = r < l ? { right: Math.max(0, r), y: el.offsetTop } : { x: l, y: el.offsetTop };
        save(key, pos);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
    return {
      moveTo(x, y) { pos = { x, y }; place(); },
      commit() {
        const l = el.offsetLeft, r = innerWidth - l - el.offsetWidth;
        pos = r < l ? { right: Math.max(0, r), y: el.offsetTop } : { x: l, y: el.offsetTop };
        save(key, pos);
      },
    };
  }

  function renderFov() { refreshExtras(); }

  function render() {
    const want = panelAlways || statsHeld || statsToggled;
    const vis = shown && want && inRun() && !settingsOpen();
    panel.classList.toggle('psmod-hidden', !vis);
    if (!inRun()) statsToggled = false;
    if (!vis) return;
    timeLabel.textContent = clock(runTime);
    const list = entries();
    const total = list.reduce((s, e) => s + (e.dmg || 0), 0);
    const top = Math.max(1, ...list.map((e) => e.dmg || 0));
    const secs = Math.max(1, runTime);
    const html = list.map((e) => {
      const pct = total > 0 && e.dmg != null ? Math.round((e.dmg / total) * 100) + '%' : '';
      const dps = e.dmg != null ? fmt(e.dmg / secs) + '/s' : 'no mod';
      const approx = e.dmg != null && !e.exact ? '~' : '';
      const down = e.dead ? `<div class="ps-sub"><span class="ps-dead">${e.me ? 'Down' : 'Down — go revive them'}</span></div>` : '';
      const moves = e.me ? (showMoves ? movesHtml() : '<div class="ps-hint">Click to see damage by attack</div>') : '';
      return `<div class="ps-row${e.me ? ' me' : ''}">
        <div class="ps-bar" style="width:${((e.dmg || 0) / top) * 100}%;background:${esc(e.color)}"></div>
        <div class="ps-line"><span class="ps-name" style="color:${esc(e.color)}">${esc(e.name)}</span><span class="ps-dmg">${approx}${fmt(e.dmg)}</span></div>
        <div class="ps-sub"><span>${dps}</span><span>${pct}</span></div>
        ${down}${moves}
      </div>`;
    }).join('') || '<div class="ps-empty">No data yet</div>';
    if (html !== lastHtml) { body.innerHTML = html; lastHtml = html; }
    const bh = buffsHtml();
    if (bh !== lastBuffs) { buffsEl.innerHTML = bh; lastBuffs = bh; }
    fitPanel();
  }

  // No scrollbars: the panel is as tall as its content, and scales itself
  // down (to half size at most) when that would run off the bottom.
  function fitPanel() {
    panel.style.transform = '';
    const h = panel.offsetHeight;
    const top = parseFloat(panel.style.top) || panel.getBoundingClientRect().top;
    const avail = innerHeight - top - 10;
    const k = h > avail ? Math.max(0.5, avail / h) : 1;
    if (k < 1) panel.style.transform = `scale(${k.toFixed(3)})`;
  }

  function onNewRun() {
    runWasEndless = endlessRun;
    moveDmg.clear();
    alerted.clear();
    sparkled.clear();
    mateState.clear();
    lastRift = null;
    runEnded = false;
  }

  // ---------------------------------------------------- per-move damage
  // Enemy.hurt() doesn't say which move hit, so we track where in the frame we
  // are. The game loop runs Combat.tick (casts; melee, beams, chains and
  // auras hit right after Player.cast), Combat.resolve (projectiles and orbs)
  // and Combat.updateFields (mines, puddles, meteors, turrets). Projectiles get
  // tagged with the move that spawned them; field hits are matched by the
  // move's type colour. Burn and poison ticks are counted apart (solo only:
  // in co-op the host can't tell whose status it was).
  const moveDmg = new Map(); // move id | 'burn' | 'poison' | 'other' -> damage
  let scope = null, curMove = null, curProj = null;
  const BURN_COL = '#ff9a4d', POISON_COL = '#d47cf0';

  function credit(key, n) { moveDmg.set(key, (moveDmg.get(key) || 0) + n); }

  function byColor(color, kinds) {
    const p = me();
    const C = NS.U && NS.U.TYPE_COLOR;
    if (!p || !C) return 'other';
    const hits = p.moves.filter((m) => C[m.type] === color && (!kinds || kinds.includes(m.kind)));
    return hits.length ? hits[0].id : 'other';
  }
  const FIELD_KINDS = ['mine', 'trail', 'meteor', 'turret'];

  function setupMoveTracking() {
    const { Combat, Projectiles, Enemy, Player, EnemyMgr } = NS;
    const around = (obj, name, enter, leave) => {
      const f = obj[name];
      obj[name] = function () {
        enter.apply(this, arguments);
        try { return f.apply(this, arguments); } finally { leave(); }
      };
    };
    around(Combat, 'tick', (dt, pl) => { scope = pl && pl === me() ? 'tick' : null; curMove = null; }, () => { scope = null; curMove = null; });
    around(Combat, 'resolve', () => { scope = 'resolve'; curProj = null; }, () => { scope = null; curProj = null; });
    around(Combat, 'updateFields', () => { scope = 'fields'; }, () => { scope = null; });
    around(EnemyMgr, 'update', () => { scope = 'dot'; }, () => { scope = null; });

    const cast = Player.prototype.cast;
    Player.prototype.cast = function (m) {
      if (scope === 'tick' && this === me()) curMove = m;
      return cast.apply(this, arguments);
    };

    const spawn = Projectiles.spawn;
    Projectiles.spawn = function (o) {
      const mid = scope === 'tick' && curMove ? curMove.id : scope === 'fields' && o ? byColor(o.color, ['turret']) : null;
      if (mid && o) o.__mid = mid;
      const out = spawn.apply(this, arguments);
      if (mid && out && typeof out === 'object') out.__mid = mid;
      return out;
    };

    // While resolving, hand out a view of the projectile list that notes which
    // projectile the loop is looking at.
    const all = Projectiles.all;
    Projectiles.all = function () {
      const arr = all.apply(this, arguments);
      if (scope !== 'resolve' || !Array.isArray(arr)) return arr;
      return new Proxy(arr, {
        get(t, k) {
          if (typeof k === 'string' && /^\d+$/.test(k)) {
            const v = t[k];
            if (v && typeof v === 'object') curProj = v;
            return v;
          }
          const v = Reflect.get(t, k);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
    };

    const hurt = Enemy.prototype.hurt;
    Enemy.prototype.hurt = function (dmg, color) {
      if (scope && !this.dead) {
        const n = Math.max(1, Math.round(+dmg || 0));
        if (scope === 'tick') credit(curMove ? curMove.id : byColor(color), n);
        else if (scope === 'resolve') {
          const pr = curProj;
          credit((pr && (pr.__mid || (pr.orb && pr.mid))) || byColor(color), n);
        } else if (scope === 'fields') credit(byColor(color, FIELD_KINDS), n);
        else if (scope === 'dot' && !NS.Coop.active) {
          if (color === BURN_COL) credit('burn', n);
          else if (color === POISON_COL) credit('poison', n);
        }
      }
      return hurt.apply(this, arguments);
    };
  }

  function moveList() {
    const p = me();
    const names = { burn: 'Burn', poison: 'Poison', other: 'Other' };
    if (p) for (const m of p.moves) names[m.id] = tr(m.name);
    const total = [...moveDmg.values()].reduce((a, b) => a + b, 0);
    return [...moveDmg.entries()]
      .map(([k, v]) => ({ key: k, name: names[k] || k, dmg: v, pct: total ? v / total : 0 }))
      .sort((a, b) => b.dmg - a.dmg);
  }

  function movesHtml() {
    const list = moveList();
    if (!list.length) return '<div class="ps-moves"><div class="ps-hint">You have not dealt any damage yet</div></div>';
    return `<div class="ps-moves">${list.map((m) => `<div class="ps-mv"><span>${esc(m.name)}</span><span>${fmt(m.dmg)}</span><span>${Math.round(m.pct * 100)}%</span></div>`).join('')}</div>`;
  }

  // ------------------------------------------------------------- alerts
  const alerted = new Set();
  const alertedAt = new Map(); // alert text -> when it was last shown
  const mateState = new Map();
  let lastRift = null;
  let alertSound = load('alertSound', true);
  let toastBox = null;

  function setAlertSound(v) { alertSound = v; save('alertSound', v); renderAlertsBtn(); }
  function renderAlertsBtn() { refreshExtras(); }

  function buildToasts() {
    const style = document.createElement('style');
    style.textContent = `
#psmod-toasts{position:fixed;z-index:100000;left:50%;top:72px;transform:translateX(-50%);display:grid;gap:6px;justify-items:center;pointer-events:none;
  font:14px/1.25 var(--font,'Pixelify',system-ui,sans-serif)}
#psmod-toasts div{background:#0b1838;color:#fff;border:2px solid var(--c,#f4f8ff);border-radius:8px;padding:6px 12px;box-shadow:0 3px 0 #0a1430;
  font-weight:700;width:max-content;max-width:min(92vw,560px);box-sizing:border-box;overflow-wrap:anywhere;text-align:center}
#psmod-toasts small{display:block;font-weight:600;color:#b9cbf0;font-size:12px}
@media (prefers-reduced-motion:no-preference){#psmod-toasts div{animation:psmod-in .18s ease-out}}
@keyframes psmod-in{from{transform:translateY(-8px);opacity:0}to{transform:none;opacity:1}}`;
    document.head.appendChild(style);
    toastBox = document.createElement('div');
    toastBox.id = 'psmod-toasts';
    toastBox.setAttribute('role', 'status');
    document.body.appendChild(toastBox);
  }

  function toast(text, color, sub) {
    if (!toastBox) return;
    const d = document.createElement('div');
    d.style.setProperty('--c', color || '#f4f8ff');
    d.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : '');
    toastBox.appendChild(d);
    while (toastBox.children.length > 4) toastBox.firstChild.remove();
    setTimeout(() => d.remove(), 4500);
  }

  function sound(name) {
    if (!alertSound) return;
    if (name === 'sparkle') { sparkle(); return; }
    try { NS.Audio.sfx(name); } catch {}
  }

  // Shiny sound: a sparkle like the one of the main games when a shiny shows
  // up (synthesised here: two quick runs of bell-like pings over a little
  // shimmer, no audio files). It replaces the game's 'shiny' sfx when a shiny
  // spawns and for shiny cards in the gacha; the other uses of that sfx
  // (invites, tickets) keep the game's sound. Volume follows the game's
  // effects volume and mute ('ps.audio').
  let sparkleCtx = null, sparkleAt = 0;
  const sparkled = new Set(); // shiny enemy ids already announced

  // Small synthesised sounds for chat and pings (follow the game's effects
  // volume and mute, like the sparkle).
  function blip(kind) {
    let vol = 0.7;
    try { const a = JSON.parse(localStorage.getItem('ps.audio') || '{}'); if (a.muted) return; if (typeof a.sfx === 'number') vol = a.sfx; } catch {}
    if (vol <= 0) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = sparkleCtx || (sparkleCtx = new AC());
      if (ac.state === 'suspended') ac.resume();
      const out = ac.createGain();
      out.gain.value = 0.26 * vol;
      out.connect(ac.destination);
      const now = ac.currentTime + 0.01;
      const note = (t, f, len, type = 'triangle', g = 0.6, f2 = f) => {
        const o = ac.createOscillator(), e = ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f, now + t);
        if (f2 !== f) o.frequency.exponentialRampToValueAtTime(f2, now + t + len);
        e.gain.setValueAtTime(0.0001, now + t);
        e.gain.exponentialRampToValueAtTime(g, now + t + 0.008);
        e.gain.exponentialRampToValueAtTime(0.0001, now + t + len);
        o.connect(e).connect(out);
        o.start(now + t); o.stop(now + t + len + 0.02);
      };
      if (kind === 'send') { note(0, 784, 0.07, 'triangle', 0.5); note(0.06, 1175, 0.11, 'triangle', 0.45); }
      else if (kind === 'help') { note(0, 1319, 0.1, 'square', 0.22); note(0.12, 988, 0.1, 'square', 0.22); note(0.24, 1319, 0.14, 'square', 0.22); }
      else if (kind === 'boss') { note(0, 220, 0.22, 'sawtooth', 0.25, 160); note(0.02, 659, 0.18, 'triangle', 0.4); }
      else if (kind === 'chest') { [1047, 1319, 1568].forEach((f, i) => note(i * 0.05, f, 0.12, 'square', 0.18)); }
      else { note(0, 1568, 0.16, 'sine', 0.55); note(0.01, 3136, 0.1, 'sine', 0.18); }
    } catch (_) { /* no sound */ }
  }
  function sparkle() {
    const t0 = performance.now();
    if (t0 - sparkleAt < 1500) return; // spawn sound and our alert, once
    sparkleAt = t0;
    let vol = 0.7;
    try { const a = JSON.parse(localStorage.getItem('ps.audio') || '{}'); if (a.muted) return; if (typeof a.sfx === 'number') vol = a.sfx; } catch {}
    if (vol <= 0) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = sparkleCtx || (sparkleCtx = new AC());
      if (ac.state === 'suspended') ac.resume();
      const out = ac.createGain();
      out.gain.value = 0.32 * vol;
      out.connect(ac.destination);
      const now = ac.currentTime + 0.02;
      const ping = (t, f, len, g) => {
        for (const [mul, type, amp] of [[1, 'triangle', 1], [2.01, 'sine', 0.35]]) {
          const o = ac.createOscillator(), e = ac.createGain();
          o.type = type;
          o.frequency.setValueAtTime(f * mul, t);
          o.frequency.exponentialRampToValueAtTime(f * mul * 1.015, t + len);
          e.gain.setValueAtTime(0.0001, t);
          e.gain.exponentialRampToValueAtTime(g * amp, t + 0.006);
          e.gain.exponentialRampToValueAtTime(0.0001, t + len);
          o.connect(e).connect(out);
          o.start(t);
          o.stop(t + len + 0.02);
        }
      };
      // Two sparkles, the second one a step higher and softer.
      const RUN = [2093, 2637, 3136, 3951, 4699];
      RUN.forEach((f, i) => ping(now + i * 0.035, f, 0.28, 0.5));
      RUN.forEach((f, i) => ping(now + 0.3 + i * 0.035, f * 1.122, 0.36, 0.38));
      // Shimmer: high-passed noise under both runs.
      const len = 0.75, buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const n = ac.createBufferSource(), hp = ac.createBiquadFilter(), ng = ac.createGain();
      n.buffer = buf;
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      ng.gain.value = 0.12;
      n.connect(hp).connect(ng).connect(out);
      n.start(now);
      setTimeout(() => out.disconnect(), 1500);
    } catch {}
  }

  function setupShinySound() {
    const A = NS.Audio;
    const sfx = A.sfx;
    A.sfx = function (name) {
      if (name === 'shiny') {
        if (NS.UI && NS.UI.isOpen && NS.UI.isOpen('scr-gacha')) { sparkle(); return; }
        const fresh = NS.EnemyMgr && NS.EnemyMgr.all().filter((e) => e.shiny && !e.dead && !sparkled.has(e.id));
        if (fresh && fresh.length) { for (const e of fresh) sparkled.add(e.id); sparkle(); return; }
      }
      return sfx.apply(this, arguments);
    };
  }
  waitFor(() => NS && NS.Audio && NS.Audio.sfx, setupShinySound);

  const ARROWS = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  function where(p, x, y) {
    const dx = x - p.x, dy = y - p.y;
    const tiles = Math.round(Math.hypot(dx, dy) / 32);
    const a = ARROWS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
    return `${a} ${tiles} tiles away`;
  }

  function checkAlerts(p) {
    if (!inRun()) return;
    // Only shinies (and teammates going down, below) get a pop-up now.
    for (const e of NS.EnemyMgr.all()) {
      if (e.dead || alerted.has(e.id)) continue;
      let text = null, color = '#f4f8ff', sfx = null;
      if (e.judge || e.legend) { alerted.add(e.id); continue; }
      if (e.shiny) { text = `Shiny! ${e.name}`; color = '#7fe0ff'; sfx = 'sparkle'; sparkled.add(e.id); }
      if (!text) continue;
      alerted.add(e.id);
      // Enemies can come back with new ids in co-op: one notice per name a while.
      const last = alertedAt.get(text) || 0;
      if (performance.now() - last < 20000) continue;
      alertedAt.set(text, performance.now());
      if (!notif.shiny) continue;
      toast(text, color, where(p, e.x, e.y));
      sound(sfx);
    }

    if (NS.Coop.active) {
      for (const m of NS.Coop.mates) {
        if (!m.connected || !m.pl) continue;
        const n = m.pl.net || {};
        const st = n.dead ? 'dead' : n.maxHp > 0 && n.hp / n.maxHp < 0.3 ? 'low' : 'ok';
        const prev = mateState.get(m.uid) || 'ok';
        if (st !== prev) {
          if (st === 'dead' && notif.down) { toast(`${m.name} is down — go revive them`, '#ff5f6d', where(p, m.pl.x, m.pl.y)); sound('error'); }
          mateState.set(m.uid, st);
        }
      }
    }
  }

  // ------------------------------------------------ run summary, history
  // When a run ends (game over, or leaving a run that lasted over a minute) we
  // save a summary in this browser. It doesn't pop up: a "Runs" button on the
  // main menu (and on the game-over screen) opens a window with your latest
  // runs; pick one to see its details. Alt + H also opens it.
  const HISTORY_MAX = 30;
  let runEnded = false, sumEl = null, lastState = null, sumPick = 0;

  function checkRunEnd() {
    const st = NS.Game.state;
    const was = lastState;
    lastState = st;
    if (runEnded || !runPlayer) return;
    if (st === 'over' || (st === 'ui' && was && was !== 'ui' && runTime > 60)) {
      runEnded = true;
      const s = buildRunSummary(runPlayer);
      const wasEndless = endlessRun || runWasEndless;
      if (wasEndless) {
        // Kept apart: its own records, no per-Pokémon records, not your best solo time.
        s.endless = true;
        s.records = [];
        const beat = endlessRecord(s);
        endEndless();
        runWasEndless = false;
        try { markEndlessOver(beat); } catch (err) { trip('endless', err); }
      } else s.records = updateRecords(s);
      if (s.records.length && notif.records) {
        const NAMES = { time: 'longest run', level: 'highest level', kills: 'most defeated', dps: 'best damage/s', dmg: 'most damage' };
        setTimeout(() => toast(`New record with ${tr(s.mon)}!`, '#ffd23f', s.records.map((r) => NAMES[r]).join(' · ')), 600);
      }
      if ((s.coop || 1) <= 1 && !s.endless) save('bestSolo', Math.max(soloBest(), Math.floor(s.time || 0)));
      const hist = load('history', []);
      hist.unshift(s);
      save('history', hist.slice(0, HISTORY_MAX));
      save('historyNew', true);
      syncRunsButtons();
    }
  }

  // ---- personal records, per Pokémon (kept for good, unlike the last 30 runs)
  const REC_KEYS = [['time', 'Longest run'], ['level', 'Highest level'], ['kills', 'Most defeated'], ['dps', 'Best damage/s'], ['dmg', 'Most damage']];
  function dexOfName(name) {
    const p = ((NS && NS.DEX) || []).find((d) => d.name === name || tr(d.name) === name);
    return p ? p.dex : 0;
  }
  function loadRecords() {
    let rec = load('records', null);
    if (!rec) {
      // First time: build them from the saved runs.
      rec = {};
      for (const h of load('history', []).slice().reverse()) bumpRecords(rec, Object.assign({ dex: h.dex || dexOfName(h.mon) }, h));
      save('records', rec);
    }
    return rec;
  }
  function bumpRecords(rec, s) {
    if (!s.dex) return [];
    const r = rec[s.dex] || (rec[s.dex] = { runs: 0, time: 0, level: 0, kills: 0, dps: 0, dmg: 0 });
    const had = r.runs > 0, beat = [];
    r.runs++;
    for (const [k] of REC_KEYS) if ((s[k] || 0) > (r[k] || 0)) { if (had) beat.push(k); r[k] = s[k] || 0; r[k + 'At'] = s.at; }
    return beat;
  }
  function updateRecords(s) {
    const rec = loadRecords();
    const beat = bumpRecords(rec, s);
    save('records', rec);
    return beat;
  }
  const recordsFor = (dex) => loadRecords()[dex] || null;

  // Your best solo time. The game keeps one best time for every run (solo or
  // co-op) and one for co-op, so solo is kept here; the first time, it's
  // worked out from your saved runs (and the game's best, when that wasn't
  // a co-op run).
  function soloBest() {
    let v = load('bestSolo', null);
    if (typeof v === 'number') return v;
    v = 0;
    for (const h of load('history', [])) if ((h.coop || 1) <= 1) v = Math.max(v, Math.floor(h.time || 0));
    const st = NS.DB && NS.DB.save && NS.DB.save.stats;
    if (!st) return v;            // not signed in yet: worked out again later
    if ((st.bestGroupTime || 0) < (st.bestTime || 0)) v = Math.max(v, st.bestTime | 0);
    save('bestSolo', v);
    return v;
  }
  function buildRunSummary(p) {
    const players = entries().map((e) => ({ name: e.name, dmg: Math.round(e.dmg || 0), me: !!e.me, exact: e.exact, color: e.color }));
    const moves = moveList().slice(0, 4).map((m) => ({ name: m.name, dmg: Math.round(m.dmg), pct: m.pct }));
    sampleRun();
    return {
      at: Date.now(),
      mon: (p.mon && p.mon.name) || '?',
      dex: (p.mon && p.mon.dex) || 0,
      shiny: !!p.shiny,
      series: { step: runSeries.step, players: Object.values(runSeries.players).map((r) => ({ name: r.name, color: r.color, me: r.me, pts: r.pts })) },
      // (Co-op may already have closed when the run is read: count the players seen.)
      coop: Math.max(NS.Coop.active ? players.length : 1, players.length, Object.keys(runSeries.players).length, 1),
      time: Math.round(runTime),
      level: p.level || 0,
      kills: p.kills || 0,
      dmg: Math.round(p.dmgDealt || 0),
      dps: Math.round((p.dmgDealt || 0) / Math.max(1, runTime)),
      players,
      moves,
    };
  }

  function buildSummary() {
    const style = document.createElement('style');
    style.textContent = `
#psmod-sum{position:fixed;inset:0;z-index:100001;display:grid;place-items:center;padding:16px;background:rgba(5,10,25,.6);
  font:13px/1.3 var(--font,'Pixelify',system-ui,sans-serif);color:#fff}
#psmod-sum[hidden]{display:none}
:is(#psmod-sum,#psmod-stats-runs) .win{width:min(640px,100%);max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;padding:14px 16px;display:grid;gap:10px;
  background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));border:3px solid var(--edge,#f4f8ff);border-radius:12px;
  box-shadow:0 0 0 3px var(--edge-out,#0b1838),inset 0 0 0 2px var(--edge-in,#5b83d6);text-shadow:2px 2px 0 var(--shadow,#0a1430)}
:is(#psmod-sum,#psmod-stats-runs) h3{margin:0;font-size:18px;color:#ffd23f;letter-spacing:.04em}
:is(#psmod-sum,#psmod-stats-runs) h4{margin:2px 0 0;font-size:14px;color:#ffd23f}
:is(#psmod-sum,#psmod-stats-runs) .top{display:flex;align-items:center;gap:8px}
:is(#psmod-sum,#psmod-stats-runs) .top h3{flex:1}
:is(#psmod-sum,#psmod-stats-runs) .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
:is(#psmod-sum,#psmod-stats-runs) .grid:has(> div:nth-child(4):last-child){grid-template-columns:repeat(4,1fr)}
:is(#psmod-sum,#psmod-stats-runs) .grid div{background:rgba(0,0,0,.25);border-radius:8px;padding:6px 8px}
:is(#psmod-sum,#psmod-stats-runs) .grid small{display:block;color:#b9cbf0;font-size:11px}
:is(#psmod-sum,#psmod-stats-runs) .grid b{font-size:16px}
:is(#psmod-sum,#psmod-stats-runs) table{width:100%;border-collapse:collapse;font-size:12px}
:is(#psmod-sum,#psmod-stats-runs) th,:is(#psmod-sum,#psmod-stats-runs) td{text-align:left;padding:4px 6px;border-bottom:1px solid rgba(244,248,255,.15);white-space:nowrap}
:is(#psmod-sum,#psmod-stats-runs) th{color:#b9cbf0;font-weight:600}
:is(#psmod-sum,#psmod-stats-runs) td.n{text-align:right;font-variant-numeric:tabular-nums}
:is(#psmod-sum,#psmod-stats-runs) tr.run{cursor:pointer}
:is(#psmod-sum,#psmod-stats-runs) tr.run:hover td,:is(#psmod-sum,#psmod-stats-runs) tr.run.psmod-padfocus td{background:rgba(255,255,255,.08)}
:is(#psmod-sum,#psmod-stats-runs) tr.run:focus{outline:none}
:is(#psmod-sum,#psmod-stats-runs) tr.run.sel td{background:rgba(255,210,63,.16)}
:is(#psmod-sum,#psmod-stats-runs) tr.run.best td:first-child::before{content:'★ ';color:#ffd23f}
:is(#psmod-sum,#psmod-stats-runs) .sub{color:#b9cbf0;font-size:12px;margin:0}
:is(#psmod-sum,#psmod-stats-runs) canvas#psmod-dot{width:100%;height:auto;display:block}
:is(#psmod-sum,#psmod-stats-runs) .recs{display:flex;flex-wrap:wrap;gap:6px}
:is(#psmod-sum,#psmod-stats-runs) .recs span{background:rgba(255,210,63,.18);border:2px solid #ffd23f;color:#ffd23f;border-radius:8px;padding:2px 8px;font-weight:700}
:is(#psmod-sum,#psmod-stats-runs) .top .btn{margin-left:6px}
#psmod-share{position:fixed;inset:0;z-index:100002;display:grid;place-items:center;padding:16px;background:rgba(5,10,25,.7);font:13px/1.3 var(--font,'Pixelify',system-ui,sans-serif);color:#fff}
#psmod-share[hidden]{display:none}
#psmod-share .win{width:min(860px,100%);display:grid;gap:10px;padding:14px 16px;background:linear-gradient(180deg,#2c519f,#1a3170);border:3px solid #f4f8ff;border-radius:12px;box-shadow:0 0 0 3px #0b1838;text-shadow:2px 2px 0 #0a1430}
#psmod-share .top{display:flex;gap:8px;align-items:center}#psmod-share h3{flex:1;margin:0;color:#ffd23f;font-size:18px}
#psmod-share canvas{width:100%;height:auto;display:block;border-radius:10px}
#psmod-share .sub{margin:0;color:#b9cbf0}
:is(#psmod-sum,#psmod-stats-runs) .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
:is(#psmod-sum,#psmod-stats-runs) td.x{width:1%;text-align:right;padding:2px 4px}
.psm-del{all:unset;cursor:pointer;display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:7px;font-size:12px;color:var(--muted,#b9cbf0);opacity:.55}
tr.run:hover .psm-del,.psm-del:focus-visible,.psm-del.psmod-padfocus{opacity:1}
.psm-del:hover{background:rgba(255,95,109,.25);color:#ffd3d8;opacity:1}
.psm-del.armed{opacity:1;background:#e83a4a;color:#fff;font-weight:700;white-space:nowrap}
@media (max-width:560px){:is(#psmod-sum,#psmod-stats-runs) .two{grid-template-columns:1fr}:is(#psmod-sum,#psmod-stats-runs) .grid{grid-template-columns:repeat(2,1fr)}}
.psmod-runs-btn{position:relative}
.psmod-runs-btn.new::after{content:'';position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#ff5f6d;box-shadow:0 0 0 2px #0b1838}`;
    document.head.appendChild(style);
    sumEl = document.createElement('div');
    sumEl.id = 'psmod-sum';
    sumEl.hidden = true;
    sumEl.innerHTML = '<div class="win"></div>';
    document.body.appendChild(sumEl);
    for (const ev of ['pointerdown', 'mousedown', 'touchstart']) sumEl.addEventListener(ev, (e) => e.stopPropagation());
    sumEl.addEventListener('click', (e) => {
      if (e.target === sumEl) { closeSummary(); return; }        // click outside the window
      onSummaryClick(e, null);
    });
    addEventListener('keydown', (e) => {
      if (!sumEl.hidden && e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); closeSummary(); }
    }, true);
    setupRunsButtons();
  }

  // Clicks in the runs view: the window, or the Stats screen's tab (`into`).
  function onSummaryClick(e, into) {
    // ✕ on a run: first click asks, second removes it.
    const del = e.target.closest('[data-act="del"]');
    if (del) {
      e.stopPropagation();
      del.blur();
      if (!del.classList.contains('armed')) {
        for (const o of document.querySelectorAll('.psm-del.armed')) { o.classList.remove('armed'); o.textContent = '✕'; }
        del.classList.add('armed'); del.textContent = 'Remove?';
        clearTimeout(del.__t); del.__t = setTimeout(() => { if (del.isConnected) { del.classList.remove('armed'); del.textContent = '✕'; } }, 3000);
        return;
      }
      const i = +del.dataset.i, hist = load('history', []);
      if (i >= 0 && i < hist.length) {
        hist.splice(i, 1);
        save('history', hist);
        if (sumPick > i || sumPick >= hist.length) sumPick = Math.max(0, sumPick - 1);
      }
      renderSummary(into); syncRunsButtons();
      return;
    }
    const row = e.target.closest('tr.run');
    if (row) {
      sumPick = +row.dataset.i; renderSummary(into);
      // On a controller, stay on the run you picked.
      if (padMode) { const nr = (into || sumEl).querySelector(`tr.run[data-i="${sumPick}"]`); if (nr) navSet(nr); }
      return;
    }
    const b = e.target.closest('button');
    if (!b) return;
    b.blur();
    if (b.dataset.act === 'close') closeSummary();
    if (b.dataset.act === 'share') { const h = load('history', [])[sumPick]; if (h) openShare(h); }
    if (b.dataset.act === 'clear') { save('history', []); sumPick = 0; renderSummary(into); syncRunsButtons(); }
  }
  function renderSummary(into) {
    if (!sumEl) return;
    const target = into || sumEl.firstElementChild;
    const hist = load('history', []);
    const best = hist.reduce((a, h) => (h.dps > (a ? a.dps : -1) ? h : a), null);
    const s = hist[Math.min(sumPick, hist.length - 1)];
    const d2 = (at) => { const d = new Date(at); return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const detail = s ? `
      <h4>${esc(tr(s.mon))} · ${d2(s.at)}${s.coop > 1 ? ` · co-op (${s.coop})` : ''}${s.endless ? ' · <span class="psm-endless-badge">∞ Endless</span>' : ''}</h4>
      <div class="grid">
        <div><small>Time</small><b>${clock(s.time)}</b></div>
        <div><small>Level</small><b>${s.level}</b></div>
        <div><small>Defeated</small><b>${fmt(s.kills)}</b></div>
        <div><small>Damage</small><b>${fmt(s.dmg)}</b></div>
        <div><small>Damage/s</small><b>${fmt(s.dps)}</b></div>
        <div><small>Pokémon</small><b>${esc(tr(s.mon))}</b></div>
      </div>
      ${s.records && s.records.length ? `<div class="recs">${s.records.map((r) => `<span>★ New record · ${esc((REC_KEYS.find((k) => k[0] === r) || [, r])[1])}</span>`).join('')}</div>` : ''}
      ${s.series && s.series.players && s.series.players.some((p) => p.pts.length > 1) ? `<h4>Damage over time <small class="sub">(damage per second)</small></h4><canvas id="psmod-dot" width="1200" height="300"></canvas>` : ''}
      ${(s.players && s.players.length > 1) || (s.moves && s.moves.length) ? `<div class="two">
        ${s.players && s.players.length > 1 ? `<table><thead><tr><th>Player</th><th class="n">Damage</th><th class="n">Dmg/s</th></tr></thead><tbody>${
          s.players.map((p) => `<tr><td style="color:${esc(p.color)}" translate="no">${esc(p.name)}</td><td class="n">${p.exact ? '' : '~'}${fmt(p.dmg)}</td><td class="n">${fmt(p.dmg / Math.max(1, s.time))}</td></tr>`).join('')
        }</tbody></table>` : '<div></div>'}
        ${s.moves && s.moves.length ? `<table><thead><tr><th>Your attacks</th><th class="n">Damage</th><th class="n">%</th></tr></thead><tbody>${
          s.moves.map((m) => `<tr><td>${esc(tr(m.name))}</td><td class="n">${fmt(m.dmg)}</td><td class="n">${Math.round(m.pct * 100)}%</td></tr>`).join('')
        }</tbody></table>` : ''}
      </div>` : ''}` : '';
    const rows = hist.map((h, i) => `<tr class="run${i === sumPick ? ' sel' : ''}${h === best ? ' best' : ''}" data-i="${i}" tabindex="0"${h === best ? ' title="Your best damage per second"' : ''}>
      <td>${d2(h.at)}</td><td>${esc(tr(h.mon))}${h.coop > 1 ? ` (${h.coop})` : ''}${h.endless ? '<span class="psm-inf" title="Endless run">∞</span>' : ''}</td><td class="n">${clock(h.time)}</td><td class="n">${h.level}</td><td class="n">${fmt(h.dps)}</td><td class="x"><button class="psm-del" data-act="del" data-i="${i}" data-sfx="none" title="Remove this run">✕</button></td></tr>`).join('');
    target.innerHTML = `
      <div class="top"><h3>Runs &amp; records</h3>${s ? '<button class="btn small gold" data-act="share">Share card</button>' : ''}${into ? '' : '<button class="btn small" data-act="close">Close</button>'}</div>
      ${totalsHtml()}
      ${detail || ''}
      <h4>Your latest runs</h4>
      ${rows ? `<table><thead><tr><th>Date</th><th>Pokémon</th><th class="n">Time</th><th class="n">Lv.</th><th class="n">Damage/s</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="sub">Click a run to see it above; ✕ removes it. ★ is your best damage per second. Runs are saved in this browser (the last ${HISTORY_MAX}). Alt + H opens this anytime.</p>
      <div><button class="btn small" data-act="clear">Clear history</button></div>` : '<p class="sub">No runs saved yet. A run is saved when it ends.</p>'}`;
    const cv = target.querySelector('#psmod-dot');
    if (cv && s) { try { drawDotGraph(cv, s); } catch (err) { trip('previews', err); } }
  }

  // Damage per second over the run, one line per player.
  function dotSeries(s) {
    const step = (s.series && s.series.step) || 5;
    return (s.series.players || []).filter((p) => p.pts.length > 1).map((p) => {
      const raw = p.pts.map((v, i) => Math.max(0, (v - (i ? p.pts[i - 1] : 0)) / step));
      const sm = raw.map((_, i) => { const a = raw.slice(Math.max(0, i - 1), i + 2); return a.reduce((x, y) => x + y, 0) / a.length; });
      return { name: p.name, color: p.color || '#ffd23f', me: p.me, pts: sm };
    });
  }
  function drawDotGraph(cv, s, opt = {}) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    const lines = dotSeries(s), step = (s.series && s.series.step) || 5;
    const n = Math.max(...lines.map((l) => l.pts.length), 2);
    const max = Math.max(1, ...lines.flatMap((l) => l.pts));
    const L = opt.left ?? 70, R = 16, T = 18, B = 34;
    if (!opt.keep) ctx.clearRect(0, 0, W, H);
    if (!opt.transparent) { ctx.fillStyle = 'rgba(0,0,0,.25)'; rr(ctx, 0, 0, W, H, 14); ctx.fill(); }
    ctx.strokeStyle = 'rgba(244,248,255,.15)'; ctx.lineWidth = 1;
    ctx.font = HF(700, opt.font || 18); ctx.fillStyle = '#b9cbf0';
    for (let i = 0; i <= 3; i++) {
      const y = T + (H - T - B) * (1 - i / 3);
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(W - R, y); ctx.stroke();
      ctx.textAlign = 'right'; ctx.fillText(fmt(max * i / 3), L - 8, y + 6);
    }
    ctx.textAlign = 'center';
    for (const f of [0, 0.5, 1]) { ctx.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center'; ctx.fillText(clock(f * (n - 1) * step + step), L + (W - L - R) * f, H - 8); }
    for (const l of lines.sort((a, b) => a.me - b.me)) {
      ctx.beginPath();
      l.pts.forEach((v, i) => { const x = L + (W - L - R) * (i / (n - 1)), y = T + (H - T - B) * (1 - v / max); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.lineJoin = 'round'; ctx.lineWidth = l.me ? 5 : 3.5; ctx.strokeStyle = '#0b1838'; ctx.stroke();
      ctx.lineWidth = l.me ? 3 : 2; ctx.strokeStyle = l.color; ctx.stroke();
    }
    if (lines.length > 1 && !opt.noLegend) {
      let x = L + 6;
      ctx.textAlign = 'left'; ctx.font = HF(800, opt.font || 18);
      for (const l of lines) { ctx.fillStyle = l.color; ctx.fillRect(x, T + 4, 12, 12); ctx.fillText(l.name, x + 16, T + 15); x += ctx.measureText(l.name).width + 34; }
    }
  }

  // ---- share card: an image of the run to post or send
  function shareCard(s) {
    const cv = document.createElement('canvas');
    cv.width = 1200; cv.height = 675;
    const ctx = cv.getContext('2d'), W = 1200, H = 675;
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2c519f'); bg.addColorStop(1, '#16295e');
    ctx.fillStyle = '#0b1838'; ctx.fillRect(0, 0, W, H);
    rr(ctx, 10, 10, W - 20, H - 20, 26); ctx.fillStyle = bg; ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = '#f4f8ff'; ctx.stroke();
    rr(ctx, 18, 18, W - 36, H - 36, 20); ctx.lineWidth = 3; ctx.strokeStyle = '#5b83d6'; ctx.stroke();
    // Title.
    ctx.textBaseline = 'alphabetic';
    ctx.font = HF(800, 46); ctx.textAlign = 'left';
    outlined(ctx, 'PokéSurvivor', 50, 82, '#ffd23f', 8);
    const tw = ctx.measureText('PokéSurvivor').width;
    ctx.font = HF(800, 34); outlined(ctx, '+', 54 + tw, 60, '#fff3b0', 6);
    ctx.font = HF(700, 22); ctx.textAlign = 'right';
    const d = new Date(s.at);
    const rpt = `RUN REPORT · ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
    outlined(ctx, rpt, W - 50, 76, '#cfe0ff', 5);
    if (s.endless) {
      // ∞ ENDLESS pill to the left of the date.
      const rw = ctx.measureText(rpt).width;
      ctx.font = HF(800, 18);
      const lw = ctx.measureText('∞ ENDLESS').width + 26, lx = W - 50 - rw - 16 - lw, ly = 50;
      rr(ctx, lx, ly, lw, 34, 17); ctx.fillStyle = '#4a2a9e'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#cdb6ff'; ctx.stroke();
      ctx.textAlign = 'center'; outlined(ctx, '∞ ENDLESS', lx + lw / 2, ly + 24, '#fff', 4); ctx.textAlign = 'right';
      ctx.font = HF(700, 22);
    }
    // Portrait.
    const px = 50, py = 112, ps = 200;
    rr(ctx, px - 4, py - 4, ps + 8, ps + 8, 22); ctx.fillStyle = '#0b1838'; ctx.fill();
    rr(ctx, px, py, ps, ps, 18); ctx.fillStyle = 'rgba(95,200,255,.25)'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = s.shiny ? '#9ae6ff' : '#f4f8ff'; ctx.stroke();
    const img = s.dex ? portraitImg(s.dex, s.shiny, 'Normal') : null;
    if (img) { ctx.save(); rr(ctx, px + 4, py + 4, ps - 8, ps - 8, 14); ctx.clip(); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, px + 4, py + 4, ps - 8, ps - 8); ctx.restore(); }
    else { ctx.font = HF(800, 90); ctx.textAlign = 'center'; outlined(ctx, String(tr(s.mon)).charAt(0), px + ps / 2, py + ps / 2 + 32, '#fff', 8); }
    ctx.textAlign = 'center'; ctx.font = HF(800, 30);
    outlined(ctx, String(tr(s.mon)) + (s.shiny ? ' ✦' : ''), px + ps / 2, py + ps + 44, '#fff', 6);
    ctx.font = HF(700, 20);
    const nPl = Math.max(s.coop || 1, (s.players || []).length, ((s.series && s.series.players) || []).length);
    outlined(ctx, nPl > 1 ? `Co-op · ${nPl} players` : 'Solo run', px + ps / 2, py + ps + 74, '#b9cbf0', 5);
    // Stat tiles.
    const tiles = [['TIME', clock(s.time)], ['LEVEL', String(s.level)], ['DEFEATED', fmt(s.kills)], ['DAMAGE', fmt(s.dmg)], ['DAMAGE/S', fmt(s.dps)]];
    const tx0 = 300, tyy = 112, tw2 = 160, th2 = 92, tg = 14;
    tiles.forEach(([k, v], i) => {
      const x = tx0 + i * (tw2 + tg);
      rr(ctx, x, tyy, tw2, th2, 14); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fill();
      ctx.textAlign = 'left'; ctx.font = HF(700, 17); ctx.fillStyle = '#b9cbf0'; ctx.fillText(k, x + 14, tyy + 30);
      ctx.font = HF(800, 34); outlined(ctx, v, x + 14, tyy + 74, '#fff', 6);
    });
    // Records.
    let ry = tyy + th2 + 40;
    if (s.records && s.records.length) {
      // Fits the width: smaller type, then a second line if it's still too long.
      const maxW = W - tx0 - 50, names = s.records.map((r) => String((REC_KEYS.find((k) => k[0] === r) || [, r])[1]).toUpperCase());
      const line = '★ NEW RECORD' + (names.length > 1 ? 'S' : '') + ' · ' + names.join(' · ');
      ctx.textAlign = 'left';
      let fs = 22;
      ctx.font = HF(800, fs);
      while (ctx.measureText(line).width > maxW && fs > 17) { fs--; ctx.font = HF(800, fs); }
      if (ctx.measureText(line).width <= maxW) { outlined(ctx, line, tx0, ry, '#ffd23f', 5); ry += 16; }
      else {
        const head = '★ NEW RECORDS · ';
        let a1 = head, rest = [];
        for (const n of names) { const t = a1 + (a1 === head ? '' : ' · ') + n; if (!rest.length && ctx.measureText(t).width <= maxW) a1 = t; else rest.push(n); }
        outlined(ctx, a1, tx0, ry, '#ffd23f', 5);
        outlined(ctx, rest.join(' · '), tx0, ry + fs + 6, '#ffd23f', 5);
        ry += fs + 22;
      }
    }
    // Graph: damage per second over the run, in a labelled panel.
    const players = (s.players || []).filter((p) => p && p.dmg >= 0);
    const team = players.length > 1;
    const hasGraph = s.series && s.series.players && s.series.players.some((p) => p.pts.length > 1);
    const gx = tx0, gw = W - tx0 - 50, gy = ry + 6;
    const teamH = team ? 84 : 0;
    const gh = Math.min(team ? 236 : 290, H - 76 - gy - teamH);
    if (hasGraph) {
      rr(ctx, gx, gy, gw, gh, 14); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fill();
      ctx.textAlign = 'left'; ctx.font = HF(800, 17);
      outlined(ctx, 'DAMAGE PER SECOND', gx + 16, gy + 28, '#ffd23f', 4);
      const t1 = ctx.measureText('DAMAGE PER SECOND').width;
      ctx.font = HF(700, 15); ctx.fillStyle = '#9fb3dd';
      ctx.fillText(team ? '· one line per player, over the run' : '· over the run', gx + 24 + t1, gy + 28);
      // Legend, right-aligned.
      const lines = dotSeries(s);
      if (lines.length > 1) {
        ctx.font = HF(800, 15);
        let lx = gx + gw - 16;
        for (const l of lines.slice().reverse()) {
          const w = ctx.measureText(l.name).width;
          ctx.textAlign = 'right'; ctx.fillStyle = l.color; ctx.fillText(l.name, lx, gy + 28);
          ctx.fillRect(lx - w - 16, gy + 17, 11, 11);
          lx -= w + 30;
        }
      }
      const g = document.createElement('canvas'); g.width = gw - 16; g.height = gh - 44;
      drawDotGraph(g, s, { font: 15, left: 58, transparent: true, noLegend: true });
      ctx.drawImage(g, gx + 8, gy + 40);
    }
    // Team: everyone's share of the damage, as one bar.
    if (team) {
      const ty = (hasGraph ? gy + gh : gy) + 18;
      const tot = players.reduce((a, p) => a + (p.dmg || 0), 0) || 1;
      ctx.textAlign = 'left'; ctx.font = HF(800, 17);
      outlined(ctx, 'TEAM DAMAGE', gx, ty + 14, '#ffd23f', 4);
      let bx = gx;
      const by = ty + 24, bh = 16;
      rr(ctx, gx, by, gw, bh, 8); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
      ctx.save(); rr(ctx, gx, by, gw, bh, 8); ctx.clip();
      for (const p of players) { const w = gw * (p.dmg || 0) / tot; ctx.fillStyle = p.color || '#ffd23f'; ctx.fillRect(bx, by, w, bh); bx += w; ctx.fillStyle = '#0b1838'; ctx.fillRect(bx - 1, by, 2, bh); }
      ctx.restore();
      const cw = gw / players.length;
      players.forEach((p, i) => {
        const x = gx + i * cw;
        ctx.fillStyle = p.color || '#ffd23f'; ctx.fillRect(x, by + bh + 13, 11, 11);
        ctx.font = HF(800, 16); ctx.textAlign = 'left';
        const nm = String(p.name).slice(0, 14);
        outlined(ctx, nm, x + 16, by + bh + 24, '#fff', 4);
        const nw = ctx.measureText(nm).width;
        ctx.font = HF(700, 15); ctx.fillStyle = '#b9cbf0';
        ctx.fillText(`${fmt(p.dmg || 0)} · ${Math.round((p.dmg || 0) / tot * 100)}%`, x + 24 + nw, by + bh + 24);
      });
    }
    // Top attacks under the portrait.
    ctx.textAlign = 'left'; ctx.font = HF(700, 19);
    let ay = py + ps + 118;
    for (const m of (s.moves || []).slice(0, 3)) {
      outlined(ctx, `${tr(m.name)}`, 50, ay, '#fff', 5);
      ctx.textAlign = 'right'; outlined(ctx, Math.round(m.pct * 100) + '%', 260, ay, '#ffd23f', 5); ctx.textAlign = 'left';
      ay += 30;
    }
    // Footer.
    ctx.font = HF(700, 17); ctx.textAlign = 'right';
    outlined(ctx, 'PokeSurvivor Plus · pokesurvivor.com', W - 50, H - 40, '#9fb3dd', 4);
    return cv;
  }
  function openShare(s) {
    let o = document.getElementById('psmod-share');
    if (!o) {
      o = document.createElement('div');
      o.id = 'psmod-share';
      o.innerHTML = '<div class="win"><div class="top"><h3>Share card</h3><button class="btn small" data-a="copy">Copy image</button><button class="btn small" data-a="save">Save image</button><button class="btn small" data-a="close">Close</button></div><div class="img"></div><p class="sub" data-msg>Copy it and paste it in your chat, or save it as a picture.</p></div>';
      document.body.appendChild(o);
      for (const ev of ['pointerdown', 'mousedown', 'touchstart']) o.addEventListener(ev, (e) => e.stopPropagation());
      o.addEventListener('click', async (e) => {
        if (e.target === o) { o.hidden = true; return; }
        const b = e.target.closest('button'); if (!b) return;
        b.blur();
        const cv = o.querySelector('canvas'), msg = o.querySelector('[data-msg]');
        if (b.dataset.a === 'close') o.hidden = true;
        if (b.dataset.a === 'save') {
          const a = document.createElement('a');
          a.href = cv.toDataURL('image/png'); a.download = 'pokesurvivor-run.png';
          document.body.appendChild(a); a.click(); a.remove();
          msg.textContent = 'Saved as pokesurvivor-run.png in your downloads.';
        }
        if (b.dataset.a === 'copy') {
          try {
            const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            msg.textContent = 'Copied! Paste it with Ctrl + V.';
          } catch (_) { msg.textContent = 'Your browser didn’t allow copying images: use Save image instead.'; }
        }
      });
      addEventListener('keydown', (e) => { if (!o.hidden && e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); o.hidden = true; } }, true);
    }
    const cv = shareCard(s);
    const box = o.querySelector('.img');
    box.innerHTML = ''; box.appendChild(cv);
    o.querySelector('[data-msg]').textContent = 'Copy it and paste it in your chat, or save it as a picture.';
    o.hidden = false;
  }

  function showSummary() {
    if (!sumEl) return;
    sumPick = 0;
    renderSummary();
    sumEl.hidden = false;
    save('historyNew', false);
    syncRunsButtons();
  }
  function closeSummary() { if (sumEl) sumEl.hidden = true; }
  function toggleHistory() {
    if (!sumEl) return;
    if (!sumEl.hidden) closeSummary(); else showSummary();
  }

  // "Runs" buttons: under the stats on the main menu and on the game-over screen.
  function syncRunsButtons() {
    const isNew = !!load('historyNew', false) && load('history', []).length > 0;
    for (const b of document.querySelectorAll('.psmod-runs-btn')) b.classList.toggle('new', isNew);
  }
  function setupRunsButtons() {
    const again = document.getElementById('btn-again');
    if (again && !document.getElementById('psmod-runs-over')) {
      const b = document.createElement('button');
      b.id = 'psmod-runs-over';
      b.className = 'btn small ghost psmod-runs-btn';
      b.textContent = 'Runs & records';
      b.title = 'Your latest runs and the details of each (Alt + H)';
      b.style.marginLeft = '8px';
      b.addEventListener('click', (e) => { e.stopPropagation(); b.blur(); showSummary(); });
      again.after(b);
    }
    runFeature('menuItems', setupMenuItems);
    syncRunsButtons();
  }

  // ------------------------------------------------ main menu items
  // "Stats" (the game's Leaderboard item) opens your runs and records first,
  // with the leaderboard as a second tab. Settings stays in the top bar's
  // gear, and Quit is a power button at the far right of the top bar. The
  // top bar's log-out button goes: it's in Settings → Account.
  // Quit: a red pixel-art button with a white X.
  const QUIT_ICON = () => pixelIcon([
    '.oooooooooooo.', 'oLLLLLLLLLLLLo', 'oLRRRRRRRRRRDo', 'oLRwwRRRRwwRDo', 'oLRwwwRRwwwRDo', 'oLRRwwwwwwRRDo', 'oLRRRwwwwRRRDo',
    'oLRRRwwwwRRRDo', 'oLRRwwwwwwRRDo', 'oLRwwwRRwwwRDo', 'oLRwwRRRRwwRDo', 'oLRRRRRRRRRRDo', 'oDDDDDDDDDDDDo', '.oooooooooooo.',
  ], { o: '#f7b7b7', L: '#ff7d7d', R: '#e5484d', D: '#b42a3a', w: '#ffffff' }).toDataURL();
  const PLAY_SUB = 'Face the Judgment of Arceus';
  function setupMenuItems() {
    const list = document.querySelector('#scr-menu .menu-list');
    const stats = document.getElementById('menu-stats');
    const rank = list && list.querySelector('[data-go="rank"]');
    if (!list || !rank || document.getElementById('psmod-quit')) return;
    if (!document.getElementById('psmod-menu-css')) {
      const st = document.createElement('style');
      st.id = 'psmod-menu-css';
      st.textContent = `
#btn-logout{display:none!important}
#scr-menu .box.psmod-statsbox{display:none!important}
#scr-menu .menu-list [data-go="settings"]{display:none!important}
#scr-menu .menu-item.psmod-runs-btn.new::after{content:'';position:absolute;top:10px;right:12px;width:9px;height:9px;border-radius:50%;background:#ff5f6d;box-shadow:0 0 0 2px #0b1838}
#menu-shiny.hidden{display:flex!important;visibility:hidden;pointer-events:none}
#menu-partner-info .rarity-ball{display:none}
#psmod-quit{display:inline-grid;place-items:center;width:38px;height:38px;padding:0;margin:0;background:none;border:0;box-shadow:none;cursor:pointer;border-radius:8px}
#psmod-quit img{width:34px;height:34px;image-rendering:pixelated;display:block;filter:drop-shadow(0 2px 0 #0b1838) drop-shadow(0 0 2px #0b1838);transition:transform .08s,filter .15s}
#psmod-quit:hover img{transform:scale(1.08);filter:drop-shadow(0 2px 0 #0b1838) drop-shadow(0 0 6px rgba(255,90,90,.8))}
#psmod-quit:active img{transform:scale(.94)}
/* The menu starts at the top (under the top bar); Play sits on its own above the list. */
#scr-menu .menu-right{justify-content:flex-start}
#scr-menu .menu-right > *{margin-top:0!important;margin-bottom:0!important}
#scr-menu .menu-right > .menu-item.play{width:100%;box-sizing:border-box;flex:none}
#topbar #btn-support{position:fixed;left:16px;top:14px}
/* Play: the big gold button. */
/* Every menu option its own button. */
#scr-menu .menu-right .box:has(> .menu-list){background:none!important;border:0!important;box-shadow:none!important;padding:6px!important;margin:-6px!important;overflow:visible!important}
#scr-menu .menu-list{gap:8px}
#scr-menu .menu-list .menu-item{border-radius:12px;padding:8px 14px 8px 30px;background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));
  border:3px solid var(--edge,#f4f8ff);box-shadow:0 0 0 3px var(--edge-out,#0b1838),inset 0 0 0 2px var(--edge-in,#5b83d6),0 4px 0 var(--edge-out,#0b1838);transition:transform .08s,filter .15s}
#scr-menu .menu-list .menu-item:hover,#scr-menu .menu-list .menu-item.psmod-padfocus{filter:brightness(1.15)}
#scr-menu .menu-list .menu-item:active{transform:translateY(2px)}
#scr-menu .menu-item.play{font-size:40px!important;letter-spacing:1.5px;position:relative;overflow:hidden}
#scr-menu .menu-item.play small{font-size:15px!important;margin-top:2px}
/* A light sweeps across it every few seconds; chevrons nudge towards the dungeon. */
#scr-menu .menu-item.play .psm-shine{position:absolute;top:-20%;bottom:-20%;width:38%;left:-50%;transform:skewX(-20deg);pointer-events:none;
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.75),transparent)}
html:not(.psmod-calm) #scr-menu .menu-item.play .psm-shine{animation:psmodSweep 3.2s ease-in-out infinite}
@keyframes psmodSweep{0%,55%{left:-50%}100%{left:130%}}
#scr-menu .menu-item.play .psm-go{position:absolute;right:18px;top:50%;transform:translateY(-50%);font-size:34px;color:#7a4d00;letter-spacing:-6px;-webkit-text-stroke:0;text-shadow:0 2px 0 #fff3c4;pointer-events:none}
html:not(.psmod-calm) #scr-menu .menu-item.play .psm-go{animation:psmodNudge 1s ease-in-out infinite alternate}
@keyframes psmodNudge{to{transform:translate(6px,-50%)}}
#scr-menu .menu-item.play .mi-ico img{width:34px;height:34px}
#scr-menu .menu-item.play{grid-template-columns:44px 1fr}
#scr-menu .menu-item.play{-webkit-text-stroke:1px #7a4d00;paint-order:stroke fill;text-shadow:0 2px 0 #fff3c4}
#scr-menu .menu-item.play{margin:0;padding:16px 20px 16px 30px;border-radius:14px;color:#2a1a00;
  background:linear-gradient(180deg,#ffe58a,#ffc531 55%,#f0a91a);border:3px solid #fff3c4;
  box-shadow:0 0 0 3px #7a4d00,0 6px 0 #7a4d00,0 0 22px rgba(255,200,60,.45);transition:transform .08s,box-shadow .2s,filter .2s}
#scr-menu .menu-item.play small{color:#5c3a00;font-weight:700}
#scr-menu .menu-item.play:hover,#scr-menu .menu-item.play.psmod-padfocus{filter:brightness(1.08);box-shadow:0 0 0 3px #7a4d00,0 6px 0 #7a4d00,0 0 34px rgba(255,210,80,.75)}
#scr-menu .menu-item.play:active{transform:translateY(3px);box-shadow:0 0 0 3px #7a4d00,0 3px 0 #7a4d00,0 0 22px rgba(255,200,60,.45)}
#scr-menu .menu-item.play::before{filter:brightness(.25)}
#scr-menu .menu-item.play.psm-wait{filter:saturate(.45) brightness(.9)}
html:not(.psmod-calm) #scr-menu .menu-item.play{animation:psmodPlayGlow 2.4s ease-in-out infinite}
@keyframes psmodPlayGlow{50%{box-shadow:0 0 0 3px #7a4d00,0 6px 0 #7a4d00,0 0 30px rgba(255,215,90,.7)}}`;
      document.head.appendChild(st);
    }
    // Play on its own, above the list.
    const playBtn = list.querySelector('[data-go="play"]');
    const right = list.closest('.menu-right'), listBox = list.closest('.box');
    if (playBtn && right && listBox) right.insertBefore(playBtn, listBox);
    if (playBtn && !playBtn.querySelector('.psm-go')) {
      for (const n of [...playBtn.childNodes]) if (n.nodeType === 3 && n.nodeValue.trim()) { const t = document.createElement('span'); t.className = 'psm-t'; t.textContent = n.nodeValue.trim(); n.replaceWith(t); }
      playBtn.insertAdjacentHTML('beforeend', '<i class="psm-shine"></i><span class="psm-go" aria-hidden="true">›››</span>');
    }
    const playSub = playBtn && playBtn.querySelector('small');
    if (playSub) playSub.textContent = PLAY_SUB;
    // Leaderboard → Stats (runs & records first).
    const lab = [...rank.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (lab) lab.textContent = 'Stats'; else rank.insertBefore(document.createTextNode('Stats'), rank.querySelector('small'));
    const small = rank.querySelector('small');
    if (small) small.textContent = 'Runs, records and leaderboard';
    rank.id = 'psmod-runs-menu';
    rank.classList.add('psmod-runs-btn');
    rank.title = 'Your runs, records and the leaderboard (Alt + H)';
    rank.addEventListener('click', (e) => { e.stopImmediatePropagation(); e.preventDefault(); rank.blur(); openStats('runs'); }, true);
    // Quit: top bar, far right. No confirmation.
    const bar = document.getElementById('topbar');
    if (bar) {
      const q = document.createElement('button');
      q.id = 'psmod-quit';
      q.className = 'btn small ghost';
      q.title = 'Quit the game (closes this tab)';
      q.setAttribute('aria-label', 'Quit the game');
      q.dataset.sfx = 'none';
      q.innerHTML = `<img src="${QUIT_ICON()}" alt="">`;
      q.addEventListener('click', (e) => { e.stopPropagation(); q.blur(); quitGame(); });
      bar.appendChild(q);
    }
    // The game's totals box: hidden here, shown in Stats instead.
    if (stats && stats.parentElement && stats.parentElement.classList.contains('box')) stats.parentElement.classList.add('psmod-statsbox');
    setupMenuFit();
  }

  // ---- the main menu always fits: when the window is too short for the
  // menu (or the left column), it's scaled down just enough.
  function fitMenu() {
    const scr = document.getElementById('scr-menu');
    if (!scr || scr.classList.contains('hidden')) return;
    const fit = (el, inner) => {
      if (!el) return;
      inner.style.zoom = '';
      const need = el.scrollHeight, have = el.clientHeight;
      if (need <= have + 1) return;
      inner.style.zoom = String(Math.max(0.55, Math.floor(have / need * 100) / 100));
      // One more pass (zoom changes line wrapping a little).
      const need2 = el.scrollHeight;
      if (need2 > el.clientHeight + 1) inner.style.zoom = String(Math.max(0.55, Math.floor(parseFloat(inner.style.zoom) * el.clientHeight / need2 * 100) / 100));
    };
    const right = scr.querySelector('.menu-right');
    if (right) {
      right.style.zoom = '';
      const need = right.scrollHeight, have = right.clientHeight;
      if (need > have + 1) right.style.zoom = String(Math.max(0.55, Math.floor(have / need * 100) / 100));
    }
    // Left column (logo, partner, party, room): centred, so measure its
    // content directly, and keep it clear of the top bar.
    const left = scr.querySelector('.menu-left');
    if (left) {
      left.style.zoom = '';
      const kids = [...left.children].filter((c) => c.getClientRects().length);
      if (kids.length) {
        const top = Math.min(...kids.map((c) => c.getBoundingClientRect().top)), bottom = Math.max(...kids.map((c) => c.getBoundingClientRect().bottom));
        const need = bottom - top, have = left.clientHeight - 2 * 64;
        if (need > have) left.style.zoom = String(Math.max(0.5, Math.floor(have / need * 100) / 100));
      }
    }
  }
  function setupMenuFit() {
    addEventListener('resize', () => requestAnimationFrame(fitMenu));
    const scr = document.getElementById('scr-menu');
    if (scr) new MutationObserver(() => requestAnimationFrame(fitMenu)).observe(scr, { attributes: true, attributeFilter: ['class'] });
    setInterval(fitMenu, 1000);
    requestAnimationFrame(fitMenu);
  }

  // ---- Stats: the game's leaderboard screen with two tabs on top,
  // "Runs & records" (ours, opened first) and "Leaderboard" (the game's).
  let statsTab = 'runs';
  function setupStats() {
    const scr = document.getElementById('scr-rank');
    const box = scr && scr.querySelector('.box');
    const head = box && box.querySelector('.row.between');
    if (!box || !head || document.getElementById('psmod-stats-tabs')) return;
    const st = document.createElement('style');
    st.textContent = `
#psmod-stats-tabs{display:flex;gap:4px;margin:8px 0 10px;padding:4px;border-radius:12px;background:rgba(5,12,35,.45);border:2px solid rgba(255,255,255,.14)}
#psmod-stats-tabs .psn-tab{flex:1 1 0;min-width:0;padding:8px 10px;border:0;border-radius:9px;background:transparent;color:var(--muted,#b9cbf0);
  font:inherit;font-size:14px;line-height:1.2;cursor:pointer;text-shadow:2px 2px 0 var(--shadow,#0a1430)}
#psmod-stats-tabs .psn-tab:hover{color:#fff;background:rgba(255,255,255,.08)}
#psmod-stats-tabs .psn-tab.on{color:#1a2a55;background:linear-gradient(180deg,#ffe27a,#ffc93c);text-shadow:none;box-shadow:inset 0 -3px 0 rgba(0,0,0,.18)}
#scr-rank.psm-runs .box > :not(.row.between):not(#psmod-stats-tabs):not(#psmod-stats-runs):not(#psmod-padhints){display:none!important}
#scr-rank:not(.psm-runs) #psmod-stats-runs{display:none}
#scr-rank.psm-runs #rk-mod{display:none!important}
#psmod-stats-runs{display:grid;gap:10px}
#psmod-stats-runs .top h3{display:none}
#psmod-stats-runs .top{justify-content:flex-start}
#psmod-stats-runs .top:empty,#psmod-stats-runs .top:not(:has(button)){display:none}`;
    document.head.appendChild(st);
    const h2 = head.querySelector('h2');
    if (h2) { h2.dataset.psmOrig = h2.innerHTML; }
    const tabs = document.createElement('div');
    tabs.id = 'psmod-stats-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = '<button class="psn-tab" role="tab" data-t="runs">Runs &amp; records</button><button class="psn-tab" role="tab" data-t="board">Leaderboard</button>';
    head.after(tabs);
    const runs = document.createElement('div');
    runs.id = 'psmod-stats-runs';
    tabs.after(runs);
    runs.addEventListener('click', (e) => onSummaryClick(e, runs));
    tabs.addEventListener('click', (e) => { const t = e.target.closest('.psn-tab'); if (t) { e.stopPropagation(); t.blur(); NS.Audio && NS.Audio.sfx('click'); openStats(t.dataset.t); } });
  }
  function openStats(tab) {
    const scr = document.getElementById('scr-rank');
    if (!scr || !document.getElementById('psmod-stats-tabs')) { showSummary(); return; }
    statsTab = tab === 'board' ? 'board' : 'runs';
    const h2 = scr.querySelector('.row.between h2');
    if (statsTab === 'board') {
      const online = NS.DB && NS.DB.online;
      if (!online) { if (NS.SocialUI && NS.SocialUI.needOnline) NS.SocialUI.needOnline(); return; }
      scr.classList.remove('psm-runs');
      if (h2 && h2.dataset.psmOrig != null) h2.innerHTML = h2.dataset.psmOrig;
      NS.RankingUI.open();
    } else {
      if (scr.classList.contains('hidden')) NS.UI.show('scr-rank', true);
      scr.classList.add('psm-runs');
      if (h2) h2.textContent = 'Stats';
      const runs = document.getElementById('psmod-stats-runs');
      if (!runs.dataset.shown || scr.dataset.psmOpen !== '1') sumPick = 0;
      runs.dataset.shown = '1';
      renderSummary(runs);
      save('historyNew', false);
      syncRunsButtons();
    }
    for (const t of document.querySelectorAll('#psmod-stats-tabs .psn-tab')) { t.classList.toggle('on', t.dataset.t === statsTab); t.setAttribute('aria-selected', t.dataset.t === statsTab); }
    scr.dataset.psmOpen = '1';
  }
  waitFor(() => NS && NS.RankingUI && NS.UI && document.getElementById('scr-rank'), function setupStatsScreen() {
    setupStats();
    const scr = document.getElementById('scr-rank');
    new MutationObserver(() => { if (scr.classList.contains('hidden')) { scr.dataset.psmOpen = ''; } }).observe(scr, { attributes: true, attributeFilter: ['class'] });
  });

  // Saves what's pending, then asks the extension to close this tab (pages
  // can't close a tab they didn't open themselves).
  async function quitGame() {
    toast('Closing the game…', '#ffd23f');
    try { if (NS.DB && !NS.DB.guest && NS.DB.commit) { NS.DB.commit(true); if (NS.DB.flush) await Promise.race([NS.DB.flush(), new Promise((r) => setTimeout(r, 3000))]); } } catch (_) { /* local copy stays */ }
    try { NS.Audio && NS.Audio.music && NS.Audio.music(null); } catch (_) { /* ignore */ }
    window.postMessage({ psmodBridge: 'closeTab' }, location.origin);
    setTimeout(() => { try { window.close(); } catch (_) { /* ignore */ } }, 600);
    setTimeout(() => toast('Couldn’t close the tab: close it from your browser', '#ffcb3d'), 2500);
  }
  // The game's totals, at the top of the Runs window.
  function totalsHtml() {
    const st = NS && NS.DB && NS.DB.save && NS.DB.save.stats;
    if (!st) return '';
    const mmss = (t) => { try { return NS.U && NS.U.mmss ? NS.U.mmss(t || 0) : clock(t || 0); } catch { return clock(t || 0); } };
    return `<h4>Totals</h4><div class="grid">
        <div><small>Runs</small><b>${fmt(st.runs || 0)}</b></div>
        <div><small>Best time</small><b>${mmss(st.bestTime)}</b></div>
        <div><small>Best level</small><b>${st.bestLevel || 0}</b></div>
        <div><small>Defeated</small><b>${fmt(st.totalKills || 0)}</b></div>
      </div>${NS.DB.guest ? '<p class="sub" style="margin:0;color:#ffb0b8">Guest mode: progress isn’t saved.</p>' : ''}${endlessTotals(mmss)}`;
  }
  function endlessTotals(mmss) {
    const rec = load('endlessRec', {}), so = rec.solo || {}, gr = rec.group || {};
    if (!so.runs && !gr.runs) return '';
    return `<h4>∞ Endless <small class="sub">(kept apart: not on the leaderboard or in the totals above)</small></h4><div class="grid">
        <div><small>Best time (solo)</small><b>${so.time ? mmss(so.time) : '—'}</b></div>
        <div><small>Best time (co-op)</small><b>${gr.time ? mmss(gr.time) : '—'}</b></div>
        <div><small>Best level</small><b>${Math.max(so.level || 0, gr.level || 0) || '—'}</b></div>
        <div><small>Endless runs</small><b>${fmt((so.runs || 0) + (gr.runs || 0))}</b></div>
      </div>`;
  }

  // ----------------------------------------------------- Repertorio off
  // The "Repertorio" upgrade makes runs start with 2 moves. Upgrades.perks()
  // turns the bought upgrades into run bonuses; with this option on we hand
  // back startMoves = 1, as if it weren't bought. Nothing is refunded and it
  // can be switched back at any time.
  let noRepertorio = load('noRepertorio', false);

  function setupRepertorio() {
    const U = NS.Upgrades;
    const perks = U.perks;
    U.perks = function () {
      const out = perks.apply(this, arguments);
      if (noRepertorio && out && out.startMoves > 1) out.startMoves = 1;
      return out;
    };
    const add = () => {
      const list = document.getElementById('upg-list');
      if (!list || document.getElementById('psmod-norep')) return;
      const label = document.createElement('label');
      label.className = 'note';
      label.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:700;margin:8px 0';
      label.innerHTML = '<input type="checkbox" id="psmod-norep" style="width:18px;height:18px;margin:0;cursor:pointer"> Start with one move even if Repertoire is owned';
      const box = label.querySelector('input');
      box.checked = noRepertorio;
      box.addEventListener('change', () => { noRepertorio = box.checked; save('noRepertorio', noRepertorio); });
      list.before(label);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
    else add();
  }

  waitFor(() => NS && NS.Upgrades && NS.Upgrades.perks, setupRepertorio);

  // ---- missing translations
  // The Upgrades screen's Pokémon picker says "· 16 niveles": the game's
  // English dictionary has no entry for it.
  waitFor(() => NS && NS.I18n && NS.I18n.add, function translations() {
    if (NS.I18n.lang === 'es') return;
    NS.I18n.add({
      'niveles': 'levels', '{x} niveles': '{x} levels', '1 nivel': '1 level',
      // Pokémon screen: the partner button without "(shiny)" missed the
      // game's '{x}' pattern and came out as "Choose de partner".
      'Elegir de compañero': 'Choose as partner',
      // Paradox Pokémon: the game only has their Spanish names.
      'Colmilargo': 'Great Tusk', 'Colagrito': 'Scream Tail', 'Furioseta': 'Brute Bonnet', 'Melenaleteo': 'Flutter Mane',
      'Reptalada': 'Slither Wing', 'Pelarena': 'Sandy Shocks', 'Ferrodada': 'Iron Treads', 'Ferrosaco': 'Iron Bundle',
      'Ferropalmas': 'Iron Hands', 'Ferrocuello': 'Iron Jugulis', 'Ferropolilla': 'Iron Moth', 'Ferropúas': 'Iron Thorns',
      'Bramaluna': 'Roaring Moon', 'Ferropaladín': 'Iron Valiant', 'Ondulagua': 'Walking Wake', 'Ferroverdor': 'Iron Leaves',
      'Flamariete': 'Gouging Fire', 'Electrofuria': 'Raging Bolt', 'Ferromole': 'Iron Boulder', 'Ferrotesta': 'Iron Crown',
    });
    // Co-op level-up: "Still choosing: Misty y tú" — the game joins names
    // with a Spanish "y" (and "tú") that the dictionary can't reach.
    const R = NS.RunUI;
    if (R && R.setWaiting) {
      const set = R.setWaiting;
      R.setWaiting = function (names) {
        const out = set.apply(this, arguments);
        try {
          const el = document.getElementById('lvl-wait');
          const me = NS.Social && NS.Social.me ? NS.Social.me.name : '';
          const list = (names || []);
          const others = list.filter((n) => n !== me);
          const join = (a) => (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1] : a[0] || '');
          if (el) {
            el.textContent = !list.length ? '' : !others.length ? 'Choose your card'
              : list.includes(me) ? 'Still choosing: ' + join([...others, 'you']) : 'Waiting for ' + join(others) + '…';
            el.setAttribute('translate', 'no');
          }
        } catch (_) { /* keep the game's text */ }
        return out;
      };
    }
    // Translate a picker that is already on screen.
    const sel = document.getElementById('upg-mon');
    if (sel) for (const o of sel.options) o.textContent = o.textContent.replace(/\bniveles\b/g, 'levels');
  });

  // ------------------------------------------------------------ max all
  // Upgrades screen: one button that buys every level the selected Pokémon
  // is missing. With too few coins it buys as many levels as it can,
  // cheapest first. Asks for a second click before spending.
  const upgTotal = (dex) => {
    const lv = (NS.DB && NS.DB.save && NS.DB.save.pupg && NS.DB.save.pupg[dex]) || {};
    return Object.values(lv).reduce((a, b) => a + (+b || 0), 0);
  };
  const upgMax = () => (NS.Upgrades ? NS.Upgrades.LIST.reduce((a, u) => a + u.max, 0) : 0);
  function upgPlan(dex, coins) {
    const U = NS.Upgrades, lv = (NS.DB.save.pupg && NS.DB.save.pupg[dex]) || {};
    const steps = [];
    for (const u of U.LIST) for (let l = Math.max(0, +lv[u.id] || 0); l < u.max; l++) steps.push({ id: u.id, lvl: l, cost: U.cost(u.id, l) });
    const total = steps.reduce((a, s) => a + s.cost, 0);
    // Costs only grow with the level, so cheapest-first keeps each upgrade's
    // levels in order.
    steps.sort((a, b) => a.cost - b.cost || a.lvl - b.lvl);
    const buy = [];
    let spend = 0;
    for (const s of steps) { if (spend + s.cost > coins) break; spend += s.cost; buy.push(s); }
    return { total, left: steps.length, buy, spend };
  }
  function setupMaxAll() {
    const sel = document.getElementById('upg-mon'), list = document.getElementById('upg-list');
    if (!sel || !list || document.getElementById('psmod-maxall')) return;
    const st = document.createElement('style');
    st.textContent = '#psmod-maxall{white-space:nowrap;font-variant-ligatures:none}#psmod-maxall.confirm{animation:psmodPulse .5s ease-in-out infinite alternate}' +
      '@keyframes psmodPulse{to{filter:brightness(1.25)}}#psmod-maxall-note{font-size:12px;color:var(--muted,#b9cbf0);margin-left:2px}';
    document.head.appendChild(st);
    const btn = document.createElement('button');
    btn.id = 'psmod-maxall';
    btn.className = 'btn small gold';
    btn.dataset.sfx = 'none';
    const note = document.createElement('span');
    note.id = 'psmod-maxall-note';
    sel.after(btn, note);
    let armed = 0, plan = null;
    const coinsHtml = (n) => `<span class="coin"></span> ${n.toLocaleString('es')}`;
    const update = () => {
      const dex = +sel.value, s = NS.DB && NS.DB.save;
      if (!dex || !s) { btn.hidden = true; return; }
      btn.hidden = false;
      plan = upgPlan(dex, s.coins || 0);
      const lvl = upgTotal(dex), max = upgMax();
      note.textContent = `Level ${lvl} / ${max}`;
      btn.classList.toggle('confirm', !!armed);
      if (!plan.left) { btn.disabled = true; btn.innerHTML = 'All maxed'; btn.title = ''; return; }
      const full = plan.buy.length === plan.left;
      btn.disabled = !plan.buy.length;
      btn.title = full ? `Buys all ${plan.left} missing levels` : `Maxing needs ${plan.total.toLocaleString('es')} coins: this buys the ${plan.buy.length} cheapest levels you can afford`;
      if (armed) btn.innerHTML = `Confirm? ${coinsHtml(plan.spend)}`;
      else if (full || !plan.buy.length) btn.innerHTML = `Max all · ${coinsHtml(plan.total)}`;
      else btn.innerHTML = `Buy ${plan.buy.length} levels · ${coinsHtml(plan.spend)}`;
    };
    const disarm = () => { if (armed) { clearTimeout(armed); armed = 0; update(); } };
    btn.addEventListener('click', () => {
      update();
      if (!plan || !plan.buy.length) return;
      if (!armed) {
        armed = setTimeout(disarm, 3500);
        NS.Audio && NS.Audio.sfx('select');
        update();
        return;
      }
      clearTimeout(armed); armed = 0;
      // Re-read everything (the save may have changed since it was drawn).
      const dex = +sel.value, sv = NS.DB.save, lv = NS.DB.upgradesOf(dex);
      const p = upgPlan(dex, sv.coins || 0);
      let n = 0;
      for (const s of p.buy) {
        if ((+lv[s.id] || 0) !== s.lvl || sv.coins < s.cost) continue;
        sv.coins -= s.cost;
        lv[s.id] = s.lvl + 1;
        n++;
      }
      if (!n) { update(); return; }
      NS.DB.commit(true);
      NS.Audio && NS.Audio.sfx('buy');
      NS.UI && NS.UI.refreshCoins && NS.UI.refreshCoins();
      const mon = (NS.DEX_BY && NS.DEX_BY[dex]) || {};
      NS.UI && NS.UI.toast && NS.UI.toast(`${tr(mon.name || '')} · +${n} upgrade level${n === 1 ? '' : 's'}`);
      // Redraw the screen the game's way (also refreshes the Pokémon list).
      const item = document.querySelector('#scr-menu [data-go="upgrades"]');
      if (item && typeof item.onclick === 'function') item.onclick(); else update();
    });
    sel.addEventListener('change', disarm);
    // The game rebuilds the list on every purchase / selection.
    new MutationObserver(() => update()).observe(list, { childList: true });
    update();
  }

  // ------------------------------------------------------------ upgrades layout
  // Tighter cards, the Ban "Choose" button inside its card, and Move shortcuts
  // filling the rest of the last row. The shortcut pickers show each move's
  // type icon (a list of our own drives the game's hidden <select>).
  function setupUpgLayout() {
    const list = document.getElementById('upg-list');
    if (!list || list.dataset.psmodLayout) return;
    list.dataset.psmodLayout = '1';
    const st = document.createElement('style');
    st.textContent = `
#upg-list{grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px}
#upg-list .upg-item{grid-template-columns:34px 1fr auto;gap:8px;padding:8px 10px;align-items:center}
#upg-list .upg-item b{font-size:15px}
#upg-list .upg-item .upg-btns{flex-wrap:nowrap}
#upg-list .upg-item .psm-ban{margin-top:6px;padding:3px 10px;font-size:12px}
#upg-list .bind-panel{display:flex;flex-direction:column;gap:6px;padding:10px 12px}
#upg-list .bind-panel > b{display:flex;align-items:center;gap:8px}
#upg-list .bind-panel .sub{margin:0!important;font-size:12px;line-height:1.35}
#upg-list .bind-slots{grid-template-columns:repeat(var(--psm-cols,4),minmax(0,1fr));gap:8px}
#upg-list .bind-slot select{display:none!important}
.psm-mvbtn{display:flex;align-items:center;gap:7px;width:100%;min-width:0;box-sizing:border-box;padding:6px 26px 6px 8px;border-radius:10px;cursor:pointer;position:relative;
  font:inherit;font-size:14px;color:#fff;text-align:left;background:rgba(5,12,34,.55);border:2px solid rgba(244,248,255,.35);text-shadow:1px 1px 0 #0a1430}
.psm-mvbtn:hover,.psm-mvbtn.psmod-padfocus{border-color:var(--gold,#ffd23f)}
.psm-mvbtn::after{content:'▾';position:absolute;right:9px;top:50%;transform:translateY(-50%);color:var(--muted,#b9cbf0);font-size:12px}
.psm-mvbtn span.n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.psm-mvbtn .free{color:var(--muted,#b9cbf0)}
.psm-mvbtn img,#psmod-mvpop img{flex:none;image-rendering:pixelated}
#psmod-mvpop{position:fixed;z-index:100002;min-width:220px;max-height:min(360px,60vh);overflow:auto;padding:6px;border-radius:12px;box-sizing:border-box;
  background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));border:3px solid var(--edge,#f4f8ff);box-shadow:0 0 0 3px var(--edge-out,#0b1838),0 10px 24px rgba(0,0,0,.5)}
#psmod-mvpop[hidden]{display:none}
#psmod-mvpop button{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:8px;background:none;color:#fff;font:inherit;font-size:14px;text-align:left;cursor:pointer;text-shadow:1px 1px 0 #0a1430}
#psmod-mvpop button:hover,#psmod-mvpop button.psmod-padfocus{background:rgba(255,255,255,.12)}
#psmod-mvpop button.on{background:rgba(255,210,63,.18);color:var(--gold,#ffd23f)}
#psmod-mvpop button .t{margin-left:auto;font-size:12px;padding:1px 7px;border-radius:7px;color:#fff;opacity:.9}
#psmod-mvpop button .used{font-size:11px;color:var(--muted,#b9cbf0)}`;
    document.head.appendChild(st);

    let pop = null, popFor = null;
    const closePop = () => { if (pop && !pop.hidden) { pop.hidden = true; const b = popFor; popFor = null; if (b && b.isConnected && padMode) navSet(b); } };
    const typeOf = (id) => { const m = NS.Moves && NS.Moves.BY_ID[id]; return m ? m.type : null; };
    const icon = (id, n = 18) => { try { return NS.Icons.html('type:' + (typeOf(id) || 'normal'), n); } catch (_) { return ''; } };
    const moveName = (id) => tr(((NS.Moves && NS.Moves.BY_ID[id]) || {}).name || id);
    function openPop(btn, sel) {
      if (!pop) {
        pop = document.createElement('div');
        pop.id = 'psmod-mvpop';
        pop.hidden = true;
        document.body.appendChild(pop);
        pop.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-v]');
          if (!b || !popFor) return;
          e.stopPropagation();
          const s = popFor.__sel;
          pop.hidden = true; popFor = null;
          if (s.value !== b.dataset.v) { s.value = b.dataset.v; s.dispatchEvent(new Event('change')); }
        });
        document.addEventListener('pointerdown', (e) => { if (pop && !pop.hidden && !pop.contains(e.target) && !e.target.closest('.psm-mvbtn')) closePop(); }, true);
        addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop && !pop.hidden) { e.stopImmediatePropagation(); e.preventDefault(); closePop(); } }, true);
        addEventListener('resize', closePop);
      }
      if (popFor === btn && !pop.hidden) { closePop(); return; }
      // Moves already in another slot say which.
      const used = new Map();
      for (const o of list.querySelectorAll('.bind-slot select')) if (o !== sel && o.value) used.set(o.value, +o.dataset.slot + 1);
      pop.innerHTML = [...sel.options].map((o) => {
        const v = o.value, on = v === sel.value;
        if (!v) return `<button data-v="" class="${on ? 'on' : ''}" data-sfx="none"><span style="width:18px;text-align:center">–</span>${esc(tr('Libre'))}</button>`;
        const t = typeOf(v), col = (NS.U && NS.U.TYPE_COLOR && NS.U.TYPE_COLOR[t]) || '#777';
        return `<button data-v="${esc(v)}" class="${on ? 'on' : ''}" data-sfx="none">${icon(v, 22)}<span>${esc(moveName(v))}</span>${used.has(v) ? `<span class="used">slot ${used.get(v)}</span>` : ''}<span class="t" style="background:${col}">${esc(cap(tr(t || '')))}</span></button>`;
      }).join('');
      popFor = btn;
      pop.hidden = false;
      const r = btn.getBoundingClientRect(), ph = pop.offsetHeight, pw = Math.max(r.width, pop.offsetWidth);
      const below = r.bottom + 6 + ph <= innerHeight - 8;
      Object.assign(pop.style, { left: Math.max(8, Math.min(innerWidth - pw - 8, r.left)) + 'px', top: (below ? r.bottom + 6 : Math.max(8, r.top - 6 - ph)) + 'px', minWidth: r.width + 'px' });
      const cur = pop.querySelector('button.on') || pop.querySelector('button');
      if (cur) { cur.scrollIntoView({ block: 'nearest' }); if (padMode) navSet(cur); }
    }
    function arrange() {
      closePop();
      const items = [...list.querySelectorAll(':scope > .upg-item')];
      if (!items.length) return;
      // Ban: its "Choose" button goes under the bar, so the card keeps its size.
      for (const it of items) {
        const ban = it.querySelector('.upg-btns [data-ban]');
        if (ban) { ban.classList.add('psm-ban'); it.children[1].appendChild(ban); }
      }
      const bind = list.querySelector(':scope > .bind-panel');
      if (!bind) return;
      items[items.length - 1].after(bind);
      const cols = getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      const free = (cols - (items.length % cols)) % cols;
      const span = free >= 2 ? free : cols;
      bind.style.gridColumn = span >= cols ? '1 / -1' : `span ${span}`;
      bind.style.setProperty('--psm-cols', span >= cols ? (cols >= 2 ? 4 : 2) : span >= 3 ? 4 : 2);
      // Pickers with type icons.
      for (const sel of bind.querySelectorAll('select[data-slot]')) {
        let btn = sel.parentElement.querySelector('.psm-mvbtn');
        if (!btn) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'psm-mvbtn';
          btn.dataset.sfx = 'click';
          btn.__sel = sel;
          sel.after(btn);
          btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openPop(btn, sel); });
        }
        const v = sel.value;
        btn.innerHTML = v ? `${icon(v)}<span class="n">${esc(moveName(v))}</span>` : `<span class="n free">${esc(tr('Libre'))}</span>`;
        btn.title = v ? moveName(v) + ' · ' + cap(tr(typeOf(v) || '')) : '';
      }
    }
    const mo = new MutationObserver(() => { mo.disconnect(); try { arrange(); } catch (err) { trip('setupUpgLayout', err); } mo.observe(list, { childList: true }); });
    mo.observe(list, { childList: true });
    addEventListener('resize', () => { if (list.children.length) { mo.disconnect(); try { arrange(); } catch (_) { /* ignore */ } mo.observe(list, { childList: true }); } });
    const scr = document.getElementById('scr-upgrades');
    if (scr) new MutationObserver(() => { if (scr.classList.contains('hidden')) closePop(); }).observe(scr, { attributes: true, attributeFilter: ['class'] });
    arrange();
  }
  waitFor(() => NS && NS.Upgrades && NS.Icons && NS.Moves && document.getElementById('upg-list'), setupUpgLayout);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => waitFor(() => NS && NS.Upgrades && NS.DB, setupMaxAll));
  else waitFor(() => NS && NS.Upgrades && NS.DB, setupMaxAll);

  // --------------------------------------------------------- connection
  // In co-op the game talks over a direct WebRTC link. When that link drops,
  // Net reports the peer as 'failed'/'closed' and Coop throws the player out
  // at once, even though the host's Net retries the link 15 s later. We hold
  // those reports for a grace period and let them through only if the link
  // didn't come back. Players who leave on purpose are already gone from
  // Coop by then, so for them nothing is held.
  // Side effect: enemies that appear while the link is down stay invisible
  // (and harmless) for whoever was disconnected.
  const GRACE_MS = 30000;
  const NETLOG_MAX = 60;

  function netLog(text) {
    const log = load('netlog', []);
    log.unshift({ at: Date.now(), text });
    save('netlog', log.slice(0, NETLOG_MAX));
  }

  function peerName(uid) {
    const C = NS.Coop;
    if (C && NS.Net && uid === NS.Net.hostUid) return 'the host';
    const m = C && C.mate && C.mate(uid);
    return (m && m.name) || 'a player';
  }

  function stillInGame(uid) {
    const C = NS.Coop;
    if (!C || !C.active) return false;
    if (!C.isHost) return uid === (NS.Net && NS.Net.hostUid);
    const m = C.mate && C.mate(uid);
    return !!(m && m.connected);
  }

  function patchNet(Net) {
    const onPeer = Net.onPeer;
    Net.onPeer = function (cb) { return onPeer.call(this, graceWrap(cb)); };
  }

  // The deadline counts from the first drop and only a 'direct' link ends the
  // hold early. Each retry of the host goes 'connecting' -> 'failed' again,
  // and that used to restart the wait, so a link that never came back left
  // both players frozen for good (e.g. on the level-up screen, each one
  // "waiting" for the other). Past the deadline the game gets the drop and
  // handles it as it would without the mod; an attempt already under way
  // gets up to GRACE_EXTRA_MS more to finish.
  const GRACE_EXTRA_MS = 10000;

  function graceWrap(cb) {
    const held = new Map(); // uid -> { timer, name, until }
    const release = (uid, self) => {
      const h = held.get(uid);
      if (!h) return;
      const now = NS.Net.mode(uid);
      if (now === 'direct') { clearTimeout(h.timer); held.delete(uid); return; }
      if (now === 'connecting' && Date.now() < h.until) { h.timer = setTimeout(() => release(uid, self), 1000); return; }
      held.delete(uid);
      netLog(`Could not restore the connection with ${h.name} (${now}).`);
      if (notif.conn) toast(`Could not restore the connection with ${h.name}`, '#ff5f6d');
      cb.call(self, uid, now === 'connecting' ? 'failed' : now);
    };
    return function (uid, mode) {
      if (mode === 'direct' && held.has(uid)) {
        clearTimeout(held.get(uid).timer);
        held.delete(uid);
        netLog(`Connection with ${peerName(uid)} restored.`);
        if (notif.conn) toast(`Connection with ${peerName(uid)} restored`, '#5fe08a');
        return cb.apply(this, arguments);
      }
      if (held.has(uid)) return; // retries in between: still within the same wait
      if ((mode === 'failed' || mode === 'closed') && stillInGame(uid)) {
        const name = peerName(uid);
        netLog(`Connection with ${name} dropped (${mode}). Waiting for it to return.`);
        if (notif.conn) toast(`Connection lost with ${name}`, '#ffcb3d', `Reconnecting… (up to ${GRACE_MS / 1000} s)`);
        const self = this;
        held.set(uid, { name, until: Date.now() + GRACE_MS + GRACE_EXTRA_MS, timer: setTimeout(() => release(uid, self), GRACE_MS) });
        return;
      }
      return cb.apply(this, arguments);
    };
  }

  // What the browser did to the tab: these are the usual silent kicks.
  const wasDiscarded = !!document.wasDiscarded;
  if (wasDiscarded) netLog('The browser discarded this tab to save memory and reloaded it.');
  document.addEventListener('freeze', () => netLog('The browser froze the tab (it was in the background).'));
  document.addEventListener('resume', () => netLog('The tab resumed after being frozen.'));
  addEventListener('offline', () => { netLog('Internet connection lost.'); if (notif.conn) toast('No internet connection', '#ff5f6d'); });
  addEventListener('online', () => netLog('Internet connection restored.'));

  function toggleNetLog() {
    if (!sumEl) return;
    if (!sumEl.hidden && sumEl.dataset.view === 'log') { sumEl.hidden = true; return; }
    const log = load('netlog', []);
    sumEl.dataset.view = 'log';
    sumEl.innerHTML = `
      <div class="top"><h3>Connection log</h3><button data-act="close">Close</button></div>
      ${log.length ? `<table><tbody>${log.slice(0, 30).map((l) => {
        const d = new Date(l.at);
        return `<tr><td>${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</td><td style="white-space:normal">${esc(l.text)}</td></tr>`;
      }).join('')}</tbody></table>` : '<p class="sub">Nothing unusual has happened yet.</p>'}
      <p class="sub">If you get kicked from a game, open this (Alt + L) and check the last line: it says whether it was your connection to each other, the internet, or the browser.</p>`;
    sumEl.hidden = false;
  }

  // ------------------------------------------------------------- buffs
  // Your current multipliers, and what's shared in co-op: team XP is the
  // average of everyone's Aprendizaje divided by (1 + 0.6 per extra player),
  // and enemies get +30 % HP and +75 % spawn rate per extra player.
  const pctOf = (m) => { const v = Math.round(Math.abs(m - 1) * 100); return v ? `${m >= 1 ? '+' : '-'}${v}%` : '0%'; };
  const dec = (v, d = 2) => v.toFixed(d);
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;

  function buffsHtml() {
    const p = me();
    if (!p) return '';
    const out = [];
    const taken = p.statsTaken || {};
    const n = (id) => (taken[id] ? ` (${taken[id]})` : '');
    out.push('<h4>YOUR UPGRADES</h4>');
    out.push(kv(`Damage${n('atk')}`, `×${dec(p.atkMul || 1)}`));
    out.push(kv(`Cooldown${n('cd')}`, pctOf(p.cdMul || 1)));
    out.push(kv(`Speed${n('spd')}`, pctOf(p.spdMul || 1)));
    out.push(kv(`Damage reduction${n('def')}`, `${Math.round((p.reduction || 0) * 100)}%`));
    out.push(kv(`Regeneration${n('rgn')}`, `${dec(p.regen || 0, 1)} health/s`));
    out.push(kv('Crits (×1.5)', `${Math.round((p.critChance || 0) * 100)}%`));
    out.push(kv(`Magnet${n('mag')}`, pctOf((p.magnet || 78) / 78)));
    out.push(kv(`Experience${n('xp')}`, pctOf(p.xpMul || 1)));
    const B = p.buffs || {};
    const BN = { atk: 'attack', spd: 'speed', def: 'defense', regen: 'regeneration' };
    for (const k of Object.keys(BN)) {
      const b = B[k];
      if (!b || !b.n) continue;
      const val = k === 'regen' ? `+${dec(b.n * b.amount, 1)}/s` : `+${Math.round(b.n * b.amount * 100)}%`;
      out.push(kv(`Boost: ${BN[k]} (${b.n}×)`, `${val}${b.t > 0 ? ` - ${Math.ceil(b.t)} s` : ''}`));
    }
    if (p.item && NS.Items && NS.Items.BY[p.item]) out.push(kv('Item', esc(tr(NS.Items.BY[p.item].name))));

    const C = NS.Coop;
    if (C && C.active) {
      const mates = C.mates.filter((m) => m.connected);
      const team = [{ name: 'You', xp: p.xpMul || 1, mag: (p.magnet || 78) / 78 }]
        .concat(mates.map((m) => {
          const net = (m.pl && m.pl.net) || {};
          return { name: m.name, xp: net.xpMul || 1, mag: (net.mag || 78) / 78 };
        }));
      const count = team.length;
      const avg = team.reduce((a, t) => a + t.xp, 0) / count;
      const penalty = 1 + 0.6 * (count - 1);
      out.push('<h4>TEAM</h4>');
      for (const t of team) out.push(kv(esc(t.name), `XP ${pctOf(t.xp)} - magnet ${pctOf(t.mag)}`));
      out.push(kv('Team average Learning', pctOf(avg)));
      out.push(kv(`Shared between ${count} players`, `÷${dec(penalty, 1)}`));
      out.push(kv('Experience gained', `×${dec(avg / penalty)}`));
      out.push(kv('Enemy health', pctOf(1 + 0.3 * (count - 1))));
      out.push(kv('Enemy spawn rate', pctOf(1 + 0.75 * (count - 1))));
    }
    return out.join('');
  }

  // ------------------------------------------------------------ minimap
  // Everything is read straight from the game's modules each frame: World for
  // terrain, EnemyMgr / Pickups / Rift / Events for markers, Coop for mates.
  const MAP_MIN = 120, MAP_MAX = 520;
  const clampMap = (v) => Math.round(Math.min(MAP_MAX, Math.max(MAP_MIN, +v || 184)));
  let MAP_PX = clampMap(load('mapSize', 184));
  // World units from centre to edge. The game keeps at most 400 map chunks
  // (512 units each) in memory and throws the oldest away; reading terrain and
  // props too far out made it drop and rebuild chunks nonstop (the old 5/5
  // zoom lagged and reset chests and rocks).
  // Fixed at 1200 (the old default zoom).
  const mapRange = 1200;
  const MAP_OPACITY = 0.7;
  let mapShown = load('mapShown', true);
  let mapEl = null, mapCtx = null, lastMapDraw = 0;
  let props = [], lastPropScan = 0;

  // Terrain sampling (World.kindAt) costs ~10µs per call, so samples are cached
  // per cell size and filled in a bounded number per frame. The cache is
  // dropped whenever the world changes (new run, biome, arena).
  const terrain = new Map(); // cellSize -> Map(key -> colour | null)
  let terrainSig = '';
  const SAMPLE_BUDGET = 1200;
  const LIQUID = { water: '#3f86d8', lava: '#ff6a2b', ice: '#bfe8ff', poison: '#a35ad8', swamp: '#5e8a4a' };

  const cellFor = (range) => (range <= 1200 ? 32 : 64);

  function terrainColor(x, y) {
    const k = NS.World.kindAt(x, y);
    if (k === 'wall') return '#16241c';
    if (k === 'liquid') return LIQUID[NS.World.liquidKind(x, y)] || '#4fb4ff';
    return null;
  }

  function buildMap() {
    const style = document.createElement('style');
    style.textContent = `
#psmod-map{position:fixed;z-index:99998;padding:6px;font:12px/1.2 var(--font,'Pixelify',system-ui,sans-serif);color:#fff;
  background:linear-gradient(#2c519f,#1a3170);border:2px solid #f4f8ff;outline:2px solid #0b1838;border-radius:8px;
  box-shadow:inset 0 0 0 2px #5b83d6,0 4px 0 #0a1430;user-select:none;-webkit-user-select:none;
  opacity:${MAP_OPACITY};cursor:move;touch-action:none}
#psmod-map.psmod-hidden{display:none}
#psmod-map canvas{display:block;border-radius:4px;background:#41604f}
#psmod-map .ps-corner{position:absolute;width:14px;height:14px;opacity:0;transition:opacity .15s}
#psmod-map:hover .ps-corner{opacity:1}
#psmod-map .ps-corner::after{content:'';position:absolute;inset:3px;border:0 solid #ffd23f}
#psmod-map .ps-corner.tl{left:-4px;top:-4px;cursor:nwse-resize}#psmod-map .ps-corner.tl::after{border-left-width:3px;border-top-width:3px}
#psmod-map .ps-corner.tr{right:-4px;top:-4px;cursor:nesw-resize}#psmod-map .ps-corner.tr::after{border-right-width:3px;border-top-width:3px}
#psmod-map .ps-corner.bl{left:-4px;bottom:-4px;cursor:nesw-resize}#psmod-map .ps-corner.bl::after{border-left-width:3px;border-bottom-width:3px}
#psmod-map .ps-corner.br{right:-4px;bottom:-4px;cursor:nwse-resize}#psmod-map .ps-corner.br::after{border-right-width:3px;border-bottom-width:3px}`;
    document.head.appendChild(style);

    mapEl = document.createElement('div');
    mapEl.id = 'psmod-map';
    mapEl.className = 'psmod-hidden';
    mapEl.title = 'Drag to move · drag a corner to resize';
    mapEl.innerHTML = '<canvas></canvas><i class="ps-corner tl"></i><i class="ps-corner tr"></i><i class="ps-corner bl"></i><i class="ps-corner br"></i>';
    document.body.appendChild(mapEl);
    const cv = mapEl.querySelector('canvas');
    const dpr = Math.max(1, Math.min(3, devicePixelRatio || 1));
    mapCtx = cv.getContext('2d');
    // Bigger map = same area drawn larger, at full resolution.
    const setSize = (n) => {
      MAP_PX = clampMap(n);
      cv.style.width = cv.style.height = MAP_PX + 'px';
      cv.width = cv.height = Math.round(MAP_PX * dpr);
      mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastMapDraw = 0;
    };
    setSize(MAP_PX);
    for (const ev of ['pointerdown', 'mousedown', 'touchstart']) mapEl.addEventListener(ev, (e) => e.stopPropagation());

    // Top-right corner by default; drag it anywhere.
    const drag = makeDraggable(mapEl, mapEl, 'mapPos4', () => ({ right: 12, y: hudStyle === 'new' ? 12 : Math.round(48 * hudScale) + 12 }));

    // Corners resize around the map's centre, so it stays where it is.
    for (const c of mapEl.querySelectorAll('.ps-corner')) {
      c.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const r = mapEl.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const pad = r.width - MAP_PX;
        c.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const half = Math.max(Math.abs(ev.clientX - cx), Math.abs(ev.clientY - cy));
          setSize(Math.min(2 * half - pad, innerHeight - 40, innerWidth - 40));
          drag.moveTo(Math.round(cx - mapEl.offsetWidth / 2), Math.round(cy - mapEl.offsetHeight / 2));
        };
        const up = () => {
          c.removeEventListener('pointermove', move);
          c.removeEventListener('pointerup', up);
          c.removeEventListener('pointercancel', up);
          save('mapSize', MAP_PX);
          drag.commit();
        };
        c.addEventListener('pointermove', move);
        c.addEventListener('pointerup', up);
        c.addEventListener('pointercancel', up);
      });
    }
    requestAnimationFrame(mapLoop);
  }

  function mapLoop(now) {
    requestAnimationFrame(mapLoop);
    const visible = mapShown && inRun() && !settingsOpen() && featOn('minimap');
    mapEl.classList.toggle('psmod-hidden', !visible);
    if (!visible || now - lastMapDraw < 60) return;
    lastMapDraw = now;
    try { drawMap(); } catch (err) { trip('minimap', err); }
  }

  // What the minimap shows (Settings → Extras → Minimap shows).
  const MAP_LAYERS = [
    ['terrain', 'Terrain'], ['view', 'Screen view'], ['mates', 'Teammates'], ['enemies', 'Enemies'],
    ['bosses', 'Bosses & legendaries'], ['shinies', 'Shinies'], ['golden', 'Golden & thieves'],
    ['rift', 'Rifts'], ['events', 'Events'], ['chests', 'Chests'], ['altars', 'Altars'], ['springs', 'Healing puddles'], ['items', 'Items'],
  ];
  const mapLayers = Object.assign(Object.fromEntries(MAP_LAYERS.map(([k]) => [k, true])), load('mapLayers', {}));
  const ml = (k) => mapLayers[k] !== false;

  function drawMap() {
    const p = me();
    const g = mapCtx;
    const H = MAP_PX / 2;
    const s = H / mapRange;
    const cx = p.x, cy = p.y;
    const toX = (x) => H + (x - cx) * s;
    const toY = (y) => H + (y - cy) * s;
    const inside = (x, y) => Math.abs(x - cx) <= mapRange && Math.abs(y - cy) <= mapRange;
    // Project onto the map border, for markers worth chasing when off-map.
    const edge = (x, y) => {
      const dx = x - cx, dy = y - cy, m = Math.max(Math.abs(dx), Math.abs(dy)) || 1;
      const k = Math.min(1, (mapRange - 6 / s) / m);
      return [H + dx * k * s, H + dy * k * s];
    };

    g.clearRect(0, 0, MAP_PX, MAP_PX);
    g.fillStyle = '#41604f';
    g.fillRect(0, 0, MAP_PX, MAP_PX);

    // Terrain.
    const W = NS.World;
    if (!ml('terrain')) { g.fillStyle = '#26394a'; g.fillRect(0, 0, MAP_PX, MAP_PX); }
    const sig = `${runId}|${String(W.biome)}|${W.arena ? 1 : 0}`;
    if (sig !== terrainSig) { terrain.clear(); terrainSig = sig; }
    const cell = cellFor(mapRange);
    let cache = terrain.get(cell);
    if (!cache) terrain.set(cell, (cache = new Map()));
    const c0x = Math.floor((cx - mapRange) / cell), c1x = Math.floor((cx + mapRange) / cell);
    const c0y = Math.floor((cy - mapRange) / cell), c1y = Math.floor((cy + mapRange) / cell);
    const px = Math.ceil(cell * s) + 0.5;
    let budget = SAMPLE_BUDGET;
    for (let j = c0y; j <= c1y; j++) {
      for (let i = c0x; i <= c1x; i++) {
        const key = i + ',' + j;
        let col = cache.get(key);
        if (col === undefined) {
          if (budget-- <= 0) continue;
          col = terrainColor(i * cell + cell / 2, j * cell + cell / 2);
          cache.set(key, col);
        }
        if (col && ml('terrain')) { g.fillStyle = col; g.fillRect(toX(i * cell), toY(j * cell), px, px); }
      }
    }

    // What the camera currently shows.
    const C = NS.Camera;
    if (ml('view')) {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 1;
      g.strokeRect(toX(C.left()) + 0.5, toY(C.top()) + 0.5, C.w * s, C.h * s);
    }

    const dot = (x, y, r, fill, ring) => {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = fill;
      g.fill();
      if (ring) { g.lineWidth = 1.5; g.strokeStyle = ring; g.stroke(); }
    };

    // Pickups worth walking to (xp gems and coins would just be noise).
    const KIND = NS.Pickups.KIND || {};
    for (const q of NS.Pickups.all()) {
      if (!ml('items') || q.kind === 'xp' || q.kind === 'xpBig' || q.kind === 'coin' || !inside(q.x, q.y)) continue;
      const col = (KIND[q.kind] && KIND[q.kind].color) || '#ffd23f';
      const x = toX(q.x), y = toY(q.y);
      g.fillStyle = '#0b1838';
      g.fillRect(x - 3, y - 3, 6, 6);
      g.fillStyle = col;
      g.fillRect(x - 2, y - 2, 4, 4);
    }

    // Chests, big chests and altars. Scanning props is slower than the rest,
    // so the list is refreshed twice a second.
    const now = performance.now();
    if (now - lastPropScan > 500) {
      lastPropScan = now;
      props = [];
      const r = mapRange;
      for (const q of W.propsInCircle(cx, cy, r) || []) if (q.type === 'chest') props.push(q);
      for (const q of (W.specialsNear && W.specialsNear(cx, cy, r)) || []) if (q.type === 'bigchest' || q.type === 'altar' || q.type === 'spring') props.push(q);
    }
    for (const q of props) {
      if (q.type === 'spring') {
        // Healing puddle: a green drop with a white cross; faded while it refills.
        if (!ml('springs') || !inside(q.x, q.y)) continue;
        const x = toX(q.x), y = toY(q.y), ready = (q.charge == null ? 1 : q.charge) >= 0.15;
        g.save();
        g.globalAlpha = ready ? 1 : 0.4;
        dot(x, y, 5.5, '#2fbf6a', '#ffffff');
        g.fillStyle = '#ffffff';
        g.fillRect(x - 1, y - 3.5, 2, 7); g.fillRect(x - 3.5, y - 1, 7, 2);
        g.restore();
        continue;
      }
      if (q.used || q.open || q.hp <= 0 || !inside(q.x, q.y)) continue;
      if (!ml(q.type === 'altar' ? 'altars' : 'chests')) continue;
      const x = toX(q.x), y = toY(q.y);
      if (q.type === 'altar') {
        g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
        g.fillStyle = '#7fe0ff'; g.strokeStyle = '#0b1838'; g.lineWidth = 1.5;
        g.fillRect(-3, -3, 6, 6); g.strokeRect(-3, -3, 6, 6);
        g.restore();
        continue;
      }
      const h = q.type === 'bigchest' ? 4.5 : 3;
      g.fillStyle = '#0b1838';
      g.fillRect(x - h - 1, y - h - 1, 2 * h + 2, 2 * h + 2);
      g.fillStyle = q.type === 'bigchest' ? '#ffd23f' : '#c98a3c';
      g.fillRect(x - h, y - h, 2 * h, 2 * h);
    }

    // Enemies: plain ones as small red dots, special ones bigger and pinned to
    // the border when they are out of range.
    const special = [];
    for (const e of NS.EnemyMgr.all()) {
      if (e.dead) continue;
      if (e.boss || e.legend || e.judge || e.shiny || e.golden || e.behavior === 'thief') {
        const layer = e.boss || e.legend || e.judge ? 'bosses' : e.shiny ? 'shinies' : 'golden';
        if (ml(layer)) special.push(e);
        continue;
      }
      if (!ml('enemies') || !inside(e.x, e.y)) continue;
      g.fillStyle = '#ff5f6d';
      g.fillRect(toX(e.x) - 1, toY(e.y) - 1, 2.5, 2.5);
    }
    const pulse = 5 + 3 * Math.sin(performance.now() / 160);
    for (const e of special) {
      const [x, y] = edge(e.x, e.y);
      if (e.shiny || e.golden) {
        g.beginPath();
        g.arc(x, y, pulse + 3, 0, Math.PI * 2);
        g.lineWidth = 1.5;
        g.strokeStyle = e.shiny ? '#7fe0ff' : '#ffd23f';
        g.stroke();
      }
      if (e.boss || e.legend || e.judge) dot(x, y, 5, e.legend || e.judge ? '#c47bff' : '#ff3048', '#ffffff');
      else if (e.shiny) dot(x, y, 4, '#7fe0ff', '#ffffff');
      else dot(x, y, 3.5, '#ffd23f', '#0b1838');
    }

    // Rift portal and map events (golden thief and similar).
    const rift = NS.Rift.rift;
    if (ml('rift') && rift && typeof rift.x === 'number') {
      const [x, y] = edge(rift.x, rift.y);
      g.lineWidth = 2.5;
      g.strokeStyle = '#c47bff';
      g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke();
    }
    const ev = NS.Events.current;
    if (ml('events') && ev && typeof ev.x === 'number') {
      const [x, y] = edge(ev.x, ev.y);
      g.save(); g.translate(x, y); g.rotate(Math.PI / 4);
      g.fillStyle = '#ffd23f'; g.strokeStyle = '#0b1838'; g.lineWidth = 1.5;
      g.fillRect(-4, -4, 8, 8); g.strokeRect(-4, -4, 8, 8);
      g.restore();
    }

    // Mates, then me on top as an arrow pointing where I'm walking.
    if (NS.Coop.active && ml('mates')) {
      for (const m of NS.Coop.players()) {
        if (m === p) continue;
        const [x, y] = edge(m.x, m.y);
        const down = m.dead || (m.net && m.net.dead);
        if (down) {
          g.beginPath();
          g.arc(x, y, pulse + 4, 0, Math.PI * 2);
          g.lineWidth = 2;
          g.strokeStyle = '#ff5f6d';
          g.stroke();
        }
        dot(x, y, 4.5, down ? '#5b6b88' : m.tagColor || '#5fc8ff', '#0b1838');
      }
    }
    const a = typeof p.moveAngle === 'number' ? p.moveAngle : -Math.PI / 2;
    g.save();
    g.translate(H, H);
    g.rotate(a);
    g.beginPath();
    g.moveTo(7, 0); g.lineTo(-5, -5); g.lineTo(-2, 0); g.lineTo(-5, 5); g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = p.tagColor || '#ffd23f';
    g.stroke();
    g.restore();
  }

  // ------------------------------------------------------------ gacha
  // Skip: GachaUI awaits Slots.play(canvas, results) before showing the cards;
  // the pull itself is already rolled and saved by then, so resolving early
  // only cuts the slot-machine show. Slots.stop() halts its animation; the
  // abandoned play() then rejects on its own, which we swallow.
  //
  // Pull all: we trigger the game's own x1 pull (so it saves, checks
  // achievements and shows the cards as usual) and, for that one call, make
  // Gacha.pull spend every ticket instead: x10 tickets first, then normal
  // tickets in tens (keeping the "x10 guarantees an epic" rule), then singles.
  let skipGacha = load('skipGacha', false);
  let pullAllArmed = false, forceSkip = false, revealBudget = null;

  const pullsAvailable = () => {
    const t = (NS.DB && NS.DB.save && NS.DB.save.tickets) || {};
    return (t.t1 || 0) + 10 * (t.t10 || 0);
  };

  function setupGacha() {
    const { Slots, Gacha, Audio } = NS;

    const pull = Gacha.pull;
    Gacha.pull = function (save, n, gen, kind) {
      if (!pullAllArmed) return pull.apply(this, arguments);
      pullAllArmed = false;
      const t = save.tickets || {};
      const out = [];
      const take = (count, k) => { const r = pull.call(this, save, count, gen, k); if (r) out.push(...r); return !!r; };
      while ((t.t10 || 0) >= 1 && take(10, 't10'));
      while ((t.t1 || 0) >= 10 && take(10, 't1'));
      while ((t.t1 || 0) >= 1 && take(1, 't1'));
      return out.length ? out : null;
    };

    // The game plays a 'reveal' sound per card; with dozens of cards shown at
    // once that is a wall of noise, so only the first one plays.
    const sfx = Audio.sfx;
    Audio.sfx = function (name) {
      if (name === 'reveal' && revealBudget !== null && revealBudget-- <= 0) return;
      return sfx.apply(this, arguments);
    };

    const play = Slots.play;
    Slots.play = function (canvas, results) {
      if (skipGacha || forceSkip) { forceSkip = false; return Promise.resolve(); }
      return new Promise((resolve) => {
        let done = false;
        const btn = skipButton(canvas, () => { Slots.stop(); finish(); });
        function finish() {
          if (done) return;
          done = true;
          btn.remove();
          resolve();
        }
        let run;
        try { run = play.call(this, canvas, results); } catch { run = Promise.resolve(); }
        Promise.resolve(run).then(finish, finish);
      });
    };

    const addToggle = () => {
      const anchor = document.getElementById('gacha-pity');
      if (!anchor || document.getElementById('psmod-skip')) return;
      const label = document.createElement('label');
      label.className = 'note';
      label.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:700';
      label.innerHTML = '<input type="checkbox" id="psmod-skip" style="width:18px;height:18px;margin:0;cursor:pointer"> Always skip the slot machine animation';
      const box = label.querySelector('input');
      box.checked = skipGacha;
      box.addEventListener('change', () => { skipGacha = box.checked; save('skipGacha', skipGacha); });
      anchor.after(label);

      const one = document.getElementById('pull-1');
      if (!one || !one.parentElement) return;
      const all = document.createElement('button');
      all.id = 'psmod-pull-all';
      all.className = 'btn grow';
      all.dataset.sfx = 'none';
      one.parentElement.appendChild(all);
      const refresh = () => {
        const n = pullsAvailable();
        let tk = ''; try { tk = NS.Icons.html('ticket', 18); } catch (_) { tk = '🎫'; }
        all.innerHTML = `<b class="psg-l">Use all</b><span class="psg-c"><span class="psg-glow">${tk}</span> ×${n}</span>`;
        all.disabled = n <= 0;
      };
      all.addEventListener('click', () => {
        if (pullsAvailable() <= 0 || typeof one.onclick !== 'function') return;
        pullAllArmed = true;
        forceSkip = true;
        revealBudget = 1;
        // Called directly so it works even when the x1 button is disabled
        // (only x10 tickets left).
        one.onclick();
        // The game pulls and starts Slots.play synchronously inside that call,
        // so anything still armed here means it bailed out early.
        pullAllArmed = false;
        forceSkip = false;
        setTimeout(() => { revealBudget = null; }, 4000);
        all.blur();
      });
      setInterval(() => { if (all.isConnected) refresh(); }, 500);
      refresh();
      addRegions(label);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addToggle);
    else addToggle();
  }

  // What's missing in each banner: owned / total per region, how many are
  // left, pulls until the guaranteed legendary, and the missing names.
  function addRegions(after) {
    const { Gacha, DEX, DB, SPRITE_META } = NS;
    if (!Gacha || !Gacha.BANNERS || !DEX) return;
    const style = document.createElement('style');
    style.textContent = `
#psmod-regions{margin-top:6px}
#psmod-regions summary{cursor:pointer;font-weight:700}
#psmod-regions table{width:100%;border-collapse:collapse;margin-top:6px;font-size:13px}
#psmod-regions th,#psmod-regions td{text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.15)}
#psmod-regions td.n,#psmod-regions th.n{text-align:right;font-variant-numeric:tabular-nums}
#psmod-regions tr.most td{color:#ffd23f}
#psmod-regions button{font:inherit;font-size:12px;font-weight:700;color:inherit;background:none;border:1px solid currentColor;border-radius:4px;padding:1px 6px;cursor:pointer}
#psmod-regions .miss{font-size:12.5px;line-height:1.5;padding:4px 6px 8px}`;
    document.head.appendChild(style);
    const box = document.createElement('details');
    box.id = 'psmod-regions';
    box.className = 'note';
    box.open = load('regionsOpen', false);
    box.addEventListener('toggle', () => save('regionsOpen', box.open));
    after.after(box);
    let openGen = null, lastSig = '';
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-gen]');
      if (!b) return;
      e.preventDefault();
      openGen = openGen === +b.dataset.gen ? null : +b.dataset.gen;
      lastSig = '';
      draw();
    });
    function draw() {
      const sv = DB && DB.save;
      if (!sv || !box.isConnected) return;
      const owned = sv.owned || {}, pity = sv.pity || {};
      const PITY = Gacha.PITY_5 || 70;
      const rows = Gacha.BANNERS.map((b) => {
        const pool = DEX.filter((p) => p.gen === b.gen && (!SPRITE_META || SPRITE_META[p.dex]));
        const missing = pool.filter((p) => !owned[p.dex]);
        return { gen: b.gen, name: b.name, total: pool.length, have: pool.length - missing.length, missing, left: PITY - (pity[b.gen] || 0) };
      });
      const sig = JSON.stringify(rows.map((r) => [r.have, r.left])) + openGen + box.open;
      if (sig === lastSig) return;
      lastSig = sig;
      const most = rows.reduce((a, r) => (r.missing.length > a.missing.length ? r : a), rows[0]);
      const totalMissing = rows.reduce((n, r) => n + r.missing.length, 0);
      box.innerHTML = `<summary>Missing by region (${totalMissing})</summary>
        <table><thead><tr><th>Region</th><th class="n">Owned</th><th class="n">Missing</th><th class="n">Guaranteed legendary in</th><th></th></tr></thead><tbody>${
          rows.map((r) => `<tr${r === most && r.missing.length ? ' class="most" title="Banner with the most missing Pokémon"' : ''}>
            <td>${esc(r.name)}</td><td class="n">${r.have}/${r.total}</td><td class="n">${r.missing.length}</td>
            <td class="n">${r.left} pulls</td>
            <td>${r.missing.length ? `<button type="button" data-gen="${r.gen}">${openGen === r.gen ? 'Hide' : 'Show'}</button>` : 'Complete'}</td></tr>${
            openGen === r.gen ? `<tr><td colspan="5" class="miss">${r.missing.map((p) => `#${p.dex} ${esc(p.name)}`).join(' - ')}</td></tr>` : ''}`).join('')
        }</tbody></table>`;
    }
    setInterval(draw, 1000);
    draw();
  }

  function skipButton(canvas, onSkip) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = 'Skip animation';
    b.style.cssText = 'display:block;margin:10px auto 0';
    b.addEventListener('click', (e) => { e.stopPropagation(); onSkip(); });
    canvas.after(b);
    return b;
  }

  waitFor(() => NS && NS.Slots && NS.Gacha && NS.Audio && NS.DB, setupGacha);

  // ---------------------------------------------------- Pokédex: National
  // The Pokémon screen shows one region at a time: MenuUI rebuilds the region
  // tabs (#dex-gens) and the grid (#dex-grid) for the chosen one, with the
  // filters applied, and keeps the choice private. For "National" we click
  // through every region tab ourselves, keep each grid's cells (with their
  // own click handlers, which only touch #dex-grid and the detail panel), go
  // back to the region that was chosen and show all the cells together.
  // Whenever the game redraws the screen (a filter, a new partner) we do it
  // again; picking a region tab leaves National.
  let dexNational = load('dexNational', false);

  function setupDexNational() {
    const gens = document.getElementById('dex-gens'), grid = document.getElementById('dex-grid');
    if (!gens || !grid) return;
    let busy = false, natCache = null;
    const gameTabs = () => [...gens.querySelectorAll('.gen-tab:not(#psmod-nat)')];

    function addTab() {
      let tab = document.getElementById('psmod-nat');
      if (!tab) {
        tab = document.createElement('button');
        tab.id = 'psmod-nat';
        tab.className = 'gen-tab';
        tab.addEventListener('click', () => { dexNational = true; save('dexNational', true); redraw(); });
      }
      if (gens.firstChild !== tab) gens.prepend(tab);
      const sv = (NS && NS.DB && NS.DB.save) || {};
      const owned = sv.owned || {};
      const all = (NS && NS.DEX) || [];
      tab.innerHTML = `<b>National</b><small>${all.filter((p) => owned[p.dex]).length}/${all.length}</small>`;
      tab.classList.toggle('on', dexNational);
      return tab;
    }

    dexApi = { isNational: () => dexNational, setNational: (v) => { dexNational = !!v; save('dexNational', dexNational); redraw(); } };
    function redraw() {
      if (busy) return;
      busy = true;
      try {
        addTab();
        if (!dexNational) return;
        // Nothing changed since last time (same collection, partner and
        // filter): put the same cells back instead of building 966 again.
        const sv = (NS && NS.DB && NS.DB.save) || {};
        const filt = [...document.querySelectorAll('#dex-filters .chip.on')].map((c) => c.textContent).join('|');
        const key = [Object.keys(sv.owned || {}).length, Object.keys(sv.shiny || {}).length, sv.partner, !!sv.partnerShiny, filt, (NS.I18n && NS.I18n.lang) || ''].join('/');
        if (natCache && natCache.key === key && natCache.cells.length) {
          grid.replaceChildren(...natCache.cells);
          // The game stops animating a sprite once it leaves the page, so
          // these were left as grey balls if they hadn't loaded yet.
          for (const c of natCache.cells) { const cv = c.querySelector('canvas'); if (cv) respawnSprite(cv); }
          for (const t of gameTabs()) t.classList.remove('on');
          addTab();
          return;
        }
        const tabs = gameTabs();
        const orig = Math.max(0, tabs.findIndex((t) => t.classList.contains('on')));
        const cells = [];
        // Our own clicks through the region tabs make no sound.
        const sfx = NS.Audio && NS.Audio.sfx;
        if (sfx) NS.Audio.sfx = () => {};
        try {
          for (let i = 0; i < tabs.length; i++) {
            const t = gameTabs()[i]; // the game rebuilds the tabs on every click
            if (!t) break;
            t.click();
            cells.push(...grid.querySelectorAll('.cell'));
          }
          const back = gameTabs()[orig];
          if (back) back.click();
        } finally { if (sfx) NS.Audio.sfx = sfx; }
        if (cells.length) grid.replaceChildren(...cells);
        natCache = { key, cells };
        for (const t of gameTabs()) t.classList.remove('on');
        addTab();
      } finally {
        obs.takeRecords();
        busy = false;
      }
    }

    // Leave National when a region tab is picked (before the game redraws).
    gens.addEventListener('click', (e) => {
      if (busy) return;
      const t = e.target.closest('.gen-tab');
      if (t && t.id !== 'psmod-nat' && dexNational) { dexNational = false; save('dexNational', false); }
    }, true);
    const obs = new MutationObserver(() => { if (!busy) redraw(); });
    obs.observe(gens, { childList: true });
    if (gens.children.length) redraw();
  }

  onReady(setupDexNational);

  // Every sprite canvas the game makes (Pokémon list, pickers...), with the
  // Pokémon and options it was made with, so it can be started again (or
  // shown shiny) later.
  const spriteMeta = new WeakMap();
  waitFor(() => NS && NS.UI && NS.UI.spriteCanvas && NS.UI.sprite, () => {
    const U = NS.UI, orig = U.spriteCanvas;
    U.spriteCanvas = function (dex, w, h, opts) {
      const cv = orig.apply(this, arguments);
      try { spriteMeta.set(cv, { dex, opts: Object.assign({}, opts || {}) }); } catch (_) { /* keep going */ }
      return cv;
    };
  }, 'spriteMeta');
  function respawnSprite(cv, shiny) {
    const m = spriteMeta.get(cv);
    if (!m || !NS.UI || !NS.UI.sprite) return false;
    const want = shiny == null ? (cv.dataset.psmSh ? cv.dataset.psmSh === '1' : !!m.opts.shiny) : shiny;
    try { NS.UI.sprite(cv, m.dex, Object.assign({}, m.opts, { shiny: want })); } catch (err) { trip('spriteMeta', err); return false; }
    if (shiny != null) cv.dataset.psmSh = want ? '1' : '0';
    return true;
  }
  // Show the shiny (or back to normal) on a sprite canvas, if it changed.
  function spriteShiny(cv, shiny) {
    const m = spriteMeta.get(cv);
    if (!m) return;
    const want = shiny || !!m.opts.shiny;
    const cur = cv.dataset.psmSh ? cv.dataset.psmSh === '1' : !!m.opts.shiny;
    if (want !== cur) respawnSprite(cv, want);
  }

  // ----------------------------------------------------------- controls
  // The game reads keys by e.code ('keyw', 'digit1'...) from window keydown /
  // keyup listeners and checks Input.tap() once per frame. We sit in front of
  // them (capture phase): the key chosen for an action is turned into the key
  // the game expects, and the game's own key for an action that was moved
  // elsewhere is silenced. Arrows, the numpad and Esc keep working as in
  // the game. The wheel and the middle / side mouse buttons over the game can
  // be bound too: they press and release the game's key. So can controller
  // buttons and sticks (see 'controller' below).
  // Each action has three slots: key, alternate, and controller. Controller
  // inputs are named 'Pad<n>' (button n) and 'Axis<n>-' / 'Axis<n>+' (stick
  // pushed one way), so they live in the same table as keys and mouse inputs.
  const ACTIONS = [
    ['up', 'Move up', 'KeyW', null, 'Axis1-'],
    ['down', 'Move down', 'KeyS', null, 'Axis1+'],
    ['left', 'Move left', 'KeyA', null, 'Axis0-'],
    ['right', 'Move right', 'KeyD', null, 'Axis0+'],
    ['prev', 'Previous attack', 'KeyQ', 'WheelUp', 'Pad4'],
    ['next', 'Next attack', 'KeyE', 'WheelDown', 'Pad5'],
    ['slot1', 'Attack 1 / upgrade 1', 'Digit1', null, 'Pad2'],
    ['slot2', 'Attack 2 / upgrade 2', 'Digit2', null, 'Pad3'],
    ['slot3', 'Attack 3 / upgrade 3', 'Digit3', null, 'Pad1'],
    ['slot4', 'Attack 4', 'Digit4', null, 'Pad7'],
    ['reroll', 'Change upgrade', 'KeyR', null, 'Pad6'],
    ['pause', 'Pause', 'KeyP', null, 'Pad9'],
    // Not a game key: held on keyboard/mouse, toggled on a controller.
    ['stats', 'Damage panel (hold)', 'Tab', null, 'Pad8'],
    // Co-op only; hold for the wheel. Not a game key either.
    ['ping', 'Ping (hold for wheel)', 'KeyG', 'Mouse1', 'Pad11'],
  ];
  const STATS = '@stats'; // stands in for the game key of the 'stats' action
  const PING = '@ping';
  const SLOTS = 3;
  const defBinds = () => Object.fromEntries(ACTIONS.map(([id, , a, b, pad]) => [id, [a, b || null, pad || null]]));
  let binds = defBinds();
  {
    const saved = load('keys', null);
    if (saved) {
      for (const id in binds) {
        const s = saved[id];
        if (!Array.isArray(s)) continue;
        // Saves from before controller support only have two slots.
        binds[id] = [s[0] || null, s[1] || null, s.length > 2 ? s[2] || null : binds[id][2]];
      }
      // 0.12: middle mouse pings, unless you already use it for something.
      if (!load('pingMouse', false)) {
        save('pingMouse', true);
        const used = Object.values(binds).some((b) => b.includes('Mouse1'));
        if (!used && binds.ping && !binds.ping[1]) { binds.ping[1] = 'Mouse1'; save('keys', binds); }
      }
    }
  }
  let codeMap = new Map(); // physical code -> game code
  let muted = new Set(); // game keys whose action now lives elsewhere

  function rebuildBinds() {
    codeMap = new Map();
    for (const [id, , game] of ACTIONS) for (const c of binds[id]) if (c) codeMap.set(c, id === 'stats' ? STATS : id === 'ping' ? PING : game);
    muted = new Set(ACTIONS.filter((a) => a[0] !== 'stats').map((a) => a[2]).filter((c) => !codeMap.has(c)));
    // The game cycles moves with Tab; the mod uses it for the damage panel.
    muted.add('Tab');
  }
  rebuildBinds();

  function setBind(id, slot, code) {
    const old = binds[id][slot];
    // An input does one thing: whoever had it gets this slot's old input.
    for (const [other] of ACTIONS) {
      const b = binds[other];
      for (let i = 0; i < SLOTS; i++) if (code && b[i] === code && !(other === id && i === slot)) b[i] = other === id ? null : old;
    }
    binds[id][slot] = code;
    save('keys', binds);
    rebuildBinds();
  }

  // Key labels come from the user's real keyboard layout when the browser
  // can tell (Chrome/Edge/Brave), otherwise from a US layout.
  const KEY_NAMES = {
    WheelUp: 'Wheel up', WheelDown: 'Wheel down', Mouse1: 'Middle mouse', Mouse3: 'Mouse back', Mouse4: 'Mouse forward',
    Space: 'Space', Enter: 'Enter', Tab: 'Tab', CapsLock: 'Caps Lock', Backspace: 'Backspace',
    ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl', AltRight: 'Alt Gr',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  };
  const US_KEYS = {
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Backslash: '\\', IntlBackslash: '\\', Comma: ',', Period: '.', Slash: '/',
  };
  let layoutMap = null;
  try {
    if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
      navigator.keyboard.getLayoutMap().then((m) => { layoutMap = m; renderKeys(); }, () => {});
    }
  } catch {}

  function keyName(c) {
    if (!c) return '—';
    if (/^(Pad|Axis)/.test(c)) return padName(c);
    if (KEY_NAMES[c]) return KEY_NAMES[c];
    const l = layoutMap && layoutMap.get(c);
    if (l && l.trim()) return l.toUpperCase();
    if (US_KEYS[c]) return US_KEYS[c];
    let m;
    if ((m = /^Key(.)$/.exec(c))) return m[1];
    if ((m = /^Digit(.)$/.exec(c))) return m[1];
    if ((m = /^Numpad(.+)$/.exec(c))) return 'Num ' + m[1];
    return c;
  }

  const typing = (t) => !!(t && t.closest && t.closest('input, textarea, select, [contenteditable]'));
  const onMod = (t) => !!(t && t.closest && t.closest('[id^="psmod"]'));
  const emit = (target, type, code) => (target || document).dispatchEvent(new KeyboardEvent(type, { code, key: code === 'Escape' ? 'Escape' : undefined, bubbles: true, cancelable: true }));
  const tapKey = (code) => { emit(document, 'keydown', code); emit(document, 'keyup', code); };

  let listening = null; // [action, slot] waiting for an input
  const isListening = () => !!listening && settingsOpen() && !!document.getElementById('psmod-keys');
  function captured(code) {
    const [id, slot] = listening;
    listening = null;
    if (code !== undefined) setBind(id, slot, code);
    renderKeys();
  }

  function onKey(e) {
    if (!e.isTrusted) return;
    if (isListening()) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type !== 'keydown' || e.repeat) return;
      if (e.code === 'Escape') captured();
      else if (e.code === 'Backspace' || e.code === 'Delete') captured(null);
      else if (!e.altKey && !e.ctrlKey && !e.metaKey && e.code) captured(e.code);
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
    const game = codeMap.get(e.code);
    if (game === PING) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type === 'keydown' && !e.repeat) pingDown('mouse'); else if (e.type === 'keyup') pingUp();
      return;
    }
    if (game === STATS && menuShinyOk()) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type === 'keydown' && !e.repeat) toggleMenuShiny();
      return;
    }
    if (game === STATS) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (panelKey === 'toggle') { if (e.type === 'keydown' && !e.repeat) toggleStats(); }
      else setStatsHeld(e.type === 'keydown');
      return;
    }
    if (game === e.code) return;
    if (game || muted.has(e.code)) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (game) emit(e.target, e.type, game);
    }
  }
  addEventListener('keydown', onKey, true);
  addEventListener('keyup', onKey, true);

  const MOUSE_BTNS = [1, 3, 4];
  function onMouse(e) {
    if (!e.isTrusted) return;
    if (isListening() && e.type === 'mousedown') {
      if (MOUSE_BTNS.includes(e.button)) { e.preventDefault(); e.stopImmediatePropagation(); captured('Mouse' + e.button); }
      else if (!e.target.closest('[data-bind]')) {
        // Clicked elsewhere: cancel. No re-render, or the button being
        // clicked (Close, Reset) would vanish before its click.
        const b = extrasBody && extrasBody.querySelector(`[data-bind="${listening[0]}:${listening[1]}"]`);
        if (b) { b.textContent = keyName(binds[listening[0]][listening[1]]); b.classList.remove('gold'); }
        listening = null;
      }
      return;
    }
    const game = MOUSE_BTNS.includes(e.button) && codeMap.get('Mouse' + e.button);
    if (!game) return;
    // Also keeps the side buttons from going back / forward in history.
    e.preventDefault();
    if (e.type === 'auxclick' || onMod(e.target) || typing(e.target)) return;
    e.stopImmediatePropagation(); // the game would take it as holding the mouse
    if (game === STATS) { if (panelKey === 'toggle') { if (e.type === 'mousedown') toggleStats(); } else setStatsHeld(e.type === 'mousedown'); return; }
    if (game === PING) { if (e.type === 'mousedown') pingDown('mouse'); else if (e.type === 'mouseup') pingUp(); return; }
    emit(document, e.type === 'mousedown' ? 'keydown' : 'keyup', game);
  }
  for (const ev of ['mousedown', 'mouseup', 'auxclick']) addEventListener(ev, onMouse, true);

  // One wheel notch is ~100 px; trackpads send many small deltas, so add
  // them up and step at most every 90 ms.
  let wheelAcc = 0, wheelAt = 0, wheelStep = 0;
  addEventListener('wheel', (e) => {
    if (!e.isTrusted || !e.deltaY) return;
    if (isListening()) { e.preventDefault(); e.stopImmediatePropagation(); captured(e.deltaY < 0 ? 'WheelUp' : 'WheelDown'); return; }
    if (!e.target || e.target.tagName !== 'CANVAS' || onMod(e.target)) return;
    if (!codeMap.has('WheelUp') && !codeMap.has('WheelDown')) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelAt > 250) wheelAcc = 0;
    wheelAt = now;
    wheelAcc += e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    if (Math.abs(wheelAcc) < 50 || now - wheelStep < 90) return;
    const game = codeMap.get(wheelAcc < 0 ? 'WheelUp' : 'WheelDown');
    wheelAcc = 0;
    wheelStep = now;
    if (game === STATS) toggleStats();
    else if (game) tapKey(game);
  }, { capture: true, passive: false });

  // --------------------------------------------------------- controller
  // The Gamepad API is polled every frame. During a run, each bound button or
  // stick direction presses and releases the game's key, exactly like a
  // rebound keyboard key. Outside of active play (menus, pause, level-up),
  // the D-pad and left stick move a yellow cursor over the game's buttons,
  // A clicks the highlighted one and B sends Esc; buttons bound to actions
  // (X / Y / B for the upgrade choices...) still work there.
  // The game itself is shown no controllers while this is on, so a future
  // built-in controller mode can't double every input.
  let padOn = load('padOn', true);
  let padRumble = load('padRumble', true);
  const AXIS_ON = 0.5, AXIS_OFF = 0.35;
  const NAV_FIRST = 380, NAV_REPEAT = 110;

  const realGetPads = (() => {
    const f = Navigator.prototype.getGamepads;
    return f ? () => { try { return f.call(navigator) || []; } catch { return []; } } : () => [];
  })();
  try {
    const hide = function getGamepads() { return padOn ? [null, null, null, null] : realGetPads(); };
    Object.defineProperty(Navigator.prototype, 'getGamepads', { value: hide, configurable: true, writable: true });
  } catch {}

  let padStyle = 'xbox';
  const PAD_LABELS = {
    xbox: ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L-stick click', 'R-stick click', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Guide'],
    ps: ['✕', '○', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'PS'],
    nintendo: ['B', 'A', 'Y', 'X', 'L', 'R', 'ZL', 'ZR', '−', '+', 'L-stick click', 'R-stick click', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home'],
    // Steam Deck and Steam Controller: A / B / X / Y in the Xbox places, L1 / R1, L2 / R2, View / Menu.
    steam: ['A', 'B', 'X', 'Y', 'L1', 'R1', 'L2', 'R2', 'View', 'Menu', 'L3', 'R3', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Steam'],
  };
  // Button prompts: auto (from the controller's name) or chosen in Settings → Controls.
  let padStyleSet = load('padStyleSet', 'auto');
  const STICK = { '0-': 'L-stick ←', '0+': 'L-stick →', '1-': 'L-stick ↑', '1+': 'L-stick ↓', '2-': 'R-stick ←', '2+': 'R-stick →', '3-': 'R-stick ↑', '3+': 'R-stick ↓' };
  function padName(c) {
    let m;
    if ((m = /^Pad(\d+)$/.exec(c))) return '🎮 ' + (PAD_LABELS[padStyle][+m[1]] || 'Button ' + m[1]);
    if ((m = /^Axis(\d+)([+-])$/.exec(c))) return '🎮 ' + (STICK[m[1] + m[2]] || `Axis ${m[1]} ${m[2]}`);
    return c;
  }
  function styleFor(id) {
    if (padStyleSet !== 'auto' && PAD_LABELS[padStyleSet]) return padStyleSet;
    if (/28de|valve|steam/i.test(id)) return 'steam';
    if (/054c|sony|dualshock|dualsense|playstation/i.test(id)) return 'ps';
    if (/057e|nintendo|pro controller|joy-con/i.test(id)) return 'nintendo';
    return 'xbox';
  }

  let padIndex = null;
  function activePad() {
    let best = null;
    for (const p of realGetPads()) if (p && p.connected && (!best || p.timestamp > best.timestamp)) best = p;
    if (best && padIndex !== best.index) {
      padIndex = best.index;
      padStyle = styleFor(best.id);
      renderKeys();
    }
    return best;
  }
  const shortPadName = (id) => String(id || 'Controller').replace(/\s*\(.*$/, '').trim() || 'Controller';

  addEventListener('gamepadconnected', (e) => {
    if (padOn && notif.pad) toast('Controller connected', '#5fe08a', shortPadName(e.gamepad.id));
    renderKeys();
  });
  addEventListener('gamepaddisconnected', () => { padIndex = null; padReleaseAll(); if (padOn && notif.pad) toast('Controller disconnected', '#ffcb3d'); renderKeys(); });

  // Inputs currently down, with what each one is doing, so a release always
  // undoes what its press did even if the mode changed in between.
  const padDownWas = new Map(); // physical code -> { game } | { nav } | { ui }
  const heldGame = new Map(); // game code -> number of inputs holding it

  function holdGame(game) {
    const n = heldGame.get(game) || 0;
    heldGame.set(game, n + 1);
    if (!n) emit(document, 'keydown', game);
  }
  function freeGame(game) {
    const n = heldGame.get(game) || 0;
    if (n <= 1) { heldGame.delete(game); if (n) emit(document, 'keyup', game); }
    else heldGame.set(game, n - 1);
  }
  function padReleaseAll() {
    for (const game of heldGame.keys()) emit(document, 'keyup', game);
    heldGame.clear();
    padDownWas.clear();
    navHeld = null;
  }

  function readInputs(gp, prev) {
    const s = new Set();
    gp.buttons.forEach((b, i) => { if (b && (b.pressed || b.value > 0.5)) s.add('Pad' + i); });
    gp.axes.forEach((v, i) => {
      const neg = `Axis${i}-`, pos = `Axis${i}+`;
      if (v <= -(prev.has(neg) ? AXIS_OFF : AXIS_ON)) s.add(neg);
      else if (v >= (prev.has(pos) ? AXIS_OFF : AXIS_ON)) s.add(pos);
    });
    return s;
  }

  // D-pad buttons move you during a run even when nothing is bound to them.
  const DPAD_MOVE = { Pad12: 'KeyW', Pad13: 'KeyS', Pad14: 'KeyA', Pad15: 'KeyD' };
  const NAV_DIR = { Pad12: 'up', Pad13: 'down', Pad14: 'left', Pad15: 'right', 'Axis1-': 'up', 'Axis1+': 'down', 'Axis0-': 'left', 'Axis0+': 'right' };

  // Any of the game's screens open counts as a menu (co-op pause, for one,
  // leaves the game 'playing' because the match goes on).
  const screenOpen = () => !!document.querySelector('.scr:not(.hidden)');
  const menuMode = () => !NS || !NS.Game || NS.Game.state !== 'playing' || !me() || screenOpen();
  // Just the main menu showing, with the Normal / Shiny switch (you own the shiny).
  function menuShinyOk() {
    const scr = document.getElementById('scr-menu'), seg = document.getElementById('menu-shiny');
    if (!scr || scr.classList.contains('hidden') || !seg || seg.classList.contains('hidden')) return false;
    if ([...document.querySelectorAll('.scr:not(.hidden)')].some((x) => x.id !== 'scr-menu' && x.getClientRects().length)) return false;
    if ((sumEl && !sumEl.hidden) || document.querySelector('#psmod-share:not([hidden]), #psmod-tour:not([hidden]), #psmod-selpop:not([hidden])')) return false;
    return !(NS && NS.Game && NS.Game.state === 'playing');
  }
  function toggleMenuShiny() {
    const seg = document.getElementById('menu-shiny');
    const b = seg && [...seg.querySelectorAll('button')].find((x) => !x.classList.contains('on'));
    if (b) b.click();
  }

  function padPress(c) {
    padMode = true;
    // Welcome tour: A next, B skip, left / right step through the cards.
    if (tourEl && !tourEl.hidden) {
      const d = NAV_DIR[c];
      if (c === 'Pad0' || d === 'right') tourNext();
      else if (c === 'Pad1') endTour();
      else if (d === 'left' && tourStep > 0) showTourStep(tourStep - 1);
      padDownWas.set(c, { ui: true });
      return;
    }
    if (menuMode()) {
      const dir = NAV_DIR[c];
      // LB / RB switch tabs (Settings, Pokémon regions, What's new...).
      if ((c === 'Pad4' || c === 'Pad5') && !choiceCards() && switchTab(c === 'Pad5' ? 1 : -1)) { padDownWas.set(c, { ui: true }); return; }
      if ((c === 'Pad6' || c === 'Pad7') && !choiceCards() && tabBar(1) && switchTab(c === 'Pad7' ? 1 : -1, 1)) { padDownWas.set(c, { ui: true }); return; }
      // Level-up, bond and item choices: X / Y / B (and RT) pick a card
      // directly, A picks the highlighted one. B never means "back" here.
      const choice = choiceCards();
      if (choice && c === 'Pad0') {
        const f = navFocusValid();
        if (f && choice.includes(f)) navActivate(f);
        else if (choice[0]) navSet(choice[0]);
        padDownWas.set(c, { ui: true });
        return;
      }
      if (choice && dir) { navMove(dir); navHeld = { code: c, dir, at: performance.now() + NAV_FIRST }; padDownWas.set(c, { nav: true }); return; }
      // A highlighted slider (volume...) moves with left / right.
      const fs = navFocusValid();
      if (fs && fs.matches('input[type="range"]') && (dir === 'left' || dir === 'right')) {
        nudgeRange(fs, dir === 'right' ? 1 : -1);
        navHeld = { code: c, dir, at: performance.now() + NAV_FIRST, range: true };
        padDownWas.set(c, { nav: true });
        return;
      }
      // What's new: up / down scroll the notes (up at the top goes to the tabs).
      const newsBody = (dir === 'up' || dir === 'down') && newsScroller();
      if (newsBody && !(dir === 'up' && newsBody.scrollTop <= 0)) {
        scrollNews(newsBody, dir);
        navHeld = { code: c, dir, at: performance.now() + NAV_FIRST, scroll: newsBody };
        padDownWas.set(c, { nav: true });
        return;
      }
      if (dir) { navMove(dir); navHeld = { code: c, dir, at: performance.now() + NAV_FIRST }; padDownWas.set(c, { nav: true }); return; }
      const outOfRun = !NS || !NS.Game || !me() || NS.Game.state === 'ui';
      // View / Select (the damage panel button) swaps Normal / Shiny on the main menu.
      if (codeMap.get(c) === STATS && menuShinyOk()) { toggleMenuShiny(); padDownWas.set(c, { ui: true }); return; }
      if (c === 'Pad0') {
        const f = navFocusValid();
        if (f) { navActivate(f); padDownWas.set(c, { ui: true }); return; }
        if (!codeMap.has(c)) { navMove(null); padDownWas.set(c, { ui: true }); return; }
      }
      if (c === 'Pad1' && !choice && (outOfRun || navFocusValid())) {
        // A window with its own Close / Back button (What's new...): B presses it.
        const close = padCloseBtn();
        if (close) close.click(); else tapKey('Escape');
        padDownWas.set(c, { ui: true }); return;
      }
    }
    const game = codeMap.get(c) || (!codeMap.has(c) && DPAD_MOVE[c]);
    if (game === STATS) { toggleStats(); padDownWas.set(c, { ui: true }); return; }
    if (game === PING) { pingDown('pad'); padDownWas.set(c, { ping: true }); return; }
    if (game) { holdGame(game); padDownWas.set(c, { game }); }
  }
  function padCloseBtn() {
    const sc = navScope();
    // The game's own screens that Esc already closes keep using Esc.
    if (!sc || !sc.el.matches('.scr') || ['scr-menu', 'scr-pause', 'scr-dex', 'scr-upgrades', 'scr-gacha', 'scr-friends', 'scr-rank', 'scr-goals'].includes(sc.el.id)) return null;
    for (const b of sc.el.querySelectorAll('#news-close, [data-back], [id$="-close"], [data-act="close"]')) if (navVisible(b)) return b;
    return null;
  }
  function padRelease(c) {
    const was = padDownWas.get(c);
    padDownWas.delete(c);
    if (navHeld && navHeld.code === c) navHeld = null;
    if (was && was.game) freeGame(was.game);
    if (was && was.ping) pingUp();
  }

  let padPrev = new Set();
  function padLoop() {
    requestAnimationFrame(padLoop);
    if (!padOn || document.hidden) { if (padDownWas.size) padReleaseAll(); padPrev = new Set(); syncPadRing(); if (hintKey) try { syncPadHints(); } catch (_) { /* ignore */ } return; }
    const gp = activePad();
    const down = gp ? readInputs(gp, padPrev) : new Set();
    if (pingWheel && pingWheel.src === 'pad' && gp) {
      const st = [gp.axes[2] || 0, gp.axes[3] || 0];
      // Keep the last direction pushed: letting the stick go doesn't undo the choice.
      if (Math.hypot(st[0], st[1]) >= 0.5) pingWheel.stick = st;
    }
    if (isListening()) {
      for (const c of down) if (!padPrev.has(c)) { captured(c); break; }
      padPrev = down;
      if (padDownWas.size) padReleaseAll();
      return;
    }
    for (const c of padPrev) if (!down.has(c)) padRelease(c);
    for (const c of down) if (!padPrev.has(c)) padPress(c);
    padPrev = down;
    if (navHeld && performance.now() >= navHeld.at) {
      if (navHeld.scroll) scrollNews(navHeld.scroll, navHeld.dir);
      else if (navHeld.range && navFocus) nudgeRange(navFocus, navHeld.dir === 'right' ? 1 : -1);
      else navMove(navHeld.dir);
      navHeld.at = performance.now() + NAV_REPEAT;
    }
    if (!menuMode()) {
      if (navFocus) navClear();
      // Still holding a direction from a menu (e.g. the level-up cards just
      // closed): hand it to the game so you keep moving.
      for (const c of down) {
        const was = padDownWas.get(c);
        if (!was || !was.nav) continue;
        if (navHeld && navHeld.code === c) navHeld = null;
        const game = codeMap.get(c) || (!codeMap.has(c) && DPAD_MOVE[c]);
        if (game && game !== STATS) { holdGame(game); padDownWas.set(c, { game }); }
        else padDownWas.set(c, { ui: true });
      }
    }
    padRumbleCheck(gp);
    const now = performance.now();
    if (now - labelsAt > 150) { labelsAt = now; syncChoiceLabels(); syncChoiceFocus(); try { navScopeCheck(); } catch (err) { trip('pad', err); } }
    // The prompts follow the window that's open straight away.
    try { syncPadHints(); } catch (err) { trip('padHints', err); }
    if (navFocus && !navFocus.isConnected) navFocusValid();
    syncPadRing();
  }
  requestAnimationFrame(padLoop);
  addEventListener('blur', () => { padReleaseAll(); padPrev = new Set(); });

  function newsScroller() {
    const scr = document.getElementById('scr-news'), body = document.getElementById('news-body');
    if (!scr || scr.classList.contains('hidden') || !body || body.scrollHeight <= body.clientHeight + 2) return null;
    if (navFocus && navFocus.closest && navFocus.closest('#psmod-news-tabs') && navFocus.isConnected && body.scrollTop <= 0) {
      // On the tabs: down starts scrolling the notes.
    }
    return body;
  }
  function scrollNews(body, dir) {
    if (navFocus && !navFocus.closest('#psmod-news-tabs')) navClear();
    body.scrollBy({ top: (dir === 'down' ? 1 : -1) * Math.max(80, body.clientHeight * 0.3), behavior: reduceMotion ? 'auto' : 'smooth' });
  }
  function nudgeRange(el, d) {
    const min = +el.min || 0, max = el.max !== '' ? +el.max : 100;
    const step = Math.max(+el.step || 0, (max - min) / 20) || 1;
    const v = Math.max(min, Math.min(max, (+el.value || 0) + d * step));
    if (v === +el.value) return;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---- choice screens and controller labels
  // The game's card screens: level-up (1-3), bond (1-4) and item (1-2).
  const CHOICES = [['scr-levelup', 'cards'], ['scr-bond', 'bond-cards'], ['scr-item', 'item-cards']];
  function choiceCards() {
    for (const [scr, box] of CHOICES) {
      const s = document.getElementById(scr);
      if (!s || s.classList.contains('hidden')) continue;
      const b = document.getElementById(box);
      if (!b || b.classList.contains('done')) return null;
      return [...b.querySelectorAll('.card')];
    }
    return null;
  }
  // Controller mode: the last thing pressed was on the controller. Shows
  // controller buttons instead of 1 / 2 / 3 / 4 on cards and move slots.
  let padMode = false;
  addEventListener('keydown', (e) => { if (e.isTrusted && !e.altKey) padMode = false; }, true);
  const showPadLabels = () => padOn && padMode && padIndex != null;
  const bareName = (code) => (code ? padName(code).replace(/^🎮 /, '') : '');
  // How a controller button looks: face buttons are round and (on Xbox and
  // PlayStation pads) coloured like the real ones; the rest are rounded pills.
  const PAD_FACE = {
    xbox: ['#46c96a', '#e5484d', '#3b82f6', '#f5c518'],
    ps: ['#7aa7ff', '#ff6b7a', '#ff8ad8', '#3fd4b4'],
    nintendo: ['#c9d6ff', '#c9d6ff', '#c9d6ff', '#c9d6ff'],
    steam: ['#e6ecf5', '#e6ecf5', '#e6ecf5', '#e6ecf5'],
  };
  // Shoulder buttons are shaped like them: bumpers flat with the outer top
  // corner rounded, triggers taller and domed, left and right mirrored.
  const PAD_SHAPE = { 4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt' };
  function padLook(code) {
    const m = /^Pad(\d+)$/.exec(code || '');
    const face = !!m && +m[1] <= 3;
    return { label: bareName(code), round: face, shape: m ? PAD_SHAPE[+m[1]] || '' : '', color: face ? PAD_FACE[padStyle][+m[1]] : '#c9d6ff' };
  }
  const padCls = (L) => (L.round ? ' round' : '') + (L.shape ? ' sh-' + L.shape : '');
  const SHAPE_CLS = ['round', 'sh-lb', 'sh-rb', 'sh-lt', 'sh-rt'];
  const setPadCls = (el, L) => { el.classList.remove(...SHAPE_CLS); for (const c of padCls(L).trim().split(' ').filter(Boolean)) el.classList.add(c); };
  // Corner radii [top-left, top-right, bottom-right, bottom-left] for the canvas.
  const SHAPE_R = (h) => ({ lb: [h * 0.62, h * 0.22, h * 0.22, h * 0.22], rb: [h * 0.22, h * 0.62, h * 0.22, h * 0.22],
    lt: [h * 0.7, h * 0.45, h * 0.15, h * 0.15], rt: [h * 0.45, h * 0.7, h * 0.15, h * 0.15] });
  function rr4(ctx, x, y, w, h, r) {
    const [a, b, c, d] = r.map((v) => Math.min(v, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + a, y); ctx.lineTo(x + w - b, y); ctx.quadraticCurveTo(x + w, y, x + w, y + b);
    ctx.lineTo(x + w, y + h - c); ctx.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
    ctx.lineTo(x + d, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - d);
    ctx.lineTo(x, y + a); ctx.quadraticCurveTo(x, y, x + a, y);
    ctx.closePath();
  }
  function drawPadBadge(ctx, code, x, y, active) {
    const L = padLook(code);
    ctx.save();
    ctx.font = HF(800, 7);
    const w = L.round ? 13 : Math.ceil(ctx.measureText(L.label).width) + 8, h = 13;
    const shape = (o, ww, hh) => { if (L.shape) rr4(ctx, x + o, y + o, ww, hh, SHAPE_R(hh)[L.shape]); else rr(ctx, x + o, y + o, ww, hh, hh / 2); };
    shape(0, w, h);
    ctx.fillStyle = INK; ctx.fill();
    shape(1, w - 2, h - 2);
    ctx.fillStyle = 'rgba(27,43,85,.95)'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = active ? L.color : 'rgba(200,215,240,.7)'; ctx.stroke();
    ctx.fillStyle = L.round ? L.color : '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(L.label, x + w / 2, y + h / 2 + 0.5);
    ctx.restore();
  }
  function slotLabel(i) {
    if (showPadLabels()) { const b = binds['slot' + (i + 1)]; if (b && b[2]) return bareName(b[2]); }
    return String(i + 1);
  }
  // Swap the number badges for controller buttons (and back), every few
  // frames, since the game redraws the cards whenever they change.
  let labelsAt = 0, lastChoice = null;
  function syncChoiceLabels() {
    const show = showPadLabels();
    const swap = (el, code) => {
      if (!el) return;
      const txt = code ? bareName(code) : '';
      if (show && txt) {
        if (el.dataset.psmodOrig == null) el.dataset.psmodOrig = el.textContent;
        if (el.textContent !== txt) el.textContent = txt;
        // Drawn as a controller button.
        const L = padLook(code);
        el.classList.add('psmod-padkey');
        setPadCls(el, L);
        el.style.setProperty('--pk', L.color);
      } else if (el.dataset.psmodOrig != null) {
        el.textContent = el.dataset.psmodOrig;
        delete el.dataset.psmodOrig;
        el.classList.remove('psmod-padkey', ...SHAPE_CLS);
        el.style.removeProperty('--pk');
      }
    };
    const slot = (i) => { const b = binds['slot' + (i + 1)]; return b && b[2] ? b[2] : ''; };
    for (const [scr, box] of CHOICES) {
      const b = document.getElementById(box);
      if (b) b.querySelectorAll('.card').forEach((card, i) => swap(card.querySelector('.key'), slot(i)));
      const hints = document.querySelectorAll(`#${scr} .sub kbd`);
      hints.forEach((k, i) => swap(k, slot(i)));
    }
    swap(document.querySelector('#lvl-reroll kbd'), binds.reroll && binds.reroll[2] ? binds.reroll[2] : '');
  }
  // When a card screen opens (or rerolls) while playing on the controller,
  // highlight the first card so A takes it straight away.
  let pauseWas = false;
  function syncChoiceFocus() {
    const ps = document.getElementById('scr-pause');
    const pauseOpen = !!ps && !ps.classList.contains('hidden');
    if (pauseOpen && !pauseWas && padMode && padOn) { const r = document.getElementById('btn-resume'); if (r) navSet(r); }
    pauseWas = pauseOpen;
    const cards = choiceCards();
    const key = cards ? cards.length + ':' + (cards[0] && cards[0].textContent) : null;
    if (cards && cards.length && key !== lastChoice && padMode && padOn) navSet(cards[0]);
    lastChoice = key;
  }

  // ---- tabs with LB / RB
  // The tab bar of whichever screen is on top: the game's (.tabs / .gen-tabs)
  // or ours. Wraps around at the ends.
  // The open window's tab bars, outermost first (Stats: Runs & records /
  // Leaderboard, then the leaderboard's own modes). LB / RB (Q / E) drive
  // the first, LT / RT the second.
  function tabBars() {
    const bars = [...document.querySelectorAll('.tabs, .gen-tabs, #psmod-news-tabs, #psmod-stats-tabs')]
      .filter((b) => b.closest('.scr:not(.hidden)') && navVisible(b));
    const sc = navScope();
    const mine = sc ? bars.filter((b) => sc.el.contains(b)) : [];
    const out = [];
    for (const b of (mine.length ? mine : bars.reverse())) {
      const tabs = [...b.children].filter((t) => t.matches('.tab, .gen-tab, .psn-tab, button') && navVisible(t));
      if (tabs.length > 1 && tabs.some((t) => onScreen(t))) out.push(tabs);
    }
    return out;
  }
  function tabBar(level = 0) { return tabBars()[level] || null; }
  // On the keyboard, Q / E (your previous / next attack keys) switch tabs too.
  addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || isListening() || !menuMode() || typing(document.activeElement) || choiceCards()) return;
    const prev = [(binds.prev || [])[0], 'KeyQ'], next = [(binds.next || [])[0], 'KeyE'];
    const dir = prev.includes(e.code) ? -1 : next.includes(e.code) ? 1 : 0;
    if (!dir || !tabBar()) return;
    if (switchTab(dir)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  function switchTab(dir, level = 0) {
    const tabs = tabBar(level);
    if (!tabs) return false;
    const cur = tabs.findIndex((t) => t.classList.contains('on') || t.classList.contains('active') || t.getAttribute('aria-selected') === 'true');
    const next = tabs[((cur < 0 ? (dir > 0 ? -1 : 0) : cur) + dir + tabs.length) % tabs.length];
    const wasOnBar = navFocus && tabs.includes(navFocus);
    next.click();
    if (document.activeElement && document.activeElement !== document.body && !typing(document.activeElement)) document.activeElement.blur();
    if (wasOnBar) navSet(next.isConnected ? next : null);
    else if (navFocus && !navFocus.isConnected) navClear();
    return true;
  }

  // ---- controller button prompts in menus
  // A small bar in the top-left corner (A Select · B Back · LB / RB Tabs), clear
  // of the game's boxes and top bar, while you're
  // in a menu on the controller, and button glyphs where they help (the tour).
  const glyphHtml = (code, cls = '') => { const L = padLook(code); return `<span class="psmod-padkey psmod-glyph${padCls(L)} ${cls}" data-pad="${code}" style="--pk:${L.color}">${esc(L.label)}</span>`; };
  let hintEl = null, hintKey = '', glyphStyle = '';
  function syncPadHints() {
    const on = showPadLabels();
    if (on) navStyle();
    document.documentElement.classList.toggle('psmod-padui', on);
    if (glyphStyle !== padStyle) {
      glyphStyle = padStyle;
      for (const g of document.querySelectorAll('.psmod-glyph[data-pad]')) { const L = padLook(g.dataset.pad); g.textContent = L.label; g.style.setProperty('--pk', L.color); setPadCls(g, L); }
    }
    let parts = [];
    if (on && menuMode() && !(tourEl && !tourEl.hidden) && !choiceCards() && !isListening()) {
      const menuOnly = (() => { const open = [...document.querySelectorAll('.scr:not(.hidden)')]; return open.length === 1 && open[0].id === 'scr-menu'; })();
      const extraOpen = (sumEl && !sumEl.hidden) || !!document.querySelector('#psmod-share:not([hidden])');
      parts.push(['Pad0', 'Select']);
      if (!menuOnly || extraOpen) parts.push(['Pad1', 'Back']);
      if (!extraOpen) {
        const nb = tabBars().length;
        if (nb) parts.push(['Pad4|Pad5', 'Tabs']);
        if (nb > 1) parts.push(['Pad6|Pad7', 'Mode']);
      }
    }
    syncShinyHint(on && menuMode() && !(tourEl && !tourEl.hidden) && !isListening());
    const supEl = document.getElementById('btn-support');
    const key = on ? padStyle + parts.map((p) => p.join(':')).join(',') + (supEl && !supEl.classList.contains('hidden') ? '|s' : '') : '';
    if (key === hintKey) { placeHints(); return; }
    hintKey = key;
    if (!hintEl) {
      hintEl = document.createElement('div');
      hintEl.id = 'psmod-padhints';
      document.body.appendChild(hintEl);
    }
    hintEl.hidden = !parts.length;
    hintEl.innerHTML = parts.map(([codes, label]) => `<span class="h">${codes.split('|').map((c) => glyphHtml(c)).join('')}<span>${label}</span></span>`).join('');
    placeHints();
  }
  // The Normal / Shiny swap button sits right beside the switch itself.
  let shinyHintEl = null;
  function syncShinyHint(want) {
    const c = (binds.stats || [])[2];
    const seg = document.getElementById('menu-shiny');
    const show = want && c && /^Pad\d/.test(c) && seg && menuShinyOk();
    if (!show) { if (shinyHintEl) shinyHintEl.style.display = 'none'; return; }
    if (!shinyHintEl) {
      shinyHintEl = document.createElement('div');
      shinyHintEl.id = 'psmod-shinyhint';
      shinyHintEl.style.cssText = 'position:fixed;z-index:50;pointer-events:none;display:none;align-items:center';
      document.body.appendChild(shinyHintEl);
    }
    if (shinyHintEl.dataset.c !== c + padStyle) { shinyHintEl.dataset.c = c + padStyle; shinyHintEl.innerHTML = glyphHtml(c); }
    shinyHintEl.style.display = 'flex';
    const r = seg.getBoundingClientRect();
    const w = shinyHintEl.offsetWidth || 26, h = shinyHintEl.offsetHeight || 22;
    shinyHintEl.style.left = Math.round(r.right + 8) + 'px';
    shinyHintEl.style.top = Math.round(r.top + r.height / 2 - h / 2) + 'px';
    if (r.right + 8 + w > innerWidth - 4) shinyHintEl.style.left = Math.round(r.left - 8 - w) + 'px';
  }
  // With a window open, the prompts are part of it: a strip along its
  // bottom, inside the window. On the main menu (nothing open), bottom-left.
  // Checked every frame, so they follow a window the moment it opens or closes.
  function hintBox() {
    const sc = navScope();
    if (!sc || sc.el.id === 'scr-menu') return null;
    let el = sc.el;
    const topScr = () => {
      let top = null, tz = -Infinity;
      for (const x of document.querySelectorAll('.scr:not(.hidden)')) { if (!x.getClientRects().length) continue; const z = parseInt(getComputedStyle(x).zIndex, 10) || 0; if (z >= tz) { tz = z; top = x; } }
      return top;
    };
    // A drop-down list or picker: the prompts stay on the window under it.
    if (/^psmod-(selpop|mvpop)$/.test(el.id)) el = topScr();
    if (!el) return null;
    if (el.id === 'pull-fx') return el;
    if (el.matches('.box, .win')) return el;
    const box = el.matches('.scr') ? el.querySelector(':scope > .box') : el.querySelector(':scope > .win');
    if (box) return box;
    const scr = topScr();
    return scr && scr.id !== 'scr-menu' ? scr.querySelector(':scope > .box') : null;
  }
  let hintPadBox = null;
  function placeHints() {
    if (!hintEl || hintEl.hidden) return;
    const box = hintBox();
    if (box && box.getClientRects().length) {
      if (box.lastElementChild !== hintEl) box.appendChild(hintEl);
      if (!hintEl.classList.contains('docked')) hintEl.classList.add('docked');
      // A window that scrolls as a whole: the strip stays pinned to its bottom.
      const cs = getComputedStyle(box);
      const scrolls = /auto|scroll/.test(cs.overflowY) && box.scrollHeight > box.clientHeight + 2;
      const key = scrolls ? [cs.paddingLeft, cs.paddingRight, cs.paddingBottom, cs.borderBottomLeftRadius].join(' ') : '';
      if (hintEl.dataset.stick !== key || (scrolls && hintPadBox !== box)) {
        hintEl.dataset.stick = key;
        // The cursor scrolls things into view above the strip, not under it.
        if (hintPadBox && hintPadBox !== box) hintPadBox.style.scrollPaddingBottom = '';
        hintPadBox = scrolls ? box : null;
        box.style.scrollPaddingBottom = scrolls ? (hintEl.offsetHeight + 10) + 'px' : '';
        hintEl.classList.toggle('stick', scrolls);
        if (scrolls) {
          const pl = cs.paddingLeft, pr = cs.paddingRight, pb = cs.paddingBottom;
          Object.assign(hintEl.style, { bottom: `-${pb}`, marginLeft: `-${pl}`, marginRight: `-${pr}`, marginBottom: `-${pb}`, paddingLeft: pl, paddingRight: pr, paddingBottom: `calc(${pb} - 6px)` });
        } else Object.assign(hintEl.style, { bottom: '', marginLeft: '', marginRight: '', marginBottom: '', paddingLeft: '', paddingRight: '', paddingBottom: '' });
      }
    } else {
      if (hintEl.parentElement !== document.body) document.body.appendChild(hintEl);
      if (hintEl.classList.contains('docked')) hintEl.classList.remove('docked', 'stick');
      if (hintPadBox) { hintPadBox.style.scrollPaddingBottom = ''; hintPadBox = null; }
      if (hintEl.dataset.stick) { hintEl.dataset.stick = ''; Object.assign(hintEl.style, { bottom: '', marginLeft: '', marginRight: '', marginBottom: '', paddingLeft: '', paddingRight: '', paddingBottom: '' }); }
    }
  }


  // ---- menu cursor
  const NAV_SEL = 'button, .btn, .card, .gen-tab, .cell, .chip, .menu-item, .fav-slot, summary, label, select, input[type="range"], a[href], [role="button"], [onclick], [tabindex]:not([tabindex="-1"])';
  let navFocus = null, navHeld = null;

  function navStyle() {
    if (document.getElementById('psmod-nav-css')) return;
    const st = document.createElement('style');
    st.id = 'psmod-nav-css';
    st.textContent = '#psmod-padring{position:fixed;z-index:100003;pointer-events:none;border:3px solid #ffd23f;border-radius:8px;box-shadow:0 0 0 3px rgba(11,24,56,.85),0 0 12px 3px rgba(255,210,63,.55);display:none}' +
      // Controller button badges (cards, hints, reroll).
      '.psmod-padkey{display:inline-grid!important;place-items:center;box-sizing:border-box;min-width:26px;height:26px;padding:0 7px!important;border-radius:13px!important;' +
      'border:2px solid var(--pk,#c9d6ff)!important;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.22),rgba(255,255,255,0) 60%),#1b2b55!important;' +
      'color:#fff!important;font-weight:700;line-height:1;box-shadow:0 2px 0 #0b1838,inset 0 -2px 0 rgba(0,0,0,.35);text-shadow:1px 1px 0 #0b1838;vertical-align:middle}' +
      '.psmod-padkey.round{width:26px;padding:0!important;border-radius:50%!important;color:var(--pk,#fff)!important}' +
      '.psmod-padkey:is(.sh-lb,.sh-rb){border-top-width:4px!important;padding-top:0!important}' +
      '.psmod-padkey.sh-lb{border-radius:14px 4px 4px 4px!important}.psmod-padkey.sh-rb{border-radius:4px 14px 4px 4px!important}' +
      '.psmod-padkey:is(.sh-lt,.sh-rt){height:28px!important;border-bottom-width:4px!important;align-self:center}' +
      '.psmod-padkey.sh-lt{border-radius:14px 10px 4px 4px!important}.psmod-padkey.sh-rt{border-radius:10px 14px 4px 4px!important}' +
      'kbd.psmod-padkey{min-width:20px;height:20px;font-size:11px}kbd.psmod-padkey.round{width:20px}' +
      'html:not(.psmod-padui) .psmod-glyph{display:none!important}' +
      '.psmod-glyph{min-width:22px;height:22px;font-size:12px;margin-right:6px}.psmod-glyph.round{width:22px}' +
      '#psmod-padhints{position:fixed;left:12px;bottom:56px;height:36px;box-sizing:border-box;z-index:25;display:flex;gap:14px;align-items:center;padding:6px 12px;pointer-events:none;' +
      'font:13px/1 var(--font,"Pixelify",system-ui,sans-serif);color:#fff;text-shadow:2px 2px 0 #0a1430;background:rgba(8,16,40,.78);border:2px solid rgba(244,248,255,.25);border-radius:12px}' +
      '#psmod-padhints.docked{position:static;flex:0 0 auto;justify-content:center;flex-wrap:wrap;height:auto;margin:12px 0 0;padding:9px 0 0;background:none;border:0;border-top:2px solid rgba(244,248,255,.16);border-radius:0;box-shadow:none;grid-column:1/-1;width:auto}' +
      '#psmod-padhints.docked .psmod-glyph{min-width:24px;height:24px}' +
      '#psmod-padhints.docked.stick{position:sticky;z-index:5;background:var(--box2,#1a3170);box-shadow:0 -10px 14px -6px var(--box2,#1a3170)}' +
      '#psmod-padhints[hidden]{display:none}#psmod-padhints .h{display:inline-flex;align-items:center;gap:0}#psmod-padhints .psmod-glyph{margin-right:4px}#psmod-padhints .h>span:last-child{margin-left:2px}';
    (document.head || document.documentElement).appendChild(st);
    padRing = document.createElement('div');
    padRing.id = 'psmod-padring';
    document.body.appendChild(padRing);
  }
  // The yellow box follows the highlighted element every frame. It's a
  // separate layer on top, so boxes that clip their contents (the main
  // menu's Normal / Shiny switch) can't cut it off.
  let padRing = null;
  function syncPadRing() {
    if (!padRing) return;
    const el = navFocus && navFocus.isConnected ? navFocus : null;
    if (!el) { if (padRing.style.display !== 'none') padRing.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    const br = parseFloat(getComputedStyle(el).borderRadius) || 6;
    Object.assign(padRing.style, { display: 'block', left: r.left - 5 + 'px', top: r.top - 5 + 'px', width: r.width + 10 + 'px', height: r.height + 10 + 'px', borderRadius: Math.min(br + 4, 20) + 'px' });
  }

  function navVisible(el) {
    if (!el.isConnected || el.disabled || el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  }
  function onScreen(el) {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    const top = document.elementFromPoint(x, y);
    return !!top && (top === el || el.contains(top) || top.contains(el));
  }
  // What the cursor may move to: whatever is on top. A window over the menu
  // (Pokémon, Gacha, Settings, a pop-up…) keeps the cursor inside it, so it
  // never lands on things hidden underneath.
  function navScope() {
    const shown = (sel) => { const el = document.querySelector(sel); return el && el.getClientRects().length ? el : null; };
    for (const sel of ['#psmod-selpop:not([hidden])', '#psmod-mvpop:not([hidden])', '#psmod-tour:not([hidden])', '#psmod-share:not([hidden])', '#psmod-sum:not([hidden])', '#pull-fx:not(.hidden)', '#scr-profile:not(.hidden)', '#psmod-cpause:not([hidden])', '#invite-pop:not(.hidden)']) {
      const el = shown(sel); if (el) return { el, bar: false };
    }
    let top = null, tz = -Infinity;
    for (const el of document.querySelectorAll('.scr:not(.hidden)')) {
      if (!el.getClientRects().length) continue;
      const z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
      if (z >= tz) { tz = z; top = el; }
    }
    // The top bar is only reachable from the main menu, not with a window open.
    return top ? { el: top, bar: top.id === 'scr-menu' } : null;
  }
  function navTargets() {
    const out = [];
    const scope = navScope();
    for (const el of document.querySelectorAll(NAV_SEL)) {
      if (scope && !scope.el.contains(el) && !(scope.bar && el.closest('#topbar'))) continue;
      if (el.tagName === 'LABEL' && (!el.querySelector('input') || el.querySelector('input[type="range"]'))) continue;
      // The minimap and the damage panel are mouse-only, and the cursor skips
      // credits / legal links, outside links, the donation and log-out
      // buttons and the account pills.
      if (el.closest('#psmod, #psmod-map, .psmod-favarr, #credits-line, .credits-line, .legal-link, [data-legal], #btn-support, #btn-logout, .topbar .pill, #user-pill, #tickets-pill')) continue;
      if (el.matches('a[href]') && /^(https?:|mailto:)/.test(el.getAttribute('href') || '') && !el.closest('.btn')) continue;
      // Inner parts of something already clickable (an icon in a button...).
      if (el.parentElement && el.parentElement.closest('label, button, summary, .btn, .card, .cell, .gen-tab')) continue;
      if (!navVisible(el)) continue;
      out.push({ el, on: onScreen(el), r: el.getBoundingClientRect() });
    }
    return out;
  }
  // If the highlighted element was redrawn (a toggle re-rendering its
  // panel), move to whatever now sits in the same place.
  let navLastAt = null;
  function navFocusValid() {
    if (navFocus && !navFocus.isConnected && navLastAt) {
      const at = navLastAt;
      let best = null, bd = 50;
      for (const t of navTargets()) {
        if (!t.on) continue;
        const d = Math.hypot(t.r.left + t.r.width / 2 - at[0], t.r.top + t.r.height / 2 - at[1]);
        if (d < bd) { bd = d; best = t.el; }
      }
      if (best) { navSet(best); return navFocus; }
    }
    if (navFocus && (!navVisible(navFocus) || !onScreen(navFocus))) navClear();
    if (navFocus) { const r = navFocus.getBoundingClientRect(); navLastAt = [r.left + r.width / 2, r.top + r.height / 2]; }
    return navFocus;
  }
  function navSet(el) {
    navStyle();
    if (navFocus) navFocus.classList.remove('psmod-padfocus');
    navFocus = el;
    if (!el) return;
    el.classList.add('psmod-padfocus');
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch {}
  }
  function navClear() { navSet(null); }
  // A new window opened (or one closed): the highlight left behind on the
  // screen underneath is dropped, and on a controller the cursor starts
  // fresh on something you can see in the new window.
  let navScopeEl = null, navScopeAt = 0;
  function navScopeCheck() {
    if (!menuMode()) { navScopeEl = null; return; }
    const sc = navScope();
    const el = sc ? sc.el : null;
    const inScope = (f) => !sc || sc.el.contains(f) || (sc.bar && f.closest('#topbar'));
    if (el !== navScopeEl) { navScopeEl = el; navScopeAt = performance.now(); if (navFocus && !inScope(navFocus)) navClear(); return; }
    if (navFocus && !inScope(navFocus)) navClear();
    // Let the window finish appearing before picking something.
    if (padMode && !navFocus && navScopeAt && performance.now() - navScopeAt > 250 && !choiceCards() && !isListening()) { navScopeAt = 0; navStart(sc); }
  }
  // Where the cursor starts in a window: Play on the main menu, otherwise the
  // first thing in reading order (skipping text boxes and Back / Close).
  let gachaLast = null;
  addEventListener('click', (e) => { const b = e.target && e.target.closest && e.target.closest('#pull-1, #pull-10, #pull-10b, #psmod-pull-all'); if (b) gachaLast = b.id; }, true);
  function navStart(sc) {
    const list = navTargets().filter((t) => t.on && (!sc || sc.el.contains(t.el)));
    if (!list.length) { navMove(null); return; }
    if (sc && sc.el.id === 'scr-menu') { const play = list.find((t) => t.el.matches('[data-go="play"]')); if (play) { navSet(play.el); return; } }
    // Back from a gacha pull: the button you used (or the nearest one still usable).
    if (sc && sc.el.id === 'scr-gacha' && gachaLast) {
      const ids = ['pull-1', 'pull-10', 'pull-10b', 'psmod-pull-all'], at = ids.indexOf(gachaLast);
      const order = ids.map((id, i) => [id, Math.abs(i - at)]).sort((a, b) => a[1] - b[1]).map(([id]) => id);
      for (const id of order) { const t = list.find((x) => x.el.id === id); if (t) { navSet(t.el); return; } }
    }
    const ok = list.filter((t) => !t.el.matches('input[type="search"], input[type="text"], textarea, [data-back], [id$="-close"], #set-close'));
    const pool = ok.length ? ok : list;
    pool.sort((a, b) => (Math.round(a.r.top / 12) - Math.round(b.r.top / 12)) || a.r.left - b.r.left);
    navSet(pool[0].el);
  }

  function navMove(dir) {
    const list = navTargets();
    if (!list.length) return;
    const cur = navFocusValid();
    if (!cur || !dir) {
      // On the main menu: Play.
      const sc = navScope();
      const play = sc && sc.el.id === 'scr-menu' && list.find((t) => t.on && t.el.matches('[data-go="play"]'));
      if (play) { navSet(play.el); return; }
      // Start on something visible near the middle of the screen.
      const on = list.filter((t) => t.on);
      const pool = on.length ? on : list;
      const cx = innerWidth / 2, cy = innerHeight / 2;
      let best = pool[0], bd = Infinity;
      for (const t of pool) {
        const d = Math.hypot(t.r.left + t.r.width / 2 - cx, t.r.top + t.r.height / 2 - cy);
        if (d < bd) { bd = d; best = t; }
      }
      navSet(best.el);
      return;
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    const scroller = scrollParent(cur);
    let best = null, bs = Infinity, hidden = null, hs = Infinity, same = null, ss = Infinity;
    for (const t of list) {
      if (t.el === cur || t.el.contains(cur) || cur.contains(t.el)) continue;
      const bx = t.r.left + t.r.width / 2, by = t.r.top + t.r.height / 2;
      // Gap between the edges along the direction, so wide buttons line up.
      const along = dx ? (dx > 0 ? t.r.left - a.right : a.left - t.r.right) : (dy > 0 ? t.r.top - a.bottom : a.top - t.r.bottom);
      const centre = (bx - ax) * dx + (by - ay) * dy;
      if (centre <= 2 || along < -Math.min(a.width, a.height) / 2) continue;
      const across = dx ? Math.max(0, Math.abs(by - ay) - (a.height + t.r.height) / 2) : Math.max(0, Math.abs(bx - ax) - (a.width + t.r.width) / 2);
      const score = Math.max(0, along) + across * 3;
      if (t.on) { if (score < bs) { bs = score; best = t; } }
      // Out of view but in a box that scrolls: scrolled to on the way.
      else if (score < hs && scrollParent(t.el)) { hs = score; hidden = t; }
      // The nearest one in the same scrolling box, seen or not.
      if (scroller && scroller.contains(t.el) && score < ss) { ss = score; same = t; }
    }
    // Inside a scrolling list, keep to the list until its end before leaving
    // it (for the header, the tabs…).
    if (dy && scroller && best && !scroller.contains(best.el)) {
      if (same) { navSet(same.el); return; }
      if (canScroll(scroller, dy)) { scrollBox(scroller, dy); return; }
    }
    // A long way down a list that scrolls: scroll a bit first.
    const far = best && scroller && dy && Math.abs(best.r.top - ay) > scroller.clientHeight * 0.75 && canScroll(scroller, dy);
    if (best && !far) { navSet(best.el); return; }
    if (dy && scroller && canScroll(scroller, dy) && (!hidden || hs > scroller.clientHeight * 0.6)) { scrollBox(scroller, dy); return; }
    if (hidden) { navSet(hidden.el); return; }
    if (best) { navSet(best.el); return; }
    // Nothing to move to: scroll whatever is open.
    if (dy) { const box = scroller || mainScroller(); if (box && canScroll(box, dy)) scrollBox(box, dy); }
  }
  // The nearest box around `el` that scrolls up / down.
  function scrollParent(el) {
    for (let p = el && el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (p.scrollHeight <= p.clientHeight + 2) continue;
      const oy = getComputedStyle(p).overflowY;
      if (oy === 'auto' || oy === 'scroll') return p;
    }
    return null;
  }
  // The biggest scrolling box in what's on top (for screens with nothing to select).
  function mainScroller() {
    const sc = navScope();
    if (!sc) return null;
    let best = null, area = 0;
    for (const el of [sc.el, ...sc.el.querySelectorAll('*')]) {
      if (el.scrollHeight <= el.clientHeight + 2 || !el.getClientRects().length) continue;
      const oy = getComputedStyle(el).overflowY;
      if (oy !== 'auto' && oy !== 'scroll') continue;
      const a = el.clientWidth * el.clientHeight;
      if (a > area) { area = a; best = el; }
    }
    return best;
  }
  const canScroll = (el, dy) => (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 2 : el.scrollTop > 0);
  function scrollBox(el, dy) {
    el.scrollBy({ top: dy * Math.max(80, el.clientHeight * 0.4), behavior: reduceMotion ? 'auto' : 'smooth' });
    // The highlight stays only if it's still in view after the scroll.
    setTimeout(() => { if (navFocus && !onScreen(navFocus)) navClear(); }, reduceMotion ? 30 : 350);
  }

  // Drop-down lists can't be opened from a controller, so A shows the
  // choices in a list of our own (up / down, A picks, B closes).
  let selPop = null, selFor = null;
  function closeSelPop(back = true) {
    if (!selPop || selPop.hidden) return;
    selPop.hidden = true;
    const s = selFor; selFor = null;
    if (back && s && s.isConnected) navSet(s);
  }
  function openSelPop(sel) {
    if (!selPop) {
      selPop = document.createElement('div');
      selPop.id = 'psmod-selpop';
      selPop.hidden = true;
      const st = document.createElement('style');
      st.textContent = `#psmod-selpop{position:fixed;z-index:100002;min-width:200px;max-height:min(420px,70vh);overflow:auto;padding:6px;border-radius:12px;box-sizing:border-box;
  background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));border:3px solid var(--edge,#f4f8ff);box-shadow:0 0 0 3px var(--edge-out,#0b1838),0 10px 24px rgba(0,0,0,.5);
  font:14px/1.2 var(--font,'Pixelify',system-ui,sans-serif)}
#psmod-selpop[hidden]{display:none}
#psmod-selpop button{display:block;width:100%;padding:7px 10px;border:0;border-radius:8px;background:none;color:#fff;font:inherit;text-align:left;cursor:pointer;text-shadow:1px 1px 0 #0a1430;white-space:nowrap}
#psmod-selpop button:hover,#psmod-selpop button.psmod-padfocus{background:rgba(255,255,255,.12)}
#psmod-selpop button.on{color:var(--gold,#ffd23f);background:rgba(255,210,63,.15)}`;
      document.head.appendChild(st);
      document.body.appendChild(selPop);
      selPop.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-i]');
        if (!b || !selFor) return;
        e.stopPropagation();
        const s = selFor, o = s.options[+b.dataset.i];
        closeSelPop();
        if (o && s.value !== o.value) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); s.dispatchEvent(new Event('input', { bubbles: true })); }
        try { NS.Audio.sfx('select'); } catch (_) { /* quiet */ }
      });
      addEventListener('keydown', (e) => { if (e.key === 'Escape' && selPop && !selPop.hidden) { e.stopImmediatePropagation(); e.preventDefault(); closeSelPop(); } }, true);
      document.addEventListener('pointerdown', (e) => { if (selPop && !selPop.hidden && !selPop.contains(e.target)) closeSelPop(false); }, true);
      addEventListener('resize', () => closeSelPop(false));
    }
    selPop.innerHTML = [...sel.options].map((o, i) => (o.hidden || o.disabled ? '' : `<button data-i="${i}" data-sfx="none" class="${o.selected ? 'on' : ''}">${esc(o.textContent)}</button>`)).join('');
    selFor = sel;
    selPop.hidden = false;
    const r = sel.getBoundingClientRect(), ph = selPop.offsetHeight, pw = Math.max(r.width, selPop.offsetWidth);
    const below = r.bottom + 6 + ph <= innerHeight - 8;
    Object.assign(selPop.style, { left: Math.max(8, Math.min(innerWidth - pw - 8, r.left)) + 'px', top: (below ? r.bottom + 6 : Math.max(8, r.top - 6 - ph)) + 'px', minWidth: r.width + 'px' });
    const cur = selPop.querySelector('button.on') || selPop.querySelector('button');
    if (cur) { cur.scrollIntoView({ block: 'center' }); navSet(cur); }
  }
  function navActivate(el) {
    if (el.matches('select')) { openSelPop(el); return; }
    el.click();
    // Pad presses shouldn't leave keyboard focus on a button (Space/Enter
    // would then press it again during a run).
    if (document.activeElement && document.activeElement !== document.body && !typing(document.activeElement)) document.activeElement.blur();
  }
  // Moving the mouse hides the cursor.
  addEventListener('mousemove', (e) => { if (e.isTrusted && navFocus && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) navClear(); }, true);

  // ---- rumble when you take a hit
  let rumbleHp = null, rumbleAt = 0;
  function padRumbleCheck(gp) {
    const p = NS && NS.Game && me();
    if (!p || typeof p.hp !== 'number') { rumbleHp = null; return; }
    const prev = rumbleHp;
    rumbleHp = p.hp;
    if (!padRumble || !gp || prev == null || p.hp >= prev || !(p.maxHp > 0)) return;
    const now = performance.now();
    if (now - rumbleAt < 140) return;
    rumbleAt = now;
    const hit = Math.min(1, ((prev - p.hp) / p.maxHp) * 5);
    const act = gp.vibrationActuator;
    const dur = p.dead || p.hp <= 0 ? 400 : 110, strong = p.hp <= 0 ? 1 : 0.25 + hit * 0.75;
    try {
      if (act && act.playEffect) act.playEffect('dual-rumble', { duration: dur, strongMagnitude: strong, weakMagnitude: 0.5 });
      // Firefox: its own (older) haptics API, when the browser has it enabled.
      else if (gp.hapticActuators && gp.hapticActuators[0] && gp.hapticActuators[0].pulse) gp.hapticActuators[0].pulse(strong, dur);
    } catch {}
  }

  // ------------------------------------------------------------ settings tabs
  // The mod's settings live in the game's own Settings screen. The game's
  // tabs (Sound → "Audio", Graphics, Controls, Account, About) get our extra
  // rows appended, and we add three tabs of our own:
  //   HUD & UI       HUD style / size, bars, minimap and its markers, panels,
  //                  banners — each with a live preview
  //   Accessibility  language (moved from Graphics), colour blind filter,
  //                  less shake and flashes (moved from Graphics), animations
  //   Extras         co-op, backup (export / import), status, help
  // The game wires its tabs with its own click handlers and renders the
  // chosen one into #set-body; ours render there too with the game's classes.
  const OUR_TABS = [
    ['psmod-hud', 'HUD & UI', 'gfx'],
    ['psmod-notif', 'Notifications', 'psmod-hud'],
    ['psmod-acc', 'Accessibility', 'ctl'],
    ['psmod-extras', 'Extras', null],
  ];
  let ourTab = null, extrasBody = null, extrasObs = null;
  const ourTabEls = new Map();
  let extrasOpen = false;     // one of our tabs is showing (kept for older code)
  let reduceMotion = load('reduceMotion', false);
  let pingsOn = load('pingsOn', true), chatShown = load('chatShown', true);
  let pingChat = load('pingChat', true), pingSound = load('pingSound', true), chatSound = load('chatSound', true);

  const extrasVisible = () => !!ourTab && settingsOpen();
  function refreshExtras() {
    if (extrasVisible()) renderExtras();
    else if (settingsOpen() && document.getElementById('psmod-sec')) injectSection();
  }
  function renderKeys() { refreshExtras(); }
  function openOurTab(id) {
    const tabs = document.getElementById('set-tabs');
    for (const t of tabs.querySelectorAll('.gen-tab')) t.classList.toggle('on', t.dataset.t === id);
    ourTab = id; extrasOpen = true;
    listening = null;
    renderExtras();
    extrasBody.scrollTop = 0;
  }
  function leaveOurTab() {
    if (!ourTab) return;
    const el = ourTabEls.get(ourTab);
    if (el) el.classList.remove('on');
    ourTab = null; extrasOpen = false; listening = null;
  }

  function setupExtras() {
    const tabs = document.getElementById('set-tabs'), body = document.getElementById('set-body');
    if (!tabs || !body || document.getElementById('psmod-extras-tab')) return;
    extrasBody = body;
    const st = document.createElement('style');
    st.textContent = `
#set-body .psx-step{display:flex;align-items:center;gap:6px;flex:none}
#set-body .psx-step b{min-width:46px;text-align:center}
#set-body .psx-step .btn{min-width:38px}
#psmod-keys{width:100%;border-collapse:separate;border-spacing:0 6px;font-size:14px;margin:4px 0 6px}
#psmod-keys th{color:var(--muted,#b9cbf0);font-weight:400;font-size:12px;text-align:left;padding:0 4px}
#psmod-keys td{padding:0 4px;vertical-align:middle}
#psmod-keys td:first-child{padding-left:0;width:31%}
#psmod-keys th:nth-child(n+2){width:23%}
#psmod-keys .btn{width:100%;padding:4px 6px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#set-body .psx-foot{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0 8px}
#set-body .psx-sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px;border:1px solid #0b1838;box-shadow:0 0 0 1px rgba(255,255,255,.35)}
#set-body canvas.psx-prev{display:block;width:100%;max-width:440px;height:auto;margin:6px 0 8px;border-radius:10px;box-shadow:0 0 0 2px rgba(244,248,255,.2)}
#set-body .psx-prev-row{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap}
#set-body .psx-prev-row canvas.psx-prev{width:auto;max-width:100%}
#set-body .psx-cap{font-size:11px;color:var(--muted,#b9cbf0);margin:-4px 0 6px}
#set-body .psx-swatches{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 8px}
#set-body .psx-swatches i{display:inline-grid;place-items:center;min-width:54px;height:20px;padding:0 6px;border-radius:5px;font-size:11px;font-style:normal;color:#10131a;text-shadow:none;font-weight:700}
#set-body .psx-status{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:13px;margin:4px 0 8px}
#set-body .psx-status .ok{color:#5fe08a}#set-body .psx-status .bad{color:#ff8a96}#set-body .psx-status .wait{color:#b9cbf0}
#set-body .psx-status small{display:block;color:var(--muted,#b9cbf0);font-size:11px}
.snd-row:has(.psx-pct){grid-template-columns:20px 64px 1fr 44px}
.sound-inline:has(.psx-pct){max-width:360px}
.snd-row .psx-pct{text-align:right;font-weight:700;color:var(--gold,#ffd23f)}
#set-body .psx-range{display:flex;align-items:center;gap:8px;flex:none}
#set-body .psx-range input{width:140px}`;
    document.head.appendChild(st);

    // "Sound" reads "Audio".
    const snd = tabs.querySelector('.gen-tab[data-t="sound"]');
    if (snd) { snd.textContent = 'Audio'; snd.setAttribute('translate', 'no'); }
    for (const [id, label, after] of OUR_TABS) {
      const tab = document.createElement('button');
      tab.className = 'gen-tab';
      tab.id = id === 'psmod-extras' ? 'psmod-extras-tab' : id + '-tab';
      tab.dataset.t = id;
      tab.textContent = label;
      tab.setAttribute('translate', 'no');
      const ref = after && tabs.querySelector(`.gen-tab[data-t="${after}"]`);
      if (ref) ref.after(tab); else tabs.appendChild(tab);
      ourTabEls.set(id, tab);
      tab.addEventListener('click', (e) => { e.stopPropagation(); tab.blur(); openOurTab(id); });
    }
    // Picking one of the game's tabs, or the game redrawing the body when the
    // screen opens again, hands it back to the game.
    tabs.addEventListener('click', (e) => {
      const t = e.target.closest('.gen-tab');
      if (t && !ourTabEls.has(t.dataset.t)) leaveOurTab();
    }, true);
    extrasObs = new MutationObserver(() => { leaveOurTab(); injectSection(); });
    extrasObs.observe(body, { childList: true });
    body.addEventListener('click', onExtrasClick);
    body.addEventListener('input', onExtrasInput);
    body.addEventListener('change', onExtrasChange);
  }
  onReady(setupExtras);

  // ------------------------------------------------------------ search boxes
  // Settings: one box that looks through every tab (the game's and ours).
  // Achievements: through every category. Friends and the Upgrades picker:
  // filter the list once it gets long.
  const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = (q) => fold(q).split(/\s+/).filter(Boolean);
  const hasAll = (hay, ws) => ws.every((w) => hay.includes(w));
  const markHit = (text, ws) => {
    let out = esc(text);
    for (const w of ws) {
      const f = fold(text), i = f.indexOf(w);
      if (i < 0) continue;
      const raw = text.slice(i, i + w.length);
      out = out.replace(esc(raw), `<mark>${esc(raw)}</mark>`);
    }
    return out;
  };
  const searchCss = `
.psmod-search{box-sizing:border-box;padding:6px 10px 6px 30px;font:inherit;font-size:14px;color:#fff;border-radius:10px;outline:none;
  background:rgba(0,0,0,.3) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Ccircle cx='6' cy='6' r='4.2' fill='none' stroke='%23b9cbf0' stroke-width='2'/%3E%3Cpath d='M9 9l3.5 3.5' stroke='%23b9cbf0' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat 10px center;
  border:2px solid rgba(244,248,255,.35)}
.psmod-search:focus{border-color:#ffd23f}
.psmod-search::placeholder{color:#b9cbf0}
.psmod-search::-webkit-search-cancel-button{filter:invert(1)}
#psmod-set-sw{position:relative;flex:1 1 auto;max-width:340px;margin:0 14px}
#psmod-set-sw .psmod-search{width:100%}
#psmod-set-res{position:absolute;left:0;right:0;top:calc(100% + 6px);z-index:30;max-height:min(420px,60vh);overflow:auto;padding:6px;border-radius:12px;
  background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));border:3px solid var(--edge,#f4f8ff);box-shadow:0 0 0 3px var(--edge-out,#0b1838),0 10px 24px rgba(0,0,0,.45)}
#psmod-set-res[hidden]{display:none}
#psmod-set-res .psr{display:block;width:100%;text-align:left;font:inherit;color:#fff;background:none;border:0;border-radius:8px;padding:7px 9px;cursor:pointer}
#psmod-set-res .psr:hover,#psmod-set-res .psr.on,#psmod-set-res .psr.psmod-padfocus{background:rgba(255,255,255,.12)}
#psmod-set-res .psr b{font-size:14px}
#psmod-set-res .psr small{display:block;color:var(--muted,#b9cbf0);font-size:12px;line-height:1.3;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#psmod-set-res .tg{float:right;margin-left:8px;font-size:11px;padding:2px 7px;border-radius:8px;background:rgba(0,0,0,.3);color:var(--gold,#ffd23f)}
#psmod-set-res mark,#scr-goals mark{background:none;color:var(--gold,#ffd23f);text-decoration:underline}
#psmod-set-res .none{padding:10px;color:var(--muted,#b9cbf0);font-size:13px}
.psmod-found{animation:psmodFound 1.8s ease-out}
@keyframes psmodFound{0%,35%{box-shadow:0 0 0 3px #ffd23f,0 0 16px rgba(255,210,63,.7);background-color:rgba(255,210,63,.14)}100%{box-shadow:0 0 0 3px rgba(255,210,63,0);background-color:transparent}}
.psmod-listsearch{display:block;width:100%;margin:6px 0 10px}
#psmod-upg-search{width:150px;margin-right:6px}
#psmod-ach-res .psmod-cat{display:block;font-size:11px;color:var(--gold,#ffd23f);margin-bottom:2px}
`;
  let searchCssOn = false;
  function addSearchCss() { if (searchCssOn) return; searchCssOn = true; const st = document.createElement('style'); st.textContent = searchCss; document.head.appendChild(st); }
  // Quietly swaps tabs or categories (no clicks heard).
  async function quietly(fn) {
    const A = NS.Audio, sfx = A && A.sfx;
    if (A) A.sfx = function () {};
    try { return await fn(); } finally { if (A) A.sfx = sfx; }
  }
  const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

  function setupSettingsSearch() {
    const box = document.querySelector('#scr-settings .box'), tabs = document.getElementById('set-tabs'), body = document.getElementById('set-body');
    const head = box && box.querySelector('.row.between');
    if (!head || !tabs || !body || document.getElementById('psmod-set-search')) return;
    addSearchCss();
    const wrap = document.createElement('div');
    wrap.id = 'psmod-set-sw';
    wrap.setAttribute('translate', 'no');
    wrap.innerHTML = '<input id="psmod-set-search" class="psmod-search" type="search" placeholder="Search settings" spellcheck="false" autocomplete="off"><div id="psmod-set-res" hidden></div>';
    head.insertBefore(wrap, head.lastElementChild);
    const inp = wrap.firstElementChild, res = wrap.lastElementChild;
    let index = null, building = null, hits = [], active = 0;

    const tabOf = () => ourTab || currentGameTab();
    const showTab = (id) => {
      if (ourTabEls.has(id)) { openOurTab(id); return; }
      const t = tabs.querySelector(`.gen-tab[data-t="${id}"]`);
      if (t) t.click();
    };
    // Everything a tab shows that has a name: rows, section titles, key bindings.
    const items = () => [...body.querySelectorAll('h3.set-h, .set-row, .snd-row, #psmod-keys tbody tr')];
    function collect(tab, label, out) {
      let section = '';
      items().forEach((el, i) => {
        let title = '', desc = '';
        if (el.matches('h3')) {
          section = el.textContent.trim();
          title = section;
          const nx = el.nextElementSibling;
          if (nx && nx.matches('p.sub, p.note')) desc = nx.textContent.trim();
        } else if (el.matches('.snd-row')) {
          const c = el.querySelector('span'); title = c ? c.textContent.trim() + ' volume' : ''; desc = 'Volume';
        } else if (el.matches('tr')) {
          const c = el.querySelector('td'); title = c ? c.textContent.trim() : ''; desc = 'Key binding';
        } else {
          const b = el.querySelector('b'), s = el.querySelector('small');
          title = b ? b.textContent.trim() : ''; desc = s ? s.textContent.trim() : '';
        }
        if (!title) return;
        title = tr(title); desc = tr(desc);
        out.push({ tab, label, i, title, desc, section: el.matches('h3') ? '' : section, hay: fold([title, desc, section, label].join(' ')), ht: fold(title) });
      });
    }
    function build() {
      if (building) return building;
      building = quietly(async () => {
        const cur = tabOf(), top = body.scrollTop, out = [];
        body.style.visibility = 'hidden';
        try {
          for (const t of [...tabs.querySelectorAll('.gen-tab')]) {
            const id = t.dataset.t;
            if (!id) continue;
            showTab(id);
            await settle();
            collect(id, t.textContent.trim(), out);
          }
        } finally {
          if (cur) showTab(cur);
          await settle();
          body.scrollTop = top;
          body.style.visibility = '';
        }
        index = out;
        return out;
      }).finally(() => { building = null; });
      return building;
    }
    function draw() {
      const ws = words(inp.value);
      if (!ws.length) { res.hidden = true; res.innerHTML = ''; hits = []; return; }
      hits = index.filter((e) => hasAll(e.hay, ws))
        .map((e) => ({ e, s: (e.ht.startsWith(ws[0]) ? 0 : hasAll(e.ht, ws) ? 1 : 2) }))
        .sort((a, b) => a.s - b.s).slice(0, 14).map((x) => x.e);
      active = 0;
      res.innerHTML = hits.length ? hits.map((e, n) => `<button class="psr${n === 0 ? ' on' : ''}" data-n="${n}" data-sfx="none"><span class="tg">${esc(e.label)}</span><b>${markHit(e.title, ws)}</b>${
        e.desc || e.section ? `<small>${e.section ? esc(e.section) + ' · ' : ''}${markHit(e.desc, ws)}</small>` : ''}</button>`).join('')
        : '<div class="none">Nothing found.</div>';
      res.hidden = false;
    }
    async function go(e) {
      res.hidden = true;
      inp.value = '';
      inp.blur();
      await quietly(async () => { showTab(e.tab); await settle(); });
      const el = items()[e.i];
      if (!el) return;
      try { el.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); } catch (_) { el.scrollIntoView(); }
      el.classList.remove('psmod-found'); void el.offsetWidth; el.classList.add('psmod-found');
      setTimeout(() => el.classList.remove('psmod-found'), 1900);
      // On a controller, the cursor goes to the setting's switch or buttons.
      if (padMode) { const c = el.querySelector('input, button, select, .chip') || (el.nextElementSibling && el.nextElementSibling.querySelector('.chip, button')); if (c) navSet(c.closest('label') || c); }
    }
    inp.addEventListener('focus', () => { index = null; });
    inp.addEventListener('input', async () => {
      try { if (!index) await build(); draw(); } catch (err) { trip('settingsSearch', err); }
    });
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { if (inp.value) { inp.value = ''; draw(); } else inp.blur(); e.preventDefault(); return; }
      if (!hits.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
        res.querySelectorAll('.psr').forEach((b, n) => b.classList.toggle('on', n === active));
        const on = res.querySelector('.psr.on'); if (on) on.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') { e.preventDefault(); go(hits[active]); }
    });
    res.addEventListener('mousedown', (e) => e.preventDefault());   // keep the box focused
    res.addEventListener('click', (e) => {
      const b = e.target.closest('.psr');
      if (b) { e.stopPropagation(); go(hits[+b.dataset.n]); }
    });
    inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== inp && !(res.contains(document.activeElement))) res.hidden = true; }, 150));
    // Closing Settings clears the box.
    new MutationObserver(() => { if (!settingsOpen() && inp.value) { inp.value = ''; draw(); } })
      .observe(document.getElementById('scr-settings'), { attributes: true, attributeFilter: ['class'] });
  }
  onReady(setupSettingsSearch);

  // Achievements: the box looks through every category at once.
  function setupAchSearch() {
    const body = document.getElementById('goals-body');
    if (!body || body.dataset.psmodSearch) return;
    body.dataset.psmodSearch = '1';
    addSearchCss();
    let q = '';
    const cats = () => new Map(((NS.AchDefs && NS.AchDefs.CATS) || []).map(([k, l]) => [k, tr(l)]));
    function card(a, s, ws, cat) {
      const ok = !!(s.ach && s.ach[a.id]);
      const v = Math.min(a.goal, +a.value(s) || 0);
      const el = document.createElement('div');
      el.className = 'ach' + (ok ? ' ok' : '');
      let reward = ''; try { reward = NS.Progress.rewardText(a.reward); } catch (_) { /* none */ }
      el.innerHTML = `${NS.Icons.html(ok ? 'medal' + a.tier : 'medalOff', 36)}
        <div class="a-txt"><span class="psmod-cat">${esc(cat || '')}</span><b>${markHit(tr(a.name), ws)}</b><small>${markHit(tr(a.desc), ws)}</small>
          ${ok ? '' : `<div class="bar"><i style="width:${v / a.goal * 100}%"></i></div>`}
          <div class="a-rw">${ok ? esc(tr('¡Conseguido!')) : v.toLocaleString('es') + ' / ' + a.goal.toLocaleString('es')} · ${reward}
          ${a.title ? ` · <span class="gold">${esc(tr('Título'))}: ${esc(a.title)}</span>` : ''}</div></div>`;
      return el;
    }
    function apply() {
      const chips = body.querySelector(':scope > .filters');
      if (!chips) return;     // not the achievements tab
      let inp = document.getElementById('psmod-ach-search');
      if (!inp) {
        inp = document.createElement('input');
        inp.id = 'psmod-ach-search'; inp.type = 'search'; inp.className = 'psmod-search psmod-listsearch';
        inp.placeholder = 'Search achievements'; inp.spellcheck = false; inp.autocomplete = 'off';
        inp.setAttribute('translate', 'no');
        inp.value = q;
        chips.before(inp);
        inp.addEventListener('input', () => { q = inp.value; draw(); });
        inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' && inp.value) { e.preventDefault(); inp.value = q = ''; draw(); } });
      }
      draw();
    }
    function draw() {
      const ws = words(q);
      const old = document.getElementById('psmod-ach-res');
      if (old) old.remove();
      for (const el of body.children) if (el.id !== 'psmod-ach-search' && !el.matches('p.sub')) el.style.display = ws.length ? 'none' : '';
      if (!ws.length) return;
      const s = NS.DB.save, cm = cats();
      const grid = document.createElement('div');
      grid.id = 'psmod-ach-res';
      grid.className = 'ach-grid';
      const list = ((NS.AchDefs && NS.AchDefs.LIST) || []).filter((a) => hasAll(fold([tr(a.name), tr(a.desc), a.title || '', cm.get(a.cat) || ''].join(' ')), ws))
        .map((a) => ({ a, s: hasAll(fold(tr(a.name)), ws) ? 0 : hasAll(fold(tr(a.desc)), ws) ? 1 : 2 })).sort((x, y) => x.s - y.s).map((x) => x.a);
      for (const a of list) grid.appendChild(card(a, s, ws, cm.get(a.cat)));
      if (!list.length) grid.innerHTML = '<p class="sub">No achievements found.</p>';
      body.appendChild(grid);
    }
    new MutationObserver(() => { try { if (!document.getElementById('psmod-ach-search') || !document.getElementById('psmod-ach-search').isConnected) apply(); } catch (err) { trip('achSearch', err); } })
      .observe(body, { childList: true });
    apply();
  }
  onReady(setupAchSearch);

  // Friends: a filter box once the list is long.
  function setupFriendSearch() {
    const list = document.getElementById('fr-list');
    if (!list || document.getElementById('psmod-fr-search')) return;
    addSearchCss();
    const inp = document.createElement('input');
    inp.id = 'psmod-fr-search'; inp.type = 'search'; inp.className = 'psmod-search psmod-listsearch';
    inp.placeholder = 'Search friends'; inp.spellcheck = false; inp.autocomplete = 'off';
    inp.setAttribute('translate', 'no');
    list.before(inp);
    const apply = () => {
      const rows = list.querySelectorAll(':scope > .fr-row');
      inp.hidden = rows.length < 6 && !inp.value;
      const ws = words(inp.value);
      for (const r of rows) { const b = r.querySelector('b'); r.style.display = !ws.length || hasAll(fold(b ? b.textContent : r.textContent), ws) ? '' : 'none'; }
    };
    inp.addEventListener('input', apply);
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' && inp.value) { e.preventDefault(); inp.value = ''; apply(); } });
    new MutationObserver(apply).observe(list, { childList: true });
    apply();
  }
  onReady(setupFriendSearch);

  // Upgrades: type part of a name to jump to that Pokémon in the picker.
  function setupUpgSearch() {
    const sel = document.getElementById('upg-mon');
    if (!sel || document.getElementById('psmod-upg-search')) return;
    addSearchCss();
    const inp = document.createElement('input');
    inp.id = 'psmod-upg-search'; inp.type = 'search'; inp.className = 'psmod-search';
    inp.placeholder = 'Name or #'; inp.spellcheck = false; inp.autocomplete = 'off';
    inp.setAttribute('translate', 'no');
    sel.before(inp);
    // Best match first: the exact name ("mew" → Mew, not Mewtwo), then names
    // starting with it, then names containing it. Numbers search the
    // Pokédex number ("151" or "#151").
    const nameOf = (o) => fold(o.textContent.replace(/\s*[(·].*$/, '').trim());
    const apply = (pick) => {
      const q = fold(inp.value).replace(/#/g, '').trim();
      const num = /^\d+$/.test(q);
      let best = null, bs = 9;
      for (const o of sel.options) {
        let sc = 9;
        if (!q) sc = 5;
        else if (num) { const d = String(+o.value); sc = d === String(+q) ? 0 : d.startsWith(q) ? 1 : 9; }
        else {
          const n = nameOf(o);
          sc = n === q ? 0 : n.startsWith(q) ? 1 : n.split(/[\s-]+/).some((w) => w.startsWith(q)) ? 2 : n.includes(q) ? 3 : hasAll(fold(o.textContent), words(q)) ? 4 : 9;
        }
        o.hidden = sc === 9;
        if (sc < bs || (sc === bs && best && +o.value < +best.value && sc < 5)) { bs = sc; best = o; }
      }
      if (pick && q && best && best.value !== sel.value) { sel.value = best.value; sel.dispatchEvent(new Event('change')); }
    };
    inp.addEventListener('input', () => apply(true));
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape' && inp.value) { e.preventDefault(); inp.value = ''; apply(false); } });
    // A fresh picker each time the screen opens.
    new MutationObserver(() => { inp.hidden = sel.options.length < 8; if (inp.value) apply(false); }).observe(sel, { childList: true });
    inp.hidden = sel.options.length < 8;
  }
  onReady(setupUpgSearch);

  // The game's volume sliders (Settings and pause menu) get a percentage.
  function addPct(box) {
    try {
      for (const r of box.querySelectorAll('input[type=range]')) {
        if (r.nextElementSibling && r.nextElementSibling.classList.contains('psx-pct')) continue;
        const lab = document.createElement('b');
        lab.className = 'psx-pct';
        const upd = () => { lab.textContent = r.value + '%'; };
        upd();
        r.after(lab);
        r.addEventListener('input', upd);
      }
    } catch (_) { /* leave the game's sliders as they are */ }
  }
  function setupAudioPct() {
    const UI = NS.UI, orig = UI.soundControls;
    UI.soundControls = function (box) {
      const out = orig.apply(this, arguments);
      addPct(box);
      return out;
    };
    // The top bar's sound button fills its panel without going through
    // UI.soundControls, so that panel is watched instead.
    const panel = document.getElementById('sound-panel');
    if (panel) { new MutationObserver(() => addPct(panel)).observe(panel, { childList: true }); addPct(panel); }
  }
  waitFor(() => NS && NS.UI && NS.UI.soundControls, setupAudioPct);

  const sw = (key, on, disabled) => `<button class="btn small switch${on ? ' gold' : ''}" data-px="${key}"${disabled ? ' disabled' : ''}>${on ? 'On' : 'Off'}</button>`;
  const srow = (title, desc, ctrl) => `<div class="set-row"><div class="grow"><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</div>${ctrl}</div>`;
  const step = (key, val, reset = true) => `<div class="psx-step"><button class="btn small" data-px="${key}:-1" title="Less">−</button><b>${val}</b><button class="btn small" data-px="${key}:1" title="More">+</button>${reset ? `<button class="btn small ghost" data-px="${key}:0">Reset</button>` : ''}</div>`;
  const chips = (items) => `<div class="chips set-chips">${items.map(([px, label, on]) => `<button class="chip${on ? ' on' : ''}" data-px="${px}">${label}</button>`).join('')}</div>`;
  const pct = (v) => Math.round(v * 100) + '%';
  const BAR_LABEL = { default: 'Default', player: 'Player colour', auto: 'By health' };
  const barChips = (which, opts) => chips(opts.map((v) => {
    const col = v === 'rainbow' ? 'linear-gradient(90deg,#ff5f6d,#ffd23f,#46c96a,#3ec8e8,#a46bff)' : v === 'auto' ? 'linear-gradient(90deg,#46c96a,#ffd23f,#e83a4a)' : v === 'player' ? 'linear-gradient(90deg,#5fc8ff,#ff8a96,#ffd23f)'
      : v === 'default' ? (which === 'boss' ? 'linear-gradient(90deg,#d81e3c,#ff7a4d)' : '#e83a4a')
      : which === 'xp' && v === 'blue' ? 'linear-gradient(90deg,#2f8cff,#4fd1ff)' : BAR_COL[v];
    return ['bar:' + which + ':' + v, `<i class="psx-sw" style="background:${col}"></i>${BAR_LABEL[v] || cap(v)}`, barSet[which] === v];
  }));
  // Keeps the preview moving (rainbow / moving style) while it's on screen.
  let previewAnim = 0;
  function animateBarPreview() {
    if (previewAnim) return;
    const step = () => {
      const cv = document.getElementById('psmod-bar-preview');
      if (!cv || !cv.isConnected || cv.getClientRects().length === 0) { previewAnim = 0; return; }
      if (barSet.style === 'moving' || [barSet.hp, barSet.mate, barSet.boss, barSet.xp].includes('rainbow')) {
        try { drawBarPreview(); } catch (_) { /* ignore */ }
      }
      previewAnim = requestAnimationFrame(step);
    };
    previewAnim = requestAnimationFrame(step);
  }
  // A small sample of each bar with the current settings.
  function drawBarPreview() {
    const cv = document.getElementById('psmod-bar-preview');
    if (!cv) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; rr(ctx, 0, 0, W, H, 8); ctx.fill();
    ctx.save();
    ctx.scale(1.4, 1.4);
    const w = W / 1.4;
    ctx.font = HF(800, 8); ctx.textAlign = 'left';
    // Boss.
    outlined(ctx, 'BOSS', 10, 14, '#ffd23f', 2.5);
    const bcol = barSet.boss === 'default' ? '#ff7a4d' : barSet.boss === 'rainbow' ? 'rainbow' : BAR_COL[barSet.boss];
    let fg = null;
    if (barSet.boss === 'default') { fg = ctx.createLinearGradient(44, 0, w - 10, 0); fg.addColorStop(0, '#d81e3c'); fg.addColorStop(1, '#ff7a4d'); }
    rr(ctx, 42.5, 6.5, w - 51, 9, 2.5); ctx.fillStyle = INK; ctx.fill();
    ctx.fillStyle = 'rgba(30,6,12,.95)'; ctx.fillRect(44, 8, w - 54, 6);
    fillBar(ctx, 44, 8, w - 54, 6, 0.62, bcol, fg);
    // Teammate and you.
    const mh = Math.max(3, Math.round(6 * barK('hpSize')));
    outlined(ctx, 'MATE', 10, 32, '#ff8a96', 2.5);
    bar(ctx, 44, 29 - mh / 2, 120, mh, 0.4, hpColor(barSet.mate, 0.4, '#ff8a96'), 'rgba(60,12,20,.9)');
    const hh = Math.round(13 * barK('hpSize'));
    outlined(ctx, 'YOU', 180, 32, '#5fc8ff', 2.5);
    bar(ctx, 206, 29 - hh / 2, w - 216, hh, 0.78, hpColor(barSet.hp, 0.78, '#5fc8ff'), 'rgba(60,12,20,.92)');
    if (barSet.hpNum !== 'off') {
      ctx.font = HF(800, Math.max(7, Math.min(11, hh - 4))); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      outlined(ctx, barSet.hpNum === 'percent' ? '78%' : '156/200', 206 + (w - 216) / 2, 30, '#fff', 2.5);
      ctx.textBaseline = 'alphabetic';
    }
    // Experience.
    const xh = Math.round(7 * barK('xpSize'));
    const xcol = barSet.xp === 'rainbow' ? 'rainbow' : barSet.xp === 'blue' ? '#3aa6ff' : BAR_COL[barSet.xp];
    let xp = null;
    if (barSet.xp === 'blue') { xp = ctx.createLinearGradient(0, 0, w, 0); xp.addColorStop(0, '#2f8cff'); xp.addColorStop(1, '#4fd1ff'); }
    ctx.fillStyle = INK; ctx.fillRect(0, 66 - xh - 2, w, xh + 2);
    ctx.fillStyle = 'rgba(20,40,90,.95)'; ctx.fillRect(0, 66 - xh, w, xh);
    fillBar(ctx, 0, 66 - xh, w, xh, 0.45, xcol, xp, 40);
    if (barSet.xpNum !== 'off') {
      ctx.textAlign = 'right'; ctx.font = HF(800, 8);
      outlined(ctx, barSet.xpNum === 'level' ? 'LV 12 · 45%' : '45%', w - 8, 66 - xh - 4, '#cfe6ff', 2.5);
    }
    ctx.restore();
  }


  // ---- live previews
  // Each preview draws a small mock-up with the current settings, redrawn on
  // every change (and every frame while it's on screen, for the animated ones).
  let previewLoop = 0;
  function drawPreviews() {
    try { drawBarPreview(); } catch (err) { trip('previews', err); }
    for (const [id, fn] of [['psmod-hud-preview', drawHudPreview], ['psmod-map-preview', drawMapPreview], ['psmod-fx-preview', drawFxPreview], ['psmod-fov-preview', drawFovPreview]]) {
      const cv = document.getElementById(id);
      if (cv) { try { fn(cv); } catch (err) { trip('previews', err); } }
    }
    if (!previewLoop) {
      const step = () => {
        const any = document.querySelector('#set-body canvas.psx-prev');
        if (!any || !settingsOpen()) { previewLoop = 0; return; }
        drawPreviewsFrame();
        previewLoop = requestAnimationFrame(step);
      };
      previewLoop = requestAnimationFrame(step);
    }
  }
  let previewFrameAt = 0;
  function drawPreviewsFrame() {
    const now = performance.now();
    if (now - previewFrameAt < 33) return;      // ~30 fps is plenty
    previewFrameAt = now;
    if (barSet.style === 'moving' || [barSet.hp, barSet.mate, barSet.boss, barSet.xp].includes('rainbow')) {
      try { drawBarPreview(); } catch (_) { /* ignore */ }
      const h = document.getElementById('psmod-hud-preview'); if (h) try { drawHudPreview(h); } catch (_) { /* ignore */ }
    }
    const fx = document.getElementById('psmod-fx-preview'); if (fx) try { drawFxPreview(fx); } catch (_) { /* ignore */ }
  }
  // Grass-like backdrop for the previews.
  function previewGround(ctx, W, H) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3f7046'); g.addColorStop(1, '#2d553a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(120,84,50,.35)';
    for (const [x, y, r] of [[0.2, 0.3, 0.12], [0.75, 0.65, 0.16], [0.55, 0.2, 0.08]]) { ctx.beginPath(); ctx.ellipse(x * W, y * H, r * W, r * H * 0.8, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    for (let i = 0; i < 26; i++) ctx.fillRect(((i * 97) % 100) / 100 * W, ((i * 53) % 100) / 100 * H, 1.5, 1.5);
  }
  // A 16:9 "screen" with the HUD at its real proportions for the chosen size.
  function drawHudPreview(cv) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.save();
    previewGround(ctx, W, H);
    // Your Pokémon in the middle.
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(W / 2, H / 2 + 8, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9be38f'; ctx.beginPath(); ctx.arc(W / 2, H / 2, 7, 0, Math.PI * 2); ctx.fill();
    const k = (W / 1280) * (hudStyle === 'new' ? hudScale : 1);
    ctx.scale(k, k);
    const VW = W / k, VH = H / k;
    if (hudStyle !== 'new') {
      // The game's own HUD: health top-left, moves along the bottom.
      bar(ctx, 14, 14, 220, 14, 0.7, '#e83a4a', 'rgba(60,12,20,.92)');
      for (let i = 0; i < 4; i++) frame(ctx, VW / 2 - 126 + i * 63, VH - 72, 54, 54, 8, 'rgba(18,34,74,.9)');
      ctx.restore();
      ctx.font = HF(800, 11); ctx.textAlign = 'right';
      outlined(ctx, 'Classic: the game’s own HUD', W - 8, 16, '#fff', 3);
      return;
    }
    // Teammate card.
    frame(ctx, 10, 10, 36, 36, 5, 'rgba(18,34,74,.95)', '#ff8a96');
    ctx.font = HF(800, 10); ctx.textAlign = 'left'; outlined(ctx, 'Misty', 52, 19, '#ff8a96');
    const mh = Math.max(3, Math.round(6 * barK('hpSize')));
    bar(ctx, 52, 27 - mh / 2, 132, mh, 0.45, hpColor(barSet.mate, 0.45, '#ff8a96'), 'rgba(60,12,20,.9)');
    // Boss plate under the clock.
    const bw = 320, bx = (VW - bw) / 2;
    rr(ctx, bx, 64, bw, 24, 6); ctx.fillStyle = '#2a0d14'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#ffd23f'; ctx.stroke();
    let bfg = null;
    const bcol = barSet.boss === 'default' ? '#ff7a4d' : barSet.boss === 'rainbow' ? 'rainbow' : BAR_COL[barSet.boss];
    if (barSet.boss === 'default') { bfg = ctx.createLinearGradient(bx, 0, bx + bw, 0); bfg.addColorStop(0, '#d81e3c'); bfg.addColorStop(1, '#ff7a4d'); }
    ctx.fillStyle = 'rgba(30,6,12,.95)'; ctx.fillRect(bx + 30, 77, bw - 40, 6);
    fillBar(ctx, bx + 30, 77, bw - 40, 6, 0.6, bcol, bfg);
    ctx.font = HF(800, 8); outlined(ctx, 'BOSS', bx + 30, 73, '#fff', 2.5);
    // Bottom block.
    const S = 50, GAP = 8, n = 4, groupW = S + GAP + n * S + (n - 1) * GAP, x0 = (VW - groupW) / 2;
    const XPH = Math.round(7 * barK('xpSize')), HPH = Math.round(13 * barK('hpSize'));
    const rowY = VH - XPH - 18 - S, hpY = rowY - 5 - 8 - HPH;
    ctx.fillStyle = INK; ctx.fillRect(0, VH - XPH - 2, VW, XPH + 2);
    ctx.fillStyle = 'rgba(20,40,90,.95)'; ctx.fillRect(0, VH - XPH, VW, XPH);
    let xpP = null;
    const xcol = barSet.xp === 'rainbow' ? 'rainbow' : barSet.xp === 'blue' ? '#3aa6ff' : BAR_COL[barSet.xp];
    if (barSet.xp === 'blue') { xpP = ctx.createLinearGradient(0, 0, VW, 0); xpP.addColorStop(0, '#2f8cff'); xpP.addColorStop(1, '#4fd1ff'); }
    fillBar(ctx, 0, VH - XPH, VW, XPH, 0.45, xcol, xpP, 40);
    bar(ctx, x0, hpY, groupW, HPH, 0.7, hpColor(barSet.hp, 0.7, '#5fc8ff'), 'rgba(60,12,20,.92)');
    if (barSet.hpNum !== 'off') {
      ctx.font = HF(800, Math.max(7, Math.min(11, HPH - 4))); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      outlined(ctx, barSet.hpNum === 'percent' ? '70%' : '140/200', x0 + groupW / 2, hpY + HPH / 2 + 1, '#fff', 2.5);
      ctx.textBaseline = 'alphabetic';
    }
    frame(ctx, x0, rowY, S, S, 6, 'rgba(18,34,74,.95)', '#5fc8ff');
    for (let i = 0; i < n; i++) frame(ctx, x0 + S + GAP + i * (S + GAP), rowY, S, S, 6, i === 0 ? 'rgba(30,60,40,.95)' : 'rgba(18,34,74,.95)', i === 0 ? '#5fe08a' : EDGE);
    ctx.restore();
    ctx.font = HF(800, 10); ctx.textAlign = 'right';
    outlined(ctx, `HUD size ${hudScale.toFixed(1)}x`, W - 6, 14, '#ffd23f', 3);
  }
  // A small minimap with one example of every marker that's switched on.
  function drawMapPreview(cv) {
    const g = cv.getContext('2d'), W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = ml('terrain') ? '#41604f' : '#26394a'; g.fillRect(0, 0, W, H);
    if (ml('terrain')) {
      g.fillStyle = '#2a3e33'; for (const [x, y, w, h] of [[10, 12, 30, 18], [110, 20, 26, 40], [30, 110, 40, 22]]) g.fillRect(x, y, w, h);
      g.fillStyle = '#3b77c9'; g.beginPath(); g.ellipse(120, 120, 28, 16, 0.4, 0, Math.PI * 2); g.fill();
    }
    if (ml('view')) { g.strokeStyle = '#fff'; g.lineWidth = 1; g.strokeRect(50.5, 58.5, 60, 44); }
    const dot = (x, y, r, fill, ring) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); if (ring) { g.lineWidth = 1.5; g.strokeStyle = ring; g.stroke(); } };
    const sq = (x, y, h, c) => { g.fillStyle = '#0b1838'; g.fillRect(x - h - 1, y - h - 1, 2 * h + 2, 2 * h + 2); g.fillStyle = c; g.fillRect(x - h, y - h, 2 * h, 2 * h); };
    const dia = (x, y, c) => { g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillStyle = c; g.strokeStyle = '#0b1838'; g.lineWidth = 1.5; g.fillRect(-3.5, -3.5, 7, 7); g.strokeRect(-3.5, -3.5, 7, 7); g.restore(); };
    if (ml('items')) { sq(40, 70, 2, '#5fe08a'); sq(122, 84, 2, '#ff9ed8'); }
    if (ml('chests')) { sq(96, 38, 3, '#c98a3c'); sq(28, 140, 4.5, '#ffd23f'); }
    if (ml('altars')) dia(138, 66, '#7fe0ff');
    if (ml('springs')) { dot(70, 130, 5.5, '#2fbf6a', '#fff'); g.fillStyle = '#fff'; g.fillRect(69, 126.5, 2, 7); g.fillRect(66.5, 129, 7, 2); }
    if (ml('enemies')) { g.fillStyle = '#ff5f6d'; for (const [x, y] of [[60, 50], [66, 96], [100, 70], [92, 104], [48, 90], [112, 52]]) g.fillRect(x - 1, y - 1, 2.5, 2.5); }
    if (ml('golden')) { g.beginPath(); g.arc(130, 140, 7, 0, Math.PI * 2); g.lineWidth = 1.5; g.strokeStyle = '#ffd23f'; g.stroke(); dot(130, 140, 3.5, '#ffd23f', '#0b1838'); }
    if (ml('shinies')) dot(20, 40, 4, '#7fe0ff', '#fff');
    if (ml('bosses')) dot(150, 20, 5, '#ff3048', '#fff');
    if (ml('rift')) { g.lineWidth = 2.5; g.strokeStyle = '#c47bff'; g.beginPath(); g.arc(10, 85, 5, 0, Math.PI * 2); g.stroke(); }
    if (ml('events')) dia(150, 110, '#ffd23f');
    if (ml('mates')) dot(104, 88, 4, '#ff8a96', '#0b1838');
    // You.
    g.save(); g.translate(80, 80); g.rotate(-0.4);
    g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -4.5); g.lineTo(-2, 0); g.lineTo(-4, 4.5); g.closePath();
    g.fillStyle = '#ffd23f'; g.fill(); g.restore();
  }
  // Your attack and a teammate's, at the chosen opacity and size.
  function drawFxPreview(cv) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, t = reduceMotion ? 0.5 : (performance.now() / 1000) % 1.2 / 1.2;
    previewGround(ctx, W, H);
    for (const [i, who, col, label] of [[0, 'me', '#5fe08a', 'You'], [1, 'mate', '#ff8ad8', 'Teammates']]) {
      const cx = W * (i ? 0.73 : 0.27), cy = H * 0.52, set = fxSet[who];
      ctx.save();
      ctx.globalAlpha = set.a;
      const r = (14 + t * 26) * set.s;
      ctx.lineWidth = 4 * set.s; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = col;
      for (let k = 0; k < 6; k++) { const a = k * 1.047 + t * 2; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, 3 * set.s, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      ctx.fillStyle = '#9be38f'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
      ctx.font = HF(800, 10); ctx.textAlign = 'center';
      outlined(ctx, `${label} · ${pct(set.a)} · ${pct(set.s)}`, cx, H - 8, '#fff', 3);
    }
  }
  // How much of the map you see compared with the game's default view.
  function drawFovPreview(cv) {
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    previewGround(ctx, W, H);
    const base = { w: W / 2.6, h: H / 2.6 };
    const cx = W / 2, cy = H / 2;
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.7)';
    ctx.strokeRect(cx - base.w / 2, cy - base.h / 2, base.w, base.h);
    ctx.setLineDash([]); ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffd23f';
    ctx.strokeRect(cx - base.w * fov / 2, cy - base.h * fov / 2, base.w * fov, base.h * fov);
    ctx.fillStyle = '#9be38f'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = HF(800, 10); ctx.textAlign = 'left';
    outlined(ctx, 'Default view', cx - base.w / 2 + 3, cy - base.h / 2 + 12, '#fff', 3);
    outlined(ctx, `Your view · ${fov.toFixed(1)}x`, Math.max(4, cx - base.w * fov / 2 + 4), Math.max(12, cy - base.h * fov / 2 + 13), '#ffd23f', 3);
  }
  const range = (key, val, min = 0, max = 100, stepV = 5) => `<div class="psx-range"><input type="range" min="${min}" max="${max}" step="${stepV}" value="${val}" data-pxr="${key}"><b class="psx-pct">${val}%</b></div>`;

  function statusHtml() {
    const rows = [...FEATURES.values()].filter((f) => f.key !== 'setup' && f.key !== 'healthCheck' && f.key !== 'previews' || f.status === 'broken');
    rows.sort((a, b) => (a.status === 'ok') - (b.status === 'ok') || a.label.localeCompare(b.label));
    const mark = (f) => f.status === 'ok' ? '<span class="ok">✓</span>' : f.status === 'pending' ? '<span class="wait">…</span>' : '<span class="bad">✗</span>';
    const off = rows.filter((f) => f.status === 'broken' || f.status === 'missing').length;
    return `<p class="sub" style="margin:0 0 4px">${off ? `${off} feature${off > 1 ? 's are' : ' is'} turned off, most likely because the game was updated. Everything else keeps working; an update of PokeSurvivor Plus will bring ${off > 1 ? 'them' : 'it'} back.` : 'Everything is working with this version of the game.'}</p>
      <div class="psx-status">${rows.map((f) => `${mark(f)}<div>${esc(f.label)}${f.status === 'broken' || f.status === 'missing' ? `<small>${esc(f.status === 'missing' ? 'Not found in this version of the game' : 'Stopped after errors')}${f.err ? ' · ' + esc(f.err) : ''}</small>` : ''}</div>`).join('')}</div>`;
  }

  function sectionHtml(tab) {
    if (tab === 'sound') {
      return `<h3 class="set-h">Music</h3>
        ${srow('More music', `New tracks in the game’s style: five more for the menu, four more for each area, five more for boss fights, two more for Arceus’s Judgment, and three for each family of rift arenas, picked at random as you move between them.${moreMusic && musicTrack ? `  Now playing: “${esc(TRACK_NAME[musicTrack] || musicTrack)}”.` : ''}`, sw('moremusic', moreMusic))}
        <h3 class="set-h">Alerts</h3>
        ${srow('Alert sound', 'A sparkle for shinies and a sound when a teammate goes down. Follows the effects volume above. Alt + B.', `<div class="psx-step">${sw('sound', alertSound)}<button class="btn small ghost" data-px="sound-test">Test</button></div>`)}`;
    }
    if (tab === 'gfx') {
      return `<h3 class="set-h">View</h3>
        ${srow('Field of view', 'Zooms the camera out to show more of the map. Alt + / Alt − / Alt 0.', step('fov', fov.toFixed(1) + 'x'))}
        <canvas class="psx-prev" id="psmod-fov-preview" width="440" height="150"></canvas>
        <h3 class="set-h">Attack effects</h3>
        <p class="sub" style="margin:0 0 4px">Only how they look: hit areas don't change.</p>
        <canvas class="psx-prev" id="psmod-fx-preview" width="440" height="130"></canvas>
        ${srow('Your attacks · opacity', '', step('fx:me:a', pct(fxSet.me.a)))}
        ${srow('Your attacks · size', '', step('fx:me:s', pct(fxSet.me.s)))}
        ${srow('Teammates’ attacks · opacity', '', step('fx:mate:a', pct(fxSet.mate.a)))}
        ${srow('Teammates’ attacks · size', '', step('fx:mate:s', pct(fxSet.mate.s)))}`;
    }
    if (tab === 'ctl') {
      const bindBtn = (id, i) => {
        const on = listening && listening[0] === id && listening[1] === i;
        return `<button class="btn small${on ? ' gold' : ''}" data-bind="${id}:${i}">${on ? 'Press…' : esc(keyName(binds[id][i]))}</button>`;
      };
      const gp = padOn ? activePad() : null;
      const padStatus = !padOn ? 'Controller support is off.'
        : gp ? `Connected: <span style="color:#fff">${esc(shortPadName(gp.id))}</span>${gp.mapping === 'standard' ? '' : ' (non-standard layout: rebind below if buttons seem wrong)'}.`
        : 'No controller detected. Plug it in or pair it, then press any button on it.';
      return `<h3 class="set-h">Controller</h3>
        ${srow('Controller support', padStatus, sw('pad', padOn))}
        ${srow('Rumble', 'Vibrate when you take damage.', sw('rumble', padRumble, !padOn))}
        ${srow('Button prompts', 'Which buttons the prompts show. Auto reads the controller’s name; a Steam Deck through Steam Input may report itself as an Xbox pad, so pick Steam Deck here if so.', '')}
        ${chips([['padstyle:auto', 'Auto' + (padStyleSet === 'auto' && padIndex != null ? ` (${({ xbox: 'Xbox', ps: 'PlayStation', nintendo: 'Nintendo', steam: 'Steam Deck' })[padStyle]})` : ''), padStyleSet === 'auto'], ['padstyle:xbox', 'Xbox', padStyleSet === 'xbox'], ['padstyle:ps', 'PlayStation', padStyleSet === 'ps'], ['padstyle:nintendo', 'Nintendo', padStyleSet === 'nintendo'], ['padstyle:steam', 'Steam Deck / Steam Controller', padStyleSet === 'steam']])}
        <p class="sub" style="margin:8px 0 0">In menus, the D-pad or left stick moves a yellow cursor, A selects and B goes back. The D-pad also moves you during a run.</p>
        <h3 class="set-h">Damage panel key</h3>
        ${srow('Tab (Select on controller)', 'Hold to show the damage panel, or press once to show and again to hide.', '')}
        ${chips([['pkey:hold', 'Hold to show', panelKey === 'hold'], ['pkey:toggle', 'Press to toggle', panelKey === 'toggle']])}
        <h3 class="set-h">Key and button bindings</h3>
        <p class="sub" style="margin-bottom:4px">Click a binding, then press a key, scroll the wheel, press a middle/side mouse button, or press a controller button / push a stick. Esc cancels, Backspace clears.</p>
        <table id="psmod-keys"><thead><tr><th>Action</th><th>Key</th><th>Alternate</th><th>Controller</th></tr></thead><tbody>${
          ACTIONS.map(([id, label]) => `<tr><td>${esc(label)}</td><td>${bindBtn(id, 0)}</td><td>${bindBtn(id, 1)}</td><td>${bindBtn(id, 2)}</td></tr>`).join('')
        }</tbody></table>
        <div class="psx-foot"><button class="btn small" data-px="keys-reset">Reset bindings</button><span class="sub" style="margin:0;font-size:13px">Arrow keys, the number pad and Esc keep working as in the game. Tab no longer cycles attacks.</span></div>`;
    }
    if (tab === 'psmod-hud') {
      return `<h3 class="set-h">HUD</h3>
        <canvas class="psx-prev" id="psmod-hud-preview" width="440" height="248"></canvas>
        ${srow('HUD style', 'The redesigned HUD, or the game’s original one. Touch screens always use the original.', '')}
        ${chips([['hudstyle:new', 'New', hudStyle === 'new'], ['hudstyle:classic', 'Classic', hudStyle === 'classic']])}
        ${srow('HUD size', 'Health, attacks, teammates and arrows.', step('hud', hudScale.toFixed(1) + 'x'))}
        <h3 class="set-h">Bars</h3>
        <canvas class="psx-prev" id="psmod-bar-preview" width="560" height="96"></canvas>
        ${srow('Your health · colour', '', '')}
        ${barChips('hp', ['red', 'green', 'orange', 'pink', 'cyan', 'purple', 'auto', 'rainbow'])}
        ${srow('Teammates’ health · colour', '', '')}
        ${barChips('mate', ['red', 'player', 'green', 'orange', 'pink', 'cyan', 'auto', 'rainbow'])}
        ${srow('Boss health · colour', '', '')}
        ${barChips('boss', ['default', 'red', 'orange', 'pink', 'purple', 'rainbow'])}
        ${srow('Experience · colour', '', '')}
        ${barChips('xp', ['blue', 'cyan', 'green', 'yellow', 'purple', 'pink', 'rainbow'])}
        ${srow('Style', 'For every bar in the new HUD.', '')}
        ${chips([['classic', 'Classic'], ['flat', 'Flat'], ['gradient', 'Gradient'], ['segmented', 'Segmented'], ['moving', 'Moving']].map(([v, l]) => ['bar:style:' + v, l, barSet.style === v]))}
        ${srow('Numbers on your health bar', '', '')}
        ${chips([['values', 'Health / max'], ['percent', 'Percent'], ['off', 'Off']].map(([v, l]) => ['bar:hpNum:' + v, l, barSet.hpNum === v]))}
        ${srow('Numbers on the experience bar', '', '')}
        ${chips([['off', 'Off'], ['percent', 'Percent'], ['level', 'Level and percent']].map(([v, l]) => ['bar:xpNum:' + v, l, barSet.xpNum === v]))}
        ${srow('Boss health percent', '', sw('bar:bossNum', barSet.bossNum))}
        ${srow('Health bar size', 'Yours and your teammates’.', '')}
        ${chips(['thin', 'normal', 'thick'].map((v) => ['bar:hpSize:' + v, cap(v), barSet.hpSize === v]))}
        ${srow('Experience bar size', '', '')}
        ${chips(['thin', 'normal', 'thick'].map((v) => ['bar:xpSize:' + v, cap(v), barSet.xpSize === v]))}
        <div class="psx-foot"><button class="btn small" data-px="bar-reset">Reset bars</button></div>
        <h3 class="set-h">Minimap</h3>
        ${srow('Minimap', 'Top-right map of the area around you. Drag it to move it, drag a corner to resize. Alt + N.', sw('map', mapShown))}
        ${mapShown ? `<div class="psx-prev-row"><canvas class="psx-prev" id="psmod-map-preview" width="160" height="160"></canvas>
          <div style="flex:1;min-width:200px">${srow('Minimap shows', 'Click to show or hide each kind of marker.', '')}
          ${chips(MAP_LAYERS.map(([k, label]) => ['ml:' + k, label, ml(k)]))}</div></div>` : ''}
        <h3 class="set-h">Panels and messages</h3>
        ${srow('Damage panel', 'Damage per player and per attack, plus your upgrades. Shown with Tab (see Controls). Alt + M turns it off.', sw('panel', shown))}
        ${srow('Always show the damage panel', 'Keep it on screen instead of using Tab.', sw('always', panelAlways, !shown))}
        <h3 class="set-h">Debug view</h3>
        ${srow('Player hitboxes', 'Where you (green) and teammates (blue) can be hit. Off by default.', sw('hitboxmine', hitboxMine))}
        ${srow('Enemy hitboxes', 'Where enemies (red) and bosses (orange) can be hit. Off by default.', sw('hitboxfoe', hitboxFoe))}
        ${srow('FPS counter', 'Frames per second in a small box you can drag anywhere (the game’s FPS setting, in Graphics).', sw('fpsbox', fpsWanted()))}`;
    }
    if (tab === 'psmod-notif') {
      const n = (k, title, desc) => srow(title, desc, sw('notif:' + k, notif[k]));
      return `<h3 class="set-h">Pop-ups</h3>
        ${n('shiny', 'Shiny appeared', 'A notice (and sparkle) when a shiny shows up, with where it is.')}
        ${n('down', 'Teammate down', 'A notice when someone in co-op goes down.')}
        ${n('records', 'New records', 'When a run beats one of your Pokémon’s records.')}
        ${n('conn', 'Connection', 'Lost and restored connections with teammates, and no internet.')}
        ${n('pad', 'Controller', 'Controller connected and disconnected.')}
        ${n('ach', 'Achievements', 'The game’s achievement pop-ups at the top of the screen.')}
        ${n('rank', 'Leaderboard records', 'The game’s notice when a run gets a new best on the leaderboard.')}
        ${n('np', 'Now playing', 'The song’s name at the bottom right of the main menu when a new one starts.')}
        <h3 class="set-h">Co-op</h3>
        ${srow('Pings', 'Show pings from teammates (and the ping wheel). Also in Settings → Extras.', sw('pings', pingsOn))}
        ${srow('Pings in the chat', 'A line in the chat for each teammate’s ping.', sw('pingchat', pingChat, !pingsOn))}
        ${srow('Ping sounds', 'A short sound for each ping.', sw('pingsound', pingSound, !pingsOn))}
        <h3 class="set-h">Messages in the middle of the screen</h3>
        ${BANNER_CATS.map(([k, t, d]) => srow(t, d, sw('ban:' + k, !!banSet[k]))).join('')}
        <p class="note">Co-op pause lines and the Arceus warning always show.</p>
        <h3 class="set-h">Arrows and tags</h3>
        ${n('mates', 'Teammate arrows', 'Arrows at the screen edge pointing to teammates out of view.')}
        ${n('bosses', 'Boss arrows', 'Arrows pointing to bosses and legendaries out of view.')}
        ${n('rift', 'Rifts', 'The arrow to an open rift, and the tag over its portal.')}
        ${n('thief', 'Treasure thieves', 'Meowth and Gholdengo tags and arrows.')}
        <p class="note">Arrows and tags are part of the redesigned HUD; with the classic HUD the game draws its own.</p>`;
    }
    if (tab === 'psmod-acc') {
      const lang = NS && NS.I18n ? NS.I18n.lang : 'en';
      const calm = !!(NS && NS.Settings && NS.Settings.get('calm'));
      const TYPE = (NS && NS.U && NS.U.TYPE_COLOR) || {};
      const sw8 = ['fire', 'water', 'grass', 'electric', 'psychic', 'poison', 'ice', 'dragon', 'fairy', 'ground'].filter((t) => TYPE[t]);
      return `<h3 class="set-h">Language</h3>
        <p class="sub" style="margin:0 0 4px">The game reloads when you change it.</p>
        <div class="chips set-chips" translate="no">${[['en', 'English'], ['es', 'Español']].map(([v, l]) => `<button class="chip${lang === v ? ' on' : ''}" data-px="lang:${v}">${l}</button>`).join('')}</div>
        <h3 class="set-h">Colour blind mode</h3>
        ${srow('Colour correction', 'Shifts the game’s colours so the ones you have trouble with are easier to tell apart. The swatches below change with it.', '')}
        ${chips([['cb:off', 'Off', cbMode === 'off'], ['cb:protan', 'Protanopia (red)', cbMode === 'protan'], ['cb:deutan', 'Deuteranopia (green)', cbMode === 'deutan'], ['cb:tritan', 'Tritanopia (blue)', cbMode === 'tritan']])}
        <div class="psx-swatches">${sw8.map((t) => `<i style="background:${TYPE[t]}">${cap(tr(t))}</i>`).join('')}<i style="background:#e83a4a;color:#fff">Health</i><i style="background:#46c96a">Heal</i><i style="background:#3aa6ff">Exp</i></div>
        ${cbMode !== 'off' ? srow('Strength', 'How far confusable colours are pushed apart. Reset is the tuned amount; go higher if some still look alike.', step('cbs', pct(cbStrength / CB_DEFAULT))) : ''}
        <h3 class="set-h">Motion</h3>
        ${srow('Less shake and flashes', 'The camera shakes less and flashes are softer (the game’s own setting).', sw('calm', calm))}
        ${srow('Fewer PokeSurvivor Plus animations', 'Rainbow and moving bars hold still, the logo stops glowing and previews stop moving.', sw('rmotion', reduceMotion))}`;
    }
    if (tab === 'psmod-extras') {
      return `<h3 class="set-h">Co-op</h3>
        ${srow('Spectate while down', 'Watch a teammate while you wait to be revived (switch with previous / next attack). Full view when the host also has PokeSurvivor Plus.', sw('spec', specOn))}
        ${srow('Pings', 'Hold G (R3 on a controller) for a wheel: Help, Boss, Chest, Here. Shown to teammates with PokeSurvivor Plus.', sw('pings', pingsOn))}
        ${pingsOn ? srow('Pings in the chat', 'A line in the chat for each teammate’s ping (“Mira: Help!”).', sw('pingchat', pingChat)) + srow('Ping sounds', 'A short sound for each ping, different for Help, Boss, Chest and Here.', sw('pingsound', pingSound)) : ''}
        ${srow('Chat sound', 'A short sound when you send a message.', sw('chatsound', chatSound))}
        ${srow('Chat during runs', 'The message box at the bottom left (Enter to write). The room chat always shows.', sw('chatshown', chatShown))}
        ${srow('Chat over heads', 'Messages also show in a bubble over the Pokémon of whoever wrote them, for a few seconds.', sw('chatbubbles', chatBubbles))}
        <h3 class="set-h">Endless</h3>
        <p class="sub">Start one with the purple <b>∞ Endless</b> button under Play (the gold Play button starts a normal run). Arceus’s Judgment doesn’t come at 30:00: the run goes on like before the Judgment existed (from minute 60 enemies toughen faster and faster), rifts keep opening and a boss comes every 3 minutes. Summon Arceus from the pause menu to end it (the host, in co-op). Endless runs never go on the leaderboard, don’t unlock achievements and don’t change your game stats (best time, best level…); coins and tickets as usual. Their records are in Stats.</p>
        <h3 class="set-h">Tier list</h3>
        ${srow('Tier letters', `S to D on the Pokémon screen and on each Pokémon’s page (also the “Tiers” button there). ${tierCredit()}.${tiersOn ? ' ' + tierStatusText() : ''}`, `<div class="psx-step">${sw('tiers', tiersOn)}${tiersOn ? '<button class="btn small ghost" data-px="tiers-refresh" title="Download the latest list now">Update</button>' : ''}</div>`)}
        <h3 class="set-h">Backup</h3>
        ${srow('Export settings', 'Saves every PokeSurvivor Plus setting, binding, favourite, record and run to a file.', '<button class="btn small" data-px="export">Export</button>')}
        ${srow('Import settings', 'Loads a file you exported. The page reloads to apply it.', '<button class="btn small" data-px="import">Import…</button>')}
        <h3 class="set-h">Status</h3>
        ${statusHtml()}
        <h3 class="set-h">Help</h3>
        <div class="psx-foot"><button class="btn small" data-px="tour">Replay the welcome tour</button><button class="btn small" data-px="news">What’s new in PokeSurvivor Plus</button></div>
        <p class="note">PokeSurvivor Plus ${esc(PLUS_VERSION)}. Alt + K opens the Controls tab.</p>
        <p class="note">Credits: HUD portraits from <a href="https://github.com/PMDCollab/SpriteCollab" target="_blank" rel="noopener">PMDCollab SpriteCollab</a> (CC BY-NC 4.0), like the game’s sprites. ${tierCredit()}.</p>`;
    }
    return '';
  }

  const currentGameTab = () => { const t = document.querySelector('#set-tabs .gen-tab.on'); return t ? t.dataset.t : null; };

  // Add (or redraw) our part of whichever game tab is showing.
  function injectSection() {
    if (!extrasBody || ourTab) return;
    const tab = currentGameTab();
    const old = document.getElementById('psmod-sec');
    if (!['sound', 'gfx', 'ctl'].includes(tab)) { if (old) old.remove(); if (extrasObs) extrasObs.takeRecords(); return; }
    if (tab === 'ctl') {
      // The game's "On PC" key list: our bindings table replaces it.
      for (const h of extrasBody.querySelectorAll('h3.set-h')) {
        if (!/\b(PC|pc)\b/.test(h.textContent)) continue;
        const next = h.nextElementSibling;
        if (next && next.classList.contains('keys')) next.remove();
        h.remove();
      }
    }
    if (tab === 'gfx') {
      // Language and "less shake" moved to Accessibility.
      const lang = extrasBody.querySelector('[data-lang]');
      if (lang) {
        const chipsEl = lang.closest('.chips'), h = chipsEl && chipsEl.previousElementSibling;
        if (h && h.classList.contains('sub')) { const h3 = h.previousElementSibling; if (h3 && h3.tagName === 'H3') h3.remove(); h.remove(); }
        else if (h && h.tagName === 'H3') h.remove();
        if (chipsEl) chipsEl.remove();
      }
      const calm = extrasBody.querySelector('[data-k="calm"]');
      if (calm && calm.closest('.set-row')) calm.closest('.set-row').remove();
    }
    const sec = old || document.createElement('div');
    sec.id = 'psmod-sec';
    sec.dataset.tab = tab;
    sec.innerHTML = sectionHtml(tab);
    if (!old) extrasBody.appendChild(sec);
    drawPreviews();
    if (extrasObs) extrasObs.takeRecords();
  }

  function renderExtras() {
    if (!extrasBody || !ourTab) return;
    const y = extrasBody.scrollTop;
    extrasBody.innerHTML = sectionHtml(ourTab);
    extrasBody.scrollTop = y;
    drawPreviews();
    if (extrasObs) extrasObs.takeRecords(); // our own redraw, not the game's
  }

  function onExtrasInput(e) {
    const r = e.target.closest && e.target.closest('input[data-pxr]');
    if (!r) return;
    const lab = r.parentElement.querySelector('.psx-pct');
    if (lab) lab.textContent = r.value + '%';
  }
  function onExtrasChange() { /* (sliders apply on input) */ }

  function onExtrasClick(e) {
    const b = e.target.closest('button');
    if (!b || !extrasBody.contains(b) || !settingsOpen()) return;
    if (!extrasVisible() && !b.closest('#psmod-sec')) return;
    b.blur(); // keep keyboard focus off buttons so the game keeps its keys
    if (b.dataset.bind) {
      const [id, slot] = b.dataset.bind.split(':');
      listening = [id, +slot];
      padPrev = new Set(padPrev); // the button that clicked this isn't a new press
      refreshExtras();
      return;
    }
    const act = b.dataset.px;
    if (!act) return;
    const parts = act.split(':');
    const [key, arg] = parts;
    const d = +parts[parts.length - 1];
    switch (key) {
      case 'fov': setFov(d === 0 ? 1 : fov + d * FOV_STEP); break;
      case 'hud': setHudScale(d === 0 ? 1 : hudScale + d * 0.1); break;
      case 'panel': shown = !shown; save('shown', shown); if (panel) render(); break;
      case 'always': panelAlways = !panelAlways; save('panelAlways', panelAlways); statsToggled = false; if (panel) render(); break;
      case 'pkey': panelKey = arg === 'toggle' ? 'toggle' : 'hold'; save('panelKey', panelKey); statsToggled = false; statsHeld = false; if (panel) render(); break;
      case 'hudstyle': hudStyle = arg === 'classic' ? 'classic' : 'new'; save('hudStyle', hudStyle); break;
      case 'map': mapShown = !mapShown; save('mapShown', mapShown); break;
      case 'sound': setAlertSound(!alertSound); break;
      case 'sound-test': { const was = alertSound; alertSound = true; sparkleAt = 0; sparkle(); alertSound = was; break; }
      case 'spec': specOn = !specOn; save('spectate', specOn); break;
      case 'pings': pingsOn = !pingsOn; save('pingsOn', pingsOn); break;
      case 'pingchat': pingChat = !pingChat; save('pingChat', pingChat); break;
      case 'pingsound': pingSound = !pingSound; save('pingSound', pingSound); if (pingSound) blip('here'); break;
      case 'chatsound': chatSound = !chatSound; save('chatSound', chatSound); if (chatSound) blip('send'); break;
      case 'chatshown': chatShown = !chatShown; save('chatShown', chatShown); break;
      case 'tiers': setTiersOn(!tiersOn); break;
      case 'tiers-refresh': loadTiers(true); break;
      case 'moremusic': moreMusic = !moreMusic; save('moreMusic', moreMusic); musicKey = null; musicTrack = null; break;
      case 'chatbubbles': chatBubbles = !chatBubbles; save('chatBubbles', chatBubbles); if (!chatBubbles) bubbles.clear(); break;
      case 'banners': bannersOn = !bannersOn; save('banners', bannersOn); break;
      case 'ban': if (arg in banSet || BANNER_CATS.some(([k]) => k === arg)) { banSet[arg] = !banSet[arg]; save('bannerSet', banSet); } break;
      case 'notif': notif[arg] = !notif[arg]; save('notif', notif); applyNotif(); break;
      case 'hitboxmine': hitboxMine = !hitboxMine; save('hitboxMine', hitboxMine); break;
      case 'hitboxfoe': hitboxFoe = !hitboxFoe; save('hitboxFoe', hitboxFoe); break;
      case 'fpsbox': setFpsWanted(!fpsWanted()); break;
      case 'cb': setCb(arg, cbStrength); break;
      case 'cbs': setCb(cbMode, d === 0 ? CB_DEFAULT : CB_DEFAULT * Math.max(0.2, Math.min(1.6, Math.round((cbStrength / CB_DEFAULT + d * 0.1) * 10) / 10))); break;
      case 'calm': if (NS && NS.Settings) NS.Settings.set('calm', !NS.Settings.get('calm')); break;
      case 'rmotion': reduceMotion = !reduceMotion; save('reduceMotion', reduceMotion); document.documentElement.classList.toggle('psmod-calm', reduceMotion); break;
      case 'lang': if (NS && NS.I18n && arg !== NS.I18n.lang) { NS.I18n.set(arg); return; } break;
      case 'fx': {
        const who = parts[1], what = parts[2];
        const lim = what === 'a' ? [0, 1] : [0.2, 1.5];
        fxSet[who][what] = d === 0 ? 1 : Math.max(lim[0], Math.min(lim[1], Math.round((fxSet[who][what] + d * 0.1) * 10) / 10));
        save('fx', fxSet);
        break;
      }
      case 'ml': mapLayers[arg] = !ml(arg); save('mapLayers', mapLayers); lastMapDraw = 0; break;
      case 'bar': {
        const which = parts[1];
        if (which === 'bossNum') barSet.bossNum = !barSet.bossNum;
        else if (which in BAR_DEF) barSet[which] = parts[2];
        save('bars', barSet);
        break;
      }
      case 'bar-reset': Object.assign(barSet, BAR_DEF); save('bars', barSet); break;
      case 'pad': padOn = !padOn; save('padOn', padOn); if (!padOn) { padReleaseAll(); navClear(); } syncChoiceLabels(); break;
      case 'rumble': padRumble = !padRumble; save('padRumble', padRumble); break;
      case 'padstyle': padStyleSet = PAD_LABELS[arg] || arg === 'auto' ? arg : 'auto'; save('padStyleSet', padStyleSet);
        { const gp = activePad(); padStyle = gp ? styleFor(gp.id) : padStyleSet !== 'auto' ? padStyleSet : 'xbox'; } break;
      case 'keys-reset': binds = defBinds(); save('keys', binds); rebuildBinds(); listening = null; break;
      case 'export': exportSettings(); return;
      case 'import': importSettings(); return;
      case 'tour': if (NS.SettingsUI) NS.SettingsUI.close(); setTimeout(() => startTour(true), 50); return;
      case 'news': openPlusNews(); return;
      default: return;
    }
    refreshExtras();
  }

  // ---- export / import
  function exportSettings() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS)) data[k.slice(LS.length)] = localStorage.getItem(k);
    }
    const file = { app: 'PokeSurvivor Plus', version: PLUS_VERSION, exported: new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pokesurvivor-plus-settings-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Settings exported', '#5fe08a', a.download);
  }
  function importSettings() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,application/json';
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      try {
        const file = JSON.parse(await f.text());
        if (!file || file.app !== 'PokeSurvivor Plus' || typeof file.data !== 'object') throw new Error('not a PokeSurvivor Plus settings file');
        const keys = Object.keys(file.data).filter((k) => /^[\w.:-]{1,60}$/.test(k) && typeof file.data[k] === 'string' && file.data[k].length < 2e6);
        if (!keys.length) throw new Error('the file is empty');
        for (const k of keys) { JSON.parse(file.data[k]); }          // every value must be valid
        for (const k of keys) localStorage.setItem(LS + k, file.data[k]);
        toast('Settings imported', '#5fe08a', `${keys.length} items from ${file.exported ? file.exported.slice(0, 10) : 'a file'} · reloading…`);
        setTimeout(() => location.reload(), 1500);
      } catch (err) {
        toast('Couldn’t import that file', '#ff8a96', String(err.message || err));
      }
    });
    inp.click();
  }

  // Alt + K: open Settings on the Controls tab (or close it if it's showing).
  // During a run the game is paused first, as its own Settings button needs.
  function toggleKeys() {
    const scr = document.getElementById('scr-settings');
    if (!scr) return;
    const ctlTab = () => document.querySelector('#set-tabs .gen-tab[data-t="ctl"]');
    if (!scr.classList.contains('hidden')) {
      if (currentGameTab() === 'ctl' && !ourTab) { const c = document.getElementById('set-close'); if (c) c.click(); }
      else if (ctlTab()) ctlTab().click();
      return;
    }
    const showCtl = () => { setupExtras(); if (ctlTab() && !scr.classList.contains('hidden')) ctlTab().click(); };
    const viaPause = () => {
      const b = document.getElementById('btn-pause-settings');
      if (b && navVisible(b)) { b.click(); setTimeout(showCtl, 30); return true; }
      return false;
    };
    if (viaPause()) return;
    if (NS && NS.Game && NS.Game.state === 'playing' && me()) {
      tapKey('Escape');
      setTimeout(viaPause, 80);
      return;
    }
    const item = [...document.querySelectorAll('#scr-menu .menu-item, #scr-menu button')]
      .find((b) => navVisible(b) && /settings|ajustes|configuraci/i.test(b.textContent));
    if (item) { item.click(); setTimeout(showCtl, 30); }
  }

  // ------------------------------------------------ event banners (off)
  // The game's messages in the middle of the screen. Kept: the co-op
  // "… is choosing" pause line, clearing a banner, and the Arceus warning.
  let bannersOn = load('banners', false);
  // The game's messages in the middle of the screen, by kind. (They're
  // matched on the game's own Spanish text, before it's translated.)
  const BANNER_CATS = [
    ['spawns', 'Wild Pokémon and bosses', '“Wild … appeared!”, a shiny nearby, Pokémon tides and enraged bosses.'],
    ['events', 'Events', 'Hordes, golden hour, lost Pokémon and treasure thieves.'],
    ['rift', 'Rifts and the Judgment', 'Entering and leaving a rift, its legendary, and Pokémon joining Arceus’s Judgment.'],
    ['place', 'Biome and weather', 'The biome’s name when you arrive, and weather changes.'],
    ['items', 'Items, powers and bonds', 'Held items, altar powers, healing springs and move bonds.'],
    ['catch', 'Pokémon caught', 'A Pokémon joining your team, and shinies you got.'],
    ['team', 'Teammate left', 'When someone leaves the co-op run.'],
  ];
  let banSet = load('bannerSet', null);
  if (!banSet || typeof banSet !== 'object') { banSet = {}; for (const [k] of BANNER_CATS) banSet[k] = bannersOn; }
  function bannerCat(t) {
    if (!t || /^Pausa|Huye de Arceus/.test(t)) return null;      // always shown
    if (/ha dejado la partida/.test(t)) return 'team';
    if (/grieta|Has vencido a|acude a la Sentencia/.test(t)) return 'rift';
    if (/^—.*—$/.test(t) || /^(Sol abrasador|Lluvia|Tormenta de arena|Nevada|Niebla)\b.*:/.test(t)) return 'place';
    if (/Horda|Hora dorada|se ha perdido|te sigue|llevado a|ticket ×10|cargado de monedas|Atrápalo|se ha escapado/.test(t)) return 'events';
    if (/Llevas|Ya llevas|^¡Poder|manantial|[Vv]ínculo/.test(t)) return 'items';
    if (/se une a tu equipo|te da las gracias|Has conseguido a|^¡Otro /.test(t)) return 'catch';
    return 'spawns';
  }
  function setupBanners() {
    const Sp = NS.Spawner, say = Sp.say, banner = Sp.banner;
    Sp.say = function (text) {
      const t = String(text || '');
      // While everyone is paused by PokeSurvivor Plus, our panel says so instead.
      if (t && cpView.on && /^Pausa/.test(t)) return;
      return say.apply(this, arguments);
    };
    // The HUD asks for the message each frame: hidden kinds come back empty.
    if (typeof banner === 'function') {
      Sp.banner = function () {
        const b = banner.apply(this, arguments);
        try { const c = b && bannerCat(String(b.text || '')); if (c && !banSet[c]) return null; } catch (_) { /* show it */ }
        return b;
      };
    }
  }
  waitFor(() => NS && NS.Spawner && NS.Spawner.say, setupBanners);
  // The game's "new best on the leaderboard" notice (Settings → Notifications).
  waitFor(() => NS && NS.UI && typeof NS.UI.toast === 'function', () => {
    const orig = NS.UI.toast;
    NS.UI.toast = function (text) {
      if (!notif.rank && /mejor marca .*ranking|new best .*leaderboard/i.test(String(text || ''))) return;
      return orig.apply(this, arguments);
    };
  }, 'notif');

  // ------------------------------------------------ colour blind filter
  // A colour correction over the whole page (daltonisation): what a given
  // kind of colour blindness can't see is moved into colours it can. The
  // simulation matrices are Machado et al. (2009) at full severity.
  // 1.0: a stronger correction, tuned on the game's own colours so the
  // pairs that get confused (health red / heal green, Fire / Grass,
  // Electric / Bug, Water / Grass, enemy / player hitboxes…) end up 3-5×
  // further apart for each kind of colour blindness, without pushing much
  // past what the screen can show.
  const CB_DEFAULT = 1;
  let cbMode = load('cbMode', 'off'), cbStrength = load('cbStrength', CB_DEFAULT);
  const CB_SIM = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
  };
  // How what's lost is moved into colours that can be seen: for red / green,
  // reds turn light and greens dark (plus a push towards blue); for blue /
  // yellow, the difference moves into red and green.
  const CB_SHIFT = {
    protan: [[0, 0, 0], [1.2, 1.2, 0], [1.2, 0, 1.2]],
    deutan: [[0, 0, 0], [1.68, 1.4, 0], [1.12, 0, 1.4]],
    tritan: [[1.4, 0, 0], [0, 1.4, 1.68], [0, 0, 0]],
  };
  function cbMatrix(mode, k) {
    const S = CB_SIM[mode], E = CB_SHIFT[mode], I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const D = I.map((r, i) => r.map((v, j) => v - S[i][j]));               // what's lost
    const M = I.map((r, i) => r.map((v, j) => v + E[i].reduce((n, e, t) => n + e * D[t][j], 0)));
    return I.map((r, i) => r.map((v, j) => v + k * (M[i][j] - v)));
  }
  function setCb(mode, k) {
    cbMode = CB_SIM[mode] ? mode : 'off';
    cbStrength = k;
    save('cbMode', cbMode); save('cbStrength', cbStrength);
    applyCb();
  }
  function applyCb() {
    if (!document.body) return;
    let svg = document.getElementById('psmod-cb-svg');
    if (cbMode === 'off') { document.documentElement.style.filter = ''; return; }
    if (!svg) {
      svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'psmod-cb-svg';
      svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
      svg.innerHTML = '<filter id="psmod-cb" color-interpolation-filters="sRGB"><feColorMatrix type="matrix"/></filter>';
      document.body.appendChild(svg);
    }
    const m = cbMatrix(cbMode, cbStrength);
    svg.querySelector('feColorMatrix').setAttribute('values', m.map((r) => r.map((v) => v.toFixed(4)).join(' ') + ' 0 0').join(' ') + ' 0 0 0 1 0');
    document.documentElement.style.filter = 'url(#psmod-cb)';
  }
  onReady(applyCb);

  // ------------------------------------------------ attack effect opacity / size
  // Separately for your attacks and your teammates'. Projectiles and orbs
  // know who fired them; melee arcs, beams, rings and sprites made while one
  // of your (or a teammate's) attacks is being cast are tagged as they're
  // created. Drawing then happens in groups, each with its own opacity and
  // size. Only the look changes: hit areas are computed elsewhere.
  let fxSet = load('fx', null);
  if (!fxSet || !fxSet.me || !fxSet.mate) fxSet = { me: { a: 1, s: 1 }, mate: { a: 1, s: 1 } };
  const fxDefault = () => fxSet.me.a === 1 && fxSet.me.s === 1 && fxSet.mate.a === 1 && fxSet.mate.s === 1;
  let fxOwner = null, fxScaleNow = 1;
  const fxArrays = new Set();
  const ALPHA = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'globalAlpha');
  // Every opacity the game sets while drawing a group is multiplied by `a`.
  function withAlpha(ctx, a, fn) {
    if (a >= 0.999) return fn();
    ctx.save();
    ALPHA.set.call(ctx, a);
    Object.defineProperty(ctx, 'globalAlpha', { configurable: true, get() { return ALPHA.get.call(this) / a; }, set(v) { ALPHA.set.call(this, Math.max(0, Math.min(1, v)) * a); } });
    try { fn(); } finally { delete ctx.globalAlpha; ctx.restore(); }
  }
  function setupFx() {
    const { Combat, FX, VFX, Projectiles } = NS;
    // Who is casting right now.
    const tick = Combat.tick;
    Combat.tick = function (dt, pl) { const was = fxOwner; fxOwner = pl && pl === me() ? 'me' : was; try { return tick.apply(this, arguments); } finally { fxOwner = was; } };
    const ghost = Combat.ghostCast;
    Combat.ghostCast = function () { const was = fxOwner; fxOwner = 'mate'; try { return ghost.apply(this, arguments); } finally { fxOwner = was; } };
    // Tag what the effect functions create while someone casts.
    const push = Array.prototype.push;
    for (const name of ['slash', 'beam', 'ring', 'burst', 'sp']) {
      const f = FX[name];
      if (typeof f !== 'function') continue;
      FX[name] = function () {
        if (!fxOwner) return f.apply(this, arguments);
        const own = fxOwner, sc = fxSet[own].s;
        Array.prototype.push = function (...items) {
          for (const o of items) {
            if (!o || typeof o !== 'object' || o.__own) continue;
            o.__own = own;
            if (sc !== 1) {
              if (typeof o.scale === 'number') o.scale *= sc;
              if (typeof o.arc === 'number' && typeof o.radius === 'number') o.radius *= sc;
              if (typeof o.width === 'number' && typeof o.len === 'number') o.width *= sc;
              if (typeof o.r1 === 'number') { o.r1 *= sc; o.r0 *= sc; }
            }
            fxArrays.add(this);
          }
          return push.apply(this, items);
        };
        try { return f.apply(this, arguments); } finally { Array.prototype.push = push; }
      };
    }
    // Sizes for projectiles and orbs.
    const vdraw = VFX.draw;
    VFX.draw = function (ctx, shape, pal, x, y, o) {
      if (fxScaleNow !== 1 && o) o = Object.assign({}, o, { scale: (o.scale || 1) * fxScaleNow });
      return vdraw.call(this, ctx, shape, pal, x, y, o);
    };
    // Draw in groups: everything else, then yours, then teammates'.
    const grouped = (arrays, ownerOf, draw, ctx) => {
      const saved = arrays.map((a) => a.slice());
      const fill = (who) => arrays.forEach((a, i) => { a.length = 0; for (const o of saved[i]) if (ownerOf(o) === who) a.push(o); });
      try {
        fill(null); draw();
        for (const who of ['me', 'mate']) {
          const st = fxSet[who];
          if (st.a <= 0.01) continue;
          fill(who);
          if (!arrays.some((a) => a.length)) continue;
          fxScaleNow = st.s;
          try { withAlpha(ctx, st.a, draw); } finally { fxScaleNow = 1; }
        }
      } finally { arrays.forEach((a, i) => { a.length = 0; push.apply(a, saved[i]); }); }
    };
    const pdraw = Projectiles.draw;
    Projectiles.draw = function (ctx) {
      if (fxDefault()) return pdraw.apply(this, arguments);
      const list = Projectiles.all();
      const self = me();
      const ownerOf = (p) => (!p.friendly && !p.orb) || !p.owner ? null : p.owner === self ? 'me' : 'mate';
      grouped([list], ownerOf, () => pdraw.call(this, ctx), ctx);
    };
    const fdraw = FX.draw;
    FX.draw = function (ctx) {
      if (fxDefault() || !fxArrays.size) return fdraw.apply(this, arguments);
      grouped([...fxArrays], (o) => o.__own || null, () => fdraw.call(this, ctx), ctx);
    };
  }
  waitFor(() => NS && NS.Combat && NS.Combat.ghostCast && NS.FX && NS.FX.draw && NS.VFX && NS.Projectiles && NS.Projectiles.draw, setupFx);

  // ------------------------------------------------ tier list badges
  // Letters from SurvivorTiers (survivortiers.pages.dev, a community tier list
  // by @fildotai): S, A, B, C, D on the Pokémon grid and on each Pokémon's
  // page. Off until switched on. The list is downloaded by the extension's
  // background worker (this page can't reach another site) and kept here for
  // a day; if it can't be reached, the last copy is used.
  const TIER_SITE = 'https://survivortiers.pages.dev/en/';
  const TIER_AUTHOR = '@fildotai', TIER_AUTHOR_URL = 'https://x.com/fildotai';
  const TIER_COL = { S: '#ff5c5c', A: '#ff9f43', B: '#ffd93d', C: '#6bcb77', D: '#4d96ff', E: '#9aa6b5', F: '#9aa6b5' };
  const TIER_INK = '#1b1528';
  const TIER_DAY = 24 * 3600e3;
  let tiersOn = load('tiersOn', false);
  let tierMap = null, tierTotal = 0, tierAt = 0, tierState = 'off'; // off | loading | ok | stale | failed
  let tierErr = '';
  let tierRedraw = () => {};
  const bridgeWait = new Map();
  let bridgeId = 0;
  addEventListener('message', (e) => {
    const d = e.source === window && e.data;
    if (!d || typeof d.psmodBridgeRes !== 'string' || !bridgeWait.has(d.id)) return;
    const w = bridgeWait.get(d.id);
    bridgeWait.delete(d.id);
    clearTimeout(w.t);
    w.ok(d.res);
  });
  // Ask the extension (keepalive.js → background.js) for something.
  function bridge(what, ms = 15000) {
    return new Promise((ok, bad) => {
      const id = 'b' + (++bridgeId) + '-' + Date.now();
      const t = setTimeout(() => { bridgeWait.delete(id); bad(new Error('no answer from the extension')); }, ms);
      bridgeWait.set(id, { ok, t });
      window.postMessage({ psmodBridge: what, id }, location.origin);
    });
  }
  function useTiers(rows, at) {
    tierMap = new Map();
    for (const r of rows) if (Array.isArray(r) && r.length >= 3) tierMap.set(+r[0], { rank: +r[1], tier: String(r[2]) });
    tierTotal = tierMap.size;
    tierAt = at || Date.now();
  }
  let tierLoading = null;
  function loadTiers(force) {
    if (tierLoading) return tierLoading;
    const cache = load('tierCache', null);
    if (!tierMap && cache && Array.isArray(cache.rows)) useTiers(cache.rows, cache.at);
    if (!force && tierMap && Date.now() - tierAt < TIER_DAY) { tierState = 'ok'; tierRedraw(); return Promise.resolve(); }
    tierState = tierMap ? 'stale' : 'loading';
    tierRedraw();
    tierLoading = bridge('tiers').then((res) => {
      if (!res || !res.ok || !Array.isArray(res.rows)) throw new Error((res && res.err) || 'bad answer');
      useTiers(res.rows, res.at);
      save('tierCache', { at: tierAt, rows: res.rows });
      tierState = 'ok'; tierErr = '';
    }).catch((err) => {
      tierErr = String((err && err.message) || err);
      tierState = tierMap ? 'stale' : 'failed';
      console.warn('[psmod] tier list:', tierErr);
      if (!tierMap && tiersOn) toast('Couldn’t load the tier list', '#ffcb3d', 'survivortiers.pages.dev didn’t answer. Try again later.');
    }).finally(() => { tierLoading = null; tierRedraw(); refreshExtras(); });
    return tierLoading;
  }
  function setTiersOn(on) {
    tiersOn = !!on;
    save('tiersOn', tiersOn);
    if (tiersOn) loadTiers(false); else tierState = 'off';
    tierRedraw();
    refreshExtras();
  }
  function tierStatusText() {
    const when = tierAt ? new Date(tierAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
    return tierState === 'loading' ? 'Loading…' : tierState === 'failed' ? `Couldn’t be reached${tierErr ? ' (' + esc(tierErr) + ')' : ''}.` : tierState === 'stale' ? `Using the copy from ${when}: couldn’t update.` : tierMap ? `${tierTotal} Pokémon, updated ${when}.` : '';
  }
  const tierOf = (dex) => (tiersOn && tierMap && tierMap.get(+dex)) || null;
  function tierBadge(t, cls = '') {
    return `<span class="psmod-tier ${cls}" style="--tc:${TIER_COL[t.tier] || '#9aa6b5'}" title="Tier ${esc(t.tier)} · rank ${t.rank} of ${tierTotal} (SurvivorTiers by ${TIER_AUTHOR})">${esc(t.tier)}</span>`;
  }
  const tierCredit = () => `Tier list: <a href="${TIER_SITE}" target="_blank" rel="noopener">SurvivorTiers</a> by <a href="${TIER_AUTHOR_URL}" target="_blank" rel="noopener">${TIER_AUTHOR}</a>`;
  function tierStyle() {
    if (document.getElementById('psmod-tier-css')) return;
    const st = document.createElement('style');
    st.id = 'psmod-tier-css';
    st.textContent = `
.psmod-tier{display:inline-grid;place-items:center;min-width:17px;height:17px;padding:0 3px;box-sizing:border-box;border-radius:5px;background:var(--tc);color:${TIER_INK};
  font:700 12px/1 var(--font,'Pixelify',system-ui,sans-serif);text-shadow:none;box-shadow:0 0 0 2px #0b1838;vertical-align:middle}
#dex-grid .psmod-tierb{position:absolute;bottom:6px;right:6px;z-index:1;min-width:16px;height:16px;font-size:11px;border-radius:5px}
#dex-grid .cell.locked .psmod-tierb{opacity:.85}
#dex-detail .psd-tierline{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted,#b9cbf0)}
#dex-detail .psd-tierline .psmod-tier{min-width:22px;height:22px;font-size:15px;border-radius:6px}
#dex-detail .psd-tierline b{color:#fff}
#psmod-tiers.on{border-color:var(--gold,#ffd23f);color:var(--gold,#ffd23f)}
#psmod-tiers .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:rgba(255,255,255,.3);vertical-align:1px}
#psmod-tiers.on .dot{background:#6bcb77;box-shadow:0 0 6px #6bcb77}
.psmod-tiercredit{font-size:11px;color:var(--muted,#b9cbf0);margin:6px 0 0;text-align:right}
.psmod-tiercredit a{color:inherit;text-decoration:underline}
.psmod-tiercredit a:hover{color:#fff}`;
    document.head.appendChild(st);
  }

  // ------------------------------------------------ Pokémon screen extras
  // A search box (looks through every region) and a link to the tier list.
  let dexApi = null; // set by the National tab code

  // ---- favourite Pokémon (kept in this browser)
  let favList = load('favs', []).filter((d) => Number.isInteger(d));
  const favShiny = load('favShiny', {});
  const isFav = (d) => favList.includes(+d);
  let favChanged = () => {};
  function setFav(d, on) {
    d = +d;
    favList = favList.filter((x) => x !== d);
    if (on) favList.push(d);
    save('favs', favList);
    favChanged();
  }
  const ownedFavs = () => { const o = (NS && NS.DB && NS.DB.save && NS.DB.save.owned) || {}; return favList.filter((d) => o[d]); };
  // ---- learnable moves on a Pokémon's page: one chip per move (icon, name,
  // type colour), the starting move first, then its own types, then Normal.
  // Hovering one shows the same card as the HUD's move tooltips.
  function moveListHtml(no) {
    const M = NS.Moves, mon = NS.DEX_BY && NS.DEX_BY[no];
    if (!M || !M.poolFor || !M.BY_ID || !mon) return null;
    const start = NS.startMoveOf ? NS.startMoveOf(no) : null;
    const ids = M.poolFor(mon).concat(start && M.BY_ID[start] ? [start] : []).filter((v, i, a) => a.indexOf(v) === i && M.BY_ID[v]);
    const banned = new Set(((NS.DB && NS.DB.save && NS.DB.save.pban) || {})[no] || []);
    const typeRank = (t) => { const i = (mon.types || []).indexOf(t); return i >= 0 ? i : t === 'normal' ? 9 : 5; };
    ids.sort((a, b) => (a === start ? -1 : b === start ? 1 : 0) || typeRank(M.BY_ID[a].type) - typeRank(M.BY_ID[b].type) || String(tr(M.BY_ID[a].name)).localeCompare(String(tr(M.BY_ID[b].name))));
    const TYPE = (NS.U && NS.U.TYPE_COLOR) || {};
    const icon = (id) => { try { return NS.Icons.html('move:' + id, 18); } catch { return ''; } };
    const html = `<div class="psd-moves">${ids.map((id) => {
      const d = M.BY_ID[id];
      return `<span class="psd-mv${id === start ? ' start' : ''}${banned.has(id) ? ' ban' : ''}" data-mv="${esc(id)}" data-dex="${no}" style="--mc:${esc(TYPE[d.type] || '#8fa3c4')}">${icon(id)}<span>${esc(tr(d.name))}</span>${id === start ? '<em>Start</em>' : ''}</span>`;
    }).join('')}</div>`;
    return { html, n: ids.length };
  }
  function catalogTip(id, no) {
    const M = NS.Moves, mon = (NS.DEX_BY && NS.DEX_BY[no]) || {};
    const m = M.instance ? M.instance(id, 1) : Object.assign({ lvl: 1, def: M.BY_ID[id] }, M.BY_ID[id]);
    let html = moveTip(m, { atk: mon.atk || 1, cdMul: 1 }).replace(/<span class="lv">Lv\. 1\/(\d+)<\/span>/, '<span class="lv">Max Lv. $1</span>');
    const start = NS.startMoveOf && NS.startMoveOf(no) === id;
    const banned = (((NS.DB && NS.DB.save && NS.DB.save.pban) || {})[no] || []).includes(id);
    if (start) html += '<div class="nx">Its starting move.</div>';
    if (banned) html += '<div class="nx" style="color:#ff8a8a">Vetoed: it won’t appear on your level-up cards.</div>';
    return html + '<div class="ds" style="margin:4px 0 0;color:#b9cbf0">Numbers at level 1, with its attack.</div>';
  }
  let mtipEl = null;
  function setupMoveTips() {
    if (mtipEl) return;
    mtipEl = document.createElement('div');
    mtipEl.id = 'psmod-mtip';
    mtipEl.hidden = true;
    document.body.appendChild(mtipEl);
    let cur = null;
    const place = (chip) => {
      const r = chip.getBoundingClientRect(), w = mtipEl.offsetWidth, h = mtipEl.offsetHeight;
      let x = r.left + r.width / 2 - w / 2, y = r.top - h - 8;
      if (y < 8) y = r.bottom + 8;
      x = Math.max(8, Math.min(innerWidth - w - 8, x));
      mtipEl.style.left = x + 'px'; mtipEl.style.top = Math.min(innerHeight - h - 8, y) + 'px';
    };
    const show = (chip) => {
      if (cur === chip) return;
      cur = chip;
      try { mtipEl.innerHTML = catalogTip(chip.dataset.mv, +chip.dataset.dex); } catch (err) { trip('moveList', err); return; }
      mtipEl.hidden = false;
      place(chip);
    };
    const hide = () => { cur = null; mtipEl.hidden = true; };
    document.addEventListener('pointerover', (e) => {
      const chip = e.target && e.target.closest && e.target.closest('.psd-mv[data-mv]');
      if (chip) show(chip); else if (cur) hide();
    }, true);
    // The controller cursor shows it too.
    setInterval(() => {
      const f = navFocus && navFocus.matches && navFocus.matches('.psd-mv[data-mv]') ? navFocus : null;
      if (f) show(f); else if (cur && !cur.matches(':hover')) hide();
      if (cur && !cur.isConnected) hide();
    }, 150);
    addEventListener('scroll', hide, true);
  }

  function setupDexExtras() {
    const SORTS = [['dex', 'Pokédex #'], ['az', 'A–Z'], ['hp', 'HP'], ['atk', 'Attack'], ['spd', 'Speed'], ['tier', 'Tier']];
    let sortKey = SORTS.some(([k]) => k === load('dexSort', 'dex')) ? load('dexSort', 'dex') : 'dex';
    let sortRev = !!load('dexSortRev', false);   // the other way round from the natural order
    const DIRS = { dex: ['1→966', '966→1'], az: ['A→Z', 'Z→A'], hp: ['high→low', 'low→high'], atk: ['high→low', 'low→high'], spd: ['high→low', 'low→high'], tier: ['best→worst', 'worst→best'] };
    const head = document.querySelector('#scr-dex .row.between');
    const grid = document.getElementById('dex-grid');
    if (!head || !grid || document.getElementById('psmod-dex-search')) return;
    const st = document.createElement('style');
    st.textContent = `
#psmod-dex-tools{display:flex;gap:8px;align-items:center;flex:1;justify-content:flex-end;margin:0 10px}
#psmod-dex-search{flex:0 1 220px;min-width:120px;padding:6px 10px;font:inherit;font-size:14px;color:#fff;background:rgba(0,0,0,.3);
  border:2px solid rgba(244,248,255,.35);border-radius:9px;outline:none}
#psmod-dex-search:focus{border-color:#ffd23f}
#psmod-dex-search::placeholder{color:#b9cbf0}
#psmod-dex-none{grid-column:1/-1;order:-1}
#psmod-sortwrap{position:relative;display:inline-block}
#psmod-sort{white-space:nowrap}
#psmod-sortpop{position:absolute;top:calc(100% + 6px);right:0;z-index:30;display:grid;gap:2px;min-width:170px;padding:6px;border-radius:10px;
  background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));border:2px solid var(--edge,#f4f8ff);box-shadow:0 0 0 2px var(--edge-out,#0b1838),0 8px 18px rgba(0,0,0,.4)}
#psmod-sortpop[hidden]{display:none}
#psmod-sortpop button{all:unset;cursor:pointer;padding:6px 10px;border-radius:7px;font-size:14px;color:#fff;text-shadow:2px 2px 0 var(--shadow,#0a1430)}
#psmod-sortpop button:hover,#psmod-sortpop button.psmod-padfocus{background:rgba(255,255,255,.1)}
#psmod-sortpop button.on{color:var(--gold,#ffd23f)}
#psmod-sortpop button.on::before{content:'✓ '}
#psmod-sortpop .psm-dir{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:4px;padding-top:6px;border-top:1px solid rgba(255,255,255,.18)}
#psmod-sortpop .psm-dir button{text-align:center;padding:5px 6px;font-size:13px;background:rgba(0,0,0,.25)}
#psmod-sortpop .psm-dir button.on{background:rgba(255,210,63,.18)}
#psmod-sortpop .psm-dir button.on::before{content:''}
/* The window keeps one size whichever Pokémon is picked: the grid and the
   page scroll inside it instead of the window growing or shrinking. */
@media (min-width:700px) and (min-height:500px){
#scr-dex > .box{height:100%;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden}
#scr-dex > .box > .split{flex:1 1 auto;min-height:0;align-items:stretch}
#scr-dex > .box > :not(.split){flex:0 0 auto}
#scr-dex #dex-gens{flex-wrap:wrap;overflow:visible}
#scr-dex #dex-gens .gen-tab{flex:1 0 auto}
#scr-dex > .box > .split > div:first-child{display:flex;flex-direction:column;min-height:0;min-width:0}
#scr-dex #dex-grid{flex:1 1 auto;min-height:0;max-height:none!important;overflow-y:auto;align-content:start}
#scr-dex #dex-detail{min-height:0;overflow-y:auto;overscroll-behavior:contain}
}
#dex-detail .psd-info h3{max-width:100%;min-width:0}
#dex-detail .psd-name{display:block;flex:1 1 auto;min-width:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1}
#dex-detail .psd-name.wrap{white-space:normal;overflow-wrap:normal;overflow:visible}
#dex-grid .cell{position:relative}
#dex-grid .psmod-favb{position:absolute;top:3px;right:4px;line-height:0;pointer-events:none}
#dex-grid .cell .badge-r ~ .psmod-favb{right:22px}
#psmod-favchip.on{border-color:var(--gold,#ffd23f);color:var(--gold,#ffd23f)}
#dex-detail .psd-head{display:grid;grid-template-columns:minmax(120px,44%) 1fr;gap:10px;align-items:center;margin-bottom:4px}
#dex-detail .psd-head canvas.stage{width:100%;height:auto;aspect-ratio:220/190;margin:0}
#dex-detail .psd-info{display:grid;gap:4px;justify-items:start;text-align:left;min-width:0}
#dex-detail .psd-info .center{text-align:left}
#dex-detail .psd-info h3{display:flex;align-items:center;gap:6px;margin:2px 0}
#dex-detail .psd-info .seg{margin:0}
#dex-detail .psd-segrow{grid-column:1/-1;display:flex;justify-content:center;width:100%;margin:0}
#dex-detail .psd-segrow .seg{margin:0;max-width:100%}
#dex-detail .psd-star{display:inline-grid;place-items:center;width:28px;height:28px;padding:0;border-radius:50%;background:rgba(0,0,0,.25);border:2px solid rgba(244,248,255,.3);cursor:pointer;flex:none}
#dex-detail .psd-star img{filter:grayscale(1) brightness(.75);opacity:.7;transition:transform .12s}
#dex-detail .psd-star:hover{border-color:var(--gold,#ffd23f)}
#dex-detail .psd-star.on{border-color:var(--gold,#ffd23f);background:rgba(255,210,63,.15)}
#dex-detail .psd-star.on img{filter:none;opacity:1;transform:scale(1.1)}
#dex-detail .psd-head,#dex-detail .psd-sec{align-self:stretch;width:100%;box-sizing:border-box}
#dex-detail .psd-sec{background:rgba(0,0,0,.2);border-radius:10px;padding:6px 10px 8px;margin:6px 0 0}
#dex-detail .psd-sec .stat{width:100%;margin:4px 0}
#dex-detail .psd-sec h4{margin:0 0 4px;font-size:13px;color:var(--gold,#ffd23f);letter-spacing:.04em}
#dex-detail .psd-sec p{margin:2px 0 4px}
#dex-detail .psd-mcount{font-size:11px;color:var(--muted,#b9cbf0);letter-spacing:0;font-weight:400;margin-left:4px}
#dex-detail .psd-moves{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
#dex-detail .psd-mv{display:inline-flex;align-items:center;gap:4px;padding:2px 7px 2px 3px;border-radius:7px;font-size:12px;line-height:1.2;cursor:help;
  background:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.12);border-left:3px solid var(--mc);white-space:nowrap}
#dex-detail .psd-mv:hover,#dex-detail .psd-mv.psmod-padfocus{background:rgba(255,255,255,.12);border-color:var(--mc)}
#dex-detail .psd-mv img{flex:none}
#dex-detail .psd-mv em{font-style:normal;font-size:10px;padding:0 4px;border-radius:5px;background:var(--gold,#ffd23f);color:#1a2a55;text-shadow:none}
#dex-detail .psd-mv.ban{opacity:.5;text-decoration:line-through}
#dex-detail .psd-upg{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;font-size:13px;margin-bottom:6px}
#dex-detail .psd-upg i{height:8px;background:rgba(0,0,0,.35);border-radius:6px;overflow:hidden}
#dex-detail .psd-upg em{display:block;height:100%;background:var(--gold,#ffd23f)}
#dex-detail .psd-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
#dex-detail .psd-tiles div{background:rgba(0,0,0,.25);border-radius:7px;padding:3px 7px}
#dex-detail .psd-tiles small{display:block;font-size:10px;color:var(--muted,#b9cbf0)}
#dex-detail .psd-tiles b{font-size:14px}
.psmod-favbtn{margin:2px 0 4px}
.psmod-favbtn.on{border-color:var(--gold,#ffd23f);color:var(--gold,#ffd23f)}`;
    document.head.appendChild(st);
    const tools = document.createElement('div');
    tools.id = 'psmod-dex-tools';
    tools.innerHTML = `<input id="psmod-dex-search" type="search" placeholder="Search Pokémon or #" spellcheck="false" autocomplete="off">
      <span id="psmod-sortwrap"><button class="btn small" id="psmod-sort" aria-haspopup="true" title="Sort the Pokémon"></button><span id="psmod-sortpop" hidden></span></span>
      <button class="btn small" id="psmod-tiers" aria-pressed="false"><span class="dot"></span>Tiers</button>`;
    head.insertBefore(tools, head.lastElementChild);
    const input = tools.querySelector('input');
    tierStyle();
    setupMoveTips();
    const tierBtn = tools.querySelector('#psmod-tiers');
    tierBtn.addEventListener('click', (e) => { e.stopPropagation(); tierBtn.blur(); NS.Audio && NS.Audio.sfx('click'); setTiersOn(!tiersOn); });
    // Sort: a small list under the button.
    const sortBtn = tools.querySelector('#psmod-sort'), sortPop = tools.querySelector('#psmod-sortpop');
    const drawSort = () => {
      sortBtn.textContent = `Sort: ${SORTS.find(([k]) => k === sortKey)[1]} · ${DIRS[sortKey][sortRev ? 1 : 0]} ▾`;
      sortPop.innerHTML = SORTS.map(([k, l]) => `<button type="button" data-s="${k}" class="${k === sortKey ? 'on' : ''}">${l}${k === 'tier' ? ' <small style="color:#b9cbf0">(SurvivorTiers)</small>' : ''}</button>`).join('')
        + `<div class="psm-dir">${DIRS[sortKey].map((d, i) => `<button type="button" data-d="${i}" class="${(i === 1) === sortRev ? 'on' : ''}">${d}</button>`).join('')}</div>`;
    };
    drawSort();
    const closeSort = () => { if (!sortPop.hidden) { sortPop.hidden = true; sortBtn.setAttribute('aria-expanded', 'false'); } };
    sortBtn.addEventListener('click', (e) => {
      e.stopPropagation(); sortBtn.blur();
      sortPop.hidden = !sortPop.hidden;
      sortBtn.setAttribute('aria-expanded', String(!sortPop.hidden));
      if (!sortPop.hidden && padMode) { const on = sortPop.querySelector('.on') || sortPop.firstElementChild; if (on) navSet(on); }
    });
    sortPop.addEventListener('click', (e) => {
      const d = e.target.closest('button[data-d]');
      if (d) {
        e.stopPropagation();
        sortRev = d.dataset.d === '1'; save('dexSortRev', sortRev);
        NS.Audio && NS.Audio.sfx('click');
        drawSort(); apply();
        if (padMode) { const on = sortPop.querySelector(`[data-d="${d.dataset.d}"]`); if (on) navSet(on); }
        return;
      }
      const b = e.target.closest('button[data-s]'); if (!b) return;
      e.stopPropagation();
      if (b.dataset.s !== sortKey) { sortRev = false; save('dexSortRev', false); }
      sortKey = b.dataset.s; save('dexSort', sortKey);
      NS.Audio && NS.Audio.sfx('click');
      if (sortKey === 'tier' && !tierMap) loadTiers(false);
      drawSort(); apply();
      if (padMode) { const on = sortPop.querySelector(`[data-s="${sortKey}"]`); if (on) navSet(on); }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('#psmod-sortwrap')) closeSort(); }, true);
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && !sortPop.hidden) { e.stopImmediatePropagation(); e.preventDefault(); closeSort(); } }, true);
    // Leaving the screen: search cleared, back to the National list with every filter off.
    const dexScr = document.getElementById('scr-dex');
    if (dexScr) new MutationObserver(() => {
      if (!dexScr.classList.contains('hidden')) return;
      closeSort();
      if (!input.value && !favOnly && fStatus === 'all' && !fRarity.size && dexApi && dexApi.isNational()) return;
      input.value = ''; favOnly = false; fStatus = 'all'; fRarity.clear();
      const fc = document.getElementById('psmod-favchip'); if (fc) fc.classList.remove('on');
      markChips();
      if (dexApi && !dexApi.isNational()) dexApi.setNational(true); else apply();
    }).observe(dexScr, { attributes: true, attributeFilter: ['class'] });
    // Credit under the grid while the letters are showing.
    const credit = document.createElement('p');
    credit.className = 'psmod-tiercredit';
    credit.id = 'psmod-tiercredit';
    credit.hidden = true;
    grid.after(credit);
    const byNo = () => new Map(((NS && NS.DEX) || []).map((p) => [p.dex, p]));
    let dex = null, favOnly = false;
    // Filters that combine: one "which" (all / owned / missing / shiny) plus
    // any number of rarities (Missing + Legendary + Epic…). The game's own
    // filter is kept on "All" and we hide cells ourselves.
    const FKEYS = ['all', 'own', 'miss', 'shiny', '5', '4', '3', '2', '1'];
    let fStatus = 'all';
    const fRarity = new Set();
    let fAdopted = false;
    const star = (n) => (NS.Icons ? NS.Icons.html('star', n) : '★');
    const apply = () => {
      const q = input.value.trim().toLowerCase();
      // "shiny" (or "shinies"): every Pokémon whose shiny you have.
      const qShiny = /^shin(y|ies)$/.test(q);
      dex = dex || byNo();
      let shown = 0;
      for (const cell of grid.querySelectorAll('.cell')) {
        const no = parseInt((cell.querySelector('.no') || {}).textContent, 10);
        const p = dex.get(no);
        const name = p ? String(tr(p.name)).toLowerCase() + ' ' + String(p.name).toLowerCase() : '';
        const fav = isFav(no);
        // Star on favourites.
        let fb = cell.querySelector('.psmod-favb');
        if (fav && !fb) { fb = document.createElement('span'); fb.className = 'psmod-favb'; fb.title = 'Favourite'; fb.innerHTML = star(12); cell.appendChild(fb); }
        else if (!fav && fb) fb.remove();
        const sv = (NS.DB && NS.DB.save) || {};
        const own = !!(sv.owned && sv.owned[no]), sh = !!(sv.shiny && sv.shiny[no]);
        const statusOk = fStatus === 'all' || (fStatus === 'own' ? own : fStatus === 'miss' ? !own : sh);
        const rarityOk = !fRarity.size || (p && fRarity.has(String(p.rarity)));
        const textOk = !q || (qShiny ? sh : /^#?\d+$/.test(q) ? String(no).padStart(3, '0').includes(q.replace('#', '')) : name.includes(q));
        const hit = textOk && (!favOnly || fav) && statusOk && rarityOk;
        cell.style.display = hit ? '' : 'none';
        // Looking for shinies: show them shiny.
        const cv = cell.querySelector('canvas');
        if (cv) spriteShiny(cv, sh && (fStatus === 'shiny' || qShiny));
        if (hit) shown++;
        // Tier letter (SurvivorTiers), top-left.
        const t = tierOf(no);
        let tb = cell.querySelector('.psmod-tierb');
        if (t && (!tb || tb.dataset.t !== t.tier)) { if (tb) tb.remove(); cell.insertAdjacentHTML('beforeend', tierBadge(t, 'psmod-tierb')); tb = cell.lastElementChild; tb.dataset.t = t.tier; }
        else if (!t && tb) tb.remove();
      }
      // Order (CSS order on the grid's cells, so the game's own list is untouched).
      try {
        const cells = [...grid.querySelectorAll('.cell')];
        if (sortKey === 'dex' && !sortRev) { for (const c of cells) if (c.style.order) c.style.order = ''; }
        else {
          const noOf = (c) => parseInt((c.querySelector('.no') || {}).textContent, 10);
          const val = (c) => {
            const no = noOf(c), p = dex.get(no) || {};
            if (sortKey === 'dex') return no;
            if (sortKey === 'az') return String(tr(p.name || '')).toLowerCase();
            if (sortKey === 'tier') { const t = tierMap && tierMap.get(no); return t ? t.rank : 1e6 + no; }
            return -(+p[sortKey] || 0);
          };
          const keyed = cells.map((c) => [c, val(c), noOf(c)]);
          keyed.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[2] - b[2]));
          if (sortRev) keyed.reverse();
          keyed.forEach(([c], i) => { if (c.style.order !== String(i)) c.style.order = String(i); });
        }
      } catch (err) { trip('setupDexSort', err); }
      let none = document.getElementById('psmod-dex-none');
      if ((q || favOnly || fStatus !== 'all' || fRarity.size) && !shown) {
        if (!none) { none = document.createElement('p'); none.id = 'psmod-dex-none'; none.className = 'sub'; grid.appendChild(none); }
        none.textContent = qShiny && !favOnly && fStatus === 'all' && !fRarity.size ? 'No shinies yet: shiny Pokémon come from the Gacha.'
          : q ? `No Pokémon match "${input.value.trim()}" with these filters.`
          : favOnly && fStatus === 'all' && !fRarity.size ? 'No favourites here yet: open a Pokémon you own and press “Favourite”.'
          : 'No Pokémon match these filters.';
      } else if (none) none.remove();
    };
    const syncTierUi = () => {
      tierBtn.classList.toggle('on', tiersOn);
      tierBtn.setAttribute('aria-pressed', tiersOn ? 'true' : 'false');
      tierBtn.title = tiersOn ? 'Hide tier letters' : `Show tier letters from the SurvivorTiers tier list by ${TIER_AUTHOR}`;
      credit.hidden = !tiersOn;
      if (tiersOn) {
        const when = tierAt ? new Date(tierAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
        const state = tierState === 'loading' ? ' · loading…' : tierState === 'failed' ? ' · couldn’t be reached, try again later' : tierState === 'stale' ? ` · copy from ${when} (couldn’t update)` : '';
        credit.innerHTML = tierCredit() + state;
      }
    };
    // Declared before the first redraw (which may run straight away when the
    // tier list is already saved).
    const detail = document.getElementById('dex-detail');
    tierRedraw = () => { try { syncTierUi(); apply(); syncDetailTier(); } catch (err) { trip('tiers', err); } };
    if (tiersOn) loadTiers(false);
    syncTierUi();
    // "Favourites" chip with the game's filters (it combines with them).
    const filters = document.getElementById('dex-filters');
    const addChip = () => {
      if (!filters || document.getElementById('psmod-favchip')) return;
      const c = document.createElement('button');
      c.id = 'psmod-favchip';
      c.className = 'chip' + (favOnly ? ' on' : '');
      c.innerHTML = `${star(12)} Favourites`;
      c.title = 'Only your favourite Pokémon, from every region';
      c.addEventListener('click', (e) => {
        e.stopPropagation();
        favOnly = !favOnly;
        c.classList.toggle('on', favOnly);
        c.blur();
        if (favOnly && dexApi && !dexApi.isNational()) dexApi.setNational(true);
        apply();
      });
      filters.prepend(c);
    };
    const gameChips = () => [...filters.querySelectorAll('.chip:not(#psmod-favchip)')];
    const keyOf = (chip) => FKEYS[gameChips().indexOf(chip)];
    // Show our selection on the game's chips (it redraws them often).
    const markChips = () => {
      if (!filters) return;
      const cs = gameChips();
      cs.forEach((c, i) => {
        const k = FKEYS[i];
        c.classList.toggle('on', k === 'all' ? fStatus === 'all' && !fRarity.size : /^\d$/.test(k) ? fRarity.has(k) : fStatus === k);
      });
    };
    // A fresh set of chips from the game shows the game's own filter: adopt
    // it the first time, then keep the game on "All" so every cell is there
    // for us to filter.
    const onGameChips = () => {
      const cs = gameChips();
      if (!cs.length || cs.every((c) => c.dataset.psm === '1')) return;
      const gameKey = FKEYS[cs.findIndex((c) => c.classList.contains('on'))] || 'all';
      cs.forEach((c) => { c.dataset.psm = '1'; });
      if (!fAdopted) { fAdopted = true; if (/^\d$/.test(gameKey)) fRarity.add(gameKey); else fStatus = gameKey; }
      if (gameKey !== 'all' && typeof cs[0].onclick === 'function') { cs[0].onclick(); return; }
      markChips();
      apply();
    };
    if (filters) {
      filters.addEventListener('click', (e) => {
        const c = e.target.closest('.chip');
        if (!c || c.id === 'psmod-favchip' || !filters.contains(c)) return;
        const k = keyOf(c);
        if (!k) return;
        e.stopPropagation(); e.preventDefault();
        c.blur();
        if (k === 'all') { fStatus = 'all'; fRarity.clear(); }
        else if (/^\d$/.test(k)) { if (fRarity.has(k)) fRarity.delete(k); else fRarity.add(k); }
        else fStatus = fStatus === k ? 'all' : k;
        NS.Audio && NS.Audio.sfx('click');
        markChips();
        apply();
      }, true);
      new MutationObserver(() => { addChip(); onGameChips(); }).observe(filters, { childList: true });
    }
    addChip();
    onGameChips();
    // "Favourite" button on the detail panel (Pokémon you own).
    // The detail panel, rearranged from the game's own pieces (so its buttons
    // keep working): sprite beside the name with a ★ favourite toggle, then
    // base stats, your stats and records with it, and its moves.
    const addFavBtn = () => {
      if (!detail || detail.querySelector('.psd-head')) return;
      try { restyleDetail(); } catch (err) { trip('setupDetail', err); }
    };
    const restyleDetail = () => {
      const center = detail.querySelector(':scope > .center');
      const stage = detail.querySelector(':scope > canvas.stage');
      const h = center && center.querySelector('h3');
      const noEl = center && center.querySelector(':scope > div');
      const no = noEl && parseInt((noEl.textContent.match(/\d+/) || [])[0], 10);
      if (!center || !stage || !h || !no) return;
      const owned = !!(NS.DB && NS.DB.save && NS.DB.save.owned && NS.DB.save.owned[no]);
      // The name in its own span, so a long one wraps or shrinks instead of pushing the ★ out.
      const nameText = [...h.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      if (nameText) {
        for (const n of [...h.childNodes]) if (n.nodeType === 3) n.remove();
        const nm = document.createElement('span');
        nm.className = 'psd-name';
        nm.textContent = nameText;
        nm.title = nameText;
        h.prepend(nm);
        // One line, shrinking to fit; only names with a space ("Iron
        // Valiant") may wrap, and only between words.
        const fit = () => {
          if (!nm.isConnected) return;
          nm.classList.remove('wrap'); nm.style.fontSize = '';
          const base = parseFloat(getComputedStyle(nm).fontSize) || 20;
          let fs = base;
          while (nm.scrollWidth > nm.clientWidth + 1 && fs > base * 0.5) { fs -= 1; nm.style.fontSize = fs + 'px'; }
          if (nm.scrollWidth > nm.clientWidth + 1 && /\s/.test(nameText)) { nm.style.fontSize = Math.round(base * 0.84) + 'px'; nm.classList.add('wrap'); }
        };
        requestAnimationFrame(fit);
        try { new ResizeObserver(() => requestAnimationFrame(fit)).observe(h); } catch (_) { /* no observer */ }
      }
      const head = document.createElement('div');
      head.className = 'psd-head';
      const info = document.createElement('div');
      info.className = 'psd-info';
      head.append(stage.cloneNode(false), info);
      // Keep the game's canvas (it's animated by the game): move it in.
      head.replaceChild(stage, head.firstChild);
      const seg = detail.querySelector(':scope > .seg');
      detail.insertBefore(head, detail.firstChild);
      info.appendChild(center);
      if (seg) { const row = document.createElement('div'); row.className = 'psd-segrow'; row.appendChild(seg); head.appendChild(row); }
      // ★ toggle next to the name.
      if (owned) {
        const b = document.createElement('button');
        b.className = 'psd-star';
        b.dataset.sfx = 'none';
        const draw = () => { const on = isFav(no); b.classList.toggle('on', on); b.innerHTML = star(16); b.title = on ? 'Favourite · click to remove' : 'Add to favourites (swap to it from the main menu)'; b.setAttribute('aria-pressed', on ? 'true' : 'false'); };
        draw();
        b.addEventListener('click', (e) => { e.stopPropagation(); b.blur(); setFav(no, !isFav(no)); NS.Audio && NS.Audio.sfx('select'); draw(); apply(); });
        h.appendChild(b);
      }
      syncDetailTier();
      // Sections.
      const sec = (title, cls) => { const d = document.createElement('div'); d.className = 'psd-sec ' + (cls || ''); d.innerHTML = `<h4>${title}</h4>`; return d; };
      const stats = [...detail.querySelectorAll(':scope > .stat')];
      if (stats.length) { const d = sec('Base stats', 'psd-base'); stats.forEach((x) => d.appendChild(x)); head.after(d); }
      if (owned) {
        const lv = upgTotal(no), max = upgMax() || 90, rec = recordsFor(no);
        const tile = (k, v) => `<div><small>${k}</small><b>${v}</b></div>`;
        const d = sec('You and ' + esc(tr(((NS.DEX_BY && NS.DEX_BY[no]) || {}).name || '')), 'you');
        d.insertAdjacentHTML('beforeend', `<div class="psd-upg"><span>Upgrades</span><i><em style="width:${Math.round(lv / max * 100)}%"></em></i><b>${lv} / ${max}</b></div>
          <div class="psd-tiles">${rec ? tile('Runs', fmt(rec.runs)) + tile('Longest run', clock(rec.time)) + tile('Highest level', rec.level) + tile('Most defeated', fmt(rec.kills)) + tile('Best damage/s', fmt(rec.dps)) + tile('Most damage', fmt(rec.dmg))
            : '<p class="sub" style="grid-column:1/-1;margin:0">No runs with it yet: your records will show here.</p>'}</div>`);
        (detail.querySelector('.psd-sec.psd-base') || head).after(d);
      }
      const startP = [...detail.querySelectorAll(':scope > p')].find((x) => !x.classList.contains('move-icons'));
      const icons = detail.querySelector(':scope > p.move-icons');
      if (startP || icons) {
        const d = sec('Moves', 'moves');
        if (startP) d.appendChild(startP);
        if (icons) d.appendChild(icons);
        // The icon row becomes a list of named chips, with details on hover.
        try {
          const list = moveListHtml(no);
          if (list && icons) { icons.hidden = true; icons.style.display = 'none'; d.querySelector('h4').innerHTML = `Moves <small class="psd-mcount">${list.n} it can learn · hover for details</small>`; d.insertAdjacentHTML('beforeend', list.html); }
        } catch (err) { trip('moveList', err); }
        (detail.querySelector('.psd-sec.you') || detail.querySelector('.psd-sec.psd-base') || head).after(d);
      }
    };
    // Tier letter and rank under the name (when the letters are on).
    function syncDetailTier() {
      const info = detail && detail.querySelector('.psd-info');
      if (!info) return;
      const noEl = info.querySelector('.center > div');
      const no = noEl && parseInt((noEl.textContent.match(/\d+/) || [])[0], 10);
      const t = no && tierOf(no);
      let line = info.querySelector('.psd-tierline');
      if (!t) { if (line) line.remove(); return; }
      if (!line) { line = document.createElement('div'); line.className = 'psd-tierline'; info.appendChild(line); }
      line.innerHTML = `${tierBadge(t)}<span>Rank <b>${t.rank}</b> of ${tierTotal} · <a href="${TIER_SITE}pokemon/?id=${no}" target="_blank" rel="noopener" title="Open its page on SurvivorTiers (by ${TIER_AUTHOR})" style="color:inherit">SurvivorTiers ↗</a></span>`;
    }
    if (detail) new MutationObserver(addFavBtn).observe(detail, { childList: true });
    addFavBtn();
    input.addEventListener('input', () => {
      // Searching looks through every region at once.
      if (input.value.trim() && dexApi && !dexApi.isNational()) dexApi.setNational(true);
      apply();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; apply(); } });
    new MutationObserver(() => apply()).observe(grid, { childList: true });
  }
  onReady(setupDexExtras);

  // ------------------------------------------------ favourites on the menu
  // ◀ ▶ beside your partner on the main menu swap between your favourites
  // (also Q / E or LB / RB, the previous / next attack bindings, while the
  // main menu is up). Each favourite remembers normal / shiny.
  function setupFavArrows() {
    const cv = document.getElementById('menu-partner');
    if (!cv || document.getElementById('psmod-favwrap')) return;
    const st = document.createElement('style');
    st.textContent = `
#psmod-favwrap{position:relative;display:inline-block;line-height:0}
#psmod-favwrap .psmod-favarr{position:absolute;top:50%;transform:translateY(-50%);min-width:40px;height:46px;padding:0 6px;font-size:18px;line-height:1;z-index:2;display:inline-flex;align-items:center;justify-content:center;gap:3px}
#psmod-favwrap .psmod-favarr.l{right:calc(100% + 10px)}#psmod-favwrap .psmod-favarr.r{left:calc(100% + 10px)}
#psmod-favwrap .psmod-favarr i{font-style:normal;font-size:20px;opacity:.8}
#psmod-favwrap .psmod-favarr kbd{font:inherit;font-size:16px;min-width:14px;text-align:center;border:0!important;background:none!important;box-shadow:none!important;padding:0!important;margin:0!important;color:#fff}
#psmod-favwrap .psmod-favarr .psmod-padkey{min-width:24px;height:24px;font-size:11px}
#psmod-favwrap[data-n="0"] .psmod-favarr{display:none}
#psmod-favcount{position:absolute;left:50%;bottom:0;transform:translate(-50%,50%);font-size:12px;line-height:1;padding:4px 10px 3px;border-radius:12px;
  background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));border:2px solid var(--gold,#ffd23f);box-shadow:0 0 0 2px var(--edge-out,#0b1838);color:var(--gold,#ffd23f);z-index:3;
  text-shadow:2px 2px 0 var(--shadow,#0a1430);white-space:nowrap;pointer-events:none}
#psmod-favwrap[data-n="0"] #psmod-favcount{display:none}
body:has(.scr.dim:not(.hidden)) #psmod-favwrap :is(.psmod-favarr,#psmod-favcount){visibility:hidden}
@media (max-height:520px){#psmod-favwrap .psmod-favarr{min-width:30px;height:34px;font-size:14px}}`;
    document.head.appendChild(st);
    const wrap = document.createElement('div');
    wrap.id = 'psmod-favwrap';
    cv.before(wrap);
    wrap.appendChild(cv);
    wrap.insertAdjacentHTML('beforeend', '<button class="btn small psmod-favarr l" data-sfx="none">◀</button><button class="btn small psmod-favarr r" data-sfx="none">▶</button><span id="psmod-favcount"></span>');
    const [left, right] = wrap.querySelectorAll('.psmod-favarr');
    const name = (d) => String(tr(((NS.DEX_BY && NS.DEX_BY[d]) || {}).name || ''));
    const neighbours = () => {
      const list = ownedFavs(), s = NS.DB && NS.DB.save;
      if (!list.length || !s) return null;
      const i = list.indexOf(s.partner);
      if (i < 0) return { list, i, prev: list[list.length - 1], next: list[0] };
      if (list.length < 2) return { list, i, prev: null, next: null };
      return { list, i, prev: list[(i - 1 + list.length) % list.length], next: list[(i + 1) % list.length] };
    };
    const sync = () => {
      const nb = neighbours(), s = NS.DB && NS.DB.save;
      // Remember the variant you last used for each favourite.
      if (s && isFav(s.partner) && favShiny[s.partner] !== !!s.partnerShiny) { favShiny[s.partner] = !!s.partnerShiny; save('favShiny', favShiny); }
      const usable = nb && (nb.prev || nb.next);
      wrap.dataset.n = usable ? nb.list.length : 0;
      if (!usable) return;
      left.disabled = !nb.prev; right.disabled = !nb.next;
      left.title = nb.prev ? 'Previous favourite: ' + name(nb.prev) : '';
      right.title = nb.next ? 'Next favourite: ' + name(nb.next) : '';
      document.getElementById('psmod-favcount').textContent = nb.i >= 0 ? `★ ${nb.i + 1} / ${nb.list.length}` : `★ ${nb.list.length} favourites`;
      // The arrows name the key or button that does the same.
      const pick = (id, pad) => (binds[id] || []).find((c) => (pad ? /^Pad\d/.test(c) : !/^(Pad|Axis|Wheel|Mouse)/.test(c)));
      const lab = (id, dflt) => {
        if (showPadLabels()) { const c = pick(id, true) || dflt; const L = padLook(c); return `<span class="psmod-padkey${padCls(L)}" style="--pk:${L.color}">${esc(L.label)}</span>`; }
        const c = pick(id, false);
        return c ? `<kbd>${esc(keyName(c))}</kbd>` : (id === 'prev' ? '◀' : '▶');
      };
      const lk = lab('prev', 'Pad4'), rk = lab('next', 'Pad5');
      if (left.dataset.k !== lk) { left.dataset.k = lk; left.innerHTML = `<i>‹</i>${lk}`; }
      if (right.dataset.k !== rk) { right.dataset.k = rk; right.innerHTML = `${rk}<i>›</i>`; }
    };
    const go = (dir) => {
      const nb = neighbours(), s = NS.DB && NS.DB.save;
      const d = nb && (dir < 0 ? nb.prev : nb.next);
      if (!d || !s) return;
      s.partner = d;
      s.partnerShiny = !!favShiny[d] && !!(NS.DB.ownsShiny && NS.DB.ownsShiny(d));
      NS.DB.commit();
      NS.Audio && NS.Audio.sfx('select');
      try { NS.Social && NS.Social.room && NS.Social.refreshMember && NS.Social.refreshMember(); } catch (_) { /* offline */ }
      NS.MenuUI.open();
      sync();
    };
    left.addEventListener('click', (e) => { e.stopPropagation(); left.blur(); go(-1); });
    right.addEventListener('click', (e) => { e.stopPropagation(); right.blur(); go(1); });
    favMenuGo = go;
    favChanged = sync;
    const scr = document.getElementById('scr-menu');
    setInterval(() => { if (scr && !scr.classList.contains('hidden')) sync(); }, 300);
    sync();
  }
  let favMenuGo = null;
  // Previous / next attack keys cycle favourites on the main menu.
  addEventListener('keydown', (e) => {
    if (!favMenuGo || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
    const scr = document.getElementById('scr-menu');
    const shown = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    if (!shown(scr) || [...document.querySelectorAll('.scr:not(.hidden):not(#scr-menu)')].some(shown)) return;
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && shown(ae)) return;
    const b = (id) => (binds[id] || []).slice(0, 2);
    if (b('prev').includes(e.code)) { favMenuGo(-1); e.preventDefault(); }
    else if (b('next').includes(e.code)) { favMenuGo(1); e.preventDefault(); }
  }, true);
  waitFor(() => NS && NS.MenuUI && NS.DB && document.getElementById('menu-partner'), setupFavArrows);

  // ------------------------------------------------ party on the main menu
  // When you're in a group (Friends → room), the members and the Pokémon each
  // one has picked, along the bottom of the main menu.
  function setupParty() {
    const scr = document.getElementById('scr-menu');
    if (!scr || document.getElementById('psmod-party')) return;
    const st = document.createElement('style');
    st.textContent = `
#psmod-party{margin-top:14px;max-width:100%;box-sizing:border-box;display:flex;gap:8px;align-items:stretch;padding:8px 10px;
  background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));border:3px solid var(--edge,#f4f8ff);border-radius:12px;
  box-shadow:0 0 0 3px var(--edge-out,#0b1838),inset 0 0 0 2px var(--edge-in,#5b83d6);text-shadow:2px 2px 0 var(--shadow,#0a1430);z-index:2}
#psmod-party[hidden]{display:none}
#psmod-party .pt{writing-mode:vertical-rl;transform:rotate(180deg);font-size:11px;letter-spacing:.12em;color:var(--gold,#ffd23f);font-weight:700;text-align:center}
#psmod-party .pms{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;min-width:0}
#psmod-party .pm{display:flex;gap:8px;align-items:center;padding:4px 10px 4px 4px;border-radius:9px;background:rgba(0,0,0,.25);min-width:140px}
#psmod-party .pm .lv{color:var(--gold,#ffd23f)}
@media (max-height:660px){#psmod-party{margin-top:6px;padding:5px 8px}#psmod-party .pm{min-width:0;padding:3px 8px 3px 3px}#psmod-party .pm img{width:30px;height:30px}#psmod-party .pm b{font-size:12px}#psmod-party .pm small{font-size:10px}}
@media (max-height:520px){#psmod-party{display:none}}
#psmod-party .pm img{width:40px;height:40px;image-rendering:pixelated;border:2px solid var(--edge,#f4f8ff);border-radius:6px;background:rgba(95,200,255,.25)}
#psmod-party .pm b{display:block;font-size:14px}
#psmod-party .pm small{display:block;font-size:12px;color:var(--muted,#b9cbf0)}
#psmod-party .pm.host b::after{content:' ★';color:var(--gold,#ffd23f)}`;
    document.head.appendChild(st);
    const box = document.createElement('div');
    box.id = 'psmod-party';
    box.hidden = true;
    // Under the partner, in the same column as the PokéSurvivor title.
    (scr.querySelector('.menu-left') || scr).appendChild(box);
    let sig = '', sentLvl = '';
    // Your Pokémon's upgrade level goes into your entry in the room, so
    // teammates with PokeSurvivor Plus can show it (players without it
    // just don't get a level).
    const shareLevel = (room) => {
      const fb = NS.DB && NS.DB.fb;
      if (!fb || !fb.rtdb || !fb.uid || !room) return;
      const mine = room.members.find((m) => m.uid === fb.uid);
      if (!mine) return;
      const lvl = upgTotal(mine.dex), key = room.id + '|' + mine.dex + '|' + lvl;
      if (mine.psl === lvl || sentLvl === key) return;
      sentLvl = key;
      fb.rtdb.ref('rooms/' + room.id + '/m/' + fb.uid).update({ psl: lvl }).catch(() => { sentLvl = ''; });
    };
    const draw = () => {
      const room = NS && NS.Social && NS.Social.room;
      const ms = (room && room.members) || [];
      if (room) { try { shareLevel(room); } catch (_) { /* offline */ } }
      const myUid = NS.DB && NS.DB.fb && NS.DB.fb.uid;
      const lvlOf = (m) => (m.uid === myUid ? upgTotal(m.dex) : typeof m.psl === 'number' ? m.psl : null);
      const s = JSON.stringify(ms.map((m) => [m.uid, m.name, m.dex, m.shiny, lvlOf(m), room.host]));
      if (s === sig) return;
      sig = s;
      box.hidden = !ms.length;
      if (!ms.length) return;
      const max = upgMax();
      box.innerHTML = '<div class="pt">PARTY</div><div class="pms">' + ms.map((m) => {
        const mon = (NS.DEX_BY && NS.DEX_BY[m.dex]) || {};
        const src = PORTRAIT_BASE + String(m.dex || 0).padStart(4, '0') + (m.shiny ? '/0000/0001' : '') + '/Normal.png';
        const lvl = lvlOf(m);
        const lv = lvl == null ? '' : ` · <span class="lv" title="Upgrade level ${lvl} / ${max}">Lv. ${lvl}</span>`;
        return `<div class="pm${m.uid === room.host ? ' host' : ''}"><img src="${src}" alt="" data-dex="${m.dex}" translate="no">
          <div><b translate="no">${esc(m.name || '?')}</b><small>${esc(tr(mon.name || '—'))}${m.shiny ? ' ✦' : ''}${lv}</small></div></div>`;
      }).join('') + '</div>';
      // Shiny portrait missing → the normal one.
      for (const img of box.querySelectorAll('img')) img.onerror = () => { const d = String(img.dataset.dex).padStart(4, '0'); if (!img.dataset.f) { img.dataset.f = 1; img.src = PORTRAIT_BASE + d + '/Normal.png'; } };
    };
    setInterval(() => { if (!scr.classList.contains('hidden')) draw(); }, 1000);
    waitFor(() => NS && NS.Social && NS.Social.on, function partyLevels() { NS.Social.on(() => draw()); });
    draw();
  }
  onReady(setupParty);

  // ------------------------------------------------ room on the main menu
  // The game's separate room ("lobby") screen is skipped: while you're in a
  // room, the main menu shows the party, the room's status and its chat
  // under your partner, and Play starts the co-op run straight away (host),
  // or says who you're waiting for (guest). Invite and Leave sit with it.
  function setupLobbyMenu() {
    const L = NS.LobbyUI, S = NS.Social;
    const left = document.querySelector('#scr-menu .menu-left');
    const play = document.querySelector('#scr-menu [data-go="play"]');
    if (!L || !S || !left || !play || L.__psm) return;
    L.__psm = true;
    const st = document.createElement('style');
    st.textContent = `
#psmod-roombar{margin-top:8px;width:min(580px,100%);box-sizing:border-box;display:grid;gap:6px;padding:8px 10px;
  background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));border:3px solid var(--edge,#f4f8ff);border-radius:12px;
  box-shadow:0 0 0 3px var(--edge-out,#0b1838),inset 0 0 0 2px var(--edge-in,#5b83d6);text-shadow:2px 2px 0 var(--shadow,#0a1430)}
#psmod-roombar[hidden]{display:none}
#psmod-roombar .rb-top{display:flex;gap:6px;align-items:center}
#psmod-roombar .rb-st{flex:1;font-size:12px;color:var(--muted,#b9cbf0);min-width:0}
#psmod-roombar .rb-st.warn{color:#ffcb3d}
#psmod-roombar #psmod-lchat{margin:0}
#psmod-roombar #psmod-lchat .log{height:84px;font-size:13px}
#psmod-roombar #psmod-lchat .note2{display:none}
#scr-menu.psm-room #psmod-party{margin-top:8px}
#scr-menu.psm-room .partner-card{margin-top:4px}`;
    document.head.appendChild(st);
    const bar = document.createElement('div');
    bar.id = 'psmod-roombar';
    bar.hidden = true;
    bar.innerHTML = '<div class="rb-top"><span class="rb-st"></span><button class="btn small" data-a="invite">Invite</button><button class="btn small ghost" data-a="leave">Leave room</button></div>';
    left.appendChild(bar);
    const status = bar.querySelector('.rb-st');
    bar.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-a]'); if (!b) return;
      e.stopPropagation(); b.blur();
      if (b.dataset.a === 'invite') NS.FriendsUI.open();
      if (b.dataset.a === 'leave') { try { await S.leaveRoom(); } catch (_) { /* gone */ } try { NS.Net.close(); } catch (_) { /* closed */ } NS.MenuUI.open(); draw(); }
    });
    // The room screen → the main menu.
    L.open = function () {
      if (!S.room) { NS.MenuUI.open(); return; }
      try { S.refreshMember(); S.refreshPresence(); } catch (_) { /* offline */ }
      NS.MenuUI.open();
      draw();
    };
    const state = () => {
      const room = S.room;
      if (!room) return null;
      const ms = room.members || [];
      const host = ms.find((m) => m.uid === room.host) || {};
      const others = ms.filter((m) => m.uid !== room.host);
      const mode = (u) => { try { return NS.Net.mode(u); } catch { return 'direct'; } };
      const connecting = room.isHost ? others.filter((m) => mode(m.uid) === 'connecting') : [];
      const failed = room.isHost ? others.filter((m) => mode(m.uid) === 'failed') : [];
      return { room, ms, host, connecting, failed };
    };
    function draw() {
      const s = state();
      const scr = document.getElementById('scr-menu');
      scr.classList.toggle('psm-room', !!s);
      bar.hidden = !s;
      const sub = play.querySelector('small');
      play.classList.toggle('psm-wait', !!s && !s.room.isHost);
      if (!s) { if (sub && sub.textContent !== PLAY_SUB) sub.textContent = PLAY_SUB; return; }
      // The chat lives here while you're in a room.
      const chat = document.getElementById('psmod-lchat');
      if (chat && chat.parentElement !== bar) bar.appendChild(chat);
      const n = s.ms.length, max = S.MAX_PLAYERS || 4;
      let txt, warn = false;
      if (!s.room.isHost) txt = `In ${s.host.name || '…'}’s room · the host starts the run`;
      else if (n < 2) txt = 'Your room · invite friends to play together';
      else if (s.failed.length) { txt = `Can’t connect to ${s.failed.map((m) => m.name).join(', ')} · retrying`; warn = true; }
      else if (s.connecting.length) { txt = `Connecting to ${s.connecting.map((m) => m.name).join(', ')}…`; warn = true; }
      else txt = `Your room · ${n}/${max} ready`;
      if (status.textContent !== txt) status.textContent = txt;
      status.classList.toggle('warn', warn);
      bar.querySelector('[data-a="invite"]').hidden = !s.room.isHost || n >= max;
      const want = !s.room.isHost ? `Waiting for ${s.host.name || 'the host'} to start` : n < 2 ? 'Play solo (leaves the room)' : `Start the co-op run (${n}/${max})`;
      if (sub && sub.textContent !== want) sub.textContent = want;
    }
    // Play: start right here.
    play.addEventListener('click', async (e) => {
      const s = state();
      if (!s) return;               // not in a room: the game's own Play
      e.stopImmediatePropagation(); e.preventDefault(); play.blur();
      if (!s.room.isHost) { NS.UI.toast && NS.UI.toast(`Waiting for ${s.host.name || 'the host'} to start the run`); return; }
      if (s.ms.length < 2) {
        try { await S.leaveRoom(); } catch (_) { /* gone */ } try { NS.Net.close(); } catch (_) { /* closed */ }
        NS.Flow.play();
        return;
      }
      if (s.connecting.length || s.failed.length) { NS.UI.toast && NS.UI.toast(s.failed.length ? 'Can’t connect to everyone yet: retrying' : 'Still connecting to your friends…'); return; }
      const cfg = { k: 'start', seed: Math.floor(Math.random() * 1e6), host: s.room.host,
        members: s.ms.map((m) => ({ uid: m.uid, name: m.name, dex: m.dex, shiny: !!m.shiny })) };
      try { S.setOpen(false); } catch (_) { /* offline */ }
      NS.Net.broadcast(cfg);
      NS.Flow.startCoop(cfg);
    }, true);
    S.on(() => draw());
    setInterval(() => { const scr = document.getElementById('scr-menu'); if (scr && !scr.classList.contains('hidden')) draw(); }, 700);
    // Anything that still opens the room screen goes to the menu instead.
    const lobby = document.getElementById('scr-lobby');
    if (lobby) new MutationObserver(() => { if (!lobby.classList.contains('hidden')) { lobby.classList.add('hidden'); L.open(); } }).observe(lobby, { attributes: true, attributeFilter: ['class'] });
    draw();
  }
  waitFor(() => NS && NS.LobbyUI && NS.Social && NS.Flow && NS.MenuUI && document.querySelector('#scr-menu [data-go="play"]') && document.getElementById('psmod-party'), setupLobbyMenu);

  // ------------------------------------------------ splash text
  // Under the logo, instead of "Mystery Dungeon": one of these, picked each
  // time the main menu opens, gently pulsing (like Minecraft's).
  const SPLASH = ["Gotta catch 'em all!", "Future Pokémon Master!", "Now with 100% more Pokémon!", "It's super effective!", "It's not very effective…", "A wild player appeared!", "Bag full of Potions!", "Don't forget your Repel!", "Pikachu, I choose you!", "Professor's orders: survive!", "*Surprised Pikachu face*", "Hey guys, did you know Vaporeon is…", "Magikarp used Splash! Nothing happened.", "Psyduck has a headache.", "Snorlax is blocking the menu.", "Ditto was here.", "Slowpoke is still loading…", "Jigglypuff put the menu to sleep.", "Bidoof is fine. Bidoof is always fine.", "Metapod used Harden! And again!", "Sudowoodo is definitely a tree.", "Wobbuffet!", "Who's that Pokémon?", "It's a Clefairy. It's always a Clefairy.", "Shiny hunting since forever.", "1 in 4,096 and still waiting.", "This one is shiny, trust me.", "Just one more run.", "Okay, ONE more run.", "Ten more minutes, Mom!", "Dodge, dodge, dodge!", "The hordes are getting bigger.", "Arceus is watching.", "Rifts smell like ozone.", "Meowth, that's right!", "Gholdengo pays in tickets.", "Collect them. Upgrade them. Survive.", "Level up! Level up!", "Pick the shiny card.", "Your partner believes in you.", "Partner power!", "Mystery Dungeon, mysterious menu.", "Also try fishing!", "Trainer, your Pokémon looks hungry.", "Berries not included.", "Contains no Missingno.", "No Rattatas in the top percentage.", "Youngster Joey approved!", "My Rattata is different.", "The tall grass is calling.", "Remember to save!", "PC storage: full.", "Bulbasaur deserves better.", "Team Rocket blasting off again!", "Prepare for trouble!", "Make it double!", "Wild Zubat appeared! Again.", "Zubat again?!", "Geodude blocks the path.", "Onix is just a big rock snake.", "Charizard won't listen.", "Squirtle Squad, assemble!", "Eevee can't decide.", "Gengar is behind you.", "Mimikyu just wants a friend.", "Lucario knows aura.", "Mewtwo is not impressed.", "Mew is under the truck.", "Dragonite delivers mail.", "Ralts is shy.", "Garchomp goes fast.", "Torchic is a chicken. Respect it.", "Pachirisu: tournament legend.", "Smeargle painted this menu.", "Spinda is never the same twice.", "Unown spells it out.", "Lapras ferry service.", "Slakoth is on break.", "Ferrothorn says no touching.", "Kecleon hides in plain sight.", "Wooper looks happy.", "Rowlet is a bowl of rice.", "Wailord is very big.", "Skitty is chasing its tail.", "Now in your browser!", "Free to play, free to dodge.", "Press Play, Trainer!", "Hold Tab for the numbers!", "Ping the boss!", "Pause for everyone!", "Chat goes over heads now!", "Plus means more!", "Powered by fan love.", "Sprites by amazing artists!", "Plays great with a controller!", "Over 900 Pokémon to collect!", "Ninety upgrade levels!", "Mind the big chests!", "Thief! Catch it!", "Legendary rifts ahead!", "Can you survive 30 minutes?", "Biomes change every four minutes!", "Watch your health bar!", "Healing puddles save lives!"];
  let splashLast = -1;
  function setupSplash() {
    const t2 = document.querySelector('#scr-menu .logo .t2');
    const scr = document.getElementById('scr-menu');
    if (!t2 || !scr || t2.dataset.psm) return;
    t2.dataset.psm = '1';
    const st = document.createElement('style');
    st.textContent = `
#scr-menu .logo .t2.psmod-splash{display:inline-block;max-width:min(620px,92%);margin:8px auto 0;font-size:clamp(13px,2.6vh,23px);color:#ffe066;letter-spacing:.5px;text-transform:none;
  font-weight:700;line-height:1.2;text-shadow:2px 2px 0 var(--shadow,#0a1430);transform-origin:center;animation:psmodSplash 1.1s ease-in-out infinite alternate}
#scr-menu .logo .t2.psmod-splash.long{font-size:clamp(12px,2.2vh,19px)}
#scr-menu .logo .t2.psmod-splash.xlong{font-size:clamp(11px,1.9vh,17px)}
@keyframes psmodSplash{from{transform:scale(1)}to{transform:scale(1.07)}}
html.psmod-calm #scr-menu .logo .t2.psmod-splash{animation:none}
@media (prefers-reduced-motion:reduce){#scr-menu .logo .t2.psmod-splash{animation:none}}`;
    document.head.appendChild(st);
    t2.classList.add('psmod-splash');
    t2.setAttribute('translate', 'no');
    const pick = () => {
      let i = Math.floor(Math.random() * SPLASH.length);
      if (i === splashLast) i = (i + 1) % SPLASH.length;
      splashLast = i;
      const txt = SPLASH[i];
      t2.textContent = txt;
      t2.classList.toggle('long', txt.length > 28);
      t2.classList.toggle('xlong', txt.length > 38);
    };
    pick();
    let was = scr.classList.contains('hidden');
    new MutationObserver(() => { const h = scr.classList.contains('hidden'); if (was && !h) pick(); was = h; }).observe(scr, { attributes: true, attributeFilter: ['class'] });
    t2.style.cursor = 'pointer';
    t2.title = 'Click for another one';
    t2.addEventListener('click', (e) => { e.stopPropagation(); pick(); });
  }
  onReady(setupSplash);

  // ------------------------------------------------------- logo ⁺
  // A glowing superscript plus after "PokéSurvivor" on the main menu: the
  // sign that PokeSurvivor Plus is loaded.
  function setupLogoPlus() {
    const t1 = document.querySelector('#scr-menu .logo .t1');
    if (!t1 || document.getElementById('psmod-plus')) return;
    const st = document.createElement('style');
    st.textContent = `
#psmod-plus{display:inline-block;font-size:.72em;font-weight:700;line-height:0;vertical-align:.62em;margin-left:-.1em;color:#fff3b0;-webkit-text-stroke:1px #ffd23f;
  text-shadow:3px 3px 0 var(--shadow,#0a1430),0 0 6px #ffd23f,0 0 14px #ffb300;animation:psmodPlus 1.8s ease-in-out infinite alternate;cursor:default}
@keyframes psmodPlus{from{text-shadow:3px 3px 0 var(--shadow,#0a1430),0 0 4px #ffd23f,0 0 8px rgba(255,179,0,.6);filter:brightness(1)}
  to{text-shadow:3px 3px 0 var(--shadow,#0a1430),0 0 10px #ffe680,0 0 22px #ffb300;filter:brightness(1.2)}}
@media (prefers-reduced-motion:reduce){#psmod-plus{animation:none}}
html.psmod-calm #psmod-plus{animation:none}`;
    document.documentElement.classList.toggle('psmod-calm', !!reduceMotion);
    document.head.appendChild(st);
    const plus = document.createElement('span');
    plus.id = 'psmod-plus';
    plus.textContent = '+';
    plus.title = 'PokeSurvivor Plus is on';
    plus.setAttribute('translate', 'no');
    t1.appendChild(plus);
  }
  onReady(setupLogoPlus);

  // ------------------------------------------------------- settings gear
  // The game's 12×12 gear has 1-pixel teeth and reads as a blob at button
  // size. Same size, palette and outline: a rounder body, eight teeth, a hole.
  const GEAR_ROWS = [
    '.....kk.....',
    '..kkkwwkkk..',
    '.kwwkwgkggk.',
    '.kwwwggggdk.',
    '.kkwggggdkk.',
    'kwwggkkdddsk',
    'kwgggkkddssk',
    '.kkggdddskk.',
    '.kggdddsssk.',
    '.kgdkdskssk.',
    '..kkksskkk..',
    '.....kk.....',
  ];
  const GEAR_PAL = { k: '#1b1528', w: '#f4f8ff', g: '#c9d6ff', d: '#7f93c9', s: '#566a9e' };
  let gearCanvas = null, gearUrl = '';
  function gear() {
    if (!gearCanvas) {
      gearCanvas = document.createElement('canvas');
      gearCanvas.width = gearCanvas.height = 12;
      const g = gearCanvas.getContext('2d');
      GEAR_ROWS.forEach((row, y) => [...row].forEach((c, x) => { if (GEAR_PAL[c]) { g.fillStyle = GEAR_PAL[c]; g.fillRect(x, y, 1, 1); } }));
      gearUrl = gearCanvas.toDataURL();
    }
    return gearCanvas;
  }
  function setupGear() {
    const I = NS.Icons;
    const oldUrl = (() => { try { return I.url('gear'); } catch { return ''; } })();
    const { html, url, draw, canvas } = I;
    I.html = function (name, size = 20, cls = '') {
      if (name !== 'gear') return html.apply(this, arguments);
      gear();
      const w = 12 * Math.max(1, Math.round(size / 12));
      return `<img class="pix ${cls}" src="${gearUrl}" width="${w}" height="${w}" alt="" draggable="false">`;
    };
    I.url = function (name) { if (name === 'gear') { gear(); return gearUrl; } return url.apply(this, arguments); };
    I.canvas = function (name) { return name === 'gear' ? gear() : canvas.apply(this, arguments); };
    I.draw = function (ctx, name, x, y, size) {
      if (name !== 'gear') return draw.apply(this, arguments);
      const s2 = 12 * Math.max(1, Math.round(size / 12));
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(gear(), Math.round(x + (size - s2) / 2), Math.round(y + (size - s2) / 2), s2, s2);
      ctx.imageSmoothingEnabled = prev;
    };
    // Gears the game already put on the page (top bar, menu, pause).
    const swap = () => {
      if (!oldUrl) return;
      gear();
      for (const img of document.querySelectorAll('img.pix')) if (img.getAttribute('src') === oldUrl) img.src = gearUrl;
    };
    swap();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', swap);
    addEventListener('load', swap);
    for (const ms of [1500, 4000, 8000]) setTimeout(swap, ms);
  }
  waitFor(() => NS && NS.Icons && NS.Icons.html, setupGear);

  // ------------------------------------------------ co-op pause and chat
  // Both travel as their own message type ('psx') over the game's direct
  // connection between players; the game ignores message types it doesn't
  // know, so teammates without PokeSurvivor Plus aren't affected. Guests only
  // talk to the host, so the host must have PokeSurvivor Plus for either.
  //
  // Pause: the host's extension uses the game's own "everyone stops" mode
  // (the one used while someone picks a fusion): enemies, timer and spawns
  // stop for every player, with or without the extension. The host can pause
  // and resume; anyone can vote, and it pauses (or resumes) once half the
  // players have voted. Votes run out after 30 s.
  const PSX = 'psx';
  const VOTE_MS = 30000;
  let plusHost = false, plusHostAt = 0;
  const cp = { on: false, by: '', votes: new Set(), rvotes: new Set(), at: 0 };          // host only
  let cpView = { on: false, by: '', v: [], rv: [], need: 1, n: 1 };                         // everyone
  const myName = () => (NS.Social && NS.Social.me && NS.Social.me.name) || 'You';
  const inRoom = () => !!(NS.Net && NS.Net.open_);
  const netHost = () => !!(NS.Net && NS.Net.isHost);
  const coopRun = () => !!(NS.Coop && NS.Coop.active && NS.Game && NS.Game.player && NS.Game.state !== 'ui' && NS.Game.state !== 'over');
  function roster() {
    const room = NS.Social && NS.Social.room;
    const live = NS.Coop && NS.Coop.active && NS.Coop.members && NS.Coop.members.length ? NS.Coop.members : null;
    const ms = live || (room && room.members) || [];
    const C = (NS.Coop && NS.Coop.COLORS) || ['#ffcb3d', '#5fc8ff', '#7ee07a', '#ff8ad8'];
    return ms.map((m, i) => ({ uid: m.uid, name: m.name || '?', color: C[i % C.length] }));
  }
  const who = (uid) => roster().find((r) => r.uid === uid) || { name: uid === (NS.Net && NS.Net.uid) ? myName() : '?', color: '#c9d6ff' };
  const playersNow = () => (NS.Coop && NS.Coop.active ? 1 + NS.Coop.mates.filter((m) => m.connected).length : 1);
  const needVotes = () => Math.max(1, Math.ceil(playersNow() / 2));

  // ---- host side
  function hostState() {
    // Only votes from players still here count.
    const here = new Set([NS.Net.uid, ...NS.Coop.mates.filter((m) => m.connected).map((m) => m.uid)]);
    for (const set of [cp.votes, cp.rvotes]) for (const u of [...set]) if (!here.has(u)) set.delete(u);
    return { k: PSX, a: 'st', on: cp.on, by: cp.by, v: [...cp.votes].map((u) => who(u).name), rv: [...cp.rvotes].map((u) => who(u).name), need: needVotes(), n: playersNow() };
  }
  function hostSend() {
    if (!NS.Coop || !NS.Coop.active || !NS.Coop.isHost) return;
    const st = hostState();
    try { NS.Net.broadcast(st); } catch (_) { /* nobody connected */ }
    applyState(st);
  }
  function hostSetPause(on, by) {
    if (!NS.Coop || !NS.Coop.active || !NS.Coop.isHost || on === cp.on) return;
    cp.on = on; cp.by = on ? by : ''; cp.votes.clear(); cp.rvotes.clear();
    try { if (on) NS.Coop.holdStart(); else NS.Coop.holdEnd(); } catch (err) { console.warn('[psmod] pause', err); }
    NS.Audio && NS.Audio.sfx('pause');
    hostSend();
  }
  function hostVote(uid, resume, on) {
    if (!NS.Coop || !NS.Coop.active || !NS.Coop.isHost) return;
    if (resume !== cp.on) return;                       // a vote for the other state
    const set = resume ? cp.rvotes : cp.votes;
    if (on) set.add(uid); else set.delete(uid);
    cp.at = performance.now();
    hostState();
    if (!cp.on && cp.votes.size >= needVotes()) hostSetPause(true, 'vote');
    else if (cp.on && cp.rvotes.size >= needVotes()) hostSetPause(false, '');
    else hostSend();
  }
  const chatRate = new Map();   // uid -> [times]
  function hostChat(from, text) {
    text = cleanChat(text);
    if (!text) return;
    const now = Date.now(), times = (chatRate.get(from) || []).filter((t) => now - t < 5000);
    if (times.length >= 5) return;                    // 5 messages per 5 s each
    times.push(now); chatRate.set(from, times);
    const p = from === NS.Net.uid ? { name: myName(), color: who(from).color } : who(from);
    addChat(p.name, text, p.color, false, from);
    try { NS.Net.broadcast({ k: PSX, a: 'chat', u: from, n: p.name, c: p.color, t: text }, from === NS.Net.uid ? undefined : from); } catch (_) { /* nobody connected */ }
  }

  // ---- everyone
  function applyState(st) {
    const was = cpView.on;
    cpView = { on: !!st.on, by: st.by || '', v: st.v || [], rv: st.rv || [], need: st.need || 1, n: st.n || 1 };
    // The game's own "Paused: … is choosing" banner may have come first: our panel replaces it.
    if (cpView.on && !was) { try { NS.Spawner.say('', 0, true); } catch (_) { /* ignore */ } }
    if (was !== cpView.on) addChat('', cpView.on ? (cpView.by === 'vote' ? 'Paused for everyone by vote.' : 'The host paused the game for everyone.') : 'The game goes on.', '#9ad7ff', true);
    syncPauseUi();
  }
  function vote(resume, on) {
    if (netHost()) hostVote(NS.Net.uid, resume, on);
    else NS.Net.toHost({ k: PSX, a: 'v', r: !!resume, on: !!on });
  }
  const iVoted = (list) => list.includes(myName());

  // ---- chat
  const chatLog = [];  // { n, t, c, at, sys, u }
  const CHAT_MAX = 60;
  // Speech bubbles over the sender's Pokémon during a run (uid -> { t, c, at }).
  const bubbles = new Map();
  let chatBubbles = load('chatBubbles', true);
  const cleanChat = (t) => String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  function addChat(n, t, c, sys = false, u = null) {
    chatLog.push({ n, t, c, at: Date.now(), sys, u });
    if (u && !sys && t) bubbles.set(u, { t, c, at: Date.now() });
    if (chatLog.length > CHAT_MAX) chatLog.shift();
    renderChat();
  }
  function sendChat(text) {
    text = cleanChat(text);
    if (!text || !inRoom()) return;
    if (chatSound) blip('send');
    if (netHost()) { hostChat(NS.Net.uid, text); return; }
    if (!plusHost) { addChat('', 'Chat needs the host to have PokeSurvivor Plus too.', '#aab8d6', true); return; }
    NS.Net.toHost({ k: PSX, a: 'chat', t: text });
    addChat(myName(), text, who(NS.Net.uid).color, false, NS.Net.uid);
  }
  const chatLine = (m) => m.sys ? `<div class="ln sys">${esc(m.t)}</div>`
    : `<div class="ln"><b style="color:${esc(m.c || '#fff')}" translate="no">${esc(m.n)}</b> <span translate="no">${esc(m.t)}</span></div>`;

  function setupCoopExtras() {
    const st = document.createElement('style');
    st.textContent = `
#psmod-lchat{margin:12px 0 0;display:grid;gap:6px}
#psmod-lchat .log{height:120px;overflow-y:auto;background:rgba(0,0,0,.25);border:2px solid rgba(244,248,255,.2);border-radius:10px;padding:6px 10px;font-size:14px;text-align:left}
#psmod-lchat form,#psmod-gchat form{display:flex;gap:6px}
#psmod-lchat input,#psmod-gchat input{flex:1;min-width:0;padding:6px 10px;font:inherit;font-size:14px;color:#fff;background:rgba(0,0,0,.35);border:2px solid rgba(244,248,255,.35);border-radius:9px;outline:none}
#psmod-lchat input:focus,#psmod-gchat input:focus{border-color:#ffd23f}
#psmod-lchat .note2{font-size:12px;color:var(--muted,#b9cbf0);margin:0}
.ln{line-height:1.35;word-wrap:break-word;text-shadow:2px 2px 0 var(--shadow,#0a1430)}
.ln.sys{color:#9ad7ff;font-style:italic}
#psmod-gchat{position:fixed;left:12px;bottom:96px;width:min(360px,calc(100vw - 24px));z-index:40;font:14px/1.3 var(--font,'Pixelify',system-ui,sans-serif);color:#fff;pointer-events:none}
#psmod-gchat[hidden]{display:none}
#psmod-gchat .log{display:grid;gap:2px;padding:6px 8px;border-radius:10px}
#psmod-gchat .ln{transition:opacity .6s}
#psmod-gchat.open .log{background:rgba(11,24,56,.72)}
#psmod-gchat form{display:none;margin-top:6px;pointer-events:auto}
#psmod-gchat.open form{display:flex}
#psmod-gchat .hint{font-size:11px;color:#b9cbf0;margin-top:3px;display:none}
#psmod-gchat.open .hint{display:block}
#psmod-cpause{position:fixed;inset:0;z-index:30;display:grid;place-items:center;background:rgba(5,10,25,.45);font:14px/1.35 var(--font,'Pixelify',system-ui,sans-serif);color:#fff}
#psmod-cpause[hidden]{display:none}
#psmod-cpause .win{width:min(420px,calc(100vw - 32px));box-sizing:border-box;padding:16px 18px;text-align:center;display:grid;gap:8px;
  background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));border:3px solid var(--edge,#f4f8ff);border-radius:12px;
  box-shadow:0 0 0 3px var(--edge-out,#0b1838),inset 0 0 0 2px var(--edge-in,#5b83d6);text-shadow:2px 2px 0 var(--shadow,#0a1430)}
#psmod-cpause h2{margin:0;font-size:24px;color:#ffd23f}
#psmod-cpause .sub{margin:0;color:var(--muted,#b9cbf0)}
#psmod-cpause .row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
#psmod-cp-row{display:grid;gap:4px;justify-items:center;margin:4px 0 8px}
#psmod-cp-row .sub{margin:0;font-size:12px}`;
    document.head.appendChild(st);

    // Lobby chat, under the players.
    const lobbyMembers = document.getElementById('lobby-members');
    if (lobbyMembers && !document.getElementById('psmod-lchat')) {
      const box = document.createElement('div');
      box.id = 'psmod-lchat';
      box.innerHTML = `<div class="log" aria-live="polite"></div>
        <form><input type="text" maxlength="200" placeholder="Say something to the room…" autocomplete="off" spellcheck="true"><button class="btn small" type="submit">Send</button></form>
        <p class="note2"></p>`;
      lobbyMembers.after(box);
      wireChatInput(box.querySelector('form'), box.querySelector('input'), false);
    }
    // In-game chat: Enter opens it.
    if (!document.getElementById('psmod-gchat')) {
      const g = document.createElement('div');
      g.id = 'psmod-gchat';
      g.hidden = true;
      g.innerHTML = '<div class="log"></div><form><input type="text" maxlength="200" placeholder="Message…" autocomplete="off"></form><div class="hint">Enter sends · Esc closes</div>';
      document.body.appendChild(g);
      wireChatInput(g.querySelector('form'), g.querySelector('input'), true);
    }
    // Everyone-paused panel.
    if (!document.getElementById('psmod-cpause')) {
      const o = document.createElement('div');
      o.id = 'psmod-cpause';
      o.hidden = true;
      o.innerHTML = '<div class="win"><h2>Paused for everyone</h2><p class="sub" data-by></p><p class="sub" data-votes></p><div class="row" data-btns></div></div>';
      document.body.appendChild(o);
      o.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        b.blur();
        if (b.dataset.a === 'resume') hostSetPause(false, '');
        if (b.dataset.a === 'vote') vote(true, !iVoted(cpView.rv));
        if (b.dataset.a === 'settings' && NS.SettingsUI) NS.SettingsUI.open();
      });
    }
    // Row in the co-op pause menu.
    const pauseBox = document.querySelector('#scr-pause .box .row');
    if (pauseBox && !document.getElementById('psmod-cp-row')) {
      const r = document.createElement('div');
      r.id = 'psmod-cp-row';
      pauseBox.before(r);
      r.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        b.blur();
        if (b.dataset.a === 'pause') { hostSetPause(true, 'host'); NS.UI && NS.UI.hide('scr-pause'); }
        if (b.dataset.a === 'vote') vote(false, !iVoted(cpView.v));
      });
    }

    NS.Net.on((from, m) => {
      if (!m || m.k !== PSX) return;
      if (m.a === 'ping') { if (netHost() || from === NS.Net.hostUid) onPingMsg(from, m); if (!netHost()) { plusHost = true; plusHostAt = Date.now(); } return; }
      if (netHost()) {
        if (m.a === 'v') hostVote(from, !!m.r, !!m.on);
        else if (m.a === 'chat') hostChat(from, m.t);
      } else if (from === NS.Net.hostUid) {
        plusHost = true; plusHostAt = Date.now();
        if (m.a === 'st') applyState(m);
        else if (m.a === 'en') onEndlessMsg(m);
        else if (m.a === 'chat') addChat(String(m.n || '?').slice(0, 20), cleanChat(m.t), typeof m.c === 'string' ? m.c : '#fff', false, typeof m.u === 'string' ? m.u : null);
      }
    });

    // Housekeeping twice a second.
    let lastHi = 0, lastRoom = null;
    setInterval(() => {
      const now = Date.now();
      const roomId = NS.Social && NS.Social.room ? NS.Social.room.id : null;
      if (roomId !== lastRoom) { lastRoom = roomId; plusHost = false; if (!roomId) chatLog.length = 0; renderChat(); }
      if (plusHost && now - plusHostAt > 8000) plusHost = false;
      // The host says it's here (and the pause state) every 2 s.
      if (inRoom() && netHost() && now - lastHi > 2000) {
        lastHi = now;
        if (NS.Coop && NS.Coop.active) hostSend();
        else try { NS.Net.broadcast({ k: PSX, a: 'hi' }); } catch (_) { /* nobody yet */ }
        try { NS.Net.broadcast(endlessMsg()); } catch (_) { /* nobody yet */ }
      }
      if (NS.Coop && NS.Coop.active && NS.Coop.isHost) {
        if ((cp.votes.size || cp.rvotes.size) && performance.now() - cp.at > VOTE_MS) { cp.votes.clear(); cp.rvotes.clear(); hostSend(); }
        // The game can drop the pause (the host finished picking a fusion): put it back.
        if (cp.on && NS.Game.state === 'playing' && !isShown('scr-bond')) { try { NS.Coop.holdStart(); } catch (_) { /* ignore */ } }
      }
      if (!NS.Coop || !NS.Coop.active) {
        if (cp.on || cpView.on || cpView.v.length) { cp.on = false; cp.votes.clear(); cp.rvotes.clear(); cpView = { on: false, by: '', v: [], rv: [], need: 1, n: 1 }; }
      }
      syncPauseUi();
      renderChatFade();
    }, 500);
    renderChat();
  }

  function wireChatInput(form, input, ingame) {
    // Typing never reaches the game (or its keys).
    for (const ev of ['keydown', 'keypress']) input.addEventListener(ev, (e) => {
      e.stopPropagation();
      if (ev !== 'keydown') return;
      if (e.key === 'Escape') { e.preventDefault(); input.value = ''; if (ingame) closeGameChat(); else input.blur(); }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      sendChat(input.value);
      input.value = '';
      if (ingame) closeGameChat();
    });
  }
  function openGameChat() {
    const g = document.getElementById('psmod-gchat');
    if (!g) return;
    g.hidden = false;
    g.classList.add('open');
    renderChat();
    const input = g.querySelector('input');
    setTimeout(() => input.focus(), 0);
  }
  function closeGameChat() {
    const g = document.getElementById('psmod-gchat');
    if (!g) return;
    g.classList.remove('open');
    const input = g.querySelector('input');
    input.blur();
    renderChat();
  }
  function renderChat() {
    const l = document.querySelector('#psmod-lchat .log');
    if (l) {
      const atEnd = l.scrollHeight - l.scrollTop - l.clientHeight < 30;
      l.innerHTML = chatLog.length ? chatLog.map(chatLine).join('') : '<div class="ln sys">Messages go to everyone in the room.</div>';
      if (atEnd) l.scrollTop = l.scrollHeight;
      const note = document.querySelector('#psmod-lchat .note2');
      if (note) note.textContent = !inRoom() ? '' : netHost() ? 'Only players with PokeSurvivor Plus see the chat.'
        : plusHost ? 'Only players with PokeSurvivor Plus see the chat.' : 'Chat works when the host also has PokeSurvivor Plus.';
    }
    const g = document.getElementById('psmod-gchat');
    if (g) {
      const open = g.classList.contains('open');
      const recent = chatLog.slice(open ? -8 : -6);
      g.querySelector('.log').innerHTML = recent.map((m) => chatLine(m).replace('class="ln', `data-at="${m.at}" class="ln`)).join('');
      renderChatFade();
    }
  }
  function renderChatFade() {
    const g = document.getElementById('psmod-gchat');
    if (!g) return;
    const show = coopRun();
    if (!show) { if (!g.hidden) { g.hidden = true; g.classList.remove('open'); } return; }
    g.hidden = false;
    const open = g.classList.contains('open'), now = Date.now();
    for (const el of g.querySelectorAll('.ln')) {
      const age = now - (+el.dataset.at || 0);
      el.style.opacity = open ? '1' : age < 9000 ? '1' : age < 11000 ? '0.35' : '0';
    }
  }

  function syncPauseUi() {
    const o = document.getElementById('psmod-cpause');
    const host = NS.Coop && NS.Coop.active && NS.Coop.isHost;
    if (o) {
      const show = cpView.on && coopRun() && !isShown('scr-settings');
      if (o.hidden === show) o.hidden = !show;
      if (show) {
        const by = cpView.by === 'vote' ? 'Paused by vote.' : 'Paused by the host.';
        const byEl = o.querySelector('[data-by]'), vEl = o.querySelector('[data-votes]'), bEl = o.querySelector('[data-btns]');
        if (byEl.textContent !== by) byEl.textContent = by;
        const vt = cpView.rv.length ? `Voted to go on: ${cpView.rv.join(', ')} (${cpView.rv.length}/${cpView.need})` : `Resumes when the host says so or ${cpView.need} of ${cpView.n} players vote.`;
        if (vEl.textContent !== vt) vEl.textContent = vt;
        const mine = iVoted(cpView.rv);
        const html = (host ? '<button class="btn gold" data-a="resume">Resume for everyone</button>'
          : `<button class="btn${mine ? '' : ' gold'}" data-a="vote">${mine ? 'Take back my vote' : 'Vote to resume'} · ${cpView.rv.length}/${cpView.need}</button>`)
          + '<button class="btn" data-a="settings">Settings</button>';
        if (bEl.dataset.h !== html) { bEl.dataset.h = html; bEl.innerHTML = html; }
      }
    }
    const r = document.getElementById('psmod-cp-row');
    if (r) {
      const coop = !!(NS.Coop && NS.Coop.active);
      let html = '';
      if (coop && host) html = '<button class="btn gold" data-a="pause">Pause for everyone</button><p class="sub">Stops enemies and the timer for every player.</p>';
      else if (coop && plusHost) {
        const mine = iVoted(cpView.v);
        html = `<button class="btn${mine ? '' : ' gold'}" data-a="vote">${mine ? 'Take back my vote' : 'Vote to pause'} · ${cpView.v.length}/${cpView.need}</button>`
          + `<p class="sub">${cpView.v.length ? 'Voted: ' + esc(cpView.v.join(', ')) + ' · ' : ''}Pauses for everyone when ${cpView.need} of ${cpView.n} players vote.</p>`;
      } else if (coop) html = '<p class="sub">Pausing for everyone needs the host to have PokeSurvivor Plus.</p>';
      if (r.dataset.h !== html) { r.dataset.h = html; r.innerHTML = html; }
      r.hidden = !html;
    }
  }

  // Enter opens the chat during a co-op run; Esc / P on the paused panel:
  // the host resumes, a guest votes.
  addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat && coopRun() && !isShown('scr-settings')
        && !(NS.Judgment && NS.Judgment.cinematic) && !(sumEl && !sumEl.hidden)) {
      e.preventDefault(); e.stopImmediatePropagation();
      openGameChat();
      return;
    }
    if (cpView.on && coopRun() && !isShown('scr-settings') && (e.code === 'Escape' || e.code === 'KeyP') && !e.repeat) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (NS.Coop.isHost) hostSetPause(false, ''); else vote(true, !iVoted(cpView.rv));
    }
  }, true);
  waitFor(() => NS && NS.Net && NS.Net.on && NS.Coop && document.getElementById('scr-lobby'), setupCoopExtras);


  // ------------------------------------------------------------ endless mode
  // The purple Endless button under Play starts an endless run (the gold Play
  // button, a normal one). Arceus's Judgment doesn't come at 30:00: the run
  // goes on the way runs did before the Judgment existed (from minute 60
  // enemies toughen faster and faster, the game's own "extra time" curve),
  // rifts keep opening and a boss comes every 3 minutes, like early on. The
  // player (the host in co-op) can summon Arceus from the pause menu to end it.
  // Endless runs never touch the game's leaderboard (they aren't even
  // registered with it), don't unlock achievements, and leave the game's
  // stats as they were (best time, best level, runs, kills…); coins, tickets
  // and Pokémon you catch are kept. Their records are kept here, separately.
  let lateWarned = false;
  let endlessNext = 0;            // when the Endless button was pressed (the next run started is endless)
  let endlessRun = false, arceusCalled = false, hostEndless = false, runWasEndless = false;
  const JUDGE_AT = 1800;
  const SNAP_KEY = 'endlessSnap';
  const SNAP_PARTS = ['stats', 'legends', 'arenas', 'evoMoves', 'itemsFound'];
  // The game's "extra time" from before the Judgment (12-10-2026, removed on
  // 13-10): until minute 60 nothing changes; from there enemy health (and a
  // little less, damage) grows faster and faster.
  //   minute   60    75    90    105   120   150
  //   health  ×1   ×1.09 ×1.4  ×2.1  ×3.8  ×21   (on top of the usual growth)
  const LATE_FROM = 60, LATE_K = 0.000374;
  const lateK = (t) => { const m = Math.max(0, t / 60 - LATE_FROM); return Math.exp(Math.min(30, LATE_K * m * m)); };
  const iAmHost = () => !(NS.Coop && NS.Coop.active) || !!NS.Coop.isHost;
  const wantEndless = () => endlessNext && Date.now() - endlessNext < 120000 && iAmHost();

  function endlessSnapshot() {
    const s = NS.DB && NS.DB.save;
    if (!s) return;
    const snap = { at: Date.now(), runs: (s.stats && s.stats.runs) || 0, d: {} };
    for (const k of SNAP_PARTS) snap.d[k] = s[k] === undefined ? null : JSON.parse(JSON.stringify(s[k]));
    save(SNAP_KEY, snap);
  }
  // Puts back what the run changed in the game's stats (and what achievements
  // count). `done`: the run is over, forget the copy and upload the save.
  function endlessRestore(done) {
    const snap = load(SNAP_KEY, null), s = NS.DB && NS.DB.save;
    if (snap && s) for (const k of SNAP_PARTS) { if (snap.d[k] === null) delete s[k]; else s[k] = JSON.parse(JSON.stringify(snap.d[k])); }
    if (done) {
      try { localStorage.removeItem('psmod:' + SNAP_KEY); } catch (_) { /* fine */ }
      try { NS.DB.commit(true); } catch (_) { /* offline */ }
    }
  }
  function startEndless(host) {
    if (endlessRun) endEndless();
    endlessRun = true; arceusCalled = false; runWasEndless = true; lateWarned = false;
    endlessSnapshot();
    if (NS.Judgment) NS.Judgment.AT = 1e9;          // rifts read this: they keep opening
    if (host) {
      // Bosses after 30:00 on the game's own rhythm (one every 3 minutes, as
      // at 3:00 … 15:00): the run's five bosses again in turn, each with the
      // last (strongest) slot's health and damage; the game's boss scaling
      // makes them tougher as time goes on.
      try {
        const B = NS.Enemies.BOSSES;
        if (B && !B.__psmEndless && B.length) {
          const base = B.slice(0, 5), top = base[base.length - 1], every = (base[1] && base[0] ? base[1].at - base[0].at : 180) || 180;
          for (let i = 0; i < 200; i++) {
            const b = base[i % base.length];
            B.push(Object.assign({}, b, { at: JUDGE_AT + every * (i + 1), hp: top.hp, dmg: top.dmg, xp: top.xp, shotDmg: top.shotDmg || b.shotDmg }));
          }
          B.__psmEndless = true;
        }
      } catch (err) { trip('endless', err); }
    }
    document.documentElement.classList.add('psm-endless-run');
  }
  function endEndless() {
    if (!endlessRun) return;
    endlessRestore(true);
    endlessRun = false; arceusCalled = false;
    if (NS.Judgment) NS.Judgment.AT = JUDGE_AT;
    document.documentElement.classList.remove('psm-endless-run');
  }
  // Records of endless runs: solo and co-op, kept apart from everything else.
  function markEndlessOver(beat) {
    const box = document.getElementById('over-stats');
    if (!box) return;
    // The game's "New time record!" doesn't count here: endless times are kept apart.
    for (const d of box.querySelectorAll(':scope > div.gold')) if (/r[eé]cord/i.test(d.textContent)) d.remove();
    const line = document.createElement('div');
    line.className = 'psm-endless-line';
    line.setAttribute('translate', 'no');
    line.innerHTML = `<span class="psm-endless-badge">∞ Endless run</span><div style="font-size:12px;margin-top:5px">Not on the leaderboard · no achievements · your best time is unchanged${beat.includes('time') ? '<br><b style="color:#ffe27a">New endless record!</b>' : ''}</div>`;
    box.prepend(line);
  }
  function endlessRecord(s) {
    const rec = load('endlessRec', {}), k = (s.coop || 1) > 1 ? 'group' : 'solo';
    const r = rec[k] || {}, beat = [];
    if ((s.time || 0) > (r.time || 0)) { r.time = s.time; r.timeDex = s.dex; r.timeAt = s.at; beat.push('time'); }
    if ((s.level || 0) > (r.level || 0)) { r.level = s.level; beat.push('level'); }
    if ((s.kills || 0) > (r.kills || 0)) { r.kills = s.kills; beat.push('kills'); }
    r.runs = (r.runs || 0) + 1;
    rec[k] = r;
    save('endlessRec', rec);
    return beat;
  }

  function setupEndless() {
    const R = NS.Ranking, J = NS.Judgment, E = NS.Enemies, A = NS.AchDefs;
    // Not registered with the leaderboard, and never sent to it.
    const started = R.runStarted, solo = R.submitSolo, group = R.submitGroup;
    R.runStarted = function () {
      const want = wantEndless();
      endlessNext = 0;
      if (want) { startEndless(true); return null; }
      if (endlessRun) endEndless();
      return started.apply(this, arguments);
    };
    R.submitSolo = function () { if (endlessRun) return null; return solo.apply(this, arguments); };
    R.submitGroup = function () { if (endlessRun) return null; return group.apply(this, arguments); };
    // No Judgment at 30:00 (unless Arceus is summoned).
    const upd = J.update;
    J.update = function (dt, pl, time) {
      if (endlessRun) time = arceusCalled ? Math.max(time, JUDGE_AT) : Math.min(time, JUDGE_AT - 1);
      return upd.call(this, dt, pl, time);
    };
    // The game reads this right after updating its stats at the end of a run:
    // they go back to how they were before it started.
    const sum = J.summary;
    J.summary = function () { const r = sum.apply(this, arguments); if (endlessRun) try { endlessRestore(false); } catch (err) { trip('endless', err); } return r; };
    // The old "extra time" curve from minute 60 (enemies, bosses and rift legendaries).
    const sc = E.scale, bsc = E.bossScale;
    const late = (o, t) => { if (!endlessRun) return o; const k = lateK(t); return k === 1 ? o : Object.assign({}, o, { hp: o.hp * k, dmg: o.dmg * Math.pow(k, 0.7) }); };
    E.scale = function (t) { return late(sc.apply(this, arguments), t); };
    E.bossScale = function (t) { return late(bsc.apply(this, arguments), t); };
    const EM = NS.EnemyMgr;
    if (EM && typeof EM.add === 'function') {
      const add = EM.add;
      EM.add = function (e) {
        // Rift legendaries are built without the scaling above: the same curve here.
        try {
          if (endlessRun && e && e.legend && !e.__psmLate) {
            e.__psmLate = true;
            const k = lateK((NS.Game.st && NS.Game.st.time) || 0);
            if (k > 1) { e.maxHp = Math.round(e.maxHp * k); e.hp = Math.round(e.hp * k); const d = Math.pow(k, 0.7); e.dmg *= d; if (e.shotDmg) e.shotDmg *= d; }
          }
        } catch (_) { /* leave it */ }
        return add.apply(this, arguments);
      };
    }
    // No achievements: while an endless run is on, the game sees none to unlock.
    const list = A.LIST;
    Object.defineProperty(A, 'LIST', { configurable: true, get: () => (endlessRun ? [] : list) });
    // Left over from a run that never finished (the tab closed): put the
    // stats back, unless runs were played since.
    const snap = load(SNAP_KEY, null);
    if (snap && !endlessRun) waitFor(() => NS.DB && NS.DB.save && NS.DB.save.stats, () => {
      const s = NS.DB.save;
      if ((s.stats.runs || 0) === snap.runs && Date.now() - snap.at < 7 * 864e5) endlessRestore(true);
      else try { localStorage.removeItem('psmod:' + SNAP_KEY); } catch (_) { /* fine */ }
    }, 'endless');
    // A run that ended without the usual end (left within a minute…).
    setInterval(() => {
      try {
        if (endlessRun && NS.Game.state === 'ui') endEndless();
        if (endlessRun && !lateWarned && NS.Game.state === 'playing' && NS.Game.st && NS.Game.st.time >= LATE_FROM * 60) {
          lateWarned = true;
          toast('Wild Pokémon grow stronger and stronger', '#ff9a5f', 'Endless: from minute 60 they toughen faster as time goes on');
          try { NS.Audio.sfx('boss'); } catch (_) { /* quiet */ }
        }
      } catch (err) { trip('endless', err); }
    }, 1000);
    setupEndlessUi();
  }
  waitFor(() => NS && NS.Ranking && NS.Judgment && NS.Enemies && NS.AchDefs && NS.AchDefs.LIST && NS.Progress && NS.Game, setupEndless);

  // Co-op: the host says whether Endless is on (in the room, and during the run).
  function onEndlessMsg(m) {
    hostEndless = !!m.on;
    syncEndlessUi();
    if (m.run && coopRun() && !endlessRun) startEndless(false);
  }
  function endlessMsg() { return { k: PSX, a: 'en', on: coopRun() && endlessRun, run: coopRun() && endlessRun }; }

  // ---- the switch, the pause menu and the end of the run
  let endlessBtn = null, endlessClicking = false;
  // A smooth, rounded infinity sign for the Endless button (drawn once).
  let infIconUrl = '';
  const INF_ICON = () => {
    if (infIconUrl) return infIconUrl;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    const g = cv.getContext('2d');
    g.lineCap = g.lineJoin = 'round';
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= 160; i++) {
        const t = (i / 160) * Math.PI * 2, d = 1 + Math.sin(t) ** 2;
        const x = 48 + (37 * Math.cos(t)) / d, y = 48 + (46 * Math.sin(t) * Math.cos(t)) / d;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
    };
    path(); g.strokeStyle = '#2a0f6b'; g.lineWidth = 19; g.stroke();
    path(); g.strokeStyle = '#efe6ff'; g.lineWidth = 10; g.stroke();
    // A soft highlight along the top of each loop.
    g.save(); g.beginPath(); g.rect(0, 0, 96, 44); g.clip();
    path(); g.strokeStyle = '#ffffff'; g.lineWidth = 4; g.stroke();
    g.restore();
    return (infIconUrl = cv.toDataURL());
  };
  function setupEndlessUi() {
    const st = document.createElement('style');
    st.textContent = `
/* Endless: as big as Play, in purple, with the same light sweeping across. */
#scr-menu #psmod-endless{width:100%;box-sizing:border-box;flex:none;position:relative;overflow:hidden;margin:0!important;
  font-size:40px!important;letter-spacing:1.5px;grid-template-columns:44px 1fr;padding:16px 20px 16px 30px;border-radius:14px;color:#fff;
  -webkit-text-stroke:1px #2a0f6b;paint-order:stroke fill;text-shadow:0 2px 0 #2a0f6b;
  background:linear-gradient(180deg,#b996ff,#8a5cf0 55%,#6638cc);border:3px solid #eadfff;
  box-shadow:0 0 0 3px #2a0f6b,0 6px 0 #2a0f6b,0 0 22px rgba(170,120,255,.45);transition:transform .08s,box-shadow .2s,filter .2s}
#scr-menu #psmod-endless small{display:block;font-size:15px!important;margin-top:2px;color:#f1e9ff;font-weight:700;-webkit-text-stroke:0;text-shadow:1px 1px 0 #2a0f6b;
  white-space:normal;overflow:visible;padding-right:44px}
#scr-menu #psmod-endless .mi-ico img{width:36px;height:36px;image-rendering:auto}
#scr-menu #psmod-endless::before{filter:brightness(1.6)}
#scr-menu #psmod-endless .psm-shine{position:absolute;top:-20%;bottom:-20%;width:38%;left:-50%;transform:skewX(-20deg);pointer-events:none;
  background:linear-gradient(90deg,transparent,rgba(240,225,255,.7),transparent)}
html:not(.psmod-calm) #scr-menu #psmod-endless .psm-shine{animation:psmodSweep 3.2s ease-in-out .3s infinite}
#scr-menu #psmod-endless .psm-go{position:absolute;right:18px;top:50%;transform:translateY(-50%);font-size:34px;color:#f3ecff;letter-spacing:-6px;-webkit-text-stroke:0;text-shadow:0 2px 0 #2a0f6b;pointer-events:none}
html:not(.psmod-calm) #scr-menu #psmod-endless:not(:disabled) .psm-go{animation:psmodNudge 1s ease-in-out infinite alternate}
#scr-menu #psmod-endless:hover,#scr-menu #psmod-endless.psmod-padfocus{filter:brightness(1.08);box-shadow:0 0 0 3px #2a0f6b,0 6px 0 #2a0f6b,0 0 34px rgba(190,150,255,.8)}
#scr-menu #psmod-endless:active{transform:translateY(3px);box-shadow:0 0 0 3px #2a0f6b,0 3px 0 #2a0f6b,0 0 22px rgba(170,120,255,.45)}
html:not(.psmod-calm) #scr-menu #psmod-endless:not(:disabled){animation:psmodEndlessGlow 2.4s ease-in-out infinite}
@keyframes psmodEndlessGlow{50%{box-shadow:0 0 0 3px #2a0f6b,0 6px 0 #2a0f6b,0 0 30px rgba(190,150,255,.7)}}
#scr-menu #psmod-endless:disabled{cursor:default;filter:saturate(.45) brightness(.9)}
#scr-menu #psmod-endless:disabled .psm-go,#scr-menu #psmod-endless:disabled .psm-shine{display:none}
#psmod-endless-row{display:flex;flex-direction:column;align-items:center;gap:6px;margin:4px 0 10px}
#psmod-endless-row[hidden]{display:none}
#psmod-endless-row .note{margin:0;color:#c9b8ee;font-size:12px}
#psmod-endless-top{display:flex;justify-content:center;margin:-4px 0 8px}
#psmod-endless-top[hidden]{display:none}
.psm-endless-badge{display:inline-block;padding:2px 10px;border-radius:9px;background:linear-gradient(180deg,#6b3fd1,#40208f);border:2px solid #cdb6ff;color:#fff;font-weight:700;font-size:13px;text-shadow:1px 1px 0 #12082b}
#over-stats .psm-endless-line{grid-column:1/-1;text-align:center;color:#d9c8ff}
tr.run .psm-inf{color:#b89cff;font-weight:700;margin-left:4px}`;
    document.head.appendChild(st);
    // Beside Play.
    const place = () => {
      const play = document.querySelector('#scr-menu [data-go="play"]');
      if (!play || document.getElementById('psmod-endless')) return !!play;
      endlessBtn = document.createElement('button');
      endlessBtn.id = 'psmod-endless';
      endlessBtn.className = 'menu-item psm-endless';
      endlessBtn.dataset.sfx = 'none';
      endlessBtn.innerHTML = `<span class="mi-ico"><img src="${INF_ICON()}" width="24" height="24" alt="" draggable="false"></span><span class="psm-t">Endless</span><small></small><i class="psm-shine"></i><span class="psm-go" aria-hidden="true">›››</span>`;
      play.after(endlessBtn);
      // Starts the run the Play button would, as an endless one.
      endlessBtn.addEventListener('click', (e) => {
        e.stopPropagation(); endlessBtn.blur();
        if (inRoom() && !netHost()) return;
        try { NS.Audio.sfx('confirm'); } catch (_) { /* quiet */ }
        endlessNext = Date.now();
        endlessClicking = true;
        try { play.click(); } finally { endlessClicking = false; }
      }, true);
      // The gold Play button: a normal run.
      play.addEventListener('click', () => { if (!endlessClicking) endlessNext = 0; }, true);
      syncEndlessUi();
      return true;
    };
    if (!place()) waitFor(() => document.querySelector('#scr-menu [data-go="play"]'), place, 'endless');
    // Pause menu: summon Arceus.
    const pauseBox = document.querySelector('#scr-pause .box');
    const btnRow = pauseBox && pauseBox.querySelector(':scope > .row');
    if (btnRow && !document.getElementById('psmod-endless-row')) {
      const r = document.createElement('div');
      r.id = 'psmod-endless-row';
      r.hidden = true;
      r.innerHTML = '<button class="btn" id="psmod-summon" data-sfx="none">Summon Arceus</button><p class="note"></p>';
      btnRow.after(r);
      // "∞ Endless run" at the top of the pause menu, under its title.
      const top = document.createElement('div');
      top.id = 'psmod-endless-top';
      top.hidden = true;
      top.innerHTML = '<span class="psm-endless-badge">∞ Endless run</span>';
      const h2 = pauseBox.querySelector(':scope > h2');
      if (h2) h2.after(top); else pauseBox.prepend(top);
      const b = r.querySelector('#psmod-summon');
      let armT = 0;
      b.addEventListener('click', (e) => {
        e.stopPropagation(); b.blur();
        if (!b.classList.contains('armed')) { b.classList.add('armed', 'danger'); b.textContent = 'Summon Arceus? It ends the run'; clearTimeout(armT); armT = setTimeout(() => { b.classList.remove('armed', 'danger'); b.textContent = 'Summon Arceus'; }, 3500); return; }
        b.classList.remove('armed', 'danger'); b.textContent = 'Summon Arceus';
        arceusCalled = true;
        try { NS.Audio.sfx('judge'); } catch (_) { /* quiet */ }
        toast('Arceus has been summoned', '#ffd25e', 'The Judgment begins when you continue');
        const resume = document.getElementById('btn-resume');
        if (resume) resume.click();
      });
    }
    setInterval(syncEndlessUi, 500);
  }
  // Play and Endless are always the same size (a longer subtitle can wrap).
  function evenPlayButtons(play) {
    if (!endlessBtn || !endlessBtn.isConnected || !play.getClientRects().length) return;
    play.style.minHeight = endlessBtn.style.minHeight = '';
    const h = (el) => parseFloat(getComputedStyle(el).height) || 0;
    const a = h(play), b = h(endlessBtn);
    if (Math.abs(a - b) > 1) play.style.minHeight = endlessBtn.style.minHeight = Math.ceil(Math.max(a, b)) + 'px';
  }
  addEventListener('resize', () => { const play = document.querySelector('#scr-menu [data-go="play"]'); if (play) requestAnimationFrame(() => evenPlayButtons(play)); });
  function syncEndlessUi() {
    const guest = inRoom() && !netHost();
    if (endlessBtn) {
      const play = document.querySelector('#scr-menu [data-go="play"]');
      if (play && play.nextElementSibling !== endlessBtn) play.after(endlessBtn);
      if (play) evenPlayButtons(play);
      endlessBtn.disabled = guest;
      const txt = guest ? 'Only the host can start an endless run' : 'Take on an endless gauntlet of Pokémon';
      const sm = endlessBtn.querySelector('small');
      if (sm.textContent !== txt) sm.textContent = txt;
      endlessBtn.title = 'Endless run: Arceus’s Judgment doesn’t come at 30:00 and enemies keep getting tougher. Not on the leaderboard, no achievements, your game stats stay as they were; coins and tickets as usual.';
    }
    const row = document.getElementById('psmod-endless-row');
    if (row) {
      const show = endlessRun && !!(NS.Game && NS.Game.player) && !(NS.Judgment && NS.Judgment.active);
      row.hidden = !show;
      const top = document.getElementById('psmod-endless-top');
      if (top) top.hidden = !show;
      if (show) {
        const host = iAmHost();
        const b = row.querySelector('#psmod-summon');
        b.hidden = !host || arceusCalled;
        row.querySelector('.note').textContent = arceusCalled ? 'Arceus is on the way…' : host ? 'Ends the run with Arceus’s Judgment. Still not on the leaderboard.' : 'Only the host can summon Arceus.';
      }
    }
  }

  // ------------------------------------------------ co-op pings
  // Hold the ping key (G, or R3 on a controller) for a wheel; point the mouse
  // (or the right stick) at Help / Boss / Chest / Here and let go. A quick tap
  // pings "Here" where you point. Pings go through the host like the chat
  // and show for 6 s, with an arrow at the screen edge when off view.
  const PING_TYPES = {
    help:  { label: 'Help!', color: '#ff5f6d', ang: -Math.PI / 2 },
    boss:  { label: 'Boss',  color: '#c47bff', ang: 0 },
    chest: { label: 'Chest', color: '#ffd23f', ang: Math.PI / 2 },
    here:  { label: 'Here',  color: '#5fd4ff', ang: Math.PI },
  };
  const PING_LIFE = 6000;
  let pings = [], pingWheel = null, pingCv = null, pingSentAt = 0, mouseXY = [innerWidth / 2, innerHeight / 2];
  addEventListener('mousemove', (e) => { mouseXY = [e.clientX, e.clientY]; }, { passive: true });

  function pingDown(src) {
    if (!pingsOn || !coopRun() || NS.Game.state !== 'playing' || pingWheel) return;
    const at = src === 'pad' ? [innerWidth / 2, innerHeight / 2] : mouseXY.slice();
    pingWheel = { src, at, stick: [0, 0], t0: performance.now() };
    if (!pingCv) {
      pingCv = document.createElement('canvas');
      pingCv.id = 'psmod-pingwheel';
      pingCv.width = pingCv.height = 240;
      pingCv.style.cssText = 'position:fixed;z-index:100002;pointer-events:none;width:240px;height:240px';
      document.body.appendChild(pingCv);
    }
    pingCv.style.left = (at[0] - 120) + 'px'; pingCv.style.top = (at[1] - 120) + 'px';
    pingCv.hidden = false;
    const loop = () => { if (!pingWheel) { pingCv.hidden = true; return; } drawPingWheel(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  function pingChoice() {
    const w = pingWheel;
    if (!w) return null;
    let dx, dy;
    if (w.src === 'pad') [dx, dy] = w.stick; else { dx = mouseXY[0] - w.at[0]; dy = mouseXY[1] - w.at[1]; }
    const mag = Math.hypot(dx, dy);
    if (w.src === 'pad' ? mag < 0.5 : mag < 22) return null;
    const a = Math.atan2(dy, dx);
    let best = null, bd = 9;
    for (const [k, t] of Object.entries(PING_TYPES)) { const d = Math.abs(Math.atan2(Math.sin(a - t.ang), Math.cos(a - t.ang))); if (d < bd) { bd = d; best = k; } }
    return best;
  }
  function pingUp() {
    const w = pingWheel;
    if (!w) return;
    const choice = pingChoice() || 'here';
    pingWheel = null;
    if (pingCv) pingCv.hidden = true;
    try { sendPing(choice, w); } catch (err) { trip('pings', err); }
  }
  function drawPingWheel() {
    const ctx = pingCv.getContext('2d'), c = 120;
    ctx.clearRect(0, 0, 240, 240);
    const sel = pingChoice();
    ctx.beginPath(); ctx.arc(c, c, 104, 0, Math.PI * 2); ctx.fillStyle = 'rgba(11,24,56,.72)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(244,248,255,.6)'; ctx.stroke();
    for (const [k, t] of Object.entries(PING_TYPES)) {
      const on = sel === k;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.arc(c, c, 100, t.ang - Math.PI / 4 + 0.04, t.ang + Math.PI / 4 - 0.04); ctx.closePath();
      ctx.fillStyle = on ? t.color + 'aa' : 'rgba(255,255,255,.06)'; ctx.fill();
      const ix = c + Math.cos(t.ang) * 64, iy = c + Math.sin(t.ang) * 64;
      pingIcon(ctx, k, ix, iy - 6, on ? 15 : 13);
      ctx.font = HF(800, 12); ctx.textAlign = 'center';
      outlined(ctx, t.label, ix, iy + 22, on ? '#fff' : t.color, 3);
    }
    ctx.beginPath(); ctx.arc(c, c, 24, 0, Math.PI * 2); ctx.fillStyle = '#0b1838'; ctx.fill();
    ctx.font = HF(800, 9); ctx.textAlign = 'center';
    outlined(ctx, sel ? 'RELEASE' : 'POINT', c, c + 3, '#ffd23f', 2);
  }
  // Round badge with a small symbol for each kind of ping.
  function pingIcon(ctx, type, x, y, r) {
    const t = PING_TYPES[type];
    ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = t.color; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 2;
    if (type === 'help') { ctx.font = HF(800, r * 1.5); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; outlined(ctx, '!', x, y + 1, '#fff', 3); ctx.textBaseline = 'alphabetic'; }
    else if (type === 'boss') {
      // A little skull.
      ctx.beginPath(); ctx.arc(x, y - r * 0.12, r * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - r * 0.32, y + r * 0.2, r * 0.64, r * 0.36);
      ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(x - r * 0.22, y - r * 0.1, r * 0.13, 0, Math.PI * 2); ctx.arc(x + r * 0.22, y - r * 0.1, r * 0.13, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'chest') {
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(x - r * 0.6, y - r * 0.35, r * 1.2, r * 0.8); ctx.strokeRect(x - r * 0.6, y - r * 0.35, r * 1.2, r * 0.8);
      ctx.fillStyle = '#fff3b0'; ctx.fillRect(x - r * 0.6, y - r * 0.08, r * 1.2, r * 0.16); ctx.fillRect(x - r * 0.1, y - r * 0.18, r * 0.2, r * 0.36);
    } else {
      // Map pin.
      ctx.beginPath(); ctx.arc(x, y - r * 0.18, r * 0.42, Math.PI, 0); ctx.lineTo(x, y + r * 0.6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = t.color; ctx.beginPath(); ctx.arc(x, y - r * 0.18, r * 0.16, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Where a ping points in the world: where your mouse is, or where you
  // stand on a controller. Help follows you; a Boss ping placed on a boss
  // follows that boss.
  function pingTarget(type, w) {
    const p = me(), cam = NS.Camera;
    let x = p.x, y = p.y, eid = null, uid = null;
    if (w.src !== 'pad' && cam && cam.left) {
      const cv = document.querySelector('canvas'), r = cv ? cv.getBoundingClientRect() : { left: 0, top: 0 };
      x = cam.left() + (w.at[0] - r.left) / cam.scale;
      y = cam.top() + (w.at[1] - r.top) / cam.scale;
    }
    if (type === 'help') uid = NS.Net.uid;
    else if (type === 'boss' && w.src !== 'pad') {
      let best = null, bd = 90;
      for (const e of NS.EnemyMgr.all()) {
        if (!e.boss || e.dead) continue;
        const d = Math.hypot(e.x - x, e.y - y) - (e.r || e.radius || 0);
        if (d < bd) { bd = d; best = e; }
      }
      if (best) { eid = best.id; x = best.x; y = best.y; }
    }
    return { x: Math.round(x), y: Math.round(y), eid, uid };
  }
  function sendPing(type, w) {
    const now = performance.now();
    if (now - pingSentAt < 800) return;
    pingSentAt = now;
    const tg = pingTarget(type, w);
    const msg = { k: PSX, a: 'ping', t: type, x: tg.x, y: tg.y, e: tg.eid, u: tg.uid };
    const mine = { type, x: tg.x, y: tg.y, eid: tg.eid, uid: tg.uid, from: NS.Net.uid, name: myName(), color: (me() && me().tagColor) || who(NS.Net.uid).color, at: Date.now() };
    addPing(mine);
    if (netHost()) { try { NS.Net.broadcast(Object.assign({}, msg, { from: NS.Net.uid, n: mine.name, c: mine.color })); } catch (_) { /* nobody */ } }
    else NS.Net.toHost(msg);
  }
  function addPing(p) {
    if (!PING_TYPES[p.type]) return;
    pings = pings.filter((q) => q.from !== p.from && Date.now() - q.at < PING_LIFE);
    pings.push(p);
    if (pingSound) blip(p.type);
    if (p.from !== (NS.Net && NS.Net.uid) && pingChat) addChat('', `${p.name}: ${PING_TYPES[p.type].label}`, PING_TYPES[p.type].color, true);
  }
  // From the network (both directions go through the co-op handler).
  const pingRate = new Map();
  function onPingMsg(from, m) {
    if (!pingsOn || !PING_TYPES[m.t] || typeof m.x !== 'number' || typeof m.y !== 'number') return;
    if (netHost()) {
      const now = Date.now(), last = pingRate.get(from) || 0;
      if (now - last < 700) return;
      pingRate.set(from, now);
      const w = who(from), out = { k: PSX, a: 'ping', t: m.t, x: m.x, y: m.y, e: m.e || null, u: m.u ? from : null, from, n: w.name, c: w.color };
      addPing({ type: m.t, x: m.x, y: m.y, eid: out.e, uid: out.u, from, name: w.name, color: w.color, at: now });
      try { NS.Net.broadcast(out, from); } catch (_) { /* nobody */ }
    } else {
      addPing({ type: m.t, x: m.x, y: m.y, eid: m.e || null, uid: m.u || null, from: m.from, name: String(m.n || '?').slice(0, 20), color: typeof m.c === 'string' ? m.c : '#fff', at: Date.now() });
    }
  }
  // Drawn by the HUD (both styles), in HUD coordinates.
  function drawPings(ctx, W, H, pl, cardsBottom, t) {
    if (!pings.length || !pingsOn) return;
    const cam = NS.Camera, now = Date.now();
    pings = pings.filter((q) => now - q.at < PING_LIFE);
    for (const q of pings) {
      const T = PING_TYPES[q.type];
      let x = q.x, y = q.y;
      if (q.eid != null) { const e = NS.EnemyMgr.all().find((z) => z.id === q.eid && !z.dead); if (e) { x = e.x; y = e.y; } }
      if (q.uid) { const who2 = q.uid === NS.Net.uid ? me() : (NS.Coop.mate && NS.Coop.mate(q.uid) || {}).pl; if (who2) { x = who2.x; y = who2.y; } }
      const age = (now - q.at) / 1000, fade = Math.min(1, (PING_LIFE / 1000 - age) * 1.5);
      const sx = (x - cam.left()) * cam.scale, sy = (y - cam.top()) * cam.scale;
      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      if (sx > 0 && sx < W && sy > 0 && sy < H) {
        // Rings on the ground and a badge bobbing above.
        for (const k of [0, 0.5]) {
          const ph = ((age + k) % 1);
          ctx.beginPath(); ctx.ellipse(sx, sy, 10 + ph * 30, (10 + ph * 30) * 0.45, 0, 0, Math.PI * 2);
          ctx.lineWidth = 3 * (1 - ph); ctx.strokeStyle = T.color; ctx.stroke();
        }
        const by = sy - 46 - Math.abs(Math.sin(age * 4)) * 5;
        ctx.beginPath(); ctx.moveTo(sx - 5, by + 14); ctx.lineTo(sx + 5, by + 14); ctx.lineTo(sx, by + 22); ctx.closePath(); ctx.fillStyle = T.color; ctx.fill();
        pingIcon(ctx, q.type, sx, by, 11);
        ctx.font = HF(800, 10); ctx.textAlign = 'center';
        outlined(ctx, `${q.name} · ${T.label}`, sx, by - 17, T.color, 3);
      } else {
        const M = 44;
        let ex = Math.max(M, Math.min(W - M, sx)), ey = Math.max(M + 70, Math.min(H - M - 125, sy));
        if (cardsBottom && ex < 230 + M && ey < cardsBottom + M) ey = cardsBottom + M;
        [ex, ey] = avoidMap(ex, ey, M, W, H);
        [ex, ey] = spreadArrow(ex, ey, M, W, H);
        const a = Math.atan2(sy - ey, sx - ex), ca = Math.cos(a), sa = Math.sin(a);
        ctx.translate(ex, ey);
        ctx.beginPath();
        ctx.moveTo(ca * 30, sa * 30); ctx.lineTo(Math.cos(a + 2.4) * 14, Math.sin(a + 2.4) * 14); ctx.lineTo(Math.cos(a - 2.4) * 14, Math.sin(a - 2.4) * 14); ctx.closePath();
        ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.lineJoin = 'round'; ctx.stroke(); ctx.fillStyle = T.color; ctx.fill();
        pingIcon(ctx, q.type, 0, 0, 13);
        ctx.font = HF(800, 11);
        ctx.textAlign = ca > 0.3 ? 'right' : ca < -0.3 ? 'left' : 'center';
        const metres = Math.round(Math.hypot(pl.x - x, pl.y - y) / 32);
        outlined(ctx, `${q.name} · ${T.label} · ${metres} m`, -ca * 32, -sa * 28 + 4, T.color, 3);
      }
      ctx.restore();
    }
  }

  // ---- chat bubbles: the message over the sender's head for a few seconds
  // (longer messages stay a little longer), as well as in the chat box.
  function bubbleLines(ctx, text, maxW, maxLines) {
    const words = String(text).split(' '), lines = [];
    let cur = '';
    const fit = (w) => { while (w.length > 1 && ctx.measureText(w).width > maxW) w = w.slice(0, -1); return w; };
    for (let w of words) {
      if (ctx.measureText(w).width > maxW) w = fit(w);
      const next = cur ? cur + ' ' + w : w;
      if (ctx.measureText(next).width <= maxW) { cur = next; continue; }
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    const cut = lines.join(' ').length < String(text).length;
    if (cut && lines.length) { let l = lines[lines.length - 1]; while (l.length > 1 && ctx.measureText(l + '…').width > maxW) l = l.slice(0, -1); lines[lines.length - 1] = l + '…'; }
    return lines;
  }
  function drawChatBubbles(ctx, W, H) {
    if (!bubbles.size || !chatBubbles) return;
    const cam = NS.Camera, now = Date.now();
    for (const [uid, b] of bubbles) {
      const life = Math.min(8000, 3500 + b.t.length * 60);
      const age = now - b.at;
      if (age > life) { bubbles.delete(uid); continue; }
      const p = uid === (NS.Net && NS.Net.uid) ? me() : ((NS.Coop && NS.Coop.mate && NS.Coop.mate(uid)) || {}).pl;
      if (!p || p.dead || (p.net && p.net.dead)) continue;
      const sx = (p.x - cam.left()) * cam.scale, sy = (p.y - cam.top()) * cam.scale;
      if (sx < -100 || sx > W + 100 || sy < -40 || sy > H + 140) continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, (life - age) / 400, age / 120));
      ctx.font = HF(700, 10);
      const lines = bubbleLines(ctx, b.t, 150, 3);
      const lh = 12, padX = 7, padY = 5;
      const w = Math.max(28, Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + padX * 2);
      const h = lines.length * lh + padY * 2;
      const bx = Math.round(Math.max(4, Math.min(W - w - 4, sx - w / 2)));
      const by = Math.round(Math.max(4, sy - 62 - h - (age < 150 ? (150 - age) / 30 : 0)));
      // Box with a tail pointing down at the Pokémon.
      const tx = Math.max(bx + 8, Math.min(bx + w - 8, sx));
      rr(ctx, bx, by, w, h, 7);
      ctx.fillStyle = 'rgba(250,252,255,.96)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx - 5, by + h - 1); ctx.lineTo(tx, by + h + 6); ctx.lineTo(tx + 5, by + h - 1); ctx.closePath();
      ctx.fillStyle = 'rgba(250,252,255,.96)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(tx - 5, by + h); ctx.lineTo(tx, by + h + 6); ctx.lineTo(tx + 5, by + h); ctx.stroke();
      ctx.fillStyle = b.c || '#2c519f'; ctx.fillRect(bx + 3, by + 4, 2, h - 8);
      ctx.fillStyle = '#1b2b55'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, bx + padX, by + padY + i * lh + 1));
      ctx.restore();
    }
  }

  // ------------------------------------------------------------ more music
  // New tracks written in the game's own format (js/data/music.js) and played
  // by its synthesiser, so they sound like the rest of the soundtrack. Each
  // area gets 1-3 options: when you reach a new area (every biome change,
  // and each rift arena) one is picked at random, never the one you heard
  // there last time. Rift arenas get a track for their family of types.
  // Every melody bar is 16 sixteenths and the last chord leads back to the
  // first, so the tracks loop without a seam.
  const PSM_MUSIC = {
    // Forest · "Sunlit Glade": G major, lighter and brighter than the original.
    psm_forest_b: {
      bpm: 116, swing: 0.12,
      chords: ['G', 'D/F#', 'Em', 'C', 'G', 'D', 'C', 'D',
               'Em', 'Bm', 'C', 'G', 'Am', 'D', 'C', 'D'],
      melody: [{ inst: 'flute', vel: 1, bars: [
        'B4:2 D5:2 G5:4 F#5:2 E5:2 D5:4', 'F#5:6 E5:2 D5:4 A4:4', 'G5:4 E5:2 G5:2 B5:4 A5:2 G5:2', 'E5:12 -:4',
        'B4:2 D5:2 G5:4 A5:2 B5:2 D6:4', 'A5:6 F#5:2 D5:4 F#5:4', 'G5:4 E5:4 C5:4 E5:4', 'D5:8 F#5:4 A5:4',
        'B5:4 G5:2 E5:2 B5:4 G5:4', 'F#5:6 D5:2 B4:8', 'C5:2 E5:2 G5:4 C6:4 B5:2 A5:2', 'B5:8 G5:4 D5:4',
        'A5:4 C6:4 E6:4 C6:2 A5:2', 'F#5:4 A5:4 D6:6 A5:2', 'G5:4 E5:4 C5:4 G5:4', 'A5:8 F#5:4 D5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, useBass: true, vel: 0.9, pattern: 'R.F.R.F.R.F.O.F.' },
        { inst: 'pluck', octave: 4, vel: 0.55, pattern: '0.1.2.1.0.1.2.3.' },
        { inst: 'pad', octave: 3, vel: 0.6, pattern: 'C---------------' }
      ],
      drums: { kick: 'X.......X.x.....', snare: '....x.......x...', shaker: 'o.x.o.x.o.x.o.x.' }
    },
    // Forest · "Mossy Path": E dorian, half-time and a little mysterious.
    psm_forest_c: {
      bpm: 104, swing: 0.15,
      chords: ['Em', 'A', 'Em', 'A', 'G', 'D', 'A', 'A',
               'C', 'G', 'D', 'A', 'Em', 'A', 'G', 'B'],
      melody: [{ inst: 'flute', vel: 0.9, bars: [
        'E5:4 G5:2 A5:2 B5:6 A5:2', 'C#6:4 B5:2 A5:2 E5:8', 'G5:4 F#5:2 E5:2 B4:4 E5:4', 'A4:8 C#5:4 E5:4',
        'D5:4 G5:4 B5:4 A5:2 G5:2', 'F#5:8 A5:4 D6:4', 'C#6:6 B5:2 A5:4 E5:4', 'A5:12 -:4',
        'G5:4 E5:4 C5:4 E5:4', 'D5:6 B4:2 G5:8', 'F#5:4 A5:4 D6:4 A5:4', 'C#6:8 E6:8',
        'B5:4 G5:2 E5:2 G5:4 B5:4', 'C#6:4 E6:4 C#6:2 B5:2 A5:4', 'B5:4 G5:4 D5:4 G5:4', 'F#5:8 D#5:4 B4:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 0.85, pattern: 'R...R.F.R...O.F.' },
        { inst: 'bell', octave: 4, vel: 0.45, pattern: '0...2...1...2...' },
        { inst: 'pad', octave: 3, vel: 0.55, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'x.......x.....x.', snare: '........X.......', hat: '..o...o...o...o.' }
    },
    // Cave · "Echo Grotto": F# minor, slow, long notes ringing out.
    psm_cave_b: {
      bpm: 88, swing: 0.08,
      chords: ['F#m', 'D', 'E', 'C#m', 'F#m', 'D', 'Bm', 'C#',
               'D', 'E', 'C#m', 'F#m', 'Bm', 'C#m', 'D', 'C#'],
      melody: [{ inst: 'flute', vel: 0.8, bars: [
        'C#6:6 A5:2 F#5:8', 'F#5:4 A5:4 D6:8', 'E6:6 B5:2 G#5:4 E5:4', 'G#5:12 -:4',
        'A5:4 C#6:2 A5:2 F#5:4 A5:4', 'F#5:6 D5:2 A5:8', 'B5:4 D6:4 F#6:4 D6:4', 'G#5:8 E#5:4 C#5:4',
        'D5:4 F#5:4 A5:4 D6:4', 'E6:8 B5:8', 'C#6:4 E6:4 G#5:8', 'F#5:12 -:4',
        'D6:6 C#6:2 B5:4 F#5:4', 'E5:6 G#5:2 C#6:8', 'A5:4 F#5:4 D5:4 F#5:4', 'G#5:4 E#5:4 G#5:4 B5:4'] }],
      parts: [
        { inst: 'bell', octave: 4, vel: 0.45, pattern: '0...4...2...3...' },
        { inst: 'bass', octave: 2, vel: 0.75, pattern: 'R-------R---F---' },
        { inst: 'pad', octave: 3, vel: 0.9, pattern: 'C---------------' }
      ],
      drums: { kick: 'o.......o..o....', hat: '....o.......o...', shaker: '..o...o...o...o.' }
    },
    // Cave · "Deep Crystal": C minor, a slow pulse with dotted arpeggios.
    psm_cave_c: {
      bpm: 96,
      chords: ['Cm', 'Ab', 'Eb', 'Bb', 'Cm', 'Ab', 'Fm', 'G',
               'Ab', 'Bb', 'Gm', 'Cm', 'Fm', 'Gm', 'Ab', 'G'],
      melody: [{ inst: 'flute', vel: 0.85, bars: [
        'G5:4 Eb5:2 G5:2 C6:6 Bb5:2', 'Ab5:8 Eb5:4 C5:4', 'Bb5:6 G5:2 Eb5:4 G5:4', 'F5:12 -:4',
        'C6:4 D6:2 Eb6:2 G5:4 C6:4', 'Eb6:6 C6:2 Ab5:8', 'F5:4 Ab5:4 C6:4 Ab5:4', 'B5:8 D6:4 G5:4',
        'C6:4 Eb6:4 C6:4 Ab5:4', 'D6:4 F6:4 D6:4 Bb5:4', 'G5:6 Bb5:2 D6:8', 'C6:12 -:4',
        'Ab5:4 F5:4 C5:4 F5:4', 'Bb5:4 G5:4 D5:4 G5:4', 'C6:4 Ab5:4 Eb5:4 Ab5:4', 'D6:4 B5:4 G5:4 F5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 0.8, pattern: 'R.......R...F.R.' },
        { inst: 'pluck', octave: 4, vel: 0.45, pattern: '0..2..1..2..0.3.' },
        { inst: 'pad', octave: 3, vel: 0.8, pattern: 'C---------------' }
      ],
      drums: { kick: 'X.........x.....', snare: '....o.......o...', hat: 'o.o.o.o.o.o.o.o.' }
    },
    // Volcano · "Magma Run": C minor, a driving lead over a pumping bass.
    psm_volcano_b: {
      bpm: 138,
      chords: ['Cm', 'Cm', 'Ab', 'Bb', 'Cm', 'Cm', 'Fm', 'G',
               'Ab', 'Bb', 'Cm', 'Ab', 'Fm', 'G', 'Ab', 'G'],
      melody: [{ inst: 'lead', vel: 0.9, bars: [
        'C5:2 -:2 C5:2 Eb5:2 G5:4 Eb5:2 C5:2', 'D5:2 Eb5:2 F5:2 G5:2 C6:4 G5:4', 'Ab5:4 G5:2 F5:2 Eb5:4 C5:4', 'D5:8 F5:4 Bb5:4',
        'C6:2 -:2 C6:2 Bb5:2 G5:4 Eb5:4', 'G5:2 Ab5:2 G5:2 F5:2 Eb5:4 G5:4', 'F5:2 Ab5:2 C6:4 Ab5:2 F5:2 C5:4', 'B4:4 D5:4 G5:4 B5:4',
        'C6:4 Ab5:2 C6:2 Eb6:4 C6:4', 'D6:4 Bb5:2 D6:2 F6:4 D6:4', 'Eb6:6 D6:2 C6:4 G5:4', 'Ab5:8 C6:8',
        'F6:2 Eb6:2 C6:4 Ab5:4 F5:4', 'G5:2 B5:2 D6:4 B5:4 G5:4', 'Ab5:4 C6:4 Eb6:4 C6:4', 'B5:4 G5:4 D5:4 B4:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.O.R.R.R.O.F.' },
        { inst: 'pluck', octave: 3, vel: 0.45, pattern: '0.1.2.1.0.1.2.1.' },
        { inst: 'pad', octave: 3, vel: 0.5, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X...X..xX...X...', snare: '....X.......X..x', hat: 'xoxoxoxoxoxoxoxo' }
    },
    // Volcano · "Ashfall": A phrygian, heavy and stomping.
    psm_volcano_c: {
      bpm: 128,
      chords: ['Am', 'Bb', 'Am', 'G', 'Am', 'Bb', 'C', 'G',
               'F', 'G', 'Am', 'Am', 'Dm', 'Bb', 'F', 'E'],
      melody: [{ inst: 'lead', vel: 0.9, bars: [
        'A4:2 -:2 A4:2 C5:2 E5:4 C5:2 A4:2', 'Bb4:2 -:2 Bb4:2 D5:2 F5:4 D5:2 Bb4:2', 'C5:2 E5:2 A5:4 G5:2 E5:2 C5:4', 'B4:8 D5:4 G5:4',
        'A5:2 -:2 A5:2 G5:2 E5:4 A5:4', 'Bb5:4 A5:2 F5:2 D5:4 F5:4', 'G5:4 E5:2 G5:2 C6:4 G5:4', 'B5:8 G5:4 D5:4',
        'A5:4 F5:2 A5:2 C6:4 A5:4', 'B5:4 G5:2 B5:2 D6:4 B5:4', 'C6:6 B5:2 A5:4 E5:4', 'A5:12 -:4',
        'D6:2 C6:2 A5:4 F5:4 D5:4', 'F5:2 Bb5:2 D6:4 Bb5:4 F5:4', 'A5:4 C6:4 F6:4 C6:4', 'G#5:4 B5:4 E5:4 G#4:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R..R..R.R..R..F.' },
        { inst: 'pluck', octave: 3, vel: 0.45, pattern: '0.2.0.2.1.2.0.2.' },
        { inst: 'pad', octave: 3, vel: 0.45, pattern: 'C---------------' }
      ],
      drums: { kick: 'X..x..x.X..x..x.', snare: '....X.......X...', hat: 'xoxoxoxoxoxoxoxo' }
    },
    // ---- rift arenas, one per family of types (and the game's own rift theme)
    // Fire, ground, rock · "Blazing Rift": E minor.
    psm_rift_fire: {
      bpm: 160,
      chords: ['Em', 'C', 'D', 'B', 'Em', 'C', 'Am', 'B',
               'C', 'D', 'Em', 'Em', 'Am', 'B', 'C', 'B'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'E5:2 G5:2 B5:4 A5:2 G5:2 E5:4', 'E5:2 G5:2 C6:4 B5:2 G5:2 E5:4', 'F#5:2 A5:2 D6:4 C6:2 A5:2 F#5:4', 'D#6:8 B5:4 F#5:4',
        'G5:2 G5:2 B5:2 G5:2 E6:4 D6:2 B5:2', 'C6:4 B5:2 G5:2 E5:4 G5:4', 'A5:2 C6:2 E6:4 C6:2 A5:2 E5:4', 'F#5:4 A5:4 B5:4 D#6:4',
        'E6:4 C6:2 E6:2 G6:4 E6:4', 'F#6:4 D6:2 F#6:2 A6:4 F#6:4', 'G6:6 F#6:2 E6:4 B5:4', 'E6:12 -:4',
        'C6:2 B5:2 A5:4 E6:4 C6:4', 'D#6:2 C#6:2 B5:4 F#6:4 D#6:4', 'E6:4 G6:4 E6:4 C6:4', 'B5:4 A5:4 F#5:4 D#5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.RRR.R.R.RRO.' },
        { inst: 'pluck', octave: 4, vel: 0.5, pattern: '0.1.2.3.2.1.0.1.' },
        { inst: 'pad', octave: 3, vel: 0.5, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X.x.X.x.X.x.X.xx', snare: '....X.......X..X', hat: 'xoxoxoxoxoxoxoxo' }
    },
    // Water, ice, flying · "Tidal Rift": D minor, flowing arpeggios.
    psm_rift_water: {
      bpm: 148,
      chords: ['Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A',
               'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A', 'Bb', 'A'],
      melody: [{ inst: 'lead', vel: 0.95, bars: [
        'D5:4 F5:2 A5:2 D6:6 C6:2', 'Bb5:4 F5:4 D5:4 F5:4', 'A5:4 C6:2 A5:2 F5:4 A5:4', 'G5:8 E5:4 C5:4',
        'F5:2 A5:2 D6:4 E6:2 F6:2 D6:4', 'D6:6 Bb5:2 F5:8', 'G5:4 Bb5:4 D6:4 Bb5:4', 'C#6:8 E6:4 A5:4',
        'D6:4 F6:4 D6:2 Bb5:2 F5:4', 'E6:4 G6:4 E6:2 C6:2 G5:4', 'F6:6 E6:2 D6:4 A5:4', 'D6:12 -:4',
        'Bb5:4 D6:4 G6:4 D6:4', 'C#6:4 E6:4 A6:4 E6:4', 'F6:4 D6:4 Bb5:4 F5:4', 'A5:4 E5:4 C#5:4 E5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 0.95, pattern: 'R...R.R.R...F.O.' },
        { inst: 'pluck', octave: 4, vel: 0.5, pattern: '0.2.3.4.3.2.0.2.' },
        { inst: 'pad', octave: 3, vel: 0.6, pattern: 'C---------------' }
      ],
      drums: { kick: 'X.....x.X.......', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', shaker: '.o.o.o.o.o.o.o.o' }
    },
    // Grass, bug, fairy, normal · "Wild Rift": G minor, flute over bells.
    psm_rift_nature: {
      bpm: 152,
      chords: ['Gm', 'Eb', 'F', 'D', 'Gm', 'Eb', 'Cm', 'D',
               'Eb', 'F', 'Gm', 'Gm', 'Cm', 'D', 'Eb', 'D'],
      melody: [{ inst: 'flute', vel: 1, bars: [
        'G5:2 Bb5:2 D6:4 C6:2 Bb5:2 G5:4', 'G5:2 Bb5:2 Eb6:4 D6:2 Bb5:2 G5:4', 'A5:2 C6:2 F6:4 Eb6:2 C6:2 A5:4', 'F#5:8 A5:4 D6:4',
        'D6:2 D6:2 Bb5:2 D6:2 G6:4 F6:2 D6:2', 'Eb6:4 D6:2 Bb5:2 G5:4 Bb5:4', 'C6:2 Eb6:2 G6:4 Eb6:2 C6:2 G5:4', 'A5:4 F#5:4 D5:4 F#5:4',
        'G5:4 Bb5:4 Eb6:4 Bb5:4', 'A5:4 C6:4 F6:4 C6:4', 'Bb5:6 A5:2 G5:4 D5:4', 'G5:12 -:4',
        'Eb6:2 D6:2 C6:4 G5:4 Eb5:4', 'F#5:2 A5:2 D6:4 C6:4 A5:4', 'Bb5:4 G5:4 Eb5:4 G5:4', 'A5:4 F#5:4 D5:4 F#5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.F.R.R.R.F.O.' },
        { inst: 'bell', octave: 4, vel: 0.45, pattern: '0...2...3...2...' },
        { inst: 'pluck', octave: 3, vel: 0.4, pattern: '.0.1.0.2.0.1.0.2' }
      ],
      drums: { kick: 'X.x...x.X.x...x.', snare: '....X.......X...', shaker: 'xoxoxoxoxoxoxoxo' }
    },
    // Electric, steel, psychic · "Static Rift": B minor, quick and staccato.
    psm_rift_spark: {
      bpm: 168,
      chords: ['Bm', 'G', 'A', 'F#', 'Bm', 'G', 'Em', 'F#',
               'G', 'A', 'Bm', 'Bm', 'Em', 'F#', 'G', 'F#'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'B5:2 -:2 B5:2 D6:2 F#6:2 -:2 D6:2 B5:2', 'B5:2 -:2 B5:2 D6:2 G6:2 -:2 D6:2 B5:2', 'C#6:2 -:2 C#6:2 E6:2 A6:4 E6:2 C#6:2', 'A#5:8 C#6:4 F#6:4',
        'F#6:2 E6:2 D6:2 C#6:2 B5:4 F#5:4', 'G5:2 B5:2 D6:2 G6:2 D6:4 B5:4', 'E6:2 G6:2 B6:4 G6:2 E6:2 B5:4', 'C#6:4 A#5:4 F#5:4 A#5:4',
        'D6:2 D6:2 B5:2 D6:2 G6:4 D6:4', 'E6:2 E6:2 C#6:2 E6:2 A6:4 E6:4', 'F#6:6 E6:2 D6:4 B5:4', 'B5:12 -:4',
        'G6:2 F#6:2 E6:4 B5:4 G5:4', 'A#5:2 C#6:2 F#6:4 C#6:4 A#5:4', 'B5:4 D6:4 G6:4 D6:4', 'C#6:4 A#5:4 F#5:4 A#5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.RRR.RRR.RRO.FO' },
        { inst: 'pluck', octave: 4, vel: 0.45, pattern: '0.0.2.0.1.0.2.0.' },
        { inst: 'pad', octave: 3, vel: 0.45, pattern: 'C---------------' }
      ],
      drums: { kick: 'X.x.X.x.X.x.X.x.', snare: '....X.......X.X.', hat: 'xoxoxoxoxoxoxoxo' }
    },
    // Ghost, dark, poison · "Shadow Rift": C minor with a dark D-flat.
    psm_rift_shadow: {
      bpm: 140,
      chords: ['Cm', 'Ab', 'Fm', 'G', 'Cm', 'Ab', 'Db', 'G',
               'Fm', 'Gm', 'Cm', 'Cm', 'Ab', 'Fm', 'Db', 'G'],
      melody: [{ inst: 'lead', vel: 0.9, bars: [
        'C5:4 Eb5:4 G5:6 F5:2', 'Eb5:4 C5:4 Ab4:8', 'F5:4 Ab5:4 C6:4 Bb5:2 Ab5:2', 'G5:8 B4:4 D5:4',
        'Eb5:2 G5:2 C6:4 D6:2 Eb6:2 C6:4', 'C6:6 Ab5:2 Eb5:8', 'Db6:4 F5:4 Ab5:4 Db6:4', 'B5:8 D6:4 G5:4',
        'Ab5:2 C6:2 F6:4 Eb6:2 C6:2 Ab5:4', 'Bb5:2 D6:2 G6:4 F6:2 D6:2 Bb5:4', 'C6:6 Eb6:2 G6:4 Eb6:4', 'C6:12 -:4',
        'Eb6:4 C6:2 Ab5:2 Eb5:4 Ab5:4', 'F5:4 Ab5:4 C6:4 F6:4', 'F6:4 Db6:4 Ab5:4 F5:4', 'B5:4 G5:4 D5:4 B4:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R..RR..RR..RF.O.' },
        { inst: 'bell', octave: 4, vel: 0.5, pattern: '0.......2...1...' },
        { inst: 'pad', octave: 3, vel: 0.75, pattern: 'C---------------' }
      ],
      drums: { kick: 'X..x....X..x..x.', snare: '....X.......X...', hat: '..x...x...x...x.' }
    },
    // Dragon, fighting · "Dragon Rift": F# minor, heroic and soaring.
    psm_rift_dragon: {
      bpm: 158,
      chords: ['F#m', 'D', 'A', 'E', 'F#m', 'D', 'Bm', 'C#',
               'D', 'E', 'F#m', 'F#m', 'Bm', 'C#m', 'D', 'C#'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'F#5:2 A5:2 C#6:4 F#6:4 E6:2 C#6:2', 'D6:4 A5:2 D6:2 F#6:4 D6:4', 'E6:4 C#6:2 E6:2 A6:4 E6:4', 'G#6:8 E6:4 B5:4',
        'A6:2 G#6:2 F#6:2 E6:2 C#6:4 A5:4', 'F#5:2 A5:2 D6:4 A5:4 F#5:4', 'B5:2 D6:2 F#6:4 E6:2 D6:2 B5:4', 'E#6:8 G#6:4 C#6:4',
        'F#6:4 D6:2 F#6:2 A6:4 F#6:4', 'G#6:4 E6:2 G#6:2 B6:4 G#6:4', 'A6:6 G#6:2 F#6:4 C#6:4', 'F#6:12 -:4',
        'D6:2 C#6:2 B5:4 F#5:4 B5:4', 'E6:2 D#6:2 C#6:4 G#5:4 C#6:4', 'F#6:4 A6:4 F#6:4 D6:4', 'C#6:4 G#5:4 E#5:4 G#5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.RR.RR.R.RRF.' },
        { inst: 'pluck', octave: 4, vel: 0.5, pattern: '0.2.3.2.0.2.3.4.' },
        { inst: 'pad', octave: 3, vel: 0.55, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X..xX.x.X..xX.x.', snare: '....X.......X..X', hat: 'xoxoxoxoxoxoxoxo' }
    },
  };
  const PSM_MENU_MUSIC = {
    // Menu · "Campfire Evening": D major, warm and lazy.
    psm_menu_b: {
      bpm: 92, swing: 0.2,
      chords: ['D', 'A/C#', 'Bm', 'G', 'D', 'A', 'G', 'A',
               'Bm', 'F#m', 'G', 'D', 'Em', 'A', 'G', 'A'],
      melody: [{ inst: 'flute', vel: 0.95, bars: [
        'F#5:4 A5:2 F#5:2 D5:4 A4:4', 'E5:6 C#5:2 A4:4 -:4', 'D5:4 F#5:2 D5:2 B4:4 D5:4', 'B4:12 -:4',
        'A5:4 D6:2 C#6:2 A5:4 F#5:4', 'C#6:6 B5:2 A5:4 E5:4', 'D5:4 G5:4 B5:4 A5:2 G5:2', 'A5:8 E5:4 C#5:4',
        'B4:4 D5:4 F#5:4 E5:2 D5:2', 'C#5:6 F#5:2 A5:8', 'B5:4 A5:2 G5:2 D5:4 G5:4', 'F#5:8 A5:4 D6:4',
        'E5:4 G5:4 B5:4 G5:4', 'C#6:4 B5:2 A5:2 E5:4 C#5:4', 'D5:4 B4:4 G4:4 B4:4', 'A4:4 C#5:4 E5:4 G5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, useBass: true, vel: 0.85, pattern: 'R-----F-O-----F-' },
        { inst: 'pluck', octave: 4, vel: 0.45, pattern: '0..1..2..3..2.1.' },
        { inst: 'pad', octave: 3, vel: 0.8, pattern: 'C---------------' }
      ],
      drums: { kick: 'x.......x.......', snare: '........o.......', shaker: 'o.x.o.x.o.x.o.x.' }
    },
    // Menu · "Morning Market": C major, bright bells.
    psm_menu_c: {
      bpm: 108, swing: 0.15,
      chords: ['C', 'G', 'Am', 'F', 'C', 'G', 'F', 'G',
               'Am', 'Em', 'F', 'C', 'Dm', 'G', 'C', 'G'],
      melody: [{ inst: 'bell', vel: 0.8, bars: [
        'E5:2 G5:2 C6:4 G5:2 E5:2 G5:4', 'D5:2 G5:2 B5:4 G5:2 D5:2 G5:4', 'C5:2 E5:2 A5:4 G5:2 E5:2 C5:4', 'A4:4 C5:4 F5:8',
        'G5:4 E5:2 G5:2 C6:4 B5:2 C6:2', 'D6:6 B5:2 G5:8', 'A5:4 C6:4 A5:4 F5:4', 'G5:8 B4:4 D5:4',
        'E5:4 A5:4 C6:6 B5:2', 'B5:4 G5:4 E5:8', 'F5:4 A5:4 C6:4 A5:4', 'G5:8 E5:4 C5:4',
        'D5:4 F5:4 A5:4 F5:4', 'B5:4 G5:4 D5:4 F5:4', 'E5:4 G5:4 C6:8', 'D6:4 B5:4 G5:4 F5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 0.85, pattern: 'R...F...O...F...' },
        { inst: 'pluck', octave: 4, vel: 0.4, pattern: '.0.1.2.1.0.1.2.1' },
        { inst: 'pad', octave: 3, vel: 0.55, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'x.......x.......', snare: '....o.......o...', hat: 'o.o.o.o.o.o.o.o.' }
    },
    // Menu · "Starlit Pond": F major, slow and soft.
    psm_menu_d: {
      bpm: 84, swing: 0.1,
      chords: ['F', 'Dm', 'Bb', 'C', 'F', 'Am', 'Bb', 'C',
               'Dm', 'Am', 'Bb', 'F', 'Gm', 'C', 'F', 'C'],
      melody: [{ inst: 'flute', vel: 0.8, bars: [
        'C5:6 F5:2 A5:8', 'A5:4 F5:4 D5:8', 'D5:4 F5:4 Bb5:6 A5:2', 'G5:12 -:4',
        'A5:4 C6:4 A5:4 F5:4', 'E5:6 A5:2 C6:8', 'D6:4 C6:2 Bb5:2 F5:8', 'E5:8 G5:8',
        'F5:4 A5:4 D6:8', 'C6:4 A5:4 E5:8', 'D5:4 F5:4 Bb5:4 A5:2 G5:2', 'A5:12 -:4',
        'Bb5:4 G5:4 D5:8', 'E5:4 G5:4 C6:6 Bb5:2', 'A5:4 F5:4 C5:8', 'E5:4 G5:4 Bb5:4 G5:4'] }],
      parts: [
        { inst: 'bell', octave: 4, vel: 0.4, pattern: '0...2...4...2...' },
        { inst: 'bass', octave: 2, vel: 0.7, pattern: 'R-------F-------' },
        { inst: 'pad', octave: 3, vel: 0.9, pattern: 'C---------------' }
      ],
      drums: { shaker: '..o...o...o...o.' }
    },
  };
  Object.assign(PSM_MUSIC, PSM_MENU_MUSIC);
  // 0.14: two more for every place and fight.
  const PSM_MUSIC_2 = {
    // Menu · "Sunday Picnic": D major, bouncy, plucked arpeggios.
    psm_menu_e: {
      bpm: 108, swing: 0.2,
      chords: ['D', 'A/C#', 'Bm', 'G', 'D', 'A', 'G', 'A',
               'G', 'A', 'F#m', 'Bm', 'Em', 'A', 'D', 'A'],
      melody: [{ inst: 'flute', vel: 1, bars: [
        'F#5:4 A5:2 F#5:2 D5:4 F#5:2 A5:2', 'E5:6 C#5:2 A4:4 C#5:4', 'D5:4 F#5:4 B5:6 A5:2', 'G5:8 B5:4 D6:4',
        'A5:4 F#5:2 A5:2 D6:4 A5:4', 'C#6:4 B5:2 A5:2 E5:4 A5:4', 'B5:4 G5:2 E5:2 D5:4 G5:4', 'A5:8 E5:4 C#5:4',
        'D5:2 G5:2 B5:4 D6:4 B5:4', 'C#6:2 B5:2 A5:4 E5:4 A5:4', 'F#5:4 A5:4 C#6:6 A5:2', 'B5:8 F#5:4 D5:4',
        'E5:4 G5:2 B5:2 E6:4 B5:4', 'C#6:4 A5:4 E5:4 C#5:4', 'D5:4 F#5:4 A5:4 D6:4', 'C#6:8 E5:4 A4:4'] }],
      parts: [
        { inst: 'bass', octave: 2, useBass: true, vel: 0.85, pattern: 'R..R..F.R..R..O.' },
        { inst: 'pluck', octave: 4, vel: 0.5, pattern: '0.2.4.2.1.2.4.2.' },
        { inst: 'pad', octave: 3, vel: 0.5, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'x.....x.x.......', snare: '....o.......o..o', shaker: 'oxo.oxo.oxo.oxo.' }
    },
    // Menu · "Lantern Lullaby": E flat major, slow bells, almost no drums.
    psm_menu_f: {
      bpm: 84, swing: 0.1,
      chords: ['Eb', 'Bb/D', 'Cm', 'Ab', 'Eb', 'Bb', 'Ab', 'Bb'],
      melody: [{ inst: 'bell', vel: 0.8, bars: [
        'G5:6 Bb5:2 Eb6:4 Bb5:4', 'D6:4 C6:2 Bb5:2 F5:8', 'Eb6:4 D6:2 C6:2 G5:4 C6:4', 'C6:12 -:4',
        'Bb5:4 G5:4 Eb5:4 G5:4', 'F5:6 Bb5:2 D6:4 F6:4', 'Eb6:4 C6:4 Ab5:4 C6:2 Eb6:2', 'D6:8 F5:4 Bb5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, useBass: true, vel: 0.7, pattern: 'R-------F-------' },
        { inst: 'pluck', octave: 4, vel: 0.35, pattern: '..0...2...1...2.' },
        { inst: 'pad', octave: 3, vel: 0.9, pattern: 'C---------------' }
      ],
      drums: { kick: 'o.......o.......', shaker: '..o...o...o...o.' }
    },
    // Forest · "Canopy Chase": A minor, quick running eighths.
    psm_forest_d: {
      bpm: 128,
      chords: ['Am', 'Em', 'F', 'G', 'Am', 'Em', 'Dm', 'E',
               'F', 'C', 'G', 'Am', 'F', 'G', 'E', 'E'],
      melody: [{ inst: 'flute', vel: 1, bars: [
        'A5:2 B5:2 C6:2 E6:2 A5:4 C6:4', 'B5:2 G5:2 E5:2 G5:2 B5:4 E6:4', 'C6:2 A5:2 F5:2 A5:2 C6:2 D6:2 C6:2 A5:2', 'B5:4 D6:4 G5:8',
        'E6:2 D6:2 C6:2 B5:2 A5:4 E5:4', 'G5:2 A5:2 B5:2 G5:2 E5:4 B4:4', 'F5:2 E5:2 D5:2 F5:2 A5:4 D6:4', 'G#5:4 B5:4 E6:8',
        'A5:2 C6:2 F6:4 C6:2 A5:2 F5:4', 'G5:2 E5:2 C5:2 E5:2 G5:4 C6:4', 'D6:4 B5:2 G5:2 D5:4 G5:4', 'C6:4 A5:4 E5:8',
        'F5:2 G5:2 A5:2 C6:2 F6:4 C6:4', 'G5:2 A5:2 B5:2 D6:2 G6:4 D6:4', 'E6:2 D6:2 B5:2 G#5:2 E5:4 G#5:4', 'B5:8 E5:8'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 0.9, pattern: 'R.R.F.R.R.R.O.R.' },
        { inst: 'pluck', octave: 4, vel: 0.45, pattern: '0121012101210121' }
      ],
      drums: { kick: 'X...x.X...X.x...', snare: '....X.......X.x.', hat: 'xxoxxxoxxxoxxxox' }
    },
    // Forest · "Firefly Hollow": C major with a bright D chord, twinkling.
    psm_forest_e: {
      bpm: 112, swing: 0.1,
      chords: ['C', 'D', 'Em', 'D', 'C', 'D', 'G', 'G',
               'Am', 'D', 'Em', 'C', 'Am', 'D', 'G', 'G'],
      melody: [{ inst: 'flute', vel: 0.9, bars: [
        'E5:4 G5:4 C6:6 B5:2', 'A5:2 D6:2 F#6:4 A6:4 F#6:4', 'G5:6 B5:2 E6:8', 'F#6:4 E6:2 D6:2 A5:8',
        'G5:4 E5:2 G5:2 C6:4 E6:4', 'D6:4 C6:2 A5:2 F#5:4 A5:4', 'B5:6 D6:2 G6:8', 'D6:4 B5:4 G5:4 -:4',
        'C6:4 E6:4 A5:6 B5:2', 'F#5:4 A5:2 D6:2 F#6:8', 'E6:4 D6:2 B5:2 G5:4 B5:4', 'C6:8 G5:4 E5:4',
        'A5:4 C6:4 E6:4 C6:4', 'D6:4 F#6:4 A6:4 F#6:4', 'G6:6 F#6:2 D6:4 B5:4', 'G5:8 D5:4 B4:4'] }],
      parts: [
        { inst: 'bell', octave: 4, vel: 0.45, pattern: '..2...0...2...1.' },
        { inst: 'bass', octave: 2, vel: 0.8, pattern: 'R...F...R...O...' },
        { inst: 'pad', octave: 3, vel: 0.5, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'x.......x..x....', snare: '....o.......o...', hat: '..x...x...x...xo' }
    },
    // Cave · "Dripstone Maze": D minor, a plucked ostinato and dripping hats.
    psm_cave_d: {
      bpm: 96, swing: 0.05,
      chords: ['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A',
               'Bb', 'F', 'C', 'Dm', 'Gm', 'Dm', 'Bb', 'A'],
      melody: [{ inst: 'bell', vel: 0.7, bars: [
        'A5:4 -:4 F5:4 -:4', 'D6:4 -:2 A5:2 F5:8', 'F5:4 -:4 D5:4 F5:4', 'E5:8 G5:4 C6:4',
        'F5:4 -:4 A5:4 -:4', 'D6:6 C6:2 A5:8', 'Bb5:4 -:4 D6:4 G5:4', 'C#6:8 E6:4 -:4',
        'D6:4 F6:4 D6:4 Bb5:4', 'C6:8 A5:4 F5:4', 'E5:4 G5:4 C6:4 E6:4', 'D6:12 -:4',
        'G5:4 Bb5:4 D6:6 C6:2', 'A5:4 F5:4 D5:8', 'F5:4 D5:4 Bb4:4 D5:4', 'E5:8 C#5:4 A4:4'] }],
      parts: [
        { inst: 'pluck', octave: 3, vel: 0.55, pattern: '0.2.0.2.1.2.0.2.' },
        { inst: 'bass', octave: 2, vel: 0.8, pattern: 'R-------R-----F-' },
        { inst: 'pad', octave: 3, vel: 0.7, pattern: 'C---------------' }
      ],
      drums: { kick: 'o.....o.o.......', hat: '...o.o.....o..o.' }
    },
    // Cave · "Glowworm Depths": B minor, very slow, held notes over a deep pad.
    psm_cave_e: {
      bpm: 80,
      chords: ['Bm', 'G', 'D', 'A', 'Bm', 'G', 'Em', 'F#'],
      melody: [{ inst: 'flute', vel: 0.75, bars: [
        'F#5:8 D5:4 B4:4', 'G5:6 B5:2 D6:8', 'F#5:8 A5:8', 'E5:12 C#5:4',
        'B5:6 A5:2 F#5:8', 'G5:4 B5:4 D6:8', 'E6:8 B5:4 G5:4', 'F#5:8 A#5:4 C#6:4'] }],
      parts: [
        { inst: 'pad', octave: 3, vel: 1, pattern: 'C---------------' },
        { inst: 'bell', octave: 4, vel: 0.4, pattern: '0.......2.......' },
        { inst: 'bass', octave: 2, vel: 0.7, pattern: 'R---------------' }
      ],
      drums: { kick: 'o...............', hat: '........o.......' }
    },
    // Volcano · "Obsidian March": C minor, heavy and steady.
    psm_volcano_d: {
      bpm: 138,
      chords: ['Cm', 'Ab', 'Bb', 'G', 'Cm', 'Ab', 'Fm', 'G'],
      melody: [{ inst: 'lead', vel: 0.9, bars: [
        'C5:2 -:2 C5:2 Eb5:2 G5:4 Eb5:4', 'Ab5:2 -:2 Ab5:2 G5:2 Eb5:4 C5:4', 'D5:2 F5:2 Bb5:4 F5:2 D5:2 Bb4:4', 'B4:4 D5:4 G5:8',
        'G5:2 Ab5:2 G5:2 Eb5:2 C6:4 G5:4', 'Eb6:4 C6:2 Ab5:2 Eb5:4 Ab5:4', 'F5:2 Ab5:2 C6:4 Ab5:2 F5:2 C5:4', 'D5:4 G5:4 B5:4 D6:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'RR..RR..RR..RRF.' },
        { inst: 'pluck', octave: 3, vel: 0.5, pattern: '0..0..1..0..2...' },
        { inst: 'pad', octave: 3, vel: 0.5, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X...X...X...X.X.', snare: '....X..x....X...', hat: 'x.x.x.x.x.x.x.x.' }
    },
    // Volcano · "Eruption": G minor, fast, the melody climbing to the top.
    psm_volcano_e: {
      bpm: 146,
      chords: ['Gm', 'Eb', 'F', 'D', 'Gm', 'Eb', 'Cm', 'D',
               'Eb', 'F', 'Gm', 'Gm', 'Ab', 'D', 'Eb', 'D'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'G5:2 Bb5:2 D6:2 Bb5:2 G5:4 D5:4', 'Eb6:2 D6:2 Bb5:2 G5:2 Eb5:4 G5:4', 'F5:2 A5:2 C6:2 A5:2 F6:4 C6:4', 'F#5:4 A5:4 D6:8',
        'D6:2 C6:2 Bb5:2 A5:2 G5:4 Bb5:4', 'G5:2 F5:2 Eb5:2 F5:2 G5:4 Bb5:4', 'C6:4 Eb6:4 G6:4 Eb6:4', 'D6:8 F#6:4 A6:4',
        'G6:4 F6:2 Eb6:2 Bb5:4 G5:4', 'A5:4 C6:2 F6:2 A6:8', 'Bb6:4 A6:2 G6:2 D6:4 Bb5:4', 'G6:12 -:4',
        'Eb6:2 D6:2 C6:2 G5:2 Eb6:4 C6:4', 'F#6:2 E6:2 D6:2 A5:2 F#6:4 D6:4', 'G6:4 Eb6:4 Bb5:4 G5:4', 'A5:4 F#5:4 D5:4 -:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'RRR.RRR.RRR.RFO.' },
        { inst: 'pluck', octave: 4, vel: 0.45, pattern: '0.1.2.3.2.1.0.1.' },
        { inst: 'pad', octave: 3, vel: 0.45, pattern: 'C---C---C---C---' }
      ],
      drums: { kick: 'X.xX.xX.X.xX.xX.', snare: '....X.......X...', hat: 'xxxoxxxoxxxoxxxo' }
    },
    // Boss · "Clash of Fangs": D minor, running arpeggios.
    psm_boss_b: {
      bpm: 156,
      chords: ['Dm', 'Bb', 'C', 'A', 'Dm', 'Bb', 'Gm', 'A'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'D5:2 F5:2 A5:2 F5:2 D6:2 C6:2 A5:2 F5:2', 'Bb5:2 A5:2 F5:2 D5:2 Bb4:4 D5:4', 'C6:2 E6:2 G6:2 E6:2 C6:4 G5:4', 'A5:4 C#6:4 E6:4 A6:4',
        'F6:2 E6:2 D6:2 A5:2 F5:4 A5:4', 'D6:2 C6:2 Bb5:2 F5:2 D5:4 F5:4', 'G5:2 Bb5:2 D6:2 Bb5:2 G6:4 D6:4', 'E6:4 C#6:4 A5:4 E5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.RRR.R.R.RRF.' },
        { inst: 'pluck', octave: 4, vel: 0.5, pattern: '0.2.0.2.1.2.1.3.' }
      ],
      drums: { kick: 'X.X.X.x.X.X.X.x.', snare: '....X..x....X.XX', hat: 'x.xxx.xxx.xxx.xx' }
    },
    // Boss · "Iron Will": F sharp minor, 3-3-2 rhythm.
    psm_boss_c: {
      bpm: 148,
      chords: ['F#m', 'D', 'E', 'C#', 'F#m', 'D', 'Bm', 'C#'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'F#5:3 F#5:3 A5:2 C#6:4 A5:4', 'D6:3 C#6:3 A5:2 F#5:4 A5:4', 'E5:3 G#5:3 B5:2 E6:4 B5:4', 'C#6:8 G#5:8',
        'A5:3 C#6:3 F#6:2 E6:4 C#6:4', 'F#6:3 E6:3 D6:2 A5:4 F#5:4', 'B5:4 D6:4 F#6:4 D6:4', 'C#6:4 G#5:4 C#6:4 G#6:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R..R..R.R..R..F.' },
        { inst: 'pluck', octave: 4, vel: 0.5, pattern: '0..1..2.0..1..3.' },
        { inst: 'pad', octave: 3, vel: 0.4, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X..X..X.X..X..x.', snare: '....X.......X...', hat: 'oxo.oxo.oxo.oxox' }
    },
    // Judgment · "Final Verdict": C minor, bells on every beat.
    psm_judg_b: {
      bpm: 136,
      chords: ['Cm', 'Ab', 'Fm', 'G', 'Cm', 'Db', 'Bb', 'G',
               'Ab', 'Bb', 'Cm', 'Cm', 'Fm', 'G', 'Cm', 'G'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'G4:4 C5:4 Eb5:6 D5:2', 'C5:4 Eb5:4 Ab5:8', 'Ab5:4 F5:4 C5:4 F5:2 G5:2', 'G5:8 B5:4 D6:4',
        'C6:6 Bb5:2 G5:4 Eb5:4', 'F5:4 Db5:4 F5:4 Ab5:4', 'Bb5:4 D6:2 F6:2 D6:4 Bb5:4', 'B5:12 -:4',
        'C6:2 C6:2 Eb6:4 C6:4 Ab5:4', 'D6:2 D6:2 F6:4 D6:4 Bb5:4', 'G5:4 C6:4 Eb6:4 D6:2 C6:2', 'C6:8 G5:8',
        'Ab5:4 C6:4 F6:4 Eb6:2 C6:2', 'D6:4 B5:4 G5:4 B5:4', 'Eb6:4 G6:4 C7:4 G6:4', 'G6:4 D6:4 B5:4 G5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.R.R.F.F.O.O.' },
        { inst: 'bell', octave: 4, vel: 0.6, pattern: '0...0...0...2...' },
        { inst: 'pad', octave: 3, vel: 0.7, pattern: 'C---------------' }
      ],
      drums: { kick: 'X...X..xX...X..x', snare: '....X.......X..X', hat: 'o.x.o.x.o.x.o.x.' }
    },
    // Judgment · "Hall of Origin": E phrygian, relentless.
    psm_judg_c: {
      bpm: 144,
      chords: ['Em', 'F', 'G', 'F', 'Em', 'C', 'Am', 'B'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'E5:2 G5:2 B5:4 E6:4 B5:4', 'F5:2 A5:2 C6:4 F6:4 C6:4', 'G5:2 B5:2 D6:4 G6:4 D6:4', 'A6:4 F6:4 C6:4 A5:4',
        'B5:2 C6:2 B5:2 G5:2 E5:4 G5:4', 'C6:2 D6:2 E6:2 G6:2 E6:4 C6:4', 'A5:2 C6:2 E6:4 A6:4 E6:4', 'D#6:4 F#6:4 B6:8'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'RR.RR.RRF.F.OO.O' },
        { inst: 'bell', octave: 3, vel: 0.8, pattern: '0.......0.......' },
        { inst: 'pad', octave: 3, vel: 0.7, pattern: 'C---------------' }
      ],
      drums: { kick: 'XxX.XxX.XxX.Xx.x', snare: '....X.......X...', hat: 'oooxoooxoooxooox' }
    },
    // Fire rifts · "Cinder Duel": E minor, high arpeggios.
    psm_rift_fire_b: {
      bpm: 160,
      chords: ['Em', 'C', 'D', 'B', 'Em', 'C', 'Am', 'B'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'E6:2 B5:2 G5:2 B5:2 E6:4 G6:4', 'G6:2 E6:2 C6:2 E6:2 G6:4 C7:4', 'F#6:2 D6:2 A5:2 D6:2 F#6:4 A6:4', 'F#6:4 D#6:4 B5:8',
        'G6:2 F#6:2 E6:2 B5:2 G5:4 B5:4', 'E6:2 D6:2 C6:2 G5:2 E5:4 G5:4', 'A5:2 C6:2 E6:2 A6:2 E6:4 C6:4', 'D#6:4 F#6:4 B6:4 F#6:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.R.RRR.R.R.RF' },
        { inst: 'pluck', octave: 4, vel: 0.5, pattern: '0.2.1.2.0.2.1.2.' },
        { inst: 'pad', octave: 3, vel: 0.5, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X.x.X.xxX.x.X.xx', snare: '....X..x....X..X', hat: 'xoxxxoxxxoxxxoxx' }
    },
    // Fire rifts · "Scorched Arena": A phrygian, a hot flat second.
    psm_rift_fire_c: {
      bpm: 150,
      chords: ['Am', 'Bb', 'Am', 'G', 'F', 'Bb', 'Dm', 'E'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'A5:4 C6:4 E6:4 C6:4', 'D6:4 F6:4 Bb5:8', 'C6:2 B5:2 A5:2 E5:2 A5:4 C6:4', 'B5:4 D6:4 G6:8',
        'A6:2 G6:2 F6:2 C6:2 A5:4 C6:4', 'Bb5:2 D6:2 F6:2 D6:2 Bb6:4 F6:4', 'A6:4 F6:4 D6:4 A5:4', 'G#5:4 B5:4 E6:4 G#6:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'RR.RR.R.RR.RR.F.' },
        { inst: 'pluck', octave: 3, vel: 0.45, pattern: '00.10.20.10.20.1' }
      ],
      drums: { kick: 'X..xX.x.X..xX.x.', snare: '....X.......X.X.', hat: 'x.xox.xox.xox.xo' }
    },
    // Water rifts · "Undertow": G minor, flowing sixteenths underneath.
    psm_rift_water_b: {
      bpm: 152,
      chords: ['Gm', 'Eb', 'Bb', 'F', 'Gm', 'Eb', 'Cm', 'D'],
      melody: [{ inst: 'lead', vel: 0.95, bars: [
        'D6:4 Bb5:2 G5:2 D5:4 G5:4', 'Eb6:4 Bb5:2 G5:2 Eb5:4 G5:4', 'F6:4 D6:2 Bb5:2 F5:4 Bb5:4', 'A5:4 C6:4 F6:8',
        'G6:2 F6:2 D6:2 Bb5:2 G5:4 D6:4', 'G6:2 F6:2 Eb6:2 Bb5:2 G5:4 Eb6:4', 'Eb6:4 G6:4 C7:4 G6:4', 'F#6:4 D6:4 A5:4 F#5:4'] }],
      parts: [
        { inst: 'pluck', octave: 4, vel: 0.4, pattern: '0123210101232101' },
        { inst: 'bass', octave: 2, vel: 0.95, pattern: 'R.R..R.RR.R..R.F' },
        { inst: 'pad', octave: 3, vel: 0.55, pattern: 'C---------------' }
      ],
      drums: { kick: 'X.....X.X.....X.', snare: '....X.......X...', shaker: 'oxoxoxoxoxoxoxox' }
    },
    // Water rifts · "Frozen Gale": B minor, icy bells and driving hats.
    psm_rift_water_c: {
      bpm: 158,
      chords: ['Bm', 'G', 'A', 'F#', 'Bm', 'G', 'Em', 'F#'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'B5:4 D6:4 F#6:4 D6:4', 'G6:2 F#6:2 D6:2 B5:2 G5:4 B5:4', 'A5:2 C#6:2 E6:2 C#6:2 A6:4 E6:4', 'F#6:4 C#6:4 A#5:8',
        'D6:2 C#6:2 B5:2 F#5:2 D5:4 F#5:4', 'B5:2 A5:2 G5:2 D5:2 B4:4 D5:4', 'E5:2 G5:2 B5:2 E6:2 G6:4 B6:4', 'A#6:4 F#6:4 C#6:4 A#5:4'] }],
      parts: [
        { inst: 'bell', octave: 4, vel: 0.4, pattern: '0.2.4.2.0.2.4.2.' },
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.R.R.R.R.F.F.' },
        { inst: 'pad', octave: 3, vel: 0.5, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X.x.X...X.x.X...', snare: '....X.......X..x', hat: 'xxxxxxxxxxxxxxxx' }
    },
    // Nature rifts · "Thornwild": D dorian, folk dance at full speed.
    psm_rift_nature_b: {
      bpm: 150,
      chords: ['Dm', 'G', 'Dm', 'G', 'C', 'Am', 'Dm', 'A'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'D6:2 F6:2 A6:4 F6:2 D6:2 A5:4', 'B5:2 D6:2 G6:4 D6:2 B5:2 G5:4', 'A5:2 D6:2 F6:4 A6:4 F6:4', 'G6:4 D6:4 B5:8',
        'C6:2 E6:2 G6:4 E6:2 C6:2 G5:4', 'A5:2 C6:2 E6:4 C6:2 A5:2 E5:4', 'F5:2 A5:2 D6:4 F6:4 D6:4', 'C#6:4 E6:4 A6:8'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 0.95, pattern: 'R.FR.FR.R.FR.FO.' },
        { inst: 'pluck', octave: 4, vel: 0.5, pattern: '0.0.2.0.1.0.2.0.' }
      ],
      drums: { kick: 'X..x.xX.X..x.xX.', snare: '....X.......X...', shaker: 'x.oxx.oxx.oxx.ox' }
    },
    // Nature rifts · "Bloom Fury": F major, bright and fierce.
    psm_rift_nature_c: {
      bpm: 156,
      chords: ['F', 'C', 'Dm', 'Bb', 'F', 'C', 'Bb', 'C'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'F5:2 A5:2 C6:2 F6:2 A6:4 F6:4', 'G6:2 E6:2 C6:2 G5:2 E5:4 G5:4', 'A5:2 D6:2 F6:2 A6:2 F6:4 D6:4', 'D6:2 F6:2 Bb6:4 F6:4 D6:4',
        'C7:2 A6:2 F6:2 C6:2 A5:4 C6:4', 'E6:2 G6:2 C7:2 G6:2 E6:4 C6:4', 'D6:2 C6:2 Bb5:2 F5:2 D6:4 F6:4', 'E6:4 G6:4 C7:8'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.F.R.R.R.O.F.' },
        { inst: 'bell', octave: 4, vel: 0.45, pattern: '0.2.3.2.0.2.3.2.' },
        { inst: 'pad', octave: 3, vel: 0.45, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X.xxX.x.X.xxX.x.', snare: '....X.......X...', hat: 'xooxxooxxooxxoox' }
    },
    // Electric / psychic rifts · "Overcharge": C sharp minor, buzzing sixteenths.
    psm_rift_spark_b: {
      bpm: 168,
      chords: ['C#m', 'A', 'B', 'G#', 'C#m', 'A', 'F#m', 'G#'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'C#6:2 E6:2 G#6:2 E6:2 C#6:2 E6:2 G#6:2 C#7:2', 'A6:2 E6:2 C#6:2 E6:2 A6:2 E6:2 C#6:2 A5:2', 'B5:2 D#6:2 F#6:2 D#6:2 B6:4 F#6:4', 'G#6:4 D#6:4 G#5:8',
        'E6:2 D#6:2 C#6:2 G#5:2 E5:4 G#5:4', 'C#6:2 B5:2 A5:2 E5:2 C#5:4 E5:4', 'F#5:2 A5:2 C#6:2 F#6:2 A6:4 C#7:4', 'G#5:4 C6:4 D#6:4 G#6:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 0.9, pattern: 'RRRRRRRRRRRRFFOO' },
        { inst: 'pluck', octave: 4, vel: 0.4, pattern: '0.2.0.2.0.2.0.2.' }
      ],
      drums: { kick: 'X...X...X...X...', snare: '....X.......X...', hat: 'oxxxoxxxoxxxoxxx' }
    },
    // Electric / psychic rifts · "Mind Storm": F minor, restless syncopation.
    psm_rift_spark_c: {
      bpm: 154,
      chords: ['Fm', 'Db', 'Eb', 'C', 'Fm', 'Db', 'Bbm', 'C'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'F5:2 Ab5:2 C6:4 F6:6 Eb6:2', 'Ab6:2 F6:2 Db6:2 Ab5:2 F5:4 Ab5:4', 'G5:2 Bb5:2 Eb6:2 G6:2 Bb6:4 G6:4', 'C6:2 E6:2 G6:4 C7:8',
        'Ab6:2 G6:2 F6:2 C6:2 Ab5:4 C6:4', 'F6:2 Eb6:2 Db6:2 Ab5:2 F5:4 Db6:4', 'Bb5:2 Db6:2 F6:2 Bb6:2 F6:4 Db6:4', 'E6:4 G6:4 C7:4 E6:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.RR.RR.R.RR.F' },
        { inst: 'bell', octave: 4, vel: 0.45, pattern: '0.1.2.1.0.1.2.1.' },
        { inst: 'pad', octave: 3, vel: 0.5, pattern: 'C---------------' }
      ],
      drums: { kick: 'X.xX..x.X.xX..x.', snare: '....X.......X.x.', hat: 'x.x.x.x.x.xxx.x.' }
    },
    // Ghost / dark rifts · "Nightshade": C minor, half-time and creeping.
    psm_rift_shadow_b: {
      bpm: 144,
      chords: ['Cm', 'Gm', 'Ab', 'Eb', 'Fm', 'Cm', 'Ab', 'G'],
      melody: [{ inst: 'lead', vel: 0.95, bars: [
        'G5:8 Eb5:4 C5:4', 'D5:4 G5:4 Bb5:8', 'C6:6 Bb5:2 Ab5:8', 'G5:4 Bb5:4 Eb6:8',
        'F6:4 Eb6:2 C6:2 Ab5:8', 'G5:4 C6:4 Eb6:8', 'Eb6:4 C6:4 Ab5:4 C6:4', 'B5:8 D6:4 G6:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.......R...F.O.' },
        { inst: 'pluck', octave: 4, vel: 0.4, pattern: '0.1.2.0.1.2.0.1.' },
        { inst: 'pad', octave: 3, vel: 0.6, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X.......X..x....', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.' }
    },
    // Ghost / dark rifts · "Phantom Chase": B flat minor, darting.
    psm_rift_shadow_c: {
      bpm: 150,
      chords: ['Bbm', 'Gb', 'Ab', 'F', 'Bbm', 'Gb', 'Ebm', 'F'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'Bb5:2 Db6:2 F6:2 Db6:2 Bb5:2 F5:2 Db5:2 F5:2', 'Gb5:2 Bb5:2 Db6:2 Bb5:2 Gb6:4 Db6:4', 'Ab5:2 C6:2 Eb6:2 C6:2 Ab6:4 Eb6:4', 'F6:4 C6:4 A5:8',
        'F6:2 Eb6:2 Db6:2 Bb5:2 F5:4 Bb5:4', 'Db6:2 Bb5:2 Gb5:2 Db5:2 Bb4:4 Db5:4', 'Eb5:2 Gb5:2 Bb5:2 Eb6:2 Gb6:4 Bb6:4', 'A6:4 F6:4 C6:4 A5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'RR.R.RR.RR.R.RF.' },
        { inst: 'bell', octave: 4, vel: 0.5, pattern: '0...1...2...1...' }
      ],
      drums: { kick: 'X.x..xX.X.x..xX.', snare: '....X.......X...', hat: 'x..xx..xx..xx..x' }
    },
    // Dragon / fighting rifts · "Scaled Fury": D minor, pounding.
    psm_rift_dragon_b: {
      bpm: 162,
      chords: ['Dm', 'F', 'C', 'Gm', 'Dm', 'Bb', 'Gm', 'A'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'D6:4 A5:2 D6:2 F6:4 A6:4', 'A6:2 G6:2 F6:2 C6:2 A5:4 F5:4', 'G5:2 C6:2 E6:2 G6:2 E6:4 C6:4', 'D6:4 Bb5:4 G5:8',
        'F6:2 F6:2 A6:2 F6:2 D6:4 A5:4', 'Bb5:2 Bb5:2 D6:2 Bb5:2 F6:4 D6:4', 'G6:2 F6:2 D6:2 Bb5:2 G5:4 D6:4', 'C#6:2 E6:2 A6:4 E6:4 C#6:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.RRF.FFR.RRO.OF' },
        { inst: 'pluck', octave: 4, vel: 0.45, pattern: '0.3.1.3.2.3.1.3.' },
        { inst: 'pad', octave: 3, vel: 0.5, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X.X.X.X.X.X.X.X.', snare: '....X.......X.XX', hat: 'o.o.o.o.o.o.o.o.' }
    },
    // Dragon / fighting rifts · "Sky Sovereign": B flat major, heroic.
    psm_rift_dragon_c: {
      bpm: 158,
      chords: ['Bb', 'F', 'Gm', 'Eb', 'Bb', 'F', 'Eb', 'F'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'Bb5:4 D6:4 F6:6 D6:2', 'C6:4 A5:4 F5:8', 'G5:2 Bb5:2 D6:4 G6:4 D6:4', 'Eb6:4 G6:4 Bb6:8',
        'D7:2 C7:2 Bb6:2 F6:2 D6:4 F6:4', 'C7:2 Bb6:2 A6:2 F6:2 C6:4 A6:4', 'Bb6:2 G6:2 Eb6:2 Bb5:2 G5:4 Bb5:4', 'A5:4 C6:4 F6:4 A6:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.R.R.O.O.F.F.' },
        { inst: 'bell', octave: 4, vel: 0.4, pattern: '0.2.3.2.1.2.3.2.' },
        { inst: 'pad', octave: 3, vel: 0.5, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X.x.XX..X.x.XX..', snare: '....X.......X..x', hat: 'xox.xox.xox.xoxx' }
    },
  };
  Object.assign(PSM_MUSIC, PSM_MUSIC_2);
  // 1.0: more boss fights.
  const PSM_MUSIC_3 = {
    // Boss · "Titan's Charge": A minor, hammering arpeggios.
    psm_boss_d: {
      bpm: 152,
      chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'Dm', 'E'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'A5:2 A5:2 C6:2 A5:2 E6:4 C6:4', 'A5:2 F5:2 A5:2 C6:2 F6:4 C6:4', 'G5:2 E5:2 G5:2 C6:2 E6:4 G6:4', 'D6:4 B5:4 G5:4 D6:4',
        'C6:2 B5:2 A5:2 E5:2 C5:4 E5:4', 'A5:2 G5:2 F5:2 C5:2 A4:4 C5:4', 'D5:2 F5:2 A5:2 D6:2 F6:4 A6:4', 'G#6:4 E6:4 B5:4 G#5:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.RR.R.RR.RR.R.F' },
        { inst: 'pluck', octave: 4, vel: 0.5, pattern: '0.1.0.2.0.1.0.3.' }
      ],
      drums: { kick: 'X.X..X.XX.X..X.X', snare: '....X.......X..x', hat: 'x.x.x.x.x.x.x.xx' }
    },
    // Boss · "Storm Front": B minor, fast and bright.
    psm_boss_e: {
      bpm: 160,
      chords: ['Bm', 'D', 'A', 'E', 'Bm', 'D', 'Em', 'F#'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'F#5:2 B5:2 D6:2 F#6:2 D6:4 B5:4', 'A5:2 D6:2 F#6:2 A6:2 F#6:4 D6:4', 'E6:2 C#6:2 A5:2 E5:2 C#5:4 E5:4', 'G#5:2 B5:2 E6:4 B5:4 G#5:4',
        'D6:2 D6:2 F#6:2 D6:2 B5:4 F#5:4', 'A5:2 A5:2 D6:2 A5:2 F#5:4 D5:4', 'G5:4 B5:2 E6:2 G6:4 B6:4', 'A#6:4 F#6:4 C#7:8'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'RRR.RRF.RRR.RRO.' },
        { inst: 'bell', octave: 4, vel: 0.45, pattern: '0...2...1...3...' },
        { inst: 'pad', octave: 3, vel: 0.4, pattern: 'C-------C-------' }
      ],
      drums: { kick: 'X..X.X..X..X.X..', snare: '....X.......X...', hat: 'xxoxxoxxxxoxxoxx' }
    },
    // Boss · "Last Stand": E minor, heavy half-time.
    psm_boss_f: {
      bpm: 144,
      chords: ['Em', 'C', 'Am', 'B', 'Em', 'G', 'C', 'B'],
      melody: [{ inst: 'lead', vel: 1, bars: [
        'E5:6 G5:2 B5:8', 'C6:6 E6:2 G6:8', 'A5:4 C6:4 E6:4 A6:4', 'F#6:8 D#6:4 B5:4',
        'G6:4 F#6:2 E6:2 B5:8', 'D6:4 B5:2 G5:2 D6:8', 'E6:4 C6:4 G5:4 C6:4', 'D#6:4 F#6:4 B6:4 A6:4'] }],
      parts: [
        { inst: 'bass', octave: 2, vel: 1, pattern: 'R.......R.R.F...' },
        { inst: 'pluck', octave: 3, vel: 0.45, pattern: '0..2..1.0..2..1.' },
        { inst: 'pad', octave: 3, vel: 0.6, pattern: 'C---------------' }
      ],
      drums: { kick: 'X.......X...X...', snare: '........X.......', hat: 'x...x...x...x..x' }
    },
  };
  Object.assign(PSM_MUSIC, PSM_MUSIC_3);
  // Options for each area: the game's own track plus ours.
  const MUSIC_OPTIONS = {
    village: ['village', 'psm_menu_b', 'psm_menu_c', 'psm_menu_d', 'psm_menu_e', 'psm_menu_f'],
    forest: ['forest', 'psm_forest_b', 'psm_forest_c', 'psm_forest_d', 'psm_forest_e'],
    cave: ['cave', 'psm_cave_b', 'psm_cave_c', 'psm_cave_d', 'psm_cave_e'],
    volcano: ['volcano', 'psm_volcano_b', 'psm_volcano_c', 'psm_volcano_d', 'psm_volcano_e'],
    boss: ['boss', 'psm_boss_b', 'psm_boss_c', 'psm_boss_d', 'psm_boss_e', 'psm_boss_f'],
    judgment: ['judgment', 'psm_judg_b', 'psm_judg_c'],
    'rift:fire': ['psm_rift_fire', 'psm_rift_fire_b', 'psm_rift_fire_c', 'rift'], 'rift:water': ['psm_rift_water', 'psm_rift_water_b', 'psm_rift_water_c', 'rift'],
    'rift:nature': ['psm_rift_nature', 'psm_rift_nature_b', 'psm_rift_nature_c', 'rift'], 'rift:spark': ['psm_rift_spark', 'psm_rift_spark_b', 'psm_rift_spark_c', 'rift'],
    'rift:shadow': ['psm_rift_shadow', 'psm_rift_shadow_b', 'psm_rift_shadow_c', 'rift'], 'rift:dragon': ['psm_rift_dragon', 'psm_rift_dragon_b', 'psm_rift_dragon_c', 'rift'],
  };
  const RIFT_FAMILY = {
    fire: 'fire', ground: 'fire', rock: 'fire', water: 'water', ice: 'water', flying: 'water',
    grass: 'nature', bug: 'nature', fairy: 'nature', normal: 'nature', electric: 'spark', steel: 'spark', psychic: 'spark',
    ghost: 'shadow', dark: 'shadow', poison: 'shadow', dragon: 'dragon', fighting: 'dragon',
  };
  const TRACK_NAME = {
    forest: 'Forest', psm_forest_b: 'Sunlit Glade', psm_forest_c: 'Mossy Path', cave: 'Cave', psm_cave_b: 'Echo Grotto', psm_cave_c: 'Deep Crystal',
    village: 'Village Theme', psm_menu_b: 'Campfire Evening', psm_menu_c: 'Morning Market', psm_menu_d: 'Starlit Pond',
    volcano: 'Volcano', psm_volcano_b: 'Magma Run', psm_volcano_c: 'Ashfall', rift: 'Rift', psm_rift_fire: 'Blazing Rift', psm_rift_water: 'Tidal Rift',
    psm_rift_nature: 'Wild Rift', psm_rift_spark: 'Static Rift', psm_rift_shadow: 'Shadow Rift', psm_rift_dragon: 'Dragon Rift',
    psm_menu_e: 'Sunday Picnic', psm_menu_f: 'Lantern Lullaby', psm_forest_d: 'Canopy Chase', psm_forest_e: 'Firefly Hollow',
    psm_cave_d: 'Dripstone Maze', psm_cave_e: 'Glowworm Depths', psm_volcano_d: 'Obsidian March', psm_volcano_e: 'Eruption',
    boss: 'Boss Battle', psm_boss_b: 'Clash of Fangs', psm_boss_c: 'Iron Will', psm_boss_d: 'Titan’s Charge', psm_boss_e: 'Storm Front', psm_boss_f: 'Last Stand', judgment: 'The Judgment', psm_judg_b: 'Final Verdict', psm_judg_c: 'Hall of Origin',
    psm_rift_fire_b: 'Cinder Duel', psm_rift_fire_c: 'Scorched Arena', psm_rift_water_b: 'Undertow', psm_rift_water_c: 'Frozen Gale',
    psm_rift_nature_b: 'Thornwild', psm_rift_nature_c: 'Bloom Fury', psm_rift_spark_b: 'Overcharge', psm_rift_spark_c: 'Mind Storm',
    psm_rift_shadow_b: 'Nightshade', psm_rift_shadow_c: 'Phantom Chase', psm_rift_dragon_b: 'Scaled Fury', psm_rift_dragon_c: 'Sky Sovereign',
  };
  // Places you come back to after a fight: the song you had there carries on.
  const MUSIC_PLACES = new Set(['village', 'forest', 'cave', 'volcano']);
  const musicCur = {};
  let musicPlace = null;
  let moreMusic = load('moreMusic', true);
  let musicKey = null, musicTrack = null, musicAt = 0;
  const musicLast = {};   // area -> the track picked there last time
  function musicArea(name) {
    if (name === 'rift') {
      const a = NS.Rift && NS.Rift.arena, fam = a && RIFT_FAMILY[a.type];
      return fam ? 'rift:' + fam : null;
    }
    return MUSIC_OPTIONS[name] ? name : null;
  }
  function pickTrack(area) {
    const opts = MUSIC_OPTIONS[area].filter((n) => NS.MUSIC[n]);
    if (!opts.length) return null;
    const pool = opts.length > 1 ? opts.filter((n) => n !== musicLast[area]) : opts;
    const t = pool[Math.floor(Math.random() * pool.length)];
    musicLast[area] = t;
    return t;
  }
  function setupMusic() {
    const A = NS.Audio, orig = A.music;
    for (const [k, v] of Object.entries(PSM_MUSIC)) if (!NS.MUSIC[k]) NS.MUSIC[k] = v;
    try { Object.defineProperty(A, 'psmTrack', { get: () => musicTrack, configurable: true }); } catch (_) { /* fine */ }
    const menuSong = (name) => name === 'village' || MUSIC_OPTIONS.village.includes(name);
    const send = (self, name) => {
      musicSent = name;
      if (!name || !menuSong(name)) musicShown = null;
      else if (name !== musicShown) { musicShown = name; try { showNowPlaying(name); } catch (err) { trip('music', err); } }
      return orig.call(self, name);
    };
    A.music = function (name) {
      try {
        if (moreMusic && name) {
          const area = musicArea(name);
          if (area) {
            // A new place or fight: pick again. Back from a fight (boss, rift)
            // to the same place, its song carries on. The menu also changes
            // song every couple of minutes.
            if (area !== musicKey || !musicTrack || (area === 'village' && performance.now() - musicAt > 150000)) {
              const back = area !== musicKey && MUSIC_PLACES.has(area) && area === musicPlace && musicCur[area];
              musicTrack = back ? musicCur[area] : pickTrack(area);
              musicKey = area; musicAt = performance.now(); musicCur[area] = musicTrack;
              if (MUSIC_PLACES.has(area)) musicPlace = area;
            }
            if (musicTrack) return send(this, musicTrack);
          }
        }
      } catch (err) { trip('music', err); }
      return send(this, name);
    };
    // On the main menu a song is always playing (the game only asks for it
    // once when the menu opens), and it changes every couple of minutes.
    setInterval(() => {
      try {
        const scr = document.getElementById('scr-menu');
        const onMenu = scr && !scr.classList.contains('hidden') && NS.Game && NS.Game.state === 'ui';
        if (!onMenu) return;
        if (!musicSent || (moreMusic && musicKey === 'village' && performance.now() - musicAt > 150000) || (!moreMusic && musicSent !== 'village')) A.music('village');
      } catch (err) { trip('music', err); }
    }, 2000);
  }
  let musicSent = null, musicShown = null;
  // "Now playing", bottom right of the main menu, for a few seconds after a song starts.
  let npEl = null, npT = 0, npMouse = [-1, -1];
  addEventListener('mousemove', (e) => { npMouse = [e.clientX, e.clientY]; }, { passive: true });
  // Time's up: it slides away, unless the mouse is resting on it.
  function npHide() {
    if (!npEl) return;
    const r = npEl.getBoundingClientRect();
    if (npMouse[0] >= r.left - 8 && npMouse[0] <= r.right + 8 && npMouse[1] >= r.top - 8 && npMouse[1] <= r.bottom + 8) { npT = setTimeout(npHide, 1500); return; }
    npEl.classList.remove('on');
  }
  const musicSilent = () => { try { const a = NS.Audio.settings; return !!a.muted || !(a.music > 0); } catch (_) { return false; } };
  function showNowPlaying(name) {
    if (!notif.np || musicSilent()) return;
    const scr = document.getElementById('scr-menu');
    if (!scr || !document.body) return;
    if (!npEl) {
      const st = document.createElement('style');
      st.textContent = `
#psmod-np{position:fixed;right:16px;bottom:16px;z-index:24;display:flex;gap:10px;align-items:center;padding:8px 14px 8px 10px;border-radius:12px;pointer-events:none;
  background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));border:3px solid var(--edge,#f4f8ff);box-shadow:0 0 0 3px var(--edge-out,#0b1838);
  font:13px/1.2 var(--font,'Pixelify',system-ui,sans-serif);color:#fff;text-shadow:2px 2px 0 var(--shadow,#0a1430);
  transform:translateX(calc(100% + 40px));opacity:0;transition:transform .5s cubic-bezier(.2,.9,.3,1.2),opacity .5s}
#psmod-np.on{transform:none;opacity:1}
#psmod-np .nt{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:rgba(255,210,63,.18);border:2px solid var(--gold,#ffd23f);color:var(--gold,#ffd23f);font-size:16px}
html:not(.psmod-calm) #psmod-np.on .nt{animation:psmodNote 1.2s ease-in-out infinite alternate}
@keyframes psmodNote{to{transform:translateY(-2px) rotate(-8deg)}}
#psmod-np small{display:block;color:var(--muted,#b9cbf0);font-size:11px}
#psmod-np b{font-size:15px}
html.psmod-fpsdefault #psmod-np{bottom:40px}`;
      document.head.appendChild(st);
      npEl = document.createElement('div');
      npEl.id = 'psmod-np';
      npEl.innerHTML = '<span class="nt">♪</span><div><small>Now playing</small><b></b></div>';
      document.body.appendChild(npEl);
    }
    npEl.querySelector('b').textContent = TRACK_NAME[name] || name;
    const show = () => {
      const s2 = document.getElementById('scr-menu');
      if (!s2 || s2.classList.contains('hidden') || (NS.Game && NS.Game.state !== 'ui')) return false;
      if (musicSilent()) { npWaiting = false; return false; }
      const fps = document.getElementById('psmod-fps');
      document.documentElement.classList.toggle('psmod-fpsdefault', !!fps && !fps.hidden && !fps.classList.contains('placed'));
      npEl.classList.add('on');
      clearTimeout(npT); npT = setTimeout(npHide, 15000);
      return true;
    };
    npTry = () => { if (npWaiting && show()) npWaiting = false; };
    npWaiting = true;
    npTry();
  }
  // A song that started while the menu wasn't showing yet (the start screen,
  // the end of a run) is shown when the menu opens.
  let npWaiting = false, npTry = () => {};
  setInterval(() => {
    try {
      npTry();
      // Another window opened over the menu: the card steps aside.
      if (npEl && npEl.classList.contains('on') && (musicSilent() || [...document.querySelectorAll('.scr:not(.hidden)')].some((e) => e.id !== 'scr-menu' && e.getClientRects().length))) npEl.classList.remove('on');
    } catch (_) { /* ignore */ }
  }, 500);
  waitFor(() => NS && NS.Audio && typeof NS.Audio.music === 'function' && NS.MUSIC && NS.MUSIC.forest, setupMusic);

  // ------------------------------------------------ in-run extras
  // Hitboxes (Settings → HUD & UI → Debug view): thin outlines where you and
  // enemies can be hit. Big chests get a clear opening meter above them.
  let hitboxesOn = load('hitboxes', false);          // (kept for old saves)
  let hitboxMine = load('hitboxMine', hitboxesOn), hitboxFoe = load('hitboxFoe', hitboxesOn);
  function applyNotif() { if (document.documentElement) document.documentElement.classList.toggle('psmod-noach', !notif.ach); }
  waitFor(() => document.head && document.body, function notifCss() {
    const st = document.createElement('style');
    st.textContent = 'html.psmod-noach #ach-pop{display:none!important}';
    document.head.appendChild(st);
    applyNotif();
  }, 'notif');
  function drawWorldExtras(ctx, W, H, pl) {
    const cam = NS.Camera;
    if (!cam || !pl) return;
    const k = cam.scale, L = cam.left(), T = cam.top();
    if (hitboxFoe || hitboxMine) {
      const tt = performance.now() / 1000;
      // One hitbox: a soft filled disc, a crisp ring and (for players) four ticks.
      const box = (x, y, r, rgb, strong, ticks) => {
        if (x < -r || y < -r || x > W + r || y > H + r) return;
        const gr = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
        gr.addColorStop(0, `rgba(${rgb},0)`); gr.addColorStop(1, `rgba(${rgb},${strong ? 0.28 : 0.18})`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(${rgb},${strong ? 0.95 : 0.7})`; ctx.lineWidth = strong ? 1.5 : 1;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        if (ticks) {
          ctx.lineWidth = 1.5;
          for (let a = 0; a < 4; a++) {
            const an = a * Math.PI / 2 + tt * 0.6, c = Math.cos(an), s2 = Math.sin(an);
            ctx.beginPath(); ctx.moveTo(x + c * (r - 3), y + s2 * (r - 3)); ctx.lineTo(x + c * (r + 4), y + s2 * (r + 4)); ctx.stroke();
          }
          ctx.fillStyle = `rgba(${rgb},.95)`; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
        }
      };
      ctx.save();
      if (hitboxFoe) for (const e of NS.EnemyMgr.all()) {
        if (e.dead || !e.r) continue;
        box((e.x - L) * k, (e.y - T) * k, e.r * k, e.boss ? '255,170,60' : '255,90,100', !!e.boss, !!e.boss);
      }
      if (hitboxMine) {
        if (NS.Coop && NS.Coop.active) for (const m of NS.Coop.mates) if (m.connected && m.pl && !m.pl.dead && m.pl.r) box((m.pl.x - L) * k, (m.pl.y - T) * k, m.pl.r * k, '120,200,255', false, true);
        if (pl.r && !pl.dead) box((pl.x - L) * k, (pl.y - T) * k, pl.r * k, '95,224,138', true, true);
      }
      ctx.restore();
    }
    // Big chest: opening meter.
    const CT = (NS.Interact && NS.Interact.CHEST_TIME) || 3.5;
    let near = [];
    try { near = NS.World.specialsNear(pl.x, pl.y, 900) || []; } catch (_) { near = []; }
    for (const p of near) {
      if (p.type !== 'bigchest' || !(p.open > 0)) continue;
      const f = Math.min(1, p.open / CT);
      const sx = (p.x - L) * k, sy = (p.y - T) * k - 52 * k - 22;
      const w = 86, h = 14, x = Math.round(sx - w / 2), y = Math.round(sy);
      ctx.save();
      rr(ctx, x - 3, y - 3, w + 6, h + 6, 8); ctx.fillStyle = INK; ctx.fill();
      rr(ctx, x, y, w, h, 5); ctx.fillStyle = 'rgba(40,30,10,.95)'; ctx.fill();
      if (f > 0) {
        rr(ctx, x, y, Math.max(6, w * f), h, 5);
        const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#fff1a6'); g.addColorStop(0.5, '#ffd23f'); g.addColorStop(1, '#f0a020');
        ctx.fillStyle = g; ctx.fill();
      }
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffe58a'; rr(ctx, x, y, w, h, 5); ctx.stroke();
      ctx.font = HF(800, 9); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      outlined(ctx, f >= 1 ? 'OPEN!' : `OPENING ${Math.round(f * 100)}%`, sx, y + h / 2 + 0.5, '#fff', 3);
      ctx.textBaseline = 'alphabetic';
      ctx.restore();
    }
  }

  // ---- FPS counter: the game's "Show FPS" setting now shows a small box you
  // can drag anywhere (the game's corner text is hidden).
  let fpsEl = null, fpsGet = null;
  const fpsWanted = () => { try { return !!(fpsGet ? fpsGet('fps') : NS.Settings.get('fps')); } catch { return false; } };
  function setFpsWanted(v) { try { NS.Settings.set('fps', !!v); } catch (_) { /* ignore */ } syncFps(); }
  function syncFps() { if (fpsEl) fpsEl.hidden = !fpsWanted(); }
  function setupFps() {
    const S = NS.Settings, T = NS.Touch;
    if (!S || !S.get || !T || !T.draw || fpsEl) return;
    // The game asks for 'fps' right after drawing the touch controls: that one
    // call gets "off" so it skips its own text.
    fpsGet = S.get.bind(S);
    let afterTouch = false;
    const origGet = S.get, origDraw = T.draw;
    S.get = function (key) {
      if (key === 'fps' && afterTouch) { afterTouch = false; return false; }
      return origGet.apply(this, arguments);
    };
    fpsGet = (k) => origGet.call(S, k);
    T.draw = function () { const r = origDraw.apply(this, arguments); afterTouch = true; return r; };
    const st = document.createElement('style');
    st.textContent = `
#psmod-fps{position:fixed;z-index:100002;left:var(--fx,auto);top:var(--fy,auto);right:10px;bottom:8px;padding:2px 7px;border-radius:7px;
  font:700 11px/1.3 var(--font,'Pixelify',monospace);color:#5fe08a;background:rgba(8,16,40,.6);border:1px solid rgba(244,248,255,.25);
  text-shadow:1px 1px 0 #0a1430;cursor:grab;user-select:none;touch-action:none;min-width:44px;text-align:center}
#psmod-fps.placed{right:auto;bottom:auto}
#psmod-fps[hidden]{display:none}
#psmod-fps.drag{cursor:grabbing;border-color:#ffd23f}`;
    document.head.appendChild(st);
    fpsEl = document.createElement('div');
    fpsEl.id = 'psmod-fps';
    fpsEl.title = 'Drag to move · the game’s FPS setting (Settings → Graphics) turns it off';
    fpsEl.textContent = '-- FPS';
    document.body.appendChild(fpsEl);
    const pos = load('fpsPos', null);
    const place = (x, y) => {
      x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
      fpsEl.classList.add('placed');
      fpsEl.style.setProperty('--fx', `calc(${(x * 100).toFixed(2)}vw - ${(x * fpsEl.offsetWidth).toFixed(1)}px)`);
      fpsEl.style.setProperty('--fy', `calc(${(y * 100).toFixed(2)}vh - ${(y * fpsEl.offsetHeight).toFixed(1)}px)`);
    };
    if (pos) requestAnimationFrame(() => place(pos[0], pos[1]));
    let drag = null;
    fpsEl.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = fpsEl.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      fpsEl.setPointerCapture(e.pointerId); fpsEl.classList.add('drag');
    });
    fpsEl.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const w = fpsEl.offsetWidth, h = fpsEl.offsetHeight;
      const x = (e.clientX - drag.dx) / Math.max(1, innerWidth - w), y = (e.clientY - drag.dy) / Math.max(1, innerHeight - h);
      place(x, y);
      fpsEl.dataset.x = x; fpsEl.dataset.y = y;
    });
    const end = () => { if (!drag) return; drag = null; fpsEl.classList.remove('drag'); if (fpsEl.dataset.x != null) save('fpsPos', [Math.max(0, Math.min(1, +fpsEl.dataset.x)), Math.max(0, Math.min(1, +fpsEl.dataset.y))]); };
    fpsEl.addEventListener('pointerup', end); fpsEl.addEventListener('pointercancel', end);
    for (const ev of ['mousedown', 'touchstart', 'click']) fpsEl.addEventListener(ev, (e) => e.stopPropagation());
    let n = 0, t0 = performance.now();
    const tick = (now) => {
      requestAnimationFrame(tick);
      n++;
      if (now - t0 >= 500) {
        const fps = Math.round(n * 1000 / (now - t0)); n = 0; t0 = now;
        if (!fpsEl.hidden) { fpsEl.textContent = fps + ' FPS'; fpsEl.style.color = fps >= 50 ? '#5fe08a' : fps >= 30 ? '#ffd23f' : '#ff5f6d'; }
      }
    };
    requestAnimationFrame(tick);
    if (S.on) S.on(syncFps);
    setInterval(syncFps, 1000);
    syncFps();
  }
  waitFor(() => NS && NS.Settings && NS.Settings.get && NS.Touch && NS.Touch.draw, setupFps);

  // ------------------------------------------------ player profiles
  // A player's profile (Friends → their name, or your own): their three
  // favourites as portraits with types and tier, records as tiles with icons,
  // and whether they're online or in a run.
  let profUid = null;
  function setupProfile() {
    const P = NS.ProfileUI;
    if (!P || !P.showData || P.__psm) return;
    P.__psm = true;
    const st = document.createElement('style');
    st.textContent = `
#prof-body .psp-head{display:flex;gap:12px;align-items:center;margin:-6px 0 10px}
#prof-body .psp-head img{width:64px;height:64px;border-radius:12px;border:3px solid var(--edge,#f4f8ff);box-shadow:0 0 0 3px var(--edge-out,#0b1838);image-rendering:pixelated;background:rgba(95,200,255,.2)}
#prof-body .psp-head h2{margin:0;line-height:1.1}
#prof-body .psp-st{font-size:13px;color:var(--muted,#b9cbf0);margin-top:4px;display:flex;gap:6px;align-items:center}
#prof-body .psp-st i{width:9px;height:9px;border-radius:50%;background:#7f8db0;display:inline-block}
#prof-body .psp-st i.on{background:#5fe08a;box-shadow:0 0 6px #5fe08a}#prof-body .psp-st i.play{background:#ffd23f;box-shadow:0 0 6px #ffd23f}
#prof-body h3.psp-h{margin:12px 0 6px;font-size:15px;color:var(--gold,#ffd23f)}
#prof-body .psp-favs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#prof-body .psp-fav{display:grid;justify-items:center;gap:4px;padding:10px 6px 8px;border-radius:12px;background:rgba(0,0,0,.25);border:2px solid rgba(255,210,63,.45);text-align:center;position:relative}
#prof-body .psp-fav img{width:72px;height:72px;border-radius:12px;image-rendering:pixelated;border:2px solid var(--edge,#f4f8ff);background:rgba(95,200,255,.18)}
#prof-body .psp-fav b{font-size:14px}
#prof-body .psp-fav .types{display:flex;gap:3px;justify-content:center;flex-wrap:wrap;transform:scale(.85)}
#prof-body .psp-fav .psmod-tier{position:absolute;top:6px;right:6px}
#prof-body .psp-fav.sh{border-color:#ff8ad8}
#prof-body .psp-fav .shm{position:absolute;top:6px;left:8px;color:#ff8ad8}
#prof-body .psp-none{color:var(--muted,#b9cbf0);font-size:13px;grid-column:1/-1;margin:0}
#prof-body .psp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
#prof-body .psp-stats div{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:8px;align-items:center;padding:7px 9px;border-radius:10px;background:rgba(0,0,0,.25)}
#prof-body .psp-stats .ic{grid-row:span 2;display:flex}
#prof-body .psp-stats small{color:var(--muted,#b9cbf0);font-size:11px}
#prof-body .psp-stats b{font-size:17px}
@media (max-width:560px){#prof-body .psp-favs,#prof-body .psp-stats{grid-template-columns:repeat(2,1fr)}}`;
    document.head.appendChild(st);
    // The game's show() draws other players' profiles with its own inner
    // function, so it's redone here to go through the restyled one.
    P.show = async function (uid) {
      if (!uid) return;
      const S = NS.Social;
      if (S && uid === S.uid) { profUid = uid; P.showData(S.profileData()); return; }
      const body = document.getElementById('prof-body'), scr = document.getElementById('scr-profile');
      if (body) body.innerHTML = '<p class="sub">Loading…</p>';
      if (scr) scr.classList.remove('hidden');
      let d = null;
      try { d = await S.getProfile(uid); } catch (_) { d = null; }
      if (!d) { if (body) body.innerHTML = '<p class="sub">This player has no profile yet.</p>'; return; }
      profUid = uid;
      P.showData(d);
    };
    const orig = P.showData;
    P.showData = function (d) {
      const r = orig.apply(this, arguments);
      try { restyleProfile(d); } catch (err) { trip('setupProfile', err); }
      profUid = null;
      return r;
    };
  }
  function restyleProfile(d) {
    const body = document.getElementById('prof-body');
    if (!body || !d) return;
    const medH = [...body.querySelectorAll('h3')].pop(), med = document.getElementById('prof-medals');
    const ic = (n) => { try { return NS.Icons.html(n, 22); } catch { return ''; } };
    const portrait = (dex, shiny) => PORTRAIT_BASE + String(dex).padStart(4, '0') + (shiny ? '/0000/0001' : '') + '/Normal.png';
    const favs = (d.favs || []).filter((f) => NS.DEX_BY && NS.DEX_BY[f.dex]).slice(0, 3);
    const b = d.best || {};
    // Online / in a run, for friends.
    const me = NS.Social && NS.Social.uid;
    const isMe = !profUid || profUid === me;
    const fr = profUid && profUid !== me && NS.Social && (NS.Social.friends || []).find((f) => f.uid === profUid);
    const status = !profUid || profUid === me ? '<span class="psp-st">That’s you</span>'
      : fr ? `<span class="psp-st"><i class="${fr.online ? (fr.play ? 'play' : 'on') : ''}"></i>${fr.online ? (fr.play ? 'In a run' : 'Online') : fr.seen ? 'Offline · last seen ' + agoText(fr.seen) : 'Offline'}</span>` : '';
    const lead = favs[0];
    body.innerHTML = `
      <div class="psp-head">${lead ? `<img src="${portrait(lead.dex, lead.shiny)}" alt="" data-dex="${lead.dex}">` : ''}
        <div><h2 translate="no">${esc(d.name || '???')}</h2>${d.title ? `<span class="prof-title">${esc(d.title)}</span>` : ''}${status}</div></div>
      <h3 class="psp-h">Favourite Pokémon</h3>
      <div class="psp-favs">${favs.length ? favs.map((f) => {
        const mon = NS.DEX_BY[f.dex], t = tierMap && tierMap.get(+f.dex);
        let types = ''; try { types = NS.UI.typeChips(mon.types); } catch (_) { types = ''; }
        return `<div class="psp-fav${f.shiny ? ' sh' : ''}">${f.shiny ? '<span class="shm" title="Shiny">✦</span>' : ''}${t ? tierBadge(t) : ''}
          <img src="${portrait(f.dex, f.shiny)}" alt="" data-dex="${f.dex}"><b translate="no">${esc(tr(mon.name))}</b><span class="types">${types}</span></div>`;
      }).join('') : '<p class="psp-none">No favourites picked yet.</p>'}</div>
      <h3 class="psp-h">Records</h3>
      <div class="psp-stats">
        ${isMe ? `<div><span class="ic">${ic('clock')}</span><small>Best time (solo)</small><b>${soloBest() ? clock(soloBest()) : '—'}</b></div>`
          : `<div><span class="ic">${ic('clock')}</span><small>Best time</small><b>${clock(b.solo || 0)}</b></div>`}
        <div><span class="ic">${ic('friends')}</span><small>Best time (co-op)</small><b>${b.group ? clock(b.group) : '—'}</b></div>
        <div><span class="ic">${ic('up')}</span><small>Highest level</small><b>${b.level || 0}</b></div>
        <div><span class="ic">${ic('crown')}</span><small>Bosses defeated</small><b>${fmt(b.bosses || 0)}</b></div>
        <div><span class="ic">${ic('star')}</span><small>Legendaries</small><b>${b.legends || 0}</b></div>
        <div><span class="ic"><img src="${skullIcon().toDataURL()}" width="22" height="22" alt="" style="image-rendering:pixelated"></span><small>Pokémon defeated</small><b>${fmt(b.kills || 0)}</b></div>
      </div>`;
    if (medH && med) { medH.classList.add('psp-h'); body.append(medH, med); }
    // Missing shiny portrait → normal one → the game's sprite.
    for (const img of body.querySelectorAll('img[data-dex]')) {
      img.onerror = () => {
        const dex = +img.dataset.dex;
        if (!img.dataset.f) { img.dataset.f = '1'; img.src = portrait(dex, false); return; }
        try { const cv = NS.UI.spriteCanvas(dex, 72, 72, { scale: 2 }); cv.style.cssText = img.style.cssText; img.replaceWith(cv); } catch (_) { img.remove(); }
      };
    }
  }
  function agoText(t) {
    const m = Math.max(1, Math.round((Date.now() - t) / 60000));
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
  }
  waitFor(() => NS && NS.ProfileUI && NS.ProfileUI.showData && document.getElementById('prof-body'), setupProfile);

  // The favourite picker's search box (Missions → Profile) was half Spanish.
  setInterval(() => { const q = document.getElementById('fav-q'); if (q && q.placeholder !== 'Search by name') q.placeholder = 'Search by name'; }, 400);

  // ------------------------------------------------ gacha buttons
  // Each button: what it does on top, what it costs below. The ×10-ticket
  // one says "Use ×10 ticket" and gets a subtle premium glow.
  function setupGachaLook() {
    const ids = ['pull-1', 'pull-10', 'pull-10b'];
    if (!ids.every((id) => document.getElementById(id)) || document.getElementById('psmod-gacha-css')) return;
    const st = document.createElement('style');
    st.id = 'psmod-gacha-css';
    st.textContent = `
#scr-gacha .row:has(> #pull-1){align-items:stretch;flex-wrap:nowrap}
#scr-gacha #pull-1,#scr-gacha #pull-10,#scr-gacha #pull-10b,#scr-gacha #psmod-pull-all{display:grid;justify-items:center;align-content:center;gap:2px;min-height:62px;padding:8px 10px;line-height:1.1;flex:1 1 0;min-width:0;margin:0}
#scr-gacha .psg-l{font-size:17px;white-space:nowrap}
#scr-gacha #psmod-pull-all{color:#fff;text-shadow:2px 2px 0 #0c4a43;border-color:#c8fff4;background:linear-gradient(180deg,#4fe3cf,#1fae9a 55%,#11806f);box-shadow:0 0 0 3px #063a33,0 5px 0 #063a33}
#scr-gacha #psmod-pull-all:not(:disabled):hover{filter:brightness(1.08)}
#scr-gacha .psg-glow{display:inline-flex;filter:drop-shadow(0 0 3px #ffe066) drop-shadow(0 0 6px rgba(255,210,63,.8))}
html:not(.psmod-calm) #scr-gacha #psmod-pull-all:not(:disabled) .psg-glow{animation:psmodTk 1.4s ease-in-out infinite alternate}
@keyframes psmodTk{to{filter:drop-shadow(0 0 5px #fff1a6) drop-shadow(0 0 12px rgba(255,210,63,1))}}
#scr-gacha #psmod-pull-all .psg-c{font-weight:700;font-size:14px}
#scr-gacha #pull-10b .psg-l{font-size:15px}
#scr-gacha .psg-c{display:flex;gap:4px;align-items:center;justify-content:center;font-size:13px;font-weight:400;opacity:.9}
#scr-gacha .psg-c img{vertical-align:middle}
#scr-gacha #pull-10b{position:relative;color:#fff;text-shadow:2px 2px 0 #3a1460;border-color:#f2d7ff;
  background:linear-gradient(180deg,#c48bff,#8a3dff 55%,#6522d6);box-shadow:0 0 0 3px #2c0b55,0 5px 0 #2c0b55,0 0 18px rgba(196,123,255,.55)}
#scr-gacha #pull-10b:not(:disabled):hover{filter:brightness(1.1);box-shadow:0 0 0 3px #2c0b55,0 5px 0 #2c0b55,0 0 26px rgba(214,160,255,.85)}
html:not(.psmod-calm) #scr-gacha #pull-10b:not(:disabled){animation:psmodPremium 2.6s ease-in-out infinite}
@keyframes psmodPremium{50%{box-shadow:0 0 0 3px #2c0b55,0 5px 0 #2c0b55,0 0 28px rgba(220,170,255,.85)}}
#scr-gacha #pull-1:disabled,#scr-gacha #pull-10:disabled,#scr-gacha #pull-10b:disabled,#scr-gacha #psmod-pull-all:disabled{filter:grayscale(.75) brightness(.75);animation:none;box-shadow:none}
#scr-gacha .tickets-line{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:14px}
#scr-gacha .tickets-line .psg-tk{display:inline-flex;gap:6px;align-items:center;padding:4px 10px;border-radius:20px;background:rgba(0,0,0,.3);border:2px solid rgba(244,248,255,.25)}`;
    document.head.appendChild(st);
    const LABEL = { 'pull-1': 'Use ×1', 'pull-10': 'Use ×10', 'pull-10b': 'Use ×10 ticket' };
    const fix = () => {
      for (const id of ids) {
        const b = document.getElementById(id);
        if (!b) continue;
        const cost = b.querySelector('span[id^="cost-"]');
        if (cost && !cost.classList.contains('psg-c')) cost.classList.add('psg-c');
        let l = b.querySelector('.psg-l');
        for (const n of [...b.childNodes]) if (n.nodeType === 3 && n.textContent.trim()) n.remove();
        if (!l) { l = document.createElement('b'); l.className = 'psg-l'; b.prepend(l); }
        if (l.textContent !== LABEL[id]) { l.textContent = LABEL[id]; l.setAttribute('translate', 'no'); }
        if (cost) {
          const want = id === 'pull-10b' ? '×10 ticket' : id === 'pull-10' ? 'tickets' : 'ticket';
          if (!cost.querySelector('.psg-u')) cost.insertAdjacentHTML('beforeend', ` <span class="psg-u">${want}</span>`);
        }
      }
      // Ticket counts as two pills.
      const line = document.getElementById('gacha-tickets');
      if (line && !line.querySelector('.psg-tk')) {
        const nums = [...line.querySelectorAll('b')].map((x) => x.textContent);
        const imgs = [...line.querySelectorAll('img')].map((x) => x.outerHTML);
        if (nums.length >= 2) line.innerHTML = `<span>You have</span><span class="psg-tk">${imgs[0] || ''}<b>${nums[0]}</b> tickets</span><span class="psg-tk">${imgs[1] || ''}<b>${nums[1]}</b> ×10 tickets</span>`;
      }
    };
    fix();
    const scr = document.getElementById('scr-gacha');
    new MutationObserver(fix).observe(scr, { childList: true, subtree: true, characterData: true });
  }
  waitFor(() => NS && NS.GachaUI && document.getElementById('pull-10b'), setupGachaLook);

  // ------------------------------------------------ what's new (extension)
  // The game's "What's new" screen gets two tabs: the game's own changes and
  // PokeSurvivor Plus's, with every past version. The button's dot also
  // lights up when PokeSurvivor Plus was updated.
  const PLUS_NEWS = [
    { v: '1.0', d: '17 October 2026',
      new: ['PokeSurvivor Plus 1.0!',
        'Endless runs: the big purple ∞ Endless button under Play starts one (gold Play, a normal run). No Arceus at 30:00: the run goes on like before the Judgment existed (from minute 60 enemies toughen faster and faster), rifts keep opening and a boss comes every 3 minutes. Summon Arceus from the pause menu to end it (the host, in co-op). Never on the leaderboard, no achievements, your game stats and best time stay as they were; coins and tickets as usual. Its own records in Stats, and an ∞ ENDLESS badge on its runs and share cards.',
        'The PokeSurvivor Plus version at the bottom left of the main menu (click it for what’s new).',
        'Drop-down lists (like the Upgrades Pokémon picker) open with the controller.',
        'View / Select on a controller, or Tab, swaps Normal / Shiny on the main menu.',
        'Hover the weather under the clock to see what it changes.',
        'Sounds for sending a chat message and for pings (one for each kind), with switches in Settings.',
        'Settings → Notifications → Co-op: pings, ping lines in the chat and ping sounds.',
        'Three more boss themes: Titan’s Charge, Storm Front and Last Stand.',
        'Log out from your profile: click your name at the top, then “Log out”.',
        'Switch tabs with LB / RB or Q / E in Stats (Runs & records / Leaderboard), with LT / RT for the leaderboard’s Solo / Group.',
        'Type “shiny” in the Pokémon search to see every Pokémon whose shiny you have.',
        'The Pokémon wandering behind the main menu are sometimes shiny (about 1 in 64).'],
      chg: ['Colour blind mode is much stronger, tuned on the game’s own colours (red / green and blue / yellow pairs end up 3-5× further apart).',
        'Controller prompts sit on the edge of the window that’s open.',
        'LB / RB and LT / RT prompts are shaped like the buttons.',
        'After a gacha pull, the cursor goes back to the button you used.',
        'Bigger splash text under the logo; a wider room chat on the main menu.',
        'What’s new: the game’s tab is called “Base Game”.',
        'Play says “Face the Judgment of Arceus”.',
        'The Pokémon list shows shinies as shinies while you filter by Shiny.',
        'Settings, sound, full screen and What’s new light up under the mouse like Quit does. No crown by your name.',
        'The Normal / Shiny controller prompt sits right beside the switch.',
        'Controller prompts are part of the window that’s open (a strip along its bottom) and follow it straight away; on the main menu they sit at the bottom left.',
        'A rounder ∞ on the Endless button.'],
      fix: ['The Pokémon window keeps the same size whichever Pokémon you pick.',
        'The region tabs in the Pokémon window are full size again (no cut-off names, no scroll bar).',
        'Pokémon in the National list that hadn’t loaded yet could stay grey balls after switching regions.',
        'With only a few Pokémon in the list, their boxes no longer stretch to the bottom of the window.',
        'Controller: the share card, the What’s new close button (B works too) and your favourite Pokémon in your profile can be selected; the top bar can’t be reached while a window is open.',
        'Summon Arceus looks like the other pause buttons, and “∞ Endless run” sits at the top of the pause menu.', 'Long “New record” lines on the share card no longer run off the edge.',
        'No “Now playing” card while the music is muted or at 0%.',
        'The Now playing card stays while the mouse rests on it.'] },
    { v: '0.15', d: '16 October 2026',
      new: ['Remove a single run from “Your latest runs” with its ✕ (click twice).', 'The Upgrades picker’s search takes Pokédex numbers (151 or #151).'],
      chg: ['Pokémon names stay on one line on their page, shrinking to fit; only two-word names wrap, between the words.',
        'An open rift is shown only by its arrow (no card under the clock).',
        'Bosses with no hurt face in SpriteCollab use the closest one (stunned, shouting…) or flash red.',
        'Friends’ profiles use the same look as yours, with portraits of their favourite Pokémon.',
        'Your profile shows your real best solo time; other players’ show their best time and best co-op time.',
        'The Upgrades search picks the closest name first (“mew” finds Mew, not Mewtwo).'],
      fix: ['The controller cursor skips the arrows beside your partner (LB / RB do that).', 'The favourite arrows no longer show through windows opened over the menu.'] },
    { v: '0.14', d: '16 October 2026',
      new: ['24 new songs in the game’s style: two more for the menu, every area, boss fights, Arceus’s Judgment and each family of rift arenas.',
        'Move shortcuts (Upgrades) list each move with its type icon.',
        'Settings → Notifications has a switch for each kind of message in the middle of the screen, plus leaderboard records and Now playing.'],
      chg: ['Upgrades screen: tighter cards, and Move shortcuts fill the space beside Ban.',
        'Share card: a smaller, labelled damage-per-second graph and a team damage bar.',
        'Play is gold with a light sweeping across it and a bigger “Enter the dungeon”.',
        'The arrows beside your partner show the key or button that swaps favourites (Q / E, LB / RB…).',
        'Pings go where your mouse is, or where you stand on a controller (no more pinging the nearest chest).',
        'Kills use a skull icon under the clock. The game’s ring around a big chest is gone (the opening bar shows it).',
        'Field of view goes up to 1.7x; attack effects can shrink to 20%. English is listed first under Language.'],
      fix: ['Main menu buttons no longer get cut off on the left when highlighted.', 'The top bar’s sound button shows percentages.',
        'A co-op run whose teammate left early no longer says “Solo run” on its share card.'] },
    { v: '0.13', d: '16 October 2026',
      new: ['Search boxes: Settings (looks through every tab), Achievements (every category), Friends and the Upgrades picker.',
        'Now playing: the song’s name slides in at the bottom right of the main menu when a new one starts.',
        'Separate switches for player and enemy hitboxes.'],
      chg: ['Nicer hitboxes: soft glowing discs, green for you, blue for teammates, red for enemies and orange for bosses.',
        'New clock panel: the time on top, with the biome, kills, coins and tickets (with ticket icons) underneath.',
        'Rift cards: the open rift and the rift arena show a glowing card with a draining timer bar.',
        'Every main menu option is its own button, and Play is a bit bigger.',
        '“Use all” in the Gacha has its own colour, a glowing ticket and ×N.'],
      fix: ['A song always plays on the main menu, also after a run.',
        'Opening a window no longer leaves an invisible controller highlight behind: the cursor starts on something you can see.'] },
    { v: '0.12', d: '16 October 2026',
      new: ['Sort Pokémon either way round (1→966 or 966→1, A→Z or Z→A, high→low or low→high, best or worst tier first).',
        'Steam Deck and Steam Controller button prompts, and a Button prompts choice in Settings → Controls.',
        'Ping with the middle mouse button (as well as G).'],
      chg: ['The main menu starts at the top, with Play on its own above the list.', 'Quit is a red ✕ button.', 'Favourites count in a small badge under your partner.',
        'Gacha buttons say “Use”, and “Use all” matches the others.'],
      fix: ['The controller scrolls long screens (Settings, Pokémon, Gacha…) and keeps to what’s on top: no more highlights on hidden things.',
        'Opening the Pokémon screen plays one sound and no longer stalls.'] },
    { v: '0.11', d: '16 October 2026',
      new: ['The room is on the main menu: party, room status and chat under your partner, and Play starts the co-op run right away (no separate room screen).',
        'Stats: your runs and records and the leaderboard in one place.',
        'Sort Pokémon by Pokédex number, A–Z, HP, Attack, Speed or tier.',
        'Notifications tab in Settings: choose which pop-ups, arrows and tags show.',
        'Hitboxes for you and enemies (Settings → HUD & UI → Debug view), off by default.',
        'A small FPS counter you can drag anywhere (the game’s Show FPS setting).',
        'Three more menu songs, changing every couple of minutes.',
        'Over a hundred splash texts under the logo.',
        'Player profiles show favourites as portraits with types and tier, records with icons, and if a friend is online or in a run.',
        'Tickets picked up this run, in the damage panel.',
        'A clearer opening meter on big chests.'],
      chg: ['Play is a big gold button.', 'Quit is a power button at the far right of the top bar, and quits straight away.', 'The Settings item left the menu (the gear in the top bar opens Settings).',
        'Support moved to the top-left corner.', 'The main menu scales down to fit short windows.', 'Gacha buttons: what they do on top, what they cost below; “Use ×10 ticket” glows.',
        'The Pokémon screen resets (search, filters, National list) when you leave it.', 'No rarity icon under your partner on the main menu.'],
      fix: ['Long names (Crabominable…) no longer push the ★ off the Pokémon page.', 'What’s new scrolls with the controller.', 'The favourite picker’s search box was half in Spanish.'] },
    { v: '0.10', d: '16 October 2026',
      new: ['Tier letters from the SurvivorTiers tier list (by @fildotai) on the Pokémon screen and on each Pokémon’s page: press “Tiers”.',
        'Twelve new music tracks in the game’s style: 1-3 for each area and one for each family of rift arenas, picked as you move between them (Settings → Audio).',
        'Chat messages also pop up over the Pokémon of whoever wrote them.',
        'Runs & records is now a main menu item, with your totals (runs, best time, best level, defeated).',
        'Quit at the bottom of the main menu closes the game.',
        'Controller: LB / RB switch tabs, button prompts in menus, and the welcome tour works with A / B.',
        'A Pokémon’s moves are listed by name, with details when you hover one.'],
      chg: ['Log out is in Settings → Account.', 'Bosses wince when hit even while enraged.', 'The ⁺ sits closer to the logo.', 'Version numbers now count up to the 1.0 release.'],
      fix: ['The Normal / Shiny switch stays inside the Pokémon page.', 'The main menu no longer shifts when your partner has a shiny.', 'The tabs on this screen.'] },
    { v: '0.9', d: '16 October 2026',
      new: ['Safety net: if a game update breaks part of PokeSurvivor Plus, just that part switches off and the rest keeps working (Settings → Extras → Status).',
        'Export and import all your PokeSurvivor Plus settings, favourites, records and runs (Settings → Extras → Backup).',
        'Settings reorganised: Audio (volume percentages), a HUD & UI tab, an Accessibility tab (language, colour blind mode, motion), all with live previews.',
        'Co-op pings: hold G (R3 on a controller) for a wheel with Help, Boss, Chest and Here.',
        'Run reports: a damage-over-time graph and a share card you can copy or save.',
        'Personal records for each Pokémon, shown on its page and announced when you beat them.',
        'Enraged bosses show their angry face and an ENRAGED tag.',
        'This list, and a quick welcome tour for new players.'],
      chg: ['The Pokémon page is rearranged: sprite beside the name, a ★ to favourite it, your upgrades and records, then its moves.'] },
    { v: '0.8', d: '16 October 2026',
      new: ['Pause for everyone in co-op: the host pauses, or players vote.', 'Chat in the room and during runs (Enter).', 'Runs & summary button on the main menu.',
        'Combine Pokémon filters (Missing + Legendary…).', 'Round controller button prompts.', 'Moving and rainbow bars.', 'Healing puddles on the minimap.', 'Pause menu and Settings from the level-up screen.'],
      fix: ['Translations: “Choose as partner”, the co-op waiting line, Paradox Pokémon names.', 'Evolving a move keeps your selected attack.'] },
    { v: '0.7', d: '16 October 2026',
      new: ['Choose what the minimap shows.', 'Bar colours, styles, numbers and sizes.', 'Favourite Pokémon, with ◀ ▶ on the main menu.', 'Glowing ⁺ on the logo.', 'Rift arrow and icon in the HUD’s style.'],
      chg: ['The level-up screen keeps the same size.', 'Clearer settings gear.'], fix: ['“levels” on the Upgrades picker.'] },
    { v: '0.6', d: '16 October 2026',
      new: ['Meowth and Gholdengo tags and arrows.', 'Max all upgrades in one click.', 'Party levels on the main menu.'], chg: ['Party strip under the title.'] },
    { v: '0.5',
      new: ['Colour blind mode.', 'Attack effect opacity and size.', 'Pokémon search and tier list button.', 'Party strip on the main menu.', 'Boss arrows.', 'Tab can toggle the damage panel.'],
      chg: ['Settings spread over the game’s tabs.', 'Weather under the clock; “Spectating” above your HUD.', 'Fewer pop-ups.', 'Bosses wince on every hit.'] },
    { v: '0.4', new: ['Spectate a teammate while you’re down.', 'Type icons on teammate cards.'], chg: ['Rift timer removed.'], fix: ['Controller on the co-op pause menu.'] },
    { v: '0.3', new: ['Renamed to PokeSurvivor Plus.', 'Teammates’ held items and types.', 'Shiny toggle on the controller.'], chg: ['Learning a move keeps your selected attack.', 'The boss bar updates instantly.'] },
    { v: '0.2', new: ['Redesigned HUD with portraits that react.', 'Tooltips on moves and items.', 'New boss and revive bars.', 'Resizable minimap.'] },
    { v: '0.1', new: ['Damage meter, minimap, controller support with rebinding, alerts, run history, faster gacha, National Pokédex and a wider field of view.'] },
  ];
  let newsTab = 'game';
  function renderPlusNews(body) {
    const PARTS = [['new', 'New'], ['chg', 'Changes'], ['fix', 'Fixes']];
    body.innerHTML = PLUS_NEWS.map((v) => `<div class="news-day" translate="no"><h3>PokeSurvivor Plus ${esc(v.v)}${v.d ? `<small>${esc(v.d)}</small>` : ''}</h3>` +
      PARTS.filter(([k]) => v[k] && v[k].length).map(([k, lbl]) => `<div class="news-part"><span class="news-tag ${k}">${lbl}</span><ul>${v[k].map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('') + '</div>').join('');
    body.scrollTop = 0;
  }
  function syncNewsDot() {
    const b = document.getElementById('btn-news');
    if (b) b.classList.toggle('psmod-new', load('seenVersion', '') !== PLUS_VERSION);
  }
  function setupNews() {
    const scr = document.getElementById('scr-news'), body = document.getElementById('news-body'), btn = document.getElementById('btn-news');
    if (!scr || !body || !btn || document.getElementById('psmod-news-tabs')) return;
    const st = document.createElement('style');
    st.textContent = `#btn-news.psmod-new .dot{display:block}
#psmod-news-tabs{display:flex;gap:4px;margin:8px 0 6px;padding:4px;border-radius:12px;background:rgba(5,12,35,.45);border:2px solid rgba(255,255,255,.14)}
#psmod-news-tabs .psn-tab{flex:1 1 0;min-width:0;padding:8px 10px;border:0;border-radius:9px;background:transparent;color:var(--muted,#b9cbf0);
  font:inherit;font-size:14px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;text-shadow:2px 2px 0 var(--shadow,#0a1430)}
#psmod-news-tabs .psn-tab:hover{color:#fff;background:rgba(255,255,255,.08)}
#psmod-news-tabs .psn-tab.on{color:#1a2a55;background:linear-gradient(180deg,#ffe27a,#ffc93c);text-shadow:none;box-shadow:inset 0 -3px 0 rgba(0,0,0,.18)}`;
    document.head.appendChild(st);
    const tabs = document.createElement('div');
    tabs.id = 'psmod-news-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.innerHTML = '<button class="psn-tab" role="tab" data-n="game" translate="no">Base Game</button><button class="psn-tab" role="tab" data-n="plus" translate="no">PokeSurvivor Plus</button>';
    body.before(tabs);
    let gameHtml = '';
    const show = (which) => {
      newsTab = which;
      for (const t of tabs.querySelectorAll('.psn-tab')) { t.classList.toggle('on', t.dataset.n === which); t.setAttribute('aria-selected', t.dataset.n === which); }
      if (which === 'plus') { if (body.dataset.psm !== 'plus') gameHtml = body.innerHTML; body.dataset.psm = 'plus'; renderPlusNews(body); save('seenVersion', PLUS_VERSION); syncNewsDot(); }
      else { if (body.dataset.psm === 'plus' && gameHtml) body.innerHTML = gameHtml; body.dataset.psm = ''; body.scrollTop = 0; }
    };
    tabs.addEventListener('click', (e) => { const t = e.target.closest('.psn-tab'); if (t) { e.stopPropagation(); t.blur(); show(t.dataset.n); } });
    // Each time the game opens the screen it fills the list again: start on
    // PokeSurvivor Plus when that's what's new.
    new MutationObserver(() => {
      if (scr.classList.contains('hidden')) return;
      if (body.dataset.psm === 'plus' && newsTab === 'plus') return;
      body.dataset.psm = '';
      show(load('seenVersion', '') !== PLUS_VERSION ? 'plus' : newsTab === 'plus' && wantPlus ? 'plus' : 'game');
      wantPlus = false;
    }).observe(scr, { attributes: true, attributeFilter: ['class'] });
    syncNewsDot();
    setInterval(syncNewsDot, 3000);
  }
  let wantPlus = false;
  // ---- top bar: the buttons light up under the mouse like Quit does, no
  // crown by your name, and your name (your profile) has a Log out button.
  function setupTopbarPolish() {
    if (document.getElementById('psmod-topbar-css')) return;
    const st = document.createElement('style');
    st.id = 'psmod-topbar-css';
    const B = '#topbar :is(#btn-news,#btn-sound,#btn-full,#btn-settings)';
    st.textContent = `
${B}{transition:transform .08s,filter .15s,border-color .15s,box-shadow .15s}
${B}:is(:hover,.psmod-padfocus){transform:scale(1.08);filter:brightness(1.15);border-color:var(--gold,#ffd23f);box-shadow:0 0 10px rgba(255,210,63,.55)}
${B}:active{transform:scale(.94)}
${B} img{transition:filter .15s}
${B}:is(:hover,.psmod-padfocus) img{filter:drop-shadow(0 0 4px rgba(255,230,140,.9))}
#user-pill{cursor:pointer;transition:transform .08s,border-color .15s,box-shadow .15s}
#user-pill:hover{transform:scale(1.05);border-color:var(--gold,#ffd23f);box-shadow:0 0 10px rgba(255,210,63,.45)}
#user-pill:active{transform:scale(.96)}
#psmod-logout{margin:16px 0 0 8px}`;
    document.head.appendChild(st);
    // No crown (the game redraws the pill, so it goes again each time).
    const pill = document.getElementById('user-pill');
    const noCrown = () => {
      if (!pill || !NS.DB || NS.DB.guest) return;
      const img = pill.querySelector(':scope > img');
      if (img) img.remove();
      const first = pill.firstChild;
      if (first && first.nodeType === 3 && !first.nodeValue.trim()) first.remove();
    };
    if (pill) new MutationObserver(noCrown).observe(pill, { childList: true });
    noCrown();
    // Profile tab: Log out next to "View my public profile".
    const body = document.getElementById('goals-body');
    if (!body) return;
    const addLogout = () => {
      if (!body.querySelector('.fav-slots') || document.getElementById('psmod-logout')) return;
      const view = [...body.querySelectorAll(':scope > button.btn')].pop();
      const b = document.createElement('button');
      b.id = 'psmod-logout';
      b.className = 'btn';
      b.dataset.sfx = 'none';
      b.textContent = 'Log out';
      b.title = NS.DB && NS.DB.guest ? 'Leave this guest game (its progress isn’t saved)' : 'Log out of this account (your progress is saved)';
      let armT = 0;
      b.addEventListener('click', (e) => {
        e.stopPropagation(); b.blur();
        // A guest loses everything: ask with a second press.
        if (NS.DB && NS.DB.guest && !b.classList.contains('armed')) {
          b.classList.add('armed', 'danger'); b.textContent = 'Log out? Guest progress is lost';
          clearTimeout(armT); armT = setTimeout(() => { b.classList.remove('armed', 'danger'); b.textContent = 'Log out'; }, 3500);
          return;
        }
        clearTimeout(armT);
        try { NS.Audio.sfx('click'); } catch (_) { /* quiet */ }
        try { NS.Audio.music(null); } catch (_) { /* quiet */ }
        Promise.resolve(NS.DB.logout()).then(() => NS.Flow.toLogin()).catch((err) => trip('logout', err));
      });
      if (view) view.after(b); else body.appendChild(b);
    };
    new MutationObserver(addLogout).observe(body, { childList: true });
    addLogout();
  }
  waitFor(() => NS && NS.DB && NS.Flow && document.getElementById('user-pill') && document.getElementById('goals-body'), setupTopbarPolish, 'topbar');

  // ---- the Pokémon wandering behind the main menu are sometimes shiny (1 in 64).
  const MENU_SHINY = 64;
  waitFor(() => NS && NS.Sprites && NS.Sprites.Animator && NS.Game, () => {
    const S = NS.Sprites, Orig = S.Animator;
    if (Orig.psmWrapped) return;
    class Animator extends Orig {
      constructor(dex, scale = 1, shiny = false) {
        // The menu backdrop makes its wanderers with (dex, 1) while on the menu.
        const wanderer = arguments.length === 2 && scale === 1 && !shiny && NS.Game.state === 'ui' && !document.querySelector('#scr-menu.hidden');
        const lucky = wanderer && featOn('menuShinies') && Math.random() < 1 / MENU_SHINY && S.hasShiny(dex);
        super(dex, scale, lucky || shiny);
        if (lucky) this.psmTw = { t: Math.random() * 2 };
      }
      draw(ctx, x, y, opts) {
        super.draw(ctx, x, y, opts);
        // A little sparkle now and then, like the game's shinies.
        const tw = this.psmTw;
        if (!tw || !NS.Icons || !NS.Icons.twinkle) return;
        const now = performance.now() / 1000;
        const ph = (now + tw.t) % 1.8;
        if (ph > 0.7) { tw.at = null; return; }
        if (!tw.at) tw.at = [(Math.random() - 0.5) * 34, -10 - Math.random() * 34];
        try { NS.Icons.twinkle(ctx, x + tw.at[0] * this.scale, y + tw.at[1] * this.scale, ph / 0.7, 3); } catch (_) { this.psmTw = null; }
      }
    }
    Animator.psmWrapped = true;
    try { S.Animator = Animator; } catch (err) { trip('menuShinies', err); }
  }, 'menuShinies');

  // The version, small, at the bottom left of the main menu (click: what's new).
  function setupVersionTag() {
    if (document.getElementById('psmod-ver')) return;
    const st = document.createElement('style');
    st.textContent = `#psmod-ver{position:fixed;left:12px;bottom:26px;z-index:3;display:none;padding:3px 9px;border-radius:9px;cursor:pointer;
  font:12px/1.2 var(--font,'Pixelify',system-ui,sans-serif);color:#d8e4ff;background:rgba(8,16,40,.6);border:1px solid rgba(244,248,255,.25);text-shadow:1px 1px 0 #0a1430}
#psmod-ver b{color:var(--gold,#ffd23f)}
#psmod-ver:hover,#psmod-ver.psmod-padfocus{border-color:var(--gold,#ffd23f)}
body:has(#scr-menu:not(.hidden)) #psmod-ver{display:block}
body:has(.scr.dim:not(.hidden)) #psmod-ver{display:none}`;
    document.head.appendChild(st);
    const b = document.createElement('button');
    b.id = 'psmod-ver';
    b.type = 'button';
    b.dataset.sfx = 'click';
    b.setAttribute('translate', 'no');
    b.title = 'What’s new in PokeSurvivor Plus';
    b.innerHTML = `PokeSurvivor <b>Plus</b> v${esc(PLUS_VERSION)}`;
    b.addEventListener('click', (e) => { e.stopPropagation(); b.blur(); try { openPlusNews(); } catch (err) { trip('setupNews', err); } });
    document.body.appendChild(b);
  }
  onReady(setupVersionTag);
  function openPlusNews() {
    if (NS.SettingsUI) NS.SettingsUI.close();
    wantPlus = true; newsTab = 'plus';
    if (NS.NewsUI && NS.NewsUI.open) NS.NewsUI.open(); else { const b = document.getElementById('btn-news'); if (b) b.click(); }
  }
  waitFor(() => NS && NS.NewsUI && document.getElementById('news-body'), setupNews);

  // ------------------------------------------------ welcome tour
  // First time on the main menu: six short cards, each pointing at the
  // thing it talks about. Skip any time; replay from Settings → Extras.
  const TOUR = [
    { t: 'Welcome to PokeSurvivor Plus', d: 'A quick look at what it adds. Six cards, about thirty seconds. On a controller: A next, B skip.' },
    { sel: '#btn-settings', t: 'Settings', d: 'Everything is in the game’s Settings: new HUD & UI, Accessibility and Extras tabs, with live previews of each change.' },
    { sel: '#scr-menu .menu-item.play', t: 'During a run', d: 'Hold Tab for the damage panel; the minimap sits top-right. In co-op: hold G (R3) to ping, Enter to chat, and pause for everyone from the pause menu.' },
    { sel: '#psmod-favwrap', t: 'Favourites', d: 'Tap the ★ on a Pokémon’s page, then swap between favourites here with ◀ ▶ (or Q / E, LB / RB).' },
    { sel: '#psmod-runs-menu', t: 'Stats', d: 'Your totals, every run with a damage graph and a share card, personal records for each Pokémon, and the leaderboard.' },
    { sel: '#btn-news', t: 'What’s new', d: 'Changes to the game and to PokeSurvivor Plus. That’s it, have fun!' },
  ];
  let tourEl = null, tourStep = 0;
  function startTour(force) {
    if (!force && load('toured', false)) return;
    const menu = document.getElementById('scr-menu');
    if (!menu || menu.classList.contains('hidden')) return;
    if (!tourEl) {
      const st = document.createElement('style');
      st.textContent = `
#psmod-tour{position:fixed;inset:0;z-index:100004;font:14px/1.35 var(--font,'Pixelify',system-ui,sans-serif);color:#fff}
#psmod-tour[hidden]{display:none}
#psmod-tour .shade{position:absolute;inset:0;background:rgba(5,10,25,.6)}
#psmod-tour .spot{position:absolute;border:3px solid #ffd23f;border-radius:12px;box-shadow:0 0 0 9999px rgba(5,10,25,.62),0 0 18px 4px rgba(255,210,63,.5);pointer-events:none;transition:all .25s ease}
#psmod-tour .card{position:absolute;width:min(340px,calc(100vw - 32px));box-sizing:border-box;padding:14px 16px;display:grid;gap:8px;
  background:linear-gradient(180deg,var(--box1,#2c519f),var(--box2,#1a3170));border:3px solid var(--edge,#f4f8ff);border-radius:12px;
  box-shadow:0 0 0 3px var(--edge-out,#0b1838);text-shadow:2px 2px 0 var(--shadow,#0a1430);transition:all .25s ease}
#psmod-tour h3{margin:0;color:#ffd23f;font-size:18px}
#psmod-tour p{margin:0}
#psmod-tour .row{display:flex;gap:8px;align-items:center}
#psmod-tour .row .n{flex:1;color:var(--muted,#b9cbf0);font-size:12px}
#psmod-tour .row .btn{display:inline-flex;align-items:center}
#psmod-tour .row .psmod-glyph{margin:-3px 6px -3px -4px}
html.psmod-calm #psmod-tour .spot,html.psmod-calm #psmod-tour .card{transition:none}`;
      document.head.appendChild(st);
      tourEl = document.createElement('div');
      tourEl.id = 'psmod-tour';
      tourEl.innerHTML = `<div class="shade"></div><div class="spot"></div><div class="card" role="dialog" aria-live="polite"><h3></h3><p></p><div class="row"><span class="n"></span><button class="btn small ghost" data-a="skip">${glyphHtml('Pad1')}<span>Skip</span></button><button class="btn small gold" data-a="next">${glyphHtml('Pad0')}<span>Next</span></button></div></div>`;
      document.body.appendChild(tourEl);
      for (const ev of ['pointerdown', 'mousedown', 'touchstart']) tourEl.addEventListener(ev, (e) => e.stopPropagation());
      tourEl.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        b.blur();
        if (b.dataset.a === 'skip') endTour();
        else tourNext();
      });
      addEventListener('keydown', (e) => {
        if (!tourEl || tourEl.hidden) return;
        if (e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); endTour(); }
        else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'ArrowRight') { e.stopImmediatePropagation(); e.preventDefault(); tourNext(); }
        else if (e.code === 'ArrowLeft' && tourStep > 0) { e.stopImmediatePropagation(); e.preventDefault(); showTourStep(tourStep - 1); }
      }, true);
      addEventListener('resize', () => { if (tourEl && !tourEl.hidden) showTourStep(tourStep); });
    }
    tourEl.hidden = false;
    showTourStep(0);
  }
  function showTourStep(i) {
    tourStep = i;
    const s = TOUR[i];
    const card = tourEl.querySelector('.card'), spot = tourEl.querySelector('.spot'), shade = tourEl.querySelector('.shade');
    card.querySelector('h3').textContent = s.t;
    card.querySelector('p').textContent = s.d;
    card.querySelector('.n').textContent = `${i + 1} / ${TOUR.length}`;
    card.querySelector('[data-a="next"] > span:last-child').textContent = i === TOUR.length - 1 ? 'Done' : 'Next';
    const el = s.sel && document.querySelector(s.sel);
    const r = el && el.getClientRects().length ? el.getBoundingClientRect() : null;
    if (r && r.width) {
      spot.hidden = false; shade.hidden = true;
      Object.assign(spot.style, { left: (r.left - 6) + 'px', top: (r.top - 6) + 'px', width: (r.width + 12) + 'px', height: (r.height + 12) + 'px' });
      const cw = Math.min(340, innerWidth - 32), below = r.bottom + 16 + 170 < innerHeight;
      const left = Math.max(16, Math.min(innerWidth - cw - 16, r.left + r.width / 2 - cw / 2));
      Object.assign(card.style, { left: left + 'px', top: (below ? r.bottom + 16 : Math.max(16, r.top - 16 - card.offsetHeight)) + 'px' });
    } else {
      spot.hidden = true; shade.hidden = false;
      const cw = Math.min(340, innerWidth - 32);
      Object.assign(card.style, { left: (innerWidth - cw) / 2 + 'px', top: Math.max(16, innerHeight / 2 - 90) + 'px' });
    }
  }
  function tourNext() { if (tourStep >= TOUR.length - 1) endTour(); else showTourStep(tourStep + 1); }
  function endTour() { if (tourEl) tourEl.hidden = true; save('toured', true); }
  // Shown once, the first time the main menu is up (after the game's own pop-ups settle).
  waitFor(() => NS && NS.MenuUI && document.getElementById('scr-menu'), function setupTour() {
    if (load('toured', false)) return;
    const id = setInterval(() => {
      const m = document.getElementById('scr-menu');
      if (m && !m.classList.contains('hidden')) { clearInterval(id); setTimeout(() => startTour(false), 1800); }
    }, 500);
  });

  // ------------------------------------------------------------ hotkeys
  addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    let hit = true;
    switch (e.code) {
      case 'Equal': case 'NumpadAdd': case 'BracketRight': setFov(fov + FOV_STEP); break;
      case 'Minus': case 'NumpadSubtract': case 'Slash': setFov(fov - FOV_STEP); break;
      case 'Digit0': case 'Numpad0': setFov(1); break;
      case 'KeyM': shown = !shown; save('shown', shown); if (panel) render(); refreshExtras(); break;
      case 'KeyN': mapShown = !mapShown; save('mapShown', mapShown); refreshExtras(); break;
      case 'KeyH': { const m = document.getElementById('scr-menu'); if (m && !m.classList.contains('hidden') && sumEl && sumEl.hidden) openStats('runs'); else toggleHistory(); break; }
      case 'KeyL': toggleNetLog(); break;
      case 'KeyK': toggleKeys(); break;
      case 'KeyB': setAlertSound(!alertSound); toast(alertSound ? 'Alert sound on' : 'Alert sound off'); break;
      default: hit = false;
    }
    if (hit) { e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
