// Director camera audit (docs/camera_audit.md): auto rounds in render mode on a fake 30 fps frame clock (no pixels
// drawn; the director, story mode, finder, captions and hand-offs run every frame as in the game), over several
// scenarios and seeds. Every real second it logs the shot (kind / story phase / hand-off stage / subject), the
// finder's items, the follow label's ETA promise, an INDEPENDENT oracle of the best action going on (torpedo runs,
// dives, torpedoes in the water, gun duels with hits, ships hit / burning / sinking, the base under attack), whether
// the camera is on it, and the angle quality (subject / target in frame, occlusion, line-of-action flips, snaps).
// Events: every weapon drop and impact with the shot at that instant (attack continuity), torpedo runs that end
// without a drop, sinkings, magazines, base events, every caption.
// Metrics (node side, summarize()): M1 promise kept, M2 attack continuity, M3 best-action coverage, M4 variety,
// M5 dead air, M6 angle quality. Raw per-round JSON goes to tests/shots/camera_audit/raw_<tag>, so before / after runs
// diff on the same seeds. Math.random is seeded per round (the camera's own dice), so a round replays and
// --sheet re-renders a window of it as a contact sheet (ImageMagick montage); the sheet's shot list (shots.txt) is
// checked against the survey's raw JSON when it exists.
// Usage: BASE_URL=http://localhost:8779/ CHROMIUM=... node tests/camera_audit.js [--scen standard,carrier_duel,midway,battle_line,night,dusk,odd]
//        [--seeds 1,2,3] [--sim 600] [--workers 2] [--out dir] [--summarize] [--windows] [--sheet SCEN:SEED:from:to[:every]] [--tag name] [--fast]
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { chromium } = require('playwright');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SCENS = arg('--scen', 'standard,carrier_duel,midway,battle_line,night,dusk,odd').split(',');
const SEEDS = arg('--seeds', '1,2,3').split(',').map(Number);
const SIM = +arg('--sim', 600), WORKERS = +arg('--workers', 2), TAG = arg('--tag', 'run');
const OUT = arg('--out', path.join(__dirname, 'shots', 'camera_audit'));
const SHEET = arg('--sheet', null), SUMMARIZE = args.includes('--summarize'), FAST = args.includes('--fast'); // --fast: stub the per-frame visual modules (their event handlers then draw fewer of the camera's dice, so a --sheet replay of a --fast survey shows other shots)
const BASE_URL = process.env.BASE_URL || 'http://localhost:8779/';
const FONT = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc'].find(f => fs.existsSync(f)) || 'Helvetica';
const rep = (t, n) => Array(n).fill(t);
const ODD = [['cv_vs_pt', rep('carrier', 3), rep('pt', 10)], ['cv3_vs_bb2ca2', rep('carrier', 3), ['battleship', 'battleship', 'cruiser', 'cruiser']],
  ['dd_swarm_vs_bb', rep('destroyer', 8), ['battleship']], ['bb4_vs_bb4', rep('battleship', 4), rep('battleship', 4)]];
