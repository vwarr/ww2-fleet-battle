// camera.js (integrator): a "director" camera. In battle it picks an interesting subject (a ship
// sinking, a torpedo run, a dive-bomb attack, a carrier launch, a dogfight, a battleship firing) and
// films it with a slow, eased orbit / chase / fly-by / wide shot of 6-12 s, then cuts to the next one.
// Setup mode (and 'map' mode, key C) uses a high overview of the whole map.
window.WW = window.WW || {};
(function (WW) {
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
  const OV_PITCH = 52 * Math.PI / 180;
  let camera = null, mapDist = 500, mapTz = H / 2;
  const P = new THREE.Vector3(), L = new THREE.Vector3();        // current camera position / look point
  const gP = new THREE.Vector3(), gL = new THREE.Vector3();      // goals for this frame
  const _c = new THREE.Vector3(), _f = new THREE.Vector3();
  let shot = null, lastKind = '', lastSubj = null, shotCount = 0, snapNext = true, forced = null;

  // ---------- overview fit (setup / map mode) ----------
  function placeOverview(d, tz) {
    camera.position.set(W / 2, d * Math.sin(OV_PITCH), tz + d * Math.cos(OV_PITCH));
    camera.lookAt(W / 2, 0, tz); camera.updateMatrixWorld();
  }
  const CORNERS = [[-4, -4], [W + 4, -4], [-4, H + 4], [W + 4, H + 4]];
  function ndc(d, tz) {
    placeOverview(d, tz);
    let mx = 0, y0 = 9, y1 = -9;
    for (const [x, z] of CORNERS) { _c.set(x, 0, z).project(camera); mx = Math.max(mx, Math.abs(_c.x)); y0 = Math.min(y0, _c.y); y1 = Math.max(y1, _c.y); }
    return { mx, y0, y1 };
  }
  function centreTz(d) {
    let lo = H / 2 - 200, hi = H / 2 + 200;
    for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2, r = ndc(d, m); if (r.y0 + r.y1 > 0) hi = m; else lo = m; }
    return (lo + hi) / 2;
  }
  function fitMap() {
    let lo = 100, hi = 3000;
    for (let it = 0; it < 22; it++) { const d = (lo + hi) / 2, r = ndc(d, centreTz(d)); if (r.mx <= 0.94 && r.y1 <= 0.9 && r.y0 >= -0.94) hi = d; else lo = d; }
    mapDist = hi; mapTz = centreTz(hi);
  }

  // ---------- subjects ----------
  const ease = x => x * x * (3 - 2 * x);
  function pos(o, out) { return out.set(o.x, o.y !== undefined ? o.y : 0, o.z); }
  function gone(o) { return !o || o.removed; }
  function fleetCentre(nation) {
    let x = 0, z = 0, n = 0;
    for (const s of WW.world.ships) if (s.alive && (!nation || s.nation === nation)) { x += s.x; z += s.z; n++; }
    return n ? { x: x / n, z: z / n } : { x: W / 2, z: H / 2 };
  }
  // where the two fleets are closest (the front line)
  function frontCentre() {
    let best = null, bd = 1e12;
    const us = WW.world.ships.filter(s => s.alive && s.nation === 'USN'), js = WW.world.ships.filter(s => s.alive && s.nation === 'IJN');
    for (const a of us) for (const b of js) { const d = WW.dist2(a.x, a.z, b.x, b.z); if (d < bd) { bd = d; best = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, d: Math.sqrt(d) }; } }
    return best || Object.assign(fleetCentre(), { d: 200 });
  }

  function candidates() {
    const out = [], add = (pr, kind, subj, extra) => out.push(Object.assign({ pr: pr + WW.rand() * 2, kind, subj }, extra || {}));
    for (const s of WW.world.ships) {
      if (s.removed) continue;
      if (s.sinking && s.sinkT < 4) add(10, 'orbit', s, { r: s.stats.length * 1.6 + 22, dur: 10, w: 0.12 });
      if (s.wreck && s.wreckInfo && s.wreckInfo.top > 1 && s.wreckT < 40) add(3.5, 'orbit', s, { r: s.stats.length * 1.4 + 16, dur: 8, w: 0.08 });
      if (!s.alive) continue;
      const t = s.target, d = t ? WW.dist(s.x, s.z, t.x, t.z) : 1e9;
      if (s.type === 'battleship' && t && d < 170) add(6, 'flyby', s, { dur: 11 });
      else if (s.type === 'cruiser' && t && d < 120) add(4.5, 'chase', s, { dur: 9 });
      else if ((s.type === 'destroyer' || s.type === 'pt') && t && d < 90) add(4, 'chase', s, { dur: 8 });
      if (s.type === 'carrier' && WW.world.planes.some(p => p.carrier === s && p.state === 'takeoff')) add(6.5, 'flyby', s, { dur: 9 });
      if (s.type === 'submarine' && s.ai && s.ai.evadeT > 7) add(5, 'chase', s, { dur: 8 });
    }
    for (const p of WW.world.planes) {
      if (!p.alive) continue;
      if (p.kind === 'torpedo' && p.phase === 'run' && p.target) add(8, 'chase', p, { dur: 8 });
      else if (p.kind === 'dive' && p.state === 'attack' && p.target) add(7.5, 'orbit', p.target, { r: p.target.stats.length * 1.5 + 30, dur: 9, w: 0.1, hgt: 0.55 });
      else if (p.kind === 'fighter' && p.state === 'attack' && p.foe) add(5, 'chase', p, { dur: 6 });
      else if (p.state === 'transit' && p.ordnance) add(3, 'chase', p, { dur: 7 });
    }
    return out;
  }
  function pickShot() {
    shotCount++;
    let best = null;
    if (shotCount % 4 !== 1) for (const c of candidates()) {
      let s = c.pr;
      if (c.kind === lastKind) s -= 2.5;
      if (c.subj === lastSubj) s -= 4;
      if (!best || s > best.score) { best = c; best.score = s; }
    }
    if (!best || best.score < 3) best = { kind: 'wide', dur: 10 };
    startShot(best);
  }
  function startShot(c) {
    shot = Object.assign({ t: 0, dur: 8 }, c);
    shot.side = WW.rand() < 0.5 ? -1 : 1;
    const s = c.subj;
    if (c.kind === 'orbit') {
      shot.a0 = WW.rand() * Math.PI * 2; shot.w = (c.w || 0.1) * shot.side; shot.hgt = c.hgt || 0.42;
    } else if (c.kind === 'flyby') { // camera slides along the ship's beam, low over the water
      const h = s.heading, fx = Math.cos(h), fz = Math.sin(h), len = s.stats ? s.stats.length : 10;
      const off = len * 1.4 + 22;
      shot.from = { x: -fx * len * 2.2 - fz * off * shot.side, z: -fz * len * 2.2 + fx * off * shot.side };
      shot.to = { x: fx * len * 2.2 - fz * off * shot.side, z: fz * len * 2.2 + fx * off * shot.side };
      shot.y = Math.max(5, len * 0.45);
    } else if (c.kind === 'wide') {
      const f = WW.game && WW.game.state === 'victory' && WW.game.winner ? fleetCentre(WW.game.winner) : frontCentre();
      shot.cx = f.x; shot.cz = f.z; shot.r = WW.clamp((f.d || 150) * 0.9 + 80, 140, 300);
      shot.a0 = WW.rand() * Math.PI * 2; shot.w = 0.025 * shot.side;
    }
    lastKind = c.kind; lastSubj = s || null;
    snapNext = true; // hard cut
  }

  function shotGoal() {
    const s = shot.subj, k = Math.min(1, shot.t / shot.dur);
    if (s && !gone(s)) pos(s, shot.last || (shot.last = new THREE.Vector3()));
    const sp = shot.last;
    switch (sp ? shot.kind : 'wide') {
      case 'orbit': {
        const a = shot.a0 + shot.w * shot.t, r = shot.r * (1.08 - 0.12 * ease(k));
        gL.set(sp.x, Math.max(1.5, sp.y * 0.5 + 1.5), sp.z);
        gP.set(sp.x + Math.cos(a) * r, r * shot.hgt, sp.z + Math.sin(a) * r);
        break;
      }
      case 'chase': {
        const h = s.heading !== undefined ? s.heading : 0, isPlane = sp.y > 0.5;
        const back = isPlane ? 26 : (s.stats ? s.stats.length : 10) * 1.3 + 18;
        const lat = shot.side * back * 0.55;
        _f.set(Math.cos(h), 0, Math.sin(h));
        gP.set(sp.x - _f.x * back - _f.z * lat, (isPlane ? sp.y : 0) + back * 0.38, sp.z - _f.z * back + _f.x * lat);
        gL.set(sp.x + _f.x * back * 0.5, isPlane ? sp.y * 0.7 : 1.5, sp.z + _f.z * back * 0.5);
        break;
      }
      case 'flyby': {
        const e = ease(k);
        gP.set(sp.x + WW.lerp(shot.from.x, shot.to.x, e), shot.y, sp.z + WW.lerp(shot.from.z, shot.to.z, e));
        gL.set(sp.x, 2.5, sp.z);
        break;
      }
      default: { // wide establishing shot: slow arc around the front line
        if (shot.cx === undefined) { const f = frontCentre(); shot.cx = f.x; shot.cz = f.z; shot.r = 200; shot.a0 = 1; shot.w = 0.025; }
        // low and wide, looking a little past the action so the hazy horizon shows at the top
        const a = shot.a0 + shot.w * shot.t;
        gL.set(shot.cx - Math.cos(a) * shot.r * 0.35, 0, shot.cz - Math.sin(a) * shot.r * 0.35);
        gP.set(shot.cx + Math.cos(a) * shot.r, shot.r * 0.24, shot.cz + Math.sin(a) * shot.r);
      }
    }
  }
  function keepSane(v) { // stay over the world, above water and land
    v.x = WW.clamp(v.x, -120, W + 120); v.z = WW.clamp(v.z, -120, H + 120);
    const land = -WW.terrain.depthAt(WW.clamp(v.x, 0, W), WW.clamp(v.z, 0, H));
    v.y = Math.max(v.y, 4, land + 5);
  }

  const cam = {
    mode: 'director',
    init() {
      camera = WW.camera; cam.resize();
      WW.on('roundStart', () => { shot = null; forced = null; shotCount = 0; });
      WW.on('setupStart', () => { shot = null; forced = null; snapNext = true; });
      WW.on('shipSunk', s => { // a fresh sinking interrupts a weaker shot
        if (shot && !forced && cam.mode === 'director' && shot.t > 2.5 && (shot.pr || 0) < 8 && s.type !== 'pt') {
          startShot({ kind: 'orbit', subj: s, r: s.stats.length * 1.6 + 22, dur: 10, w: 0.12, pr: 10 });
        }
      });
    },
    resize() { if (camera) fitMap(); },
    toggle() { cam.mode = cam.mode === 'director' ? 'map' : 'director'; snapNext = true; shot = null; return cam.mode === 'map' ? 'map' : 'cinematic'; },
    // test hook: film (x, z) with a slow orbit about `width` units across, for `hold` seconds
    focus(x, z, width, hold) {
      forced = true;
      startShot({ kind: 'orbit', subj: { x, z, y: 0 }, r: (width || 100) * 0.55, dur: hold || 8, w: 0.06, pr: 99 });
      shot.a0 = Math.PI * 0.5; // look from the south
      cam.update(0);
    },
    snap() { forced = null; shot = null; snapNext = true; cam.update(0); },
    update(rdt) {
      if (!camera) return;
      const st = WW.game && WW.game.state;
      if (st === 'setup' || !st || cam.mode === 'map') {
        gP.set(W / 2, mapDist * Math.sin(OV_PITCH), mapTz + mapDist * Math.cos(OV_PITCH)); gL.set(W / 2, 0, mapTz);
      } else {
        if (shot) shot.t += rdt;
        if (!shot || shot.t >= shot.dur) { forced = null; pickShot(); }
        shotGoal();
        keepSane(gP);
      }
      if (snapNext) { P.copy(gP); L.copy(gL); snapNext = false; }
      else {
        P.lerp(gP, 1 - Math.exp(-rdt * 1.6));
        L.lerp(gL, 1 - Math.exp(-rdt * 2.6));
      }
      camera.position.copy(P);
      camera.lookAt(L);
      camera.updateMatrixWorld();
    }
  };
  WW.cam = cam;
})(window.WW);
