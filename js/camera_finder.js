// camera_finder.js (camera): WW.camFinder, the "imminent action" finder. It ranks the moments that are about to
// happen by how soon (eta, sim seconds) and how dramatic, so the director and story mode (camera_story.js) can
// arrive 10-30 s BEFORE an attack instead of after it, and the keys Tab / Shift+Tab / 8 / 9 (ui.js) can cycle them:
//   strike   a strike wave closing on its target (eta from the wave's distance to the target, GUIDE_V);
//   push     dive bombers circling over the target, about to push over (eta <= the VB hold);
//   anvil    torpedo bombers setting up / flying the anvil run (eta from the distance to the release point);
//   bandits  fighters closing on bombers (eta from their distance);
//   torps    torpedoes in the water running at a ship (eta = track distance / torpedo speed);
//   danger   a ship burning / flooding / just hit by a magazine or deck explosion (ship_fires.js, feature-detected).
// Each item: { kind, subj (plane or ship to film), target, eta, drama, score, label, key }. eta is in sim s; realS()
// converts with the measured sim rate (time scale, slow motion). Cached for 0.5 s of real time.
// Visual only: reads the sim, never writes it; no WW.rand.
window.WW = window.WW || {};
(function (WW) {
  const GUIDE_V = 20, ARRIVE = 60, VB_HOLD = 20, TORP_REL = 55, HOT = [10, 30];
  const wall = () => performance.now() / 1000;
  const ok = p => p && !p.removed && p.alive;
  const KIND = { carrier: 'carrier', battleship: 'battleship', cruiser: 'cruiser', destroyer: 'destroyer', submarine: 'submarine', pt: 'PT boat' };
  const VALUE = { carrier: 1.6, battleship: 1.4, cruiser: 1.1, destroyer: 0.8, submarine: 0.6, pt: 0.4 };
  const sq = p => (p && p.squadron ? p.squadron.short : p && p.nation === 'IJN' ? 'IJN strike' : 'Strike');
  let cache = [], cacheAt = -1e9, cacheSim = -1e9, rate = 0.5, rW = null, rS = 0, latched = [];

  // how many sim seconds pass per real second right now (time scale x base speed x slow motion), smoothed
  function sampleRate() {
    const w = wall(), s = WW.time.now;
    if (rW !== null && w - rW > 0.25) {
      const r = (s - rS) / (w - rW);
      if (r > 0 && r < 20) rate += (r - rate) * 0.3;
      rW = w; rS = s;
    } else if (rW === null || s < rS) { rW = w; rS = s; }
  }
  const realS = eta => eta / Math.max(0.05, rate);

  // a moment is best caught 10-30 s (real) before it happens; later than that is a long wait, sooner is late
  function windowW(etaReal) {
    if (etaReal < 0) return 0.35;
    if (etaReal < HOT[0]) return 0.55 + 0.45 * etaReal / HOT[0];
    if (etaReal <= HOT[1]) return 1;
    return Math.max(0.15, 1 - (etaReal - HOT[1]) / 60);
  }
  function leadOf(w) {
    const ms = w.members.filter(m => ok(m) && m.ordnance);
    return ms.find(m => m.kind === 'torpedo' && m.wing === 0) || (ok(w.cag) && w.cag.ordnance ? w.cag : null) || ms.find(m => m.wing === 0) || ms[0] || null;
  }

  function scan() {
    const out = [];
    const add = (kind, subj, target, eta, drama, label) => {
      if (!subj) return;
      const er = realS(Math.max(0, eta));
      out.push({ kind, subj, target, eta, etaReal: er, drama, score: drama * windowW(eta < 0 ? -1 : er), label, key: kind + ':' + (subj.id !== undefined ? subj.id : '') });
    };
    // strike waves on their way in
    const waves = WW.strike && WW.strike._waves ? WW.strike._waves() : [];
    for (const w of waves) {
      const t = w.target;
      if (w.done || !t || !t.alive) continue;
      const lead = leadOf(w);
      if (!lead || lead.phase || lead.sk === 'anvil') continue;           // already attacking: the plane items cover it
      const n = w.members.filter(m => ok(m) && m.ordnance).length;
      if (!n) continue;
      const d = w.go && w.dT < 1e8 ? w.dT : WW.dist(w.x, w.z, t.x, t.z);
      const eta = Math.max(0, d - ARRIVE) / GUIDE_V + (w.go ? 0 : 15);
      const vt = w.members.some(m => ok(m) && m.kind === 'torpedo' && m.ordnance);
      add('strike', lead, t, eta, (1.2 + 0.25 * Math.min(6, n) + (vt ? 0.4 : 0)) * (VALUE[t.type] || 1),
        sq(lead) + ' strike reaches the ' + (KIND[t.type] || 'target'));
    }
    for (const p of WW.world.planes) {
      if (!ok(p) || !p.pt) continue;
      const t = p.target;
      // dive bombers in the wheel over the target, about to push over
      if (p.kind === 'dive' && p.ordnance && t && t.alive && p.state === 'attack' && !p.phase && p.wing === 0)
        add('push', p, t, VB_HOLD * 0.4, 2.6 * (VALUE[t.type] || 1), sq(p) + ' pushes over on the ' + (KIND[t.type] || 'target'));
      else if (p.kind === 'dive' && p.ordnance && t && t.alive && (p.phase === 'roll' || p.phase === 'dive'))
        add('push', p, t, 0, 2.2 * (VALUE[t.type] || 1), sq(p) + ' diving on the ' + (KIND[t.type] || 'target'));
      // torpedo bombers on the anvil / the run
      else if (p.kind === 'torpedo' && p.ordnance && t && t.alive && (p.sk === 'anvil' || p.phase === 'run') && p.wing === 0)
        add('anvil', p, t, Math.max(0, WW.dist(p.x, p.z, t.x, t.z) - TORP_REL) / Math.max(10, p.speed || 26), 2.8 * (VALUE[t.type] || 1), sq(p) + ' torpedo run on the ' + (KIND[t.type] || 'target'));
      // fighters closing on bombers
      else if (p.kind === 'fighter' && p.state === 'attack' && ok(p.foe) && p.foe.kind !== 'fighter' && p.foe.kind !== 'scout') {
        const d = Math.hypot(p.foe.x - p.x, p.foe.y - p.y, p.foe.z - p.z);
        add('bandits', p, p.foe, Math.max(0, d - 15) / 12, 1.6 + (p.ace ? 0.6 : 0), (sq(p) + ' fighters on ' + sq(p.foe)).replace('Strike fighters', 'Fighters'));
      }
    }
    // torpedoes in the water: project each track onto the hulls ahead of it
    const act = WW.combat && WW.combat._i && WW.combat._i.active;
    if (act) {
      const best = new Map();
      for (const q of act) {
        if (q.dead || q.kind !== 'torp') continue;
        const fx = Math.cos(q.h), fz = Math.sin(q.h), v = q.speed || (WW.TORPEDO && WW.TORPEDO.speed) || 14;
        for (const s of WW.world.ships) {
          if (!s.alive || s.nation === q.nation || s.submerged) continue;
          const dx = s.x - q.x, dz = s.z - q.z, along = dx * fx + dz * fz;
          if (along < 0 || along > 220) continue;
          const lat = Math.abs(dx * fz - dz * fx);
          if (lat > s.stats.length * 0.6 + 6) continue;
          const eta = along / v, b = best.get(s);
          if (!b || eta < b.eta) best.set(s, { eta, n: (b ? b.n : 0) + 1 }); else b.n++;
        }
      }
      for (const [s, b] of best) add('torps', s, s, b.eta, (2.4 + 0.3 * Math.min(4, b.n)) * (VALUE[s.type] || 1), 'Torpedoes running at the ' + (KIND[s.type] || 'ship'));
    }
    // ships in danger: fires, flooding, a magazine / deck explosion just now (ship_fires.js, when present)
    const now = WW.time.now;
    latched = latched.filter(e => now - e.t < 20 && e.s && !e.s.removed);
    for (const s of WW.world.ships) {
      if (s.removed || (!s.alive && !s.sinking)) continue;
      const L = latched.find(e => e.s === s);
      const fire = s.fireN || 0, flood = s.flood || 0, low = s.alive ? 1 - s.hp / s.maxHp : 1;
      let d = 0, why = '';
      if (L) { d = 2.6; why = L.why; }
      else if (s.sinking) { d = 2.2; why = 'goes down'; }
      else if (fire >= 3 || (s.avgas && fire >= 2)) { d = 1.4 + 0.15 * fire; why = 'burns'; }
      else if (flood > 0.15 || low > 0.75) { d = 1.3; why = flood > 0.15 ? 'is flooding' : 'is badly hurt'; }
      if (d) add('danger', s, s, 0, d * (VALUE[s.type] || 1) * 0.8, (s.name || 'The ' + (KIND[s.type] || 'ship')) + ' ' + why);
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }
  function list() {
    sampleRate();
    if (wall() - cacheAt > 0.5 || Math.abs(WW.time.now - cacheSim) > 0.5) { cacheAt = wall(); cacheSim = WW.time.now; try { cache = scan(); } catch (e) { console.error('camFinder', e); cache = []; } }
    return cache;
  }
  // upcoming attacks in time order (Tab cycling); kinds: optional filter
  function upcoming(kinds) {
    return list().filter(i => !kinds || kinds.indexOf(i.kind) >= 0).slice().sort((a, b) => a.eta - b.eta || b.score - a.score);
  }
  // "~25 s" in real seconds
  function etaText(i) {
    if (!i || i.etaReal < 3) return 'now';
    return '~' + (i.etaReal < 60 ? Math.round(i.etaReal / 5) * 5 || 5 : Math.round(i.etaReal / 10) * 10) + ' s';
  }
  // the item about subject o (a plane of a strike: its wave's item too)
  function about(o) {
    if (!o) return null;
    const L = list();
    return L.find(i => i.subj === o) || (o.wave ? L.find(i => i.subj && i.subj.wave === o.wave) : null) || L.find(i => i.target === o) || null;
  }
  WW.on('magazine', e => { if (e && e.ship) latched.push({ s: e.ship, t: WW.time.now, why: 'magazine explodes' }); cacheAt = -1e9; });
  WW.on('deckHit', e => { if (e && e.ship) latched.push({ s: e.ship, t: WW.time.now, why: 'flight deck ablaze' }); cacheAt = -1e9; });
  WW.on('roundStart', () => { latched = []; cache = []; cacheAt = -1e9; cacheSim = -1e9; });
  WW.camFinder = { list, upcoming, about, etaText, realS, rate: () => rate, HOT };
})(window.WW);
