// audio_naval_wire.js: plays the naval patches (audio_naval.js) from sim events, and polls ship state
// (engines, fires, sinking, submarine dives) while sound is on. Sim code never calls WW.audio:
// it only emits events (combat.js, combat_weapons.js, ships.js, damage.js). Every handler returns at once
// when sound is off, and loops are only made while sound is on (no handles pile up in a muted screensaver).
window.WW = window.WW || {};
(function (WW) {
  const A = WW.audio; if (!A || !A.patches['gun.big']) return;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const GUN = { big: 'gun.big', med: 'gun.med', small: 'gun.small', mg: 'gun.mg' };
  const SPLASH = { big: 1.4, med: 1, small: 0.7, mg: 0.35 };
  const lenOf = s => (s && s.stats && s.stats.length) || 12;
  // sim seconds per real second: the engine's measured rate (includes main.js BASE_SPEED and slow frames)
  const simRate = () => (A.simRate > 0.05 && A.simRate < 64 ? A.simRate : 0.5 * (WW.time.scale || 1) * (WW.time.warp || 1));

  // ---------- guns: the barrels of one ship firing in the same frame are one salvo, one play ----------
  const salvo = [];
  WW.on('shellFired', e => {
    if (!A.live) return;
    whistle(e);
    for (let i = 0; i < salvo.length; i++) { const s = salvo[i]; if (s.ship === e.ship && s.cal === e.cal) { s.n++; return; } }
    if (salvo.length < 16) salvo.push({ ship: e.ship, cal: e.cal, n: 1, x: e.x, y: e.y, z: e.z });
  });
  function flushSalvos() {
    for (let i = 0; i < salvo.length; i++) {
      const s = salvo[i], name = GUN[s.cal]; if (!name) continue;
      const size = s.cal === 'big' ? clamp(lenOf(s.ship) / 24, 0.8, 1.2) : 1;
      A.play(name, { x: s.x, y: s.y, z: s.z, n: s.n, size, vol: Math.min(1, 0.8 + 0.1 * s.n) });
    }
    salvo.length = 0;
  }
  // a big or medium shell whose path passes the camera: whistle timed so its loudest point is the closest approach
  function whistle(e) {
    const p = e.proj; if (!p || !(p.T > 0.8) || (e.cal !== 'big' && e.cal !== 'med')) return;
    const L = A.listener; let best = 1e9, bt = 0, bx = 0, by = 0, bz = 0;
    for (let i = 3; i <= 12; i++) { // skip the first quarter of the flight: that is the gun's own sound
      const t = p.T * i / 12, x = p.x0 + p.vx * t, y = p.y0 + p.vy0 * t - 0.5 * p.g * t * t, z = p.z0 + p.vz * t;
      const d2 = (x - L.x) * (x - L.x) + (y - L.y) * (y - L.y) + (z - L.z) * (z - L.z);
      if (d2 < best) { best = d2; bt = t; bx = x; by = y; bz = z; }
    }
    if (best > 45 * 45) return;
    const delay = bt / simRate() - 0.75;
    if (delay < -0.3) return;
    A.play('shell.whistle', { x: bx, y: by, z: bz, delay: Math.max(0, delay), size: e.cal === 'big' ? 1 : 0.6, vol: clamp(1.4 - Math.sqrt(best) / 45, 0.4, 1) });
  }

  // ---------- misses and hits ----------
  WW.on('shellLanded', e => {
    if (!A.live || e.ship) return; // hits are played from shipHit
    const k = SPLASH[e.cal] || 0.5, land = WW.terrain && WW.terrain.depthAt && WW.terrain.depthAt(e.x, e.z) <= 0;
    if (land) { if (e.cal === 'big' || e.cal === 'med') A.play('shell.land', { x: e.x, y: 0, z: e.z, size: k }); return; }
    if (e.cal === 'big' || e.cal === 'med') A.play('shell.splash', { x: e.x, y: 0, z: e.z, size: k });
    else A.play('shell.splash.small', { x: e.x, y: 0, z: e.z, size: k, vol: e.cal === 'mg' ? 0.6 : 1 });
  });
  WW.on('shipHit', e => {
    if (!A.live || !e || !e.ship) return;
    const s = e.ship, x = e.x != null && isFinite(e.x) ? e.x : s.x, z = e.z != null && isFinite(e.z) ? e.z : s.z, y = 1.2;
    if (e.kind === 'torpedo') A.play('torp.hit', { x, y: 0, z });
    else if (e.kind === 'bomb') A.play('ship.hit', { x, y, z, size: 1.6, bang: 0 }); // the bomb blast itself belongs to the aircraft/weapons family
    else if (e.kind === 'dc') { /* dcBlast covers it */ }
    else if (e.cal === 'mg') A.play('ship.ping', { x, y, z });
    else { const size = clamp((e.amount || 20) / 55, 0.35, 2); A.play('ship.hit', { x, y, z, size, duck: size > 1.5 ? 0.35 : 0 }); }
  });
  WW.on('shipBoom', e => { if (A.live && e) A.play('ship.boom', { x: e.x, y: e.y || 1, z: e.z, size: clamp(e.size || 1, 0.5, 1.6) }); });

  // ---------- kills, sinking, settling ----------
  const sinking = new Map(); // ship -> sink voice
  WW.on('shipSunk', s => {
    if (!A.live || !s) return;
    const k = clamp(lenOf(s) / 24, 0.35, 1.2);
    A.play('ship.magazine', { at: s, size: k, vol: 0.6 + 0.4 * k });
    const v = A.play('ship.sink', { at: s, size: k, vol: 0.5 + 0.5 * k, sos: true });
    if (v) sinking.set(s, v);
  });
  function pollSinking() {
    for (const [s, v] of sinking) {
      if (s.sinking && !s.removed) continue;
      if (v.stop) v.stop(1.2);
      if (s.wreck && !s.removed) A.play('ship.settle', { at: s, vol: 0.4 + 0.4 * clamp(lenOf(s) / 24, 0.3, 1) });
      sinking.delete(s);
    }
  }

  // ---------- torpedoes ----------
  const runs = []; // { p, h }
  WW.on('weaponDropped', e => {
    if (!A.live || !e || e.kind !== 'torpedo' || !e.proj) return;
    const o = e.plane, p = e.proj;
    if (o && o.stats && o.type) A.play('torp.launch', { x: p.x, y: 0, z: p.z, tube: o.type === 'submarine' ? 'sub' : o.type === 'pt' ? 'pt' : 'ship', vol: o.type === 'pt' ? 0.85 : 1 });
    if (runs.length >= 10) runs.shift().h.stop(0.1);
    runs.push({ p, h: A.loop('torp.run', { at: p, vol: 0.8 }) });
  });
  WW.on('weaponImpact', e => {
    if (!A.live || !e || e.kind !== 'torpedo') return;
    for (let i = runs.length - 1; i >= 0; i--) if (runs[i].p === e.proj) { runs[i].h.stop(0.15); runs.splice(i, 1); }
    if (!e.ship) A.play('torp.fizz', { x: e.x, y: 0, z: e.z });
  });
  function pollRuns() {
    for (let i = runs.length - 1; i >= 0; i--) { const r = runs[i]; if (r.p.dead || r.p.kind !== 'torp' || !r.h.alive) { r.h.stop(0.15); runs.splice(i, 1); } }
  }

  // ---------- depth charges ----------
  WW.on('dcDropped', e => { if (A.live && e) A.play('dc.splash', { x: e.x, y: 0, z: e.z }); });
  WW.on('dcBlast', e => { if (A.live && e) A.play('dc.blast', { x: e.x, y: -2, z: e.z }); });

  // ---------- polled ship state: engines (nearest few), fires, submarine dives ----------
  const eng = new Map(), fire = new Map(), subWant = new Map();
  const ENG_N = 3, PT_N = 2, ENG_FAR = 150, PT_FAR = 110;
  const cand = [], ptCand = [];
  function pollShips() {
    const ships = (WW.world && WW.world.ships) || [];
    cand.length = 0; ptCand.length = 0;
    for (let i = 0; i < ships.length; i++) {
      const s = ships[i];
      if (s.removed) continue;
      // fires: sites burning above the water (damage.js); a fresh sinking hull with no sites burns along its deck
      let n = 0;
      if (s.dmgSites) for (let j = 0; j < s.dmgSites.length; j++) if (s.dmgSites[j].fire > 0) n++;
      if (s.sinking && !s.dmgSites.length && s.sinkT < 6) n = 2;
      if (s.sinking && s.sinkT > 6) n = 0;
      let h = fire.get(s);
      if (n > 0) {
        if (!h || !h.alive) fire.set(s, h = A.loop('fire.ship', { at: s, vol: 0.5, n }));
        else h.set({ n, vol: 0.4 + 0.05 * Math.min(4, n) });
      } else if (h) { h.stop(1.5); fire.delete(s); }
      if (!s.alive || s.sinking) continue;
      if (s.type === 'submarine') { // dive / surface: the AI flips wantSurface at the start of the manoeuvre
        const prev = subWant.get(s);
        if (prev !== undefined && prev !== s.wantSurface) A.play(s.wantSurface ? 'sub.surface' : 'sub.dive', { at: s });
        subWant.set(s, s.wantSurface);
        if (s.submerged) continue;
      }
      if (!(s.speed > 0.3)) continue;
      const d = A.distTo(s.x, 0, s.z) * (eng.has(s) ? 0.85 : 1); // a little stickiness: no flapping between two ships
      if (s.type === 'pt') { if (d < PT_FAR) ptCand.push({ s, d }); } else if (d < ENG_FAR) cand.push({ s, d });
    }
    cand.sort((a, b) => a.d - b.d); ptCand.sort((a, b) => a.d - b.d);
    const want = new Set();
    for (let i = 0; i < Math.min(ENG_N, cand.length); i++) want.add(cand[i].s);
    for (let i = 0; i < Math.min(PT_N, ptCand.length); i++) want.add(ptCand[i].s);
    for (const [s, h] of eng) if (!want.has(s) || !h.alive) { h.stop(0.8); eng.delete(s); }
    for (const s of want) {
      const pt = s.type === 'pt', th = clamp(s.speed / ((s.stats && s.stats.speed) || 5), 0, 1);
      const d = A.distTo(s.x, 0, s.z), fade = clamp(1.25 - d / (pt ? PT_FAR : ENG_FAR), 0, 1);
      const vol = (pt ? 0.75 : 0.8) * fade * (0.6 + 0.4 * th);
      let h = eng.get(s);
      if (!h) eng.set(s, A.loop(pt ? 'ship.engine.pt' : 'ship.engine', { at: s, vol, throttle: th, size: clamp(lenOf(s) / 24, 0.4, 1.2) }));
      else h.set({ vol, throttle: th });
    }
  }
  function reset() {
    salvo.length = 0; sinking.clear(); subWant.clear(); runs.length = 0;
    for (const h of eng.values()) h.stop(0.3); for (const h of fire.values()) h.stop(0.3);
    eng.clear(); fire.clear();
  }
  WW.on('roundStart', reset); WW.on('setupStart', reset);

  let acc = 0;
  A.onUpdate(rdt => {
    flushSalvos();
    pollRuns();
    pollSinking();
    acc += rdt || 0;
    if (acc >= 0.25) { acc = 0; pollShips(); }
  });
  WW.audioNaval = { _debug: () => ({ engines: eng.size, fires: fire.size, sinking: sinking.size, runs: runs.length }) };
})(window.WW);
