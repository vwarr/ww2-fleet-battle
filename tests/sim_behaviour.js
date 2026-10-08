// AI behaviour acceptance suite (docs: the roles spec, "Harness checks" + "Acceptance").
// Runs targeted fleet match-ups headless (__sim.fastForward, no rendering) over several seeds and measures
// each ship type's behaviour from OBSERVABLE state only: positions, headings, speed, hp, alive/sinking,
// submerged, planes (kind/state/carrier/target/ordnance) and bus events (shellFired, shipHit, shipSunk,
// planeKill, weaponDropped, weaponImpact). It never reads AI internals (ship.ai), so it works on the old and
// the new AI. Fog-of-war checks use WW.intel when it exists (feature-detected), else they SKIP.
//
// Usage:  BASE_URL=http://localhost:8746/ node tests/sim_behaviour.js [--seeds N] [--seed0 S] [--only a,b] [--quick] [--pages K]
//         balance gate: --only balance --seeds 100 --pages 4   (balance/balance_mirror run only when named; --seeds 400 for tuning)
//         npm run test:ai            (tests/run.sh serves on port 8000)
// Env:    CHROMIUM = headless shell path;  JSON=path writes raw per-scenario metrics and per-round records.
// Exit code 1 if any hard check FAILs (WARN = fuzzy check, reported but not fatal).
//
// ---------------------------------------------------------------------------------------------------------
// BASELINE on the pre-roles AI (ai-strategy @ 1d327fa, 8 seeds/scenario, --pages 4: 62 s wall; --quick ~30 s).
// Seeds do not replay exactly yet (other randomness sources), so read these as statistics, not fixtures.
//   scenario            values (FAIL = hard fail, w = warn)
//   standard            cv_min 15 FAIL, cv_med 193 w, cv_in_gun 0.15 FAIL, cv_closing 0.36 FAIL, pt_loiter 0.30 FAIL,
//                       pt_pen med 0.22 w / max 0.99 w, pt_mg_big 0.13 FAIL, dd_sub_kills 0 w (subs die to torpedoes 9,
//                       shells 5), sub_dived_dd 0.51 FAIL, ftr_leash 0.37 FAIL, ftr_bombers 0.51 w, big_range 0.67 w,
//                       focus 4.1 w, broadside 0.59 w, crip_away 0.44 w, torp_parallel 0.37 w, len_med 241 w
//   pt_vs_bb            pt_loiter 0.40 FAIL, pt_mg_big 1.00 FAIL (PTs gun-duel the BB), pt_pen max 0.99 w
//   pt_raid             pt_loiter 0.14 FAIL, pt_mg_big 0.09 FAIL, pt_pen med 0.06 PASS (they die before going deep)
//   asw                 dd_sub_kills 0 FAIL (torpedo 5, shell 2), sub_dived_dd 0.64 FAIL, dd_react 0 s / 0.94 PASS
//   sub_ambush          sub_dived_dd 0.67 FAIL, sub_bowbeam 0.76 PASS
//   carrier_duel        cv_min 43 FAIL, cv_in_gun 0.08 FAIL, cvcv_min 111 w, ftr_leash 0.21 FAIL, air_drops 11.5 PASS
//   carrier_vs_surface  cv_min 37 FAIL, cv_in_gun 0.49 FAIL, cv_closing 0.21 FAIL, ftr_leash 0.89 PASS
//   battle_line         big_range 0.67 FAIL (band 0.7-0.95), focus 2.5 w, broadside 0.63 PASS, stuck 2 FAIL (BBs at map edge)
//   lone_cripple        crip_away 0.30 FAIL, lc_away 0.29 FAIL, stuck 1 FAIL
//   asymmetric          pt_loiter 0.21 FAIL, sub_dived_dd 0.29 FAIL, ftr_leash 0.76 FAIL, cv_min 112 PASS
//   mirror              like standard; usn_share 0.56; stuck 2 FAIL
//   always PASS         nan 0, page errors 0; unseen_shots SKIP (no WW.intel yet)
// BALANCE gate (--only balance,balance_mirror --seeds 100 --pages 4, 154 s): balance USN 52 / IJN 48 / draw 0 PASS,
//   decided USN rate 0.52 [0.42, 0.62]; balance_mirror (200 rounds) USN 109 / IJN 90 / draw 1 PASS (0.545, on the
//   edge), CI [0.48, 0.62]; the same fleet won from both sides in 65 of 100 pairs (fleet luck > nation bias).
//   ~0.3-0.4 s wall per round with 4 pages.
// ---------------------------------------------------------------------------------------------------------
const { chromium } = require('playwright');
const fs = require('fs');

