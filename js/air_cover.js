// air_cover.js — WW.airCover: the CAP covers the whole task force, not only its carrier. A ship in trouble (an enemy
// bomber on its run at it, or a fighter strafing it: a destroyer of the screen, a PT boat, a cripple left behind) draws
// the CAP as a raid on the carrier does, out to the doctrine's cover reach from the carrier (or the island base):
// USN `picket` (CXAM radar, a fighter director) 420, the long leash; IJN `overhead` 260: the Zeros see the flak bursts
// over the screen from their loops, and have no radio vector to go farther. Hooks: air_cap.js raidFor (the vector),
// air_ops.js capPick / leashed (the foe and the leash), air_cap.js join (fighters on the way home). The raid picture
// (airOps.picture: scrambles, strike holds) is not touched. Only what the side has detected (WW.intel.enemyPlanes),
// and the attacker's run at our ship is what the ship and the fleet see. Sim code, deterministic (no WW.rand).
window.WW = window.WW || {};
(function () {
  const ATK_R = 300;                       // an armed bomber this close to its target ship is running in on it (the vector meets it before the drop)
  const REACH = { picket: 420, overhead: 260 };
  const VALUE = { carrier: 0, battleship: 60, cruiser: 50, destroyer: 40, pt: 25, submarine: 20 };
  const ST = { USN: { picks: 0, vectors: 0 }, IJN: { picks: 0, vectors: 0 } };
  const cache = { USN: { t: -1, L: [] }, IJN: { t: -1, L: [] } };
  const reach = pl => REACH[WW.cap ? WW.cap.style(pl.nation) : pl.nation === 'IJN' ? 'overhead' : 'picket'] || 260;
  const crip = s => (WW.endgameAI && WW.endgameAI.isCripple ? WW.endgameAI.isCripple(s) : s.hp < 0.5 * s.maxHp);

  // Own ships under air attack, from the side's own picture: [{ ship, raider, x, z }], refreshed every 0.5 s.
  function trouble(nation) {
    const C = cache[nation]; if (!C) return [];
    const now = WW.time.now;
    if (now - C.t < 0.5 && C.t >= 0) return C.L;
    C.t = now; C.L = [];
    if (!WW.intel) return C.L;
    for (const ct of WW.intel.enemyPlanes(nation)) {
      const u = ct.unit; if (!u || !u.alive) continue;
      let s = null;
      if ((u.kind === 'dive' || u.kind === 'torpedo') && u.ordnance && u.target && u.target.alive && !u.target.isBase && u.target.nation === nation && WW.dist(u.x, u.z, u.target.x, u.target.z) < ATK_R) s = u.target;
      else if (u.kind === 'fighter' && u.strafe && u.strafe.alive && u.strafe.nation === nation) s = u.strafe;
      if (s && !s.sinking) C.L.push({ ship: s, raider: u, x: s.x, z: s.z });
    }
    return C.L;
  }
  // May this CAP fighter go for raider u (is u on one of our ships within the cover reach of its carrier / base)?
  function onShip(pl, u) {
    const c = pl.carrier; if (!c) return null;
    for (const e of trouble(pl.nation)) if (e.raider === u && WW.dist(c.x, c.z, e.x, e.z) <= reach(pl)) return e;
    return null;
  }
  // The raider this CAP fighter should be vectored onto to cover a ship in trouble, or null. A carrier's own attackers
  // are the raid picture's business (air_cap raidFor); one section to a raider (others already on it count against).
  function raidOn(pl) {
    const c = pl.carrier; if (!c) return null;
    let best = null, bs = -1e9;
    for (const e of trouble(pl.nation)) {
      if (e.ship.type === 'carrier' && !e.ship.isBase) continue;
      const dc = WW.dist(c.x, c.z, e.x, e.z); if (dc > reach(pl)) continue;
      let on = 0; for (const q of WW.world.planes) if (q !== pl && q.alive && q.nation === pl.nation && (q.foe === e.raider || q.vec === e.raider) && !(q.element && q.element === pl.element)) on++;
      const u = e.raider, s = 160 + (VALUE[e.ship.type] || 30) + (crip(e.ship) ? 40 : 0) + (u.kind === 'torpedo' ? 30 : 0) - on * 90 - WW.dist(pl.x, pl.z, u.x, u.z) * 0.5 - dc * 0.15;
      if (s > bs) { bs = s; best = u; }
    }
    if (best) ST[pl.nation] && ST[pl.nation].picks++;
    return best;
  }
  // air_cap join: a raid on one of our ships within the cover reach of this carrier
  function near(cv) {
    const r = REACH[WW.cap ? WW.cap.style(cv.nation) : 'overhead'] || 260;
    for (const e of trouble(cv.nation)) if (WW.dist(cv.x, cv.z, e.x, e.z) <= r) return true;
    return false;
  }
  function reset() { for (const n in ST) { ST[n].picks = 0; ST[n].vectors = 0; } for (const n in cache) { cache[n].t = -1; cache[n].L = []; } }
  WW.on('roundStart', reset);
  WW.airCover = { trouble, onShip, raidOn, near, reach, REACH, stats: ST };
})();
