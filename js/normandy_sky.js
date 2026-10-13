// normandy_sky.js - WW.normandySky: the weather of 6 June 1944 over Omaha that the sky dome alone does not give
// (visual only; Math.random; render mode). The overcast's colour and light are sky_time.js (scenario overcast); here:
//  - the broken low cloud deck (1,000-3,000 ft: y ~18-30 u on the game's altitude scale, low and grey, drifting
//    east-south-east on the WNW wind); the B-24s fly above it at ~6,000 m, as they did, bombing on instruments
//  - smoke from the grass fires the bombardment lit on the bluffs, drifting along the beach on the wind (it hid some
//    of the climbs on the day: Colonel Taylor's men went up through it near E-1 / E-3)
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const DECK = 70, SMOKE_EVERY = 0.35;
  let deck = null, smokeT = 0, sites = null;
  function build() {
    const geo = new THREE.SphereGeometry(1, 12, 8);
    const mat = new THREE.MeshLambertMaterial({ color: WW.pastel(0x9aa1a8, 0.05), emissive: WW.pastel(0x5a6068, 0.05), emissiveIntensity: 0.45, transparent: true, opacity: 0.86, fog: true });
    deck = new THREE.Group(); deck.name = 'cloudDeck';
    let seed = 6061944; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < DECK; i++) {
      const c = new THREE.Group(), n = 4 + Math.floor(r() * 5), s = 22 + r() * 30;
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(geo, mat), k2 = n > 1 ? k / (n - 1) - 0.5 : 0, rs = s * (0.6 + r() * 0.5) * (1 - Math.abs(k2) * 0.5);
        m.scale.set(rs * 1.4, rs * 0.32, rs); m.position.set(k2 * s * 2.6, (r() - 0.5) * 3, (r() - 0.5) * s * 0.8);
        c.add(m);
      }
      c.position.set(-900 + r() * 4200, 20 + r() * 12, -900 + r() * 2700);
      c.rotation.y = 0.39 + (r() - 0.5) * 0.4;
      deck.add(c);
    }
    WW.scene.add(deck);
  }
  // the burning bluff tops: points along the bluffs between the draws (smoke drifts east on the wind)
  function smokeSites() {
    const T = WW.normandyTerrain, out = [];
    for (let x = 1340; x < 2120; x += 26) out.push({ x, z: T.bluffTopZ(x) - 3, y: Math.max(0, WW.terrain.heightRaw(x, T.bluffTopZ(x) - 3)) });
    return out;
  }
  function update(rdt) {
    const on = !WW.simOnly && !!WW.scene && WW.isScn('normandy') && !!WW.normandyTerrain;
    if (on && !deck) build();
    if (deck) deck.visible = on && !(WW.cam && WW.cam.isOverview && WW.cam.isOverview());
    if (!on) return;
    const dt = Math.min(0.1, rdt || 0), w = WW.wind || { x: 0.8, z: 0.3 };
    for (const c of deck.children) { c.position.x += w.x * 4 * dt; c.position.z += w.z * 4 * dt; if (c.position.x > 3400) c.position.x -= 4300; if (c.position.z > 1900) c.position.z -= 2800; }
    // grass fires on the bluffs: lit by the bombardment, burning from the first shells to the end of the morning
    if (!WW.game || WW.game.state !== 'battle' || !WW.fx || !WW.fx.smoke) return;
    if (!sites) sites = smokeSites();
    smokeT -= dt;
    if (smokeT <= 0 && WW.game.roundTime > 20) {
      smokeT = SMOKE_EVERY;
      const s = sites[Math.floor(Math.random() * sites.length)];
      WW.fx.smoke(s.x + (Math.random() - 0.5) * 18, s.y + 1 + Math.random() * 2, s.z + (Math.random() - 0.5) * 10, true, 3 + Math.random() * 3);
    }
  }
  WW.on('roundStart', () => { sites = null; });
  WW.normandySky = { update };
})(window.WW);