// ======================= THRESHOLDS (tune here) =======================
// op: '<=' | '>=' | 'in' (thr = [lo, hi]) | '=='.  level: FAIL (hard) | WARN (fuzzy).
// only: scenarios the check applies to (null = all; a check with no data in a scenario is SKIP n/a).
// levelIn: per-scenario level override.
const P = {
  SAMPLE: 0.5,        // sim seconds between samples
  SONAR: 65,          // DD sonar radius used for the reaction metric (ships_ai.js SONAR)
  TURN_TOWARD: 30,    // deg: a DD "turned toward" a sub when its heading is within this of the bearing
  CAP_R: 35,          // CAP orbit radius around the carrier (aircraft.js orbit 35); leash = 1.5x
  LEASH_K: 1.5,
  RAID_R: 100,        // own carrier "under air attack": armed enemy bomber within this radius
  DASH_MAX: 30,       // s: one PT dash leg (>80% speed, heading within 60 deg of toward OR away from the big ship) lasts at most this
  DASH_SPEED: 0.8,
  SUB_DD_R: 40,       // sub "near" an enemy DD
  CRIP_HP: 0.35, CRIP_WIN: 30,
  TORP_PASS: 15, TORP_PAR: 30, // torpedo passes within 15u; heading within 30 deg of the track = parallel
  BROAD_LO: 45, BROAD_HI: 135,
  CV_CLOSE_DEG: 70, CV_THREAT_K: 1.5
};
const CHECKS = [
  // carrier
  { id: 'cv_min_dist',   desc: 'carrier min dist to enemy gun ship (u)', op: '>=', thr: 100, level: 'FAIL' },
  { id: 'cv_med_dist',   desc: 'carrier median dist to nearest gun ship', op: '>=', thr: 200, level: 'WARN' },
  { id: 'cv_in_gun',     desc: 'carrier time inside enemy gun range',    op: '<=', thr: 0.01, level: 'FAIL' },
  { id: 'cv_closing',    desc: 'carrier heading toward gun ship <1.5xR', op: '<=', thr: 0.10, level: 'FAIL' },
  { id: 'cvcv_min',      desc: 'min carrier-carrier distance (u)',       op: '>=', thr: 150, level: 'WARN', only: ['carrier_duel'] },
  { id: 'air_drops',     desc: 'air weapon drops per round (strikes)',   op: '>=', thr: 2, level: 'FAIL', only: ['carrier_duel', 'carrier_vs_surface'] },
  // PT
  { id: 'pt_loiter',     desc: 'PT time in BB/CA range outside a dash',  op: '<=', thr: 0.05, level: 'FAIL' },
  { id: 'pt_pen_med',    desc: 'PT max penetration past midline (median, x half-map)', op: '<=', thr: 0.15, level: 'WARN', levelIn: { pt_raid: 'FAIL' } },
  { id: 'pt_pen_max',    desc: 'PT max penetration past midline (worst)', op: '<=', thr: 0.35, level: 'WARN' },
  { id: 'pt_runs',       desc: 'PT torpedo runs per PT',                 op: '>=', thr: 0.5, level: 'WARN' },
  { id: 'pt_mg_big',     desc: 'share of PT MG shots at BB/CA',          op: '<=', thr: 0.05, level: 'FAIL' },
  // DD
  { id: 'dd_sub_kills',  desc: 'sub deaths by depth charge (DD)',        op: '>=', thr: 0.5, level: 'WARN', levelIn: { asw: 'FAIL' } },
  { id: 'dd_react_med',  desc: 'DD turn-toward-sub median (s)',          op: '<=', thr: 10, level: 'FAIL', only: ['asw', 'sub_ambush', 'standard'] },
  { id: 'dd_react_rate', desc: 'sonar contacts the DD turned toward',    op: '>=', thr: 0.7, level: 'WARN', only: ['asw', 'sub_ambush', 'standard'] },
  // sub
  { id: 'sub_bowbeam',   desc: 'sub torpedo shots from bow/beam arc',    op: '>=', thr: 0.7, level: 'FAIL' },
  { id: 'sub_dived_dd',  desc: 'sub submerged share when <40u of a DD',  op: '>=', thr: 0.8, level: 'FAIL' },
  // fighters
  { id: 'ftr_leash',     desc: 'CAP fighter time within leash of carrier', op: '>=', thr: 0.8, level: 'FAIL' },
  { id: 'ftr_bombers',   desc: 'bomber share of fighter kills in a raid', op: '>=', thr: 0.6, level: 'WARN' },
  { id: 'cap_gap',       desc: 'carrier time with <2 CAP up (fighters spare, after 60 s)', op: '<=', thr: 0.25, level: 'WARN' },
  { id: 'esc_with',      desc: 'escort time within 60u of its strike bombers', op: '>=', thr: 0.6, level: 'WARN' },
  { id: 'elem_coh',      desc: 'wingman dist to element leader in transit (median u)', op: '<=', thr: 20, level: 'WARN' },
  { id: 'air_sync',      desc: 'first VT drop vs first VB release on a target (median s)', op: '<=', thr: 10, level: 'WARN', only: ['carrier_duel', 'carrier_vs_surface', 'standard', 'mirror'] },
  { id: 'bomb_lost',     desc: 'bombers shot down before release / launched', op: '<=', thr: 0.35, level: 'WARN' },
  // big ships
  { id: 'big_range',     desc: 'BB/CA dist to target / main range',      op: 'in', thr: [0.7, 0.95], level: 'WARN', levelIn: { battle_line: 'FAIL' } },
  { id: 'focus',         desc: 'distinct main-battery targets/side/min', op: '<=', thr: 2.0, level: 'WARN', only: ['battle_line', 'standard', 'lone_cripple'] },
  { id: 'broadside',     desc: 'main-battery shots at broadside angle',  op: '>=', thr: 0.6, level: 'WARN', only: ['battle_line', 'standard', 'lone_cripple'] },
  { id: 'unseen_shots',  desc: 'shots at targets own side cannot see',   op: '==', thr: 0, level: 'FAIL', intel: true },
  // cripples / evasion
  { id: 'crip_away',     desc: 'ships <35% hp moving away (30 s window)', op: '>=', thr: 0.6, level: 'WARN', levelIn: { lone_cripple: 'FAIL' } },
  { id: 'lc_away',       desc: 'pre-damaged cruiser opening while threatened', op: '>=', thr: 0.6, level: 'FAIL', only: ['lone_cripple'] },
  { id: 'torp_parallel', desc: 'torpedo passes <15u with ship parallel (rand 0.33)', op: '>=', thr: 0.5, level: 'WARN' },
  // global
  { id: 'usn_share',     desc: 'USN share of decided wins',            op: 'in', thr: [0.35, 0.65], level: 'WARN', only: ['standard', 'mirror'] },
  // balance gate (user): over 100 random rounds each side wins 50 +- 5. Hard FAIL only with >= BAL_MIN_ROUNDS rounds.
  { id: 'bal_usn',       desc: 'USN wins / all rounds',                 op: 'in', thr: [0.45, 0.55], level: 'FAIL', only: ['balance', 'balance_mirror'], balance: true },
  { id: 'bal_ijn',       desc: 'IJN wins / all rounds',                 op: 'in', thr: [0.45, 0.55], level: 'FAIL', only: ['balance', 'balance_mirror'], balance: true },
  { id: 'len_med',       desc: 'median round length (sim s)',           op: 'in', thr: [300, 420], level: 'WARN', only: ['standard', 'mirror', 'balance', 'balance_mirror'] },
  { id: 'stuck',         desc: 'stuck ships',  op: '==', thr: 0, level: 'FAIL' },
  { id: 'nan',           desc: 'NaN positions', op: '==', thr: 0, level: 'FAIL' },
  { id: 'errors',        desc: 'page errors',  op: '==', thr: 0, level: 'FAIL' }
];
const INFO = ['jettisons', 'sync_n', 'first_fire', 'first_contact', 'first_sight', 'pt_in_big', 'big_band', 'torp_passes', 'sub_shots', 'dd_episodes', 'sub_killed_by', 'len_min', 'len_max', 'stuck_who'];

