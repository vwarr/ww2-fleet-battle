// ship_swell.js - WW.shipSwell: the warships ride the Channel swell (Normandy; visual only). The sim keeps its ships on
// a flat sea (ships.js syncGroup: x, z, heading and a small bob); here, each frame after the sim, a ship's group is lifted
// to the sea surface under it (waves.js, the tide included) and pitched and rolled by the surface's heights at its bow
// and stern and at its two sides (so a long hull rides through the short chop and pitches to the long swell, and a
// destroyer is thrown about more than Texas). Like damage_visuals.js's pose: pose() after the sim's advance, unpose()
// before the next one restores exactly what the sim set, so nothing the sim reads ever sees the swell.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const K_PITCH = 0.9, K_ROLL = 1.1;
  const posed = new Map();
  const _q = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _e = new THREE.Euler(), _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1);
  function pose() {
    if (WW.simOnly || !WW.isScn('normandy') || !WW.waves || !WW.waves.active) return;
    const W = WW.waves;
    for (const s of WW.world.ships) {
      const g = s.group;
      if (!g || !s.alive || s.sinking || s.type === 'submarine') continue;
      const h = s.heading, c = Math.cos(h), sn = Math.sin(h), L = (s.stats && s.stats.length) || 10, B = (s.stats && s.stats.beam) || L * 0.12;
      const a = L * 0.42, b = Math.max(0.5, B * 0.5);
      const hb = W.height(s.x + c * a, s.z + sn * a), hs = W.height(s.x - c * a, s.z - sn * a);                 // bow, stern
      const hS = W.height(s.x - sn * b, s.z + c * b), hP = W.height(s.x + sn * b, s.z - c * b);                 // starboard, port
      const hc = W.height(s.x, s.z), heave = (hb + hs + hS + hP + 2 * hc) / 6;
      const pitch = Math.atan2(hb - hs, 2 * a) * K_PITCH, roll = -Math.atan2(hS - hP, 2 * b) * K_ROLL;
      const P = { y0: g.position.y, x0: g.rotation.x, ry0: g.rotation.y, z0: g.rotation.z };
      // the sim's attitude, then the sea's pitch (about the hull's beam axis) and roll (about its keel)
      _q.setFromEuler(g.rotation).multiply(_qp.setFromAxisAngle(_Z, pitch)).multiply(_qr.setFromAxisAngle(_X, roll));
      _e.setFromQuaternion(_q, g.rotation.order);
      g.position.y += heave; g.rotation.set(_e.x, _e.y, _e.z);
      P.y1 = g.position.y; P.x1 = g.rotation.x; P.ry1 = g.rotation.y; P.z1 = g.rotation.z;
      posed.set(g, P);
    }
  }
  function unpose() {
    for (const [g, P] of posed) {
      // untouched by the sim since: give it back exactly what the sim left
      if (g.position.y === P.y1 && g.rotation.x === P.x1 && g.rotation.y === P.ry1 && g.rotation.z === P.z1) { g.position.y = P.y0; g.rotation.set(P.x0, P.ry0, P.z0); }
    }
    posed.clear();
  }
  WW.shipSwell = { pose, unpose };
})(window.WW);
