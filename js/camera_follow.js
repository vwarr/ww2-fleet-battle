// camera_follow.js (camera): WW.camFollow, the user's "follow the action" controls on top of the director, story
// mode (camera_story.js), the imminent-action finder (camera_finder.js) and the free camera (freecam.js):
//   F           always does something visible: jump to the most imminent attack (a plane: a story on it; a ship: an
//               orbit on it), else the best current action, else the front line, each with a short label. While the
//               user follows something (their story, a followed subject, a jumped-to ship), F hands back to the director.
//   Tab / Shift+Tab   next / previous upcoming attack, in time order;  8 next dogfight;  9 next ship in danger.
// A small label (bottom left) says what is followed and, while waiting, "strike reaches the cruiser in ~25 s".
// It also adds the finder's imminent moments to the director's candidates (WW.camHooks).
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
  const say = it => it.label + (it.etaReal >= 3 ? ' in ' + etaText(it) : '');
  function director() { // the director has the camera: leave map view and the free camera
    if (WW.cam.mode === 'map') WW.cam.toggle();
    if (WW.freecam && WW.freecam.release) WW.freecam.release();
  }
  function filmShip(s, secs) {
    WW.cam.film({ kind: 'orbit', subj: s, r: s.stats.length * 1.5 + 22, dur: WW.clamp(secs, 10, 40), w: 0.05, hgt: 0.3, user: true });
  }
  // jump to a finder item (or { subj, label }): a plane gets a story, a ship an orbit
  function jump(it) {
    director(); ST.jumps++;
    const s = it.subj;
    if (isPlane(s)) {
      WW.camStory.begin({ lead: s, mission: s.kind === 'fighter' && !s.target ? 'cap' : 'strike', item: it.eta !== undefined ? it : null });
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
    const shot = WW.cam._shot();
    if (cur && cur.ship && shot && shot.user && shot.subj === cur.subj) return cur.subj;
    return null;
  }
  function handBack() {
    ST.handbacks++; cur = null;
    if (WW.camStory.active()) WW.camStory.stop();
    if (WW.freecam && WW.freecam.release) WW.freecam.release();
    WW.cam.cut();
  }
  // the best current action when nothing is imminent: a ship in a gunfight, else the front line
  function bestNow() {
    const a = WW.camStory.anyArc();
    if (a) return { subj: a.lead, label: WW.camStory.titleOf(a.lead, a.mission).join(' · '), etaReal: 0 };
    let best = null, bd = 1e9;
    for (const s of WW.world.ships) {
      if (!s.alive || !s.target || s.type === 'submarine') continue;
      const d = WW.dist(s.x, s.z, s.target.x, s.target.z) - (s.type === 'battleship' ? 60 : s.type === 'cruiser' ? 30 : 0);
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { subj: best, label: nameOf(best) + ' in action', etaReal: 0 } : null;
  }

  function f() {
    ST.f++;
    if (!WW.game || WW.game.state !== 'battle') return 'Follow: only during a battle';
    if (following()) { handBack(); return 'Follow: off · director camera'; }
    const L = WW.camFinder ? WW.camFinder.list().filter(i => i.subj && !i.subj.removed && (i.etaReal >= 0)) : [];
    if (L.length) { const it = jump(L[0]); return 'Follow: ' + say(it); }
    const b = bestNow();
    if (b) { jump(b); return 'Follow: ' + b.label; }
    director(); WW.cam.cut();
    return 'Follow: no attacks yet · the fleets close';
  }
  // Tab / Shift+Tab (dir +1 / -1) through the upcoming attacks; kinds narrows the list ('dogfight', 'danger')
  function cycle(dir, which) {
    if (!WW.game || WW.game.state !== 'battle' || !WW.camFinder) return '';
    ST.cycles++;
    let L;
    if (which === 'dogfight') {
      L = WW.world.planes.filter(p => ok(p) && p.kind === 'fighter' && p.state === 'attack' && ok(p.foe))
        .map(p => ({ subj: p, label: nameOf(p) + ' in a dogfight' + (p.foe.kind !== 'fighter' ? ' with ' + (p.foe.squadron ? p.foe.squadron.short : 'bombers') : ''), etaReal: 0, eta: 0 }));
    } else if (which === 'danger') L = WW.camFinder.upcoming(['torps', 'danger']);
    else L = WW.camFinder.upcoming(['strike', 'push', 'anvil', 'bandits', 'torps']);
    L = L.filter(i => i.subj && !i.subj.removed);
    if (!L.length) return which === 'dogfight' ? 'No dogfight right now' : which === 'danger' ? 'No ship in danger right now' : 'No attacks on the way yet';
    const f0 = following() || (cur && cur.subj);
    let i = L.findIndex(it => it.subj === f0 || (f0 && f0.wave && it.subj.wave === f0.wave));
    i = i < 0 ? (dir > 0 ? 0 : L.length - 1) : (i + dir + L.length) % L.length;
    jump(L[i]);
    return (i + 1) + '/' + L.length + ' · ' + say(L[i]);
  }

  // ---------- the label ----------
  function labelText() {
    const st = WW.game && WW.game.state;
    if (st !== 'battle' || !WW.cam || WW.cam.mode === 'map') return '';
    const fc = WW.freecam && WW.freecam.active();
    const fo = fc && WW.freecam.following();
    if (fc && fo) return 'Following ' + nameOf(fo) + '  ·  drag: orbit  ·  scroll: zoom  ·  O: ' + (WW.freecam.rel() ? 'heading-relative' : 'world-fixed') + '  ·  F: director';
    const shot = WW.cam._shot();
    if (cur && cur.ship && shot && shot.user && shot.subj === cur.subj) { // the user jumped to a ship
      const it = WW.camFinder && WW.camFinder.about(cur.subj);
      return 'Following ' + nameOf(cur.subj) + '  \u00b7  ' + (it ? say(it) : cur.item.label);
    }
    const sto = WW.camStory.story();
    if (sto) {
      const it = WW.camFinder && WW.camFinder.about(sto.lead);
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

  // the director's own candidates: an attack 0-35 s away (the finder knows it before it happens)
  (WW.camHooks = WW.camHooks || []).push(function (add, dur) {
    if (!WW.camFinder) return;
    for (const it of WW.camFinder.list()) {
      if (it.etaReal > 35 || !it.subj || it.subj.removed) continue;
      if (isPlane(it.subj)) { if (ok(it.subj)) add(7.5 + it.drama, 'chase', it.subj, { dur: dur(12, 15) }); }
      else if (it.kind === 'torps') add(8 + it.drama, 'orbit', it.subj, { r: it.subj.stats.length * 1.5 + 20, dur: dur(12, 16), w: 0.05, hgt: 0.3 });
      else if (it.kind === 'danger') add(4 + it.drama, 'orbit', it.subj, { r: it.subj.stats.length * 1.4 + 18, dur: dur(12, 16), w: 0.045 });
    }
  });
  WW.on('roundStart', () => { cur = null; });
  WW.on('setupStart', () => { cur = null; });
  WW.camFollow = { f, cycle, jump, following, handBack, labelText, stats: ST };
})(window.WW);
