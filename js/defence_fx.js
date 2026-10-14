// defence_fx.js - WW.defenceFx: the German side alive on screen (visual only: Math.random, reads the sim, never writes
// it; render mode, Normandy). Built on 'defencesBuilt' next to models_bunker.js, stepped from main.js each frame on the
// sim clock (WW.time.now's advance, so a pause or the director's slow motion hold it like WW.fx):
//  - the crews: German figures (models_german.js: Feldgrau, the Stahlhelm) at fixed slots in each position's local
//    frame: the MG 42's No. 1 bent over the gun with the loader kneeling at the belt and a rifleman beside them, the
//    mortar crew round the tube, the gun crews behind the shields, the Tobruk's men, two men at a casemate's rear door
//    (the crew is inside). As many show as the element has crew left (el.crew / crew0: an assault kills them); the
//    slots of the dead show bodies. A suppressed position (el.suppressedUntil) has its gunners doubled up below the
//    parapet and the riflemen gone under cover. A knocked-out one keeps two bodies in its wreck.
//  - the MG 42s on the parapets (and the 8 cm mortars in the pits), trained on what they fire at, inside their arc.
//  - the trenches: zigzag cuts with spoil on both lips joining a WN's positions, and two runners along each of them
//    while the strongpoint holds (none once it is silenced).
//  - MG fire you can see: an MG / Tobruk / flak position firing (the 'defenceFire' events: infantry_fire.js gives the
//    squad, coast_defence_fire.js and air_offmap.js mark it active; with no squad named it fires on the nearest craft
//    in its cone) lays bursts of glowing orange tracer (a few rounds in each burst that show, ~0.5-1.4 s bursts) at
//    the men, a muzzle flicker at the gun, and the rounds kick sand off the beach or throw little spouts in the surf.
//  - a casemate gun firing ('defenceFire' gun): a flash in the embrasure, the blast's dust thrown off the ground in
//    front of it, a drift of smoke; a mortar: the launch puff at the pit (each 'mortarBurst', and a round every few
//    seconds while the pit is in action).
//  - knocked-out positions smoulder: smoke (and fire in the first half minute) thinning over three minutes.
// Review pass (the first version was committed unreviewed): the MG rounds strike the water where the flood tide has
// come in (tide.js depth / level), not the H-hour waterline, and the craft and men are aimed at on the sea's level; the
// gun flashes no longer pile up while the sim jumps ahead (a fast-forward: nothing is spawned unless the renderer is
// keeping up, one flash a gun a frame), smaller and a hotter orange; the gun smoke and the blast dust smaller and in
// the ground's dull colours (they were white cotton balls bigger than the casemate); tracers thinner and redder; far
// from the camera the tracers, flashes and strikes are drawn bigger (up to 5x / 4x / 1.6x) so the fire still reads from
// the sea and from the craft; a knocked-out position keeps a thin smoke for the rest of the round.
// Determinism: no WW.rand, no writes to elements, squads or craft (per-element state is a WeakMap here); every
// listener returns first in sim mode; the Pacific path never builds (no 'defencesBuilt' outside Normandy).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const MAXF = 320, MAXP = 96, NT = 700, NPUFF = 600, NGLOW = 240;
  const T_SPEED = 95, T_LEN = 1.5, T_W = 0.05, ROUNDS = 15;   // tracer speed (u/s sim), streak length, width; tracers a second
  const R = Math.random, rr = (a, b) => a + (b - a) * R();
  const CD = () => WW.coastDefence;
  let root = null, figs = null, props = null, trenchMesh = null, built = [], wnRuns = [], lastNow = -1, vt = 0, fr = 0;
  let tr = null, puff = null, glow = null;
  const st = new WeakMap();   // el -> visual state: last target, bursts, the gun's yaw
  const S = e => { let s = st.get(e); if (!s) st.set(e, s = { flashFr: -1, tgt: null, tgtT: -1e9, actT: -1e9, burst: 0, pause: R(), next: 0, yaw: 0, pick: null, pickT: -1e9, mortT: rr(1, 5), smokeT: 0 }); return s; };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _v = new THREE.Vector3(), _x = new THREE.Vector3(1, 0, 0), _c = new THREE.Color();
  const H = (x, z) => WW.terrain.heightRaw(x, z);
  const SEA = () => (WW.tide ? WW.tide.level() : 0), wetAt = (x, z) => (WW.tide ? WW.tide.depth(x, z) > 0 : H(x, z) < 0.02);
  const cam = new THREE.Vector3();   // this frame's camera: far effects are drawn bigger so they still read from the sea
  const far = (x, y, z, d0, max) => Math.min(max, Math.max(1, Math.hypot(x - cam.x, y - cam.y, z - cam.z) / d0));
  const toW = (e, lx, lz) => { const c = Math.cos(e.heading), s = Math.sin(e.heading); return [e.x + c * lx - s * lz, e.z + s * lx + c * lz]; };

  // ---- the particle pools: lit puffs (sand, spray, dust) and additive glows (muzzle flashes); tracers ----
  function Pool(n, geo, mat, d0, max) {
    this.d0 = d0; this.max = max; this.n = n; this.m = new THREE.InstancedMesh(geo, mat, n); this.m.count = 0; this.m.frustumCulled = false;
    this.m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) this.m.setColorAt(i, _c.setRGB(1, 1, 1));
    this.a = []; this.h = 0;
    for (let i = 0; i < n; i++) this.a.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, life: 1, s0: 0, s1: 0, g: 0, r: 1, gg: 1, b: 1, floor: -9 });
  }
  Pool.prototype.spawn = function (x, y, z, vx, vy, vz, life, s0, s1, col, g, floor) {
    const p = this.a[this.h]; this.h = (this.h + 1) % this.n;
    _c.set(col); Object.assign(p, { on: true, x, y, z, vx, vy, vz, age: 0, life, s0, s1, g: g || 0, r: _c.r, gg: _c.g, b: _c.b, floor: floor === undefined ? -9 : floor });
  };
  Pool.prototype.step = function (dt, fade) {
    let k = 0;
    for (const p of this.a) {
      if (!p.on) continue;
      p.age += dt; if (p.age >= p.life) { p.on = false; continue; }
      p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.floor) { p.y = p.floor; p.vy = 0; p.vx *= 0.5; p.vz *= 0.5; }
      const t = p.age / p.life, sc = (p.s0 + (p.s1 - p.s0) * Math.sqrt(t)) * far(p.x, p.y, p.z, this.d0, this.max), sh = fade ? 1 : (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1);
      _m.makeScale(sc * sh, sc * sh, sc * sh).setPosition(p.x, p.y, p.z);
      this.m.setMatrixAt(k, _m);
      const f = fade ? 1 - t : 1; this.m.setColorAt(k, _c.setRGB(p.r * f, p.gg * f, p.b * f));
      k++;
    }
    this.m.count = k; WW.instUsed(this.m, true);
  };
  Pool.prototype.clear = function () { for (const p of this.a) p.on = false; this.m.count = 0; };

  function init() {
    root = new THREE.Group(); root.name = 'defenceFx';
    const G = WW.germanModel.build(), grad = WW.models && WW.models._grad ? WW.models._grad() : null;
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: grad });
    const mk = (g, n) => { const im = new THREE.InstancedMesh(g, mat, n); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(im); return im; };
    figs = {}; for (const k of WW.germanModel.POSES) figs[k] = mk(G[k], MAXF);
    props = { mg42: mk(G.mg42, MAXP), mortar: mk(G.mortar, MAXP) };
    // tracers: a thin glowing streak along +x (instanced, additive, unlit)
    const tg = new THREE.BoxGeometry(1, 1, 1); tg.translate(-0.5, 0, 0);   // the head at the origin, the tail behind
    tr = { m: new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false }), NT), a: [], h: 0 };
    tr.m.frustumCulled = false; tr.m.renderOrder = 6; tr.m.count = 0; tr.m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < NT; i++) { tr.m.setColorAt(i, _c.setRGB(1, 1, 1)); tr.a.push({ on: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, age: 0, life: 1, kick: 0, len: T_LEN }); }
    root.add(tr.m);
    puff = new Pool(NPUFF, new THREE.IcosahedronGeometry(1, 0), new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: grad }), 30, 1.6);
    glow = new Pool(NGLOW, new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false }), 40, 4);
    glow.m.renderOrder = 6;
    root.add(puff.m); root.add(glow.m);
    WW.scene.add(root);
  }

  // ---- the layout: crew slots and props per element (local frame: +x where it looks), the trenches ----
  // a slot: [lx, lz, role, local yaw]; roles: gun (the MG's No. 1), load (kneels at the gun), rifle (aims over the
  // parapet when the position fires), mort (kneels at the tube), stand (a man on his feet)
  function slots(e) {
    const r = e.rad, rg = r * 0.75;
    switch (e.type) {
      case 'mg': return { s: [[rg - 0.5, 0.04, 'gun', 0], [rg - 0.62, 0.36, 'load', -0.5], [rg - 0.55, -0.42, 'rifle', 0.15]], mg: [rg - 0.02, 0] };
      case 'tobruk': return { s: [[-0.32, 0.05, 'rifle', 0], [-0.4, 0.42, 'load', -0.4], [-0.45, -0.42, 'stand', 0.3]], mg: [0.45, -0.45] };
      case 'mortar': return { s: [[-0.28, 0.24, 'mort', 0], [-0.22, -0.3, 'mort', 0.35], [-0.7, 0.05, 'stand', 0], [0.15, 0.55, 'load', -1.3]], mortar: [0.05, 0] };
      case 'gunpit': return { s: [[-0.45, 0.45, 'mort', 0], [-0.45, -0.45, 'load', 0], [-1.0, 0.2, 'stand', 0], [-0.95, -0.55, 'load', 0.4], [0.4, 0.95, 'rifle', 0]] };
      case 'battery': return { s: [[-0.7, 0.7, 'mort', 0], [-0.7, -0.7, 'load', 0], [-1.5, 0.3, 'stand', 0], [-1.4, -0.7, 'load', 0.4], [0.5, 1.4, 'rifle', 0], [-1.9, 1.0, 'stand', -0.6]] };
      case 'flak': return { s: [[-0.3, 0.25, 'kneel', 0], [-0.3, -0.3, 'load', 0], [-0.75, 0.05, 'stand', 0], [0.55, 0.65, 'stand', -0.8]] };
      case 'casemate': {
        const sv = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), e.heading), sz = Math.sign(sv.z) || 1, L = r * 1.5, W = r * 1.3;
        return { s: [[-L / 2 - 0.45, -sz * W * 0.2, 'stand', Math.PI * 0.85], [-L / 2 - 0.7, -sz * (W * 0.2 + 0.5), 'load', Math.PI]] };
      }
      case 'bunker': { const L = r * 1.5; return { s: [[-L / 2 - 1.1, 0.4, 'stand', Math.PI], [-L / 2 - 1.4, -0.4, 'stand', 0.3]] }; }
      default: return { s: [] };
    }
  }
  function layout(e) {
    const L = slots(e), o = { e, slots: [], mg: null, mortar: null };
    for (const [lx, lz, role, yaw] of L.s) {
      const [x, z] = toW(e, lx, lz);
      o.slots.push({ x, z, y: Math.max(-0.1, H(x, z)) - 0.02, role, yaw: e.heading - yaw, by: R() * 6.28 });
    }
    if (L.mg) { const [x, z] = toW(e, L.mg[0], L.mg[1]); o.mg = { x, z, y: Math.max(-0.1, H(x, z)) + (e.type === 'tobruk' ? 0.24 : 0.19) }; }
    if (L.mortar) { const [x, z] = toW(e, L.mortar[0], L.mortar[1]); o.mortar = { x, z, y: Math.max(-0.1, H(x, z)) + 0.02 }; }
    return o;
  }
  // the trenches: each WN's positions joined west to east (and a casemate to its neighbour), zigzag cuts
  function trenches(wns) {
    const part = WW.soldierModel.part, { box } = WW.soldierModel.prims(), P = [];
    wnRuns = [];
    for (const w of wns) {
      const els = w.elements.filter(e => !e.dormant && e.type !== 'wall').sort((a, b) => a.x - b.x);
      const pts = [];
      for (let i = 0; i + 1 < els.length; i++) {
        const a = els[i], b = els[i + 1], d = Math.hypot(b.x - a.x, b.z - a.z);
        if (d > 26 || d < a.rad + b.rad + 1) continue;
        const ux = (b.x - a.x) / d, uz = (b.z - a.z) / d, x0 = a.x + ux * (a.rad + 0.3), z0 = a.z + uz * (a.rad + 0.3), len = d - a.rad - b.rad - 0.6;
        const n = Math.max(2, Math.round(len / 2.2));
        let px = x0, pz = z0;
        if (!pts.length || pts[pts.length - 1].brk) pts.push({ x: px, z: pz, y: H(px, pz) });
        for (let k = 1; k <= n; k++) {
          const off = k === n ? 0 : (k & 1 ? 0.6 : -0.6), f = k / n;
          const qx = x0 + ux * len * f - uz * off, qz = z0 + uz * len * f + ux * off;
          seg(P, part, box, px, pz, qx, qz);
          pts.push({ x: qx, z: qz, y: H(qx, qz) });
          px = qx; pz = qz;
        }
        pts[pts.length - 1].brk = i + 2 < els.length && Math.hypot(els[i + 2].x - b.x, els[i + 2].z - b.z) > 26;
      }
      if (pts.length > 2) wnRuns.push({ w, pts, len: pts.reduce((s, p, i) => s + (i ? Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) : 0), 0), ph: [R(), R()], sp: [rr(0.9, 1.4), rr(0.9, 1.4)] });
    }
    if (!P.length) return null;
    const m = new THREE.Mesh(WW.soldierModel.merge(P), figs.stand.material); m.receiveShadow = true;
    return m;
  }
  // one leg of a trench: the dark cut and the spoil on its two lips, following the ground
  function seg(P, part, box, x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0), y0 = Math.max(-0.1, H(x0, z0)), y1 = Math.max(-0.1, H(x1, z1));
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, my = (y0 + y1) / 2, pitch = Math.atan2(y1 - y0, d), nx = -Math.sin(a), nz = Math.cos(a);
    P.push(part(box, 0x3b342b, [d + 0.3, 0.06, 0.34], [mx, my + 0.02, mz], [0, -a, pitch]));
    for (const sd of [-1, 1]) P.push(part(box, sd > 0 ? 0x766950 : 0x6a5e48, [d + 0.35, 0.12, 0.2], [mx + nx * 0.27 * sd, my + 0.05, mz + nz * 0.27 * sd], [0, -a, pitch]));
  }

  // ---- the targets an MG fires on ----
  function aimPoint(t) {
    if (t.isSquad) { const x = t.x + rr(-1.4, 1.4), z = t.z + rr(-1.1, 1.1); return [x, Math.max(SEA() - 0.05, H(x, z)) + 0.12, z, true]; }
    if (t.y > 3) return [t.x + rr(-1, 1), t.y + rr(-0.5, 0.5), t.z + rr(-1, 1), false];   // a plane: no strike
    return [t.x + rr(-1.4, 1.4), SEA() + 0.35, t.z + rr(-1.4, 1.4), true];               // a craft: on and around it
  }
  function pickCraft(e) {
    const L = WW.landingCraft ? WW.landingCraft.live : null; if (!L) return null;
    let best = null, bd = e.K.range || 95;
    for (const u of L) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - e.x, u.z - e.z); if (d >= bd || !WW.coastFire.inArc(e, u.x, u.z)) continue;
      bd = d; best = u;
    }
    return best;
  }
  function target(e, s, now) {
    if (s.tgt && s.tgt.alive && now - s.tgtT < 1.6) return s.tgt;
    if (now - s.pickT > 1.2) { s.pick = pickCraft(e); s.pickT = now; }
    return s.pick && s.pick.alive ? s.pick : null;
  }
  // one round: a tracer from the muzzle to the aim point (most rounds kick up the ground or the water there)
  function shoot(e, o, s, t) {
    const [ax, ay, az, kick] = aimPoint(t), mx = o.mg ? o.mg.x : e.x, mz = o.mg ? o.mg.z : e.z, my = o.mg ? o.mg.y + 0.08 : e.y + 0.45;
    const dx = ax - mx, dy = ay - my, dz = az - mz, d = Math.hypot(dx, dy, dz); if (d < 1) return;
    const ux = dx / d, uy = dy / d, uz = dz / d, c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const sx = mx + c * 0.2, sz = mz + sn * 0.2;
    const p = tr.a[tr.h]; tr.h = (tr.h + 1) % NT;
    Object.assign(p, { on: true, x: sx, y: my, z: sz, dx: ux, dy: uy, dz: uz, age: 0, life: d / T_SPEED, kick: kick ? 1 : 0, len: T_LEN * rr(0.8, 1.15), hx: ax, hz: az, hy: ay });
    if (R() < 0.6) glow.spawn(sx, my, sz, 0, 0, 0, 0.06, 0.05, 0.09, 0xff9a40);
  }
  // the round arrives: sand kicked off the beach, or a little spout in the surf
  function strike(x, y, z) {
    if (wetAt(x, z)) {   // the sea where the flood has come in (tide.js), not the H-hour waterline
      const w = SEA();
      for (let i = 0; i < 3; i++) puff.spawn(x + rr(-0.05, 0.05), w + 0.05, z + rr(-0.05, 0.05), rr(-0.3, 0.3), rr(1.6, 2.6), rr(-0.3, 0.3), rr(0.35, 0.55), rr(0.04, 0.07), rr(0.07, 0.11), 0xd6dcd8, 7, w - 0.05);
    } else {
      const g = Math.max(-0.1, H(x, z));
      for (let i = 0; i < 3; i++) puff.spawn(x + rr(-0.06, 0.06), g + 0.04, z + rr(-0.06, 0.06), rr(-0.5, 0.5), rr(0.6, 1.5), rr(-0.5, 0.5), rr(0.4, 0.7), rr(0.05, 0.08), rr(0.12, 0.2), R() < 0.5 ? 0xb5a98a : 0xa39778, 2.5, g);
    }
  }

  // ---- per frame ----
  const ROLE = { gun: 'gunner', load: 'kneel', rifle: 'stand', mort: 'kneel', stand: 'stand', kneel: 'kneel' };
  function put(k, x, y, z, yaw, tilt) {
    const im = figs[k]; if (im.count >= MAXF) return;
    _e.set(0, -yaw, tilt || 0, 'YXZ'); _q.setFromEuler(_e);
    im.setMatrixAt(im.count++, _m.compose(_p.set(x, y, z), _q, _s));
  }
  function update() {
    const D = CD();
    if (WW.simOnly || !root || !WW.isScn('normandy') || !D || !D.elements.length) { if (root) root.visible = false; return; }
    root.visible = true; fr++;
    if (WW.camera) cam.setFromMatrixPosition(WW.camera.matrixWorld);
    const now = WW.time.now; let dt = lastNow < 0 ? 0 : now - lastNow; lastNow = now;
    if (!(dt >= 0) || dt > 0.25) dt = dt > 0 ? 0.1 : 0;   // a fast-forward or a new round: no catch-up
    vt += dt;
    for (const k in figs) figs[k].count = 0;
    props.mg42.count = 0; props.mortar.count = 0;
    let shots = 0;
    for (const o of built) {
      // a silenced strongpoint's last men (an observation post) keep their heads down like a suppressed crew
      const e = o.e, s = S(e), sup = e.alive && (e.suppressedUntil > now || !!(e.wn && e.wn.silenced));
      const act = e.alive && !sup && now - s.actT < 0.9;
      // the crew: as many as are left (the slots of the dead hold bodies; a knocked-out position two bodies)
      const n = !e.alive || e.dormant ? 0 : Math.min(o.slots.length, Math.ceil(o.slots.length * e.crew / Math.max(1, e.crew0) - 1e-6));
      const dead = e.dormant ? 0 : e.alive ? Math.min(2, o.slots.length - n) : Math.min(2, o.slots.length);
      for (let i = 0; i < o.slots.length; i++) {
        const sl = o.slots[i];
        if (i >= n) { if (i < n + dead || (!e.alive && i < dead)) put('fallen', sl.x, sl.y + 0.02, sl.z, sl.by); continue; }
        let pose = ROLE[sl.role];
        if (sup) { if (sl.role === 'rifle' || sl.role === 'stand') continue; pose = 'duck'; }
        else if (sl.role === 'rifle' && (act || now - e.firedAt < 3)) pose = 'aim';
        let yaw = sl.yaw;
        if (sl.role === 'gun') yaw = s.yaw;
        else if (pose === 'stand') yaw += Math.sin(vt * 0.4 + sl.by) * 0.5;   // a sentry looking about
        put(pose, sl.x, sl.y - (pose === 'duck' ? 0.03 : 0), sl.z, yaw);
      }
      // the MG 42: trained on its target inside the arc; tracers while it fires
      if (o.mg) {
        const t = act ? target(e, s, now) : null;
        if (t) { const want = Math.atan2(t.z - o.mg.z, t.x - o.mg.x), lim = e.arc >= Math.PI - 1e-6 ? Math.PI : e.arc + 0.12, d = Math.max(-lim, Math.min(lim, WW.angleDiff(e.heading, want))); s.yaw += WW.angleDiff(s.yaw, e.heading + d) * Math.min(1, dt * 8); }
        else if (s.yaw === 0) s.yaw = e.heading;
        _e.set(0, -s.yaw, e.alive ? 0 : -0.5, 'YXZ'); _q.setFromEuler(_e);
        if (props.mg42.count < MAXP) props.mg42.setMatrixAt(props.mg42.count++, _m.compose(_p.set(o.mg.x, o.mg.y - (e.alive ? 0 : 0.12), o.mg.z), _q, _s));
        if (t && dt > 0) {
          if (s.burst > 0) {
            s.burst -= dt; s.next -= dt;
            while (s.next <= 0 && shots < 40) { shoot(e, o, s, t); shots++; s.next += 1 / ROUNDS * rr(0.7, 1.3); }
            if (s.burst <= 0) s.pause = rr(0.25, 0.8);
          } else if ((s.pause -= dt) <= 0) { s.burst = rr(0.5, 1.4); s.next = 0; }
        }
      } else if (e.type === 'flak' && act && dt > 0) {   // the 2 cm flak at a plane (or the beach) without an MG prop
        const t = target(e, s, now);
        if (t && (s.next -= dt) <= 0) { shoot(e, o, s, t); s.next = rr(0.08, 0.2); }
      }
      if (o.mortar) {
        _e.set(0, -e.heading, 0, 'YXZ'); _q.setFromEuler(_e);
        if (props.mortar.count < MAXP) props.mortar.setMatrixAt(props.mortar.count++, _m.compose(_p.set(o.mortar.x, o.mortar.y, o.mortar.z), _q, _s));
        if (act && dt > 0 && (s.mortT -= dt) <= 0) { s.mortT = rr(3.5, 8); launch(o); }
      }
      // knocked out: smoke (fire at first) thinning over three minutes
      if (!e.alive && dt > 0 && WW.fx) {
        const age = now - e.outAt;
        if (R() < dt * (age < 180 ? 0.35 + 1.4 * (1 - age / 180) : 0.35)) WW.fx.smoke(e.x + rr(-0.6, 0.6), e.y + e.K.top + 0.3, e.z + rr(-0.6, 0.6), true, (e.K.wall ? 1.1 : 0.7) * (age < 180 ? 1 : 0.7));
        if (age < 30 && e.K.wall && R() < dt * 6) WW.fx.fire(e.x + rr(-0.4, 0.4), e.y + e.K.top * 0.6, e.z + rr(-0.4, 0.4));
      }
    }
    // the runners along the trenches of the strongpoints that still hold
    for (const r of wnRuns) {
      if (r.w.silenced) continue;
      for (let k = 0; k < 2; k++) {
        let d = ((vt * r.sp[k] + r.ph[k] * r.len * 2) % (r.len * 2)); const back = d > r.len; if (back) d = r.len * 2 - d;
        const P = r.pts; let i = 1;
        for (; i < P.length; i++) { const l = Math.hypot(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z); if (d <= l || i === P.length - 1) break; d -= l; }
        const a = P[i - 1], b = P[i], l = Math.max(1e-3, Math.hypot(b.x - a.x, b.z - a.z)), f = Math.min(1, d / l);
        const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, y = Math.max(-0.1, a.y + (b.y - a.y) * f) - 0.06;
        const yaw = Math.atan2(b.z - a.z, b.x - a.x) + (back ? Math.PI : 0);
        put(((vt * 6 + k * 0.5) | 0) & 1 ? 'runA' : 'runB', x, y, z, yaw);
      }
    }
    for (const k in figs) WW.instUsed(figs[k]);
    WW.instUsed(props.mg42); WW.instUsed(props.mortar);
    // the tracers fly; the rounds that arrive kick up the sand or the water
    let k = 0;
    for (const p of tr.a) {
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= p.life) { p.on = false; if (p.kick && R() < 0.75) strike(p.hx, p.hy, p.hz); continue; }
      const f = p.age * T_SPEED, len = Math.min(p.len, f + 0.2);
      _v.set(p.dx, p.dy, p.dz); _q.setFromUnitVectors(_x, _v);
      const hx = p.x + p.dx * f, hy = p.y + p.dy * f, hz = p.z + p.dz * f, kf = far(hx, hy, hz, 35, 5);
      _m.compose(_p.set(hx, hy, hz), _q, _v.set(len * (1 + (kf - 1) * 0.5), T_W * kf, T_W * kf));
      tr.m.setMatrixAt(k, _m);
      const hot = (p.age < 0.05 ? 1.3 : 1) * (0.55 + 0.45 / kf); tr.m.setColorAt(k, _c.setRGB(1.0 * hot, 0.42 * hot, 0.12 * hot));
      k++;
    }
    tr.m.count = k; WW.instUsed(tr.m, true);
    puff.step(dt, false); glow.step(dt, true);
  }
  // a mortar round away: the flash and the puff at the tube's mouth
  function launch(o) {
    const m = o.mortar || o.e, y = (m.y || o.e.y) + 0.25;
    glow.spawn(m.x, y, m.z, 0, 0.5, 0, 0.12, 0.09, 0.2, 0xff9a40);
    for (let i = 0; i < 4; i++) puff.spawn(m.x + rr(-0.1, 0.1), y + 0.05, m.z + rr(-0.1, 0.1), rr(-0.3, 0.3), rr(0.8, 1.6), rr(-0.3, 0.3), rr(1.0, 1.6), rr(0.06, 0.1), rr(0.22, 0.34), 0xb4b0a6, -0.2);
  }
  // a casemate / field gun / Tobruk / 155 firing: the flash in the embrasure or at the muzzle, the blast's dust
  function gunFlash(e) {
    const g = WW.bunkerModels && WW.bunkerModels.groupOf(e), mo = g && g.userData.mouth;
    const a = e.aim === undefined ? e.heading : e.aim, c = Math.cos(a), s = Math.sin(a);
    let x, y, z;
    if (mo) { const p = toW(e, mo.mx, mo.mz); x = p[0] + c * e.rad * 0.6; z = p[1] + s * e.rad * 0.6; y = e.y + (mo.my) ; }
    else { const L = e.type === 'battery' ? 2.6 : e.type === 'gunpit' ? 1.4 : 0.7; x = e.x + c * L; z = e.z + s * L; y = e.y + 0.45; }
    const big = e.K.gun && e.K.gun.cal !== 'small';
    glow.spawn(x, y, z, c * 2, 0.2, s * 2, 0.12, big ? 0.2 : 0.14, big ? 0.42 : 0.3, 0xff9a40);
    glow.spawn(x + c * 0.4, y, z + s * 0.4, c * 4, 0, s * 4, 0.09, 0.1, 0.26, 0xc06a28);
    if (WW.fx && WW.fx.smoke) WW.fx.smoke(x + c * 0.8, y, z + s * 0.8, false, big ? 0.45 : 0.28);
    for (let i = 0; i < (big ? 6 : 4); i++) {   // the blast throws the dust up off the ground in front of the gun
      const d = rr(0.4, 2.2), j = rr(-0.6, 0.6), px = x + c * d - s * j, pz = z + s * d + c * j, gy = Math.max(-0.1, H(px, pz));
      puff.spawn(px, gy + 0.1, pz, c * rr(1, 3) + rr(-0.5, 0.5), rr(0.5, 1.4), s * rr(1, 3) + rr(-0.5, 0.5), rr(1.0, 1.8), rr(0.08, 0.12), rr(0.22, 0.38), R() < 0.5 ? 0x948a70 : 0x857b62, 0.3, gy);
    }
  }

  // the renderer is keeping up (not a fast-forward: what fires in a jump would pile up unaged on the next frame)
  const live = now => lastNow >= 0 && now - lastNow < 2;
  function clear() { if (root && WW.scene) WW.scene.remove(root); root = null; built = []; wnRuns = []; lastNow = -1; }
  WW.on('defencesBuilt', d => {
    if (WW.simOnly || !WW.scene || !WW.germanModel || !WW.soldierModel) return;
    if (!root) init(); else if (root.parent !== WW.scene) WW.scene.add(root);
    if (trenchMesh) { root.remove(trenchMesh); trenchMesh.geometry.dispose(); trenchMesh = null; }
    built = d.elements.filter(e => !e.dormant || e.type === 'battery').map(layout);
    trenchMesh = trenches(d.wns); if (trenchMesh) root.add(trenchMesh);
    tr.a.forEach(p => { p.on = false; }); tr.m.count = 0; puff.clear(); glow.clear(); lastNow = -1;
  });
  WW.on('roundStart', () => { if (!WW.isScn('normandy')) clear(); });
  WW.on('setupStart', () => { if (!WW.isScn('normandy')) clear(); });
  WW.on('defenceFire', ev => {
    if (WW.simOnly || !root || !ev.el) return;
    const e = ev.el, s = S(e), now = WW.time.now;
    if (ev.kind === 'gun') { if (live(now) && s.flashFr !== fr) { s.flashFr = fr; gunFlash(e); } return; }
    s.actT = now;
    if (ev.target && ev.target.alive !== false) { s.tgt = ev.target; s.tgtT = now; }
  });
  WW.on('mortarBurst', ev => {
    if (WW.simOnly || !root || !ev.el) return;
    const o = built.find(b => b.e === ev.el), s = S(ev.el); if (o) { if (live(WW.time.now) && s.flashFr !== fr) { s.flashFr = fr; launch(o); } s.mortT = rr(3.5, 8); }
  });
  WW.defenceFx = { update, get root() { return root; }, _state: e => st.get(e) };
})(window.WW);
