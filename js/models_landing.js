// models_landing.js - WW.landingFx: the landing craft on screen (visual only; Math.random). One InstancedMesh per part
// and craft type, re-posed each frame from WW.landingCraft.craft (main.js frame): LCVP / LCA / LCM (a box hull, a bow
// ramp that drops on the beach), LCT (long, low, its tanks on deck), LCI(L) (a small ship: hull, deckhouse, two bow
// ramps), the DD tank (a Sherman in its raised canvas screen). Wrecked craft settle, list and burn for a while.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const MAX = 160, SINK_T = 25;
  let parts = null, root = null;
  const soft = h => WW.pastel(h, 0.1);
  function init() {
    root = new THREE.Group(); root.name = 'landingCraft';
    const lam = c => new THREE.MeshLambertMaterial({ color: soft(c) });
    const M = { hull: lam(0x7b8794), ramp: lam(0x5f6a74), deck: lam(0x9aa3a8), house: lam(0x8c969e), tank: lam(0x6b7353), screen: lam(0xb5a888), burnt: lam(0x3f3c38) };
    const box = new THREE.BoxGeometry(1, 1, 1);
    const ring = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    const mk = (geo, mat) => { const im = new THREE.InstancedMesh(geo, mat, MAX); im.count = 0; im.castShadow = true; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(im); return im; };
    // per type: [geometry, material, local offset (x along the bow, y, z), scale (x len, y, z beam) as shares of the craft]
    parts = {
      hull: { im: mk(box, M.hull), list: [] }, ramp: { im: mk(box, M.ramp), list: [] }, house: { im: mk(box, M.house), list: [] },
      tank: { im: mk(box, M.tank), list: [] }, screen: { im: mk(ring, M.screen), list: [] }, burnt: { im: mk(box, M.burnt), list: [] }
    };
    WW.scene.add(root);
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _o = new THREE.Vector3();
  let n = {};
  function put(part, u, lx, ly, lz, sx, sy, sz, roll, pitch, y0) {
    const P = parts[part]; if (n[part] >= MAX) return;
    const h = u.heading, c = Math.cos(h), s = Math.sin(h);
    _e.set(roll || 0, -h, pitch || 0, 'YXZ'); _q.setFromEuler(_e);
    _o.set(lx, ly, lz).applyQuaternion(_q);
    P.im.setMatrixAt(n[part]++, _m.compose(_p.set(u.x + _o.x, (y0 || 0) + _o.y, u.z + _o.z), _q, _s.set(sx, sy, sz)));
  }
  function update() {
    if (WW.simOnly || !WW.landingCraft || !WW.isScn('normandy')) { if (root) root.visible = false; return; }
    if (!root) init();
    root.visible = true;
    n = { hull: 0, ramp: 0, house: 0, tank: 0, screen: 0, burnt: 0 };
    const now = WW.game ? WW.game.roundTime : 0;
    for (const u of WW.landingCraft.craft) {
      if (u.removed && u.state !== 'wrecked') continue;
      const C = u.C, L = C.len, B = C.beam, wreck = u.state === 'wrecked', age = wreck ? now - u.stateT : 0;
      if (wreck && age > SINK_T) continue;
      const y0 = wreck ? -Math.min(0.5, age * 0.03) : 0.05, roll = wreck ? Math.min(0.5, age * 0.04) : 0, pitch = wreck ? Math.min(0.25, age * 0.02) : 0;
      const body = wreck ? 'burnt' : 'hull';
      if (u.type === 'dd') {
        put(wreck ? 'burnt' : 'tank', u, 0, 0.15, 0, L, 0.22, B, roll, pitch, y0);
        if (!wreck && u.state === 'run') put('screen', u, 0, 0.3, 0, L * 0.6, 0.35, B * 0.9, 0, 0, y0);
        continue;
      }
      const H = u.type === 'lci' ? 0.45 : u.type === 'lct' ? 0.28 : 0.3;
      put(body, u, 0, H / 2, 0, L, H, B, roll, pitch, y0);
      if (u.type === 'lci') { put(wreck ? 'burnt' : 'house', u, -L * 0.15, H + 0.25, 0, L * 0.22, 0.5, B * 0.55, roll, pitch, y0); }
      else if (u.type === 'lct') { for (let k = 0; k < u.tanks; k++) put('tank', u, L * (0.25 - k * 0.22), H + 0.11, 0, 0.6, 0.22, 0.32, roll, pitch, y0); put('house', u, -L * 0.42, H + 0.2, 0, 0.35, 0.4, B * 0.8, roll, pitch, y0); }
      else put(wreck ? 'burnt' : 'house', u, -L * 0.38, H + 0.08, 0, L * 0.18, 0.16, B * 0.7, roll, pitch, y0);   // the coxswain's station aft
      // the bow ramp: up while running, down (flat on the sand) when beached
      const down = u.rampDown, rl = u.type === 'lci' ? 0.6 : B * 0.9;
      if (down) put('ramp', u, L / 2 + rl / 2, 0.05, 0, rl, 0.04, B * 0.85, roll, 0, y0);
      else put('ramp', u, L / 2, H * 0.55, 0, 0.05, H * 1.05, B * 0.95, roll, 0, y0);
      if (!wreck && u.state === 'run' && Math.random() < 0.08 && WW.fx && WW.fx.wake) WW.fx.wake(u.x - Math.cos(u.heading) * L * 0.5, u.z - Math.sin(u.heading) * L * 0.5, u.heading, 0.18);
      if (wreck && age < 12 && Math.random() < 0.05 && WW.fx && WW.fx.smoke) WW.fx.smoke(u.x, 0.6, u.z, true, 0.6);
    }
    for (const k in parts) { parts[k].im.count = n[k]; parts[k].im.instanceMatrix.needsUpdate = true; }
  }
  WW.on('craftEvent', e => { if (WW.simOnly || !WW.fx) return; const u = e.craft; if ((e.kind === 'mined' || e.kind === 'wrecked') && WW.fx.explosion) WW.fx.explosion(u.x, 0.6, u.z, e.kind === 'mined' ? 1.6 : 1.1); if (e.kind === 'mined' && WW.fx.splash) WW.fx.splash(u.x, u.z, 2.2); });
  WW.landingFx = { update };
})(window.WW);
