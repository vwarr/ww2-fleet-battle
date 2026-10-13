// camera_normandy_follow.js (camera): the user's follow controls for the land battle (Normandy only; camera_follow.js
// hands F / Tab / 8 / 9 and its label here when WW.camNormandy is on):
//   F           follow the best thing going on (the director's top land candidate: a craft running in, a ramp, a squad
//               under fire, an assault), as a heading-relative chase at the men's scale; F again hands back to the director
//   Tab         next / previous unit of interest (craft afloat, squads and tanks ashore, the most dramatic first)
//   8           next squad under MG fire;  9 next craft in trouble (a DD flooding, a craft just hit, men in the water)
// A followed squad that is wiped out hands the camera to the nearest squad of its unit (heir), as the free camera does.
// The label (bottom left): "Following LCVP · 116th RCT, A Co · Dog Green · 300 yd out".
// Visual only: Math.random / wall clock, never WW.rand; reads the sim. Load after camera_normandy.js.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const C = () => WW.camNormandy;
  const ok = o => o && !o.removed && o.alive;
  const battle = () => !!(WW.game && WW.game.state === 'battle');
  const wall = () => performance.now() / 1000;
  const sec = o => (WW.normandyData.SECTORS.find(s => s.id === o.sector) || {}).name || (o.sector === 'hoc' ? 'Pointe du Hoc' : '');
  const CRAFT_ST = { run: 'running in', beached: 'beached', ramp: 'ramp down', unload: 'unloading', off: 'backing off', wrecked: 'wrecked' };
  const SQ_ST = { swim: 'in the water', wade: 'wading in', cross: 'crossing the sand', shingle: 'at the shingle', shelf: 'across the shelf', climb: 'climbing the bluff',
    top: 'on the bluff top', assault: 'assaulting', hold: 'holding the plateau', rope: 'on the ropes', guns: 'looking for the guns', tank: 'on the beach' };
  const ORDER = { assault: 9, rope: 8.5, guns: 8, cross: 7.5, swim: 7.4, wade: 7, climb: 6.8, shingle: 6.5, tank: 6, shelf: 5.5, top: 5, hold: 4 };

  function name(o) {
    if (!o) return '';
    if (o.isCraft) return o.C.name + (o.unit ? ' · ' + o.unit : '');
    if (o.isSquad) return (o.kind === 'tank' ? 'Sherman · ' : o.kind === 'eng' ? 'Engineers · ' : '') + (o.unit || 'a squad');
    return o.name || '';
  }
  function status(o) {
    if (o.isCraft) {
      const s = WW.normandyTerrain.shoreZ(o.x) - o.z;
      return [sec(o), (CRAFT_ST[o.state] || o.state) + (o.state === 'run' && s > 2 ? ', ' + Math.round(s * 10.5 / 50) * 50 + ' yd out' : ''), o.type === 'dd' && o.flood > 0.3 ? 'shipping water' : ''].filter(Boolean).join(' · ');
    }
    if (o.isSquad) return [sec(o), o.kind === 'tank' ? (o.alive ? SQ_ST.tank : 'knocked out') : o.men + (o.men === 1 ? ' man' : ' men'), SQ_ST[o.state] || o.state, o.sup > 1 && o.kind !== 'tank' ? 'pinned' : ''].filter(Boolean).join(' · ');
    return '';
  }
  // the next of a wiped-out squad's unit (or its sector's) to follow
  function heir(q) {
    if (!q || !WW.infantry) return null;
    let b = null, bd = 1e9;
    for (const o of WW.infantry.squads) {
      if (!ok(o) || o === q) continue;
      const d = Math.hypot(o.x - q.x, o.z - q.z) + (o.unit === q.unit ? 0 : 40);
      if (d < 80 && d < bd) { bd = d; b = o; }
    }
    return b;
  }
  function following() {
    const fc = WW.freecam && WW.freecam.active() && WW.freecam.following();
    if (fc) return fc;
    const s = WW.cam._shot();
    return s && s.user && s.kind === 'nFollow' ? s.subj : null;
  }
  function film(o) {
    if (WW.cam.mode === 'map') WW.cam.toggle();
    if (WW.freecam && WW.freecam.release) WW.freecam.release();
    WW.cam.film(C().follow(o));
    return o;
  }
  // units of interest, the most dramatic first
  function units(which) {
    const L = [], now = wall();
    if (which === 'dogfight') {   // 8: squads under MG fire
      for (const q of WW.infantry ? WW.infantry.squads : []) if (ok(q) && C().underFire(q, now)) L.push({ o: q, s: q.men });
    } else if (which === 'danger') {   // 9: craft in trouble, men in the water
      for (const u of WW.landingCraft ? WW.landingCraft.live : []) if ((u.type === 'dd' && u.flood > 0.3) || WW.time.now - u.hitT < 8) L.push({ o: u, s: 10 + (u.flood || 0) });
      for (const q of WW.infantry ? WW.infantry.squads : []) if (ok(q) && q.state === 'swim') L.push({ o: q, s: q.men });
    } else {
      for (const u of WW.landingCraft ? WW.landingCraft.live : []) if (u.state !== 'off') { const s = WW.normandyTerrain.shoreZ(u.x) - u.z; L.push({ o: u, s: u.state === 'run' ? 7.2 - Math.min(3, s / 100) : 8 }); }
      for (const q of WW.infantry ? WW.infantry.squads : []) if (ok(q) && (q.men >= 3 || q.kind === 'tank')) L.push({ o: q, s: (ORDER[q.state] || 4) + q.men * 0.01 });
    }
    return L.sort((a, b) => b.s - a.s).map(e => e.o);
  }
  function f() {
    if (!battle()) return 'Follow: only during a battle';
    if (following()) { if (WW.freecam && WW.freecam.release) WW.freecam.release(); WW.cam.cut(); return 'Follow: off · director camera'; }
    let best = null;
    for (const c of WW.cam._candidates()) if (c.nd && c.subj && (c.subj.isCraft || c.subj.isSquad) && ok(c.subj) && (!best || c.pr > best.pr)) best = c;
    const o = best ? best.subj : units()[0];
    if (!o) return 'Follow: nothing ashore yet · the craft are on their way';
    film(o);
    return 'Follow: ' + name(o) + ' · ' + status(o);
  }
  function cycle(dir, which) {
    const L = units(which);
    if (!L.length) return which === 'dogfight' ? 'No squad under fire right now' : which === 'danger' ? 'No craft in trouble right now' : 'Nothing to follow yet';
    const cur = following();
    let i = L.indexOf(cur);
    i = i < 0 ? (dir > 0 ? 0 : L.length - 1) : (i + dir + L.length) % L.length;
    film(L[i]);
    return (i + 1) + '/' + L.length + ' · ' + name(L[i]) + ' · ' + status(L[i]);
  }
  function label() {
    const fc = WW.freecam && WW.freecam.active();
    const o = following();
    if (!o) return '';
    return 'Following ' + name(o) + '  ·  ' + status(o) + (fc ? '  ·  drag: orbit  ·  scroll: zoom' : '') + '  ·  F: director';
  }
  // the follow shot: a followed squad that is wiped out hands on to its unit; a followed craft that has gone, to the
  // squad nearest where it unloaded
  function retarget() {
    const s = WW.cam._shot && WW.cam._shot();
    if (!s || !s.user || s.kind !== 'nFollow' || !s.subj) return;
    const o = s.subj;
    if (o.isSquad && !o.alive) { const h = heir(o); if (h) { s.subj = h; s.hS = undefined; } }
    else if (o.isCraft && o.removed && o.state !== 'wrecked') { const h = heir(o); if (h) { s.subj = h; s.hS = undefined; s.back = 4; s.lat = 1.4; s.h = 1.1; } }
  }
  if (WW.cam && WW.cam.update) { const u = WW.cam.update; WW.cam.update = function (rdt) { try { if (C() && C().on()) retarget(); } catch (e) { /* never break the camera */ } return u.apply(this, arguments); }; }
  Object.assign(WW.camNormandy, { f, cycle, label, heir, name, status, following });
})(window.WW);
