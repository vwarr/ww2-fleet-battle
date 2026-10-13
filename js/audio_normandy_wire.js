// audio_normandy_wire.js: plays the Normandy patches (audio_normandy.js) from the sim's events and by polling what the
// sim and the visuals expose, read-only: never a write to a sim object, never WW.rand (Math.random only), and nothing at
// all unless sound is on and the scenario is Normandy (every handler returns first; the Pacific's sound is untouched).
// Sources (events -> sound):
//   'defenceFire' { el, kind, target }  mg / tob: ger.mg42 bursts per gun (a burst, a pause: never a tick per event);
//                                        rounds snapping past / ricochets / thuds when the camera is low in the cone;
//                                        mortar: ger.mortar.fire; flak: aa.oerlikon (audio_aa.js); gun: ger.pak over
//                                        the naval family's report (shellFired already plays gun.med/small/big)
//   'mortarBurst' { x, z }             ger.mortar.burst; near the camera the whistle first and the crump after it
//   'craftEvent' { kind, craft }       ramp: craft.ramp; beached: craft.ground; wrecked: craft.wreck; mined: craft.mine;
//                                        foundered: craft.founder; holed: craft.holed
//   'gapBlown' { x, by }               us.bangalore
//   'squadEvent' lost (a tank)         ship.boom (audio_naval.js): the brew-up
//   'landImpact' { kind, cal }         shell big / bomb: land.big over shell.land (rockets: from the barrage poll)
//   'airOffmap' shotDown               plane.fireball (audio_air.js)
// Polled (only while on; 4 Hz unless noted):
//   craft engines: the ENG_N nearest craft afloat within ENG_FAR (craft.engine by type; full power on the run, idling on
//     the sand, astern off it), the TANK_N nearest Shermans ashore; bow slaps for running craft near the camera
//   squads: each squad fighting (shingle, shelf, climb, top, assault, hold; not pinned; a German position in reach) near
//     the camera fires M1s, a BAR, now and then a bazooka or a grenade at the assault, on its own real-time cadence
//   the surf (every frame): the breakers crash in time with waves.js's breaker lines (phase 2 pi / L (s + V t)), at the
//     breaker line nearest the camera; beach.wash at the waterline (tide.js waterZ: it comes in with the flood);
//     beach.gust when the camera is low near the beach; beach.gull before H-hour only (amb.gull is held off here)
//   the rocket barrage (every frame; rocket_barrage.js, visual): a rocket.ripple loop per LCT(R) at its launch rate,
//     rocket.whoosh over the camera, rocket.carpet per 30 u cell of impacts (splashes or bursts) every CARPET_DT s
//   the planes (air_offmap.js): an air.b24 drone per box over the cloud, plane.engine for the nearest fighters
// The mix: the many-source families (MG, rifles, BAR, slaps, carpets, mortar fire) are queued per frame, sorted by their
// level at the camera and played within a voice budget each: a louder (nearer) sound takes the quietest one's place,
// a quieter one is dropped (the engine's own per-patch cap would steal the oldest, near or far). Heat from near fire
// ducks the ambience (A.duck) and turns the beach beds down: chaos up close, not mush.
window.WW = window.WW || {};
(function (WW) {
  const A = WW.audio; if (!A || !A.patches['ger.mg42']) return;
  const R = A.syn.rand, clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const now = () => performance.now() / 1000;
  const N = () => WW.isScn('normandy');
  const on = () => A.live && N();
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  const simRate = () => (A.simRate > 0.05 && A.simRate < 64 ? A.simRate : 0.5 * (WW.time.scale || 1) * (WW.time.warp || 1));
  const gy = (x, z) => { try { return Math.max(0, WW.terrain.heightRaw(x, z)); } catch (e) { return 0; } };
  const ENG_N = 4, ENG_FAR = 140, TANK_N = 2, TANK_FAR = 90, FIGHT_N = 4, FIGHT_FAR = 260, INF_FAR = 160, FIRE_R = 70, SNAP_R = 14;
  const BRK = { L: 15, V: 3.2 }, FLIGHT = 2.6, CARPET_DT = 0.12;   // waves.js BRK, rocket_barrage.js FLIGHT (mirrored)
  const BUDGET = { 'ger.mg42': 5, 'us.rifle': 5, 'us.bar': 3, 'craft.slap': 3, 'rocket.carpet': 5, 'ger.mortar.fire': 2, 'aa.oerlikon': 2, 'ger.pak': 3, 'bullet.snap': 3 };
  const FIRES = { shingle: 1, shelf: 1, climb: 1, top: 1, assault: 1, hold: 1 };
  const ST = { ev: {}, req: {}, played: {}, skipped: {}, maxPend: 0, maxLater: 0, inten: 0, heat: 0 };
  const cnt = (o, k, n) => { o[k] = (o[k] || 0) + (n || 1); };

  // ---------- playing: direct, budgeted (queued per frame, loudest first), later (a wall-clock timer) ----------
  function play(n, o) { cnt(ST.req, n); const v = A.play(n, o); if (v) cnt(ST.played, n); return v; }
  const levelOf = (n, o) => { const d = A.patches[n]; return (o.vol == null ? 1 : o.vol) * A.distGain(A.distTo(o.x, o.y || 0, o.z), (o.ref || (d && d.ref) || 30)); };
  const pend = [], act = {}, later = [];
  function queue(n, o, dur) {
    const lv = levelOf(n, o);
    if (lv < A.C.CULL) { cnt(ST.skipped, n); return; }
    if (pend.length >= 96) { cnt(ST.skipped, n); return; }   // a fast-forward with sound on (no frames): drop, never pile up
    pend.push({ n, o, lv, dur: dur || 1, t: now() });
    if (pend.length > ST.maxPend) ST.maxPend = pend.length;
  }
  function flush() {
    if (!pend.length) return;
    const t = now();
    pend.sort((a, b) => b.lv - a.lv);
    for (const q of pend) {
      if (t - q.t > 0.3) { cnt(ST.skipped, q.n); continue; }
      const L = act[q.n] || (act[q.n] = []), B = BUDGET[q.n] || 4;
      for (let i = L.length - 1; i >= 0; i--) if (t > L[i].end) L.splice(i, 1);
      if (L.length >= B) {
        let qi = -1, ql = 1e9;
        for (let i = 0; i < L.length; i++) { const e = L[i], k = 1 - clamp((t - e.t0) / Math.max(0.05, e.end - e.t0), 0, 1), l = e.lv * (0.3 + 0.7 * k); if (l < ql) { ql = l; qi = i; } }
        if (ql >= q.lv) { cnt(ST.skipped, q.n); continue; }
        const e = L.splice(qi, 1)[0]; if (e.v && e.v.stop) e.v.stop(0.06);
      }
      const v = play(q.n, q.o);
      if (v) L.push({ v, lv: q.lv, t0: t, end: t + (q.o.delay || 0) + q.dur });
    }
    pend.length = 0;
  }
  function after(secs, fn) { if (later.length < 200) later.push({ t: now() + secs, fn }); if (later.length > ST.maxLater) ST.maxLater = later.length; }
  function runLater() {
    if (!later.length) return;
    const t = now();
    for (let i = later.length - 1; i >= 0; i--) if (later[i].t <= t) { const e = later.splice(i, 1)[0]; if (t - e.t < 1) try { e.fn(); } catch (x) {} }
  }
  // heat: near fire, for the ducking (decays over ~5 s real)
  function heat(h, x, y, z) { ST.heat += h * A.distGain(A.distTo(x, y || 0, z), 40); }

  // ---------- the German fire ----------
  const gun = new Map();   // element -> { mg, mort, flak } next-allowed times (real s)
  const gs = el => { let s = gun.get(el); if (!s) gun.set(el, s = { mg: 0, mort: 0, flak: 0 }); return s; };
  WW.on('defenceFire', e => {
    if (!on() || !e || !e.el) return;
    const el = e.el, k = el.kind === 'flak' ? 'flak' : e.kind; cnt(ST.ev, 'defenceFire.' + k);
    if (k === 'mg' || k === 'tob') mg(el, e.target);
    else if (k === 'mortar') { const s = gs(el), t = now(); if (t < s.mort) return; s.mort = t + R(2.5, 7); queue('ger.mortar.fire', { x: el.x, y: (el.y || 0) + 0.3, z: el.z }, 0.6); }
    else if (k === 'flak') { const s = gs(el), t = now(); if (t < s.flak) return; s.flak = t + R(1.2, 3); queue('aa.oerlikon', { x: el.x, y: (el.y || 0) + 0.5, z: el.z, shots: 6 + Math.floor(Math.random() * 6), vol: 0.8 }, 1.4); }
    else if (k === 'gun') {
      const cal = el.K && el.K.gun && el.K.gun.cal;
      queue('ger.pak', { x: el.x, y: (el.y || 0) + 0.5, z: el.z, big: cal === 'big' ? 1 : 0 }, 1);
      heat(0.6, el.x, el.y, el.z);
    }
  });
  function mg(el, tg) {
    const s = gs(el), t = now(); if (t < s.mg) return;
    const dur = Math.random() < 0.2 ? R(1.1, 1.8) : R(0.3, 0.9);
    s.mg = t + dur + R(0.25, 1.1);
    const y = (el.y || 0) + 0.3;
    queue('ger.mg42', { x: el.x, y, z: el.z, dur, vol: R(0.8, 1) }, dur + 0.6);
    heat(0.4, el.x, y, el.z);
    if (tg && isFinite(tg.x)) snaps(el, tg, dur);
  }
  // the camera low in the cone: rounds cracking past, a ricochet off the obstacles, rounds into the sand nearby
  function snaps(el, tg, dur) {
    const L = A.listener, ground = gy(L.x, L.z); if (L.y - ground > 22) return;
    const ex = tg.x - el.x, ez = tg.z - el.z, len2 = ex * ex + ez * ez || 1;
    const u = clamp(((L.x - el.x) * ex + (L.z - el.z) * ez) / len2, 0, 1.25);
    const d = Math.hypot(el.x + ex * u - L.x, el.z + ez * u - L.z) + Math.max(0, L.y - ground - 3) * 0.5;
    if (d > SNAP_R) return;
    const k = 1 - d / SNAP_R, n = clamp(Math.round(dur * R(4, 9) * k), 1, 8), y = ground + 0.6;
    for (let i = 0; i < n; i++) after(R(0, dur), () => { const a = Math.random() * 6.283, r = R(1, 4); queue('bullet.snap', { x: L.x + Math.cos(a) * r, y: L.y + R(-1, 1), z: L.z + Math.sin(a) * r, vol: R(0.5, 1) * (0.5 + 0.5 * k) }, 0.1); });
    if (Math.random() < 0.3 * k) after(R(0.05, dur), () => play('bullet.rico', { x: L.x + R(-6, 6), y, z: L.z + R(-6, 6), vol: R(0.5, 0.9) }));
    if (Math.hypot(tg.x - L.x, tg.z - L.z) < 12) for (let i = 0; i < 3; i++) after(R(0, dur), () => play('bullet.thud', { x: L.x + R(-4, 4), y: gy(L.x, L.z), z: L.z + R(-4, 4), vol: R(0.4, 0.8) }));
    cnt(ST.ev, 'snapBurst');
  }
  WW.on('mortarBurst', e => {
    if (!on() || !e) return;
    cnt(ST.ev, 'mortarBurst');
    const y = gy(e.x, e.z), d = A.distTo(e.x, y, e.z);
    heat(1, e.x, y, e.z);
    if (d < 60) { play('ger.mortar.whistle', { x: e.x, y: y + 6, z: e.z, vol: clamp(1.3 - d / 60, 0.3, 1) }); after(0.62, () => play('ger.mortar.burst', { x: e.x, y, z: e.z })); }
    else play('ger.mortar.burst', { x: e.x, y, z: e.z });
  });

  // ---------- the craft, the gaps, the tanks, the impacts, the planes ----------
  const CRAFT_EV = { ramp: 'craft.ramp', beached: 'craft.ground', wrecked: 'craft.wreck', mined: 'craft.mine', foundered: 'craft.founder', holed: 'craft.holed' };
  WW.on('craftEvent', e => {
    if (!on() || !e || !e.craft) return;
    const n = CRAFT_EV[e.kind], c = e.craft; if (!n) return;
    cnt(ST.ev, 'craft.' + e.kind);
    if (e.kind === 'beached' && c.type === 'dd') return;                 // a DD ashore drives out: no keel
    const big = c.type === 'lct' || c.type === 'lci';
    play(n, { x: c.x, y: 0.3, z: c.z, size: big ? 1.3 : c.type === 'dd' ? 0.7 : 1, vol: e.kind === 'beached' ? 0.7 : 1 });
    if (e.kind === 'wrecked' || e.kind === 'mined') heat(1.5, c.x, 0, c.z);
  });
  WW.on('gapBlown', g => {
    if (!on() || !g) return;
    cnt(ST.ev, 'gapBlown');
    const z = g.by && isFinite(g.by.z) ? g.by.z : WW.normandyTerrain ? WW.normandyTerrain.shingleZ(g.x) : 0, y = gy(g.x, z);
    play('us.bangalore', { x: g.x, y, z }); heat(1.2, g.x, y, z);
  });
  WW.on('squadEvent', e => {
    if (!on() || !e || !e.squad || e.kind !== 'lost' || e.squad.kind !== 'tank') return;
    cnt(ST.ev, 'tankLost'); const q = e.squad;
    play('ship.boom', { x: q.x, y: gy(q.x, q.z) + 0.4, z: q.z, size: 0.7 });
  });
  WW.on('landImpact', e => {
    if (!on() || !e) return;
    cnt(ST.ev, 'landImpact.' + e.kind);
    if ((e.kind === 'shell' && e.cal === 'big') || e.kind === 'bomb') {
      const y = gy(e.x, e.z);
      play('land.big', { x: e.x, y, z: e.z, size: e.kind === 'bomb' ? 0.8 : 1.1, vol: e.kind === 'bomb' ? 0.8 : 1 });
      heat(1.5, e.x, y, e.z);
    }
  });
  WW.on('airOffmap', e => {
    if (!on() || !e || !e.plane || e.kind !== 'shotDown') return;
    cnt(ST.ev, 'shotDown');
    play('plane.fireball', { at: e.plane, size: 1 });
  });

  // ---------- polled: engines, slaps, the squads' fire ----------
  const eng = new Map(), slapT = new Map(), sq = new Map();
  function pollCraft() {
    const LC = WW.landingCraft, live = LC ? LC.live : [];
    const want = [];
    for (const u of live) {
      if (!u.alive) continue;
      const d = A.distTo(u.x, 0, u.z) * (eng.has(u) ? 0.85 : 1);
      if (d < ENG_FAR) want.push({ u, d, far: ENG_FAR });
      if (u.state === 'run' && d < 50) {   // the bow slamming into the seas
        const t = now(), n = slapT.get(u) || 0;
        if (t >= n) { if (n) queue('craft.slap', { x: u.x + Math.cos(u.heading) * u.C.len * 0.4, y: 0.2, z: u.z + Math.sin(u.heading) * u.C.len * 0.4, size: u.C.len > 3 ? 1.3 : R(0.7, 1.1) }, 0.6); slapT.set(u, t + R(0.9, 2.6)); }
      }
    }
    want.sort((a, b) => a.d - b.d); want.length = Math.min(want.length, ENG_N);
    const tanks = [];
    if (WW.infantry) for (const q of WW.infantry.squads) if (q.alive && q.kind === 'tank') { const d = A.distTo(q.x, q.y || 0, q.z) * (eng.has(q) ? 0.85 : 1); if (d < TANK_FAR) tanks.push({ u: q, d, far: TANK_FAR, tank: true }); }
    tanks.sort((a, b) => a.d - b.d); tanks.length = Math.min(tanks.length, TANK_N);
    const keep = new Set();
    for (const w of want.concat(tanks)) {
      const u = w.u; keep.add(u);
      const st = u.state, thr = w.tank ? (u.speed > 0.05 ? 0.9 : 0.4) : st === 'run' ? 1 : st === 'off' ? (u.speed > 0 ? 0.8 : 0.3) : 0.35;
      const vol = 0.85 * clamp(1.25 - A.distTo(u.x, 0, u.z) / w.far, 0, 1);
      let h = eng.get(u);
      if (!h || !h.alive) eng.set(u, A.loop('craft.engine', { at: u, vol, thr, type: w.tank ? 'tank' : u.type }));
      else h.set({ vol, thr });
    }
    for (const [u, h] of eng) if (!keep.has(u) || !h.alive) { h.stop(0.8); eng.delete(u); }
    for (const u of slapT.keys()) if (!u.alive) slapT.delete(u);
  }
  function pollSquads() {
    const I = WW.infantry, CD = WW.coastDefence; if (!I || !CD) return;
    const t = now(), L = A.listener, pin = I.PIN || 1;
    for (const q of I.squads) {
      if (!q.alive || q.kind === 'tank' || !FIRES[q.state] || q.sup > pin) continue;
      const d = Math.hypot(q.x - L.x, q.z - L.z); if (d > INF_FAR) continue;
      let s = sq.get(q); if (!s) sq.set(q, s = { next: t + R(0, 1.5), el: null, elT: 0 });
      if (t < s.next) continue;
      if (t > s.elT) {   // a German position in reach (re-checked every few seconds)
        s.elT = t + 2; s.el = null; let bd = FIRE_R;
        for (const e of CD.elements) { if (!e.alive || e.dormant || e.type === 'wall') continue; const de = Math.hypot(e.x - q.x, e.z - q.z); if (de < bd) { bd = de; s.el = e; } }
      }
      if (!s.el) { s.next = t + 2; continue; }
      const men = Math.max(3, q.men || 3), y = (q.y || gy(q.x, q.z)) + 0.2, de = Math.hypot(s.el.x - q.x, s.el.z - q.z);
      s.next = t + R(0.5, 1.8) * 12 / men;
      const r = Math.random(), o = { x: q.x + R(-1, 1), y, z: q.z + R(-1, 1) };
      if (q.state === 'assault' && de < 14 && r < 0.06) { play('us.bazooka', Object.assign(o, { fl: clamp(de / 20, 0.2, 0.8) })); heat(0.6, q.x, y, q.z); }
      else if (q.state === 'assault' && de < 14 && r < 0.18) after(R(1, 2), () => play('ger.mortar.burst', { x: s.el.x + R(-1, 1), y: (s.el.y || 0) + 0.2, z: s.el.z + R(-1, 1), size: 0.5, vol: 0.7 }));   // a grenade into the position
      else if (r < 0.45) queue('us.bar', Object.assign(o, { n: 4 + Math.floor(Math.random() * 5) }), 1);
      else queue('us.rifle', Object.assign(o, { n: 1 + Math.floor(Math.random() * 3), ping: Math.random() < 0.12 ? 1 : 0, vol: R(0.7, 1) }), 1.5);
    }
    for (const q of sq.keys()) if (!q.alive) sq.delete(q);
  }

  // ---------- the surf, the wind, the gulls ----------
  const brk = { next: 0, t: 0, s: 8, x: 0 }, beds = { wash: null, gust: null, at: { x: 0, y: 0.2, z: 0 }, gullT: 4 };
  const NT = () => WW.normandyTerrain;
  function beachX(L) { return clamp(L.x, 650, 2250); }
  function pollSurf(dt) {
    const L = A.listener, T = NT(); if (!T || !WW.tide) return;
    const x = beachX(L), wz = WW.tide.waterZ(x), dShore = Math.hypot(x - L.x, wz - L.z), h = Math.max(0, L.y);
    const calmK = 1 - 0.45 * ST.inten;
    // the waterline bed
    beds.at.x = x; beds.at.z = wz; beds.at.y = 0.2;
    if (!beds.wash || !beds.wash.alive) beds.wash = A.loop('beach.wash', { at: beds.at, vol: 0 });
    beds.wash.set({ vol: 0.9 * calmK * (1 - sm(40, 160, h)) });
    // the gusts low over the beach, from the WNW
    const w = WW.wind || { x: 1, z: 0 }, wl = Math.hypot(w.x, w.z) || 1, pan = -(w.x * L.rx + w.z * L.rz) / wl;
    if (!beds.gust || !beds.gust.alive) beds.gust = A.loop('beach.gust', { ui: true, vol: 0, pan });
    beds.gust.set({ vol: 0.55 * calmK * (1 - sm(25, 200, dShore)) * (1 - sm(12, 60, h - gy(L.x, L.z))) * clamp(wl / 0.85, 0.4, 1.3), pan });
    // the breaker line: where the flat is ~1 u deep, offshore of the waterline (recomputed every 0.5 s)
    if ((brk.t -= dt) <= 0 || Math.abs(x - brk.x) > 20) {
      brk.t = 0.5; brk.x = x;
      let z = wz; for (let i = 0; i < 60 && WW.tide.depth(x, z) < 1; i++) z -= 1;
      brk.s = T.shoreZ(x) - z;
    }
    // gulls: first light, before the first wave touches down
    const C = WW.scenarios.normandy && WW.scenarios.normandy.clock;
    if (C && rt() < C.H && (beds.gullT -= dt) <= 0) {
      beds.gullT = R(5, 14);
      if (h < 60 && dShore < 220 && Math.random() < 0.7) play('beach.gull', { x: x + R(-40, 40), y: R(8, 25), z: wz + R(-40, 25), vol: R(0.5, 0.9) });
    }
  }
  function breakers() {
    const W = WW.waves; if (!W || !W.active || !NT()) return;
    const T = W.time, t = now();
    if (t >= brk.next) {
      if (brk.next > 0 && t - brk.next < 0.5) {
        const L = A.listener, h = Math.max(0, L.y), k = 1 - sm(40, 180, h);
        if (k > 0.02) for (const dx of [-30, 0, 30]) {
          const x = brk.x + dx + R(-6, 6), z = NT().shoreZ(x) - brk.s;
          play('beach.breaker', { x, y: 0.3, z, size: R(0.8, 1.2), vol: k * (dx ? 0.7 : 1) * (1 - 0.4 * ST.inten) });
        }
      }
      // the next crest at s: (s + V T') = L / 4 (mod L), T' > T (the lip falls a beat after the crest)
      const ph = ((brk.s + BRK.V * T) % BRK.L + BRK.L) % BRK.L, to = (((BRK.L / 4 - ph) % BRK.L) + BRK.L) % BRK.L / BRK.V;
      brk.next = t + (to < 0.05 ? to + BRK.L / BRK.V : to) + 0.15;
    }
  }
  // amb.gull (audio_amb.js, its own calm gate) is held off in Normandy: these gulls are ours, and only before H-hour.
  // Its def's minGap goes to Infinity while Normandy is the scenario and back to its own value otherwise.
  let gullGap = null;
  function holdAmbGull() {
    const d = A.patches['amb.gull']; if (!d) return;
    if (N()) { if (gullGap === null) { gullGap = d.minGap; d.minGap = Infinity; } }
    else if (gullGap !== null) { d.minGap = gullGap; gullGap = null; }
  }
  WW.on('scenario', holdAmbGull);

  // ---------- the rocket barrage ----------
  const rk = { arr: null, by: [], l: 0, i: 0, ships: new Map(), cells: new Map(), cT: 0, lastRt: 0 };
  function pollRockets(rdt) {
    const RB = WW.rocketBarrage, arr = RB ? RB.rockets : null;
    if (!arr || !arr.length) { if (rk.ships.size) for (const s of rk.ships.values()) if (s.h) s.h.stop(0.8); rk.ships.clear(); rk.arr = null; return; }
    if (arr !== rk.arr || arr.length !== rk.by.length) { rk.arr = arr; rk.by = arr.slice().sort((a, b) => a.t0 - b.t0); rk.l = 0; rk.i = 0; }
    const t = rt(), dts = Math.max(0, t - rk.lastRt); rk.lastRt = t;
    const L = A.listener, by = rk.by;
    for (const s of rk.ships.values()) s.rate *= Math.exp(-dts / 0.5);
    while (rk.l < by.length && by[rk.l].t0 <= t) {   // launches
      const r = by[rk.l++]; if (t - r.t0 > 2) continue;
      let s = rk.ships.get(r.ship); if (!s) rk.ships.set(r.ship, s = { rate: 0, h: null, n: 0 });
      s.rate += 1; s.n++;
      const mx = (r.sx + r.tx) / 2, mz = (r.sz + r.tz) / 2;
      if (Math.hypot(mx - L.x, 26 - L.y, mz - L.z) < 30 && Math.random() < 0.3) after(Math.max(0, (r.t0 + FLIGHT * 0.5 - t) / simRate() - 0.3), () => play('rocket.whoosh', { x: mx, y: 26, z: mz, vol: R(0.5, 0.9) }));
    }
    for (const [ship, s] of rk.ships) {
      const vol = clamp(s.rate / 7, 0, 1);
      if (vol > 0.02 && (!s.h || !s.h.alive)) { s.h = A.loop('rocket.ripple', { at: ship, vol }); cnt(ST.ev, 'rippleLoop'); }
      else if (s.h && s.h.alive) { if (vol < 0.01) { s.h.stop(1); s.h = null; } else s.h.set({ vol }); }
    }
    while (rk.i < by.length && by[rk.i].t0 + FLIGHT <= t) {   // impacts, by 30 u cell
      const r = by[rk.i++]; if (t - r.t0 - FLIGHT > 2) continue;
      const k = Math.floor(r.tx / 30); let c = rk.cells.get(k); if (!c) rk.cells.set(k, c = { n: 0, wet: 0, x: 0, z: 0 });
      c.n++; c.x += r.tx; c.z += r.tz; if (WW.tide && WW.tide.depth(r.tx, r.tz) > 0) c.wet++;
      cnt(ST.ev, 'rocketImpact');
    }
    if ((rk.cT -= rdt) <= 0) {
      rk.cT = CARPET_DT;
      for (const c of rk.cells.values()) {
        const x = c.x / c.n, z = c.z / c.n, y = gy(x, z);
        queue('rocket.carpet', { x, y, z, n: Math.min(8, c.n), wet: c.wet / c.n, span: CARPET_DT * 1.5 }, 1.2);
        heat(0.3 * Math.min(4, c.n), x, y, z);
      }
      rk.cells.clear();
    }
  }

  // ---------- the planes ----------
  const air = { boxes: new Map(), eng: new Map() };
  const FTYPE = { p47: 'torp', spit: 'zero', fw190: 'wildcat' };
  function pollAir() {
    const OA = WW.offmapAir, P = OA ? OA.planes : [];
    const box = new Map(), fl = [];
    for (const p of P) {
      if (!p.alive) continue;
      if (p.kind === 'b24') { let b = box.get(p.box); if (!b) box.set(p.box, b = { x: 0, y: 0, z: 0, n: 0 }); b.x += p.x; b.y += p.y; b.z += p.z; b.n++; }
      else if (FTYPE[p.kind]) { const d = A.distTo(p.x, p.y, p.z) * (air.eng.has(p) ? 0.85 : 1); if (d < FIGHT_FAR) fl.push({ p, d }); }
    }
    for (const [k, b] of box) {
      let a = air.boxes.get(k);
      if (!a) { a = { at: { x: 0, y: 0, z: 0 }, h: null }; air.boxes.set(k, a); }
      a.at.x = b.x / b.n; a.at.y = b.y / b.n; a.at.z = b.z / b.n;
      const cloud = !(WW.scenarios.normandy.settings && WW.scenarios.normandy.settings.cloud === false);
      if (!a.h || !a.h.alive) a.h = A.loop('air.b24', { at: a.at, vol: 0.9, n: b.n, cloud: cloud ? 1 : 0 });
    }
    for (const [k, a] of air.boxes) if (!box.has(k)) { if (a.h) a.h.stop(3); air.boxes.delete(k); }
    fl.sort((a, b) => a.d - b.d); fl.length = Math.min(fl.length, FIGHT_N);
    const keep = new Set();
    for (const { p } of fl) {
      keep.add(p);
      const dive = p.state === 'dive' ? 0.7 : 0, thr = p.state === 'dive' ? 1.1 : p.state === 'pullout' ? 1.25 : 0.95;
      let h = air.eng.get(p);
      if (!h || !h.alive) air.eng.set(p, A.loop('plane.engine', { at: p, doppler: (WW.time.scale || 1) < 3, type: FTYPE[p.kind], nat: p.nation, thr, air: 0.8, dive, vol: 0.9 }));
      else h.set({ thr, dive });
    }
    for (const [p, h] of air.eng) if (!keep.has(p) || !h.alive) { h.stop(p.alive ? 1 : 0.2); air.eng.delete(p); }
  }

  // ---------- reset, the per-frame hook ----------
  function stopAll() {
    for (const h of eng.values()) h.stop(0.3); eng.clear(); slapT.clear(); sq.clear(); gun.clear();
    for (const s of rk.ships.values()) if (s.h) s.h.stop(0.3); rk.ships.clear(); rk.arr = null; rk.by = []; rk.cells.clear();
    for (const a of air.boxes.values()) if (a.h) a.h.stop(0.3); air.boxes.clear();
    for (const h of air.eng.values()) h.stop(0.3); air.eng.clear();
    if (beds.wash) beds.wash.stop(0.5); if (beds.gust) beds.gust.stop(0.5); beds.wash = beds.gust = null;
    pend.length = 0; later.length = 0; ST.heat = 0; brk.next = 0;
    for (const k in act) act[k].length = 0;
  }
  WW.on('roundStart', () => { stopAll(); holdAmbGull(); beds.gullT = 3; });
  WW.on('setupStart', () => { stopAll(); holdAmbGull(); });

  let acc = 0, wasN = false, duckT = 0;
  A.onUpdate(rdt => {
    if (!N()) { if (wasN) { stopAll(); wasN = false; } return; }
    wasN = true;
    const dt = rdt || 0;
    runLater();
    breakers();
    pollRockets(dt);
    flush();
    ST.heat *= Math.exp(-dt / 5);
    ST.inten = 1 - Math.exp(-ST.heat / 6);
    acc += dt;
    if (acc >= 0.25) {
      const k = acc; acc = 0;
      holdAmbGull();
      pollSurf(k); pollCraft(); pollSquads(); pollAir();
      if ((duckT -= k) <= 0 && ST.inten > 0.35) { duckT = 0.9; A.duck(0.2 + 0.35 * (ST.inten - 0.35), 1.4); cnt(ST.ev, 'duck'); }
      flush();
    }
  });
  holdAmbGull();

  // tests / tooling (read-only)
  WW.audioNormandy = {
    BUDGET,
    stats() {
      let engV = 0; for (const h of eng.values()) if (h.voice) engV++;
      let fV = 0; for (const h of air.eng.values()) if (h.voice) fV++;
      return { ev: Object.assign({}, ST.ev), req: Object.assign({}, ST.req), played: Object.assign({}, ST.played), skipped: Object.assign({}, ST.skipped),
        engines: eng.size, engineVoices: engV, fighters: air.eng.size, fighterVoices: fV, b24Boxes: air.boxes.size, ripples: [...rk.ships.values()].filter(s => s.h).length,
        squadsTracked: sq.size, inten: ST.inten, maxPend: ST.maxPend, maxLater: ST.maxLater, breakerS: brk.s, gullHeld: gullGap !== null,
        active: Object.fromEntries(Object.entries(act).map(([k, v]) => [k, v.length])) };
    }
  };
})(window.WW);
