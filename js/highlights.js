// highlights.js (highlights): WW.highlights, the after-battle highlight reel ("key moments"; the user, 2026-10-19).
//  - RECORD: every round keeps its event log (lookahead_log.js WW.laLog: drops, impacts, shells landing, sinkings,
//    magazines, planes shot down, attack runs; switched on here too, so a page without the look-ahead worker has it) and a
//    hash of the round every HSTEP live steps. At 'victory' the round is snapshot: its record (main.js game.rec), the log,
//    the hashes, its last step, the ships' and planes' names, the action report; the moments are picked from the log.
//  - PICK (pick(), a pure function of the log): per ship, its impacts grouped into episodes (a strike's bombs and
//    torpedoes, a destroyer's spread, a gun duel), the sinking / magazine that follows attached; sinkings and magazines
//    with no episode of their own; air battles (4+ planes down close together). Each is worth the class at stake (CV 3 >>
//    BB 1.8 > CA > DD > PT, as camera_lookahead.js) times what happens (hits, a sinking, a magazine); the battle's last
//    sinking gets a bonus. The best of each third of the battle first (the story in order), the battle's end, then by
//    worth, no two clips overlapping, ~2-4 min of reel; then in time order. Each clip is an ARC: a lead-in before the
//    climax (34 real s for a strike: the director's look-ahead opens a strike arc then, the run-in; 18 s for a ship arc)
//    and the outcome after it, with a caption ("1043 hrs - Akagi (CV) hit by SBDs of VB-6").
//  - PLAY (play()): the page replays the round from its record (main.js startRound({ replay })): fast-forward with
//    __sim.stepFixed, nothing drawn (WW.time.hold: main.js frame() skips), to each clip's start, then the clip at 1x with
//    the DIRECTOR camera forced (no free camera, input blocked, WW.camLook.prefer(): the clip's arc), a fade between clips.
//    The look-ahead worker gets the same record on the replay's roundStart (lookahead.js) and is let run ahead before a
//    clip plays. Each HSTEP the replay's hash must equal the played round's (reel().bad otherwise). The reel ends before
//    the round's last step (no second 'victory'); then the page is put back as the battle left it (the RNG, the clock,
//    the stats, the carried-over state of round_rec.js, the next battle's map and fleets) and the action report shows again.
//  - DEBUG: ?simthenreel (and WW.highlights.simRound()): the round is run sim-only at full speed with a progress bar,
//    then the end screen with the "Watch highlights" button.
// Reads the sim only (the played round is bit-identical with or without this file); Math.random / the wall clock only.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  if (WW.simOnly) return;
  const HSTEP = 120, GAP = 40, SLICE = 40;   // live steps between hashes; sim s between two episodes on one ship; ms of fast-forward per slice
  const LEAD_AIR = 34, LEAD_SHIP = 18, LEAD_SINK = 14, LEAD_DOWN = 12, TAIL = 9, MAX_HITS_R = 12, SINK_R = 30;   // real s
  const MAX_CLIP = 52, BUDGET = 230, BUDGET_MAX = 270, MIN_N = 6, MAX_N = 9;   // real s of reel; clips
  const CLASS = { carrier: 3, battleship: 1.8, cruiser: 1.3, destroyer: 0.9, submarine: 0.5, pt: 0.5, base: 1.3 };
  const CODE = { carrier: 'CV', battleship: 'BB', cruiser: 'CA', destroyer: 'DD', submarine: 'SS', pt: 'PT' };
  const PLANES = { 'dive|USN': 'SBDs', 'torpedo|USN': 'TBDs', 'fighter|USN': 'Corsairs', 'dive|IJN': 'Vals', 'torpedo|IJN': 'Kates', 'fighter|IJN': 'Zeros' };
  const G = () => WW.game, L = WW.laLog;
  const LS = () => (window.__sim && window.__sim.LIVE_STEP) || 1 / 120;
  const SPR = () => (WW.time.base || 0.3057) / LS();   // live steps per real second at 1x
  const nd = () => !!(WW.scn && WW.scn().id === 'normandy');

  // ---------- the record of the round being played ----------
  let hashes = new Map(), ships = new Map(), snap = null, reel = null;
  const rd = v => Math.round(v * 10) / 10;
  function noteShips() {
    const D = WW.diary;
    for (const s of WW.world.ships) {
      if (!s.stats || ships.has('s' + s.id)) continue;
      ships.set('s' + s.id, { name: D ? D.nameOf(s) : s.type, type: s.type, nation: s.nation });
    }
  }
  WW.on('roundStart', () => {
    if (reel) return;
    L.on = true;   // (the event log; read-only recording, also with no look-ahead worker)
    hashes = new Map(); ships = new Map();
    noteShips();
  });
  WW.on('shipSunk', () => { if (!reel) noteShips(); });
  const prevAfter = WW.afterStep;
  WW.afterStep = function (n) {
    if (prevAfter) prevAfter(n);
    try {
      if (!G() || G().state !== 'battle') return;
      if (reel && reel.state === 'play' && reel.clip && n >= reel.clip.n1) endClip();
      if (n % HSTEP !== 0) return;
      const h = L.hash();
      if (!reel) { hashes.set(n, h); return; }
      const want = snap.hashes.get(n);
      if (want !== undefined) { if (want === h) reel.hashOk++; else if (!reel.bad) reel.bad = { n, want, got: h }; }
    } catch (e) { console.error('highlights', e); }
  };
  WW.on('victory', d => {
    if (reel || nd() || !G().rec) return;
    try {
      noteShips();
      const ev = L.ev.slice(), endN = G().stepN || 0, planes = new Map();
      for (const e of ev) for (const k of ['p', 'src']) {
        const id = e[k]; if (!id || id[0] !== 'p' || planes.has(id)) continue;
        const p = L.byLid.get(+id.slice(1));
        if (p) planes.set(id, { kind: p.kind, nation: p.nation, sq: p.squadron ? p.squadron.name : null });
      }
      const info = { ships, planes, now0: G().rec.now };
      snap = { rec: G().rec, ev, hashes, endN, info, aar: WW.aar ? WW.aar.last() : null, winner: d.winner, reason: d.reason, moments: [] };
      snap.moments = pick(ev, endN, info);
    } catch (e) { console.error('highlights pick', e); snap = null; }
  });

  // ---------- pick the moments ----------
  function pick(ev, endN, info) {
    const spr = SPR(), cls = id => (id === 'base' ? CLASS.base : CLASS[(info.ships.get(id) || {}).type] || 1);
    const R = s => Math.round(s * spr);
    const gapN = Math.round(GAP / LS());
    const cands = [];
    // per-ship episodes of impacts
    const by = new Map();
    for (const e of ev) {
      if ((e.k === 'imp' && e.hit && !e.dud) || (e.k === 'sh' && e.hit)) { if (!by.has(e.hit)) by.set(e.hit, []); by.get(e.hit).push(e); }
    }
    const eps = [];
    for (const [tg, list] of by) {
      let cur = null;
      for (const e of list) {
        if (!cur || e.n - cur.last > gapN) eps.push(cur = { tg, first: e.n, last: e.n, ev: [] });
        cur.ev.push(e); cur.last = e.n;
      }
    }
    for (const ep of eps) {
      const air = ep.ev.filter(e => e.k === 'imp' && e.src && e.src[0] === 'p');
      const tor = ep.ev.filter(e => e.k === 'imp' && e.src && e.src[0] === 's');
      const big = ep.ev.filter(e => e.k === 'sh' && e.cal === 'big'), med = ep.ev.filter(e => e.k === 'sh' && e.cal === 'med');
      const heavy = air.length + tor.length;
      if (!heavy && big.length + med.length < 2) { ep.skip = true; continue; }
      const kind = air.length ? 'strike' : tor.length ? 'torp' : 'guns';
      const first = (air[0] || tor[0] || big[0] || med[0]);
      Object.assign(ep, { kind, climax: first.n, air, tor, big: big.length, med: med.length, heavy });
    }
    const live = eps.filter(ep => !ep.skip);
    // sinkings and magazines: onto the episode they end, else their own moment
    const lastSunk = ev.filter(e => e.k === 'sunk').slice(-1)[0];
    for (const e of ev) {
      if (e.k !== 'sunk' && e.k !== 'mag') continue;
      const ep = live.find(p => p.tg === e.s && e.n >= p.first && e.n <= p.climax + R(SINK_R));
      if (ep) { if (e.k === 'sunk') ep.sinkN = e.n; else ep.magN = e.n; if (e === lastSunk) ep.lastSunk = true; continue; }
      live.push({ tg: e.s, kind: e.k === 'sunk' ? 'sink' : 'mag', first: e.n, last: e.n, climax: e.n, heavy: 0, big: 0, med: 0, air: [], tor: [],
        sinkN: e.k === 'sunk' ? e.n : undefined, magN: e.k === 'mag' ? e.n : undefined, lastSunk: e === lastSunk });
    }
    for (const ep of live) {
      const c = cls(ep.tg);
      ep.value = ep.kind === 'sink' ? c * 1.6 : ep.kind === 'mag' ? c * 1.8
        : c * (1 + 0.9 * Math.min(4, ep.heavy) + 0.3 * Math.min(3, ep.big) + 0.12 * Math.min(5, ep.med));
      if (ep.kind !== 'sink' && ep.sinkN !== undefined) ep.value += 2.5 * c;
      if (ep.kind !== 'mag' && ep.magN !== undefined) ep.value += 1.2 * c;
      if (ep.lastSunk) ep.value += 2;
      const lead = ep.kind === 'strike' ? LEAD_AIR : ep.kind === 'sink' ? LEAD_SINK : LEAD_SHIP;
      let n0 = ep.climax - R(lead);
      if (ep.kind === 'torp') {   // the spread fired: in the lead-in
        const src = ep.tor[0].src, f = ev.filter(e => e.k === 'tfire' && e.s === src && e.n < ep.climax && e.n > ep.climax - R(60)).slice(-1)[0];
        if (f) n0 = Math.min(n0, Math.max(ep.climax - R(40), f.n - R(LEAD_SHIP)));
      }
      const out = Math.max(ep.climax, Math.min(ep.last, ep.climax + R(MAX_HITS_R)), ep.sinkN || 0, ep.magN || 0);
      const n1 = out + R(TAIL + (ep.sinkN !== undefined ? 5 : 0));
      if (n1 - n0 > R(MAX_CLIP)) n0 = Math.min(ep.climax - R(ep.kind === 'strike' ? 16 : 10), n1 - R(MAX_CLIP));   // a long outcome: a shorter lead-in
      cands.push(clip(ep, n0, n1, ep.tg));
    }
    // air battles: 4+ planes down within 25 sim s and 250 u
    const downs = ev.filter(e => e.k === 'down'), used = new Set(), W25 = Math.round(25 / LS());
    for (let i = 0; i < downs.length; i++) {
      if (used.has(i)) continue;
      const a = downs[i], grp = [a];
      for (let j = i + 1; j < downs.length && downs[j].n - a.n <= W25; j++) if (!used.has(j) && Math.hypot(downs[j].x - a.x, downs[j].z - a.z) < 250) grp.push(downs[j]);
      if (grp.length < 4) continue;
      for (let j = i; j < downs.length; j++) if (grp.includes(downs[j])) used.add(j);
      const mid = grp[Math.floor(grp.length / 2)], ord = grp.filter(e => e.ord).length;
      const ep = { kind: 'air', tg: mid.p, climax: mid.n, first: grp[0].n, last: grp[grp.length - 1].n, downs: grp, value: 0.3 * grp.length + (ord >= 3 ? 0.6 : 0) };
      cands.push(clip(ep, mid.n - Math.min(R(26), Math.max(R(LEAD_DOWN), mid.n - grp[0].n + R(4))), Math.min(grp[grp.length - 1].n, mid.n + R(12)) + R(6), mid.p));
    }
    function clip(ep, n0, n1, key) {
      n0 = Math.max(HSTEP, Math.floor(n0 / HSTEP) * HSTEP);
      n1 = Math.min(endN - 2, n1);
      return { ep, kind: ep.kind, key, n0, n1, climax: ep.climax, value: +ep.value.toFixed(2) };
    }
    const ok = cands.filter(c => c.n1 > c.n0 + R(4) && c.climax < c.n1);
    ok.sort((a, b) => b.value - a.value || a.climax - b.climax);
    // choose: the best of each third, the battle's end, then by worth
    const all = ev.length ? ev[0].n : 0, span = Math.max(1, endN - all), chosen = [];
    const realLen = c => (c.n1 - c.n0) / spr, total = () => chosen.reduce((s, c) => s + realLen(c), 0);
    const pad = R(3), clash = c => chosen.some(o => c.n0 < o.n1 + pad && o.n0 < c.n1 + pad);
    const take = c => { if (!c || chosen.includes(c) || clash(c) || chosen.length >= MAX_N) return false; chosen.push(c); return true; };
    for (let k = 0; k < 3; k++) take(ok.find(c => c.value >= 1 && c.climax >= all + span * k / 3 && c.climax < all + span * (k + 1) / 3 && !clash(c)));
    take(ok.find(c => c.ep.lastSunk && !clash(c)));
    for (const c of ok) {
      if (chosen.length >= MAX_N) break;
      const lim = chosen.length < MIN_N ? BUDGET_MAX : BUDGET;
      if (total() + realLen(c) > lim) continue;
      take(c);
    }
    chosen.sort((a, b) => a.n0 - b.n0);
    for (const c of chosen) c.caption = caption(c, info);
    return chosen.map(c => ({ kind: c.kind, key: c.key, n0: c.n0, n1: c.n1, climax: c.climax, value: c.value, real: +realLen(c).toFixed(1),
      title: c.caption.title, sub: c.caption.sub, clock: c.caption.clock, src: c.caption.src || null, last: !!c.ep.lastSunk }));
  }

  // ---------- captions ----------
  function shipName(info, id) {
    if (id === 'base') return 'the island base';
    const s = info.ships.get(id); if (!s) return 'a ship';
    return s.name + (CODE[s.type] ? ' (' + CODE[s.type] + ')' : '');
  }
  function planesOf(info, ids) {
    const n = new Map();
    for (const id of ids) { const p = info.planes.get(id); if (!p) continue; const k = (PLANES[p.kind + '|' + p.nation] || 'aircraft') + (p.sq ? ' of ' + p.sq : ''); n.set(k, (n.get(k) || 0) + 1); }
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join(' and ') || 'aircraft';
  }
  const plural = (k, w) => k + ' ' + w + (k === 1 ? '' : 's');
  function caption(c, info) {
    const ep = c.ep, rt = Math.max(0, c.climax * LS());
    const clock = WW.diary ? WW.diary.clock(rt) : '';
    const tgt = shipName(info, c.kind === 'air' ? null : ep.tg);
    let title = '', sub = '', src = null;
    const sinks = ep.sinkN !== undefined, mag = ep.magN !== undefined;
    if (c.kind === 'strike') {
      const ids = [...new Set(ep.air.map(e => e.src))];
      const bombs = ep.air.filter(e => e.w !== 'torpedo').length, torps = ep.air.length - bombs;
      title = tgt + (sinks ? ' sunk by ' : ' hit by ') + planesOf(info, ids);
      sub = [bombs ? plural(bombs, 'bomb hit') : '', torps ? plural(torps, 'torpedo hit') : ''].filter(Boolean).join(', ');
    } else if (c.kind === 'torp') {
      src = ep.tor[0].src;
      title = tgt + (sinks ? ' sunk by torpedoes from ' : ' torpedoed by ') + shipName(info, src);
      sub = plural(ep.tor.length, 'torpedo hit');
    } else if (c.kind === 'guns') {
      const srcs = new Map(); for (const e of ep.ev) if (e.k === 'sh' && e.src) srcs.set(e.src, (srcs.get(e.src) || 0) + 1);
      src = [...srcs.entries()].sort((a, b) => b[1] - a[1])[0]; src = src ? src[0] : null;
      title = tgt + (sinks ? ' sunk by the guns of ' : ' under fire from ') + (src ? shipName(info, src) : 'the enemy line');
      sub = plural(ep.big + ep.med, 'heavy shell hit').replace('heavy shell hit', ep.big ? 'heavy shell hit' : 'shell hit');
    } else if (c.kind === 'sink') { title = tgt + ' goes down'; }
    else if (c.kind === 'mag') { title = tgt + ': her magazine explodes'; }
    else if (c.kind === 'air') {
      const nat = new Map(); for (const e of ep.downs) nat.set(e.nation, (nat.get(e.nation) || 0) + 1);
      const loser = [...nat.entries()].sort((a, b) => b[1] - a[1])[0][0], ord = ep.downs.filter(e => e.ord).length;
      title = ord >= 3 ? (loser === 'IJN' ? 'A Japanese' : 'An American') + ' strike broken up' : 'Air battle';
      sub = plural(ep.downs.length, 'plane') + ' shot down';
    }
    if (mag && c.kind !== 'mag') sub = (sub ? sub + '; ' : '') + 'her magazine explodes';
    if (sinks && c.kind !== 'sink' && !/sunk/.test(title)) sub = (sub ? sub + '; ' : '') + 'she goes down';
    if (ep.lastSunk) sub = (sub ? sub + '; ' : '') + 'the battle\'s last loss';
    return { clock, title: (clock ? clock + ' hrs - ' : '') + title, sub, src };
  }

  // ---------- the overlay ----------
  let ui = null;
  function css() {
    const st = document.createElement('style');
    st.textContent = `#hl{position:fixed;inset:0;z-index:60;pointer-events:none;font-family:'Special Elite',Georgia,serif;color:#f1e8d0}
#hl .blk{position:absolute;inset:0;background:#05070a;opacity:0;transition:opacity .5s ease}
#hl.dark .blk{opacity:1}
#hl .prog{position:absolute;left:50%;top:50%;width:min(420px,80vw);transform:translate(-50%,-50%);text-align:center;opacity:0;transition:opacity .3s}
#hl.ff .prog{opacity:1}
#hl .bar{height:4px;background:rgba(241,232,208,.18);margin-top:12px}
#hl .bar i{display:block;height:100%;width:0;background:#e4c77f}
#hl .cap{position:absolute;left:4vw;bottom:13vh;max-width:min(720px,88vw);opacity:0;transition:opacity .6s;text-shadow:0 1px 6px #000}
#hl .cap.on{opacity:1}
#hl .cap b{display:block;font-size:clamp(17px,2.2vw,26px);font-weight:400}
#hl .cap span{display:block;font-size:clamp(13px,1.4vw,17px);opacity:.82;margin-top:4px}
#hl .end{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);text-align:center;font-size:clamp(20px,3vw,34px);opacity:0;transition:opacity .6s}
#hl .end span{display:block;font-size:.5em;opacity:.8;margin-top:8px}
#hl.fin .end{opacity:1}
#hl .ctl{position:absolute;left:50%;bottom:3.5vh;transform:translateX(-50%);display:none;gap:8px;pointer-events:auto;align-items:center}
#hl.on .ctl{display:flex}
#hl .ctl button{font:inherit;font-size:14px;color:#f1e8d0;background:rgba(10,14,20,.6);border:1px solid rgba(241,232,208,.35);padding:6px 12px;cursor:pointer}
#hl .ctl button:hover{background:rgba(40,46,56,.8)}
#hl .ctl em{font-style:normal;font-size:13px;opacity:.75;padding:0 6px}
#aar .hl-btn{display:block;margin:14px auto 0;font:inherit;font-size:15px;padding:7px 16px;background:#3a3226;color:#f4ecd8;border:0;cursor:pointer;letter-spacing:.05em}
#aar .hl-btn:hover{background:#5a4c38}`;
    document.head.appendChild(st);
  }
  function mkUI() {
    if (ui) return ui;
    css();
    const el = document.createElement('div'); el.id = 'hl';
    el.innerHTML = '<div class="blk"></div><div class="prog"><div class="pt">Fast-forwarding</div><div class="bar"><i></i></div></div>' +
      '<div class="cap"><b></b><span></span></div><div class="end"><b></b><span></span></div>' +
      '<div class="ctl"><button data-a="prev" title="Previous clip (P)">&#9664; Prev</button><em></em><button data-a="next" title="Next clip (N)">Next &#9654;</button><button data-a="exit" title="Exit (Esc)">Exit &#10005;</button></div>';
    document.body.appendChild(el);
    el.querySelector('.ctl').addEventListener('click', e => { const a = e.target.closest('button'); if (a) act(a.dataset.a); });
    ui = { el, pt: el.querySelector('.pt'), bar: el.querySelector('.bar i'), cap: el.querySelector('.cap'), capT: el.querySelector('.cap b'), capS: el.querySelector('.cap span'),
      endT: el.querySelector('.end b'), endS: el.querySelector('.end span'), num: el.querySelector('.ctl em') };
    return ui;
  }
  const cls = (k, on) => mkUI().el.classList.toggle(k, !!on);
  function progress(text, f) { mkUI(); ui.pt.textContent = text; ui.bar.style.width = Math.round(WW.clamp(f, 0, 1) * 100) + '%'; }

  // the reel owns the input: the free camera and the game's keys never see it
  const OWN = { Escape: 'exit', n: 'next', N: 'next', ArrowRight: 'next', p: 'prev', P: 'prev', ArrowLeft: 'prev' };
  function block(e) {
    if (!reel && !simming) return;
    if (ui && e.target && e.target.closest && e.target.closest('#hl .ctl')) return;
    e.stopImmediatePropagation();
    if (e.type === 'wheel') e.preventDefault();
    if (e.type === 'keydown' && reel && OWN[e.key]) { e.preventDefault(); act(OWN[e.key]); }
  }
  ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'pointerdown', 'wheel', 'touchstart', 'contextmenu'].forEach(k => window.addEventListener(k, block, { capture: true, passive: false }));

  // ---------- fast-forward ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let simming = false;
  function audioPause(on) {
    const A = WW.audio, c = A && A.ctx; if (!c || !A.enabled) return;
    try { if (on) c.suspend(); else { if (A.stopAll) A.stopAll(); c.resume(); } } catch (e) { /* sound only */ }
  }
  // runs live steps until stepN reaches n (or the round leaves the battle); onP(frac) between slices
  async function ffTo(n, onP, token) {
    const g = G(), n0 = g.stepN || 0;
    while (g.state === 'battle' && (g.stepN || 0) < n) {
      if (token && token.dead) return false;
      const t0 = performance.now();
      while (g.state === 'battle' && (g.stepN || 0) < n && performance.now() - t0 < SLICE) window.__sim.stepFixed(Math.min(30, n - (g.stepN || 0)));
      if (onP) onP(((g.stepN || 0) - n0) / Math.max(1, n - n0));
      await sleep(0);
    }
    return true;
  }

  // ---------- the debug path: the whole round sim-only, then the end screen ----------
  async function simRound() {
    const g = G();
    if (simming || reel) return false;
    simming = true; mkUI(); cls('dark', true); cls('ff', true); cls('on', false);
    try {
      if (g.state !== 'battle') {
        if (g.mode === 'auto') g.mode = 'setup';
        if (WW.admirals && WW.admirals.startFromPreview) WW.admirals.startFromPreview();
        if (WW.dayNight && WW.dayNight.startFromPreview) WW.dayNight.startFromPreview();
        g.startRound({ keepMap: true });
      }
      WW.time.hold = true; audioPause(true);
      const t0 = performance.now();
      while (g.state === 'battle') {
        const st = performance.now();
        while (g.state === 'battle' && performance.now() - st < SLICE * 2) window.__sim.stepFixed(30);
        const T = g.deadline ? g.deadline() : WW.cfg.ROUND_TIMEOUT;
        progress('Simulating the battle: ' + (WW.diary ? WW.diary.clock(g.roundTime) + ' hrs' : Math.round(g.roundTime) + ' s'), g.roundTime / T);
        await sleep(0);
      }
      simRound.ms = performance.now() - t0;
      if (g.state === 'victory') g.enterSetup(true, !g.custom);   // the end screen at once (no victory hold)
    } finally {
      WW.time.hold = false; audioPause(false); simming = false;
      cls('ff', false); cls('dark', false);
      if (WW.cam && WW.cam.snap) WW.cam.snap();
    }
    if (WW.aar && snap && snap.aar) WW.aar.show(snap.aar);
    return true;
  }

  // ---------- the reel ----------
  async function play(from) {
    const g = G();
    if (!snap || !snap.moments.length || reel || simming) return false;
    if (g.state === 'battle') return false;   // never over a live battle
    if (g.state === 'victory') g.enterSetup(true, !g.custom);   // (the end screen now, as main.js would 9 s later)
    const saved = { rec: WW.roundRec.capture(true, 0), rand: WW.randState(), stats: JSON.parse(JSON.stringify(WW.stats)), terrain: WW.terrain.seed,
      scale: WW.time.scale, mode: WW.cam ? WW.cam.mode : 'director', state: g.state, seed: g.seed, aarOn: WW.aar && WW.aar.visible() };
    reel = { saved, i: -1, clip: null, state: 'ff', token: null, hashOk: 0, bad: null, starts: [], played: 0, ended: false, done: null };
    reel.done = new Promise(r => { reel.resolve = r; });
    if (WW.aar) WW.aar.hide();
    mkUI(); cls('on', true); cls('dark', true);
    g.reel = true;
    goto(from || 0);
    return true;
  }
  // (re)start the replay: the round from its record
  function restart() {
    const g = G();
    g.state = 'setup';   // (startRound from the ready screen, as the played round started)
    g.startRound({ replay: snap.rec });
  }
  async function goto(i) {
    if (!reel) return;
    if (reel.token) reel.token.dead = true;
    const tok = reel.token = {};
    const M = snap.moments;
    if (i < 0) i = 0;
    if (i >= M.length) return outro(tok);
    const c = M[i], g = G();
    reel.state = 'ff'; reel.i = i; reel.clip = c;
    WW.time.hold = true; audioPause(true); cls('dark', true); ui.cap.classList.remove('on');
    if (WW.camLook && WW.camLook.prefer) WW.camLook.prefer(null);
    await sleep(reel.played ? 520 : 0);   // the fade to black
    if (tok.dead) return;
    if (g.state !== 'battle' || (g.stepN || 0) > c.n0 || g.rec !== snap.rec) restart();
    cls('ff', true);
    const lbl = 'Fast-forwarding to ' + c.clock + ' hrs';
    const go = await ffTo(c.n0, f => progress(lbl, f), tok);
    if (!go || tok.dead || !reel) return;
    reel.starts.push({ i, n: G().stepN, hash: L.hash(), want: snap.hashes.get(c.n0), bad: reel.bad });
    // the clip: the director, at 1x, told the arc
    const LA = WW.lookahead;
    if (LA && LA.on && LA.waitAhead) { progress('Fast-forwarding to ' + c.clock + ' hrs', 1); await LA.waitAhead(LA.HORIZON || 75, 15000); }
    if (tok.dead || !reel) return;
    cls('ff', false);
    WW.time.scale = 1;
    if (WW.freecam && WW.freecam.release) WW.freecam.release();
    if (WW.cam) WW.cam.mode = 'director';
    if (WW.camLook && WW.camLook.prefer && c.kind !== 'air') WW.camLook.prefer({ tg: c.key, src: c.src || undefined, n0: c.n0, n1: c.n1 });
    if (WW.cam && WW.cam.snap) WW.cam.snap();
    ui.capT.textContent = c.title; ui.capS.textContent = c.sub || '';
    ui.num.textContent = (i + 1) + ' / ' + M.length;
    reel.state = 'play'; reel.played++;
    WW.time.hold = false; audioPause(false);
    cls('dark', false);
    setTimeout(() => { if (reel && reel.token === tok) ui.cap.classList.add('on'); }, 400);
    setTimeout(() => { if (reel && reel.token === tok) ui.cap.classList.remove('on'); }, 9000);
  }
  function endClip() {   // (afterStep: the clip's last step)
    if (!reel || reel.state !== 'play') return;
    reel.state = 'fade'; WW.time.hold = true;
    goto(reel.i + 1);
  }
  async function outro(tok) {
    reel.state = 'end'; WW.time.hold = true; cls('dark', true); ui.cap.classList.remove('on');
    const a = snap.aar;
    ui.endT.textContent = a ? (a.winner ? a.winner + ' victory' : 'No decision') : (snap.winner ? snap.winner + ' victory' : 'No decision');
    ui.endS.textContent = a ? a.how + (a.t0 ? '  ·  ' + a.t0 + '–' + a.t1 + ' hrs' : '') : '';
    await sleep(500); if (tok.dead) return;
    cls('fin', true);
    await sleep(3200); if (tok.dead) return;
    finish();
  }
  function act(a) {
    if (!reel) return;
    if (a === 'exit') return finish();
    if (a === 'next') return reel.state === 'end' ? finish() : goto(reel.i + 1);
    if (a === 'prev') return goto(Math.max(0, reel.i - (reel.state === 'play' && G().stepN - reel.clip.n0 > SPR() * 3 ? 0 : 1)));
  }
  // the page as the battle left it: the ready screen, its map and fleets, the RNG, the clock, the stats, the report
  function finish() {
    if (!reel) return;
    const r = reel, s = r.saved, g = G();
    if (r.token) r.token.dead = true;
    if (WW.camLook && WW.camLook.prefer) WW.camLook.prefer(null);
    WW.time.hold = true;
    if (WW.terrain.seed !== s.terrain) WW.terrain.generate(s.terrain);
    WW.roundRec.apply(s.rec);              // the setup's fleets, choices, forced hour / weather, carried-over state
    g.seed = s.seed;
    g.enterSetup(false, false);
    WW.roundRec.apply(s.rec);              // (again: the setup's own resets)
    WW.setRandState(s.rand);
    for (const k in WW.stats) if (!(k in s.stats)) delete WW.stats[k];
    Object.assign(WW.stats, s.stats);
    WW.time.scale = s.scale;
    if (WW.cam) WW.cam.mode = s.mode;
    g.reel = false;
    reel = null;
    WW.time.hold = false; audioPause(false);
    cls('fin', false); cls('ff', false); cls('on', false); cls('dark', false); ui.cap.classList.remove('on');
    if (WW.cam && WW.cam.snap) WW.cam.snap();
    if (WW.aar && snap.aar) WW.aar.show(snap.aar);
    r.ended = true; r.resolve(r);
    last = r;
  }
  let last = null;

  // the action report's button
  function decorate(el, r) {
    if (!snap || r !== snap.aar || !snap.moments.length || reel || simming) return;
    const g = G(); if (g.infinite || g.mode === 'auto' || g.state === 'battle') return;
    const b = document.createElement('button'); b.className = 'hl-btn';
    b.textContent = 'Watch highlights (' + snap.moments.length + ' moments)';
    b.addEventListener('click', e => { e.stopPropagation(); play(0); });
    el.appendChild(b);
  }

  WW.highlights = {
    HSTEP,
    moments: () => (snap ? snap.moments : []),
    snapshot: () => snap,
    pick: (ev, endN, info) => pick(ev, endN, info),
    simRound, play, decorate,
    next: () => act('next'), prev: () => act('prev'), exit: () => act('exit'),
    goto: i => (reel ? goto(i) : play(i)),
    playing: () => !!reel,
    reel: () => (reel ? { i: reel.i, state: reel.state, clip: reel.clip, hashOk: reel.hashOk, bad: reel.bad, starts: reel.starts, done: reel.done } : null),
    lastReel: () => (last ? { hashOk: last.hashOk, bad: last.bad, starts: last.starts, played: last.played } : null)
  };

  // ?simthenreel: sim the round at once, then the end screen with the button
  if (/[?&]simthenreel\b/.test(location.search)) {
    const go = () => setTimeout(() => { if (G() && G().state === 'setup') simRound(); }, 800);
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go);
  }
})(window.WW);
