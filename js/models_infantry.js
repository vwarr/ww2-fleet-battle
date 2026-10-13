// models_infantry.js - WW.infantryFx: the men ashore on screen (visual only; Math.random). One InstancedMesh of up to
// MAX soldiers (a body and a helmet), posed each frame from the squads (infantry.js): a squad shows its men as figures
// in a loose file around its position (a fixed offset per man), upright and bobbing when it moves, flat when it is
// pinned or in cover at the shingle, bent forward on the bluff. The fallen (squadCasualty) stay where they fell as
// bodies, up to MAX_BODY. Tanks ashore are an olive hull and turret. Figures are ~2x true size, as the sailors.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const MAX = 3200, MAX_BODY = 1600, MAX_TANK = 64, H = 0.36;
  let root = null, body = null, helm = null, dead = null, tank = null, turret = null, bodies = [], bi = 0;
  const soft = h => WW.pastel(h, 0.1);
  function init() {
    root = new THREE.Group(); root.name = 'infantry';
    const lam = c => new THREE.MeshLambertMaterial({ color: soft(c) });
    const bg = new THREE.BoxGeometry(0.1, H * 0.8, 0.07); bg.translate(0, H * 0.4, 0);
    const hg = new THREE.SphereGeometry(0.06, 6, 4); hg.scale(1, 0.7, 1); hg.translate(0, H * 0.86, 0);
    const mk = (g, m, n) => { const im = new THREE.InstancedMesh(g, m, n); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(im); return im; };
    body = mk(bg, lam(0x6f7350), MAX); helm = mk(hg, lam(0x4f5a3a), MAX);
    const dg = new THREE.BoxGeometry(H * 0.8, 0.06, 0.1); dg.translate(0, 0.03, 0);
    dead = mk(dg, lam(0x5d6146), MAX_BODY);
    const tg = new THREE.BoxGeometry(0.8, 0.28, 0.42); tg.translate(0, 0.14, 0); tank = mk(tg, lam(0x5e6847), MAX_TANK);
    const rg = new THREE.BoxGeometry(0.38, 0.18, 0.3); rg.translate(0, 0.37, 0); turret = mk(rg, lam(0x545e40), MAX_TANK);
    WW.scene.add(root);
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  // a man's place in his squad: a fixed loose file across the squad's heading
  const OFF = []; for (let i = 0; i < 16; i++) OFF.push([((i * 37) % 9) / 9 * 2.4 - 1.2, ((i * 53) % 7) / 7 * 2 - 1]);
  const LOW = { wade: 0, swim: 0, cross: 0, shingle: 1, shelf: 0, climb: 0.5, top: 0, assault: 0.3, rope: 0, guns: 0, hold: 1 };
  function update() {
    if (WW.simOnly || !WW.infantry || !WW.isScn('normandy')) { if (root) root.visible = false; return; }
    if (!root) init();
    root.visible = true;
    const t = performance.now() / 1000;
    let n = 0, nt = 0;
    for (const q of WW.infantry.squads) {
      if (!q.alive) continue;
      if (q.kind === 'tank') {
        if (nt >= MAX_TANK) continue;
        _e.set(0, -q.heading, 0); _q.setFromEuler(_e); _p.set(q.x, q.y, q.z);
        tank.setMatrixAt(nt, _m.compose(_p, _q, _s)); turret.setMatrixAt(nt, _m.compose(_p, _q, _s)); nt++;
        continue;
      }
      const pinned = q.sup > WW.infantry.PIN, prone = pinned || (LOW[q.state] || 0) > 0.8, bend = LOW[q.state] || 0;
      const h = q.heading, c = Math.cos(h), s = Math.sin(h), moving = q.speed > 0.05;
      for (let i = 0; i < q.men && n < MAX; i++) {
        const o = OFF[i % OFF.length], lx = o[1] * 0.9 - (i >> 4) * 0.5, lz = o[0];
        const x = q.x + c * lx - s * lz, z = q.z + s * lx + c * lz;
        const y = Math.max(q.state === 'wade' || q.state === 'swim' ? -0.18 : 0, WW.terrain.heightRaw(x, z));
        const bob = moving && !prone ? Math.abs(Math.sin(t * 9 + i * 1.7)) * 0.04 : 0;
        _e.set(0, -h - Math.PI / 2, prone ? Math.PI / 2 : bend * 0.5, 'YXZ'); _q.setFromEuler(_e);
        _p.set(x, y + bob + (prone ? 0.04 : 0), z);
        _m.compose(_p, _q, _s);
        body.setMatrixAt(n, _m); helm.setMatrixAt(n, _m); n++;
      }
    }
    body.count = helm.count = n; tank.count = turret.count = nt;
    for (const im of [body, helm, tank, turret]) im.instanceMatrix.needsUpdate = true;
  }
  function fallen(e) {
    if (WW.simOnly || !root) return;
    for (let k = 0; k < e.n; k++) {
      const x = e.x + (Math.random() - 0.5) * 2.4, z = e.z + (Math.random() - 0.5) * 2;
      const y = Math.max(-0.1, WW.terrain.heightRaw(x, z));
      _e.set(0, Math.random() * 6.28, 0); _q.setFromEuler(_e);
      dead.setMatrixAt(bi, _m.compose(_p.set(x, y, z), _q, _s));
      bi = (bi + 1) % MAX_BODY; dead.count = Math.min(MAX_BODY, dead.count + 1);
    }
    dead.instanceMatrix.needsUpdate = true;
  }
  WW.on('squadCasualty', fallen);
  WW.on('roundStart', () => { bi = 0; if (dead) { dead.count = 0; } });
  WW.on('mortarBurst', e => { if (!WW.simOnly && WW.fx && WW.fx.explosion) WW.fx.explosion(e.x, 0.4, e.z, 0.7); });
  WW.infantryFx = { update };
})(window.WW);
