// infantry_fire.js - WW.infFire: suppression, casualties and the fight for the strongpoints (P7 of
// docs/NORMANDY_PLAN.md). Sim code (WW.rand), Normandy only, stepped from infantry.js every TICK s:
//  - MG 42 fire (abstract, the coast_defence.js cones): each MG that is not suppressed lays its fire on the most exposed
//    squad in its cone (and a little on the next), MG_RATE men a tick at close range in the open, x (1 - cover) x the
//    range fall-off x PRONE when the squad is pinned (lying down). It pins (sup) the squads it fires on.
//  - mortars: a bomb in a mortar's zone (MORTAR_P a tick), on a squad inside it.
//  - fire back: a squad not pinned within FIRE_R of a position in its arc keeps its heads down (rifles, BARs,
//    bazookas into the embrasures: suppression), and a squad assaulting one kills its crew (CREW_K a tick x its men);
//    a position with no crew is captured (coast_defence.js knockOut).
//  - tanks ashore fire 75 mm shells at the positions they can see (the revealed ones, or any within TANK_SEE), through
//    WW.combat.fireShell: along the beach, into the embrasures.
//  - the German guns' shells on the men (land_sites.js hitTest, infantry.js takeDamage): SHELL_K men per 10 damage.
// Spatial: the MG cones reach < 100 u, so each MG looks only at the squads in its x bucket and the two beside it.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const TICK = 0.25, MG_RATE = 0.22, MG_SPREAD = 0.35, PRONE = 0.55, MG_SUP = 0.8, SUP_DECAY = 0.3;
  const MORTAR_P = 0.01, MORTAR_K = 1.6, FIRE_R = 70, FIRE_SUP = 0.006, FIRE_SUP_T = 4, CREW_K = 0.008, DEFEND_K = 0.06, ASSAULT_R = 9;
  const TANK_SEE = 90, TANK_RELOAD = 12, SHELL_K = 0.1, BUCKET = 50, HIT_R = 1.6;
  const FIRES = { shingle: 1, shelf: 1, climb: 1, top: 1, assault: 1, hold: 1 };   // where a squad can fire back from (not wading)
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  const R = () => WW.infRoutes, CD = () => WW.coastDefence, I = () => WW.infantry;
  let tick = 0, grid = new Map(), stats = null;
  function newStats() { return { mgTicks: 0, mgKills: 0, mortarKills: 0, shellKills: 0, crewKilled: 0, captured: 0, tankShots: 0 }; }

  function inArc(e, x, z) { return WW.coastFire ? WW.coastFire.inArc(e, x, z) : true; }
  function bucket(squads) {
    grid.clear();
    for (const q of squads) { if (!q.alive) continue; const k = Math.floor(q.x / BUCKET); let L = grid.get(k); if (!L) grid.set(k, L = []); L.push(q); }
  }
  function near(x, f) { const k = Math.floor(x / BUCKET); for (let i = k - 2; i <= k + 2; i++) { const L = grid.get(i); if (L) for (const q of L) f(q); } }
  function roll(lam) { const n = Math.floor(lam); return n + (WW.rand() < lam - n ? 1 : 0); }

  function mgFire() {
    const now = WW.time.now;
    for (const e of CD().elements) {
      if (e.kind !== 'mg' && e.kind !== 'tob' && e.kind !== 'flak') continue;
      if (!e.alive || e.suppressedUntil > now) continue;
      const Rg = e.K.range || 90;
      let a = null, as = 0, b = null, bs = 0;
      near(e.x, q => {
        if (!q.alive || q.kind === 'tank') return;
        const d = Math.hypot(q.x - e.x, q.z - e.z); if (d > Rg || !inArc(e, q.x, q.z)) return;
        const c = R().cover(q.x, q.z), s = q.men * (1 - c) / (1 + d / 40);
        if (s > as) { b = a; bs = as; a = q; as = s; } else if (s > bs) { b = q; bs = s; }
      });
      if (!a) continue;
      stats.mgTicks++;
      e.firedAt = now; CD().reveal(e, 15);
      for (const [q, w] of [[a, 1], [b, MG_SPREAD]]) {
        if (!q) continue;
        const d = Math.hypot(q.x - e.x, q.z - e.z), c = R().cover(q.x, q.z);
        const lam = MG_RATE * w * (1 - c) * Math.max(0.15, 1 - d / Rg) * (q.sup > I().PIN ? PRONE : 1) * Math.min(1, q.men / 8);
        const n = roll(lam); if (n) stats.mgKills += I().lose(q, n);
        q.sup = Math.min(3, q.sup + MG_SUP * w * (1 - c * 0.5));
      }
      WW.emit('defenceFire', { el: e, kind: 'mg', target: a });
    }
  }
  function mortarFire() {
    for (const e of CD().elements) {
      if (e.kind !== 'mortar' || !e.alive || e.suppressedUntil > WW.time.now || WW.rand() >= MORTAR_P) continue;
      const L = [];
      near(e.x, q => { if (q.alive && q.kind !== 'tank') { const d = Math.hypot(q.x - e.x, q.z - e.z); if (d > 25 && d < e.K.range) L.push(q); } });
      if (!L.length) continue;
      const q = L[Math.floor(WW.rand() * L.length)], c = R().cover(q.x, q.z);
      stats.mortarKills += I().lose(q, roll(MORTAR_K * (1 - c * 0.6)));
      q.sup = Math.min(3, q.sup + 0.8);
      WW.emit('mortarBurst', { x: q.x + (WW.rand() - 0.5) * 3, z: q.z + (WW.rand() - 0.5) * 3, el: e });
    }
  }
  // the squads' own fire: heads down in the positions in reach, the assault kills crews
  function fireBack() {
    const now = WW.time.now;
    for (const e of CD().elements) {
      if (!e.alive || e.dormant || e.type === 'wall') continue;
      near(e.x, q => {
        if (!q.alive || q.kind === 'tank') return;
        const d = Math.hypot(q.x - e.x, q.z - e.z);
        if (q.state === 'assault' && d < ASSAULT_R && e.crew > 0 && WW.rand() < DEFEND_K * e.crew / 5) I().lose(q, 1);   // the crew fights for it
        if (q.sup > I().PIN || !FIRES[q.state]) return;
        if (d < FIRE_R && WW.rand() < FIRE_SUP * q.men / 12) e.suppressedUntil = Math.max(e.suppressedUntil, now + FIRE_SUP_T);
        if (q.state === 'assault' && d < ASSAULT_R && WW.rand() < CREW_K * q.men) {
          e.crew--; stats.crewKilled++;
          if (e.crew <= 0) { stats.captured++; CD().knockOut(e); WW.emit('squadEvent', { kind: 'captured', squad: q, el: e }); }
        }
      });
    }
  }
  function tanks(dt, squads) {
    const now = WW.time.now;
    for (const q of squads) {
      if (!q.alive || q.kind !== 'tank' || q.state !== 'tank') continue;
      q.reload -= dt; if (q.reload > 0) continue;
      let best = null, bd = 1e9;
      for (const e of CD().elements) {
        if (!e.alive || e.dormant || e.type === 'wall') continue;
        const d = Math.hypot(e.x - q.x, e.z - q.z);
        if (d < 160 && (e.revealUntil > now || d < TANK_SEE) && d < bd) { bd = d; best = e; }
      }
      if (!best) { q.reload = 1; continue; }
      if (WW.combat.fireShell(q, null, best, 'small')) stats.tankShots++;   // the Sherman's 75 mm: a 'small' shell in the game's calibres
      q.reload = TANK_RELOAD * WW.randRange(0.9, 1.15);
    }
  }
  function hit(q, amount, key) {
    if (!q.alive || !(amount > 0)) return;
    if (q.kind === 'tank') { q.hp -= amount * (key === 'small' || key === 'mg' ? 0.3 : 1); if (q.hp <= 0) I().lose(q, 0); return; }
    const c = R().cover(q.x, q.z);
    stats.shellKills += I().lose(q, roll(amount * SHELL_K * (1 - c * 0.5)));
    q.sup = Math.min(3, q.sup + 1);
  }
  function update(dt, squads) {
    for (const q of squads) if (q.alive && q.sup > 0) q.sup = Math.max(0, q.sup - SUP_DECAY * dt);
    tanks(dt, squads);
    tick -= dt; if (tick > 0) return; tick = TICK;
    bucket(squads);
    mgFire(); mortarFire(); fireBack();
  }
  // land_sites.js: German shells on the men and tanks ashore
  function hitTest(nation, x, z, pad, prefer) {
    if (nation !== 'GER' || !I() || !grid.size) return null;
    if (prefer && prefer.isSquad && prefer.alive && Math.hypot(x - prefer.x, z - prefer.z) < HIT_R + pad) return prefer;
    let r = null;
    near(x, q => { if (!r && q.alive && Math.hypot(x - q.x, z - q.z) < HIT_R + pad) r = q; });
    return r;
  }
  WW.landSites.register({ id: 'infantry', hitTest });
  WW.on('roundStart', () => { tick = 0; grid.clear(); stats = newStats(); });
  WW.infFire = { update, hit, get stats() { return stats; }, MG_RATE };
  stats = newStats();
})(window.WW);
