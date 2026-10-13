// vehicles_fx.js - WW.vehicleFx: the realism pass on screen at Omaha (visual only; Math.random). Instanced meshes of the
// models_vehicles.js kit (and the Sherman of models_tank.js, the GI of models_soldier.js, the German of
// models_german.js), re-posed each frame (main.js frame hook) from the sim:
//  - the vehicles ashore (vehicles.js): the jam along the shingle, the dozers at work, the traffic up an open draw; the
//    ones knocked out stay as burnt hulks (smoking a while), the drowned ones under the tide where they stood
//  - the vehicle LCTs' cargo on deck (models_landing.js calls onDeck with the craft's matrix as it draws the hull)
//  - the DUKWs (landing_craft.js 'dukw'): riding low in the chop with their 105s and sandbags, lower as they flood, and
//    going down when they founder; the fire-brigade ladder DUKWs at Pointe du Hoc, one with its ladder up, swaying,
//    Sgt. Stivison at the top
//  - the gap lanes (beach_engineers.js): the obstacles going up when the charges are fired; a marked lane's buoys at
//    its seaward end and its pennants on poles up the beach (green on the west side, red on the east)
//  - the draws' blocks: the anti-tank ditches (filled by the dozers once open) and the road blocks (pushed aside);
//    D-1's wall is WN 72's 'atwall' (models_bunker.js draws it, and its rubble when it is blown)
//  - the leaders (leaders.js): the named officers on their feet at the shingle, walking the line
//  - the prisoners (prisoners.js): a file with their hands up, a GI ahead and one behind, down the bluff to the
//    shingle; then a huddle on the sand, hands on their heads
//  - the burning named LCIs (landing_craft.js NAMED): LCI(L)-91 burning on the beach all day, LCI(L)-85 burning off
//    the beach until she goes down
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const MAX_V = 160, MAX_D = 48, MAX_M = 160, MAX_P = 260, MAX_DECK = 120, PRIS_GAP = 0.32, HULK_SMOKE = 80, SINK_T = 9;
  let root = null, M = null, built = false, lastRt = 0, deck = [], nDeck = 0;
  const sinking = [], blasts = [];
  const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _l = new THREE.Matrix4(), _r = new THREE.Matrix4();
  const burnt = new THREE.Color(0.32, 0.3, 0.28), white = new THREE.Color(1, 1, 1);
  const on = () => !WW.simOnly && WW.isScn('normandy') && !!WW.scene && !!WW.normandyTerrain;
  const gy = (x, z) => Math.max(WW.terrain.heightRaw(x, z), -5);
  const sea = (x, z) => (WW.waves && WW.waves.active ? WW.waves.height(x, z) : 0);
  function init() {
    root = new THREE.Group(); root.name = 'vehicles';
    const grad = WW.models._grad ? WW.models._grad() : null;
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: grad }), matI = mat.clone();
    const mk = (g, n, tint) => { const im = new THREE.InstancedMesh(g, tint ? matI : mat, n); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); if (tint) im.setColorAt(0, white); root.add(im); return im; };
    const V = WW.vehicleModel.build(), TK = WW.tankModel.build(), S = WW.soldierModel.build(), GM = WW.germanModel;
    M = {};
    for (const k of ['jeep', 'truck', 'halftrack', 'd7', 'dukw']) M[k] = mk(V[k], MAX_V, true);
    M.sherman = mk(TK.sherman, MAX_D, true); M.blade = mk(V.blade, MAX_D, true);
    M.howitzer = mk(V.howitzer, MAX_D); M.ladderBase = mk(V.ladderBase, 8); M.ladder = mk(V.ladder, 8);
    M.buoy = mk(V.buoy, 64); M.flagG = mk(V.flagG, 96); M.flagR = mk(V.flagR, 96);
    M.ditch = mk(V.ditch, 8); M.fill = mk(V.fill, 8); M.roadblock = mk(V.roadblock, 8);
    for (const p of ['stand', 'runA', 'runB', 'crouch']) M['gi:' + p] = mk(S[p], MAX_M);
    // the prisoners: the German figure with his hands up (walking) or on his head (squatting)
    GM.build();
    const fig = o => WW.soldierModel.merge(GM.figure(o));
    M['pw:a'] = mk(fig({ legF: 0.45, legB: -0.35, lean: 0.1, armF: 2.85, rifle: 'none' }), MAX_P);
    M['pw:b'] = mk(fig({ legF: -0.35, legB: 0.45, lean: 0.1, armF: 2.85, rifle: 'none' }), MAX_P);
    M['pw:sit'] = mk(fig({ legF: 1.25, legB: -0.9, knee: 0.08, lean: 0.25, armF: 2.6, rifle: 'none' }), MAX_P);
    WW.scene.add(root);
    for (let i = 0; i < MAX_DECK; i++) deck.push({ k: '', m: new THREE.Matrix4() });
    built = true;
  }
  function put(key, x, y, z, yaw, col, pitch, roll) {
    const im = M[key]; if (!im || im.count >= im.instanceMatrix.count) return null;
    _e.set(roll || 0, -yaw, pitch || 0, 'YXZ'); _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(1, 1, 1));
    if (im.instanceColor) im.setColorAt(im.count, col || white);
    im.setMatrixAt(im.count++, _m);
    return _m;
  }
  function putM(key, m, col) { const im = M[key]; if (!im || im.count >= im.instanceMatrix.count) return; if (im.instanceColor) im.setColorAt(im.count, col || white); im.setMatrixAt(im.count++, m); }
  // a vehicle of kind k at (x, z) heading h (the tank dozer: the Sherman and its blade; the DUKW105: and the gun)
  function vehicle(k, x, y, z, h, col, pitch, roll) {
    if (k === 'tankdozer') { put('sherman', x, y, z, h, col, pitch, roll); putM('blade', _m, col); return; }
    if (k === 'dukw105') { put('dukw', x, y, z, h, col, pitch, roll); putM('howitzer', _m); return; }
    put(k, x, y, z, h, col, pitch, roll);
  }
  // models_landing.js: the cargo of a vehicle LCT, on its deck (D: the LCT's layout; craft matrix Mc)
  function onDeck(u, Mc, D) {
    if (!built || !u.cargo || !u.cargo.length) return;
    const n = u.cargo.length, x1 = D.xh - 0.5;
    for (let i = 0; i < n && nDeck < MAX_DECK; i++) {
      const two = n > 3, row = two ? i >> 1 : i, col = two ? (i & 1 ? -0.22 : 0.22) : 0;
      const d = deck[nDeck++]; d.k = u.cargo[i];
      d.m.multiplyMatrices(Mc, _l.makeTranslation(x1 - row * 0.85, 0.03, col));
    }
  }
  // ---- the DUKWs afloat (and the ones going down) ----
  function dukws(t) {
    for (const u of WW.landingCraft.craft) {
      if (u.type !== 'dukw' || !u.alive || u.removed) continue;
      const g = WW.terrain.heightRaw(u.x, u.z), w = sea(u.x, u.z), sl = WW.waves && WW.waves.active ? WW.waves.slope(u.x, u.z, 0.6) : { x: 0, z: 0 };
      const y = Math.max(g, w - 0.11 - (u.flood || 0) * 0.16), c = Math.cos(u.heading), s = Math.sin(u.heading);
      const pitch = Math.atan(sl.x * c + sl.z * s) * 0.9, roll = -Math.atan(-sl.x * s + sl.z * c) * 0.9;
      put('dukw', u.x, y, u.z, u.heading, null, g > w - 0.1 ? 0 : pitch, g > w - 0.1 ? 0 : roll);
      const Mc = _w.copy(_m);
      if (u.cargo && u.cargo.length) putM('howitzer', Mc);
      if (u.ladder) {
        putM('ladderBase', Mc);
        // the ladder: stowed along the hull, or (Stivison's) run up toward the cliff, swaying through the seas
        const up = u.ladderUp && u.state === 'ladder', age = up ? WW.game.roundTime - u.stateT : 0, ext = up ? Math.min(4.2, 0.6 + age * 0.5) : 1.0;
        const yawTo = up ? Math.atan2(WW.normandyTerrain.bluffTopZ(u.x) - u.z, 0) - u.heading : Math.PI;
        const elev = up ? Math.min(1.05, age * 0.2) + Math.sin(t * 0.7) * 0.18 : 0.05, sway = up ? Math.sin(t * 0.45 + 1) * 0.22 : 0;
        _r.makeTranslation(-0.15, 0.32, 0).multiply(_l.makeRotationY(-yawTo + sway)).multiply(new THREE.Matrix4().makeRotationZ(elev)).multiply(new THREE.Matrix4().makeScale(ext, 1, 1));
        const Lm = new THREE.Matrix4().multiplyMatrices(Mc, _r); putM('ladder', Lm);
        if (up && ext > 2) {   // Stivison at the top with the Lewis guns
          const tip = new THREE.Vector3(1, 0.02, 0).applyMatrix4(Lm);
          put('gi:crouch', tip.x, tip.y, tip.z, Math.PI / 2);
          if (Math.random() < 0.15 && WW.fx && WW.fx.muzzleFlash) WW.fx.muzzleFlash(tip.x, tip.y + 0.25, tip.z + 0.2);
        }
      }
    }
    for (let i = sinking.length - 1; i >= 0; i--) {
      const s = sinking[i], age = WW.game.roundTime - s.t0;
      if (age > SINK_T || age < 0) { sinking.splice(i, 1); continue; }
      const y = sea(s.x, s.z) - 0.2 - age * age * 0.012;
      put('dukw', s.x, y, s.z, s.h, burnt, Math.min(0.45, age * 0.08), s.roll * age);
      if (s.gun) putM('howitzer', _m);
    }
  }
  // ---- the vehicles ashore ----
  function ashore(dts) {
    const rt = WW.game.roundTime;
    for (const v of WW.vehicles.all) {
      if (v.removed || v.state === 'off') continue;
      const dead = !v.alive, y = gy(v.x, v.z);
      const st = v._fx || (v._fx = { yaw: v.heading, smokeT: 0 });
      st.yaw += WW.clamp(WW.angleDiff ? WW.angleDiff(st.yaw, v.heading) : v.heading - st.yaw, -2 * dts, 2 * dts);
      vehicle(v.kind, v.x, y, v.z, st.yaw, dead && v.state === 'lost' ? burnt : null, 0, dead && v.state === 'drowned' ? 0.06 : 0);
      if (v.state === 'lost' && rt - v.stateT < HULK_SMOKE && WW.fx) {
        if (rt - v.stateT < 25 && WW.fx.fire) WW.fx.fire(v.x, y + 0.2, v.z);
        if (Math.random() < dts * 1.2 && WW.fx.smoke) WW.fx.smoke(v.x, y + 0.3, v.z, true, 0.5);
      }
      if (v.alive && v.working && Math.random() < dts * 2 && WW.fx && WW.fx.dirt) WW.fx.dirt(v.x + Math.cos(v.heading) * 0.5, y + 0.1, v.z + Math.sin(v.heading) * 0.5, 0.4, true);
    }
  }
  // ---- the gap lanes and the draws' blocks ----
  function lanes(t) {
    const E = WW.beachEng, T = WW.normandyTerrain; if (!E) return;
    for (const L of E.lanes) {
      if (!L.marked) continue;
      for (const sx of [-1, 1]) {
        const x = L.x + sx * (E.LANE_HW + 0.3), zb = T.shoreZ(x) - 31;
        put('buoy', x, sea(x, zb) - 0.04, zb, Math.PI / 2, null, Math.sin(t * 1.3 + sx) * 0.12, Math.cos(t * 1.1 + sx) * 0.12);
        for (const z of [T.shoreZ(x) + 2, T.shingleZ(x) - 0.9]) put(sx < 0 ? 'flagG' : 'flagR', x, gy(x, z), z, -Math.PI / 2 + (WW.wind ? Math.atan2(WW.wind.z, WW.wind.x) : 0));
      }
    }
    for (const b of E.blocks) {
      if (b.kind === 'wall') continue;
      const w = b.draw.w * 1.4, y = gy(b.x, b.z);
      if (b.kind === 'ditch') { _e.set(0, 0, 0); _q.setFromEuler(_e); _m.compose(_p.set(b.x, y - 0.02, b.z), _q, _s.set(w, 1, 1.6)); putM(b.state === 'open' ? 'fill' : 'ditch', _m); }
      if (b.kind === 'block' || b.id === 'D-3' || b.id === 'E-3') {
        if (b.state !== 'open') { _e.set(0, 0, 0); _q.setFromEuler(_e); _m.compose(_p.set(b.x, y, b.z + 1.4), _q, _s.set(w * 0.8, 1, 1)); putM('roadblock', _m); }
        else put('roadblock', b.x + w * 0.55, gy(b.x + w * 0.55, b.z + 1.4), b.z + 1.4, Math.PI / 2 + 0.2);   // pushed aside
      }
    }
    for (let i = blasts.length - 1; i >= 0; i--) {   // the charges going off along a lane, a moment apart
      const b = blasts[i]; if (WW.game.roundTime < b.t) continue; blasts.splice(i, 1);
      if (WW.fx && WW.fx.explosion) WW.fx.explosion(b.x, 0.3, b.z, 0.7);
      if (WW.fx && WW.fx.splash) WW.fx.splash(b.x, b.z, 1.4);
    }
  }
  // ---- the leaders, the prisoners ----
  function people(t) {
    if (WW.leaders) for (const L of WW.leaders.list) {
      if (!L.ashore) continue;
      const moving = L._px !== undefined && Math.abs(L._px - L.cx) > 1e-4; L._px = L.cx;
      put(moving ? (((t * 6) | 0) & 1 ? 'gi:runA' : 'gi:runB') : 'gi:stand', L.cx, gy(L.cx, L.z), L.z, moving ? 0 : -Math.PI / 2 + 0.4);
    }
    if (!WW.prisoners) return;
    const P = WW.prisoners;
    for (const r of P.recs) {
      if (r.state === 'march') {
        const step = ((t * 4) | 0) & 1;
        for (let i = 0; i < r.n; i++) { const p = P.pos(r, r.d - 0.45 - i * PRIS_GAP); put((i + step) & 1 ? 'pw:a' : 'pw:b', p.x, gy(p.x, p.z), p.z, p.h); }
        const a = P.pos(r, r.d), b = P.pos(r, r.d - 0.8 - r.n * PRIS_GAP);
        put(step ? 'gi:runA' : 'gi:runB', a.x, gy(a.x, a.z), a.z, a.h);
        put(step ? 'gi:runB' : 'gi:runA', b.x, gy(b.x, b.z), b.z, b.h);
      } else {
        const e = P.pos(r, r.len);
        for (let i = 0; i < r.n; i++) { const x = e.x + ((i % 4) - 1.5) * 0.3, z = e.z + ((i >> 2) - 0.5) * 0.3; put('pw:sit', x, gy(x, z), z, -Math.PI / 2 + ((i * 37) % 7) * 0.08); }
        put('gi:stand', e.x - 0.9, gy(e.x - 0.9, e.z), e.z - 0.4, 0.6); put('gi:stand', e.x + 0.9, gy(e.x + 0.9, e.z), e.z + 0.3, Math.PI - 0.5);
      }
    }
  }
  // the named LCIs burning
  function burning(dts) {
    if (!WW.fx) return;
    const rt = WW.game.roundTime;
    for (const u of WW.landingCraft.craft) {
      if (!u.burning) continue;
      if (!u.alive && u.state === 'wrecked' && WW.terrain.depthAt(u.x, u.z) > 2 && rt - u.stateT > 20) continue;   // LCI(L)-85 gone down
      const c = Math.cos(u.heading), s = Math.sin(u.heading), y = Math.max(sea(u.x, u.z), gy(u.x, u.z)) + 0.5;
      for (const k of [-0.15, 0.1]) if (WW.fx.fire) WW.fx.fire(u.x + c * u.C.len * k, y, u.z + s * u.C.len * k);
      if (Math.random() < dts * 2.5 && WW.fx.smoke) WW.fx.smoke(u.x, y + 0.4, u.z, true, 1.1);
    }
  }
  function update(rdt) {
    if (!on() || !WW.vehicles || !WW.landingCraft) { if (root) root.visible = false; nDeck = 0; return; }
    if (!built) init();
    root.visible = true;
    const t = performance.now() / 1000, rt = WW.game ? WW.game.roundTime : 0, dts = Math.max(0, Math.min(0.5, rt - lastRt)); lastRt = rt;
    for (const k in M) M[k].count = 0;
    for (let i = 0; i < nDeck; i++) { const d = deck[i]; if (d.k === 'tankdozer') { putM('sherman', d.m); putM('blade', d.m); } else if (d.k === 'dukw105') { putM('dukw', d.m); putM('howitzer', d.m); } else putM(d.k, d.m); }
    nDeck = 0;
    dukws(t); ashore(dts); lanes(t); people(t); burning(dts);
    for (const k in M) { M[k].instanceMatrix.needsUpdate = true; if (M[k].instanceColor) M[k].instanceColor.needsUpdate = true; }
  }
  WW.on('craftEvent', e => {
    if (!on() || !e || !e.craft) return;
    const u = e.craft;
    if (u.type === 'dukw' && e.kind === 'foundered') sinking.push({ x: u.x, z: u.z, h: u.heading, t0: WW.game.roundTime, gun: !!(u.cargoLost || (u.cargo && u.cargo.length)), roll: (Math.random() - 0.5) * 0.1 });
    if (e.kind === 'struck' && WW.fx && WW.fx.explosion) { WW.fx.explosion(u.x, 0.6, u.z, 1.4); if (WW.fx.splash) WW.fx.splash(u.x, u.z, 2); }
    if (e.kind === 'shellHit' && WW.fx && WW.fx.explosion) WW.fx.explosion(u.x + (Math.random() - 0.5) * u.C.len * 0.6, 0.8, u.z, 0.6);
  });
  WW.on('gapEvent', e => {
    if (!on() || !e || !e.lane || (e.kind !== 'blown' && e.kind !== 'premature')) return;
    const obs = (e.lane.obs || []).filter(o => !o.alive), now = WW.game.roundTime;
    obs.slice(0, 10).forEach((o, i) => blasts.push({ x: o.x, z: o.z, t: now + i * 0.15 }));
  });
  WW.on('roundStart', () => { sinking.length = 0; blasts.length = 0; lastRt = 0; nDeck = 0; });
  WW.vehicleFx = { update, onDeck };
})(window.WW);
