// base_fx.js - WW.baseFx: the island base on screen (visual only: Math.random, never WW.rand; off in sim-only mode).
//  - Builds the airfield models (models_base.js) whenever a base is built (round start, the setup screen).
//  - Craters on the runways (a pooled disc each, from base.craters; repaired ones disappear), knocked-out facilities
//    scorched and slumped, burning hangars and fuel tanks (big fires, dark smoke columns that drift downwind for a few
//    minutes), guns that train on their targets, the owner's flag in the wind. The ground life (parked planes in
//    their revetments, crews, trucks, warm-ups, wrecks, repair gangs) is base_ground_fx.js, driven from here.
//  - Captions for the base events ('baseEvent', island_base.js / land_air.js): "Midway under air attack",
//    "Runway cratered", "Scramble!", "Runway repaired: launches resume", "Planes caught on the ground", ... (at most one every 12 s,
//    never over another caption), and director camera candidates (WW.camHooks): a raid on the island, a burning base,
//    a land bomber taking off.
window.WW = window.WW || {};
(function () {
  'use strict';
  const R = Math.random, rr = (a, b) => a + (b - a) * R();
  let M = null, built = null, craterGeo = null, craterPool = [], lastT = 0, capT = -1e9, capQ = null;
  const fires = new Map(); // facility -> { t0, k }

  function craterMesh() {
    if (!craterGeo) {
      const g = new THREE.Group(), m = WW.models;
      m._disc(g, 0xa89a78, 1.25, 0.05, 0, 0, 0); m._disc(g, 0x4e443b, 0.92, 0.09, 0, 0, 0); m._disc(g, 0x3a332d, 0.55, 0.11, 0, 0, 0);
      g.updateMatrixWorld(true);
      const parts = []; g.traverse(o => { if (o.isMesh) { const q = o.geometry.clone(); q.applyMatrix4(o.matrixWorld); const c = q.attributes.color, mc = o.material.color; for (let i = 0; i < c.count; i++) c.setXYZ(i, mc.r, mc.g, mc.b); parts.push(q); } });
      craterGeo = merge(parts);
    }
    const o = new THREE.Mesh(craterGeo, WW.models._mat(0xffffff)); o.receiveShadow = true; return o;
  }
  function merge(list) { // a few small indexed geometries -> one (position, normal, color)
    let n = 0; list.forEach(g => { n += (g.index ? g.index.count : g.attributes.position.count); });
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), C = new Float32Array(n * 3); let k = 0;
    list.forEach(g => { const s = g.index ? g.toNonIndexed() : g; for (let i = 0; i < s.attributes.position.count; i++, k++) {
      P.set([s.attributes.position.getX(i), s.attributes.position.getY(i), s.attributes.position.getZ(i)], k * 3);
      N.set([s.attributes.normal.getX(i), s.attributes.normal.getY(i), s.attributes.normal.getZ(i)], k * 3);
      C.set([s.attributes.color.getX(i), s.attributes.color.getY(i), s.attributes.color.getZ(i)], k * 3); } });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    return g;
  }

  function clear() {
    if (built) { WW.scene.remove(built.group); built.strips.geometry.dispose(); built = null; }
    for (const c of craterPool) c.visible = false;
    if (WW.baseGroundFx) WW.baseGroundFx.clear();
    fires.clear();
  }
  function onBuilt(e) {
    if (WW.simOnly || !WW.scene || !WW.baseModels) return;
    clear();
    if (!e || !e.base) return; // no base (the Base button's 'none'): the old airfield goes
    built = WW.baseModels.build(e.base); built.base = e.base;
    if (WW.baseLifeModels) { // the camp (base.decor): huts, tents, the mess, pits, trenches, masts, ... and the lit windows
      const life = WW.baseLifeModels.build(e.base, built.strips.material);
      for (const part of life.parts) { for (const o of [part.mesh, part.gun, part.head, part.flag]) if (o) built.group.add(o); built.parts.push(part); }
      if (life.glow) built.group.add(built.glow = life.glow);
    }
    WW.scene.add(built.group);
    lastT = WW.time.now;
  }

  // ---------- per frame ----------
  function update(rdt) {
    const b = WW.islandBase && WW.islandBase.base;
    if (!built || !b || built.base !== undefined && built.base !== b) return;
    const now = WW.time.now, sdt = Math.max(0, Math.min(0.5, now - lastT)); lastT = now;
    // craters
    let ci = 0;
    for (const c of b.craters) {
      let m = craterPool[ci];
      if (!m) { m = craterPool[ci] = craterMesh(); WW.scene.add(m); }
      const s = c.r * 1.35 * (0.55 + 0.45 * Math.min(1, c.w / 0.8)); // a crater shrinks as the crews fill it
      m.position.set(c.x, b.site.padH + 0.02 + ci * 0.0004, c.z); m.scale.set(s, 1, s); m.visible = true; ci++;
    }
    for (; ci < craterPool.length; ci++) craterPool[ci].visible = false;
    // facilities: wrecks, fires, guns
    for (const part of built.parts) {
      const f = part.f;
      if (f.out && !part.wrecked) { if (part.decor) WW.baseLifeModels.wreck(part, WW.baseModels._tpl().scorch); else WW.baseModels.wreck(part); fires.set(f, { t0: now }); }
      if (part.gun && !f.out && !part.decor) {   // (the camp's machine guns and searchlights: base_life.js)
        let want = null;
        if (f.kind === 'battery') want = f.aim;
        else { // AA: the nearest enemy plane in reach
          let bd = 60 * 60;
          for (const p of WW.world.planes) if (p.alive && p.nation !== b.nation) { const d = WW.dist2(p.x, p.z, f.x, f.z); if (d < bd) { bd = d; want = Math.atan2(p.z - f.z, p.x - f.x); } }
        }
        if (want !== null && want !== undefined) part.gun.rotation.y += WW.angleDiff(part.gun.rotation.y, -want) * Math.min(1, rdt * 2.5);
      }
      if (part.flag && WW.wind) part.flag.rotation.y = -WW.wind.a + Math.sin(performance.now() / 700) * 0.15;
    }
    if (sdt > 0) burn(sdt, now);
    if (WW.baseGroundFx) WW.baseGroundFx.update(rdt, b);
    if (WW.baseLife) WW.baseLife.update(rdt, b, built);   // the camp's people and trucks (after the ground crews: one trace)
    if (WW.baseLifeFx) WW.baseLifeFx.update(rdt, b, built); // the gooney birds, the blackout and the searchlights
  }
  function burn(dt, now) {
    const ld = WW.damage ? WW.damage.load() : 0;
    fires.forEach((st, f) => {
      const age = now - st.t0, big = f.kind === 'fuel' || f.kind === 'hangar', mid = f.decor && (f.kind === 'mess' || f.kind === 'hut' || f.kind === 'sick' || f.kind === 'drums' || f.kind === 'truck' || f.kind === 'radio'), life = big ? 180 : mid ? 150 : 60;
      if (age > life) return;
      const k = (1 - age / life) * (ld > 0.9 ? 0.4 : 1), y = Math.max(WW.terrain.PAD_H, -WW.terrain.depthAt(f.x, f.z));
      if (f.kind === 'trench' || f.kind === 'drill') return;
      const rate = (f.kind === 'fuel' ? 9 : f.kind === 'hangar' ? 7 : mid ? 4 : 2.5) * k;
      for (let n = 0; n < 3; n++) if (R() < rate * dt) WW.fx.fire(f.x + rr(-f.r, f.r) * 0.7, y + rr(0.5, 2.5), f.z + rr(-f.r, f.r) * 0.7);
      for (let n = 0; n < 2; n++) if (R() < (big ? 2.4 : mid ? 1.4 : 0.8) * k * dt) WW.fx.smoke(f.x + rr(-1.5, 1.5), y + (big ? rr(3, 9) : 2.5), f.z + rr(-1.5, 1.5), true, big ? rr(3, 4.6) : 1.6); // the smoke column
      if (WW.damage) WW.damage.want(big ? 2.6 * k : 0.9 * k);
    });
  }
  // ---------- captions ----------
  const CV = { carrier: 'carrier', battleship: 'battleship', cruiser: 'cruiser', destroyer: 'destroyer', submarine: 'submarine', pt: 'PT boat' };
  function line(e) {
    const b = e.base, n = b.name, usn = b.nation === 'USN';
    switch (e.kind) {
      case 'alarm': { // the first sighting: the "oh no" moment (priority 2: never throttled)
        const a = e.alarm, b3 = String(a.bearing).padStart(3, '0');
        if (a.kind === 'raid') return [n + ': air raid!', 'Enemy planes bearing ' + b3 + (usn ? ', the siren wails: man the guns' : ', the alarm sounds: man the guns'), 2];
        if (a.kind === 'planes') return [n + ': enemy planes!', 'Bearing ' + b3 + ', closing', 2];
        if (a.kind === 'ship') return [n + ': enemy warships!', 'Enemy ' + (CV[a.what] || 'ships') + ' sighted bearing ' + b3 + ': general quarters', 2];
        return [n + (a.kind === 'bombed' ? ': bombs falling!' : ': under fire!'), a.kind === 'bombed' ? 'The raid came in unseen: take cover' : 'Shells from the sea: take cover', 2];
      }
      case 'airRaid': return [n + ' under air attack', usn ? 'Marine fighters scramble' : 'The Zeros scramble', 1];
      case 'runwayClosed': return ['Runway cratered', n + ': nothing can take off', 1];
      case 'runwayOpen': return ['Runway repaired: launches resume', usn ? 'The Seabees filled the craters' : 'Work crews filled the craters', 1];
      case 'scramble': return ['Scramble!', usn ? 'Wildcats roll for the runway' : 'Zeros roll for the runway', 1];
      case 'planesHit': return [e.n > 1 ? e.n + ' planes caught on the ground' : 'A plane caught on the ground', n, 0];
      case 'divert': return ['Field closed', 'Carrier planes divert to the fleet; the bombers must ditch', 1];
      case 'crashLanding': return ['Crash landing', 'The crash truck races out', 0];
      case 'battery': return ['Coastal battery silenced', n, 0];
      case 'hangar': return ['Hangar ablaze', n, 0];
      case 'fuel': return ['Fuel farm burning', n, 0];
      case 'strikeOut': return ['Strike from the island inbound', n + ' launches against a ' + (CV[e.target && e.target.type] || 'ship'), 1];
      case 'bombard': return [(e.by && e.by.type === 'battleship' ? 'Battleships' : 'Cruisers') + ' shelling ' + n, 'The coastal guns answer', 0];
      case 'neutralized': return [n + ' neutralized', 'Runways closed, the guns silent', 2];
      default: return null;
    }
  }
  const diaryT = {};
  function diary(e, L) { // the war diary (war_diary.js): one entry per kind of base event, at most every 45 s of sim time
    if (!WW.diary || !WW.diary.add) return;
    const now = WW.time.now;
    if (L[2] < 2 && now - (diaryT[e.kind] || -1e9) < 45) return;
    diaryT[e.kind] = now;
    WW.diary.add(L[0] + (L[1] ? ': ' + L[1] : ''), L[2] >= 2 ? 3 : L[2] ? 2 : 1, e.base.nation, { kind: 'base' });
  }
  function caption(e) {
    if (WW.simOnly || !e || !e.base) return;
    const L = line(e); if (!L) return;
    diary(e, L);
    if (!WW.ui || !WW.ui.caption) return;
    const t = performance.now() / 1000;
    if ((L[2] < 2 && t - capT < 12) || (WW.ui.captionOn && WW.ui.captionOn() && L[2] < 2)) { if (L[2] >= 1) capQ = { e, t }; return; }
    capT = t; WW.ui.caption(L[0], L[1], 4.5, true);
  }
  function retry() { if (capQ && performance.now() / 1000 - capQ.t < 10 && performance.now() / 1000 - capT > 12) { const e = capQ.e; capQ = null; caption(e); } }

  // ---------- camera candidates ----------
  (WW.camHooks = WW.camHooks || []).push((add, dur) => {
    const b = WW.islandBase && WW.islandBase.base; if (!b) return;
    let raid = false;
    for (const p of WW.world.planes) {
      if (!p.alive) continue;
      if (p.target === b && p.ordnance && WW.dist2(p.x, p.z, b.x, b.z) < 140 * 140) raid = true;
      if (p.carrier === b && (p.rwPh === 'roll' || p.rwPh === 'climb') && p.variant && WW.landAir.VAR[p.variant].model) add(6.5, 'chase', p, { dur: dur(12, 15) });
    }
    if (raid) add(7.5, 'orbit', { x: b.x, z: b.z, y: 0 }, { r: 80, dur: dur(14, 18), w: 0.045, hgt: 0.32 });
    else if (b.facilities.some(f => f.out && WW.time.now - f.outAt < 90)) add(5, 'orbit', { x: b.x, z: b.z, y: 0 }, { r: 70, dur: dur(13, 17), w: 0.04, hgt: 0.3 });
  });

  WW.on('baseBuilt', onBuilt);
  WW.on('baseEvent', caption);
  WW.on('roundStart', () => { for (const k in diaryT) delete diaryT[k]; if (!(WW.islandBase && WW.islandBase.base)) clear(); });
  WW.on('setupStart', () => { if (!(WW.islandBase && WW.islandBase.base)) clear(); });
  WW.baseFx = { update(rdt) { if (WW.simOnly) return; try { update(rdt); retry(); } catch (e) { console.error('baseFx', e); } }, clear, _parked: () => (WW.baseGroundFx ? WW.baseGroundFx._parked() : []), _built: () => built };
})();