const SCEN = {
  standard: { random: true },
  carrier_duel: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  midway: { A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  battle_line: { A: ['battleship', 'battleship', 'cruiser', 'cruiser'], B: ['battleship', 'battleship', 'cruiser', 'cruiser'] },
  night: { random: true, tod: 'night' },
  night_cv: { A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'], tod: 'night' },   // night_plan.js: a carrier-only night
  night_bl: { A: ['battleship', 'battleship', 'cruiser', 'cruiser'], B: ['battleship', 'battleship', 'cruiser', 'cruiser'], tod: 'night' },
  dusk: { random: true, tod: 120 },
  odd: { odd: true }
};
function specOf(name, seed) {
  const s = SCEN[name]; if (!s) throw new Error('unknown scenario ' + name);
  if (s.odd) { const o = ODD[(seed - 1) % ODD.length]; return { name, seed, A: o[1], B: o[2], odd: o[0], aNation: seed % 2 ? 'USN' : 'IJN', fast: FAST }; }
  return Object.assign({ name, seed, aNation: s.aFixed || (seed % 2 ? 'USN' : 'IJN'), fast: FAST }, s);
}

// ---------------- page side ----------------
function install(cfg) {
  const A = window.__audit = { rec: [], ev: [], drops: [], shots: [], caps: [], runs: [], cfg };
  const wall = () => performance.now() / 1000;
  const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, PI = Math.PI;
  const VALUE = { carrier: 1.6, battleship: 1.4, cruiser: 1.1, destroyer: 0.8, submarine: 0.6, pt: 0.4 };
  let aid = 0, sid = 0, wid = 0;
  const idOf = o => !o ? null : o.stats ? 's' + o.id : (o.pt || o.kind) ? 'p' + (o.__aid || (o.__aid = ++aid)) : o.isBase ? 'base' : 'd';
  const cls = o => !o ? '' : o.stats ? o.type : o.kind ? o.kind : o.isBase ? 'base' : 'diorama';
  const waveId = p => (p && p.wave ? (p.wave.__wid || (p.wave.__wid = ++wid)) : 0);
  const ref = o => o ? { id: idOf(o), c: cls(o), n: o.nation || '', sq: o.squadron ? o.squadron.short : undefined, wv: waveId(o) || undefined, x: Math.round(o.x), z: Math.round(o.z) } : null;
  const ok = p => p && !p.removed && p.alive;
  const base = () => (WW.islandBase && WW.islandBase.base) || null;
  const _v = new THREE.Vector3(), _f = new THREE.Vector3();

  // ---- placement (sim_behaviour.js's copy of main.js's spiral) ----
  const SLOTS = { carrier: [[0, 0], [0, -50], [0, 50]], battleship: [[72, -28], [72, 28]], cruiser: [[36, -64], [36, 64], [40, -112], [40, 112]],
    destroyer: [[98, -56], [100, 0], [98, 56]], submarine: [[118, -30], [118, 30]], pt: [[112, 32], [108, 84], [112, -32]] };
  function nearestOk(x, z, type, placed) {
    const md = WW.SHIP_TYPES[type].minDepth + 1;
    const clear = (px, pz) => placed.every(p => { const n = G.minSpacing(type, p.type); return WW.dist2(px, pz, p.x, p.z) >= n * n; });
    for (const strict of [true, false]) for (let r = 0; r < 200; r += 3) {
      const n = Math.max(1, Math.round(r / 2));
      for (let i = 0; i < n; i++) {
        const a = i / n * PI * 2, px = WW.clamp(x + Math.cos(a) * r, 5, W - 5), pz = WW.clamp(z + Math.sin(a) * r, 8, H - 8);
        if (WW.terrain.isNavigable(px, pz, md) && (!strict || clear(px, pz))) return { x: px, z: pz, type };
      }
    }
    return { x, z, type };
  }
  function placeFleet(types, nation, out) {
    const c = G.randomComposition().filter(e => e.nation === nation && e.type === 'carrier');
    const rx = c.reduce((s, e) => s + e.x, 0) / c.length, cz = c.reduce((s, e) => s + e.z, 0) / c.length, dir = nation === 'USN' ? 1 : -1;
    const placed = [], idx = {};
    for (const type of types) {
      const i = idx[type] = (idx[type] || 0) + 1, sl = SLOTS[type][(i - 1) % SLOTS[type].length];
      const p = nearestOk(rx + dir * sl[0], cz + dir * sl[1], type, placed); placed.push(p); out.push({ type, nation, x: p.x, z: p.z });
    }
  }
  // ---- the round ----
  WW.terrain.generate(cfg.seed); WW.seedRandom(cfg.seed); G.seed = cfg.seed;
  let comp;
  if (cfg.random) comp = G.randomComposition();
  else { comp = []; placeFleet(cfg.A, cfg.aNation, comp); placeFleet(cfg.B, WW.enemyOf(cfg.aNation), comp); }
  if (WW.dayNight) WW.dayNight.force = cfg.tod || null;
  if (WW.weather) WW.weather.force = null;
  if (WW.aces) WW.aces.reset();
  WW.seedRandom(cfg.seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
  G.baseChoice = cfg.base || null; G.composition = comp; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
  // --fast: no pixels are drawn, so skip the per-frame visual work the camera never reads (particles, crews, water, decals,
  // base props, audio). Not the default: those modules' event handlers draw on Math.random (the camera's dice) according
  // to the state their update builds, so a stubbed round takes other shots (and other slow-motion beats, so other sim
  // time) than the same seed with everything running; a replay (--sheet) must run the way the survey did. In the full
  // mode they run on a second seeded PRNG (window.__prng2) so the sheet frames rendered (post.render) do not shift the dice.
  const keep = cfg.keep || []; // modules kept running in fast mode (a probe: which one is coupled to the sim?)
  for (const [m, f] of [['fx', 'update'], ['crew', 'update'], ['water', 'update'], ['lifeboats', 'update'], ['dmgVis', 'pose'], ['dmgVis', 'draw'], ['dmgVis', 'unpose'], ['baseFx', 'update'], ['audio', 'update']]) {
    if (!WW[m] || !WW[m][f] || keep.indexOf(m) >= 0) continue;
    if (cfg.fast) WW[m][f] = () => {};
    else { const o = WW[m][f]; WW[m][f] = function () { const mr = Math.random; Math.random = window.__prng2; try { return o.apply(this, arguments); } finally { Math.random = mr; } }; }
  }
  A.tod = WW.dayNight ? WW.dayNight.kind : 'day'; A.comp = comp.map(c => c.nation[0] + ':' + c.type).join(' ');

  // ---- event hooks ----
  const fire = new Map(), hits = new Map(), strad = new Map(), hitAny = new Map(), latch = new Map(), projs = new Map();
  let baseBomb = -1e9, baseAlarm = -1e9;
  const shotNow = () => { const s = WW.cam._shot(); return s ? { sid: s.__sid, kind: s.kind, sk: s.sk, stage: s.stage || '', subj: idOf(s.subj), plane: idOf(s.plane), story: !!s.story } : null; };
  const dAt = (x, z) => { const c = WW.camera.position; return Math.hypot(c.x - x, c.z - z); };
  function inFrame(x, y, z, maxD) { // the point projects inside the frame, within maxD of the camera
    const c = WW.camera; if (dAt(x, z) > maxD) return false;
    _v.set(x, y || 0, z).project(c); return _v.z < 1 && Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1;
  }
  const near = (x, z, o) => o && !o.removed && Math.hypot(o.x - x, o.z - z) < 25;
  function filming(o) { const s = WW.cam._shot(); return !!(s && o && (s.subj === o || s.plane === o || s.tship === o || (s.kind === 'aa' && s.att === o) || (s.subj && s.subj.diorama && near(s.subj.x, s.subj.z, o)))); } // the deck shot films the attacker it looks at
  WW.on('shellFired', e => { if (e && e.ship && e.proj && e.proj.target && (e.cal === 'big' || e.cal === 'med')) fire.set(e.ship, { w: wall(), tg: e.proj.target }); });
  WW.on('shellLanded', e => {
    if (!e) return;
    if (e.ship) { (hits.get(e.ship) || hits.set(e.ship, []).get(e.ship)).push(wall()); return; }
    for (const s of WW.world.ships) if (s.alive && WW.dist2(s.x, s.z, e.x, e.z) < 20 * 20) { (strad.get(s) || strad.set(s, []).get(s)).push(wall()); break; }
  });
  WW.on('shipHit', e => { if (e && e.ship) hitAny.set(e.ship, { w: wall(), k: e.kind }); });
  const sinking = []; // sunk events still in their sink window: did the camera get there?
  WW.on('shipSunk', s => { if (s) { const e = { k: 'sunk', w: wall(), sim: WW.time.now, s: ref(s), shot: shotNow(), on: filming(s) || inFrame(s.x, 2, s.z, 300), _s: s }; A.ev.push(e); sinking.push(e); } });
  WW.on('magazine', e => { if (e && e.ship) { latch.set(e.ship, { w: wall(), why: 'magazine' }); A.ev.push({ k: 'magazine', w: wall(), s: ref(e.ship), shot: shotNow(), on: filming(e.ship) || inFrame(e.ship.x, 2, e.ship.z, 300) }); } });
  WW.on('deckHit', e => { if (e && e.ship) { latch.set(e.ship, { w: wall(), why: 'deck' }); A.ev.push({ k: 'deckHit', w: wall(), s: ref(e.ship), shot: shotNow(), on: filming(e.ship) || inFrame(e.ship.x, 2, e.ship.z, 300) }); } });
  WW.on('baseEvent', e => { if (!e) return; if (e.kind === 'bombard') baseBomb = wall(); if (e.kind === 'alarm') baseAlarm = wall(); A.ev.push({ k: 'base:' + e.kind, w: wall(), shot: shotNow(), on: inFrame(e.x, 2, e.z, 350) }); });
  WW.on('planeKill', e => { if (e && e.victim) A.ev.push({ k: 'kill', w: wall(), p: ref(e.victim), by: ref(e.shooter), shot: shotNow(), on: filming(e.shooter) || filming(e.victim) || inFrame(e.victim.x, e.victim.y, e.victim.z, 200) }); });
  WW.on('weaponDropped', e => {
    if (!e || !e.proj || !e.plane || !e.plane.kind) return; // planes only (ship torpedoes have no .kind)
    const p = e.plane, t = e.kind === 'bomb' ? (e.target || p.diveTgt || p.target) : (p.target || p.outTgt);
    const d = { i: A.drops.length, kind: e.kind, w: wall(), sim: WW.time.now, p: ref(p), t: ref(t), shot: shotNow(), on: filming(p), inF: inFrame(p.x, p.y, p.z, 160), tOn: !!t && inFrame(t.x, 2, t.z, 350) };
    A.drops.push(d); projs.set(e.proj, d);
  });
  WW.on('weaponImpact', e => {
    const d = e && projs.get(e.proj); if (!d) return;
    projs.delete(e.proj);
    const s = WW.cam._shot();
    d.imp = { w: wall(), sim: WW.time.now, hit: !!e.ship, dud: !!e.dud, s: ref(e.ship), shot: shotNow(), on: !!(s && (s.stage || s.tship)) || inFrame(e.x, 1, e.z, 250) };
  });
  const uc = WW.ui.caption;
  WW.ui.caption = function (a, b, secs, small) { A.caps.push({ w: wall(), sim: WW.time.now, t: (a || '') + (b ? ' | ' + b : ''), small: !!small, shot: shotNow() }); return uc.apply(this, arguments); };

  // ---- the oracle: what is the best action going on right now (independent of camera_finder.js) ----
  function oracle(now) {
    const out = [], add = (kind, score, s, t, x, z, y) => out.push({ kind, score: +score.toFixed(2), s: idOf(s), t: idOf(t), x: Math.round(x), z: Math.round(z), y: y || 2, _s: s, _t: t });
    const torps = [];
    const act = WW.combat && WW.combat._i && WW.combat._i.active;
    if (act) for (const q of act) if (!q.dead && q.kind === 'torp') torps.push(q);
    for (const p of WW.world.planes) {
      if (!ok(p)) continue;
      const t = p.target;
      if (p.kind === 'torpedo' && p.phase === 'run' && t && t.alive && p.ordnance) { const dh = WW.dist(p.x, p.z, t.x, t.z); add('run', 6 + 2 * (1 - WW.clamp((dh - 90) / 120, 0, 1)) + 0.5 * (VALUE[t.type] || 1), p, t, p.x, p.z, p.y); }
      else if (p.kind === 'dive' && (p.phase === 'roll' || p.phase === 'dive') && p.ordnance) { const tt = p.diveTgt || t; add('dive', 7.5 + 0.5 * (tt ? VALUE[tt.type] || 1 : 1), p, tt, p.x, p.z, p.y); }
      else if (p.kind === 'dive' && p.state === 'attack' && !p.phase && p.ordnance && t && t.alive && p.wing === 0) add('wheel', 3.5, p, t, p.x, p.z, p.y);
      else if (p.kind === 'fighter' && p.state === 'attack' && ok(p.foe) && Math.hypot(p.foe.x - p.x, p.foe.y - p.y, p.foe.z - p.z) < 40) add('dogfight', 3 + (p.foe.kind !== 'fighter' ? 1 : 0), p, p.foe, p.x, p.z, p.y);
    }
    for (const s of WW.world.ships) {
      if (s.removed) continue;
      if (s.sinking && (s.sinkT || 0) < 12) { add('sinking', 8 + 0.5 * (VALUE[s.type] || 1), s, null, s.x, s.z); continue; }
      if (!s.alive) continue;
      const L = latch.get(s); if (L && now - L.w < 15) add(L.why, 9, s, null, s.x, s.z);
      // torpedoes in the water that will cross this hull
      let best = 1e9, nt = 0;
      for (const q of torps) {
        if (q.nation === s.nation || s.submerged) continue;
        const fx = Math.cos(q.h), fz = Math.sin(q.h), dx = s.x - q.x, dz = s.z - q.z, along = dx * fx + dz * fz;
        if (along < 0 || along > 160 || Math.abs(dx * fz - dz * fx) > s.stats.length * 0.6 + 5) continue;
        nt++; best = Math.min(best, along / (q.speed || 12));
      }
      if (nt) add('torps', 6.5 + 1.5 * (1 - WW.clamp(best / 15, 0, 1)) + 0.3 * Math.min(3, nt), s, null, s.x, s.z);
      const h = hitAny.get(s); if (h && now - h.w < 4) add('hit', 4.5 + (VALUE[s.type] || 1) + (h.k === 'torpedo' ? 1.5 : h.k === 'bomb' ? 1 : 0), s, null, s.x, s.z);
      const f = fire.get(s), hl = hits.get(s), sl = strad.get(s);
      const recentHits = hl ? hl.filter(w => now - w < 10).length : 0, recentStrad = sl ? sl.filter(w => now - w < 8).length : 0;
      if (f && now - f.w < 6 && f.tg && f.tg.alive && !f.tg.isBase) add('gunfire', 3.5 + (VALUE[s.type] || 1) + (recentHits ? 1 : 0), s, f.tg, s.x, s.z);
      else if (recentHits || recentStrad >= 2) add('straddled', 4 + (VALUE[s.type] || 1) + 0.5 * Math.min(3, recentHits), s, null, s.x, s.z);
      if (s.fireN >= 3 || (s.flood || 0) > 0.2) add('burning', 4 + 0.25 * (s.fireN || 0), s, null, s.x, s.z);
    }
    const b = base();
    if (b) {
      let raid = 0; for (const p of WW.world.planes) if (ok(p) && p.nation !== b.nation && p.ordnance && p.target === b && WW.dist2(p.x, p.z, b.x, b.z) < 160 * 160) raid++;
      if (now - baseBomb < 20) add('bombard', 7, b, null, b.x, b.z);
      if (raid) add('raid', 6.5 + 0.2 * Math.min(5, raid), b, null, b.x, b.z);
      if (now - baseAlarm < 10) add('alarm', 5, b, null, b.x, b.z);
    }
    out.sort((a, c) => c.score - a.score);
    return out;
  }
  function onCam(a) { // identity with the shot, or its place in frame and near
    if (filming(a._s) || (a._t && filming(a._t))) return true;
    return inFrame(a.x, a.y, a.z, a.kind === 'bombard' || a.kind === 'raid' || a.kind === 'alarm' ? 320 : 240);
  }
  // ---- per frame: shots, hand-off stages, smoothness ----
  let frames = 0, lastDir = null, maxRot = 0, snaps = 0, cur = null, grace = 0;
  const origAR = WW.cam.afterRender;
  WW.cam.afterRender = function () {
    origAR.call(this);
    frames++;
    const now = wall(), s = WW.cam._shot(), c = WW.camera;
    if (s && !s.__sid) {
      s.__sid = ++sid; const dbg = WW.camStory._dbg && WW.camStory._dbg();
      cur = { sid: s.__sid, w0: now, sim0: WW.time.now, kind: s.kind, sk: s.sk || '', pr: s.pr !== undefined ? +s.pr.toFixed(1) : null, story: !!s.story, phase: dbg ? dbg.phase : '', subj: ref(s.subj), plane: ref(s.plane),
        alarm: !!s.alarm, cutaway: !!s.cutaway, hard: !!s.hard, stages: [], loaFlips: 0, cls: '' };
      A.shots.push(cur);
      if (A.shots.length > 1) A.shots[A.shots.length - 2].w1 = now;
      lastDir = null; grace = 3;
    }
    if (grace > 0) { grace--; lastDir = null; }
    if (s && cur && s.stage && (!cur.stages.length || cur.stages[cur.stages.length - 1].st !== s.stage)) cur.stages.push({ st: s.stage, w: now });
    _f.set(0, 0, -1).applyQuaternion(c.quaternion);
    if (lastDir) { const ang = Math.acos(Math.min(1, lastDir.dot(_f))) * 30; if (ang > maxRot) maxRot = ang; if (ang > 1.2) snaps++; }
    lastDir = (lastDir || new THREE.Vector3()).copy(_f);
    if (frames % 30 === 0) sample(now, s);
  };
  // ---- per second ----
  const seen = new WeakMap(); // plane -> last phase seen (runs / aborts / dive starts)
  function sample(now, s) {
    if (G.state !== 'battle') return;
    for (let i = sinking.length - 1; i >= 0; i--) { // the camera reaches a sinking ship while it still sinks
      const e = sinking[i], o = e._s;
      if (WW.time.now - e.sim > 9 || !o || o.removed) { delete e._s; sinking.splice(i, 1); continue; }
      if (!e.on && !e.on2 && (filming(o) || inFrame(o.x, 2, o.z, 300))) { e.on2 = true; e.lag = +(now - e.w).toFixed(1); }
    }
    // attack phases (for the promises and the run / abort count)
    for (const p of WW.world.planes) {
      if (!ok(p) || !p.pt) continue;
      const prev = seen.get(p) || {};
      if (p.kind === 'torpedo') {
        if (p.phase === 'run' && prev.ph !== 'run') A.runs.push({ k: 'run', w: now, p: ref(p), t: ref(p.target), d: p.target ? Math.round(WW.dist(p.x, p.z, p.target.x, p.target.z)) : null });
        if (p.phase === 'out' && prev.ph === 'run' && p.ordnance) A.runs.push({ k: 'abort', w: now, p: ref(p), t: ref(p.outTgt) });
        if (p.sk === 'anvil' && prev.sk !== 'anvil') A.runs.push({ k: 'anvil', w: now, p: ref(p), t: ref(p.target), d: p.target ? Math.round(WW.dist(p.x, p.z, p.target.x, p.target.z)) : null });
      } else if (p.kind === 'dive') {
        if ((p.phase === 'roll' || p.phase === 'dive') && prev.ph !== 'roll' && prev.ph !== 'dive') A.runs.push({ k: 'dive', w: now, p: ref(p), t: ref(p.diveTgt || p.target) });
      } else if (p.kind === 'fighter' && ok(p.foe) && !prev.close && Math.hypot(p.foe.x - p.x, p.foe.y - p.y, p.foe.z - p.z) < 20) { prev.close = true; A.runs.push({ k: 'close', w: now, p: ref(p), t: ref(p.foe) }); }
      if (p.kind === 'fighter' && p.foe !== prev.foe) prev.close = false;
      prev.ph = p.phase; prev.sk = p.sk; prev.foe = p.foe; seen.set(p, prev);
    }
    const O = oracle(now), top = O.slice(0, 6).map(a => Object.assign({}, a, { on: onCam(a), _s: undefined, _t: undefined }));
    const onIdx = top.findIndex(a => a.on);
    // the follow label's promise and the finder's items
    const label = WW.camFollow ? WW.camFollow.labelText() : '';
    const sto = WW.camStory.story(), about = sto && WW.camFinder ? WW.camFinder.about(sto.lead) : null;
    const m = /(?:in|within) ~(\d+) s/.exec(label);
    const promise = m && about ? { eta: /within/.test(label) ? +m[1] : about.etaReal, kind: about.kind, s: ref(about.subj), t: ref(about.target) } : null;
    const finder = WW.camFinder ? WW.camFinder.list().slice(0, 6).map(i => ({ kind: i.kind, s: ref(i.subj), t: ref(i.target), eta: +i.etaReal.toFixed(1), sc: +i.score.toFixed(2), v: i.vague ? 1 : 0 })) : [];
    // M6: subject and target in frame, occlusion, line of action, the sun
    const c = WW.camera, subj = s && (s.kind === 'aa' && s.att && !s.att.removed ? s.att : (s.plane || s.subj)), isD = subj && subj.diorama; // the deck shot: the attacker it looks at is the subject
    let tgt = null;
    if (s && s.stage === 'torp') tgt = s.tship;
    else if (subj && !isD) tgt = subj.foe || subj.diveTgt || subj.outTgt || subj.target || (subj.wave && subj.wave.target) || null;
    if (tgt && (tgt.removed || (tgt.alive === false && !tgt.sinking))) tgt = null;
    const q = {};
    if (subj) {
      const sy = subj.y !== undefined ? subj.y : 2;
      q.sIn = inFrame(subj.x, sy, subj.z, 1e9); q.sD = Math.round(Math.hypot(c.position.x - subj.x, c.position.y - sy, c.position.z - subj.z));
      q.ph = isD ? 'diorama' : subj.stats ? (subj.sinking ? 'sinking' : tgt && WW.dist(subj.x, subj.z, tgt.x, tgt.z) < 200 ? 'gun' : 'ship') : (subj.phase || subj.sk || subj.state || '');
      q.tD = tgt ? Math.round(WW.dist(subj.x, subj.z, tgt.x, tgt.z)) : null;
      q.tIn = tgt ? inFrame(tgt.x, tgt.y !== undefined ? tgt.y : 2, tgt.z, 1e9) : null;
      // occlusion: terrain above the sight line, another hull on it, the camera under the water
      let occ = '';
      for (const f of [0.2, 0.4, 0.6, 0.8]) { const x = WW.lerp(c.position.x, subj.x, f), z = WW.lerp(c.position.z, subj.z, f), y = WW.lerp(c.position.y, sy, f); if (-WW.terrain.depthAt(x, z) > y) { occ = 'land'; break; } }
      if (!occ) for (const o of WW.world.ships) {
        if (o === subj || o === tgt || o.removed || o.submerged) continue;
        const dx = subj.x - c.position.x, dz = subj.z - c.position.z, L2 = dx * dx + dz * dz || 1, t = ((o.x - c.position.x) * dx + (o.z - c.position.z) * dz) / L2;
        if (t <= 0.02 || t >= 0.98) continue;
        if (Math.hypot(o.x - (c.position.x + dx * t), o.z - (c.position.z + dz * t)) < o.stats.length * 0.4 && WW.lerp(c.position.y, sy, t) < 8) { occ = 'hull'; break; }
      }
      if (!occ && c.position.y < 1.2) occ = 'sea';
      q.occ = occ;
      if (tgt && cur) { // line of action: which side of the subject -> target line the camera is on
        const sg = Math.sign((tgt.x - subj.x) * (c.position.z - subj.z) - (tgt.z - subj.z) * (c.position.x - subj.x));
        const tid = idOf(tgt), sid2 = idOf(subj);
        if (cur.loa !== undefined && sg && cur.loa && sg !== cur.loa && cur.loaTgt === tid) cur.loaFlips++;
        if (sg && cur.loa === undefined) { // the shot's first side: a cut that lands on the other side of the previous shot's line
          const prev = A.shots[A.shots.length - 2];
          if (prev && prev.loa && prev.loaTgt === tid && prev.loaSubj === sid2 && prev.loa !== sg && now - prev.w1 < 2) cur.cutFlip = true;
        }
        if (sg) { cur.loa = sg; cur.loaTgt = tid; cur.loaSubj = sid2; }
      }
    }
    let sun = null;
    try { const d = WW.sky.parts().dome.material.uniforms.sunDir.value; _f.set(0, 0, -1).applyQuaternion(c.quaternion); sun = +_f.dot(d).toFixed(2); } catch (e) { /* no dome */ }
    const elev = WW.skyTime && WW.skyTime.elev ? +WW.skyTime.elev().toFixed(1) : 20;
    // the subject class of this second (M4)
    let scls = 'none';
    if (s) {
      if (s.kind === 'wide') scls = 'overview';
      else if (isD) { const b = base(); scls = b && near(s.subj.x, s.subj.z, b) ? 'base' : WW.dist2(s.subj.x, s.subj.z, b ? b.x : -1e4, b ? b.z : -1e4) < 150 * 150 ? 'base' : 'diorama'; }
      else if (subj && subj.isBase) scls = 'base';
      else if (subj && subj.stats) scls = O.some(a => a.score >= 4 && (a._s === subj || a._t === subj)) ? 'ship_combat' : 'ship';
      else if (subj) scls = 'plane';
    }
    if (cur && !cur.cls) cur.cls = scls;
    A.rec.push({ w: Math.round(now), sim: Math.round(WW.time.now), dl: WW.daylight === undefined ? 1 : +WW.daylight.toFixed(2), elev, sun,
      shot: s ? { sid: s.__sid, kind: s.kind, sk: s.sk || '', stage: s.stage || '', t: +s.t.toFixed(1), dur: +s.dur.toFixed(1), story: !!s.story, phase: (WW.camStory._dbg() || {}).phase || '' } : null,
      cls: scls, subj: ref(subj), tgt: ref(tgt), q, top, on1: onIdx === 0, on3: onIdx >= 0 && onIdx < 3, onAny: onIdx >= 0,
      label, promise, finder, rot: +maxRot.toFixed(2), snaps, warp: +(WW.time.warp || 1).toFixed(2) });
    maxRot = 0; snaps = 0;
  }
  return A.comp;
}

// ---------------- analysis ----------------
const pct = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-');
const med = arr => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const q = (arr, f) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const ATT_PH = { run: 'run', anvil: 'anvil', roll: 'dive', dive: 'dive', out: 'out', attack: 'attack' };
function analyse(R) { // one round's record -> its metrics and its worst cases
  const M = { secs: 0, act: 0, on1: 0, on3: 0, dead: 0, deadSpells: [], cls: {}, cuts: 0, lens: [], prom: { n: 0, kept: 0, happened: 0, byKind: {}, vis: 0, visKept: 0 }, fin: { n: 0, kept: 0 },
    att: { filmed: 0, held: 0, cutBefore: 0, cutAfter: 0, cases: [] }, runs: 0, aborts: 0, anvils: 0, drops: 0, hitsOf: 0, q: { s: 0, sIn: 0, t: 0, tIn: 0, occ: 0, land: 0, hull: 0, sea: 0, sunIn: 0, sunN: 0, snaps: 0, flips: 0, cutFlips: 0, shots: 0, rotMax: [], att: {}, flipsBy: {}, snapsBy: {} }, ev: { n: 0, on: 0, byKind: {} } };
  const rec = R.rec, byW = new Map(); for (const r of rec) byW.set(r.w, r);
  let spell = null;
  for (const r of rec) {
    M.secs++; M.cls[r.cls] = (M.cls[r.cls] || 0) + 1;
    const topS = r.top.length ? r.top[0].score : 0;
    if (topS >= 3) { M.act++; if (r.on1) M.on1++; if (r.on3) M.on3++; }
    const dead = topS >= 6 && !r.onAny;
    if (dead) { M.dead++; if (!spell) { spell = { w: r.w, n: 0, top: r.top[0], shot: r.shot, cls: r.cls }; M.deadSpells.push(spell); } spell.n++; } else spell = null;
    if (r.q && r.subj) {
      M.q.s++; if (r.q.sIn) M.q.sIn++; if (r.q.tIn !== null && r.q.tIn !== undefined) { M.q.t++; if (r.q.tIn) M.q.tIn++; } if (r.q.occ) { M.q.occ++; M.q[r.q.occ]++; }
      const ph = ATT_PH[r.q.ph] || (r.q.ph === 'gun' ? 'gun' : null); // the attack phases: the target is near enough to be in frame
      if (ph && r.q.tIn !== null && r.q.tIn !== undefined) { const a = M.q.att[ph] = M.q.att[ph] || { n: 0, tIn: 0 }; a.n++; if (r.q.tIn) a.tIn++; }
    }
    if (r.sun !== null && r.elev > 2) { M.q.sunN++; if (r.sun > 0.75) M.q.sunIn++; }
    M.q.snaps += r.snaps; M.q.rotMax.push(r.rot);
    if (r.snaps && r.shot) { const k = (r.shot.story ? 'story/' + r.shot.sk : r.shot.kind) + (r.shot.stage ? ':' + r.shot.stage : ''); M.q.snapsBy[k] = (M.q.snapsBy[k] || 0) + r.snaps; }
  }
  // shots
  for (const s of R.shots) { if (s.w1) M.lens.push(+(s.w1 - s.w0).toFixed(1)); M.q.shots++; const k = s.story ? 'story/' + s.sk : s.kind, f = M.q.flipsBy[k] = M.q.flipsBy[k] || { n: 0, f: 0 }; f.n++; if (s.loaFlips) { M.q.flips++; f.f++; } if (s.cutFlip) M.q.cutFlips++; }
  M.cuts = R.shots.length;
  // attacks: runs / aborts / drops
  for (const e of R.runs) { if (e.k === 'run') M.runs++; else if (e.k === 'abort') M.aborts++; else if (e.k === 'anvil') M.anvils++; }
  M.drops = R.drops.length; M.hitsOf = R.drops.filter(d => d.imp && d.imp.hit).length;
  // M2: a filmed attack = the camera was on the plane (identity) within the 6 s before the drop or at the drop
  const shotAt = w => R.shots.find(s => s.w0 <= w && (s.w1 === undefined || s.w1 > w));
  for (const d of R.drops) {
    const before = rec.filter(r => r.w >= d.w - 6 && r.w <= d.w && r.subj && r.subj.id === d.p.id);
    const filmedBefore = before.length > 0;
    if (!filmedBefore && !d.on) continue;
    M.att.filmed++;
    const endW = d.imp ? d.imp.w + 2 : d.w + 10;
    const s0 = shotAt(Math.max(d.w - 0.5, before.length ? before[0].w : d.w)), s1 = shotAt(d.w + 0.2), s2 = shotAt(endW);
    const same = (a, b) => a && b && a.sid === b.sid;
    const stayed = (sh) => sh && (same(sh, s0) || (sh.subj && (sh.subj.id === d.p.id || (d.t && sh.subj.id === d.t.id))) || (sh.plane && sh.plane.id === d.p.id));
    const okDrop = d.on && stayed(s1), okEnd = stayed(s2) && (!d.imp || d.imp.on);
    if (okDrop && okEnd) M.att.held++;
    else if (!okDrop) M.att.cutBefore++; else M.att.cutAfter++;
    if (!(okDrop && okEnd)) M.att.cases.push({ w: Math.round(d.w), kind: d.kind, p: d.p, t: d.t, why: !okDrop ? 'cut before the release' : 'cut before the result', hit: d.imp ? d.imp.hit : null, shots: [s0, s1, s2].map(s => s ? s.sid + ':' + (s.story ? 'story/' + s.sk : s.kind) + (s.subj ? '@' + s.subj.id : '') + (s.plane ? '+' + s.plane.id : '') : '-') });
  }
  // M1: every promise sample (the label the user reads); the finder's items as the wider denominator
  const dropsOf = (id) => R.drops.filter(d => d.p.id === id), waveDrops = wv => R.drops.filter(d => d.p.wv === wv), waveAtt = wv => R.runs.filter(e => (e.k === 'run' || e.k === 'dive') && e.p.wv === wv);
  const impactsOn = id => R.drops.filter(d => d.imp && d.imp.s && d.imp.s.id === id).map(d => d.imp);
  function eventTimes(it) {
    const s = it.s; if (!s) return [];
    if (it.kind === 'anvil' || it.kind === 'run') return dropsOf(s.id).map(d => d.w).concat(s.wv ? waveDrops(s.wv).map(d => d.w) : []);
    if (it.kind === 'push') return dropsOf(s.id).map(d => d.w).concat(R.runs.filter(e => e.k === 'dive' && e.p.id === s.id).map(e => e.w));
    if (it.kind === 'strike') return (s.wv ? waveAtt(s.wv).map(e => e.w).concat(waveDrops(s.wv).map(d => d.w)) : dropsOf(s.id).map(d => d.w));
    if (it.kind === 'bandits') return R.runs.filter(e => e.k === 'close' && e.p.id === s.id).map(e => e.w);
    if (it.kind === 'torps') return impactsOn(s.id).map(i => i.w);
    return [];
  }
  const judge = (it, w, slot, within) => {
    const T = w + it.eta, ev = eventTimes(it);
    const kept = within ? ev.some(x => x >= w - 1 && x <= T + 5) : ev.some(x => Math.abs(x - T) <= 5), happened = ev.some(x => x >= w && x <= T + 60);
    slot.n++; if (kept) slot.kept++; if (happened) slot.happened = (slot.happened || 0) + 1;
    const k = slot.byKind && (slot.byKind[it.kind] = slot.byKind[it.kind] || { n: 0, kept: 0, happened: 0 }); if (k) { k.n++; if (kept) k.kept++; if (happened) k.happened++; }
    return kept;
  };
  M.promCases = [];
  for (const r of rec) {
    if (r.promise && r.promise.s) { const kept = judge(r.promise, r.w, M.prom, /within ~/.test(r.label)); M.prom.vis++; if (kept) M.prom.visKept++; if (!kept) M.promCases.push({ w: r.w, label: r.label, eta: r.promise.eta, kind: r.promise.kind }); }
    for (const it of r.finder) if (it.eta >= 3 && it.eta <= 60 && it.s && it.kind !== 'danger' && !it.v) judge(it, r.w, M.fin); // (a vague item shows no number)
  }
  // big events on camera
  for (const e of R.ev) { const on = e.on || e.on2, key = e.k === 'sunk' ? 'sunk:' + (e.s ? e.s.c : '?') : e.k; M.ev.n++; if (on) M.ev.on++; const k = M.ev.byKind[key] = M.ev.byKind[key] || { n: 0, on: 0 }; k.n++; if (on) k.on++; }
  return M;
}
function merge(all) { // sum the per-round metrics
  const T = { secs: 0, act: 0, on1: 0, on3: 0, dead: 0, cls: {}, lens: [], cuts: 0, prom: { n: 0, kept: 0, happened: 0, vis: 0, visKept: 0, byKind: {} }, fin: { n: 0, kept: 0, happened: 0 }, att: { filmed: 0, held: 0, cutBefore: 0, cutAfter: 0 }, runs: 0, aborts: 0, anvils: 0, drops: 0, hitsOf: 0,
    q: { s: 0, sIn: 0, t: 0, tIn: 0, occ: 0, land: 0, hull: 0, sea: 0, sunIn: 0, sunN: 0, snaps: 0, flips: 0, cutFlips: 0, shots: 0, rotMax: [], att: {}, flipsBy: {}, snapsBy: {} }, ev: { n: 0, on: 0, byKind: {} }, spells: [] };
  for (const M of all) {
    for (const k of ['secs', 'act', 'on1', 'on3', 'dead', 'cuts', 'runs', 'aborts', 'anvils', 'drops', 'hitsOf']) T[k] += M[k];
    for (const k in M.cls) T.cls[k] = (T.cls[k] || 0) + M.cls[k];
    T.lens.push(...M.lens);
    for (const k of ['n', 'kept', 'happened', 'vis', 'visKept']) T.prom[k] += M.prom[k] || 0;
    for (const k in M.prom.byKind) { const a = T.prom.byKind[k] = T.prom.byKind[k] || { n: 0, kept: 0, happened: 0 }; for (const f in a) a[f] += M.prom.byKind[k][f] || 0; }
    for (const k of ['n', 'kept', 'happened']) T.fin[k] += M.fin[k] || 0;
    for (const k of ['filmed', 'held', 'cutBefore', 'cutAfter']) T.att[k] += M.att[k];
    for (const k in T.q) if (k !== 'rotMax' && k !== 'att' && k !== 'flipsBy' && k !== 'snapsBy') T.q[k] += M.q[k]; T.q.rotMax.push(...M.q.rotMax);
    for (const k in M.q.snapsBy || {}) T.q.snapsBy[k] = (T.q.snapsBy[k] || 0) + M.q.snapsBy[k];
    for (const k in M.q.att) { const a = T.q.att[k] = T.q.att[k] || { n: 0, tIn: 0 }; a.n += M.q.att[k].n; a.tIn += M.q.att[k].tIn; }
    for (const k in M.q.flipsBy) { const a = T.q.flipsBy[k] = T.q.flipsBy[k] || { n: 0, f: 0 }; a.n += M.q.flipsBy[k].n; a.f += M.q.flipsBy[k].f; }
    T.ev.n += M.ev.n; T.ev.on += M.ev.on;
    for (const k in M.ev.byKind) { const a = T.ev.byKind[k] = T.ev.byKind[k] || { n: 0, on: 0 }; a.n += M.ev.byKind[k].n; a.on += M.ev.byKind[k].on; }
  }
  return T;
}
function report(T, title) {
  const L = [];
  L.push(`## ${title}: ${T.secs} camera seconds, ${T.cuts} shots`);
  L.push(`M1 promise kept (label ETA within +-5 s): ${pct(T.prom.kept, T.prom.n)} of ${T.prom.n} label-seconds (happened at all within ETA+60 s: ${pct(T.prom.happened, T.prom.n)}); by kind ` +
    Object.keys(T.prom.byKind).map(k => `${k} ${pct(T.prom.byKind[k].kept, T.prom.byKind[k].n)}/${T.prom.byKind[k].n}`).join(', ') + `; all finder items 3-60 s: ${pct(T.fin.kept, T.fin.n)} of ${T.fin.n}`);
  L.push(`M2 attack continuity: ${pct(T.att.held, T.att.filmed)} of ${T.att.filmed} filmed drops held run-in -> release -> result (+2 s); cut before the release ${T.att.cutBefore}, after it ${T.att.cutAfter}. Sim: ${T.anvils} anvils, ${T.runs} runs, ${T.aborts} aborted runs, ${T.drops} plane drops, ${T.hitsOf} hits`);
  L.push(`M3 best-action coverage: top-1 ${pct(T.on1, T.act)}, top-3 ${pct(T.on3, T.act)} of ${T.act} seconds with an action going on`);
  const tot = T.secs || 1;
  L.push(`M4 variety: screen time ` + Object.keys(T.cls).sort((a, b) => T.cls[b] - T.cls[a]).map(k => `${k} ${pct(T.cls[k], tot)}`).join(', ') + `; shot length p10/p50/p90 ${q(T.lens, 0.1)}/${med(T.lens)}/${q(T.lens, 0.9)} s; ${(60 * T.cuts / tot).toFixed(1)} cuts/min`);
  L.push(`M5 dead air: ${pct(T.dead, tot)} of the time (${T.dead} s) on nothing while a big action (score >= 6) ran elsewhere`);
  const att = Object.keys(T.q.att).map(k => `${k} ${pct(T.q.att[k].tIn, T.q.att[k].n)}/${T.q.att[k].n}`).join(', ');
  const fl = Object.keys(T.q.flipsBy).filter(k => T.q.flipsBy[k].f).sort((a, b) => T.q.flipsBy[b].f - T.q.flipsBy[a].f).map(k => `${k} ${T.q.flipsBy[k].f}/${T.q.flipsBy[k].n}`).join(', ');
  L.push(`M6 angle: subject in frame ${pct(T.q.sIn, T.q.s)}, target in frame ${pct(T.q.tIn, T.q.t)} (of ${T.q.t} s with a target); IN THE ATTACK (subject + target in frame): ${att}; occluded ${pct(T.q.occ, T.q.s)} (land ${T.q.land}, hull ${T.q.hull}, sea ${T.q.sea}), into the sun ${pct(T.q.sunIn, T.q.sunN)}, line-of-action: cuts that flip sides ${T.q.cutFlips} (${pct(T.q.cutFlips, T.q.shots)} of shots), in-shot crossings in ${pct(T.q.flips, T.q.shots)} of shots (${fl}), snap frames (>1.2 rad/s, cuts excluded) ${(60 * T.q.snaps / tot).toFixed(1)}/min (${Object.keys(T.q.snapsBy).sort((a, b) => T.q.snapsBy[b] - T.q.snapsBy[a]).slice(0, 8).map(k => k + ' ' + T.q.snapsBy[k]).join(', ')}), view rate p90 ${q(T.q.rotMax, 0.9)} rad/s`);
  L.push(`Big events on camera: ${pct(T.ev.on, T.ev.n)} of ${T.ev.n}: ` + Object.keys(T.ev.byKind).map(k => `${k} ${T.ev.byKind[k].on}/${T.ev.byKind[k].n}`).join(', '));
  return L.join('\n');
}
function summarize(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  const per = {}, all = [], worst = { att: [], dead: [], prom: [] };
  for (const f of files) {
    const R = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), M = analyse(R), key = R.cfg.name;
    (per[key] = per[key] || []).push(M); all.push(M);
    for (const c of M.att.cases) worst.att.push(Object.assign({ scen: key, seed: R.cfg.seed }, c));
    for (const d of M.deadSpells) if (d.n >= 4) worst.dead.push({ scen: key, seed: R.cfg.seed, w: d.w, n: d.n, top: d.top, shot: d.shot, cls: d.cls });
    for (const p of M.promCases) worst.prom.push(Object.assign({ scen: key, seed: R.cfg.seed }, p));
  }
  const out = [report(merge(all), 'ALL ' + files.length + ' rounds')];
  for (const k in per) out.push(report(merge(per[k]), k + ' (' + per[k].length + ' rounds)'));
  worst.dead.sort((a, b) => b.n - a.n);
  out.push('\n## Worst cases');
  out.push('Attacks cut mid-way (first 40): ' + worst.att.slice(0, 40).map(c => `${c.scen}/${c.seed} @${c.w}s ${c.kind} ${c.p.sq || c.p.c} -> ${c.t ? c.t.c : '?'} ${c.why} (hit ${c.hit}) shots ${c.shots.join(' > ')}`).join('\n  '));
  out.push('Dead-air spells >= 4 s (first 30): ' + worst.dead.slice(0, 30).map(d => `${d.scen}/${d.seed} @${d.w}s ${d.n}s on ${d.cls} ${d.shot ? (d.shot.story ? 'story/' + d.shot.sk + '/' + d.shot.phase : d.shot.kind) : '-'} while ${d.top.kind} ${d.top.score} at ${d.top.x},${d.top.z}`).join('\n  '));
  out.push('Broken promises (first 40 label-seconds): ' + worst.prom.slice(0, 40).map(p => `${p.scen}/${p.seed} @${p.w}s "${p.label}" (${p.kind} eta ${p.eta.toFixed(0)})`).join('\n  '));
  const text = out.join('\n\n');
  fs.writeFileSync(path.join(path.dirname(dir), 'summary_' + path.basename(dir) + '.md'), text);
  fs.writeFileSync(path.join(path.dirname(dir), 'worst_' + path.basename(dir) + '.json'), JSON.stringify(worst, null, 1));
  console.log(text);
}

// ---------------- the runs ----------------
const INIT = (seed) => `window.__raf = []; window.__fakeT = 0; window.__render = false;
  window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
  window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  window.__mk = s0 => { let a = s0 >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  Math.random = __mk(${seed} * 2654435761); window.__prng2 = __mk(${seed} * 40503 + 99991);`;
async function openRound(b, spec) {
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(INIT(spec.seed * 31 + 7));
  await p.goto(BASE_URL + 'index.html?auto');
  await p.waitForTimeout(1500);
  const comp = await p.evaluate(([install, cfg]) => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (!window.__render) return; const mr = Math.random; Math.random = window.__prng2; try { pr(a, b); } finally { Math.random = mr; } };
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    return (new Function('return ' + install)())(cfg);
  }, [install.toString(), spec]);
  return { p, errs, comp };
}
async function survey(b, spec, dir) {
  const { p, errs, comp } = await openRound(b, spec);
  const t0 = Date.now();
  let t = 0;
  while (true) { t = await p.evaluate(() => { __step(300); return WW.game.state === 'battle' ? WW.game.roundTime : -1; }); if (t < 0 || t > SIM) break; }
  const R = await p.evaluate(() => { const A = window.__audit; for (const e of A.ev) delete e._s; return { cfg: A.cfg, tod: A.tod, comp: A.comp, rec: A.rec, ev: A.ev, drops: A.drops, shots: A.shots, caps: A.caps, runs: A.runs, score: WW.camScore ? { stats: WW.camScore.stats, log: WW.camScore.log } : null, story: WW.camStory ? WW.camStory.stats : null }; });
  R.errs = errs.slice(0, 5);
  fs.writeFileSync(path.join(dir, `${spec.name}_${spec.seed}.json`), JSON.stringify(R));
  const M = analyse(R);
  console.log(`${spec.name}/${spec.seed} (${spec.odd || ''}${R.tod}): sim ${t < 0 ? 'round over' : t.toFixed(0) + ' s'}, ${R.rec.length} s filmed, ${R.shots.length} shots, drops ${R.drops.length}, M1 ${pct(M.prom.kept, M.prom.n)}/${M.prom.n} M2 ${M.att.held}/${M.att.filmed} M3 ${pct(M.on1, M.act)} M5 ${pct(M.dead, M.secs)} recuts ${R.score ? R.score.stats.recuts : '-'} yields ${R.story ? R.story.yielded || 0 : '-'} [${((Date.now() - t0) / 1000).toFixed(0)}s]` + (errs.length ? ' ERRORS ' + errs.slice(0, 2).join(' | ') : ''));
  await p.close();
}
// --sheet SCEN:SEED:from:to[:every]: replay the round, render frames in the wall-time window, montage them
async function sheet(b, specTxt) {
  const [name, seed, from, to, every] = specTxt.split(':'), spec = Object.assign(specOf(name, +seed), { fast: false }), EV = +(every || 2);
  const dir = path.join(OUT, 'sheets', `${name}_${seed}_${from}-${to}`); fs.mkdirSync(dir, { recursive: true });
  const { p } = await openRound(b, spec);
  const f0 = Math.round(+from * 30);
  await p.evaluate(n => { let left = n; while (left > 0 && WW.game.state === 'battle') { const k = Math.min(300, left); __step(k); left -= k; } }, f0);
  const frames = [];
  for (let w = +from; w <= +to; w += EV) {
    const info = await p.evaluate(([k]) => { __render = false; if (k > 1) __step(k - 1); __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0';
      const s = WW.cam._shot(), d = WW.camStory._dbg() || {}, lab = WW.camFollow.labelText(), cap = document.querySelector('.caption.on'), top = (window.__audit.rec.slice(-1)[0] || {}).top || [];
      return { w: Math.round(performance.now() / 1000), shot: s ? (s.story ? 'story/' + s.sk + '/' + (d.phase || '') : s.kind) + (s.stage ? ':' + s.stage : '') : '-', label: lab.replace(/Following /, ''), cap: cap ? cap.textContent.trim().slice(0, 60) : '', top: top[0] ? top[0].kind + ' ' + top[0].score + (top[0].on ? ' ON' : ' off') : '' }; }, [Math.round(EV * 30)]);
    const file = path.join(dir, `f_${String(frames.length).padStart(3, '0')}.png`);
    await p.screenshot({ path: file, timeout: 180000 });
    frames.push({ file, info });
    console.log(`  ${info.w}s ${info.shot} | ${info.top} | ${info.label} | ${info.cap}`);
  }
  const shotsRaw = await p.evaluate(() => window.__audit.shots.map(s => ({ w0: s.w0, story: s.story, sk: s.sk, phase: s.phase, kind: s.kind, subj: s.subj ? { c: s.subj.c } : null })));
  const shots = shotsRaw.map(s => Math.round(s.w0) + ' ' + (s.story ? 'story/' + s.sk + '/' + s.phase : s.kind) + (s.subj ? '@' + s.subj.c : ''));
  fs.writeFileSync(path.join(dir, 'shots.txt'), shots.join('\n')); // the replay's shot list, checked against the survey's raw JSON
  const rawF = path.join(OUT, 'raw_' + TAG, `${name}_${seed}.json`);
  if (fs.existsSync(rawF)) {
    // (wall times are relative to the first shot: the page-load time before install() differs run to run)
    const key = (w0, s, t0) => Math.round(w0 - t0) + ' ' + (s.story ? 'story/' + s.sk + '/' + s.phase : s.kind) + (s.subj ? '@' + s.subj.c : '');
    const R = JSON.parse(fs.readFileSync(rawF, 'utf8')), ref = R.shots.map(s => key(s.w0, s, R.shots[0].w0)), mine = shotsRaw.map(s => key(s.w0, s, shotsRaw[0].w0));
    let i = 0; while (i < mine.length && i < ref.length && mine[i] === ref[i]) i++;
    console.log(i >= mine.length ? `replay matches the survey (${mine.length} shots)` : `REPLAY DIVERGES from the survey at shot ${i}: ${mine[i]} vs ${ref[i]}`);
  }
  await p.close();
  const argsM = ['-tile', '4x', '-geometry', '480x270+3+3', '-background', '#222', '-fill', 'white', '-font', FONT, '-pointsize', '13', '-title', `${name} seed ${seed} ${from}-${to}s`];
  for (const f of frames) argsM.push('-label', `${f.info.w}s ${f.info.shot} | ${f.info.top}`.replace(/%/g, '%%'), f.file);
  const outPng = path.join(OUT, 'sheets', `${TAG}_${name}_${seed}_${from}-${to}.png`);
  cp.spawnSync('montage', argsM.concat([outPng]), { stdio: 'inherit' });
  console.log('sheet', outPng);
}
// --windows: contact-sheet windows worth looking at in a survey's raw data (wall seconds relative to the first shot, as --sheet
// takes them): torpedo attacks the camera held from the run to the impact, gun-duel shots on a ship that was hit, base shots
// under bombardment, dives held to the bomb
function windows(dir) {
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const R = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), t0 = R.shots[0] ? R.shots[0].w0 : 0, tag = f.replace('.json', '').replace(/_(\d+)$/, ':$1');
    const rel = w => Math.round(w - t0), out = [];
    const shotAt = w => R.shots.find(s => s.w0 <= w && (s.w1 === undefined || s.w1 > w));
    for (const d of R.drops) {
      if (!d.on || !d.imp) continue;
      const s0 = shotAt(d.w - 4), s1 = shotAt(d.imp.w + 1);
      if (s0 && s1 && (s0.sid === s1.sid || (s1.subj && d.t && s1.subj.id === d.t.id))) out.push(`${d.kind} ${d.p.sq || d.p.c} -> ${d.t ? d.t.c : '?'} ${d.imp.hit ? 'HIT' : 'miss'}: --sheet ${tag}:${rel(d.w) - 8}:${rel(d.imp.w) + 3}`);
    }
    for (const s of R.shots) {
      if (!s.w1) continue;
      const secs = R.rec.filter(r => r.w >= s.w0 && r.w < s.w1), top = secs.map(r => r.top[0]).filter(Boolean);
      if (s.kind === 'duel' && top.some(t => (t.kind === 'hit' || t.kind === 'duel' || t.kind === 'straddled') && t.on)) out.push(`gun duel ${s.subj ? s.subj.c : ''}: --sheet ${tag}:${rel(s.w0)}:${rel(s.w1)}`);
      if (s.kind === 'base' && top.some(t => t.kind === 'bombard' && t.on)) out.push(`base bombarded: --sheet ${tag}:${rel(s.w0)}:${rel(s.w1)}`);
      if (s.kind === 'profile') out.push(`sinking ${s.subj ? s.subj.c : ''}: --sheet ${tag}:${rel(s.w0)}:${rel(s.w1)}`);
    }
    if (out.length) console.log(`## ${f}\n  ` + out.join('\n  '));
  }
}
module.exports = { install, INIT, specOf, openRound, analyse, merge, report, SCEN, windows };
if (require.main === module) (async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const dir = path.join(OUT, 'raw_' + TAG); fs.mkdirSync(dir, { recursive: true });
  if (SUMMARIZE) return summarize(dir);
  if (args.includes('--windows')) return windows(dir);
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  if (SHEET) { for (const s of SHEET.split(',')) await sheet(b, s); await b.close(); return; }
  const jobs = []; for (const sc of SCENS) for (const sd of SEEDS) jobs.push(specOf(sc, sd));
  let next = 0;
  await Promise.all([...Array(Math.min(WORKERS, jobs.length)).keys()].map(async () => { while (next < jobs.length) { const j = jobs[next++]; try { await survey(b, j, dir); } catch (e) { console.log(`${j.name}/${j.seed} FAILED ${e.message}`); } } }));
  await b.close();
  summarize(dir);
})();
