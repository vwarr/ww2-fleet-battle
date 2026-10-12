// camera_score.js (camera): WW.camScore, ONE director score across planes, ships in combat, the base and the overview
// (docs/camera_audit.md, Phase 2 item 3). Every candidate the director builds (camera.js candidates(): its own plane
// and ship shots, camera_scenes.js for the ships and the base, camera_follow.js for the imminent attacks) carries a
// deterministic drama `pr` on one ladder:
//   11 a magazine, a carrier / battleship going down   10 another sinking   8.5-9.5 torpedoes crossing a hull, the base
//   bombarded, a ship under air attack   8-8.5 a torpedo run / a dive UNDER WAY, a raid on the base   7-8 a gun duel
//   with hits, the straddled target   6.5-8 an attack about to happen (closer = more; a vague wait less)   5.5-6.5 a plain
//   gun duel, a dogfight, a carrier launch   2.6-5 quiet ship shots, planes in transit   2 the wide establishing shot.
// Once a second it RE-EVALUATES the running shot: its live worth (the best candidate about its own subject, else a
// floor by shot kind) plus a hysteresis bonus (3 falling to 1 over the shot) against the best other candidate; a
// bigger action elsewhere takes the camera (a soft cut), never inside the attack lock, a hand-off, the user's or a
// test shot, and never before the shot is MIN_T old. Story mode (camera_story.js) asks the same scale whether its
// automatic story should yield (yields(shot)) and whether an imminent attack is worth cutting in for (prOf(item)).
// Visual only: reads the sim, never writes it; no WW.rand. Load after camera_follow.js.
window.WW = window.WW || {};
(function (WW) {
  const MIN_T = 5, MIN_PR = 7, BONUS = [3, 1], FLOOR = { wide: 2, low: 3, flyby: 3, orbit: 3, chase: 3, story: 5, duel: 4, base: 4, aa: 4, profile: 4, ots: 4 }; // story: a mission being told is worth a little on its own
  const wall = () => performance.now() / 1000;
  let tickT = 0;
  const ST = { recuts: 0, yields: 0, byKind: {} };
  const log = [];

  // the drama of a finder item (camera_finder.js) as a director candidate: capped at 8 so an attack about to happen
  // never beats one under way or a ship being hit; farther off (past 10 real s) and vague waits (the anvil set-up, the
  // wheel, fighters closing) are worth less
  function prOf(it) {
    if (!it) return 0;
    const far = Math.max(0, (it.etaReal || 0) - 10) * 0.08;
    if (it.kind === 'torps') return Math.min(9.3, 7.8 + Math.min(1.5, it.score * 0.4));
    if (it.kind === 'danger') return Math.min(7, 4 + it.score * 0.8);
    return Math.min(8, 5.5 + it.score * 0.6) - far - (it.vague ? 0.7 : 0);
  }
  // the things a shot is about: its subject, the plane it watches, its target
  function about(shot) {
    const set = [];
    for (const o of [shot.subj, shot.plane, shot.tship, shot.target, shot.threat]) if (o && !o.diorama && o.x !== undefined && set.indexOf(o) < 0) set.push(o);
    return set;
  }
  // the running shot's live worth: the best candidate about the same thing, else the floor of its kind
  function worth(shot, cands) {
    const A = about(shot);
    let w = -1;
    for (const c of cands) if (A.indexOf(c.subj) >= 0 || (c.plane && A.indexOf(c.plane) >= 0) || (c.target && A.indexOf(c.target) >= 0)) w = Math.max(w, c.pr);
    if (w >= 0) return w;
    return FLOOR[shot.kind] !== undefined ? FLOOR[shot.kind] : 3;
  }
  // the best candidate not about the running shot's subject
  function best(shot, cands) {
    const A = shot ? about(shot) : [];
    let b = null;
    for (const c of cands) { if (c.kind === 'wide' || A.indexOf(c.subj) >= 0 || (c.plane && A.indexOf(c.plane) >= 0)) continue; if (!b || c.pr > b.pr) b = c; }
    return b;
  }
  const bonus = shot => WW.lerp(BONUS[0], BONUS[1], WW.clamp((shot.t - MIN_T) / Math.max(1, (shot.dur || 10) - MIN_T), 0, 1));
  // the shot may be re-evaluated: not locked, not a hand-off, not the user's / a test's, old enough
  function free(shot) {
    if (!shot || shot.user || shot.pr >= 99 || shot.stage || shot.t < MIN_T) return false;
    if (WW.cam.locked && WW.cam.locked()) return false;
    const sto = WW.camStory && WW.camStory.story();
    if (sto && (sto.user || !sto.begun)) return false; // the user's story; a story waiting for this shot to end
    return true;
  }
  // camera_story.js: should the automatic story on `shot` give way to the best action elsewhere? Returns the candidate.
  function yields(shot, cands) {
    if (!free(shot)) return null;
    const C = cands || WW.cam._candidates();
    const b = best(shot, C), w = worth(shot, C);
    return b && b.pr >= MIN_PR && b.pr > w + bonus(shot) ? b : null;
  }
  // camera_story.js: is this imminent item worth cutting into the running shot for?
  function beats(it) {
    const shot = WW.cam._shot();
    if (!shot || shot.pr >= 99 || shot.user) return true;
    if (shot.stage || (WW.cam.locked && WW.cam.locked())) return false;
    const C = WW.cam._candidates();
    return prOf(it) > worth(shot, C) + (shot.t < MIN_T ? BONUS[0] : bonus(shot));
  }
  function tick(rdt) {
    if ((tickT -= rdt) > 0 || !(WW.game && WW.game.state === 'battle') || WW.cam.mode !== 'director' || (WW.freecam && WW.freecam.active())) return;
    tickT = 1;
    const shot = WW.cam._shot();
    if (!shot || WW.cam.forced() || !free(shot)) return;
    const C = WW.cam._candidates();
    const b = best(shot, C), w = worth(shot, C);
    if (!b || b.pr < MIN_PR || b.pr <= w + bonus(shot)) return;
    const from = (shot.story ? 'story/' + shot.sk : shot.kind) + ' ' + w.toFixed(1);
    if (!WW.cam.recut(b)) return;
    ST.recuts++; const k = b.kind + (b.why ? ':' + b.why : ''); ST.byKind[k] = (ST.byKind[k] || 0) + 1;
    log.push({ at: wall(), from, to: k + ' ' + b.pr.toFixed(1) }); if (log.length > 100) log.shift();
  }
  if (WW.cam && WW.cam.update) { const u = WW.cam.update; WW.cam.update = function (rdt) { try { tick(rdt || 0); } catch (e) { console.error('camScore', e); } return u.apply(this, arguments); }; }
  WW.on('roundStart', () => { tickT = 0; });
  WW.camScore = { prOf, worth, best, yields, beats, MIN_T, MIN_PR, stats: ST, log };
})(window.WW);
