// air_offmap_fx.js - WW.offmapAirFx: the Normandy planes on screen (visual only; Math.random). One model per live plane
// of WW.offmapAir (pooled by type), from the existing plane kit (models_planes.js / models_landplanes.js): the B-24 is
// drawn with the four-engine B-17 model, the P-47 and the Spitfire with the USN fighter, the Fw 190 with the German
// palette. A plane shot down falls trailing smoke for a few seconds. main.js frame calls update.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const KIND = { b24: ['b17', 'USN'], p47: ['fighter', 'USN'], spit: ['fighter', 'RN'], fw190: ['fighter', 'GER'] };
  const pool = {}, used = new Map(), falls = new Map();
  const PS = WW.cfg.PLANE_SCALE || 0.82;
  function model(kind) {
    const L = pool[kind] || (pool[kind] = []);
    if (L.length) return L.pop();
    let m;
    try { m = WW.models.buildPlane(KIND[kind][0], KIND[kind][1]); } catch (e) { m = WW.models.buildPlane(KIND[kind][0], 'USN'); }
    m.group.rotation.order = 'YZX'; m.group.scale.setScalar(PS * (kind === 'b24' ? 1.05 : 1));
    if (m.payload) m.payload.visible = kind !== 'spit';
    return m;
  }
  function update(rdt) {
    if (WW.simOnly || !WW.offmapAir || !WW.isScn('normandy')) { for (const [p, m] of used) { WW.scene.remove(m.group); (pool[p.kind] = pool[p.kind] || []).push(m); } used.clear(); return; }
    const seen = new Set();
    for (const p of WW.offmapAir.planes) {
      let m = used.get(p);
      const falling = !p.alive && p.down;
      if (!p.alive && !falling) continue;
      if (falling) { const f = falls.get(p) || { t: 0, roll: (Math.random() - 0.5) * 6 }; f.t += rdt; falls.set(p, f); if (f.t > 6) continue; p.y = Math.max(0, p.y - 16 * rdt); p.x += Math.cos(p.heading) * p.speed * 0.5 * rdt; p.z += Math.sin(p.heading) * p.speed * 0.5 * rdt; if (Math.random() < 0.5 && WW.fx && WW.fx.smoke) WW.fx.smoke(p.x, p.y, p.z, true, 0.8); }
      if (!m) { m = model(p.kind); used.set(p, m); WW.scene.add(m.group); }
      seen.add(p);
      const g = m.group;
      g.position.set(p.x, p.y, p.z);
      g.rotation.y = -p.heading;
      g.rotation.z = falling ? -0.6 : p.state === 'dive' ? -0.45 : 0;
      g.rotation.x = falling ? falls.get(p).t * falls.get(p).roll : p.kind === 'spit' ? 0.35 * (p.orbit ? p.orbit.dir : 1) : 0;
      if (m.prop) m.prop.rotation.x += rdt * 40;
      if (m.payload && (p.bombs === 0)) m.payload.visible = false;
    }
    for (const [p, m] of used) if (!seen.has(p)) { WW.scene.remove(m.group); used.delete(p); falls.delete(p); (pool[p.kind] = pool[p.kind] || []).push(m); }
  }
  WW.offmapAirFx = { update };
})(window.WW);