// ======================= SCENARIOS =======================
// A / B fleets; sides alternate with seed parity (odd seed: A = USN) unless random/mirror.
const rep = (t, n) => Array(n).fill(t);
const SCEN = [
  { name: 'standard', random: true },
  { name: 'pt_vs_bb', A: ['pt', 'pt'], B: ['battleship', 'cruiser'] },
  { name: 'pt_raid', A: rep('pt', 3), B: ['carrier', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3)] },
  { name: 'asw', A: ['destroyer', 'destroyer', 'cruiser'], B: ['submarine', 'submarine', 'cruiser'], noStall: true },
  { name: 'sub_ambush', A: ['submarine', 'submarine'], B: ['carrier', 'cruiser', 'destroyer', 'destroyer'], noStall: true },
  { name: 'carrier_duel', A: ['carrier', 'destroyer', 'destroyer'], B: ['carrier', 'destroyer', 'destroyer'] },
  { name: 'carrier_vs_surface', A: ['carrier', 'destroyer', 'destroyer'], B: ['battleship', 'cruiser', 'cruiser'] },
  { name: 'battle_line', A: ['battleship', 'battleship', 'cruiser', 'cruiser'], B: ['battleship', 'battleship', 'cruiser', 'cruiser'] },
  { name: 'lone_cripple', A: ['battleship', 'cruiser', 'cruiser', 'destroyer', 'destroyer'], B: ['battleship', 'cruiser', 'cruiser', 'destroyer', 'destroyer'], cripple: 1 },
  { name: 'asymmetric', A: ['carrier', 'battleship', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3), 'submarine', 'pt', 'pt'], B: ['cruiser', 'destroyer', 'destroyer'] },
  { name: 'mirror', random: true, mirror: true }, // random fleets, each run twice with USN/IJN swapped (nation bias)
  // Balance gate: run only on request (--only balance --seeds 100 [--pages 4]). Light rounds: no behaviour sampling.
  { name: 'balance', random: true, light: true, optIn: true },
  { name: 'balance_mirror', random: true, mirror: true, light: true, optIn: true } // same fleet twice, sides swapped
];
const BAL_MIN_ROUNDS = 100;

// ======================= CLI =======================
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const QUICK = argv.includes('--quick');
const SEEDS = +arg('--seeds', QUICK ? 2 : 8), SEED0 = +arg('--seed0', 1);
const ONLY = arg('--only', null), PAGES = Math.max(1, +arg('--pages', 1));
const scens = SCEN.filter(s => (ONLY ? ONLY.split(',').includes(s.name) : !s.optIn));

