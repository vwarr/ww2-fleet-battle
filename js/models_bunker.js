// models_bunker.js - WW.bunkerModels: the German strongpoints on screen (visual only, render mode; Math.random).
// Built on 'defencesBuilt' (coast_defence.js): one small group per element in the toy style of the ships:
//  - casemate: a concrete block with a thick wall to the sea and its embrasure on the side it fires from, the gun
//    barrel poking out along the beach; observation bunker: a block with a slit to the sea
//  - gun pit / 155: a sandbag ring with a field gun; Tobruk: a ring with a small turret; MG nest: a sandbag horseshoe
//    with an MG; mortar: a round pit; flak: a ring with a 2 cm gun; anti-tank wall: a concrete slab across the draw
// Knocked out ('defenceEvent' out): blackened, the barrel drooped, smoke; hits: an explosion on the concrete; MG fire:
// short tracer streams toward what is in the cone (WW.fx tracer if any, else muzzle flashes).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  let root = null, M = null, G = null;
  const byEl = new Map();
  const soft = h => WW.pastel(h, 0.1);
  function shared() {
    if (M) return;
    const lam = c => new THREE.MeshLambertMaterial({ color: soft(c) });
    M = { concrete: lam(0xc9c4b6), concreteD: lam(0xa9a497), burnt: lam(0x55514b), sand: lam(0xc8b48a), gun: lam(0x59605a), slit: lam(0x2c2c2c), earth: lam(0x9a8a6a) };
    G = { box: new THREE.BoxGeometry(1, 1, 1), barrel: new THREE.CylinderGeometry(0.06, 0.08, 1, 6), ring: new THREE.TorusGeometry(1, 0.28, 5, 12), pit: new THREE.CylinderGeometry(1, 0.8, 0.3, 10) };
    G.barrel.rotateZ(Math.PI / 2); G.barrel.translate(0.5, 0, 0);
    G.ring.rotateX(Math.PI / 2);
  }
  const mesh = (g, m, p, s, ry) => { const o = new THREE.Mesh(g, m); o.position.set(p[0], p[1], p[2]); o.scale.set(s[0], s[1], s[2]); if (ry) o.rotation.y = ry; o.castShadow = true; o.receiveShadow = true; return o; };

  function build(e) {
    const g = new THREE.Group(), r = e.rad, h = e.K.top;
    g.position.set(e.x, e.y - 0.05, e.z);
    g.rotation.y = -e.heading;   // local +x: where it looks
    let barrel = null;
    if (e.type === 'casemate' || e.type === 'bunker') {
      // the block and its thick seaward wall
      g.add(mesh(G.box, M.concrete, [0, h / 2, 0], [r * 1.5, h, r * 1.3]));
      const sea = new THREE.Group(); sea.rotation.y = e.heading; // undo the group's yaw: the thick wall faces world north (the sea)
      sea.add(mesh(G.box, M.concreteD, [0, h * 0.6, -r * 0.75], [r * 1.7, h * 1.2, r * 0.45]));
      g.add(sea);
      g.add(mesh(G.box, M.slit, [r * 0.76, h * 0.55, 0], [0.05, h * 0.3, r * 0.6]));   // the embrasure
      if (e.K.gun) { barrel = mesh(G.barrel, M.gun, [r * 0.6, h * 0.55, 0], [r * 0.9, 1, 1]); g.add(barrel); }
    } else if (e.type === 'wall') {
      g.add(mesh(G.box, M.concrete, [0, h / 2, 0], [0.6, h, r * 2]));
    } else {
      const ringK = e.type === 'mg' ? 0.7 : e.type === 'mortar' ? 0.8 : 1;
      if (e.type === 'mortar') g.add(mesh(G.pit, M.earth, [0, 0.05, 0], [r * 0.7, 1, r * 0.7]));
      g.add(mesh(G.ring, M.sand, [0, 0.12, 0], [r * ringK, 0.6, r * ringK]));
      if (e.type === 'tobruk') g.add(mesh(G.box, M.concreteD, [0, 0.25, 0], [0.5, 0.25, 0.5]));
      const L = e.type === 'battery' ? 2.4 : e.type === 'gunpit' ? 1.3 : e.type === 'flak' ? 0.8 : e.type === 'tobruk' ? 0.7 : e.type === 'mg' ? 0.45 : 0.35;
      const y = e.type === 'mortar' ? 0.2 : 0.35;
      if (e.type === 'battery' || e.type === 'gunpit') g.add(mesh(G.box, M.gun, [-0.2, 0.3, 0], [0.7, 0.3, 0.5]));
      barrel = mesh(G.barrel, M.gun, [0, y, 0], [L, e.type === 'battery' ? 2.2 : 1, e.type === 'battery' ? 2.2 : 1]);
      if (e.type === 'mortar' || e.type === 'flak') barrel.rotation.z = e.type === 'mortar' ? 1.0 : 0.6;
      g.add(barrel);
    }
    g.userData = { barrel };
    root.add(g);
    byEl.set(e, g);
  }
  function knocked(e) {
    const g = byEl.get(e); if (!g) return;
    g.traverse(o => { if (o.isMesh) o.material = M.burnt; });
    const b = g.userData.barrel; if (b) { b.rotation.z = -0.35; }
    if (WW.fx && WW.fx.smoke) for (let k = 0; k < 4; k++) WW.fx.smoke(e.x + (Math.random() - 0.5) * 2, e.y + 1 + k * 0.8, e.z + (Math.random() - 0.5) * 2, true, 1.2 + k * 0.3);
  }
  function clear() { if (root && WW.scene) WW.scene.remove(root); root = null; byEl.clear(); }
  WW.on('defencesBuilt', d => {
    if (WW.simOnly || !WW.scene) return;
    shared(); clear();
    root = new THREE.Group(); root.name = 'bunkers';
    d.elements.forEach(e => { if (!e.dormant || e.type === 'battery') build(e); });
    WW.scene.add(root);
  });
  WW.on('roundStart', () => { if (!WW.isScn('normandy')) clear(); });
  WW.on('setupStart', () => { if (!WW.isScn('normandy')) clear(); });
  WW.on('defenceEvent', ev => { if (ev.kind === 'out' && ev.el && !WW.simOnly) knocked(ev.el); });
  WW.on('defenceHit', ev => {
    if (WW.simOnly || !WW.fx) return;
    const e = ev.el, big = ev.cal === 'big' || ev.kind === 'bomb';
    if (WW.fx.explosion) WW.fx.explosion(ev.x, e.y + 0.8, ev.z, big ? 2.2 : ev.cal === 'med' ? 1.3 : 0.8);
    if (!ev.through && WW.fx.sparks) WW.fx.sparks(ev.x, e.y + 0.8, ev.z);   // the shell bursts on the concrete
  });
  WW.on('defenceFire', ev => {
    if (WW.simOnly || !WW.fx || !ev.el) return;
    const e = ev.el, g = byEl.get(e), b = g && g.userData.barrel;
    if (b && ev.target) { b.parent.updateMatrixWorld(); b.rotation.y = 0; }
    if (ev.kind !== 'gun' && WW.fx.muzzleFlash) WW.fx.muzzleFlash(e.x, e.y + 0.4, e.z);
  });
  WW.bunkerModels = { get root() { return root; }, groupOf: e => byEl.get(e) };
})(window.WW);
