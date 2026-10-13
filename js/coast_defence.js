// coast_defence.js - WW.coastDefence: the German strongpoints at Omaha and Pointe du Hoc as sim units (P4 of
// docs/NORMANDY_PLAN.md). Sim code: WW.rand only, never on the Pacific path (every hook returns first when the
// scenario is not Normandy; the roundStart listener builds without a draw). Visuals: models_bunker.js.
// Two levels of unit, both duck-typed (never in WW.world.ships):
//  - an element (WW.coastDefence.elements): a casemate, an open gun pit, a Tobruk, an MG 42 nest, a mortar pit, a
//    flak gun, a 155, the observation bunker, the anti-tank wall: { isLand, isDef, nation 'GER', kind, type, wn, x, z,
//    y, heading (where it looks), arc, hp, crew, alive, suppressedUntil, revealUntil, takeDamage }. Shells and bombs hit
//    it through land_sites.js hitTest (combat.js findHit after the ships).
//  - a strongpoint (WN, WW.coastDefence.wns): the intel contact (one per WN, not per element: the aggregate scan), with
//    stats.guns summed from its live guns (the danger field, ai_threat.js, stamps it) and silenced once every weapon in
//    it is out. The Allies have every WN on the chart (aerial photographs); its elements show only when they fire
//    (muzzle flashes: revealUntil), and P5's fire support aims at the revealed ones.
// The realism rule: a casemate enfilades the beach from behind a concrete wall that faces the sea. A shell that comes
// in through its embrasure arc does full damage (and may knock the gun out at once); one on the wall does WALL_K x. Near
// misses suppress the crew (suppressedUntil): it does not fire. So close, angled destroyer fire is what silences them,
// as on the day, and the battleships' heavy shells from 450 u out barely mark the concrete.
// Events: 'defenceHit' { el, amount, through, kind, cal, x, z }, 'defenceEvent' { kind: 'out' | 'silenced', el?, wn }.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const WALL_K = 0.15, ROOF_K = 0.3, MG_K = 0;                 // a shell on the sea wall; a bomb on the roof; MG rounds on concrete
  const CRIT = { small: 0.25, med: 0.35, big: 0.5 };            // a shell through the embrasure that knocks the gun out at once
  const SUP_R = { mg: 0, small: 6, med: 9, big: 14, bomb: 16 }; // near-miss suppression radius (u)
  const SUP_T = { mg: 0, small: 8, med: 14, big: 22, bomb: 25 }; // ... and for how long (s)
  const SPLASH_K = 0.45;                                         // blast on an open position from a near miss (x dmg, by distance)
  const OBS_R = 320, PLANE_R = 180;                              // the strongpoints' observers see ships / planes this far out
  const REVEAL_T = 25;                                           // a muzzle flash shows the element for this long
  const ID0 = 9200, WN_ID0 = 9150;                               // ids clear of ships, the island base 9001, its pits / batteries
  const WEAPON = { casemate: 1, gunpit: 1, tobruk: 1, mg: 1, mortar: 1, flak: 1, battery: 1 };
  const D = () => WW.defenceData, T = () => WW.normandyTerrain;
  const on = () => WW.isScn('normandy');
  let elements = [], wns = [], stats = null;
  const now = () => WW.time.now;

  function newStats() { return { built: 0, hits: 0, through: 0, wall: 0, crits: 0, suppressions: 0, out: 0, silenced: 0, shots: 0, ownTarget: {} }; }
  const HEAD = { east: 0, west: Math.PI, sea: -Math.PI / 2, all: -Math.PI / 2 };
  function zAt(at, x, du) {
    const t = T();
    if (at === 'beach') return t.shingleZ(x) + 2.2 + du;
    if (at === 'foot') return t.bluffFootZ(x) + 1 + du;
    if (at === 'slope') return (t.bluffFootZ(x) + t.bluffTopZ(x)) / 2 + du;
    return t.bluffTopZ(x) + 2 + du;
  }
  function makeEl(w, e, i) {
    const K = D().KIND[e.kind];
    let x = w.x + e.dx, z = zAt(e.at, x, e.du || 0), dormant = false;
    if (e.kind === 'h155' && WW.scenarios.normandy.settings.hocGuns === 'moved') { // the orchard, inland: unmanned
      const O = D().ORCHARD; x = O.x + e.dx * 1.2; z = T().bluffTopZ(O.x) + O.du + (e.du || 0) * 0.6; dormant = true;
    }
    const y = Math.max(0, WW.terrain.heightRaw(x, z));
    const el = { isLand: true, isDef: true, id: ID0 + i, nation: 'GER', kind: e.kind, type: K.type, name: K.name, K, wn: w,
      x, z, y, muzzleY: y + K.top * 0.6 + 0.2, heading: HEAD[e.face], face: e.face, arc: K.arc, rad: K.rad,
      hp: K.hp, maxHp: K.hp, crew: K.crew, crew0: K.crew, alive: true, sinking: false, removed: false, submerged: false, speed: 0,
      dormant, gunNo: e.gun || 0, reload: 2 + (i % 7) * 0.9, suppressedUntil: 0, revealUntil: 0, firedAt: -1e9, outAt: 0, hitT: -1e9,
      stats: { name: K.name, type: K.type, guns: K.gun ? [Object.assign({ count: 1 }, K.gun)] : [], aa: K.aa ? Object.assign({}, K.aa) : null,
        length: K.rad * 2, beam: K.rad * 2, tons: 200, hp: K.hp },
      sup: { main: 1e9, aa: 1e9, aa0: 1e9, torp: 0, fuel: 0, main0: 1e9, fuel0: 0, flags: {} },   // ship_supply.js: its own magazines
      takeDamage(amount, hx, hz, kind, cal, src) { hit(this, amount, hx, hz, kind, cal, src); } };
    return el;
  }
  function makeWN(w, k, els) {
    const live = els.filter(e => !e.dormant);
    const cx = live.reduce((a, e) => a + e.x, 0) / live.length, cz = live.reduce((a, e) => a + e.z, 0) / live.length;
    const u = { isLand: true, isWN: true, id: WN_ID0 + k, nation: 'GER', type: 'strongpoint', name: w.name, wid: w.id, draw: w.draw, hoc: !!w.hoc,
      x: cx, z: cz, y: Math.max(0, WW.terrain.heightRaw(cx, cz)), heading: -Math.PI / 2, speed: 0, alive: true, sinking: false, removed: false, submerged: false,
      silenced: false, silencedAt: 0, elements: els, hp: 0, maxHp: 0, power: 1,
      stats: { name: w.name, type: 'strongpoint', guns: [], aa: null, length: 20, beam: 20, tons: 2000, hp: 0 },
      takeDamage(amount, hx, hz, kind, cal, src) { impact('USN', hx, hz, amount, kind, cal); } };
    els.forEach(e => { e.wn = u; });
    return u;
  }
  function build() {
    elements = []; wns = []; stats = newStats();
    if (!on() || !WW.normandyTerrain) return;
    D().WN.forEach((w, k) => {
      const els = w.els.map(e => { const el = makeEl(w, e, elements.length); elements.push(el); return el; });
      wns.push(makeWN(w, k, els));
    });
    wns.forEach(refresh);
    stats.built = elements.length;
    WW.emit('defencesBuilt', { elements, wns });
  }
  // a WN's strength as the enemy's danger field and the AI see it: its live, unsuppressed guns
  function refresh(w) {
    let hp = 0, maxHp = 0, best = null, n = 0, pow = 0;
    for (const e of w.elements) {
      maxHp += e.maxHp; if (e.alive) hp += e.hp;
      if (e.alive && !e.dormant && e.K.gun) { n++; pow += e.K.gun.cal === 'big' ? 2 : e.K.gun.cal === 'med' ? 1 : 0.5; if (!best || e.K.gun.range > best.range) best = e.K.gun; }
      if (e.alive && (e.kind === 'mg' || e.kind === 'mortar')) pow += 0.3;
    }
    w.hp = Math.max(1, hp); w.maxHp = maxHp; w.stats.hp = maxHp; w.power = pow;
    w.stats.guns = best ? [{ cal: best.cal, count: n, range: best.range, reload: best.reload }] : [];
    if (!w.silenced && !w.elements.some(e => e.alive && !e.dormant && WEAPON[e.type])) {
      w.silenced = true; w.silencedAt = WW.game ? WW.game.roundTime : now(); w.alive = false; stats.silenced++;
      WW.emit('defenceEvent', { kind: 'silenced', wn: w, x: w.x, z: w.z });
    }
  }

  // ---- damage ----
  function suppress(e, key, d) {
    const r = SUP_R[key] || 0; if (!r || d > r + e.rad) return;
    const t = now() + (SUP_T[key] || 0) * (1 - 0.5 * Math.max(0, d - e.rad) / r);
    if (t > e.suppressedUntil) { if (e.suppressedUntil < now()) stats.suppressions++; e.suppressedUntil = t; }
  }
  function hit(e, amount, x, z, kind, cal, src) {
    if (!e.alive || !(amount > 0)) return;
    const key = kind === 'bomb' ? 'bomb' : cal || 'small';
    let k = 1, through = true;
    if (key === 'mg') k = e.K.wall ? MG_K : e.K.armour ? 0.2 : 1;
    else if (e.K.wall) {
      if (kind === 'bomb') { k = ROOF_K; through = false; }
      else {
        const sx = src && src.x0 !== undefined ? src.x0 : x, sz = src && src.z0 !== undefined ? src.z0 : z;
        const b = Math.atan2(sz - e.z, sx - e.x);
        through = Math.abs(WW.angleDiff(e.heading, b)) < e.arc;
        k = through ? 1 : WALL_K;
      }
    } else if (e.K.armour) k = e.K.armour;
    const dmg = amount * k;
    e.hp -= dmg; e.hitT = now(); stats.hits++;
    if (e.K.wall && kind !== 'bomb' && key !== 'mg') { if (through) stats.through++; else stats.wall++; }
    suppress(e, key, 0);
    WW.emit('defenceHit', { el: e, amount: dmg, through, kind, cal, x, z });
    if (e.hp <= 0 || (through && e.K.wall && e.K.gun && CRIT[key] && WW.rand() < CRIT[key])) { if (e.hp > 0) stats.crits++; knockOut(e); }
    else refresh(e.wn);
  }
  function knockOut(e) {
    if (!e.alive) return;
    e.alive = false; e.hp = 0; e.crew = 0; e.outAt = now(); stats.out++;
    WW.emit('defenceEvent', { kind: 'out', el: e, wn: e.wn, x: e.x, z: e.z });
    refresh(e.wn);
  }
  // a shell or bomb that hit no unit: blast on the open positions in reach, suppression around it
  function impact(nation, x, z, dmg, kind, cal) {
    if (!on() || nation === 'GER' || !(dmg > 0) || !elements.length) return false;
    const key = kind === 'bomb' ? 'bomb' : cal || 'small', R = SUP_R[key] || 0;
    if (!R) return false;
    let any = false;
    for (const e of elements) {
      if (!e.alive) continue;
      const d = Math.hypot(x - e.x, z - e.z); if (d > R + e.rad) continue;
      any = true;
      suppress(e, key, d);
      const blast = key === 'bomb' ? 7 : key === 'big' ? 5 : key === 'med' ? 3 : 1.5;
      if (!e.K.wall && d < e.rad + blast) {
        e.hp -= dmg * SPLASH_K * (1 - Math.max(0, d - e.rad) / blast) * (e.K.armour || 1);
        if (e.hp <= 0) knockOut(e); else refresh(e.wn);
      }
    }
    return any;
  }

  // ---- land_sites.js hooks ----
  function hitTest(nation, x, z, pad, prefer) {
    if (!elements.length || nation === 'GER') return null;
    if (prefer && prefer.isDef && prefer.alive && Math.hypot(x - prefer.x, z - prefer.z) < prefer.rad + pad) return prefer;
    for (const e of elements) if (e.alive && e.type !== 'wall' && Math.abs(x - e.x) < e.rad + pad && Math.abs(z - e.z) < e.rad + pad && Math.hypot(x - e.x, z - e.z) < e.rad + pad) return e;
    return null;
  }
  // the aggregate scan: the Allies' chart (every WN), and each WN's observers (enemy ships within OBS_R of it)
  function scan(nation, sight) {
    if (!wns.length) return;
    if (nation !== 'GER') { for (const w of wns) if (!w.silenced) sight(w, w, 'visual'); return; }
    const S = WW.world.ships;
    for (const s of S) {
      if (!s.alive || s.sinking || s.nation === 'GER' || s.submerged) continue;
      for (const w of wns) if (!w.silenced && WW.dist2(s.x, s.z, w.x, w.z) < OBS_R * OBS_R) { sight(s, w, 'visual'); break; }
    }
    for (const p of WW.world.planes) {   // aircraft over the coast (the flak's lookouts)
      if (!p.alive || p.removed || p.nation === 'GER') continue;
      for (const w of wns) if (!w.silenced && WW.dist2(p.x, p.z, w.x, w.z) < PLANE_R * PLANE_R) { sight(p, w, 'visual'); break; }
    }
  }
  function shooters(out) { for (const e of elements) if (e.alive && e.kind === 'flak' && !(e.suppressedUntil > now())) out.push(e); }
  function roofAt(x, z) {
    let t = 0;
    for (const e of elements) if (Math.abs(e.x - x) < e.rad + 1 && Math.abs(e.z - z) < e.rad + 1) t = Math.max(t, e.y + e.K.top);
    return t;
  }
  function groundAt(x, z) { return on() ? Math.max(0, WW.terrain.heightRaw(x, z)) : 0; }
  WW.landSites.register({ id: 'coastDefence', impact, hitTest, scan, shooters, roofAt, groundAt,
    owns: t => !!(t && t.isDef), bombardRange: (ship, pref) => pref });

  WW.on('roundStart', () => { if (!on()) { elements = []; wns = []; return; } build(); });
  WW.on('setupStart', () => { if (!on()) { elements = []; wns = []; return; } build(); });
  WW.coastDefence = {
    get elements() { return elements; }, get wns() { return wns; }, get stats() { return stats; },
    build, refresh, knockOut, impact, suppress, update(dt) { if (WW.coastFire && elements.length) WW.coastFire.update(dt); },
    reveal(e, t) { e.revealUntil = Math.max(e.revealUntil, now() + (t || REVEAL_T)); },
    revealed: nation => elements.filter(e => e.alive && e.revealUntil > now()),
    wnOf: id => wns.find(w => w.wid === id) || null,
    WALL_K, CRIT, SUP_R, SUP_T, OBS_R, REVEAL_T
  };
  stats = newStats();
})(window.WW);
