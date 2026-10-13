// coast_defence_fire.js - WW.coastFire: the German strongpoints' fire (P4 of docs/NORMANDY_PLAN.md). Sim code: WW.rand
// only; stepped by coast_defence.js update (main.js, right after the island base), Normandy only.
//  - Direct fire (casemates, field guns, Tobruks, the 155s): real shells through WW.combat.fireShell, on the reload
//    cycle the island batteries use (land_sites.js gunTick). A gun fires only inside its arc (an enfilading casemate
//    sees along the beach, not out to sea), at the nearest worthwhile target its strongpoint can see: landing craft
//    (P6), tanks ashore (P7), then ships; a ship shelling its strongpoint first.
//  - MG 42s and mortars do not fire projectiles: an MG has a fire cone (heading +- arc, range), a mortar registered
//    zones on the beach. Each step they mark what is in them (el.active, el.load) for the infantry (P7) and the
//    landing craft (P6) to roll casualties against; the tracers are visual (models_bunker.js, 'defenceFire' events).
//  - Suppressed crews do not fire; a muzzle flash reveals the element (coast_defence.js reveal: P5 aims at it).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const SHELL_K = 1.25;          // shelling the strongpoint: x the target's score (the duel: they answer the ship that fires on them)
  const MG_TICK = 0.5;           // the abstract fire's interval (s)
  const now = () => WW.time.now;
  const CD = () => WW.coastDefence;
  let mgT = 0;
  const shelledBy = new Map();   // ship -> { wn, t }: the last strongpoint a ship fired on (shellFired)

  // a target of element e: in range, inside its arc (+ a margin), alive
  function inArc(e, x, z) {
    if (e.arc >= Math.PI - 1e-6) return true;
    return Math.abs(WW.angleDiff(e.heading, Math.atan2(z - e.z, x - e.x))) < e.arc + 0.12;
  }
  function pick(e) {
    const g = e.K.gun, R = g.range, I = WW.intel;
    let best = null, bs = -1;
    // landing craft and tanks ashore (P6 / P7: their modules list their units for the defences)
    const L = WW.landTargets ? WW.landTargets(e) : null;
    if (L) for (const u of L) {
      if (!u.alive) continue;
      const d = Math.hypot(u.x - e.x, u.z - e.z); if (d > R || !inArc(e, u.x, u.z)) continue;
      const sc = (u.value || 3) / (1 + d / 60);
      if (sc > bs) { bs = sc; best = u; }
    }
    if (!I) return best;
    for (const c of I.enemyShips('GER', { fresh: true })) {
      const u = c.unit; if (!u || !u.alive || u.sinking || u.submerged || u.isLand) continue;
      const d = Math.hypot(u.x - e.x, u.z - e.z); if (d > R || !inArc(e, u.x, u.z)) continue;
      const sb = shelledBy.get(u), duel = sb && sb.wn === e.wn && now() - sb.t < 30 ? SHELL_K : 1;
      const sc = (u.stats.tons || 1000) / 2000 / (1 + d / 80) * duel;
      if (sc > bs) { bs = sc; best = u; }
    }
    return best;
  }
  function fire(e, t) {
    e.aim = Math.atan2(t.z - e.z, t.x - e.x); e.firedAt = now();
    if (WW.combat.fireShell(e, null, t, e.K.gun.cal)) CD().stats.shots++;
    CD().reveal(e);
    WW.emit('defenceFire', { el: e, target: t, kind: 'gun' });
  }

  // the abstract fire: MG cones and mortar zones mark what is in them (P6 / P7 read el.active / el.load)
  function abstractFire(dt) {
    mgT -= dt; if (mgT > 0) return; mgT = MG_TICK;
    const L = WW.landTargets ? WW.landTargets(null) : null;
    for (const e of CD().elements) {
      if (e.kind !== 'mg' && e.kind !== 'mortar' && e.kind !== 'flak') continue;
      e.active = false; e.load = 0;
      if (!e.alive || e.suppressedUntil > now() || !L) continue;
      const R = e.K.range;
      for (const u of L) {
        if (!u.alive) continue;
        const d = Math.hypot(u.x - e.x, u.z - e.z);
        if (d > R || (e.kind === 'mortar' && d < 25) || !inArc(e, u.x, u.z)) continue;
        e.active = true; e.load += (u.men || 1);
      }
      if (e.active) { e.firedAt = now(); CD().reveal(e, 15); WW.emit('defenceFire', { el: e, kind: e.kind }); }
    }
  }

  function update(dt) {
    const t = now();
    for (const e of CD().elements) {
      if (!e.alive || e.dormant || !e.K.gun) continue;
      if (e.suppressedUntil > t) { e.reload = Math.max(e.reload, 0.5); continue; }   // heads down: no fire, the reload waits
      WW.landSites.gunTick(e, dt, () => pick(e), q => fire(e, q), () => e.K.gun.reload);
    }
    abstractFire(dt);
  }
  // a ship firing on a strongpoint's element (or the WN itself): the duel
  WW.on('shellFired', ev => {
    const p = ev && ev.proj, tg = p && p.target;
    if (!tg || !ev.ship || !(tg.isDef || tg.isWN) || ev.ship.isLand) return;
    shelledBy.set(ev.ship, { wn: tg.isWN ? tg : tg.wn, t: now() });
  });
  WW.on('roundStart', () => { shelledBy.clear(); mgT = 0; });
  WW.coastFire = { update, pick, inArc };
})(window.WW);
