// Director camera CASES (camera6): scripted pass / fail checks of the moments the director must not miss, each on a real
// round (the sim is deterministic per seed and the camera never writes it, so a case's event happens at the same sim time
// whatever the camera does). Each case names a scenario / seed / game speed and a sim time to run to; its selector finds
// the event in the round's audit record (tests/camera_audit.js install(): the big events judged in frame and unoccluded,
// the per-second shot / oracle / sim context), its check says pass or fail and why.
// Cases (the user, 2026-10-19: "the director camera still doesn't show the biggest action ... a torpedo bomber returning
// home while a caption said Enterprise was hit by a torpedo"):
//   cv_torp_home     a carrier torpedoed while a strike flies home (the user's case)
//   cv_pair          two carriers struck within 8 sim s of each other: at least one hit in frame
//   cv_dive_else     a carrier hit while a dive attack is going in on another ship
//   magazine         a magazine explosion in frame
//   sinking          a big ship going down: the camera is on her within 3 s
//   prot_down        the protagonist shot down: followed to the water
//   night_torp       a torpedo hit at night in frame
//   pt_ambush        a PT boat's torpedo hit in frame
//   sub_attack       a submarine's torpedo hit in frame
//   gun_duel         battleship / cruiser shell hits in a gun duel in frame
//   dd_torp          a destroyer / cruiser torpedo attack shown from the run-in to the hit
//   dive_usn_cv / dive_ijn_cv / dive_small / dive_lowsun: a dive bomber's dive reads as a dive (target in frame, not
//                    side-on or flat, the plane not lost against the sea, no line-of-action flip, the impact in frame)
//   dead_air         nothing happening: a calm shot (no cut storm, no snaps, no jitter)
//   hit_after_cut    hits landing in the first 3 s of a shot are in that shot
//   manual_pan       the user drags the camera, lets go: the director takes it back and films the next big hit
// Every case also needs the setup framed beforehand where it says so (the frame 1 s before the impact).
// Usage: BASE_URL=http://localhost:8829/ CHROMIUM=... node tests/camera_cases.js [--only a,b] [--quick] [--gate] [--workers 3] [--mine dir]
//        --quick: the cases marked quick (the gate's); --gate: also a short survey held to thresholds (npm run test:camera)
//        [--sheets] (a contact sheet of each failed case's moment: tests/camera_audit.js --sheet)
// --mine DIR: scan a camera_audit survey's raw JSON for rounds where each case's situation happens (to pick the cases).
const fs = require('fs'), path = require('path'), cp = require('child_process');
const { chromium } = require('playwright');
const AU = require('./camera_audit.js');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CASE_WX = arg('--wx', 'clear');   // camera7: the cases' and the gate's rounds in fixed weather (a weather re-roll moved every mined event)
const ONLY = arg('--only', null), WORKERS = +arg('--workers', 3), OUT = arg('--out', path.join(__dirname, 'shots', 'camera_cases'));
const BIG = { carrier: 1, battleship: 1, cruiser: 1 };
const hitK = e => e.k === 'torpedo' || e.k === 'bomb' || e.k === 'shell';
const fmt = e => `${e.k} ${e.c} sim ${e.sim} ${e.now} (1 s before ${e.pre}) shot ${e.shot}`;
const recAt = (R, w) => { let b = null; for (const r of R.rec) { if (r.w > w + 0.5) break; b = r; } return b; };
const okNow = e => e.now === 'ok';
const okBoth = e => e.now === 'ok' && e.pre === 'ok';

