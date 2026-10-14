// camera_follow.js (camera): WW.camFollow, the user's "follow the action" controls on top of the director, story
// mode (camera_story.js), the imminent-action finder (camera_finder.js) and the free camera (freecam.js):
//   F           always does something visible: jump to the most imminent attack (a plane: a story on it; a ship: an
//               orbit on it), else the best current action, else the front line, each with a short label. While the
//               user follows something (their story, a followed subject, a jumped-to ship), F hands back to the director.
//   Tab / Shift+Tab   next / previous upcoming attack, in time order;  8 next dogfight;  9 next ship in danger.
// A small label (bottom left) says what is followed and, while waiting, "strike reaches the cruiser in ~25 s".
// It also adds the finder's imminent moments to the director's candidates (WW.camHooks).
// Normandy (camera_normandy.js on): F, Tab, 8 and 9 and the label are the land battle's (WW.camNormandy.f / cycle /
// label: follow a landing craft, a squad, a tank), the Pacific ones otherwise.
// Visual only: Math.random / wall clock, never WW.rand; reads the sim. Load after camera_story.js and camera_finder.js.
window.WW = window.WW || {};
(function (WW) {
  const wall = () => performance.now() / 1000;
  const ok = p => p && !p.removed && p.alive;
  const isPlane = o => !!(o && o.pt && o.kind);
  const KIND = { carrier: 'carrier', battleship: 'battleship', cruiser: 'cruiser', destroyer: 'destroyer', submarine: 'submarine', pt: 'PT boat' };
  let cur = null, labelEl = null, labelT = 0;     // cur: { item, subj, ship: bool, at } the user's last jump
  const ST = { f: 0, jumps: 0, handbacks: 0, cycles: 0 };

  function nameOf(o) {
    if (!o) return '';
    if (isPlane(o)) return [o.squadron ? o.squadron.short : o.nation, WW.squadrons && WW.squadrons.rank(o)].filter(Boolean).join(' · ');
    return o.name || (o.nation + ' ' + (KIND[o.type] || 'ship'));
  }
  const etaText = it => (WW.camFinder ? WW.camFinder.etaText(it) : '');
  const say = it => it.label + (!it.vague && it.etaReal >= 3 ? ' in ' + etaText(it) : ''); // a vague item (the anvil set-up, the wheel, fighters closing) gets no number
  function director() { // the director has the camera: leave map view and the free camera
    if (WW.cam.mode === 'map') WW.cam.toggle();
    if (WW.freecam && WW.freecam.release) WW.freecam.release();
  }
  function filmShip(s, secs) {
    WW.cam.film({ kind: 'orbit', subj: s, r: s.stats.length * 1.5 + 22, dur: WW.clamp(secs, 10, 40), w: 0.05, hgt: 0.3, user: true });
  }
  // the story mission for a plane: a fighter strafing small craft, on CAP (no target) or escorting; else a strike
  const missionOf = s => (s.kind === 'fighter' ? (s.strafe ? 'strafe' : !s.target ? 'cap' : 'strike') : 'strike');
  // jump to a finder item (or { subj, label }): a plane gets a story, a ship an orbit
  function jump(it) {
    director(); ST.jumps++;
    const s = it.subj;
    if (isPlane(s)) {
      WW.camStory.begin({ lead: s, mission: missionOf(s), item: it.eta !== undefined ? it : null });
      cur = { item: it, subj: s, ship: false, at: wall() };
    } else {
      if (WW.camStory.active()) WW.camStory.stop();
      filmShip(s, (it.etaReal || 0) + 12);
      cur = { item: it, subj: s, ship: true, at: wall() };
    }
    labelT = 0;
    return it;
  }
  // what the user follows right now (for F's hand-back and for cycling from it)
  function following() {
    const fc = WW.freecam && WW.freecam.active() && WW.freecam.following();
    if (fc) return fc;
    const st = WW.camStory.story();
    if (st && st.user) return st.lead;
    const ua = WW.camDirector && WW.camDirector.userArc(); if (ua) return ua;   // the user's ship arc (F)
    const shot = WW.cam._shot();
    if (cur && cur.ship && shot && shot.user && shot.subj === cur.subj) return cur.subj;
    return null;
  }
  function handBack() {
    ST.handbacks++; cur = null;
    if (WW.camDirector) WW.camDirector.endUserArc();
    if (WW.camStory.active()) WW.camStory.stop();
    if (WW.freecam && WW.freecam.release) WW.freecam.release();
    WW.cam.cut();
  }
  // the best current action when nothing is imminent (planes in the air, a gunfight, the base under fire), else the
  // front line: never nothing while a ship is afloat, by day, dusk or night
  function bestNow() { return actions()[0] || frontLine(); }
  // ---------- the current action at dusk / night (the gunline, star shells, the base) ----------
  // Who fired / was hit lately (sim s), from the events; a coastal battery or AA pit counts as its island base.
  const fired = new Map(), hit = new Map();
  const unitOf = u => (u && (u.isBattery || u.isBasePit) && WW.islandBase && WW.islandBase.base) || u;
  WW.on('shellFired', e => { if (e && e.ship) fired.set(unitOf(e.ship), WW.time.now); });
  WW.on('shellLanded', e => { if (e && e.ship) hit.set(unitOf(e.ship), WW.time.now); });
  WW.on('baseImpact', e => { if (e && e.base) hit.set(e.base, WW.time.now); });
  const ago = (m, o) => (m.has(o) ? WW.time.now - m.get(o) : 1e9);
  const VAL = { carrier: 1.6, battleship: 1.4, cruiser: 1.1, destroyer: 0.8, submarine: 0.6, pt: 0.4, base: 1.2 };
  const live = o => !!(o && !o.removed && o.alive && !o.submerged);
  const theName = o => (o.isBase ? (o.name && o.name !== 'the island' ? o.name : 'the airfield') : o.name || 'the ' + (KIND[o.type] || 'ship'));
  const dark = () => (WW.daylight !== undefined && WW.daylight < 0.35) || !!(WW.dayNight && WW.dayNight.canFly && !WW.dayNight.canFly());
  // the ships, plus the island base when there is one
  function units() { const B = WW.islandBase && WW.islandBase.base; return WW.world.ships.filter(live).concat(live(B) ? [B] : []); }
  // the ship actions (no planes), best first: a ship or the base under fire, a star shell or searchlight on a ship,
  // a ship firing, then any ship with a target (the nearest to it first: the big guns reach further)
  function shipActions() {
    const out = [], pre = dark() ? 'Night action: ' : '', U = units();
    const add = (subj, label, score) => { if (live(subj) && !out.some(i => i.subj === subj)) out.push({ subj, label, score, etaReal: 0 }); };
    for (const s of U) {
      const h = ago(hit, s), by = s.isBase ? U.find(o => o.target === s) : null;
      if (h < 15) add(s, (s.isBase ? 'Bombardment: ' : pre) + theName(s) + ' under fire' + (by ? ' from ' + theName(by) : ''), 3 + (VAL[s.type] || 1) - h / 15);
      else if (by) add(s, 'Bombardment: ' + theName(by) + (ago(fired, by) < 15 ? ' shelling ' : ' closing on ') + theName(s), ago(fired, by) < 15 ? 2.8 : 1.5);
    }
    const NO = WW.nightOps;
    if (NO && NO.shells) for (const sh of NO.shells) {
      if (!sh.lit) continue;
      let best = null, bd = sh.r * sh.r;
      for (const s of WW.world.ships) if (live(s) && s.nation !== sh.nation) { const d = WW.dist2(s.x, s.z, sh.x, sh.z); if (d < bd) { bd = d; best = s; } }
      if (best) add(best, 'Star shell over ' + theName(best), 3.4);
    }
    if (NO && NO.lights) for (const L of NO.lights) if (live(L.ship)) add(L.ship, theName(L.ship) + '’s searchlight' + (live(L.target) ? ' on ' + theName(L.target) : ''), 3.1);
    for (const s of U) {
      const f = ago(fired, s);
      if (!s.isBase && live(s.target) && f < 12) add(s, pre + theName(s) + ' firing on ' + theName(s.target), 2 + (VAL[s.type] || 1) * 0.5 - f / 24);
    }
    for (const s of U) {
      if (s.isBase || s.type === 'submarine' || !live(s.target)) continue;
      const d = WW.dist(s.x, s.z, s.target.x, s.target.z) - (s.type === 'battleship' ? 60 : s.type === 'cruiser' ? 30 : 0);
      add(s, pre + nameOf(s) + ' in action', 1 - Math.min(0.9, Math.max(0, d) / 2000));
    }
    return out.sort((a, b) => b.score - a.score);
  }
  // every current action: planes in the air first (a story arc, else any flight still up at dusk), then the ships
  function actions() {
    const a = WW.camStory.anyArc(), out = shipActions();
    // a strong arc (a strike forming or going in, a scramble, a rescue) leads; a snooper or an ace below a ship
    // under fire or shelling; any plane merely up, above a ship that only has a target
    if (a && live(a.lead)) out.push({ subj: a.lead, label: WW.camStory.titleOf(a.lead, a.mission).join(' · ') + (dark() ? ' · last light' : ''), score: a.score >= 7 ? 9 : a.score > 0 ? 2.6 : 1.5, etaReal: 0 });
    return out.sort((x, y) => y.score - x.score);
  }
  // the front line: the ship nearest an enemy ship or base, else any ship afloat
  function frontLine() {
    const U = units().filter(s => s.type !== 'submarine');
    let best = null, bd = 1e18;
    for (const a of U) if (!a.isBase) for (const b of U) if (a.nation !== b.nation) { const d = WW.dist2(a.x, a.z, b.x, b.z); if (d < bd) { bd = d; best = a; } }
    if (best) return { subj: best, label: 'Front line: ' + theName(best) + ', nearest the enemy', etaReal: 0 };
    const s = U.find(o => !o.isBase);
    return s ? { subj: s, label: theName(s), etaReal: 0 } : null;
  }

  const nd = () => !!(WW.camNormandy && WW.camNormandy.on());
  function f() {
    ST.f++;
    if (nd()) return WW.camNormandy.f();
    if (!WW.game || WW.game.state !== 'battle') return 'Follow: only during a battle';
    if (following()) { handBack(); return 'Follow: off · director camera'; }
    // camera4: F = the best ARC now (camera_director.js fPick): the arc running is kept and named (the user adopts it),
    // else the best ship arc (a destroyer charge, a gun duel, a carrier under attack) or the best air story
    const fp = WW.camDirector && WW.camDirector.fPick();
    if (fp) {
      director(); ST.jumps++; WW.camDirector.stats.f++; labelT = 0;
      if (fp.keep === 'ship') { WW.camDirector.adoptShip(); cur = { item: { label: fp.label }, subj: fp.subj, ship: true, arc: true, at: wall() }; return 'Follow: ' + fp.label; }
      if (fp.keep === 'air' && WW.camStory.adopt()) { cur = { item: { label: fp.label }, subj: fp.subj, ship: false, at: wall() }; return 'Follow: ' + fp.label; }
      if (fp.ship) {
        if (WW.camStory.active()) WW.camStory.stop();
        if (WW.camDirector.startShipArc(fp.ship, true)) { cur = { item: { label: fp.label }, subj: fp.subj, ship: true, arc: true, at: wall() }; return 'Follow: ' + fp.label; }
      }
      if (fp.air) {
        const a = fp.air; WW.camStory.begin({ lead: a.lead, mission: a.mission, item: a.item || null });
        cur = { item: { label: fp.label }, subj: a.lead, ship: false, at: wall() }; return 'Follow: ' + fp.label;
      }
    }
    // (no arc: the director's single best candidate NOW (camera_director.js bestNow: the same ladder the arbiter cuts on,
    // forecast impacts included), filmed as the user's shot: the attack lock still holds it to the result
    const best = WW.camDirector && WW.camDirector.bestNow();
    if (best) {
      director();
      if (best.keep) { // the director is already on it: F names it and holds it as the user's pick
        best.shot.user = true; best.shot.fkey = true; ST.jumps++; WW.camDirector.stats.f++;
        cur = { item: { label: best.label }, subj: best.subj, ship: true, at: wall() }; labelT = 0;
        return 'Follow: ' + best.label;
      }
      if (WW.camStory.active()) WW.camStory.stop();
      if (WW.cam.take(best, { user: true })) {
        ST.jumps++; WW.camDirector.stats.f++;
        cur = { item: { label: best.label }, subj: best.subj, ship: true, at: wall() }; labelT = 0;
        return 'Follow: ' + best.label;
      }
    }
    const L = WW.camFinder ? WW.camFinder.list().filter(i => i.subj && !i.subj.removed && (i.etaReal >= 0)) : [];
    if (L.length) { const it = jump(L[0]); return 'Follow: ' + say(it); }
    const b = bestNow();
    if (b) { jump(b); return 'Follow: ' + b.label; }
    director(); WW.cam.cut();
    return 'Follow: nothing afloat · director camera';
  }
  // Tab / Shift+Tab (dir +1 / -1) through the upcoming attacks; kinds narrows the list ('dogfight', 'danger')
  function cycle(dir, which) {
    if (nd() && WW.game && WW.game.state === 'battle') { ST.cycles++; return WW.camNormandy.cycle(dir, which); }
    if (!WW.game || WW.game.state !== 'battle' || !WW.camFinder) return '';
    ST.cycles++;
    let L;
    if (which === 'dogfight') {
      L = WW.world.planes.filter(p => ok(p) && p.kind === 'fighter' && p.state === 'attack' && ok(p.foe))
        .map(p => ({ subj: p, label: nameOf(p) + ' in a dogfight' + (p.foe.kind !== 'fighter' ? ' with ' + (p.foe.squadron ? p.foe.squadron.short : 'bombers') : ''), etaReal: 0, eta: 0 }));
    } else if (which === 'danger') L = WW.camFinder.upcoming(['torps', 'danger']);
    else L = WW.camFinder.upcoming(['strike', 'push', 'anvil', 'run', 'level', 'bandits', 'torps']);
    // one entry per strike wave (its earliest moment: the wave's strike / push / anvil items are one attack), per fighter element and per ship
    const seen = new Set();
    L = L.filter(i => { if (!i.subj || i.subj.removed) return false; const k = i.subj.wave || i.subj.element || i.subj; if (seen.has(k)) return false; seen.add(k); return true; });
    // nothing of the kind (a night gun action, no planes up): cycle the current actions instead, saying so
    let pre = '';
    if (!L.length) {
      pre = (which === 'dogfight' ? 'No dogfight right now' : which === 'danger' ? 'No ship in danger right now' : 'No air attacks on the way') + ' · ';
      L = which === 'danger' ? shipActions() : actions();
      if (!L.length) { const fl = frontLine(); if (fl) L = [fl]; }
      if (!L.length) return pre + 'nothing afloat';
    }
    const f0 = following() || (cur && cur.subj);
    let i = L.findIndex(it => it.subj === f0);
    if (i < 0) i = L.findIndex(it => f0 && ((f0.wave && it.subj.wave === f0.wave) || (f0.element && it.subj.element === f0.element)));
    i = i < 0 ? (dir > 0 ? 0 : L.length - 1) : (i + dir + L.length) % L.length;
    jump(L[i]);
    return pre + (i + 1) + '/' + L.length + ' · ' + say(L[i]);
  }

  // ---------- the label ----------
  function labelText() {
    const st = WW.game && WW.game.state;
    if (st !== 'battle' || !WW.cam || WW.cam.mode === 'map') return '';
    if (nd()) return WW.camNormandy.label();
    const fc = WW.freecam && WW.freecam.active();
    const fo = fc && WW.freecam.following();
    if (fc && fo) return 'Following ' + nameOf(fo) + '  ·  drag: orbit  ·  scroll: zoom  ·  O: ' + (WW.freecam.rel() ? 'heading-relative' : 'world-fixed') + '  ·  F: director';
    const shot = WW.cam._shot();
    const ua = WW.camDirector && WW.camDirector.userArc();
    if (ua && cur && cur.arc) return 'Following ' + cur.item.label;
    if (cur && cur.ship && shot && shot.user && shot.subj === cur.subj) { // the user jumped to a ship
      const it = WW.camFinder && WW.camFinder.about(cur.subj), lab = shot.kind === 'brace' && shot.label ? shot.label : cur.item.label;
      const tail = it && !it.vague && it.etaReal >= 3 && shot.kind !== 'brace' ? say(it) : lab;
      return 'Following ' + (cur.subj.stats && tail ? tail : nameOf(cur.subj) + '  \u00b7  ' + tail);
    }
    const sto = WW.camStory.story();
    if (sto) { // the lead's own attack ahead (a wave-mate's only while the lead still carries its weapon)
      const L = sto.lead, it = WW.camFinder && (L.kind === 'fighter' || L.ordnance ? WW.camFinder.about(L) : WW.camFinder.list().find(i => i.subj === L) || null);
      const tail = it && it.etaReal >= 3 ? '  ·  ' + say(it) : '';
      if (!sto.begun) return sto.user || sto.item ? 'Next: ' + (it ? say(it) : nameOf(sto.lead)) : '';
      return 'Following ' + nameOf(sto.lead) + tail;
    }
    return '';
  }
  function label(rdt) {
    if ((labelT -= rdt) > 0 || typeof document === 'undefined') return;
    labelT = 0.5;
    if (!labelEl) {
      labelEl = document.createElement('div'); labelEl.id = 'follow-label';
      labelEl.style.cssText = 'position:fixed;left:16px;bottom:12px;font:12px/1.4 system-ui,sans-serif;letter-spacing:0.03em;color:rgba(255,255,255,0.88);text-shadow:0 1px 3px rgba(0,0,0,0.55);pointer-events:none;opacity:0;transition:opacity 0.6s;z-index:5;max-width:calc(100vw - 32px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      document.body.appendChild(labelEl);
    }
    const t = labelText();
    if (t) labelEl.textContent = t;
    labelEl.style.opacity = t ? '1' : '0';
  }
  if (WW.cam && WW.cam.update) {
    const u = WW.cam.update;
    WW.cam.update = function (rdt) { const r = u.apply(this, arguments); try { label(rdt || 0); } catch (e) { /* the label never breaks the camera */ } return r; };
  }

  // the director's own candidates: an attack 0-35 s away (the finder knows it before it happens), on the score ladder
  // of camera_score.js (capped at 8: an attack about to happen never beats one under way or a ship being hit)
  const prOf = it => (WW.camScore ? WW.camScore.prOf(it) : Math.min(8, 5.5 + it.score * 0.6));
  (WW.camHooks = WW.camHooks || []).push(function (add, dur) {
    if (!WW.camFinder) return;
    for (const it of WW.camFinder.list()) {
      if (it.etaReal > 35 || !it.subj || it.subj.removed) continue;
      if (isPlane(it.subj)) { if (ok(it.subj)) add(prOf(it), 'chase', it.subj, { dur: dur(12, 15), target: it.target && it.target.stats ? it.target : null, item: it.kind }); }
      else if (it.kind === 'torps' && !WW.camDirector) add(prOf(it), 'orbit', it.subj, { r: it.subj.stats.length * 1.5 + 20, dur: dur(12, 16), w: 0.05, hgt: 0.3, item: 'torps' }); // (camera_director.js braces the ship)
      else if (it.kind === 'danger') add(prOf(it), 'orbit', it.subj, { r: it.subj.stats.length * 1.4 + 18, dur: dur(12, 16), w: 0.045, item: 'danger' });
    }
  });
  WW.on('roundStart', () => { cur = null; fired.clear(); hit.clear(); });
  WW.on('setupStart', () => { cur = null; });
  WW.camFollow = { f, cycle, jump, following, handBack, labelText, stats: ST, _mission: missionOf };
})(window.WW);
