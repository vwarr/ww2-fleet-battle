// camera_lock.js (camera): WW.camLock, the ATTACK LOCK for the director (camera.js) and story mode (camera_story.js).
// Once the camera is committed to an attack it holds through the release and the result: a torpedo bomber on its
// run (the hand-off then follows the torpedo to the hit or the miss), a dive bomber from the roll to the bomb's
// impact, an aborted run's beat, a ship's salvo in the air to the splashes, a sinking's first seconds. While a shot
// is locked nothing ends it (not its duration, not a story phase change, switch or cutaway, not the base alarm);
// only a much bigger event (a magazine explosion, a big ship going down: pr >= PREEMPT) can cut in, and never in the
// RELEASE WINDOW (the last seconds before the drop, the dive, a hand-off in progress). Visual only: reads the sim.
// Normandy's ground-level shots (shot.nd) answer for themselves: WW.camNormandy.lock(shot).
window.WW = window.WW || {};
(function (WW) {
  const PREEMPT = 10, DROP_FAR = 100, REL_WIN = 30;   // the release window: a run closer than its drop range + 30 u
  const wall = () => performance.now() / 1000;
  const ok = p => p && !p.removed && p.alive;
  let salvo = new Map();                              // ship -> the wall time its last salvo has landed (+ the splash beat)
  const ST = { held: 0, preempted: 0, refused: 0 };

  const subjectOf = shot => (shot.plane || shot.subj);
  // what the shot is committed to right now: null, or { why, release } (release: never pre-empt)
  function state(shot) {
    if (!shot || (shot.user && !shot.fkey) || shot.pr >= 99) return null; // the user's and the tests' shots are their own business (F's pick, fkey, keeps the lock)
    if (shot.stage === 'hold') return shot.st < (shot.hold || 0) ? { why: 'hold', release: true } : null; // the beat on the result, then free
    if (shot.stage) return { why: shot.stage, release: true }; // a bomb / torpedo hand-off in flight
    if (shot.nd) return WW.camNormandy ? WW.camNormandy.lock(shot) : null; // Normandy's shots: a ramp held until the men are off (camera_normandy.js)
    if (shot.kind === 'brace' && shot.ev) { // camera_director.js: a ship braced for an impact, held to it and its beat
      if (shot.doneAt === undefined) return { why: 'impact', release: shot.ev.etaReal < 1.5 };
      return shot.t < shot.doneAt + 1.5 ? { why: 'beat', release: true } : null;
    }
    const s = subjectOf(shot);
    if (!s || s.diorama) return null;
    if (s.pt && s.kind) {
      if (!ok(s)) return null;
      const t = s.target;
      if (s.kind === 'torpedo' && s.phase === 'run' && s.ordnance && t && t.alive)
        return { why: 'run', release: WW.dist(s.x, s.z, t.x, t.z) < (s.dropR || DROP_FAR) + REL_WIN };
      if (s.kind === 'dive' && (s.phase === 'roll' || s.phase === 'dive') && s.ordnance) return { why: 'dive', release: true };
      if (s.kind === 'torpedo' && s.phase === 'out' && s.ordnance && (s.phaseT || 0) > 0) return { why: 'abort', release: false }; // the beat after an aborted run
      return null;
    }
    if (s.stats && !s.isLand) { // (a wrecked landing craft is 'sinking' with no sinkT: never a lock)
      const u = salvo.get(s); // a gun-duel shot holds its first salvo to the splashes (not a running duel for ever: 12 s at most)
      if (shot.kind === 'duel' && shot.t < 12 && u && wall() < u) return { why: 'salvo', release: false };
      if (s.sinking && (s.sinkT || 0) < 6) return { why: 'sinking', release: false };
    }
    return null;
  }
  // may a candidate of priority pr cut into this shot?
  function allows(shot, pr) {
    const L = state(shot);
    if (!L) return true;
    if (L.release || !(pr >= PREEMPT)) { ST.refused++; return false; }
    ST.preempted++;
    return true;
  }
  WW.on('shellFired', e => {
    if (!e || !e.ship || !e.proj || !e.proj.target || e.proj.target.isBase || (e.cal !== 'big' && e.cal !== 'med')) return;
    const rate = WW.camFinder && WW.camFinder.rate ? Math.max(0.1, WW.camFinder.rate()) : 0.5;
    salvo.set(e.ship, wall() + (e.proj.T || 2) / rate + 2.5);
  });
  WW.on('roundStart', () => { salvo = new Map(); });
  WW.camLock = { state, allows, locked: shot => !!state(shot), PREEMPT, stats: ST };
})(window.WW);