// the torpedo hits (BE records) of ship-launched spreads by a source class, each with its firing ({ w, s, tg })
function torpBy(R, srcOk) {
  const out = [];
  for (const d of R.stor || []) { if (!d.hits || !d.s || !srcOk(d.s.c)) continue; const h = d.hits[0], e = (R.be || []).find(x => x.k === 'torpedo' && x.id === h.id && Math.abs(x.sim - h.sim) < 1.5); if (e && !out.some(o => o.w === e.w)) out.push(Object.assign({}, e, { fire: d })); }
  return out.sort((a, b) => a.w - b.w);
}
// (a crippled bomber the story follows down as a fall is the protagonist-down story, not a dive to judge)
function dives(R, f) { return (R.dives || []).filter(d => d.n >= 30 && d.drop !== undefined && d.p && f(d) && !R.rec.some(r => r.w >= d.w0 && r.w <= d.w1 + 1 && r.shot && r.shot.sk === 'fall')); }
// a dive that reads as a dive: the target in frame most of it, not side-on or flat, the plane not a speck, no flip, the
// bomb's impact in frame (the cut held to it)
function diveCheck(R, E) {
  const d = E[0]; if (!d) return null;
  const n = d.n, r = k => d[k] / n, drop = d.drop !== undefined ? R.drops[d.drop] : null, held = !!(drop && drop.imp && drop.imp.on);
  const bad = [];
  if (r('tIn') < 0.6) bad.push('target in frame ' + (100 * r('tIn')).toFixed(0) + '%');
  if (r('pIn') < 0.5) bad.push('bomber in frame ' + (100 * r('pIn')).toFixed(0) + '%');
  if (r('side') > 0.4) bad.push('side-on ' + (100 * r('side')).toFixed(0) + '%');
  if (r('flat') > 0.3) bad.push('flat ' + (100 * r('flat')).toFixed(0) + '%');
  if (r('small') > 0.4) bad.push('plane small ' + (100 * r('small')).toFixed(0) + '%');
  if (d.flips) bad.push(d.flips + ' flips');
  if (!held) bad.push('impact not in frame');
  return { pass: !bad.length, why: `${d.p.n} ${d.p.sq || 'dive'} on a ${d.t ? d.t.c : '?'} (sun ${d.elev} deg, ${(n / 30).toFixed(1)} s on screen, ${d.shots.length} shots): ` + (bad.length ? bad.join(', ') : 'target ' + (100 * r('tIn')).toFixed(0) + '%, bomber ' + (100 * r('pIn')).toFixed(0) + '%, side-on ' + (100 * r('side')).toFixed(0) + '%, flat ' + (100 * r('flat')).toFixed(0) + '%, impact in frame'), w: d.w0 };
}
// the situations, as selectors over a round's record R (camera_audit.js survey JSON) -> the events of interest
const SEL = {
  cv_torp_home: R => (R.be || []).filter(e => e.k === 'torpedo' && e.c === 'carrier' && (() => { const r = recAt(R, e.w); return r && r.ctx && Object.values(r.ctx.ret).some(n => n >= 2); })()),
  cv_pair: R => { const cv = (R.be || []).filter(e => hitK(e) && e.c === 'carrier'), out = []; for (const a of cv) for (const b of cv) if (a !== b && a.id !== b.id && b.sim >= a.sim && b.sim - a.sim <= 8 && !out.length) out.push(a, b); return out; },   // (camera7: within 8 sim s: 5 s happened in 2 of 36 rounds, 0 of 30 in clear weather)
  cv_dive_else: R => (R.be || []).filter(e => hitK(e) && e.k !== 'shell' && e.c === 'carrier' && (() => { const r = recAt(R, e.w); return r && r.ctx && r.ctx.dv.some(t => t !== e.id); })()),
  magazine: R => (R.be || []).filter(e => e.k === 'magazine'),
  sinking: R => (R.be || []).filter(e => e.k === 'sunk' && BIG[e.c]),
  night_torp: R => (R.be || []).filter(e => e.k === 'torpedo' && e.c !== 'pt'),
  // (camera7: on a cruiser or bigger: a PT boat's or a submarine's hit on a destroyer / a submarine while a carrier is
  // struck elsewhere is rightly not filmed)
  pt_ambush: R => torpBy(R, c => c === 'pt').filter(e => BIG[e.c]),
  sub_attack: R => torpBy(R, c => c === 'submarine').filter(e => BIG[e.c]),
  gun_duel: R => (R.be || []).filter(e => e.k === 'shell' && (e.c === 'battleship' || e.c === 'cruiser')),
  // a destroyer / cruiser / PT torpedo spread that hits: the hit's BE record, with the spread's firing
  dd_torp: R => torpBy(R, c => c === 'destroyer' || c === 'cruiser'),
  // the filmed dives (camera_audit.js A.dives, >= 1 s on screen) by who dives on what, and at low sun
  dive_usn_cv: R => dives(R, d => d.p.n === 'USN' && d.t && d.t.c === 'carrier'),
  dive_ijn_cv: R => dives(R, d => d.p.n === 'IJN' && d.t && d.t.c === 'carrier'),
  dive_small: R => dives(R, d => d.t && (d.t.c === 'cruiser' || d.t.c === 'destroyer')),
  dive_lowsun: R => dives(R, d => d.elev < 12),
  hit_after_cut: R => (R.be || []).filter(e => hitK(e) && BIG[e.c] && R.shots.some(s => e.w - s.w0 >= 0.2 && e.w - s.w0 < 3)),
};
// the checks: (R, events) -> { pass, why, w (the wall time to film on a failure) }
const CHECK = {
  // the user's case: the hit in frame AND the carrier framed 1 s before (not a cut in after the fact)
  cv_torp_home: (R, E) => { const e = E[0]; return e ? { pass: okBoth(e), why: fmt(e), w: e.w } : null; },
  cv_pair: (R, E) => E.length < 2 ? null : { pass: okNow(E[0]) || okNow(E[1]), why: fmt(E[0]) + ' | ' + fmt(E[1]), w: E[0].w },
  cv_dive_else: (R, E) => { const e = E[0]; return e ? { pass: okNow(e), why: fmt(e), w: e.w } : null; },
  magazine: (R, E) => { const e = E[0]; return e ? { pass: okNow(e), why: fmt(e), w: e.w } : null; },
  sinking: (R, E) => { const e = E[0]; if (!e) return null; const ev = (R.ev || []).find(x => x.k === 'sunk' && Math.abs(x.w - e.w) < 1); const lag = ev ? (ev.on ? 0 : ev.on2 ? ev.lag : 99) : 99; return { pass: okNow(e) || lag <= 3, why: fmt(e) + ' camera on her after ' + lag + ' s', w: e.w }; },
  night_torp: (R, E) => { const e = E[0]; return e ? { pass: okNow(e), why: fmt(e), w: e.w } : null; },
  pt_ambush: (R, E) => { const e = E[0]; return e ? { pass: okNow(e), why: fmt(e), w: e.w } : null; },
  sub_attack: (R, E) => { const e = E[0]; return e ? { pass: okNow(e), why: fmt(e), w: e.w } : null; },
  gun_duel: (R, E) => { const f = E.slice(0, 4); if (f.length < 2) return null; const n = f.filter(okNow).length; return { pass: n >= Math.ceil(f.length / 2), why: `${n} / ${f.length} of the first shell hits in frame: ` + f.map(e => e.c + ':' + e.now).join(' '), w: (f.find(e => !okNow(e)) || f[0]).w }; },
  // the run-in on camera (the firing ship or its target filmed in the 25 s before the spread left) and the hit in frame
  dd_torp: (R, E) => { const e = E[0]; if (!e) return null; const f = e.fire, run = R.rec.filter(r => r.w >= f.w - 25 && r.w <= f.w + 1 && ((r.subj && (r.subj.id === f.s.id || (f.tg && r.subj.id === f.tg.id))) || (r.tgt && r.tgt.id === f.s.id))).length;
    return { pass: okNow(e) && run >= 3, why: `${f.s.c} -> ${e.c}: run-in on camera ${run} s of the 25 before the spread; hit ${fmt(e)}`, w: f.w }; },
  dive_usn_cv: diveCheck, dive_ijn_cv: diveCheck, dive_small: diveCheck, dive_lowsun: diveCheck,
  hit_after_cut: (R, E) => { if (E.length < 2) return null; const n = E.filter(okNow).length; return { pass: n / E.length >= 0.7, why: `${n} / ${E.length} hits in the first 3 s of a shot in frame`, w: (E.find(e => !okNow(e)) || E[0]).w }; },
  // the protagonist shot down: its fall filmed and held to the water (camera_story.js falls / fallsWet), and its arc
  // logged as ending with it
  prot_down: R => { const st = R.story || {}, a = (R.arcs || []).filter(x => x.outcome === 'protagonistDown'); if (!st.falls) return null; return { pass: (st.fallsWet || 0) >= st.falls * 0.8, why: `${st.falls} falls filmed, ${st.fallsWet || 0} held to the water, ${a.length} arcs ended with the protagonist down`, w: a.length ? a[0].t1 - 8 : R.rec[0].w }; },
  // a quiet stretch (no action scoring 3 for 12 s): no cut storm (a cut per 6 s at most), no snap frames, the view turning slowly
  dead_air: R => {
    let run = [], best = null;
    for (const r of R.rec) { if (!r.top.length || r.top[0].score < 3) { run.push(r); if (run.length >= 12 && (!best || run.length > best.length)) best = run.slice(); } else run = []; }
    if (!best) return null;
    const w0 = best[0].w, w1 = best[best.length - 1].w, cuts = R.shots.filter(s => s.w0 > w0 && s.w0 <= w1).length, snaps = best.reduce((a, r) => a + r.snaps, 0), rot = Math.max(...best.map(r => r.rot)), none = best.filter(r => !r.shot).length;
    return { pass: cuts <= Math.ceil(best.length / 6) && snaps === 0 && rot < 1 && !none, why: `${best.length} s quiet: ${cuts} cuts, ${snaps} snap frames, view rate max ${rot} rad/s`, w: w0 };
  },
  // the user's drag (free camera) then letting go: the director is back within the free camera's idle time + 3 s, and
  // the next carrier / battleship / cruiser hit after that is in frame
  manual_pan: (R, E, act) => {
    if (!act || act.w === undefined) return { pass: false, why: 'the drag never happened', w: R.rec[0].w };
    const back = R.rec.find(r => r.w > act.w && r.ctx && !r.ctx.fc && r.shot);
    const e = (R.be || []).find(x => hitK(x) && BIG[x.c] && back && x.w > back.w + 2);
    if (!back) return { pass: false, why: 'the free camera never let go', w: act.w };
    if (!e) return null;
    return { pass: back.w - act.w <= act.idle + 3 && okNow(e), why: `director back ${(back.w - act.w).toFixed(0)} s after the drag (idle ${act.idle} s); next hit ${fmt(e)}`, w: e.w };
  }
};
// the cases (picked with --mine from the camera6 surveys; the event lies before `sim`)
// (picked with --mine from the camera6 survey of main at the true-speed clock; quick: in `npm run test:camera`)
const CASES = [
  { id: 'cv_torp_home', scen: 'midway', seed: 1, scale: 1, sim: 160, quick: true },     // Enterprise torpedoed, sim 149.4, a strike flying home
  { id: 'cv_dive_else', scen: 'midway', seed: 1, scale: 1, sim: 160, quick: true },     // a carrier bombed, sim 147.7, a dive going in on another ship
  { id: 'cv_pair', scen: 'midway', seed: 12, scale: 1, sim: 190, quick: true },         // two carriers bombed, sim 176.3 and 180.6
  { id: 'sinking', scen: 'midway', seed: 5, scale: 1, sim: 180 },                       // a carrier going down, sim 169.4
  { id: 'magazine', scen: 'standard', seed: 6, scale: 1, sim: 370 },                    // a destroyer's magazine, sim 360.8
  { id: 'gun_duel', scen: 'standard', seed: 7, scale: 1, sim: 375 },                    // battleship shell hits from sim 361.3
  { id: 'pt_ambush', scen: 'standard', seed: 10, scale: 1, sim: 380 },                  // a PT boat's torpedo on a battleship, sim 372.4
  { id: 'dive_lowsun', scen: 'standard', seed: 10, scale: 1, sim: 380 },                // VB-6 on a destroyer at sun 9.9 deg, sim ~218
  { id: 'sub_attack', scen: 'standard', seed: 12, scale: 1, sim: 365 },                 // a submarine's hit, sim 354.2
  { id: 'dd_torp', scen: 'carrier_duel', seed: 6, scale: 1, sim: 285, quick: true },    // a destroyer's spread from the run-in to the hit, sim 271.8
  { id: 'prot_down', scen: 'carrier_duel', seed: 10, scale: 1, sim: 200 },
  { id: 'dead_air', scen: 'carrier_duel', seed: 5, scale: 1, sim: 120, quick: true },   // the opening quiet minutes
  { id: 'hit_after_cut', scen: 'standard', seed: 7, scale: 1, sim: 375 },          // (the gun duel's round: hits in the first 3 s of a shot)
  { id: 'dive_usn_cv', scen: 'carrier_duel', seed: 5, scale: 1, sim: 295 },             // VB-6 on a carrier, push-over at sim 281.6
  { id: 'dive_ijn_cv', scen: 'midway', seed: 7, scale: 1, sim: 195, quick: true },      // the Kaga dive-bomber unit on a carrier, sim ~182
  { id: 'dive_small', scen: 'carrier_duel', seed: 2, scale: 1, sim: 200, quick: true }, // VB-6 on a destroyer, sim ~186
  { id: 'night_torp', scen: 'night_cv', seed: 1, scale: 1, sim: 300 },
  { id: 'manual_pan', scen: 'carrier_duel', seed: 10, scale: 1, sim: 195, drag: 150 }   // the next hit, a carrier torpedoed at sim 181.7
];
try { const f = path.join(__dirname, 'camera_cases.json'); if (fs.existsSync(f)) { const j = JSON.parse(fs.readFileSync(f, 'utf8')); for (const c of j) { const i = CASES.findIndex(x => x.id === c.id); if (i >= 0) CASES[i] = c; else CASES.push(c); } } } catch (e) { console.log('camera_cases.json: ' + e.message); }