// ======================= PAGE SIDE =======================
function install(P) {
  const B = window.__beh = {}, PI = Math.PI, D2R = PI / 180;
  const live = s => s && s.alive && !s.sinking;
  const brg = (a, b) => Math.atan2(b.z - a.z, b.x - a.x);
  const GUN = { battleship: 1, cruiser: 1, destroyer: 1 }, BIG = { battleship: 1, cruiser: 1 };
  const now = () => WW.game.roundTime;
  let R = null;

  // ---- WW.intel feature detection: sees(nation, ship) -> bool, or null ----
  function intelSees() {
    const I = WW.intel; if (!I) return null;
    for (const n of ['canSee', 'isVisible', 'visible', 'detected', 'isDetected', 'sees']) if (typeof I[n] === 'function') return (na, s) => !!I[n](na, s);
    for (const n of ['contact', 'get']) if (typeof I[n] === 'function') return (na, s) => { const c = I[n](na, s); return !!c && (c.seenAt === undefined || WW.time.now - c.seenAt <= 3.5); };
    return null;
  }

  // ---- placement (own copy of main.js's spiral; start zone derived from the game's randomComposition) ----
  const SLOTS = { carrier: [[0, 0], [0, -50], [0, 50]], battleship: [[72, -28], [72, 28]], cruiser: [[36, -64], [36, 64], [40, -112], [40, 112]],
    destroyer: [[98, -56], [100, 0], [98, 56]], submarine: [[118, -30], [118, 30]], pt: [[112, 32], [108, 84], [112, -32]] };
  function nearestOk(x, z, type, placed) {
    const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, md = WW.SHIP_TYPES[type].minDepth + 1;
    const clear = (px, pz) => placed.every(p => { const n = WW.game.minSpacing(type, p.type); return WW.dist2(px, pz, p.x, p.z) >= n * n; });
    for (const strict of [true, false]) for (let r = 0; r < 200; r += 3) {
      const n = Math.max(1, Math.round(r / 2));
      for (let i = 0; i < n; i++) {
        const a = i / n * PI * 2, px = WW.clamp(x + Math.cos(a) * r, 5, W - 5), pz = WW.clamp(z + Math.sin(a) * r, 8, H - 8);
        if (WW.terrain.isNavigable(px, pz, md) && (!strict || clear(px, pz))) return { x: px, z: pz, type };
      }
    }
    return { x, z, type };
  }
  function zones() {
    const c = WW.game.randomComposition(), z = {};
    for (const n of ['USN', 'IJN']) {
      const cv = c.filter(e => e.nation === n && e.type === 'carrier');
      z[n] = { rx: cv.reduce((s, e) => s + e.x, 0) / cv.length, cz: cv.reduce((s, e) => s + e.z, 0) / cv.length, dir: n === 'USN' ? 1 : -1 };
    }
    return z;
  }
  function placeFleet(types, nation, zn, out) {
    const placed = [], idx = {};
    for (const type of types) {
      const i = idx[type] = (idx[type] || 0) + 1, sl = SLOTS[type][(i - 1) % SLOTS[type].length];
      const p = nearestOk(zn.rx + zn.dir * sl[0], zn.cz + zn.dir * sl[1], type, placed);
      placed.push(p); out.push({ type, nation, x: p.x, z: p.z });
    }
  }
  function refit(comp) { // fix a composition onto good water with spacing, per nation
    const out = [];
    for (const n of ['USN', 'IJN']) { const placed = []; for (const c of comp.filter(c => c.nation === n)) { const p = nearestOk(c.x, c.z, c.type, placed); placed.push(p); out.push({ type: c.type, nation: n, x: p.x, z: p.z }); } }
    return out;
  }

  // ---- event listeners (installed once; inert between rounds) ----
  WW.on('shellFired', e => {
    if (!R || !e || !e.ship || !e.proj || !e.proj.target) return;
    const s = e.ship, tg = e.proj.target, t = now(), main = s.stats.guns[0];
    if (R.firstFire === null) R.firstFire = t;
    if (s.type === 'pt') { R.pt.mgShots++; if (BIG[tg.type]) R.pt.mgBig++; }
    if (BIG[s.type] && main && e.cal === main.cal) {
      R.lastMain[s.id] = { tg, t };
      const k = s.nation + ':' + Math.floor(t / 60); (R.focus[k] = R.focus[k] || {})[tg.id] = 1;
      const rel = Math.abs(WW.angleDiff(s.heading, brg(s, tg))) / D2R;
      R.big.shots++; if (rel >= P.BROAD_LO && rel <= P.BROAD_HI) R.big.broad++;
    }
    if (B.sees) { R.intel.checked++; try { if (!B.sees(s.nation, tg)) R.intel.unseen++; } catch (err) { R.intel.err++; } }
  });
  WW.on('shipHit', e => { if (R && e && e.ship) R.lastHit[e.ship.id] = e.kind; });
  WW.on('shipSunk', s => {
    if (!R || !s) return;
    R.sunk.push({ type: s.type, nation: s.nation, t: +now().toFixed(1) });
    if (s.type === 'submarine') { const k = R.lastHit[s.id] || '?'; R.dd.subDeaths++; if (k === 'dc') R.dd.subDC++; R.dd.kinds[k] = (R.dd.kinds[k] || 0) + 1; }
  });
  WW.on('planeKill', e => {
    if (!R || !e || !e.shooter || e.shooter.kind !== 'fighter') return;
    const cv = e.shooter.carrier; if (!live(cv)) return;
    const armed = p => p && p.nation !== e.shooter.nation && (p.kind === 'dive' || p.kind === 'torpedo') && p.ordnance && WW.dist(p.x, p.z, cv.x, cv.z) < P.RAID_R;
    if (!(armed(e.victim) || WW.world.planes.some(p => p.alive && armed(p)))) return;
    R.ftr.killsUA++; if (e.victim && (e.victim.kind === 'dive' || e.victim.kind === 'torpedo')) R.ftr.bomberKillsUA++;
  });
  WW.on('weaponDropped', e => {
    if (!R || !e) return;
    const o = e.plane, t = now();
    if (o && o.kind && !o.stats) {                           // a plane (bomb or aerial torpedo)
      R.air.drops++; o.__dropped = true;
      const tg = e.target || o.target, k = tg && tg.id !== undefined ? o.nation + ':' + tg.id : null;
      if (k) { // strike coordination: first VT drop vs first VB release on the same target, per attack (90 s window)
        let a = R.sync[k]; if (!a || t - a.t0 > 90) a = R.sync[k] = { t0: t, vt: null, vb: null, done: false };
        const f = o.kind === 'torpedo' ? 'vt' : o.kind === 'dive' ? 'vb' : null;
        if (f && a[f] === null) a[f] = t;
        if (!a.done && a.vt !== null && a.vb !== null) { a.done = true; R.air.sync.push(+Math.abs(a.vt - a.vb).toFixed(1)); }
      }
    }
    if (e.kind !== 'torpedo' || !e.proj) return;
    const p = e.proj; R.torps.push({ p, nation: p.nation, best: {}, done: false });
    if (!o || !o.stats) return;                              // ship-fired
    const k = o.id, fresh = t - (R.lastSpread[k] === undefined ? -99 : R.lastSpread[k]) > 2;
    R.lastSpread[k] = t;
    if (!fresh) return;
    if (o.type === 'pt') R.pt.spreads++;
    if (o.type === 'submarine') {
      // intended target = enemy ship nearest the track ray
      let best = null, bp = 1e9; const c = Math.cos(p.h), sn = Math.sin(p.h);
      for (const s of WW.world.ships) {
        if (!live(s) || s.nation === o.nation || s.submerged) continue;
        const dx = s.x - o.x, dz = s.z - o.z, along = dx * c + dz * sn, perp = Math.abs(-dx * sn + dz * c);
        if (along > 0 && along < (p.range || 120) + 30 && perp < bp) { bp = perp; best = s; }
      }
      if (best) { const aob = Math.abs(WW.angleDiff(best.heading, brg(best, o))) / D2R; R.sub[aob < 60 ? 'bow' : aob <= 120 ? 'beam' : 'stern']++; }
    }
  });
  function finishTorp(tr) {
    tr.done = true;
    for (const id in tr.best) { const b = tr.best[id]; if (b.d < P.TORP_PASS) { R.torp.passes++; if (b.par) R.torp.par++; } }
  }
  const parallel = (h, th) => { let a = Math.abs(WW.angleDiff(h, th)); a = Math.min(a, PI - a); return a < P.TORP_PAR * D2R; };
  WW.on('weaponImpact', e => {
    if (!R || !e || e.kind !== 'torpedo') return;
    const tr = R.torps.find(q => q.p === e.proj && !q.done); if (!tr) return;
    if (e.ship) tr.best[e.ship.id] = { d: 0, par: parallel(e.ship.heading, e.proj.h) };
    finishTorp(tr);
  });

  // ---- one sample ----
  function sample(dt) {
    const t = now(), all = WW.world.ships, L = all.filter(live), W = WW.cfg.MAP_W;
    const enemies = s => L.filter(o => o.nation !== s.nation);
    for (const s of L) {
      if (!isFinite(s.x) || !isFinite(s.z)) R.nan++;
      const m = R.moved[s.id] || (R.moved[s.id] = { x: s.x, z: s.z, t });
      if (WW.dist(m.x, m.z, s.x, s.z) > 3) { m.x = s.x; m.z = s.z; m.t = t; } else if (t - m.t > 30 && !m.flag) { m.flag = true; R.stuck++; R.stuckWho.push(s.nation + ':' + s.type + '@' + Math.round(s.x) + ',' + Math.round(s.z)); }
      if (R.firstContact === null && s.type !== 'submarine' && s.stats.guns[0])
        for (const o of enemies(s)) if (!o.submerged && WW.dist(s.x, s.z, o.x, o.z) <= s.stats.guns[0].range) { R.firstContact = t; break; }
      if (B.sees && R.firstSight === null) for (const o of enemies(s)) { try { if (B.sees(s.nation, o)) { R.firstSight = t; break; } } catch (e) { /* */ } }
    }
    for (const s of L) {
      const en = enemies(s), sp = s.speed / s.stats.speed;
      // ---- carriers ----
      if (s.type === 'carrier') {
        let dmin = 1e9, inGun = false, thr = null, thrK = 1e9;
        for (const o of en) {
          const d = WW.dist(s.x, s.z, o.x, o.z), g = o.stats.guns[0];
          if (o.type === 'carrier') { R.cv.cvcvMin = Math.min(R.cv.cvcvMin, d); continue; }
          if (!g || o.type === 'submarine') continue;
          if (d <= g.range) inGun = true;
          if (!GUN[o.type]) continue;
          dmin = Math.min(dmin, d);
          if (d < P.CV_THREAT_K * g.range && d / g.range < thrK) { thrK = d / g.range; thr = o; }
        }
        R.cv.samples++; if (inGun) R.cv.inGun++; if (dmin < 1e9) R.cv.d.push(Math.round(dmin));
        if (thr) { R.cv.thr++; if (sp > 0.3 && Math.cos(WW.angleDiff(s.heading, brg(s, thr))) > Math.cos(P.CV_CLOSE_DEG * D2R)) R.cv.closing++; }
      }
      // ---- PT boats ----
      if (s.type === 'pt') {
        const st = R.ptS[s.id] || (R.ptS[s.id] = { pen: -1, streak: 0 });
        st.pen = Math.max(st.pen, (s.nation === 'USN' ? s.x - W / 2 : W / 2 - s.x) / (W / 2));
        let inBig = false, nb = null, nbd = 1e9;
        for (const o of en) if (BIG[o.type]) { const d = WW.dist(s.x, s.z, o.x, o.z); if (d <= o.stats.guns[0].range) inBig = true; if (d < nbd) { nbd = d; nb = o; } }
        const cs = nb ? Math.cos(WW.angleDiff(s.heading, brg(s, nb))) : 0, leg = cs > 0 ? 1 : -1;
        const dash = nb && sp > P.DASH_SPEED && Math.abs(cs) > 0.5;
        st.streak = dash ? (leg === st.leg ? st.streak + dt : dt) : 0; st.leg = leg; // ingress and egress are separate legs
        R.pt.time += dt;
        if (inBig) { R.pt.inBig += dt; if (!(dash && st.streak <= P.DASH_MAX)) R.pt.loiter += dt; }
      }
      // ---- destroyers: sonar reaction ----
      if (s.type === 'destroyer') for (const o of en) {
        if (o.type !== 'submarine') continue;
        const k = s.id + ':' + o.id, d = WW.dist(s.x, s.z, o.x, o.z), inR = d < P.SONAR, st = R.ddP[k];
        if (inR && !(st && st.in)) R.ddP[k] = { in: true, t0: t, done: false };
        const q = R.ddP[k];
        if (inR && !q.done && Math.abs(WW.angleDiff(s.heading, brg(s, o))) < P.TURN_TOWARD * D2R) { q.done = true; R.dd.react.push(+(t - q.t0).toFixed(1)); }
        if (!inR && q && q.in) { if (!q.done) R.dd.missed++; q.in = false; }
      }
      // ---- subs near DDs ----
      if (s.type === 'submarine' && en.some(o => o.type === 'destroyer' && WW.dist(s.x, s.z, o.x, o.z) < P.SUB_DD_R)) { if (s.submerged) R.sub.nearDived += dt; else R.sub.nearSurf += dt; }
      // ---- big ships: stand-off ----
      if (BIG[s.type]) {
        const lm = R.lastMain[s.id];
        if (lm && t - lm.t < 10 && live(lm.tg)) {
          const f = WW.dist(s.x, s.z, lm.tg.x, lm.tg.z) / s.stats.guns[0].range;
          R.big.fs += f; R.big.fn++; if (f >= 0.7 && f <= 0.95) R.big.band++;
        }
      }
      // ---- cripples ----
      if (s.type !== 'submarine' && s.hp < P.CRIP_HP * s.maxHp) {
        const c = R.crip[s.id] || (R.crip[s.id] = { t0: t });
        let nn = null, nd = 1e9; for (const o of en) if (!o.submerged) { const d = WW.dist(s.x, s.z, o.x, o.z); if (d < nd) { nd = d; nn = o; } }
        if (nn && t - c.t0 <= P.CRIP_WIN) { R.cr.n++; if (sp > 0.2 && Math.cos(WW.angleDiff(s.heading, brg(s, nn))) < 0) R.cr.away++; }
      }
      if (s.__beCripple) {
        let th = null, tk = 1e9;
        for (const o of en) { const g = o.stats.guns[0]; if (!g || !GUN[o.type]) continue; const k = WW.dist(s.x, s.z, o.x, o.z) / g.range; if (k < 1.2 && k < tk) { tk = k; th = o; } }
        if (th) { R.lc.n++; if (sp > 0.2 && Math.cos(WW.angleDiff(s.heading, brg(s, th))) < 0) R.lc.away++; }
      }
    }
    // ---- fighters on CAP ----
    for (const p of WW.world.planes) {
      if (!p.alive || p.kind !== 'fighter' || p.target || !live(p.carrier) || (p.state !== 'transit' && p.state !== 'attack') || p.deckPh) continue;
      R.ftr.t += dt; if (WW.dist(p.x, p.z, p.carrier.x, p.carrier.z) <= P.CAP_R * P.LEASH_K) R.ftr.inLeash += dt;
    }
    // ---- air ops: CAP relief gaps, escorts with their strike, element cohesion, armed bombers lost / jettisoned ----
    const PL = WW.world.planes, up = p => p.alive && (p.state === 'transit' || p.state === 'attack') && !p.deckPh;
    if (t > 60) for (const cv of L) {
      if (cv.type !== 'carrier' || !cv.hangar) continue;
      const cap = PL.filter(p => p.carrier === cv && p.kind === 'fighter' && !p.target && up(p)).length;
      if (cap >= 2 || cv.hangar.fighter + PL.filter(p => p.carrier === cv && p.kind === 'fighter' && p.alive).length < 2) continue;
      R.air.capN++; if (cap < 2) R.air.capGap++;
    }
    for (const p of PL) {
      if (p.kind === 'fighter' && p.target && up(p) && live(p.carrier)) {
        R.air.escN++; if (PL.some(b => b.alive && b.carrier === p.carrier && (b.kind === 'dive' || b.kind === 'torpedo') && WW.dist(b.x, b.z, p.x, p.z) < 60)) R.air.escWith++;
      }
      if (p.leader && p.leader.alive && up(p) && p.state === 'transit' && up(p.leader) && p.leader.state === 'transit' && !p.foe) R.air.coh.push(+Math.hypot(p.x - p.leader.x, p.y - p.leader.y, p.z - p.leader.z).toFixed(1));
      if (p.kind !== 'dive' && p.kind !== 'torpedo') continue;
      if (p.alive && p.ordnance && !p.__seen) { p.__seen = true; R.air.bombers++; }
      if (p.__seen && !p.__fate) {
        if (!p.alive && p.ordnance) { p.__fate = 1; if (p.state === 'falling' || p.state === 'ditch' || p.deathMode) R.air.lostArmed++; }
        else if (p.alive && !p.ordnance && !p.__dropped) { p.__fate = 1; R.air.jett++; }
        else if (!p.ordnance) p.__fate = 1;
      }
    }
    // ---- torpedo closest approach ----
    for (const tr of R.torps) {
      if (tr.done) continue;
      const p = tr.p; if (p.dead || p.kind !== 'torp') { finishTorp(tr); continue; }
      for (const s of L) {
        if (s.nation === tr.nation) continue;
        const d = WW.dist(p.x, p.z, s.x, s.z); if (d > 40) continue;
        const b = tr.best[s.id]; if (!b || d < b.d) tr.best[s.id] = { d, par: parallel(s.heading, p.h) };
      }
    }
  }

  // ---- one round ----
  B.run = function (spec) {
    const G = WW.game, W = WW.cfg.MAP_W, cap = WW.cfg.ROUND_TIMEOUT + 30;
    B.sees = intelSees();
    WW.terrain.generate(spec.seed); WW.seedRandom(spec.seed); G.seed = spec.seed;
    let comp;
    if (spec.random) {
      comp = G.randomComposition();
      if (spec.swap) comp = refit(comp.map(c => ({ type: c.type, nation: WW.enemyOf(c.nation), x: W - c.x, z: c.z })));
    } else {
      const zn = zones(); comp = [];
      placeFleet(spec.A, spec.aNation, zn[spec.aNation], comp);
      placeFleet(spec.B, WW.enemyOf(spec.aNation), zn[WW.enemyOf(spec.aNation)], comp);
    }
    if (WW.aces) WW.aces.reset(); // aces carry over between rounds by design: fresh rosters keep seeds repeatable
    WW.seedRandom(spec.seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.composition = comp; G.startRound({ keepMap: true }); G.composition = null;
    if (spec.cripple >= 0) { const s = WW.world.ships.filter(s => s.nation === spec.aNation)[spec.cripple]; if (s) { s.hp = s.maxHp * 0.25; s.__beCripple = true; if (s.applyLook) s.applyLook(); } }
    R = { stuckWho: [], firstFire: null, firstContact: null, firstSight: null, stuck: 0, nan: 0, moved: {}, lastHit: {}, sunk: [], lastMain: {}, focus: {}, lastSpread: {}, torps: [], ptS: {}, ddP: {}, crip: {},
      cv: { samples: 0, inGun: 0, d: [], thr: 0, closing: 0, cvcvMin: 1e9 }, pt: { time: 0, inBig: 0, loiter: 0, spreads: 0, mgShots: 0, mgBig: 0, n: 0, pen: [] },
      dd: { subDeaths: 0, subDC: 0, react: [], missed: 0, kinds: {} }, sub: { bow: 0, beam: 0, stern: 0, nearDived: 0, nearSurf: 0 },
      ftr: { t: 0, inLeash: 0, killsUA: 0, bomberKillsUA: 0 }, big: { fs: 0, fn: 0, band: 0, shots: 0, broad: 0 },
      intel: { checked: 0, unseen: 0, err: 0 }, cr: { n: 0, away: 0 }, lc: { n: 0, away: 0 }, torp: { passes: 0, par: 0 }, sync: {},
      air: { drops: 0, sync: [], capN: 0, capGap: 0, escN: 0, escWith: 0, coh: [], bombers: 0, lostArmed: 0, jett: 0 } };
    const types = {}; for (const s of WW.world.ships) types[s.nation + ':' + s.type] = (types[s.nation + ':' + s.type] || 0) + 1;
    R.pt.n = WW.world.ships.filter(s => s.type === 'pt').length;
    const step = spec.light ? 5 : P.SAMPLE;
    while (G.state === 'battle' && G.roundTime < cap) {
      __sim.fastForward(step);
      if (spec.light) { if (spec.noStall) G.lastSink = G.roundTime; for (const s of WW.world.ships) if (!isFinite(s.x) || !isFinite(s.z)) R.nan++; continue; }
      if (spec.noStall && G.state === 'battle') G.lastSink = G.roundTime;
      sample(P.SAMPLE);
    }
    for (const tr of R.torps) if (!tr.done) finishTorp(tr);
    for (const k in R.ddP) if (R.ddP[k].in && !R.ddP[k].done) R.dd.missed++;
    const alive = n => WW.world.ships.some(s => s.alive && s.nation === n);
    const out = { seed: spec.seed, aNation: spec.aNation || null, swap: !!spec.swap, winner: G.winner, len: +G.roundTime.toFixed(0),
      end: G.state === 'battle' ? 'cap' : alive('USN') && alive('IJN') ? 'time' : 'kill', comp: types,
      firstFire: R.firstFire, firstContact: R.firstContact, firstSight: R.firstSight, stuck: R.stuck, stuckWho: R.stuckWho, nan: R.nan, sunk: R.sunk,
      cv: Object.assign({}, R.cv), pt: Object.assign({}, R.pt, { pen: Object.values(R.ptS).map(s => +s.pen.toFixed(3)) }), dd: R.dd, sub: R.sub,
      ftr: R.ftr, big: R.big, focusCounts: Object.values(R.focus).map(o => Object.keys(o).length), intel: R.intel, intelOn: !!B.sees,
      cr: R.cr, lc: R.lc, torp: R.torp, air: Object.assign({}, R.air, { coh: R.air.coh.length ? [R.air.coh.sort((a, b) => a - b)[R.air.coh.length >> 1]] : [] }) };
    if (out.cv.cvcvMin === 1e9) out.cv.cvcvMin = null;
    R = null;
    return out;
  };
}

// ======================= AGGREGATION =======================
// 95% Wilson interval for k successes out of n
function wilson(k, n) {
  if (!n) return null; const z = 1.96, ph = k / n, d = 1 + z * z / n, c = (ph + z * z / (2 * n)) / d, h = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d;
  return [+(c - h).toFixed(3), +(c + h).toFixed(3)];
}
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const ratio = (a, b) => (b > 0 ? a / b : null);
function aggregate(rounds) {
  const S = (f) => rounds.reduce((s, r) => s + f(r), 0), C = (f) => rounds.flatMap(f);
  const cvd = C(r => r.cv.d), pen = C(r => r.pt.pen), react = C(r => r.dd.react);
  const decided = rounds.filter(r => r.winner), lens = rounds.map(r => r.len), cvcv = rounds.map(r => r.cv.cvcvMin).filter(v => v !== null);
  const ptN = S(r => r.pt.n), shots = S(r => r.sub.bow + r.sub.beam + r.sub.stern), near = S(r => r.sub.nearDived + r.sub.nearSurf);
  const focus = C(r => r.focusCounts), intelOn = rounds.some(r => r.intelOn);
  const firsts = k => med(rounds.map(r => r[k]).filter(v => v !== null));
  return {
    rounds: rounds.length,
    cv_min_dist: cvd.length ? Math.min(...cvd) : null, cv_med_dist: med(cvd), cv_in_gun: ratio(S(r => r.cv.inGun), S(r => r.cv.samples)),
    cv_closing: ratio(S(r => r.cv.closing), S(r => r.cv.thr)), cvcv_min: cvcv.length ? Math.min(...cvcv) : null,
    air_drops: rounds.length ? S(r => r.air.drops) / rounds.length : null,
    pt_loiter: ratio(S(r => r.pt.loiter), S(r => r.pt.time)), pt_in_big: ratio(S(r => r.pt.inBig), S(r => r.pt.time)),
    pt_pen_med: med(pen), pt_pen_max: pen.length ? Math.max(...pen) : null, pt_runs: ptN ? S(r => r.pt.spreads) / ptN : null,
    pt_mg_big: ratio(S(r => r.pt.mgBig), S(r => r.pt.mgShots)),
    dd_sub_kills: ratio(S(r => r.dd.subDC), S(r => r.dd.subDeaths)), dd_react_med: med(react),
    dd_react_rate: ratio(react.length, react.length + S(r => r.dd.missed)), dd_episodes: react.length + S(r => r.dd.missed),
    sub_bowbeam: ratio(S(r => r.sub.bow + r.sub.beam), shots), sub_shots: shots, sub_dived_dd: ratio(S(r => r.sub.nearDived), near),
    cap_gap: ratio(S(r => r.air.capGap || 0), S(r => r.air.capN || 0)), esc_with: ratio(S(r => r.air.escWith || 0), S(r => r.air.escN || 0)),
    elem_coh: med(C(r => r.air.coh || [])), air_sync: med(C(r => r.air.sync || [])), sync_n: C(r => r.air.sync || []).length,
    bomb_lost: ratio(S(r => r.air.lostArmed || 0), S(r => r.air.bombers || 0)), jettisons: rounds.length ? S(r => r.air.jett || 0) / rounds.length : null,
    ftr_leash: ratio(S(r => r.ftr.inLeash), S(r => r.ftr.t)), ftr_bombers: ratio(S(r => r.ftr.bomberKillsUA), S(r => r.ftr.killsUA)),
    big_range: ratio(S(r => r.big.fs), S(r => r.big.fn)), big_band: ratio(S(r => r.big.band), S(r => r.big.fn)),
    focus: focus.length ? focus.reduce((a, b) => a + b, 0) / focus.length : null, broadside: ratio(S(r => r.big.broad), S(r => r.big.shots)),
    unseen_shots: intelOn && !S(r => r.intel.err) ? S(r => r.intel.unseen) : null, intel_err: S(r => r.intel.err), intel_on: intelOn,
    crip_away: ratio(S(r => r.cr.away), S(r => r.cr.n)), lc_away: ratio(S(r => r.lc.away), S(r => r.lc.n)),
    torp_parallel: ratio(S(r => r.torp.par), S(r => r.torp.passes)), torp_passes: S(r => r.torp.passes),
    usn_share: ratio(decided.filter(r => r.winner === 'USN').length, decided.length),
    bal_usn: ratio(rounds.filter(r => r.winner === 'USN').length, rounds.length), bal_ijn: ratio(rounds.filter(r => r.winner === 'IJN').length, rounds.length),
    usn_ci: wilson(decided.filter(r => r.winner === 'USN').length, decided.length),
    len_med: med(lens), len_min: lens.length ? Math.min(...lens) : null, len_max: lens.length ? Math.max(...lens) : null,
    first_fire: firsts('firstFire'), first_contact: firsts('firstContact'), first_sight: firsts('firstSight'),
    sub_killed_by: (() => { const k = {}; for (const r of rounds) for (const n in r.dd.kinds) k[n] = (k[n] || 0) + r.dd.kinds[n]; return Object.entries(k).map(e => e.join(':')).join(',') || null; })(),
    stuck_who: C(r => r.stuckWho.map(w => 's' + r.seed + ':' + w)).join(' ') || null,
    stuck: S(r => r.stuck), nan: S(r => r.nan)
  };
}
const LIGHT_CHECKS = ['bal_usn', 'bal_ijn', 'len_med', 'nan', 'errors']; // light (balance) rounds sample nothing else
function judge(c, v, scen, nRounds) {
  if (c.only && !c.only.includes(scen)) return null;
  if (SCEN.find(s => s.name === scen && s.light) && !LIGHT_CHECKS.includes(c.id)) return null;
  let level = (c.levelIn && c.levelIn[scen]) || c.level;
  if (c.balance && nRounds < BAL_MIN_ROUNDS) level = 'WARN'; // too few rounds for a hard balance verdict
  if (v === null || v === undefined || Number.isNaN(v)) return { level, res: 'SKIP' };
  const ok = c.op === '<=' ? v <= c.thr : c.op === '>=' ? v >= c.thr : c.op === '==' ? v === c.thr : v >= c.thr[0] && v <= c.thr[1];
  return { level, res: ok ? 'PASS' : level };
}
// mirror pairs (rounds 2i, 2i+1 share a fleet with the sides swapped): how often the same fleet won both times
const pairs = rounds => { let n = 0; for (let i = 0; i + 1 < rounds.length; i += 2) { const a = rounds[i].winner, b = rounds[i + 1].winner; if (a && b && a !== b) n++; } return n; };
const fmt = v => (v === null || v === undefined ? 'n/a' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 2 : 0)) : String(v));
const fmtThr = c => (c.op === 'in' ? `${c.thr[0]}..${c.thr[1]}` : `${c.op} ${c.thr}`);

