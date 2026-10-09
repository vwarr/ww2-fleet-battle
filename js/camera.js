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
  let manual = false, shot = null, lastKind = '', lastSubj = null, recent = [], shotCount = 0, snapNext = true, forced = null;

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
    let lo = 0, hi = H;
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
  // what a wide / diorama shot looks at: the front line once the fleets are close, else one fleet on its approach
  // (on the big map the midpoint between two distant fleets is empty sea)
  const APART = 280;
  const PFK = Math.pow(WW.cfg.PLANE_K || 1, 0.6);   // plane framing distances close in with the plane size (camera_story_shots FK)
  function sceneCentre() {
    const f = frontCentre();
    if (!(f.d > APART)) return f;
    return Object.assign(fleetCentre(Math.random() < 0.5 ? 'USN' : 'IJN'), { d: 160 });
  }

  // Calm, fish-tank pacing: long slow shots (12-25 s), soft cross-fades, wide diorama shots every other time.
  const dur = (a, b) => a + (b - a) * Math.random(); // camera: Math.random, never WW.rand (seeded rounds)
  function candidates() {
    const out = [], add = (pr, kind, subj, extra) => out.push(Object.assign({ pr: pr + Math.random() * 2, kind, subj }, extra || {}));
    for (const s of WW.world.ships) {
      if (s.removed) continue;
      if (s.sinking && s.sinkT < 4) add(10, 'orbit', s, { r: s.stats.length * 1.5 + 16, dur: dur(14, 18), w: 0.05 });
      if (!s.alive) continue;
      if (s.hp < s.maxHp * 0.5 && s.type !== 'pt') add(5, 'orbit', s, { r: s.stats.length * 1.4 + 14, dur: dur(13, 18), w: 0.045 }); // burning
      const t = s.target, d = t ? WW.dist(s.x, s.z, t.x, t.z) : 1e9;
      if (s.type === 'battleship' && t && d < 170) add(6, 'flyby', s, { dur: dur(15, 20) });
      else if (s.type === 'cruiser' && t && d < 120) add(4.5, 'chase', s, { dur: dur(13, 17) });
      else if ((s.type === 'destroyer' || s.type === 'pt') && t && d < 90) add(4, 'chase', s, { dur: dur(12, 15) });
      if (s.type === 'carrier' && WW.world.planes.some(p => p.carrier === s && p.state === 'takeoff')) add(6.5, 'flyby', s, { dur: dur(15, 20) });
      if (s.type === 'submarine' && s.ai && s.ai.evadeT > 7) add(5, 'chase', s, { dur: dur(12, 15) });
    }
    for (const p of WW.world.planes) {
      if (!p.alive) continue;
      const ace = (p.ace ? 3 : 0) + Math.min(2, (+p.kills || 0) * 0.5); // aces (if the game tracks them) draw the eye
      if (p.kind === 'torpedo' && p.phase === 'run' && p.target) add(8 + ace, 'chase', p, { dur: dur(12, 14) });
      else if (p.kind === 'dive' && p.state === 'attack' && p.target && p.target.alive) add(7.5 + ace, 'orbit', p.target, { r: p.target.stats.length * 1.4 + 22, dur: dur(13, 16), w: 0.05, hgt: 0.34, plane: p });
      else if (p.kind === 'fighter' && p.state === 'attack' && p.foe) add(6.5 + ace, 'ots', p, { dur: dur(10, 13) }); // over the shoulder (camera_action.js)
      else if (p.state === 'transit' && p.ordnance) add(3 + ace, 'chase', p, { dur: dur(12, 15) });
    }
    (WW.camHooks || []).forEach(f => { try { f(add, dur); } catch (e) { /* never break the director */ } }); // air_aces.js, air_scouts.js
    return out;
  }
  function pickShot() {
    const sc = WW.camStory && WW.camStory.pick(); // story mode (camera_story.js) owns the cuts while it runs
    if (sc) return startShot(sc);
    shotCount++;
    let best = null;
    if (shotCount % 2 === 0) for (const c of candidates()) {
      let s = c.pr;
      if (c.kind === lastKind) s -= 2.5;
      if (c.subj && recent.indexOf(c.subj) >= 0) s -= 5; // no repeats back-to-back
      if (!best || s > best.score) { best = c; best.score = s; }
    }
    if (!best || best.score < 3) {
      if (shotCount % 4 === 1) best = { kind: 'wide', dur: dur(18, 25) };
      else { // diorama: a slow, high-ish orbit around the front line
        const f = sceneCentre();
        best = { kind: 'orbit', subj: { x: f.x, z: f.z, y: 0, diorama: true }, r: WW.clamp((f.d || 120) * 0.45 + 50, 75, 165), dur: dur(18, 24), w: 0.022, hgt: 0.3 };
      }
    }
    startShot(best);
  }
  function startShot(c) {
    shot = Object.assign({ t: 0, dur: 8 }, c);
    shot.side = Math.random() < 0.5 ? -1 : 1;
    const s = c.subj;
    if (c.kind === 'orbit') {
      shot.w = (c.w || 0.1) * shot.side; shot.hgt = c.hgt || 0.28; // low: the horizon stays in frame
      // start where the foreground (between subject and camera) is open water, not shoals
      let best = -1e9, off = Math.random() * Math.PI * 2;
      for (let i = 0; i < 10; i++) {
        const a = off + i * Math.PI / 5, mid = a + shot.w * (shot.dur || 8) * 0.5;
        const o = openness(s.x, s.z, a, c.r) + openness(s.x, s.z, mid, c.r);
        if (o > best) { best = o; shot.a0 = a; }
      }
    } else if (c.kind === 'flyby') { // camera slides along the ship's beam, low over the water
      const h = s.heading, fx = Math.cos(h), fz = Math.sin(h), len = s.stats ? s.stats.length : 10;
      const off = len * 1.3 + 14;
      const sideA = h + Math.PI / 2; // pick the beam with more open water
      shot.side = openness(s.x, s.z, sideA, off) >= openness(s.x, s.z, sideA + Math.PI, off) ? 1 : -1;
      shot.from = { x: -fx * len * 2.2 - fz * off * shot.side, z: -fz * len * 2.2 + fx * off * shot.side };
      shot.to = { x: fx * len * 2.2 - fz * off * shot.side, z: fz * len * 2.2 + fx * off * shot.side };
      shot.y = Math.max(5, len * 0.45);
    } else if (c.kind === 'wide') {
      const f = WW.game && WW.game.state === 'victory' && WW.game.winner ? fleetCentre(WW.game.winner) : sceneCentre();
      shot.cx = f.x; shot.cz = f.z; shot.r = WW.clamp((f.d || 150) * 0.65 + 55, 115, 260);   // close enough that the ships read big
      shot.a0 = Math.random() * Math.PI * 2; shot.w = 0.012 * shot.side;
      if (shotCount === 1 && WW.game && WW.game.state === 'battle') { // opening shot: one fleet setting out, side-on
        const nat = Math.random() < 0.5 ? 'USN' : 'IJN';
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (const o of WW.world.ships) if (o.alive && o.nation === nat) { x0 = Math.min(x0, o.x); x1 = Math.max(x1, o.x); z0 = Math.min(z0, o.z); z1 = Math.max(z1, o.z); }
        if (x1 > x0) {
          shot.cx = (x0 + x1) / 2; shot.cz = (z0 + z1) / 2; shot.centred = true;
          shot.r = WW.clamp(Math.max(x1 - x0, (z1 - z0) * 0.6) * 0.75 + 45, 150, 340);
          shot.a0 = Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2; shot.w = 0.006 * shot.side;
        }
      }
    }
    lastKind = c.kind; lastSubj = s || null;
    if (s) { recent.push(s); if (recent.length > 3) recent.shift(); }
    if (c.hard) fadeReady = true; // a hard cut (story mode): no cross-fade
    snapNext = true; // cut (softened by a cross-fade, see afterRender)
  }

  function shotGoal(rdt) {
    const s = shot.subj, k = Math.min(1, shot.t / shot.dur);
    if (s && !gone(s)) pos(s, shot.last || (shot.last = new THREE.Vector3()));
    if (WW.camAction && WW.camAction.goal(shot, gP, gL, rdt)) return; // bomb / torpedo hand-offs, over-the-shoulder
    if (WW.storyShots && WW.storyShots.goal(shot, gP, gL, rdt)) return; // story mode shots (camera_story_shots.js)
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
        const back = isPlane ? 20 * PFK : (s.stats ? s.stats.length : 10) * 1.2 + 10;
        if (shot.t === 0 || shot.sideT === undefined) { // choose the quarter with open water once
          shot.sideT = 1;
          const hb = h + Math.PI;
          shot.side = openness(sp.x, sp.z, hb - 0.5, back * 1.1) >= openness(sp.x, sp.z, hb + 0.5, back * 1.1) ? 1 : -1;
        }
        const lat = shot.side * back * 0.55;
        _f.set(Math.cos(h), 0, Math.sin(h));
        gP.set(sp.x - _f.x * back - _f.z * lat, (isPlane ? sp.y : 0) + back * 0.27, sp.z - _f.z * back + _f.x * lat);
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
        if (shot.cx === undefined) { const f = frontCentre(); shot.cx = f.x; shot.cz = f.z; shot.r = 150; shot.a0 = 1; shot.w = 0.025; }
        // low and wide, looking a little past the action so the hazy horizon shows at the top
        const a = shot.a0 + shot.w * shot.t;
        const past = shot.centred ? 0 : 0.15;   // a little past the action: the fleets in the middle distance, not on the horizon
        gL.set(shot.cx - Math.cos(a) * shot.r * past, 0, shot.cz - Math.sin(a) * shot.r * past);
        gP.set(shot.cx + Math.cos(a) * shot.r, shot.r * 0.24, shot.cz + Math.sin(a) * shot.r);
      }
    }
  }
  // how open (deep) the water is between (x, z) and the point r away at angle a: 0 (land) .. 10 (deep)
  function openness(x, z, a, r) {
    let o = 0;
    for (const f of [0.35, 0.6, 0.85, 1.1]) o += WW.clamp(depth(x + Math.cos(a) * r * f, z + Math.sin(a) * r * f), -2, 10);
    return o;
  }
  function depth(x, z) { return (x < 0 || x > W || z < 0 || z > H) ? 15 : WW.terrain.depthAt(x, z); }
  function keepSane(v, look) { // stay over the world, above land, and keep the view line clear of terrain
    v.x = WW.clamp(v.x, -120, W + 120); v.z = WW.clamp(v.z, -120, H + 120);
    const d0 = depth(v.x, v.z);
    v.y = Math.max(v.y, 5, -d0 + 6, d0 < 3 ? 11 : 0); // over shoals sit higher, so they do not fill the frame
    let need = v.y;
    for (const f of [0.15, 0.3, 0.45, 0.6, 0.75]) {
      const x = WW.lerp(v.x, look.x, f), z = WW.lerp(v.z, look.z, f), y = WW.lerp(v.y, look.y, f);
      const ground = Math.max(0, -depth(x, z)) + (depth(x, z) < 2 ? 3 : 1.5);
      if (y < ground) need = Math.max(need, v.y + (ground - y) / (1 - f));
    }
    v.y = need;
    // never sit inside or right next to a ship or plane (a mast filling the frame)
    clearHulls(v);
    for (const p of WW.world.planes) {
      if (p.removed) continue;
      const dx = v.x - p.x, dy = v.y - p.y, dz = v.z - p.z, d = Math.hypot(dx, dy, dz);
      const cl = 9 * PFK;   // 9 at the 1.7 plane scale
      if (d < cl && d > 0.01) { const k = cl / d; v.x = p.x + dx * k; v.y = p.y + dy * k; v.z = p.z + dz * k; }
    }
    v.y = Math.max(v.y, 4);
  }

  function clearHulls(v, top) {
    for (const s of WW.world.ships) {
      if (s.removed) continue;
      const R = s.stats.length * 0.5 + 7, dx = v.x - s.x, dz = v.z - s.z, d = Math.hypot(dx, dz);
      if (d < R && v.y < (top || 14)) { const k = (d > 0.01 ? R / d : 1); v.x = s.x + (d > 0.01 ? dx : 1) * k; v.z = s.z + (d > 0.01 ? dz : 0) * k; }
    }
  }

  // Composition: aim so the subject sits in the middle band (slightly below centre, rule of thirds),
  // which also lifts the view enough for the horizon to show in most shots.
  const probe = new THREE.PerspectiveCamera(), _s = new THREE.Vector3(), _up = new THREE.Vector3(), _rt = new THREE.Vector3();
  function compose(subj) {
    probe.fov = camera.fov; probe.aspect = camera.aspect; probe.near = 1; probe.far = 4000; probe.updateProjectionMatrix();
    const th = Math.tan(camera.fov * Math.PI / 360);
    for (let i = 0; i < 3; i++) {
      probe.position.copy(gP); probe.lookAt(gL); probe.updateMatrixWorld();
      _s.copy(subj).project(probe);
      const dist = probe.position.distanceTo(gL);
      _up.set(0, 1, 0).applyQuaternion(probe.quaternion); _rt.set(1, 0, 0).applyQuaternion(probe.quaternion);
      const dy = _s.y - (-0.12), dx = Math.abs(_s.x) > 0.3 ? _s.x - Math.sign(_s.x) * 0.3 : 0;
      if (Math.abs(dy) < 0.04 && !dx) break;
      gL.addScaledVector(_up, dy * dist * th).addScaledVector(_rt, dx * dist * th * camera.aspect);
    }
  }
  // a subject stops being worth filming once it is gone or dead (a sinking ship stays interesting)
  function dull(o) {
    if (!o || o.diorama) return false;
    if (gone(o)) return true;
    if (o.stats) return !o.alive && !o.sinking;
    return !o.alive;
  }
  // soft cross-fade: right after a render, copy the old frame to an overlay canvas and fade it out
  let fade = null, fctx = null, fadeWant = false, fadeReady = false, first = true;
  function makeFade() {
    fade = document.createElement('canvas'); fade.id = 'fade';
    fade.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;opacity:0;';
    const g = document.getElementById('game');
    g.parentNode.insertBefore(fade, g.nextSibling);
    fctx = fade.getContext('2d');
  }

  const cam = {
    mode: 'director',
    init() {
      camera = WW.camera; cam.resize();
      if (typeof document !== 'undefined') makeFade();
      WW.on('roundStart', () => { shot = null; forced = null; shotCount = 0; });
      WW.on('setupStart', () => { shot = null; forced = null; snapNext = true; });
      if (WW.camAction) WW.camAction.init();
      if (WW.camStory) WW.camStory.init();
    },
    resize() { if (camera) fitMap(); },
    afterRender() {
      if (!fadeWant || !fade) return;
      fadeWant = false; fadeReady = true;
      const src = WW.renderer.domElement;
      fade.width = src.width; fade.height = src.height;
      fctx.drawImage(src, 0, 0);
      fade.style.transition = 'none'; fade.style.opacity = '1';
      void fade.offsetWidth; // restart the transition
      fade.style.transition = 'opacity 1.4s ease-in-out'; fade.style.opacity = '0';
    },
    target() { return L; },
    current() { return { P, L }; },
    isOverview() { const st = WW.game && WW.game.state; return st === 'setup' || !st || cam.mode === 'map'; },
    toggle() { if (WW.game && WW.game.infinite) return 'cinematic'; cam.mode = cam.mode === 'director' ? 'map' : 'director'; snapNext = true; shot = null; return cam.mode === 'map' ? 'map' : 'cinematic'; },
    // test hook: film (x, z) with a slow orbit about `width` units across, for `hold` seconds
    focus(x, z, width, hold) {
      forced = true;
      startShot({ kind: 'orbit', subj: { x, z, y: 0 }, r: (width || 100) * 0.55, dur: hold || 8, w: 0.06, pr: 99 });
      cam.update(0);
    },
    // test hook: film a given candidate now, e.g. film({ kind: 'chase', subj: plane, dur: 14 })
    film(c) { forced = true; startShot(Object.assign({ pr: 99, dur: 12 }, c)); },
    _shot() { return shot; },
    cut() { forced = null; shot = null; }, // the next update picks a new shot (story mode start / end)
    snap() { forced = null; shot = null; snapNext = true; fadeReady = true; cam.update(0); },
    update(rdt) {
      if (!camera) return;
      const st = WW.game && WW.game.state;
      if (WW.game && WW.game.infinite) cam.mode = 'director'; // infinite: the director films it all
      const fc = WW.freecam && WW.freecam.active();
      if (WW.camAction) WW.camAction.tick(rdt, st === 'battle' && cam.mode === 'director' && !fc); // slow motion only on director shots
      if (st === 'setup' || !st || cam.mode === 'map') {
        gP.set(W / 2, mapDist * Math.sin(OV_PITCH), mapTz + mapDist * Math.cos(OV_PITCH)); gL.set(W / 2, 0, mapTz);
      } else if (fc) {
        // the user has the camera: no cut, just ease from wherever we are; the director resumes later
        WW.freecam.goal(gP, gL, rdt);
        keepSane(gP, gL);
        manual = true; shot = null; snapNext = false;
      } else {
        manual = false;
        if (shot) shot.t += rdt;
        if (!shot || shot.t >= shot.dur || (!forced && shot.t > 3 && !shot.stage && !shot.story && dull(shot.subj))) { forced = null; pickShot(); }
        shotGoal(rdt);
        keepSane(gP, gL);
        if (shot.kind !== 'wide' && (shot.aim || shot.last)) compose(shot.aim || shot.last);
      }
      if (snapNext && fade && !fadeReady && rdt > 0 && !first) { fadeWant = true; } // grab the old frame first (afterRender)
      else if (snapNext) { P.copy(gP); L.copy(gL); snapNext = false; fadeReady = false; first = false; }
      else {
        // heavy easing for the director, crisp for the user; action shots set their own (crisper) rates
        const soft = manual && WW.freecam.soft ? WW.freecam.soft() : 1; // eased right after the user takes over
        P.lerp(gP, 1 - Math.exp(-rdt * (manual ? 7 * soft : (shot && shot.kP) || 0.9)));
        L.lerp(gL, 1 - Math.exp(-rdt * (manual ? 9 * soft : (shot && shot.kL) || 1.3)));
        // the eased camera lags its goal: ease it out of a hull's no-go circle too (a soft pull, no jolt)
        if (!manual && !cam.isOverview() && P.y < 14) { _c.copy(P); clearHulls(_c, 14); P.lerp(_c, (1 - Math.exp(-rdt * 6)) * Math.min(1, (14 - P.y) / 4)); }
      }
      camera.position.copy(P);
      camera.lookAt(L);
      camera.updateMatrixWorld();
    }
  };
  WW.cam = cam;
})(window.WW);