async function runRound(b, spec, sim, drag) {
  const { p, errs } = await AU.openRound(b, spec);
  const act = {};
  while (true) {
    await p.evaluate(AU.WAIT);
    const t = await p.evaluate(CH => { __step(CH); return WW.game.state === 'battle' ? WW.time.now : -1; }, Math.round(300 / (spec.scale || 1)));   // (camera_audit.js survey's chunks: a --sheet replays it)
    if (drag !== undefined && act.w === undefined && t >= drag) {   // the user's right-drag (a pan) on the canvas, then hands off
      Object.assign(act, await p.evaluate(() => {
        const c = document.getElementById('game'), ev = (type, x, y, b) => (type === 'mousedown' ? c : window).dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 2, buttons: type === 'mouseup' ? 0 : 2, bubbles: true }));
        ev('mousedown', 400, 300); for (let i = 1; i <= 10; i++) { ev('mousemove', 400 + i * 12, 300 + i * 3); __step(3); } ev('mouseup', 520, 330);
        return { w: performance.now() / 1000, on: WW.freecam.active(), idle: +(WW.freecam._dbg().limit || 0).toFixed(1) };
      }));
      if (!act.on) act.w = undefined, act.failed = true;
    }
    if (t < 0 || t > sim) break;
  }
  const R = await p.evaluate(() => { const A = window.__audit; for (const e of A.ev) delete e._s; return { cfg: A.cfg, rec: A.rec, ev: A.ev, shots: A.shots, caps: A.caps, be: A.be, stor: A.stor, drops: A.drops, dives: A.dives.map(r => Object.assign({}, r, { _lp: undefined })), arcs: WW.cam.arcs ? WW.cam.arcs.map(a => Object.assign({}, a)) : null, story: WW.camStory ? WW.camStory.stats : null, la: WW.lookahead ? { on: WW.lookahead.on, diverged: WW.lookahead.diverged } : null }; });
  R.errs = errs.slice(0, 5); R.act = act;
  await p.close();
  return R;
}
function judge(c, R) {
  const E = SEL[c.id] ? SEL[c.id](R) : [];
  const r = CHECK[c.id](R, E, R.act);
  if (!r) return { pass: false, why: 'the situation did not happen in this round (pick another with --mine)', missing: true };
  if (R.la && !R.la.on) r.why += ' [look-ahead off]';
  return r;
}
function mine(dir) {
  for (const id of Object.keys(CHECK)) {
    const found = [];
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
      const R = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const E = SEL[id] ? SEL[id](R) : [];
      if (SEL[id] && !E.length) continue;
      const r = CHECK[id](R, E, id === 'manual_pan' ? { w: R.rec[0].w + 200, idle: 8 } : null);
      if (!r) continue;
      const t0 = R.shots[0] ? R.shots[0].w0 : 0, at = E[0] ? E[0].sim : null;
      found.push(`${R.cfg.name}:${R.cfg.seed} x${R.cfg.scale || 1} sim ${at} wall ${Math.round(r.w - t0)} ${r.pass ? 'PASS' : 'FAIL'} ${r.why}`);
    }
    console.log(`## ${id}: ${found.length} rounds\n  ` + found.sort((a, b) => (+a.split(' sim ')[1].split(' ')[0] || 1e9) - (+b.split(' sim ')[1].split(' ')[0] || 1e9)).slice(0, 8).join('\n  '));
  }
}
// --gate (npm run test:camera): the cases plus a short survey (GATE_ROUNDS) held to thresholds on the headline metrics
const GATE_ROUNDS = [['carrier_duel', 1, 4, 400], ['standard', 2, 4, 400], ['midway', 1, 4, 400], ['standard', 3, 4, 400]];   // scen, seed, speed, sim s (4x: a few minutes)
// (camera7: honest thresholds for 4 rounds at 4x in clear weather: camera6 measured CV-BE 91-100%, BB-BE 81-100%, M3 41-47%,
// 8.0-8.8 cuts / min (4x cuts faster than 1x's 6.6), dead air 8-10%; main before camera6: BB-BE 0%, 8.6 cuts / min, dead air 16%)
const GATE = { cv: 0.9, bb: 0.7, m3: 0.3, cutsMax: 9.5, deadMax: 0.13 };   // CV-BE, BB-BE, M3 top-1, cuts / min, dead air (bb / m3 re-set 2026-10-20 after balance19 re-rolled the rounds: its 4 rounds read BB-BE 73% of 11, M3 32%, with no camera change - 12-round A/B M3 44 vs 43%)
async function gateSurvey(b) {
  const dir = path.join(OUT, 'raw_gate'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  let next = 0;
  await Promise.all([...Array(Math.min(WORKERS, GATE_ROUNDS.length)).keys()].map(async () => {
    while (next < GATE_ROUNDS.length) { const [sc, sd, x, sim] = GATE_ROUNDS[next++]; await AU.survey(b, Object.assign(AU.specOf(sc, sd), { scale: x, sim, fast: false, wx: CASE_WX }), dir); }
  }));
  const all = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => AU.analyse(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
  const T = AU.merge(all), be = T.be || {};
  const m = { cv: be.cvN ? be.cvOk / be.cvN : 1, bb: be.bbN ? be.bbOk / be.bbN : 1, m3: T.act ? T.on1 / T.act : 1, cuts: 60 * T.cuts / Math.max(1, T.secs), dead: T.dead / Math.max(1, T.secs) };
  const fails = [];
  if (m.cv < GATE.cv) fails.push(`CV-BE ${(100 * m.cv).toFixed(0)}% < ${100 * GATE.cv}%`);
  if (m.bb < GATE.bb) fails.push(`BB-BE ${(100 * m.bb).toFixed(0)}% < ${100 * GATE.bb}%`);
  if (m.m3 < GATE.m3) fails.push(`M3 ${(100 * m.m3).toFixed(0)}% < ${100 * GATE.m3}%`);
  if (m.cuts > GATE.cutsMax) fails.push(`cuts ${m.cuts.toFixed(1)}/min > ${GATE.cutsMax}`);
  if (m.dead > GATE.deadMax) fails.push(`dead air ${(100 * m.dead).toFixed(0)}% > ${100 * GATE.deadMax}%`);
  console.log(`gate survey (${all.length} rounds): CV-BE ${(100 * m.cv).toFixed(0)}% of ${be.cvN}, BB-BE ${(100 * m.bb).toFixed(0)}% of ${be.bbN}, M3 ${(100 * m.m3).toFixed(0)}%, ${m.cuts.toFixed(1)} cuts/min, dead air ${(100 * m.dead).toFixed(0)}%` + (fails.length ? ' FAIL: ' + fails.join('; ') : ' PASS'));
  return !fails.length;
}
// --table DIR: write tests/camera_cases.json from a survey (camera_audit.js --wx clear, the cases' weather): per case, the
// three rounds with the earliest event in its scenarios, each with the sim s to run to (the event + a margin). Re-run after a
// sim change moves the rounds (the runner also falls back seed by seed when a case's event is gone from a round)
const SCENS_OK = { night_torp: ['night_cv', 'night', 'night_bl'] }, SPAN = { dead_air: 0, prot_down: 30, manual_pan: 15 };
function table(dir) {
  const rounds = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const simAt = (R, w) => { let s = 0; for (const r of R.rec) { if (r.w > w) break; s = r.sim; } return s; };
  const out = [];
  for (const c of CASES) {
    const found = [];
    for (const R of rounds) {
      if ((R.cfg.scale || 1) !== c.scale) continue;
      const ok = SCENS_OK[c.id] || [c.scen, 'standard', 'carrier_duel', 'midway'].filter((x, i, a) => a.indexOf(x) === i);
      if (ok.indexOf(R.cfg.name) < 0) continue;
      const E = SEL[c.id] ? SEL[c.id](R) : [];
      if (SEL[c.id] && !E.length) continue;
      const r = CHECK[c.id](R, E, c.id === 'manual_pan' ? { w: R.rec[0].w + 160, idle: 8 } : null);
      if (!r || (c.id === 'prot_down' && / 0 arcs ended/.test(r.why))) continue;
      const e0 = c.id === 'cv_pair' ? E[1] : E[0];
      let at = e0 ? (e0.sim !== undefined ? e0.sim : e0.sim0 + 25) : simAt(R, r.w);   // (a dive: its push-over + the dive)
      if (c.id === 'dead_air') at = simAt(R, r.w) + 60;
      if (c.id === 'prot_down') at = simAt(R, r.w + 8);
      if (c.id === 'manual_pan') { const h = (R.be || []).find(x => hitK(x) && BIG[x.c] && x.sim > c.drag + 12); if (!h) continue; at = h.sim; }   // (the next big hit after the drag and the free camera's idle)
      found.push({ scen: R.cfg.name, seed: R.cfg.seed, sim: Math.ceil(at + (SPAN[c.id] !== undefined ? SPAN[c.id] : 12)) });
    }
    found.sort((a, b) => a.sim - b.sim);
    const scen = found.length ? found[0].scen : c.scen, same = found.filter(f => f.scen === scen).slice(0, 3);
    const e = Object.assign({}, c, { scen, seeds: same.map(f => [f.seed, f.sim]) }); delete e.seed; delete e.sim;
    if (c.drag !== undefined) e.drag = c.drag;
    if (!same.length) { console.log('no round for ' + c.id + ' (kept as it was)'); out.push(c); } else out.push(e);
    console.log(c.id + ': ' + scen + ' ' + JSON.stringify(e.seeds));
  }
  fs.writeFileSync(path.join(__dirname, 'camera_cases.json'), '[\n' + out.map(e => ' ' + JSON.stringify(e)).join(',\n') + '\n]\n');
}
if (require.main === module) (async () => {
  if (args.includes('--mine')) return mine(arg('--mine'));
  if (args.includes('--table')) return table(arg('--table'));
  fs.mkdirSync(OUT, { recursive: true });
  const cases = CASES.filter(c => (!ONLY || ONLY.split(',').indexOf(c.id) >= 0) && (!args.includes('--quick') || c.quick));
  // cases on the same round share one run. camera7: each case lists candidate seeds (mined at the time, see --mine): if a
  // later sim change moves its event out of the first round ('the situation did not happen'), the next seed is tried, so
  // the gate does not break silently on a re-rolled round; the weather is pinned (CASE_WX) so a weather roll cannot either
  // (c.seeds: [[seed, sim s], ...] or plain seeds with c.sim)
  const seedsOf = c => (c.seeds || [c.seed]).map(x => Array.isArray(x) ? x : [x, c.sim]), jobs = [], res = [], keyOf = (c, sd) => `${c.scen}:${sd}:${c.scale}:${c.drag || ''}`;
  const queue = (list, ti) => {   // list: [{ c, ti }] -> jobs grouped by round
    const groups = new Map();
    for (const { c, ti } of list) { const [sd, sim] = seedsOf(c)[ti], k = keyOf(c, sd); const g = groups.get(k) || groups.set(k, { spec: c, seed: sd, cases: [], sim: 0 }).get(k); g.cases.push({ c, ti }); g.sim = Math.max(g.sim, sim); }
    jobs.push(...groups.values());
  };
  queue(cases.map(c => ({ c, ti: 0 })));
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let next = 0, busy = 0;
  await Promise.all([...Array(WORKERS).keys()].map(async () => {
    while (next < jobs.length || busy > 0) {
      if (next >= jobs.length) { await new Promise(r => setTimeout(r, 500)); continue; }
      const g = jobs[next++], c0 = g.spec, t0 = Date.now(); busy++;
      const spec = Object.assign(AU.specOf(c0.scen, g.seed), { scale: c0.scale, fast: false, wx: CASE_WX });
      let R;
      try { R = await runRound(b, spec, g.sim, c0.drag); } catch (e) { for (const { c } of g.cases) res.push({ c, seed: g.seed, pass: false, why: 'ERROR ' + e.message }); busy--; continue; }
      fs.writeFileSync(path.join(OUT, `${c0.scen}_${g.seed}_x${c0.scale}${c0.drag ? '_drag' : ''}.json`), JSON.stringify(R));
      const retry = [];
      for (const { c, ti } of g.cases) {
        const r = judge(c, R), t00 = R.shots[0] ? R.shots[0].w0 : 0;
        if (r.missing && ti + 1 < seedsOf(c).length) { console.log(`.... ${c.id} (${c.scen}/${g.seed}): not in this round, trying seed ${seedsOf(c)[ti + 1][0]}`); retry.push({ c, ti: ti + 1 }); continue; }
        if (R.errs.length) r.why += ' ERRORS ' + R.errs.join(' | ');
        res.push(Object.assign({ c, seed: g.seed, rel: r.w !== undefined ? Math.round(r.w - t00) : null }, r));
        console.log(`${r.pass ? 'PASS' : 'FAIL'} ${c.id} (${c.scen}/${g.seed} x${c.scale}): ${r.why} [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
      }
      if (retry.length) for (const x of retry) queue([x]);
      busy--;
    }
  }));
  if (args.includes('--sheets')) for (const r of res.filter(r => !r.pass && r.rel !== null)) {
    // the failed moment as a contact sheet (camera_audit.js --sheet replays the round the same way; scale passed through)
    const sh = `${r.c.scen}:${r.seed}:${Math.max(0, r.rel - 10)}:${r.rel + 4}:1`;
    console.log('sheet ' + r.c.id + ' ' + sh);
    cp.spawnSync('node', [path.join(__dirname, 'camera_audit.js'), '--sheet', sh, '--scale', String(r.c.scale), '--wx', CASE_WX, '--tag', 'case_' + r.c.id, '--out', OUT], { stdio: 'inherit', env: process.env });
  }
  const gok = args.includes('--gate') ? await gateSurvey(b) : true;
  await b.close();
  const n = res.filter(r => r.pass).length;
  console.log(`\ncamera cases: ${n} / ${res.length} pass` + (n < res.length ? ' (FAIL: ' + res.filter(r => !r.pass).map(r => r.c.id).join(', ') + ')' : '') + (args.includes('--gate') ? (gok ? '; gate survey PASS' : '; gate survey FAIL') : ''));
  process.exitCode = n === res.length && gok ? 0 : 1;
})();
module.exports = { CASES, SEL, CHECK, judge };