// ======================= MAIN =======================
(async () => {
  const T0 = Date.now();
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let errs = [];
  const pages = [];
  for (let k = 0; k < PAGES; k++) { // --pages K: K independent game pages run rounds in parallel
    const p = await b.newPage({ viewport: { width: 640, height: 360 } });
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
    await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?v=' + Date.now());
    await p.waitForTimeout(1500);
    // stop the render loop driving the sim (setScale clamps at 0.1; the director's slow-motion warp too): we drive it
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; __sim.setScale(0.1); });
    await p.evaluate(install, P);
    pages.push(p);
  }
  const results = {}, raw = {};
  let hardFails = 0;
  const totals = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  for (const sc of scens) {
    const t0 = Date.now(), e0 = errs.length, specs = [];
    for (let i = 0; i < SEEDS; i++) {
      const seed = SEED0 + i, light = !!sc.light;
      if (sc.random) specs.push(...(sc.mirror ? [{ seed, random: true, light }, { seed, random: true, swap: true, light }] : [{ seed, random: true, light }]));
      else specs.push({ seed, A: sc.A, B: sc.B, aNation: seed % 2 ? 'USN' : 'IJN', cripple: sc.cripple === undefined ? -1 : sc.cripple, noStall: !!sc.noStall });
    }
    const rounds = new Array(specs.length);
    let next = 0;
    await Promise.all(pages.map(async pg => { while (next < specs.length) { const i = next++; rounds[i] = await pg.evaluate(s => window.__beh.run(s), specs[i]); } }));
    const M = aggregate(rounds); M.errors = errs.length - e0;
    results[sc.name] = M; raw[sc.name] = rounds;
    const wall = ((Date.now() - t0) / 1000).toFixed(1);
    const wins = { USN: 0, IJN: 0, draw: 0, A: 0, B: 0 };
    for (const r of rounds) { wins[r.winner || 'draw']++; if (r.aNation && r.winner) wins[r.winner === r.aNation ? 'A' : 'B']++; }
    console.log(`\n== ${sc.name}  (${rounds.length} rounds, ${wall}s)  USN ${wins.USN} IJN ${wins.IJN} draw ${wins.draw}${sc.A ? `  fleetA ${wins.A} fleetB ${wins.B}` : ''}  len ${M.len_min}/${M.len_med}/${M.len_max}s`);
    const rows = [];
    for (const c of CHECKS) {
      if (c.intel && M.unseen_shots === null) { if (sc.light) continue; if (!c.only || c.only.includes(sc.name)) rows.push([c.id, M.intel_on ? `intel API err ${M.intel_err}` : 'no WW.intel', fmtThr(c), 'SKIP']); continue; }
      const v = c.id === 'errors' ? M.errors : M[c.id], j = judge(c, v, sc.name, M.rounds);
      if (!j) continue;
      rows.push([c.id, fmt(v), fmtThr(c) + (j.level === 'WARN' ? ' (warn)' : ''), j.res]);
    }
    for (const r of rows) {
      totals[r[3]]++;
      if (r[3] === 'FAIL') hardFails++;
    }
    const shown = rows.filter(r => r[1] !== 'n/a' || r[0] === 'unseen_shots');
    for (const r of shown) console.log(`  ${r[0].padEnd(14)} ${r[1].padStart(11)}  ${r[2].padEnd(18)} ${r[3]}`);
    const skipped = rows.filter(r => r[1] === 'n/a').map(r => r[0]);
    if (skipped.length) console.log(`  (n/a: ${skipped.join(' ')})`);
    if (sc.light) {
      const d = rounds.filter(r => r.winner).length, u = rounds.filter(r => r.winner === 'USN').length;
      console.log(`  balance: USN ${wins.USN} / IJN ${wins.IJN} / draw ${wins.draw} of ${rounds.length};  USN win rate on decided ${fmt(ratio(u, d))}  95% CI [${(M.usn_ci || []).join(', ')}]` +
        `;  ${(Date.now() - t0) / 1000 / rounds.length * PAGES >= 0 ? ((Date.now() - t0) / 1000 / rounds.length).toFixed(2) : ''} s wall/round (${PAGES} page${PAGES > 1 ? 's' : ''})` +
        (sc.mirror ? `;  same fleet won both sides in ${pairs(rounds)} of ${rounds.length >> 1} pairs` : ''));
    }
    if (!sc.light) console.log('  info: ' + INFO.map(k => `${k} ${fmt(M[k])}`).join('  '));
  }
  console.log('\n=== SUMMARY ===');
  console.log(`checks: PASS ${totals.PASS}  FAIL ${totals.FAIL}  WARN ${totals.WARN}  SKIP ${totals.SKIP}   scenarios ${scens.length} x ${SEEDS} seeds   wall ${((Date.now() - T0) / 1000).toFixed(0)}s`);
  for (const sc of scens) {
    const M = results[sc.name], f = [];
    for (const c of CHECKS) {
      const v = c.id === 'errors' ? M.errors : M[c.id], j = judge(c, v, sc.name, M.rounds);
      if (j && j.res !== 'PASS' && j.res !== 'SKIP') f.push(`${c.id}${j.res === 'WARN' ? '(w)' : ''}`);
    }
    console.log(`  ${sc.name.padEnd(19)} ${f.length ? f.join(' ') : 'all pass'}`);
  }
  if (errs.length) console.log('page errors:\n' + errs.slice(0, 10).join('\n'));
  if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify({ params: P, checks: CHECKS, results, rounds: raw }, null, 1));
  await b.close();
  process.exitCode = hardFails ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
