// models_infantry.js - WW.infantryFx: the men ashore on screen (visual only; Math.random). The figures are the GI of
// models_soldier.js (legs, boots, jacket and webbing, pack, arms and rifle, face, M1 helmet), one InstancedMesh per pose,
// re-posed each frame from the squads (infantry.js): a squad shows its men in a loose file around its position (a
// fixed offset per man); moving men run (the stride's two frames alternate, each man in his own phase), pinned men
// and men at the shingle lie prone, men on the bluff or closing on a position crouch, the rest stand. The fallen
// (squadCasualty) stay where they fell, up to MAX_BODY. Tanks ashore: the Sherman of models_tank.js (a DD with its
// screen folded down).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const MAX = 3200, MAX_BODY = 1600, MAX_TANK = 64, STRIDE = 7;
  let root = null, mesh = null, dead = null, tank = null, screen = null, bi = 0;
  function init() {
    root = new THREE.Group(); root.name = 'infantry';
    const G = WW.soldierModel.build(), grad = WW.models._grad ? WW.models._grad() : null;
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: grad });
    const mk = (g, n, m) => { const im = new THREE.InstancedMesh(g, m || mat, n); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(im); return im; };
    mesh = {}; for (const p of ['runA', 'runB', 'stand', 'crouch', 'prone']) mesh[p] = mk(G[p], MAX);
    dead = mk(G.fallen, MAX_BODY);
    // the Sherman (models_tank.js)
    tank = [mk(WW.tankModel.build().sherman, MAX_TANK)]; screen = mk(WW.tankModel.build().screen, MAX_TANK);   // the DDs' screens, folded
    _fold.makeTranslation(0, WW.tankModel.SCREEN_Y, 0).multiply(new THREE.Matrix4().makeScale(1, WW.tankModel.FOLDED, 1));
    WW.scene.add(root);
  }
  const _f = new THREE.Matrix4(), _fold = new THREE.Matrix4(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
  const OFF = []; for (let i = 0; i < 16; i++) OFF.push([((i * 37) % 9) / 9 * 2.4 - 1.2, ((i * 53) % 7) / 7 * 2 - 1, (i * 0.37) % 1]);
  const CROUCH = { climb: 1, assault: 1, rope: 1 }, PRONE = { shingle: 1, hold: 1 };
  function update() {
    if (WW.simOnly || !WW.infantry || !WW.isScn('normandy')) { if (root) root.visible = false; return; }
    if (!root) init();
    root.visible = true;
    const t = performance.now() / 1000, n = { runA: 0, runB: 0, stand: 0, crouch: 0, prone: 0 };
    let nt = 0, ns = 0;
    for (const q of WW.infantry.squads) {
      if (!q.alive) continue;
      if (q.kind === 'tank') {
        if (nt >= MAX_TANK) continue;
        _e.set(0, -q.heading, 0); _q.setFromEuler(_e); _m.compose(_p.set(q.x, WW.terrain.heightRaw(q.x, q.z), q.z), _q, _s);
        for (const im of tank) im.setMatrixAt(nt, _m);
        if (q.dd) { _f.copy(_m).multiply(_fold); screen.setMatrixAt(ns++, _f); }
        nt++; continue;
      }
      const pinned = q.sup > WW.infantry.PIN, moving = q.speed > 0.05 && !pinned;
      const h = q.heading, c = Math.cos(h), s = Math.sin(h), water = q.state === 'wade' || q.state === 'swim';
      for (let i = 0; i < q.men; i++) {
        const o = OFF[i % OFF.length], lx = o[1] * 0.9 - (i >> 4) * 0.5, lz = o[0];
        const x = q.x + c * lx - s * lz, z = q.z + s * lx + c * lz;
        let pose = pinned || PRONE[q.state] ? 'prone' : CROUCH[q.state] ? 'crouch' : moving ? (((t * STRIDE + o[2] * 2) | 0) & 1 ? 'runA' : 'runB') : 'stand';
        if (water && pose === 'prone') pose = 'crouch';   // nobody lies down in the surf
        if (n[pose] >= MAX) continue;
        const y = Math.max(water ? -0.16 : 0, WW.terrain.heightRaw(x, z));
        _e.set(0, -h + (pose === 'stand' ? (o[2] - 0.5) * 0.8 : 0), 0); _q.setFromEuler(_e);
        mesh[pose].setMatrixAt(n[pose]++, _m.compose(_p.set(x, y, z), _q, _s));
      }
    }
    for (const k in n) { mesh[k].count = n[k]; mesh[k].instanceMatrix.needsUpdate = true; }
    for (const im of tank) { im.count = nt; im.instanceMatrix.needsUpdate = true; }
    screen.count = ns; screen.instanceMatrix.needsUpdate = true;
  }
  function fallen(e) {
    if (WW.simOnly || !root) return;
    for (let k = 0; k < e.n; k++) {
      const x = e.x + (Math.random() - 0.5) * 2.4, z = e.z + (Math.random() - 0.5) * 2;
      const y = Math.max(-0.12, WW.terrain.heightRaw(x, z));
      _e.set(0, Math.random() * 6.28, 0); _q.setFromEuler(_e);
      dead.setMatrixAt(bi, _m.compose(_p.set(x, y, z), _q, _s));
      bi = (bi + 1) % MAX_BODY; dead.count = Math.min(MAX_BODY, dead.count + 1);
    }
    dead.instanceMatrix.needsUpdate = true;
  }
  WW.on('squadCasualty', fallen);
  WW.on('roundStart', () => { bi = 0; if (dead) dead.count = 0; });
  WW.on('mortarBurst', e => { if (!WW.simOnly && WW.fx && WW.fx.explosion) WW.fx.explosion(e.x, 0.4, e.z, 0.7); });
  WW.infantryFx = { update };
})(window.WW);
