// normandy_fleet.js - WW.normandyFleet: the Transport Area off Omaha (Normandy; visual only, Math.random, never in
// WW.world.ships, nothing the sim reads). The boats that launched the landing craft rode at anchor ~11 miles out
// (here ~1,000 u off the waterline, z ~ 100-160): the attack transports of Force O, the British LSIs, the Rangers'
// cross-channel ferries off Pointe du Hoc, Hall's headquarters ship Ancon and Kirk's flagship Augusta (Bradley aboard);
// the control vessels (PC-552 / PC-553, the LCCs, ML 304 for the Rangers) lay on the line of departure (LOD) and sent
// the waves in. Models: models_normandy_transports.js (Augusta: the Northampton class).
// The boats before the sim has them (landing_craft.js plan, an entry exists in the sim from spawnT at the LOD): each
// plan entry with spawnT still to come is a visual boat on a timeline that is a pure function of the round clock
// (WW.game.roundTime: fast-forward and slow motion just work, and a boat whose trip began before the round is simply
// met part way): in its mother ship's davits -> lowered (LOWER_T) -> alongside while the men climb down the cargo
// nets (LOAD_T) -> out to its wave's rendezvous circle near the transports, circling (the first boat lowered the
// longest) -> the run in: a smooth curve onto its lane that arrives at (r.x, shoreZ(r.x) - r.s0) at r.spawnT heading
// shoreward (+z), so the sim craft takes over where it is. LCTs and LCI(L)s crossed from England under their own
// power: they come in from the north edge, each wave down one track. The LCTs that launched the 741st's DD tanks lie
// at the launch points at round start, ramps down, then back off and head out. Of the davit slots no plan boat uses
// ~75% carry an empty boat (the plan is about half the craft of the day: the follow-up waves' boats); the rest are
// away in the holding circles (HOLD: loaded boats circling off the transports all round, as they milled about
// offshore all morning). Assignment: by unit to the ships that carried it (MOTHER), the nearest by lane x among them,
// spread over them per wave; LCMs ride the cargo booms. The ships wear the Channel's greys (models.weather: USN
// Measure 22, the RN's Admiralty greys) and about half the transports fly a barrage balloon, streaming downwind.
// The hand-over is exact: at spawnT - 0.02 s a boat is within 0.04 u of the sim's spawn point, heading pi/2, at the
// craft's speed (3% from the arc-length table).
// Interface (the landing-craft renderer reads it after this module's update in the main.js frame):
//   boats()  craft-like objects, reused frame to frame: { type, C, x, z, heading, men, tanks, state: 'run', rampDown,
//            pose } (heading: travel along (cos, sin) in (x, z); pose: null rides the waves, else { y: the waterline's
//            world height, pitch, roll } for a boat in the davits or being lowered)
//   ships()  the transport-area ships { name, cls, x, z, heading, len } (camera, labels)
//   debugDraw  true: also draw the boats here as plain boxes (debugging the timelines)
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const PI = Math.PI, N = 24;
  const HEAD = 0.39 + PI;                          // anchored head to the WNW wind and the flood stream (scenario.js wind a)
  const LOWER_T = 10, LOAD_T = 24, CIRC_T = 80, STAG_T = 9, CIRC_K = 0.5, OUT_K = 0.8, RESERVE_P = 0.75;
  // the holding circles: loaded follow-up boats circling off the transports all morning (from 08:30 the beachmasters
  // held back the follow-up waves; craft milled about offshore for hours): [x, u off the waterline, boats, craft]
  const HOLD = [[690, 985, 5, 'lca'], [1315, 975, 6, 'lca'], [1505, 960, 7, 'lcvp'], [1720, 935, 8, 'lcvp'], [1925, 975, 7, 'lcvp'], [2045, 950, 5, 'lcvp']];
  // [name, class, flag, x, u off the waterline, pennants (control vessels: the sector colours either side)]
  const SHIPS = [
    ['Amsterdam', 'ferry', 'RN', 560, 1040], ['Ben Machree', 'ferry', 'RN', 650, 1085],
    ['Prince Charles', 'ferry', 'RN', 745, 1035], ['Prince Leopold', 'ferry', 'RN', 835, 1080],
    ['Augusta', 'northampton', 'USN', 1130, 900, null, 'cruiser'],
    ['Empire Javelin', 'lsil', 'RN', 1270, 1040], ['Empire Anvil', 'lsil', 'RN', 1365, 1085],
    ['Thomas Jefferson', 'apa', 'USN', 1465, 1030], ['Charles Carroll', 'apa', 'USN', 1565, 1080],
    ['Ancon', 'agc', 'USN', 1665, 965],
    ['Samuel Chase', 'apa', 'USN', 1770, 1030], ['Henrico', 'apa', 'USN', 1870, 1080],
    ['Dorothea L. Dix', 'apa', 'USN', 1975, 1035], ['Anne Arundel', 'apa', 'USN', 2080, 1085],
    // on the LOD, on the sector boundaries (the lanes keep 5% inside a sector) and just seaward of it
    ['ML 304', 'lcc', 'RN', 712, 428, [0xd2564c, 0xefe8da]], ['LCC-20', 'lcc', 'USN', 1355, 428, [0xefe8da, 0x5e9a62]],
    ['PC-552', 'pc', 'USN', 1525, 430, [0xefe8da, 0xd2564c]], ['LCC-30', 'lcc', 'USN', 1665, 428, [0x5e9a62, 0xd2564c]],
    ['PC-553', 'pc', 'USN', 1890, 430, [0xd2564c, 0x5e9a62]], ['LCC-60', 'lcc', 'USN', 2015, 428, [0x5e9a62, 0xd2564c]]
  ];
  // the units' ships (by the plan's unit name; first match); LCAs default to the Rangers' ships, the rest to the APAs
  const MOTHER = [
    [/Ranger Bn, D E F/, ['Amsterdam', 'Ben Machree']], [/Ranger/, ['Prince Charles', 'Prince Leopold']],
    [/116th RCT, [ABC] Co/, ['Empire Javelin', 'Empire Anvil']], [/116th/, ['Thomas Jefferson', 'Charles Carroll']],
    [/16th RCT/, ['Samuel Chase', 'Henrico']], [/18th|26th|115th/, ['Dorothea L. Dix', 'Anne Arundel']]
  ];
  const DAV_CRAFT = { apa: 'lcvp', lsil: 'lca', ferry: 'lca' };
  let root = null, ships = [], recs = [], out = [], shipsOut = [], lastPlan = null, men = null, falls = null, dbg = null, nFalls = 0, clk = 0;
  const nMen = [0, 0], MAX_MEN = 160, MAN_S = 0.78;
  const _o = { x: 0, z: 0, h: 0 }, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, sm = f => { f = clamp(f, 0, 1); return f * f * (3 - 2 * f); };
  const wh = (x, z) => (WW.waves && WW.waves.active ? WW.waves.height(x, z) : 0);

  // ---- curves: cubic Bezier in (x, z) with an arc-length table, walked by time share ----
  function bez(p, u, o) {
    const v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u;
    o.x = a * p[0] + b * p[2] + c * p[4] + d * p[6]; o.z = a * p[1] + b * p[3] + c * p[5] + d * p[7];
    const da = -3 * v * v, db = 3 * v * v - 6 * v * u, dc = 6 * v * u - 3 * u * u, dd = 3 * u * u;
    o.h = Math.atan2(da * p[1] + db * p[3] + dc * p[5] + dd * p[7], da * p[0] + db * p[2] + dc * p[4] + dd * p[6]);
    return o;
  }
  function curve(p) {
    const lut = [0]; let px = p[0], pz = p[1];
    for (let i = 1; i <= N; i++) { bez(p, i / N, _o); lut.push(lut[i - 1] + Math.hypot(_o.x - px, _o.z - pz)); px = _o.x; pz = _o.z; }
    return { p, lut, len: lut[N] };
  }
  function along(P, f, o) {
    const s = clamp(f, 0, 1) * P.len, L = P.lut; let i = 1;
    while (i < N && L[i] < s) i++;
    return bez(P.p, clamp((i - 1 + (s - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1])) / N, 0, 1), o);
  }
  // from (ax, az) leaving along angle h0 to (bx, bz) arriving along angle h1; k: the handle share of the distance
  function link(ax, az, h0, bx, bz, h1, k0, k1) {
    const d = Math.hypot(bx - ax, bz - az);
    return curve([ax, az, ax + Math.cos(h0) * d * k0, az + Math.sin(h0) * d * k0, bx - Math.cos(h1) * d * k1, bz - Math.sin(h1) * d * k1, bx, bz]);
  }

  // ---- the ships ----
  function init() {
    root = new THREE.Group(); root.name = 'normandyFleet';
    for (const d of SHIPS) {
      const [name, cls, flag, x, off, pen, type] = d, c = WW.SHIP_CLASSES[cls];
      let m = null;
      try { m = WW.models.buildShip(type || 'cruiser', flag, cls); } catch (e) { console.error('normandyFleet', name, e); continue; }
      const g = m.group; g.rotation.order = 'YXZ';
      if (WW.models.weather) WW.models.weather(g, flag);                                      // the Channel's greys, not the Pacific's
      if (pen && m.pennant) pen.forEach((col, i) => {                                         // the control vessel's sector pennants
        const f = new THREE.Mesh(WW.models._geo().box, WW.models._mat(col)); const a = m.pennant;
        f.scale.set(0.3 * a.k, 0.2 * a.k, 0.015); f.position.set(a.x - 0.16 * a.k, a.y - 0.24 * a.k, (i ? -1 : 1) * a.yard * 0.45); g.add(f);
      });
      root.add(g);
      ships.push({ name, cls, flag, x0: x, off, x, z: 0, heading: HEAD, len: c ? c.len : 15, beam: c ? c.beam : 2, group: g, slots: (WW.models.DAVITS || {})[cls] || [],
        ph: Math.random() * 6.28, y: 0, pitch: 0, roll: 0, ch: 1, sh: 0, control: !!pen, kind: DAV_CRAFT[cls] || null });
    }
    // barrage balloons: about half the transports flew one from the mainmast, low under the cloud
    const bm = new THREE.MeshToonMaterial({ color: WW.models._soft ? WW.models._soft(0x8a8f93) : 0x8a8f93, gradientMap: WW.models._grad ? WW.models._grad() : null });
    const cm = new THREE.MeshBasicMaterial({ color: 0x2f3337 }), bg = new THREE.SphereGeometry(0.5, 12, 8), cg = new THREE.CylinderGeometry(0.012, 0.012, 1, 3);
    for (const s of ships) {
      if (s.control || s.cls === 'northampton' || Math.random() > 0.55) continue;
      const b = new THREE.Group(), body = new THREE.Mesh(bg, bm); body.scale.set(2.1, 0.78, 0.78); b.add(body);
      for (let k = 0; k < 3; k++) {                                                              // the three tail fins, inflated lobes
        const f = new THREE.Mesh(bg, bm), a = k * 2 * PI / 3;                                  // up, and two below at 120 deg
        f.scale.set(0.7, 0.5, 0.12); f.rotation.x = a; f.position.set(-0.85, Math.cos(a) * 0.38, Math.sin(a) * 0.38); b.add(f);
      }
      const cab = new THREE.Mesh(cg, cm);
      b.castShadow = true; root.add(b); root.add(cab);
      s.bal = { b, cab, ph: Math.random() * 6.28, h: 13 + Math.random() * 5, d: 5 + Math.random() * 3 };
    }
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const im = (geo, col, n) => { const q = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: WW.pastel ? WW.pastel(col, 0.1) : col }), n); q.count = 0; q.frustumCulled = false; q.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(q); return q; };
    // the men on the nets and waiting at the rail: the landing-craft renderer's soldier figures (models_soldier.js)
    const G = WW.soldierModel.build(), tm = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: WW.models._grad ? WW.models._grad() : null });
    men = [G.stand, G.crouch].map(geo => { const q = new THREE.InstancedMesh(geo, tm, MAX_MEN); q.count = 0; q.frustumCulled = false; q.castShadow = true; q.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(q); return q; });
    falls = im(box, 0x3c4046, 64);
    falls.castShadow = true;
    dbg = { hull: im(box, 0x7b8794, 200), ramp: im(box, 0x5f6a74, 200), house: im(box, 0x8c969e, 200) };
  }
  function place() {
    const T = WW.normandyTerrain;
    for (const s of ships) {
      s.x = s.x0; s.z = T.shoreZ(s.x0) - s.off;
      s.heading = s.control ? -PI / 2 : HEAD + (Math.random() - 0.5) * 0.12;                // the control vessels lie bow to seaward, along the lanes
      s.ch = Math.cos(s.heading); s.sh = Math.sin(s.heading);
      s.group.position.set(s.x, 0, s.z); s.group.rotation.set(0, -s.heading, 0);
    }
    shipsOut = ships.map(s => ({ name: s.name, cls: s.cls, x: s.x, z: s.z, heading: s.heading, len: s.len }));
  }
  // ship-local (lx, lz) -> world
  function wx(s, lx, lz) { return s.x + lx * s.ch - lz * s.sh; }
  function wz(s, lx, lz) { return s.z + lx * s.sh + lz * s.ch; }
  // ride the sea: heave, pitch and roll from the wave surface under the hull, damped for a big hull
  function ride(s) {
    const L = s.len * 0.45, B = s.beam * 0.5, hb = wh(wx(s, L, 0), wz(s, L, 0)), hs = wh(wx(s, -L, 0), wz(s, -L, 0));
    const hp = wh(wx(s, 0, B), wz(s, 0, B)), hn = wh(wx(s, 0, -B), wz(s, 0, -B)), hm = wh(s.x, s.z), k = clamp(9 / s.len, 0.25, 1);
    s.y = (hb + hs + hp + hn + hm) / 5 * clamp(6 / s.len, 0.35, 1);                        // the small control vessels heave with the sea
    s.pitch = Math.atan((hb - hs) / (2 * L)) * 0.35 * k + Math.sin(clk * 0.5 + s.ph) * 0.004;
    s.roll = -Math.atan((hp - hn) / (2 * B)) * 0.12 * k + Math.sin(clk * 0.37 + s.ph * 2) * 0.01 * k;
    s.group.position.y = s.y; s.group.rotation.set(s.roll, -s.heading, s.pitch);
    if (s.bal) {                                                                               // the balloon streams downwind of the mainmast, nose to the wind
      const B = s.bal, W = WW.wind || { x: 0.9, z: 0.4 }, wl = Math.hypot(W.x, W.z) || 1, ux = W.x / wl, uz = W.z / wl;
      const ax = wx(s, -0.3 * s.len, 0), az = wz(s, -0.3 * s.len, 0), ay = s.y + 3.2;
      const bob = Math.sin(clk * 0.23 + B.ph), bx = ax + ux * (B.d + bob * 0.4), bz = az + uz * (B.d + bob * 0.4) + Math.cos(clk * 0.17 + B.ph) * 0.3, by = ay + B.h + bob * 0.35;
      B.b.position.set(bx, by, bz); B.b.rotation.set(Math.sin(clk * 0.31 + B.ph) * 0.05, Math.atan2(uz, -ux), bob * 0.03, 'YXZ');
      const dx = bx - ax, dy = by - 0.4 - ay, dz = bz - az, l = Math.hypot(dx, dy, dz);
      B.cab.position.set((ax + bx) / 2, (ay + by - 0.4) / 2, (az + bz) / 2); B.cab.scale.set(1, l, 1);
      B.cab.quaternion.setFromUnitVectors(_p.set(0, 1, 0), _s.set(dx / l, dy / l, dz / l));
    }
  }

  // ---- the boats' timelines (built once per round plan) ----
  function boat(type, rec) {
    const C = WW.landingCraft.CRAFT[type];
    rec.o = { type, C, x: 0, z: 0, heading: 0, men: 0, tanks: 0, state: 'run', rampDown: false, pose: null };
    rec.pose = { y: 0, pitch: 0, roll: 0 }; rec.C = C;
    return rec;
  }
  function ringAt(w, t, i, o) { const a = w.a0 + i * w.da + w.om * t; o.x = w.cx + w.R * Math.cos(a); o.z = w.cz + w.R * Math.sin(a); o.h = a + PI / 2; return o; }
  function build() {
    const LC = WW.landingCraft, T = WW.normandyTerrain, plan = LC.plan;
    recs = []; lastPlan = plan;
    const by = name => ships.find(s => s.name === name);
    const waves = new Map(), load = new Map();
    for (const r of plan) {
      if (!(r.spawnT > 0)) continue;                                                         // already in the sim at round start
      const C = LC.CRAFT[r.craft], P = { x: r.x, z: T.shoreZ(r.x) - r.s0 };
      if (r.craft === 'lct' || r.craft === 'lci') {                                         // across from England: in from the north edge
        const x0 = r.x + (Math.random() - 0.3) * 60, rec = boat(r.craft, { kind: 'north', r, men: C.men, tanks: C.tanks });
        rec.path = curve([x0, -60, x0, 160, P.x, P.z - 220, P.x, P.z]);
        rec.t0 = r.spawnT - rec.path.len / C.speed; recs.push(rec); continue;
      }
      if (r.craft === 'dd') continue;
      // the mother ship: the unit's ships, nearest by lane x, spread over them within the wave
      const rule = MOTHER.find(m => m[0].test(r.unit || ''));
      let cand = (rule ? rule[1].map(by) : []).filter(s => s && s.slots.some(q => q.boom === (r.craft === 'lcm')));
      if (!cand.length) cand = ships.filter(s => s.slots.some(q => q.boom === (r.craft === 'lcm')) && (r.craft !== 'lca' || s.kind === 'lca'));
      if (!cand.length) cand = ships.filter(s => s.slots.length);
      const lk = s => (load.get(s.name + '|' + r.wave) || 0);
      const s = cand.reduce((a, b) => (Math.abs(b.x - r.x) + 60 * lk(b) < Math.abs(a.x - r.x) + 60 * lk(a) ? b : a));
      load.set(s.name + '|' + r.wave, lk(s) + 1);
      const rec = boat(r.craft, { kind: 'davit', r, ship: s, P, men: C.men, tanks: C.tanks });
      if (!waves.has(r.wave)) waves.set(r.wave, []);
      waves.get(r.wave).push(rec); recs.push(rec);
    }
    for (const [wv, list] of waves) {                                                        // each wave's rendezvous circle
      const n = list.length, mx = list.reduce((a, q) => a + q.ship.x, 0) / n, mz = list.reduce((a, q) => a + q.ship.z, 0) / n;
      const sp = list[0].C.speed, R = Math.max(3.5, n * 3 * list[0].C.len / (2 * PI));      // ~3 boat lengths apart round the ring
      const w = { cx: mx + (Math.random() - 0.5) * 24, cz: mz + 34 + R + Math.random() * 12, R, a0: Math.random() * 6.28, da: 2 * PI / n, om: sp * CIRC_K / R };
      list.forEach((q, i) => {
        q.w = w; q.i = i;
        let tr = q.r.spawnT - Math.hypot(q.P.x - w.cx, q.P.z - w.cz) / sp;                  // the run's start: tr + run length / speed = spawnT
        for (let k = 0; k < 4; k++) { ringAt(w, tr, i, _o); q.run = link(_o.x, _o.z, _o.h, q.P.x, q.P.z, PI / 2, 0.2, 0.4); tr = q.r.spawnT - q.run.len / sp; }
        ringAt(w, tr, i, _o); q.run = link(_o.x, _o.z, _o.h, q.P.x, q.P.z, PI / 2, 0.2, 0.4); q.tr = tr;
      });
      const trMin = Math.min(...list.map(q => q.tr));
      list.forEach((q, i) => {                                                              // lowered one after another, the first circles longest
        q.tJoin = trMin - CIRC_T - (n - 1 - i) * STAG_T;
      });
    }
    // davit slots: per ship, the boats in order of lowering share the slots round-robin; a boat shows in its davit once
    // the one before it in that slot is away
    for (const s of ships) {
      if (!s.slots.length) continue;
      s.slotUse = s.slots.map(() => []);
      for (const boom of [false, true]) {
        const idx = s.slots.map((o, k) => o.boom === boom ? k : -1).filter(k => k >= 0);
        const mine = recs.filter(q => q.ship === s && (q.r.craft === 'lcm') === boom).sort((a, b) => a.tJoin - b.tJoin);
        mine.forEach((q, j) => {
          const k = idx[(j + (boom ? 0 : Math.floor(Math.random() * idx.length))) % idx.length], sl = s.slots[k];
          q.slot = sl; q.slotK = k;
          // alongside under the davit, out to the circle (leaving bow-first, out from the ship's side)
          const ax = wx(s, sl.x, sl.z), az = wz(s, sl.x, sl.z), sp = q.C.speed, hOut = s.heading + sl.side * 0.6;
          const est = Math.max(4, (Math.hypot(ax - q.w.cx, az - q.w.cz) - q.w.R) / (sp * OUT_K));
          ringAt(q.w, q.tJoin, q.i, _o);
          q.out = link(ax, az, hOut, _o.x, _o.z, _o.h, 0.35, 0.3);
          q.tLeave = q.tJoin - Math.max(est, q.out.len / (sp * OUT_K));
          q.tAlong = q.tLeave - LOAD_T; q.tLower = q.tAlong - LOWER_T;
          q.ax = ax; q.az = az;
          s.slotUse[k].push(q);
        });
      }
      // the slots no plan boat uses: most still carry a boat (the follow-up waves' craft, empty in the davits), the rest
      // are away (the holding circles); a slot whose plan boat has gone stays empty (the first trips came back for hours)
      s.slots.forEach((sl, k) => {
        if (sl.boom || s.slotUse[k].length || Math.random() > RESERVE_P) return;              // the LCMs wait nested on the hatches (the model)
        recs.push(boat(s.kind || 'lcvp', { kind: 'reserve', ship: s, slot: sl, from: -1e9, men: 0, tanks: 0 }));
      });
      for (const u of s.slotUse) u.forEach((q, j) => { q.shown = q.slot.boom ? q.tLower - 8 : j ? u[j - 1].tLeave + 8 : -1e9; });   // an LCM is swung out by the boom just before it goes down
    }
    for (const [x, off, n, type] of HOLD) {
      const C = LC.CRAFT[type], R = Math.max(3.5, n * 3 * C.len / (2 * PI)), cx = x + (Math.random() - 0.5) * 30;
      const w = { cx, cz: T.shoreZ(cx) - off + (Math.random() - 0.5) * 20, R, a0: Math.random() * 6.28, da: 2 * PI / n, om: C.speed * CIRC_K / R };
      for (let i = 0; i < n; i++) recs.push(boat(type, { kind: 'hold', w, i, men: C.men, tanks: 0 }));
    }
    // the LCTs and LCI(L)s in from the north edge: each wave down one track, a loose echelon (the plan has them a second
    // or two apart at the LOD)
    const north = new Map();
    for (const q of recs) if (q.kind === 'north') { if (!north.has(q.r.wave)) north.set(q.r.wave, []); north.get(q.r.wave).push(q); }
    for (const list of north.values()) {
      const x0 = list.reduce((a, q) => a + q.r.x, 0) / list.length + (Math.random() - 0.5) * 60;
      list.forEach((q, i) => {
        const P = q.path.p, xs = x0 + (i - (list.length - 1) / 2) * 7;
        q.path = curve([xs, -60, xs, 160, P[6], P[7] - 220, P[6], P[7]]);
        q.t0 = q.r.spawnT - q.path.len / q.C.speed;
      });
    }
    // the LCTs that launched the DD tanks: one to each pair of tanks, at the launch point at round start
    const dd = plan.filter(r => r.craft === 'dd');
    const byW = new Map(); dd.forEach(r => { if (!byW.has(r.wave)) byW.set(r.wave, []); byW.get(r.wave).push(r); });
    for (const list of byW.values()) {
      list.sort((a, b) => a.x - b.x);
      for (let i = 0; i < list.length; i += 2) {
        const pr = list.slice(i, i + 2), x = pr.reduce((a, r) => a + r.x, 0) / pr.length, s0 = pr[0].s0;
        recs.push(boat('lct', { kind: 'ddlct', x, z: T.shoreZ(x) - s0 - 3.2, wait: 18 + Math.random() * 6, men: 6, tanks: 0 }));
      }
    }
  }

  // ---- the boats this frame ----
  function slotPose(q, s, sl, y) {
    const o = q.o, P = q.pose;
    o.x = wx(s, sl.x, sl.z); o.z = wz(s, sl.x, sl.z); o.heading = s.heading;
    P.y = y; P.pitch = s.pitch; P.roll = s.roll; o.pose = P;
  }
  // a figure (k: 0 standing, 1 crouched) at (x, y, z) facing yaw (the figure faces +x)
  function addMan(k, x, y, z, yaw) {
    if (nMen[k] >= MAX_MEN) return;
    _e.set(0, yaw, 0, 'YXZ'); _q.setFromEuler(_e);
    men[k].setMatrixAt(nMen[k]++, _m.compose(_p.set(x, y, z), _q, _s.set(MAN_S, MAN_S, MAN_S)));
  }
  function addFall(x, y0, y1, z) {
    if (nFalls >= 64 || y1 <= y0) return;
    _m.compose(_p.set(x, y0, z), _q.identity(), _s.set(0.014, y1 - y0, 0.014)); falls.setMatrixAt(nFalls++, _m);
  }
  function step(q, t) {
    const o = q.o; o.pose = null; o.rampDown = false; o.men = q.men; o.tanks = q.tanks;
    if (q.kind === 'north') {
      if (t < q.t0 || t >= q.r.spawnT) return false;
      along(q.path, (t - q.t0) / (q.r.spawnT - q.t0), _o); o.x = _o.x; o.z = _o.z; o.heading = _o.h;
      return true;
    }
    if (q.kind === 'ddlct') {
      const T = t - q.wait;
      o.heading = PI / 2; o.x = q.x; o.z = q.z;
      if (T < 0) { o.rampDown = true; return true; }
      const back = Math.min(T, 12) * 0.6; o.z = q.z - back;                                   // astern, then a turn to port and out
      if (T <= 12) return true;
      const R = 4, a = Math.min(PI, (T - 12) * 1.2 / R), cx = q.x - R, cz = q.z - back;
      o.x = cx + R * Math.cos(a); o.z = cz - R * Math.sin(a); o.heading = PI / 2 + a;
      if (a >= PI) { const d = (T - 12 - PI * R / 1.2) * 1.4; o.x = cx - R; o.z = cz - d; o.heading = -PI / 2; }
      return o.z > -40;
    }
    if (q.kind === 'hold') { ringAt(q.w, t, q.i, _o); o.x = _o.x; o.z = _o.z; o.heading = _o.h; return true; }
    const s = q.ship, sl = q.slot;
    if (q.kind === 'reserve') {
      if (t < q.from) return false;
      slotPose(q, s, sl, s.y + sl.y + 0.15);
      return true;
    }
    if (t >= q.r.spawnT) return false;
    if (t >= q.tr) { along(q.run, (t - q.tr) / (q.r.spawnT - q.tr), _o); o.x = _o.x; o.z = _o.z; o.heading = _o.h; return true; }
    if (t >= q.tJoin) { ringAt(q.w, t, q.i, _o); o.x = _o.x; o.z = _o.z; o.heading = _o.h; return true; }
    if (t >= q.tLeave) { along(q.out, (t - q.tLeave) / (q.tJoin - q.tLeave), _o); o.x = _o.x; o.z = _o.z; o.heading = _o.h; return true; }
    if (!sl) return false;
    if (t < q.shown) return false;                                                           // still in the deck nest
    const hang = s.y + sl.y + 0.15, bl = q.C.len, ax = sl.x;
    if (t < q.tLower) { o.men = 0; slotPose(q, s, sl, hang); }
    else if (t < q.tAlong) {                                                                 // lowered on the falls
      const f = sm((t - q.tLower) / LOWER_T), x = wx(s, sl.x, sl.z), z = wz(s, sl.x, sl.z);
      o.men = 0; slotPose(q, s, sl, hang + (wh(x, z) - hang) * f);
      if (f >= 1) o.pose = null;
    } else {                                                                                 // alongside: the men come down the net
      o.x = q.ax; o.z = q.az; o.heading = s.heading;
      const f = (t - q.tAlong) / LOAD_T; o.men = Math.round(q.men * clamp(f * 1.1, 0, 1));
      const face = -s.heading + sl.side * PI / 2, out = -s.heading - sl.side * PI / 2;      // facing the hull / outboard
      if (f < 0.92) for (let k = 0; k < 4; k++) {                                            // on the net, four abreast, one file each
        const u = (f * 5 + k * 0.37) % 1, lz = sl.side * (sl.w + 0.06), lx = ax + (k - 1.5) * 0.24;
        addMan(0, wx(s, lx, lz), s.y + 0.05 + (sl.y - 0.3) * (1 - u), wz(s, lx, lz), face);
      }
      const left = Math.round(8 * (1 - clamp(f * 1.15, 0, 1)));                              // the rest waiting at the rail
      for (let k = 0; k < left; k++) {
        const lx = ax + ((k % 4) - 1.5) * 0.2 + (k > 3 ? 0.1 : 0), lz = sl.side * (sl.w - 0.18 - (k > 3 ? 0.17 : 0));
        addMan(k % 3 === 2 ? 1 : 0, wx(s, lx, lz), s.y + sl.y, wz(s, lx, lz), out);
      }
    }
    if (!sl.boom && t < q.tAlong + 3) {                                                    // the falls from the davit heads to the boat
      const top = s.y + sl.y + 0.44, yb = (o.pose ? o.pose.y : wh(o.x, o.z)) + 0.3;
      for (let e = -1; e <= 1; e += 2) addFall(wx(s, ax + e * bl * 0.36, sl.z), yb, top, wz(s, ax + e * bl * 0.36, sl.z));
    }
    return true;
  }
  // ---- the debug boxes (WW.normandyFleet.debugDraw) ----
  let nd = null;
  function put(part, o, lx, ly, lz, sx, sy, sz) {
    const P = dbg[part]; if (nd[part] >= 200) return;
    const ps = o.pose, y0 = ps ? ps.y : wh(o.x, o.z) - 0.06;
    _e.set(ps ? ps.roll : 0, -o.heading, ps ? ps.pitch : 0, 'YXZ'); _q.setFromEuler(_e);
    _p.set(lx, ly, lz).applyQuaternion(_q);
    P.setMatrixAt(nd[part]++, _m.compose(_p.set(o.x + _p.x, y0 + _p.y, o.z + _p.z), _q, _s.set(sx, sy, sz)));
  }
  function drawDebug() {
    nd = { hull: 0, ramp: 0, house: 0 };
    if (WW.normandyFleet.debugDraw) for (const o of out) {
      const L = o.C.len, B = o.C.beam, H = o.type === 'lci' ? 0.45 : o.type === 'lct' ? 0.28 : 0.3;
      put('hull', o, 0, 0, 0, L, H, B);
      put('house', o, -L * (o.type === 'lci' ? 0.15 : 0.4), H, 0, L * 0.18, o.type === 'lci' ? 0.5 : 0.16, B * 0.7);
      if (o.rampDown) put('ramp', o, L / 2 + B * 0.45, 0, 0, B * 0.9, 0.04, B * 0.85); else put('ramp', o, L / 2, 0, 0, 0.05, H * 1.05, B * 0.95);
      if (o.men > 0 && o.type !== 'lct') put('ramp', o, 0, H, 0, L * 0.5, 0.1, B * 0.7);    // the men's helmets in the well
    }
    for (const k in dbg) { dbg[k].count = nd[k]; WW.instUsed(dbg[k]); }
  }

  function update(rdt) {
    clk += rdt || 0;
    const on = !WW.simOnly && WW.isScn('normandy') && WW.scene && WW.normandyTerrain && WW.landingCraft && WW.SHIP_CLASSES;
    if (!on) { if (root && root.parent) root.parent.remove(root); out.length = 0; shipsOut.length = 0; lastPlan = null; return; }
    if (!root) init();
    if (!root.parent) WW.scene.add(root);
    if (WW.landingCraft.plan !== lastPlan) { place(); build(); }
    for (const s of ships) ride(s);
    const t = WW.game ? WW.game.roundTime : 0, live = WW.game && WW.game.state === 'battle';
    out.length = 0; nMen[0] = nMen[1] = 0; nFalls = 0;
    if (live) for (const q of recs) if (step(q, t)) out.push(q.o);
    men.forEach((m, k) => { m.count = nMen[k]; WW.instUsed(m); });
    falls.count = nFalls; WW.instUsed(falls);
    drawDebug();
  }
  WW.normandyFleet = { update, boats: () => out, ships: () => shipsOut, debugDraw: false, get recs() { return recs; } };
})(window.WW);
