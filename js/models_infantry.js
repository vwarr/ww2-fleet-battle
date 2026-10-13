// models_infantry.js - WW.infantryFx: the men ashore on screen (visual only; Math.random). The figures are the GI of
// models_soldier.js (legs, boots, jacket and webbing, pack, arms and rifle, face, M1 helmet, life belt) and his gear
// variants, one InstancedMesh per pose and gear, re-posed each frame from the squads (infantry.js).
// A squad shows its men in the order the situation put them in (offsets eased from one formation to the next):
//   swim / wade / cross  an extended line, men well apart; pinned in the surf they get behind the obstacles (two or
//                        three to a stake, on its seaward side) or lie in the wash; in the water they stand on the
//                        bottom up to their chests, swim with their heads out where it is deeper, and rise and fall
//                        with the sea (waves.js)
//   shingle              a packed line lying or crouched against the shingle bank, facing the bluff
//   shelf / top / hold   loose order; climb: single file up the path through the minefields
//   assault              fire and movement: half the men down and firing, half running, changing every few seconds
// Each man has his part in the section (models_soldier.js GEAR): a bazooka team, the wire-cutters' Bangalores and
// satchel charges, a radio, now and then a flamethrower and a medic; engineer squads carry the demolitions.
// The fallen (infantry.js squadCasualty): about a third are dead where they fell (in the surf they wash about and drift
// in to the waterline); the rest are wounded, who crawl for the shingle and sit or lie there, a medic with some of them;
// the flood tide (tide.js) comes in about as fast as a wounded man crawls, and drowns the ones it catches.
// The men firing back show small muzzle flashes. Tanks ashore: the Sherman of models_tank.js (a DD with its screen
// folded down).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const MAX = 3200, MAX_G = 500, MAX_BODY = 1600, MAX_FLOAT = 300, MAX_WOUND = 900, MAX_TANK = 64, MAX_FLASH = 96, STRIDE = 7;
  const KILLED = 0.38, CRAWL_V = 0.05, DROWN_D = 0.14, FLOAT_V = 0.03, HEAD_OUT = 0.36, MEDIC_EVERY = 4;
  let root = null, mesh = null, dead = null, tank = null, screen = null, flash = null, bi = 0, obs = null;
  let wounded = [], floating = [], lastRt = 0;
  const vis = new WeakMap();
  function init() {
    root = new THREE.Group(); root.name = 'infantry';
    const G = WW.soldierModel.build(), grad = WW.models._grad ? WW.models._grad() : null;
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: grad });
    const mk = (g, n, m) => { const im = new THREE.InstancedMesh(g, m || mat, n); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(im); return im; };
    mesh = {};
    for (const p of ['runA', 'runB', 'stand', 'crouch', 'prone']) {
      mesh[p] = mk(G[p], MAX);
      for (const g of WW.soldierModel.GEAR) mesh[p + ':' + g] = mk(G[p + ':' + g], MAX_G);
    }
    mesh.sitting = mk(G.sitting, MAX_WOUND); mesh.fallen = mk(G.fallen, MAX_FLOAT + MAX_WOUND);
    dead = mk(G.fallen, MAX_BODY);
    tank = [mk(WW.tankModel.build().sherman, MAX_TANK)]; screen = mk(WW.tankModel.build().screen, MAX_TANK);   // the DDs' screens, folded
    flash = mk(new THREE.SphereGeometry(0.05, 6, 4), MAX_FLASH, new THREE.MeshBasicMaterial({ color: 0xffd890, fog: false })); flash.castShadow = false;
    _fold.makeTranslation(0, WW.tankModel.SCREEN_Y, 0).multiply(new THREE.Matrix4().makeScale(1, WW.tankModel.FOLDED, 1));
    WW.scene.add(root);
  }
  // the obstacles by 8 u bucket, for the men sheltering behind them
  function obstacleGrid() {
    obs = new Map();
    for (const o of WW.normandyTerrain.obstacles) { const k = Math.floor(o.x / 8); if (!obs.has(k)) obs.set(k, []); obs.get(k).push(o); }
  }
  function shelterNear(x, z, used) {
    let best = null, bd = 9;
    for (let k = Math.floor(x / 8) - 1; k <= Math.floor(x / 8) + 1; k++) for (const o of obs.get(k) || []) {
      if (!o.alive || (used.get(o) || 0) >= 3) continue;
      const d = (o.x - x) * (o.x - x) + (o.z - z) * (o.z - z); if (d < bd) { bd = d; best = o; }
    }
    if (best) used.set(best, (used.get(best) || 0) + 1);
    return best;
  }
  const _f = new THREE.Matrix4(), _fold = new THREE.Matrix4(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const OFF = []; for (let i = 0; i < 16; i++) OFF.push([((i * 37) % 9) / 9 * 2.4 - 1.2, ((i * 53) % 7) / 7 * 2 - 1, (i * 0.37) % 1]);
  const CROUCH = { climb: 1, rope: 1 }, PRONE = { shingle: 1, hold: 1 }, WATER = { wade: 1, swim: 1 };
  // the man's part in the section, by his place in it (the last men are the first lost: the roles thin out)
  function role(q, i) {
    if (q.kind === 'eng') return i % 3 === 0 ? 'eng' : i === 4 ? 'flame' : '';
    if (q.kind === 'ranger') return i === 3 ? 'radio' : i === 7 ? 'bazooka' : '';
    return i === 3 ? 'bazooka' : i === 6 ? 'eng' : i === 8 && q.id % 2 ? 'radio' : i === 10 && q.id % 3 === 0 ? 'flame' : i === 11 && q.id % 2 === 0 ? 'medic' : '';
  }
  // the sea surface over (x, z)
  function waterAt(x, z) { return WW.waves && WW.waves.active ? WW.waves.height(x, z) : 0; }
  // a squad's formation: target offsets (x, z, world axes) for its men
  function formation(q, st, n, used) {
    const out = st.tgt, pinned = q.sup > WW.infantry.PIN, h = q.heading, c = Math.cos(h), s = Math.sin(h), T = WW.normandyTerrain;
    for (let i = 0; i < n; i++) {
      const o = OFF[i % 16], j = i - (n - 1) / 2;
      let ox, oz;
      if (WATER[q.state] || q.state === 'cross') {
        ox = j * 0.8 + o[0] * 0.25; oz = o[1] * 0.45;
        if (pinned) { const b = shelterNear(q.x + ox, q.z + oz, used); if (b && Math.abs(b.x - q.x - ox) < 2.5) { ox = b.x - q.x + o[0] * 0.35; oz = b.z - q.z - 0.45 - o[2] * 0.3; } }
      } else if (q.state === 'shingle') {
        ox = j * 0.5 + o[0] * 0.1; oz = T.shingleZ(q.x + ox) + 1.1 - q.z - (i & 1) * 0.3;   // against the bank's seaward face
      } else if (q.state === 'climb') {
        const b = -i * 0.55, l = Math.sin(i * 1.7) * 0.25; ox = c * b - s * l; oz = s * b + c * l;
      } else if (q.state === 'assault') {
        ox = o[0] * 1.6 + j * 0.3; oz = o[1] * 1.4;
      } else { ox = o[0] * 1.2; oz = o[1] * 0.9 - (i >> 4) * 0.5; }
      out[i * 2] = ox; out[i * 2 + 1] = oz;
    }
  }
  function put(key, x, y, z, yaw) {
    const im = mesh[key] || mesh[key.split(':')[0]]; if (!im || im.count >= im.instanceMatrix.count) return;
    _e.set(0, yaw, 0); _q.setFromEuler(_e);
    im.setMatrixAt(im.count++, _m.compose(_p.set(x, y, z), _q, _s));
  }
  function update(rdt) {
    if (WW.simOnly || !WW.infantry || !WW.isScn('normandy') || !WW.scene) { if (root) root.visible = false; return; }
    if (!root) init();
    if (!obs) obstacleGrid();
    root.visible = true;
    const t = performance.now() / 1000, rt = WW.game ? WW.game.roundTime : 0, dts = Math.max(0, Math.min(0.5, rt - lastRt)); lastRt = rt;
    for (const k in mesh) mesh[k].count = 0;
    flash.count = 0;
    let nt = 0, ns = 0;
    const used = new Map();
    for (const q of WW.infantry.squads) {
      if (!q.alive) continue;
      if (q.kind === 'tank') {
        if (nt >= MAX_TANK) continue;
        _e.set(0, -q.heading, 0); _q.setFromEuler(_e); _m.compose(_p.set(q.x, WW.terrain.heightRaw(q.x, q.z), q.z), _q, _s);
        for (const im of tank) im.setMatrixAt(nt, _m);
        if (q.dd) { _f.copy(_m).multiply(_fold); screen.setMatrixAt(ns++, _f); }
        nt++; continue;
      }
      const n = Math.min(16, q.men), pinned = q.sup > WW.infantry.PIN;
      let st = vis.get(q);
      if (!st) { st = { off: new Float32Array(32), tgt: new Float32Array(32), fresh: true, ft: 0 }; vis.set(q, st); }
      st.ft -= dts;
      if (st.ft <= 0 || st.fresh || st.state !== q.state || st.pinned !== pinned) {   // re-plan about once a second
        formation(q, st, n, used); st.ft = 1; st.state = q.state; st.pinned = pinned;
        if (st.fresh) { st.off.set(st.tgt); st.fresh = false; }
      }
      const ease = Math.min(1, dts * 1.2);
      const moving = q.speed > 0.05 && !pinned, firing = !pinned && (q.state === 'shingle' || q.state === 'assault' || q.state === 'hold' || q.state === 'top');
      for (let i = 0; i < n; i++) {
        st.off[i * 2] += (st.tgt[i * 2] - st.off[i * 2]) * ease; st.off[i * 2 + 1] += (st.tgt[i * 2 + 1] - st.off[i * 2 + 1]) * ease;
        const o = OFF[i % 16], x = q.x + st.off[i * 2], z = q.z + st.off[i * 2 + 1];
        const g = WW.terrain.heightRaw(x, z), w = waterAt(x, z), wet = g < w - 0.02, deep = w - g > 0.25;
        const run = ((t * STRIDE + o[2] * 2) | 0) & 1 ? 'runA' : 'runB';
        let pose;
        if (q.state === 'assault') pose = ((i + Math.floor(rt / 3)) & 1) ? run : 'prone';
        else pose = pinned || PRONE[q.state] ? 'prone' : CROUCH[q.state] ? 'crouch' : moving ? run : 'stand';
        if (q.state === 'shingle' && i % 3 === 1) pose = 'crouch';
        if (wet && ((pose === 'prone' && deep) || q.state === 'swim')) pose = 'crouch';      // nobody lies down in deep water: heads out
        let y = wet ? Math.max(g, w - (pose === 'crouch' ? HEAD_OUT * 0.8 : HEAD_OUT)) : g;
        if (wet && pose === 'prone') y = Math.max(g, w - 0.04);                                // lying in the wash
        const yaw = q.state === 'shingle' || PRONE[q.state] ? -Math.PI / 2 + (o[2] - 0.5) * 0.4 : -q.heading + (pose === 'stand' ? (o[2] - 0.5) * 0.8 : 0);
        const r = role(q, i);
        put(r ? pose + ':' + r : pose, x, y, z, yaw);
        if (firing && r !== 'medic' && flash.count < MAX_FLASH && Math.random() < (rdt || 0.016) * 0.35) {
          _m.makeTranslation(x + Math.cos(yaw) * 0.2, y + (pose === 'prone' ? 0.06 : 0.3), z - Math.sin(yaw) * 0.2); flash.setMatrixAt(flash.count++, _m);
        }
      }
    }
    // the wounded and the dead in the water
    for (let i = wounded.length - 1; i >= 0; i--) {
      const u = wounded[i];
      if (u.state === 'crawl') {
        const zg = WW.normandyTerrain.shingleZ(u.x) + 0.9;
        if (u.z < zg) { u.z = Math.min(zg, u.z + u.v * dts); u.h = -Math.PI / 2; } else u.state = u.sit ? 'sit' : 'lie';
      }
      // the flood tide over a man who could not get clear of it (tide.js): he drowns where he lies
      if (WW.tide && WW.tide.depth(u.x, u.z) > DROWN_D) { wounded.splice(i, 1); if (floating.length < MAX_FLOAT) floating.push({ x: u.x, z: u.z, h: u.h }); else body(u.x, u.z, u.h); continue; }
      const g = WW.terrain.heightRaw(u.x, u.z), w = waterAt(u.x, u.z), y = g < w ? Math.max(g, w - 0.05) : g;
      put(u.state === 'sit' ? 'sitting' : u.state === 'lie' ? 'fallen' : 'prone', u.x, y, u.z, u.state === 'sit' ? Math.PI / 2 : u.h);   // sitting: back to the shingle, facing the sea
      if (u.medic && u.state !== 'crawl') put('crouch:medic', u.x + 0.18, y, u.z - 0.14, -Math.PI / 2 + 0.6);
    }
    for (let i = floating.length - 1; i >= 0; i--) {
      const b = floating[i], g = WW.terrain.heightRaw(b.x, b.z), w = waterAt(b.x, b.z);
      if (w - g < 0.05) { floating.splice(i, 1); body(b.x, b.z, b.h); continue; }   // washed up at the waterline
      b.z += FLOAT_V * dts; b.x += (WW.wind ? WW.wind.x : 0.5) * 0.01 * dts; b.h += (Math.random() - 0.5) * 0.02;
      put('fallen', b.x, w - 0.05, b.z, b.h);
    }
    for (const k in mesh) mesh[k].instanceMatrix.needsUpdate = true;
    for (const im of tank) { im.count = nt; im.instanceMatrix.needsUpdate = true; }
    screen.count = ns; screen.instanceMatrix.needsUpdate = true; flash.instanceMatrix.needsUpdate = true;
  }
  function body(x, z, h) {
    _e.set(0, h, 0); _q.setFromEuler(_e);
    dead.setMatrixAt(bi, _m.compose(_p.set(x, WW.terrain.heightRaw(x, z), z), _q, _s));
    bi = (bi + 1) % MAX_BODY; dead.count = Math.min(MAX_BODY, dead.count + 1);
    dead.instanceMatrix.needsUpdate = true;
  }
  let nWound = 0;
  function fallen(e) {
    if (WW.simOnly || !root || !WW.isScn('normandy')) return;
    const q = e.squad, inland = q && (q.state === 'climb' || q.state === 'top' || q.state === 'assault' || q.state === 'hold' || q.state === 'guns' || q.state === 'shelf');
    for (let k = 0; k < e.n; k++) {
      const x = e.x + (Math.random() - 0.5) * 2.4, z = e.z + (Math.random() - 0.5) * 2, h = Math.random() * 6.28;
      const wet = WW.terrain.heightRaw(x, z) < waterAt(x, z) - 0.1;
      if (e.why === 'drowned' || (wet && Math.random() < KILLED)) { if (floating.length < MAX_FLOAT) floating.push({ x, z, h }); else body(x, z, h); continue; }
      if (Math.random() < KILLED || wounded.length >= MAX_WOUND) { body(x, z, h); continue; }
      // the wounded: on the beach they drag themselves to the shingle; up the bluff they lie where they are
      wounded.push({ x, z, h, state: inland ? 'lie' : 'crawl', v: CRAWL_V * (0.3 + Math.random() * 0.9), sit: Math.random() < 0.5, medic: ++nWound % MEDIC_EVERY === 0 });
    }
  }
  WW.on('squadCasualty', fallen);
  WW.on('roundStart', () => { bi = 0; wounded = []; floating = []; nWound = 0; lastRt = 0; obs = null; if (dead) dead.count = 0; });
  WW.on('mortarBurst', e => { if (!WW.simOnly && WW.fx && WW.fx.explosion) WW.fx.explosion(e.x, 0.4, e.z, 0.7); });
  WW.infantryFx = { update, get wounded() { return wounded; }, get floating() { return floating; } };
})(window.WW);
