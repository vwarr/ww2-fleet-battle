// AI behaviour acceptance suite (docs: the roles spec, "Harness checks" + "Acceptance").
// Runs targeted fleet match-ups headless (__sim.fastForward, no rendering) over several seeds and measures
// each ship type's behaviour from OBSERVABLE state only: positions, headings, speed, hp, alive/sinking,
// submerged, planes (kind/state/carrier/target/ordnance) and bus events (shellFired, shipHit, shipSunk,
// planeKill, weaponDropped, weaponImpact). It never reads AI internals (ship.ai), so it works on the old and
// the new AI. Fog-of-war checks use WW.intel when it exists (feature-detected), else they SKIP.
//
// Usage:  node tests/sim_behaviour.js [--seeds N] [--seed0 S] [--only a,b] [--quick] [--workers K] [--browser | --render]
//         balance gate: --only balance --seeds 100   (balance/balance_mirror run only when named; --seeds 400 for tuning)
//         Default: sim-only mode in the node runner (tests/node_sim.js, worker threads, no Chrome, no server).
//         --browser: sim-only Chrome pages (BASE_URL=http://localhost:PORT/, CHROMIUM = headless shell path);
//         --render: the full game on software GL. All three give identical results.
//         --workers K (alias --pages K): parallel games. Default node: cores - 2 (MAX_WORKERS caps it); browser: 6
//         pages (M1 Pro, 6P+2E cores: on the balance gate 6 and 5 tie, both beat 4 and 8).
//         npm run test:ai
// Env:    JSON=path writes raw per-scenario metrics and per-round records.
// Exit code 1 if any hard check FAILs (WARN = fuzzy check, reported but not fatal).
// cv_closing uses the carrier side's own picture (WW.intel.known, last-known positions up to 90 s old), not raw
// positions: its 1.5 x range radius is 255 for a battleship, but a carrier only sees a battleship at 240, so the raw
// metric blamed carriers for steaming toward ships they could not know about. cv_min_dist / cv_in_gun stay raw.
// End reasons per round (G.endReason): kill (a side's surface fleet sunk), retire (main.js: a broken side's survivors left
// the map over its home edge), time (the limit, stretched for a pursuit; a sub stall counts here), cap (still running).
// Carrier checks (cv_min_dist, cv_in_gun, cv_closing) skip the samples while the carrier's own side is broken (fleet_cmd
// brokenAt, posture 'withdraw'): it is then running for its edge and is fair game for the pursuer; those samples are
// reported as cv_brk_min / cv_brk_gun (info).
// Endgame (endgame.js stats, info): wipeout (a kill with no CV / BB / CA / DD of the loser escaped earlier), carriers
// escaped per round, pursuit kills,
// Doctrine (ship_fires.js, ai_charge.js stats, info, per round unless noted): deck hits on a loaded flight deck that
// set it off / that did not (deck_safe), planes lost on deck, fuel / magazine chain explosions, fires started, fires
// put out per nation, ships sunk by fire, USN hp patched, magazine explosions (total), escort charges, destroyers
// sent, charging destroyers lost, their torpedo hits, foes turned back, carriers lost during a charge; rescues and survivors (USN), cripples abandoned / scuttled (IJN),
// ships escaped; spd_hp: mean speedK of live surface ships per hp band (<0.3, 0.3-0.5, 0.5-0.7, >=0.7).
// Flying boats (air_flyingboats.js / air_patrol.js stats, info, per round): fb_rescues / fb_survivors (Catalina pickups),
// cat_lost (rescue Catalinas lost), pat_sight_* / pat_lost_* (ships reported / boats lost on patrol per nation); intel.js
// sighting reports: misid (misidentified first reports), bad_strikes (strikes launched on a misidentified or > 25 off
// plot), bad_redirects (of those, strike leaders that redirected on arrival).
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
const fs = require('fs');
const HL = require('./headless');
const FZ = require('./fuzz');   // composition fuzz (--only fuzz): odd and lopsided fleets

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
  { id: 'cv_closing',    desc: 'carrier heading toward known gun ship <1.5xR', op: '<=', thr: 0.10, level: 'FAIL' }, // intel contacts, see sample()
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
  { id: 'ftr_leash',     desc: 'CAP fighter time within leash of carrier', op: '>=', thr: 0.8, level: 'FAIL', levelIn: { midway: 'WARN', weather: 'WARN' } }, // midway: raids from the island come in from every side; weather: raids routed round a squall line spread the CAP fight
  { id: 'ftr_bombers',   desc: 'bomber share of fighter kills in a raid', op: '>=', thr: 0.6, level: 'WARN' },
  { id: 'cap_on_bmb',    desc: 'CAP fighters in a fight during a raid that fight bombers', op: '>=', thr: 0.6, level: 'WARN' },
  { id: 'cap_gap',       desc: 'carrier time with <2 CAP up while it could (after 60 s)', op: '<=', thr: 0.25, level: 'WARN' },
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
  // endgame targets (user): about half the battles end with the last ships run down (kill), at most 15% on time.
  // WARN: at 100 rounds the 95% interval is about +-10 points (kill 40-48% across the two 100-round seed sets).
  { id: 'end_kill',      desc: 'rounds ending in a kill (last ship sunk)', op: '>=', thr: 0.5, level: 'WARN', only: ['standard', 'mirror', 'balance', 'balance_mirror'] },
  { id: 'end_time',      desc: 'rounds ending on time',                 op: '<=', thr: 0.15, level: 'WARN', only: ['standard', 'mirror', 'balance', 'balance_mirror'] },
  { id: 'form_later_max', desc: 'later strikes: median form-up orbit per nation (s)', op: '<=', thr: 10, level: 'WARN' },
  { id: 'pt_nn_p10',     desc: 'PT nearest same-side PT (not its pair-mate), 10th pct', op: '>=', thr: 25, level: 'WARN', levelIn: { fuzz: 'FAIL' } },
  // night and weather (daylight.js, night_ops.js, weather.js)
  { id: 'dark_launch',   desc: 'carrier / scout launches after dusk',   op: '==', thr: 0, level: 'FAIL' },
  { id: 'night_torps',   desc: 'night torpedo spreads per round',       op: '>=', thr: 0.5, level: 'WARN', only: ['night', 'dusk'] },
  { id: 'star_shells',   desc: 'star shells per round',                 op: '>=', thr: 1, level: 'WARN', only: ['night', 'dusk'] },
  { id: 'wx_detect',     desc: 'first-sighting range in rain / clear',   op: '<=', thr: 0.85, level: 'WARN', only: ['weather'] },
  { id: 'stuck',         desc: 'stuck ships',  op: '==', thr: 0, level: 'FAIL' },
  { id: 'nan',           desc: 'NaN positions', op: '==', thr: 0, level: 'FAIL' },
  { id: 'errors',        desc: 'page errors',  op: '==', thr: 0, level: 'FAIL' }
];
const DOCTRINE_INFO = ['deck_hits', 'deck_safe', 'deck_planes', 'deck_chain', 'fires', 'fires_out_usn', 'fires_out_ijn', 'fire_kills', 'usn_repaired', 'magazines',
  'charges', 'charge_dds', 'charge_lost', 'charge_torp', 'charge_turned', 'charge_cv_sunk'];
const BASE_INFO = ['base_neut', 'base_t_neut', 'base_cap_leash', 'base_raids', 'rw_closures', 'batteries_out', 'land_strikes', 'land_sorties', 'land_hits', 'bombard_runs', 'bombard_shells'];
const NIGHT_INFO = ['tod', 'det_day', 'det_dusk', 'det_night', 'det_radar', 'det_flash', 'night_torps_n', 'searchlights', 'radar_sights', 'night_land', 'night_land_loss', 'recalls', 'wx_det_rain', 'wx_det_clear', 'dive_holds', 'dive_aborts', 'cv_shelter'];
const FB_INFO = ['fb_rescues', 'fb_survivors', 'cat_lost', 'pat_sight_usn', 'pat_sight_ijn', 'pat_lost_usn', 'pat_lost_ijn', 'misid', 'bad_strikes', 'bad_redirects'];
const INFO = [...BASE_INFO, ...NIGHT_INFO, ...FB_INFO, ...DOCTRINE_INFO, 'end_retire', 'wipeout', 'cv_escaped', 'pursuit_kills', 'escaped', 'usn_rescues', 'usn_survivors', 'usn_pilots', 'usn_lost_srv', 'ijn_abandoned', 'ijn_scuttled', 'spd_hp', 'cv_brk_min', 'cv_brk_gun', 'srch_sect', 'srch_lost', 'form_first', 'form_later', 'sync_usn', 'sync_ijn', 'reserve', 'strafe_hits', 'pt_nn_p10', 'first_dmg', 'cap_bkills', 'jettisons', 'sync_n', 'first_fire', 'first_contact', 'first_sight', 'pt_in_big', 'big_band', 'torp_passes', 'sub_shots', 'pt_torp_hit', 'sub_torp_hit', 'dd_episodes', 'sub_killed_by', 'len_min', 'len_max', 'stuck_who'];

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
  // the fight for an island (island_base.js): a USN base and a USN carrier group against an IJN carrier striking force
  { name: 'midway', A: ['carrier', 'cruiser', 'destroyer', 'destroyer'], B: ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], aFixed: 'USN', base: 'USN' },
  { name: 'night', random: true, tod: 'night' },   // a standard fleet, fought at night from the start (daylight.js)
  { name: 'dusk', random: true, tod: 120 },        // dusk begins 120 s in, dark by 270 s: carriers recover, then a night action
  { name: 'weather', random: true, wx: 'line' },   // a squall line crosses mid-map ~140 s in (weather.js)
  // Balance gate: run only on request (--only balance --seeds 100 [--pages 4]). Light rounds: no behaviour sampling.
  { name: 'balance', random: true, light: true, optIn: true },
  { name: 'balance_mirror', random: true, mirror: true, light: true, optIn: true }, // same fleet twice, sides swapped
  // Composition fuzz: run only on request (--only fuzz --seeds N). Per seed one named odd fleet + one random one.
  { name: 'fuzz', fuzz: true, optIn: true }
];
const BAL_MIN_ROUNDS = 100;

// ======================= CLI =======================
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const DAY_CLEAR = argv.includes('--day-clear'); // every round by day in clear weather (comparison runs: daylight.js, weather.js)
const QUICK = argv.includes('--quick');
const SEEDS = +arg('--seeds', QUICK ? 2 : 8), SEED0 = +arg('--seed0', 1);
const TUNE_OPT = arg('--tune', null); // island base knobs: k=v,... into WW.islandBase.TUNE (tons, guns, pits, air, radar, defend, target, chart, power)
const BASE_OPT = arg('--base', null); // island base owner for every round: USN | IJN | none (default: the scenario's, else the round's roll)
const ONLY = arg('--only', null), PAGES = HL.WORKERS; // --workers K (alias --pages K): worker threads (node) or pages (browser)
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
  WW.on('waveGo', e => { if (R && e) R.forms.push({ n: e.nation, f: !!e.first, m: e.mode, t: +(+e.formT).toFixed(1), r: !!e.reserve, tt: e.target ? e.target.type : null }); });
  WW.on('shipHit', e => { if (R && e && e.ship && e.amount > 0) { if (R.firstDmg === null) R.firstDmg = now(); R.dmgSum += +e.amount || 0; } });
  WW.on('shipHit', e => { if (R && e && e.ship) { R.lastHit[e.ship.id] = e.kind; const k = e.ship.nation + ':' + e.ship.type + ':' + e.kind; R.dmg[k] = (R.dmg[k] || 0) + (+e.amount || 0); } });
  WW.on('shipSunk', s => {
    if (!R || !s) return;
    R.sunk.push({ type: s.type, nation: s.nation, t: +now().toFixed(1), by: R.lastHit[s.id] || null });
    if (s.type === 'submarine') { const k = R.lastHit[s.id] || '?'; R.dd.subDeaths++; if (k === 'dc') R.dd.subDC++; R.dd.kinds[k] = (R.dd.kinds[k] || 0) + 1; }
  });
  WW.on('planeKill', e => {
    if (!R || !e || !e.shooter || e.shooter.kind !== 'fighter') return;
    if (!e.shooter.target && e.victim && (e.victim.kind === 'dive' || e.victim.kind === 'torpedo')) R.air.capBK++; // CAP gun kill on a bomber
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
        if (!a.done && a.vt !== null && a.vb !== null) { a.done = true; R.air.sync.push(+Math.abs(a.vt - a.vb).toFixed(1)); (R.syncN[o.nation] = R.syncN[o.nation] || []).push(+Math.abs(a.vt - a.vb).toFixed(1)); }
      }
    }
    if (e.kind !== 'torpedo' || !e.proj) return;
    const p = e.proj; R.torps.push({ p, nation: p.nation, best: {}, done: false });
    if (o && (o.type === 'pt' || o.type === 'submarine')) R.th[o.type].fired++; // torpedo hit rate per launcher type
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
    const ow = e.proj && e.proj.owner; if (e.ship && !e.dud && ow && (ow.type === 'pt' || ow.type === 'submarine')) R.th[ow.type].hit++;
    const tr = R.torps.find(q => q.p === e.proj && !q.done); if (!tr) return;
    if (e.ship) tr.best[e.ship.id] = { d: 0, par: parallel(e.ship.heading, e.proj.h) };
    finishTorp(tr);
  });

  // ---- detection ranges (night / weather): the distance at which a ship acquires an enemy ship (not seen for > 3 s,
  // now seen by a ship observer), binned by daylight (day > 0.8, dusk, night < 0.3), radar, and rain on the line ----
  function detect() {
    if (!WW.intel) return;
    const tn = WW.time.now, dl = WW.daylight === undefined ? 1 : WW.daylight;
    for (const n of ['USN', 'IJN']) for (const c of WW.intel.enemyShips(n)) {
      const k = n + ':' + c.unit.id, v = tn - c.seenAt <= 0.6, was = R.vis[k];
      R.vis[k] = v;
      if (!v || was || !c.by || !c.by.stats || !c.by.alive || c.quality === 'sonar') continue;
      const d = Math.round(WW.dist(c.by.x, c.by.z, c.unit.x, c.unit.z));
      if (c.quality === 'radar') R.det.radar.push(d);
      else if (c.unit.firedAt > tn - 6 || c.unit.searchOn) R.det.flash.push(d); // gun flash / searchlight
      else {
        (dl > 0.8 ? R.det.day : dl > 0.3 ? R.det.dusk : R.det.night).push(d);
        if (WW.weather && WW.weather.cells.length && dl > 0.8) (WW.weather.along(c.by.x, c.by.z, c.unit.x, c.unit.z) > 0.3 ? R.det.rain : R.det.clear).push(d);
      }
    }
  }
  // ---- one sample ----
  function sample(dt) {
    detect();
    const t = now(), all = WW.world.ships, L = all.filter(live), W = WW.cfg.MAP_W;
    const enemies = s => L.filter(o => o.nation !== s.nation);
    for (const p of WW.world.planes) if (p.alive && (!isFinite(p.x) || !isFinite(p.z) || !isFinite(p.heading))) R.nan++; // planes too
    for (const s of L) {
      if (!isFinite(s.x) || !isFinite(s.z)) R.nan++;
      const m = R.moved[s.id] || (R.moved[s.id] = { x: s.x, z: s.z, t });
      const lurk = s.type === 'submarine' && s.submerged && enemies(s).some(o => !o.submerged && WW.dist(s.x, s.z, o.x, o.z) < 120); // a sub holding its ambush submerged, a target close: waiting, not stuck
      if (WW.dist(m.x, m.z, s.x, s.z) > 3 || lurk) { m.x = s.x; m.z = s.z; m.t = t; } else if (t - m.t > 30 && !m.flag) { m.flag = true; R.stuck++; R.stuckWho.push(s.nation + ':' + s.type + '@' + Math.round(s.x) + ',' + Math.round(s.z)); }
      if (R.firstContact === null && s.type !== 'submarine' && s.stats.guns[0])
        for (const o of enemies(s)) if (!o.submerged && WW.dist(s.x, s.z, o.x, o.z) <= s.stats.guns[0].range) { R.firstContact = t; break; }
      if (B.sees && R.firstSight === null) for (const o of enemies(s)) { try { if (B.sees(s.nation, o)) { R.firstSight = t; break; } } catch (e) { /* */ } }
    }
    for (const s of L) {
      const en = enemies(s), sp = s.speed / (s.stats.speed * (s.speedK || 1)); // share of what it can make now (damage slows ships)
      // ---- carriers ----
      const brk = B.broken(s.nation);
      if (s.type === 'carrier') {
        let dmin = 1e9, inGun = false, thr = null, thrK = 1e9;
        for (const o of en) {
          const d = WW.dist(s.x, s.z, o.x, o.z), g = o.stats.guns[0];
          if (o.type === 'carrier') { R.cv.cvcvMin = Math.min(R.cv.cvcvMin, d); continue; }
          if (!g || o.type === 'submarine') continue;
          if (d <= g.range) inGun = true;
          if (!GUN[o.type]) continue;
          dmin = Math.min(dmin, d);
          // cv_closing judges the carrier on what its side knows (WW.intel contact, last-known position), not on
          // raw positions: with raw positions a battleship at 241-255 (inside 1.5 x 170) that the carrier cannot
          // see yet (a battleship is seen at 240) counted as "closing on a threat" (the sensing-gap quirk).
          const k = B.known ? B.known(s.nation, o) : o;
          if (!k) continue;
          const dk = WW.dist(s.x, s.z, k.x, k.z);
          if (dk < P.CV_THREAT_K * g.range && dk / g.range < thrK) { thrK = dk / g.range; thr = k; }
        }
        if (brk) { R.cv.brkN++; if (inGun) R.cv.brkGun++; if (dmin < 1e9) R.cv.brkMin = Math.min(R.cv.brkMin, Math.round(dmin)); }
        else { R.cv.samples++; if (inGun) R.cv.inGun++; if (dmin < 1e9) R.cv.d.push(Math.round(dmin)); }
        if (thr && !brk) { R.cv.thr++; if (sp > 0.3 && Math.cos(WW.angleDiff(s.heading, brg(s, thr))) > Math.cos(P.CV_CLOSE_DEG * D2R)) R.cv.closing++; }
      }
      // ---- speed vs hp (ship_speed.js speedK) ----
      if (s.type !== 'submarine' && s.speedK !== undefined) { const f = s.hp / s.maxHp, k = f < 0.3 ? 0 : f < 0.5 ? 1 : f < 0.7 ? 2 : 3; R.spd[k] += s.speedK; R.spdN[k]++; }
      // ---- PT boats ----
      if (s.type === 'pt') {
        const st = R.ptS[s.id] || (R.ptS[s.id] = { pen: -1, streak: 0 });
        st.pen = Math.max(st.pen, (s.nation === 'USN' ? s.x - W / 2 : W / 2 - s.x) / (W / 2));
        let inBig = false, nb = null, nbd = 1e9;
        // at night (daylight < 0.3) a PT is judged on the darkened big ships its side knows of (contact <= 30 s old), like cv_closing
        const dark = WW.daylight !== undefined && WW.daylight < 0.3, knows = o => !dark || (B.known && WW.intel.known(s.nation, o) && WW.time.now - WW.intel.known(s.nation, o).seenAt <= 30);
        for (const o of en) if (BIG[o.type]) { const d = WW.dist(s.x, s.z, o.x, o.z); if (d <= o.stats.guns[0].range && knows(o)) inBig = true; if (d < nbd) { nbd = d; nb = o; } }
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
    // ---- PT spacing: nearest same-side PT that is not its pair-mate (the commander's PT group pairs by slot) ----
    if (t >= 30 && t - R.nnT >= 2) { // after the start formation has had time to break up
      R.nnT = t;
      for (const n of ['USN', 'IJN']) {
        const pts = L.filter(s => s.type === 'pt' && s.nation === n); if (pts.length < 2) continue;
        const Bk = WW.fleetCmd && WW.fleetCmd.side ? WW.fleetCmd.side(n) : null, M = Bk && Bk.groups && Bk.groups.pt ? Bk.groups.pt.members : pts;
        for (const p of pts) {
          const i = M.indexOf(p), mate = i >= 0 ? M[i ^ 1] : null;
          let nn = 1e9; for (const q of pts) if (q !== p && q !== mate) nn = Math.min(nn, WW.dist(p.x, p.z, q.x, q.z));
          if (nn < 1e9) R.ptNN.push(Math.round(nn));
        }
      }
    }
    // ---- fighters on CAP ----
    for (const p of WW.world.planes) {
      if (!p.alive || p.kind !== 'fighter' || p.target || p.search || !p.carrier || (!p.carrier.isBase && !live(p.carrier)) || (p.state !== 'transit' && p.state !== 'attack') || p.deckPh) continue;
      if (WW.dayNight && !WW.dayNight.canFly()) continue; // after dusk the CAP is recalled (daylight.js): no leash to keep
      if (p.carrier.isBase) { R.ftr.bt = (R.ftr.bt || 0) + dt; if (WW.dist(p.x, p.z, p.carrier.x, p.carrier.z) <= P.CAP_R * P.LEASH_K) R.ftr.bin = (R.ftr.bin || 0) + dt; continue; } // island base CAP: info only
      R.ftr.t += dt; if (WW.dist(p.x, p.z, p.carrier.x, p.carrier.z) <= P.CAP_R * P.LEASH_K) R.ftr.inLeash += dt;
    }
    // ---- air ops: CAP relief gaps, escorts with their strike, element cohesion, armed bombers lost / jettisoned ----
    const PL = WW.world.planes, up = p => p.alive && (p.state === 'transit' || p.state === 'attack') && !p.deckPh;
    if (t > 60 && !(WW.dayNight && !WW.dayNight.canFly())) for (const cv of L) { // (no CAP after dusk: daylight.js)
      if (cv.type !== 'carrier' || !cv.hangar) continue;
      const cap = PL.filter(p => p.carrier === cv && p.kind === 'fighter' && !p.target && !p.search && up(p)).length;
      if (cap + cv.hangar.fighter < 2) continue;                // the air boss could have two up
      R.air.capN++; if (cap < 2) R.air.capGap++;
    }
    for (const p of PL) { // CAP during a raid on its carrier: is its foe a bomber?
      if (p.kind !== 'fighter' || p.target || p.search || !up(p) || p.state !== 'attack' || !p.foe || !live(p.carrier)) continue;
      const cv = p.carrier; if (!PL.some(b => b.alive && b.nation !== p.nation && (b.kind === 'dive' || b.kind === 'torpedo') && b.ordnance && WW.dist(b.x, b.z, cv.x, cv.z) < P.RAID_R)) continue;
      R.air.capF++; if (p.foe.kind === 'dive' || p.foe.kind === 'torpedo') R.air.capB++;
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
  B.broken = n => { const S = WW.fleetCmd && WW.fleetCmd.side(n); return !!(S && S.brokenAt && S.posture === 'withdraw'); };
  B.run = function (spec) {
    const G = WW.game, W = WW.cfg.MAP_W, cap = WW.cfg.ROUND_TIMEOUT + 180; // main.js stretches the limit by up to 150 s for a pursuit
    B.sees = intelSees();
    B.known = WW.intel && typeof WW.intel.known === 'function' ? (n, u) => { const c = WW.intel.known(n, u); return c && WW.time.now - c.seenAt <= 90 ? c : null; } : null;
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
    if (WW.dayNight) WW.dayNight.force = spec.tod || (spec.dayClear ? 'day' : null); // night / dusk scenarios (daylight.js); --day-clear: all by day
    if (WW.weather) WW.weather.force = spec.wx || (spec.dayClear ? 'clear' : null);  // weather scenario (weather.js)
    if (WW.aces) WW.aces.reset(); // aces carry over between rounds by design: fresh rosters keep seeds repeatable
    WW.seedRandom(spec.seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.noRetire = !!spec.noStall; // ASW scenarios measure the hunt: no sub stall, no retire ending
    G.baseChoice = spec.base || null; // the island base's owner (island_base.js); null: the round's WW.rand roll
    G.composition = comp; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
    const tons0 = { USN: G.tonnage('USN'), IJN: G.tonnage('IJN') }; // fleet tonnage at the start (out.tons: the loss margin, balance_ab.js)
    const snap = () => JSON.parse(JSON.stringify({ d: WW.dayNight ? WW.dayNight.stats : {}, n: WW.nightOps ? WW.nightOps.stats : {}, w: WW.weather ? WW.weather.stats : {} }));
    const s0 = snap();
    if (spec.cripple >= 0) { const s = WW.world.ships.filter(s => s.nation === spec.aNation)[spec.cripple]; if (s) { s.hp = s.maxHp * 0.25; s.__beCripple = true; if (s.applyLook) s.applyLook(); } }
    R = { vis: {}, det: { day: [], dusk: [], night: [], radar: [], flash: [], rain: [], clear: [] }, forms: [], firstDmg: null, dmgSum: 0, ptNN: [], nnT: -99, syncN: {}, th: { pt: { fired: 0, hit: 0 }, submarine: { fired: 0, hit: 0 } }, stuckWho: [], dmg: {}, firstFire: null, firstContact: null, firstSight: null, stuck: 0, nan: 0, moved: {}, lastHit: {}, sunk: [], lastMain: {}, focus: {}, lastSpread: {}, torps: [], ptS: {}, ddP: {}, crip: {},
      cv: { samples: 0, inGun: 0, d: [], thr: 0, closing: 0, cvcvMin: 1e9, brkN: 0, brkGun: 0, brkMin: 1e9 }, spd: [0, 0, 0, 0], spdN: [0, 0, 0, 0], pt: { time: 0, inBig: 0, loiter: 0, spreads: 0, mgShots: 0, mgBig: 0, n: 0, pen: [] },
      dd: { subDeaths: 0, subDC: 0, react: [], missed: 0, kinds: {} }, sub: { bow: 0, beam: 0, stern: 0, nearDived: 0, nearSurf: 0 },
      ftr: { t: 0, inLeash: 0, killsUA: 0, bomberKillsUA: 0 }, big: { fs: 0, fn: 0, band: 0, shots: 0, broad: 0 },
      intel: { checked: 0, unseen: 0, err: 0 }, cr: { n: 0, away: 0 }, lc: { n: 0, away: 0 }, torp: { passes: 0, par: 0 }, sync: {},
      air: { drops: 0, sync: [], capN: 0, capGap: 0, escN: 0, escWith: 0, coh: [], bombers: 0, lostArmed: 0, jett: 0, capF: 0, capB: 0, capBK: 0 } };
    const types = {}; for (const s of WW.world.ships) types[s.nation + ':' + s.type] = (types[s.nation + ':' + s.type] || 0) + 1;
    R.pt.n = WW.world.ships.filter(s => s.type === 'pt').length;
    const step = spec.light ? 5 : P.SAMPLE, planesSeen = new Set();
    while (G.state === 'battle' && G.roundTime < cap) {
      __sim.fastForward(step);
      for (const p of WW.world.planes) planesSeen.add(p); // planes lost per nation (balance diagnosis)
      if (spec.light) { if (spec.noStall) G.lastSink = G.roundTime; for (const s of WW.world.ships) if (!isFinite(s.x) || !isFinite(s.z)) R.nan++; continue; }
      if (spec.noStall && G.state === 'battle') G.lastSink = G.roundTime;
      sample(P.SAMPLE);
    }
    for (const tr of R.torps) if (!tr.done) finishTorp(tr);
    for (const k in R.ddP) if (R.ddP[k].in && !R.ddP[k].done) R.dd.missed++;
    const out = { seed: spec.seed, aNation: spec.aNation || null, swap: !!spec.swap, winner: G.winner, len: +G.roundTime.toFixed(0),
      end: G.state === 'battle' ? 'cap' : G.endReason === 'stall' ? 'time' : G.endReason, comp: types,
      eg: WW.endgame && WW.endgame.stats ? JSON.parse(JSON.stringify(WW.endgame.stats)) : null, spd: R.spd, spdN: R.spdN,
      sf: WW.shipFires && WW.shipFires.stats ? JSON.parse(JSON.stringify(WW.shipFires.stats)) : null,
      ch: WW.charge && WW.charge.stats ? JSON.parse(JSON.stringify(WW.charge.stats)) : null,
      base: WW.islandBase && WW.islandBase.stats ? Object.assign({ has: !!WW.islandBase.base }, WW.islandBase.stats) : null,
      fb: WW.flyingBoats && WW.flyingBoats.stats ? JSON.parse(JSON.stringify(WW.flyingBoats.stats)) : null, rep: WW.intel && WW.intel.stats ? Object.assign({}, WW.intel.stats) : null,
      adm: WW.admirals && WW.admirals.of('USN') ? { USN: WW.admirals.of('USN').key, IJN: WW.admirals.of('IJN') ? WW.admirals.of('IJN').key : null, st: JSON.parse(JSON.stringify(WW.admirals.stats)) } : null,
      firstFire: R.firstFire, firstContact: R.firstContact, firstSight: R.firstSight, stuck: R.stuck, stuckWho: R.stuckWho, nan: R.nan, sunk: R.sunk,
      cv: Object.assign({}, R.cv), pt: Object.assign({}, R.pt, { pen: Object.values(R.ptS).map(s => +s.pen.toFixed(3)) }), dd: R.dd, sub: R.sub,
      ftr: R.ftr, big: R.big, focusCounts: Object.values(R.focus).map(o => Object.keys(o).length), intel: R.intel, intelOn: !!B.sees,
      cr: R.cr, lc: R.lc, torp: R.torp, th: R.th, air: Object.assign({}, R.air, { coh: R.air.coh.length ? [R.air.coh.sort((a, b) => a - b)[R.air.coh.length >> 1]] : [] }) };
    if (out.cv.cvcvMin === 1e9) out.cv.cvcvMin = null;
    if (out.cv.brkMin === 1e9) out.cv.brkMin = null;
    out.label = spec.label || null; out.A = spec.A || null; out.B = spec.B || null; out.endReason = G.endReason || null; out.firstDmg = R.firstDmg; out.dmgSum = Math.round(R.dmgSum);
    out.forms = R.forms; out.syncN = R.syncN; out.ptNN = R.ptNN;
    const SS = WW.search && WW.search.stats;
    out.search = SS ? { sect: { USN: SS.searched.USN.size, IJN: SS.searched.IJN.size }, lost: Object.assign({}, SS.lost), sorties: SS.sorties + SS.flown, breaks: SS.breaks, shadows: SS.shadows } : null;
    out.reserve = WW.airOps && WW.airOps.reserve ? JSON.parse(JSON.stringify(WW.airOps.reserve)) : null;
    out.strafe = WW.strafe ? Object.assign({}, WW.strafe.stats) : null;
    const s1 = snap(), dlt = (a, b) => (typeof a === 'number' ? a - (b || 0) : Object.fromEntries(Object.keys(a).map(k => [k, dlt(a[k], b && b[k])])));
    out.night = { tod: WW.dayNight ? WW.dayNight.kind : 'day', wx: WW.weather ? WW.weather.kind : 'clear', dlEnd: +(WW.daylight === undefined ? 1 : WW.daylight).toFixed(2), d: dlt(s1.d, s0.d), n: dlt(s1.n, s0.n), w: dlt(s1.w, s0.w) };
    out.det = R.det;
    out.tons = { USN: [tons0.USN, G.tonnage('USN')], IJN: [tons0.IJN, G.tonnage('IJN')] }; // [start, afloat at the end]
    out.dmg = R.dmg; out.planesLost = { USN: 0, IJN: 0 }; out.planesFlown = { USN: 0, IJN: 0 };
    for (const p of planesSeen) { out.planesFlown[p.nation]++; if (!p.alive && (p.deathMode || p.state === 'falling' || p.state === 'ditch')) out.planesLost[p.nation]++; }
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
// loop min/max: Math.min(...a) overflows the call stack on long sample arrays (many seeds)
const amin = a => { if (!a.length) return null; let m = Infinity; for (const v of a) if (v < m) m = v; return m; };
const amax = a => { if (!a.length) return null; let m = -Infinity; for (const v of a) if (v > m) m = v; return m; };
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const ratio = (a, b) => (b > 0 ? a / b : null);
function aggregate(rounds) {
  const S = (f) => rounds.reduce((s, r) => s + f(r), 0), C = (f) => rounds.flatMap(f);
  const cvd = C(r => r.cv.d), pen = C(r => r.pt.pen), react = C(r => r.dd.react);
  const decided = rounds.filter(r => r.winner), lens = rounds.map(r => r.len), cvcv = rounds.map(r => r.cv.cvcvMin).filter(v => v !== null);
  const ptN = S(r => r.pt.n), shots = S(r => r.sub.bow + r.sub.beam + r.sub.stern), near = S(r => r.sub.nearDived + r.sub.nearSurf);
  const focus = C(r => r.focusCounts), intelOn = rounds.some(r => r.intelOn);
  const firsts = k => med(rounds.map(r => r[k]).filter(v => v !== null));
  const eg = (k, n) => (rounds.length ? S(r => (r.eg ? (n ? r.eg[k][n] : r.eg[k].USN + r.eg[k].IJN) : 0)) / rounds.length : null);
  const fbm = (f) => (rounds.length && rounds.some(r => r.fb) ? S(r => (r.fb ? f(r.fb) : 0)) / rounds.length : null);   // flying boats, per round
  const repm = k => (rounds.length && rounds.some(r => r.rep) ? S(r => (r.rep ? r.rep[k] || 0 : 0)) / rounds.length : null);
  const both = (o, k, n) => (o && o[k] ? (n ? o[k][n] : o[k].USN + o[k].IJN) : 0);
  const avgOf = (f, k, n) => (rounds.length ? S(r => both(r[f], k, n)) / rounds.length : null);
  const share = k => (rounds.length ? rounds.filter(r => r.end === k).length / rounds.length : null);
  const spd = [0, 1, 2, 3].map(k => ratio(S(r => (r.spd ? r.spd[k] : 0)), S(r => (r.spdN ? r.spdN[k] : 0))));
  const bases = rounds.filter(r => r.base && r.base.has), BS = f => S(r => (r.base && r.base.has ? f(r.base) : 0));
  const perBase = f => (bases.length ? BS(f) / bases.length : null);
  return {
    // island base (info): share of rounds with a base that saw it neutralized, median time to it, land strikes / hits,
    // bombardment runs per base round
    base_neut: bases.length ? bases.filter(r => r.base.neutralizedAt !== null).length / bases.length : null,
    base_t_neut: med(bases.map(r => r.base.neutralizedAt).filter(v => v !== null)),
    land_strikes: perBase(b => b.landStrikes), land_sorties: perBase(b => b.landSorties), land_hits: perBase(b => b.landHits),
    bombard_runs: perBase(b => b.bombardRuns), bombard_shells: perBase(b => b.bombardShells), base_raids: perBase(b => b.raids),
    rw_closures: perBase(b => b.closures), batteries_out: perBase(b => b.batteriesOut),
    rounds: rounds.length,
    deck_hits: avgOf('sf', 'deckHits'), deck_safe: avgOf('sf', 'deckSafe'), deck_planes: avgOf('sf', 'deckPlanes'), deck_chain: avgOf('sf', 'chain'),
    fires: avgOf('sf', 'started'), fires_out_usn: avgOf('sf', 'out', 'USN'), fires_out_ijn: avgOf('sf', 'out', 'IJN'), fire_kills: avgOf('sf', 'fireKills'),
    usn_repaired: avgOf('sf', 'repaired', 'USN'), magazines: rounds.length ? S(r => both(r.sf, 'magazine')) : null,
    charges: avgOf('ch', 'charges'), charge_dds: avgOf('ch', 'ships'), charge_lost: avgOf('ch', 'lost'), charge_torp: avgOf('ch', 'torpHits'),
    charge_turned: avgOf('ch', 'turned'), charge_cv_sunk: avgOf('ch', 'cvSunk'),
    end_kill: share('kill'), end_time: share('time'), end_retire: share('retire'),
    // strict wipeout: a kill in which no carrier, battleship, cruiser or destroyer of the loser got away earlier
    wipeout: rounds.length ? rounds.filter(r => r.end === 'kill' && r.eg && !Object.keys(r.eg.escTypes).some(k => !/:(pt|submarine)$/.test(k))).length / rounds.length : null,
    cv_escaped: rounds.length ? S(r => (r.eg ? Object.keys(r.eg.escTypes).filter(k => /:carrier$/.test(k)).reduce((a, k) => a + r.eg.escTypes[k], 0) : 0)) / rounds.length : null,
    fb_rescues: fbm(f => f.rescues), fb_survivors: fbm(f => f.survivors), cat_lost: fbm(f => f.catLost),
    pat_sight_usn: fbm(f => f.sightings.USN), pat_sight_ijn: fbm(f => f.sightings.IJN), pat_lost_usn: fbm(f => f.lost.USN - f.catLost), pat_lost_ijn: fbm(f => f.lost.IJN),
    misid: repm('misid'), bad_strikes: repm('wrongStrikes'), bad_redirects: repm('wrongRedirects'),
    pursuit_kills: eg('pursuitKills'), escaped: eg('escaped'), usn_rescues: eg('rescues', 'USN'), usn_survivors: eg('survivors', 'USN'),
    usn_pilots: eg('pilots', 'USN'), usn_lost_srv: eg('lost', 'USN'), ijn_abandoned: eg('abandoned', 'IJN'), ijn_scuttled: eg('scuttled', 'IJN'),
    spd_hp: spd.every(v => v === null) ? null : spd.map(v => (v === null ? '-' : v.toFixed(2))).join('/'),
    cv_brk_min: amin(rounds.map(r => r.cv.brkMin).filter(v => v !== null && v !== undefined)), cv_brk_gun: ratio(S(r => r.cv.brkGun || 0), S(r => r.cv.brkN || 0)),
    cv_min_dist: amin(cvd), cv_med_dist: med(cvd), cv_in_gun: ratio(S(r => r.cv.inGun), S(r => r.cv.samples)),
    cv_closing: ratio(S(r => r.cv.closing), S(r => r.cv.thr)), cvcv_min: amin(cvcv),
    air_drops: rounds.length ? S(r => r.air.drops) / rounds.length : null,
    pt_loiter: ratio(S(r => r.pt.loiter), S(r => r.pt.time)), pt_in_big: ratio(S(r => r.pt.inBig), S(r => r.pt.time)),
    pt_pen_med: med(pen), pt_pen_max: amax(pen), pt_runs: ptN ? S(r => r.pt.spreads) / ptN : null,
    pt_mg_big: ratio(S(r => r.pt.mgBig), S(r => r.pt.mgShots)),
    dd_sub_kills: ratio(S(r => r.dd.subDC), S(r => r.dd.subDeaths)), dd_react_med: med(react),
    dd_react_rate: ratio(react.length, react.length + S(r => r.dd.missed)), dd_episodes: react.length + S(r => r.dd.missed),
    sub_bowbeam: ratio(S(r => r.sub.bow + r.sub.beam), shots), sub_shots: shots, sub_dived_dd: ratio(S(r => r.sub.nearDived), near),
    cap_bkills: rounds.length ? S(r => r.air.capBK || 0) / rounds.length : null,
    cap_on_bmb: ratio(S(r => r.air.capB || 0), S(r => r.air.capF || 0)),
    cap_gap: ratio(S(r => r.air.capGap || 0), S(r => r.air.capN || 0)), esc_with: ratio(S(r => r.air.escWith || 0), S(r => r.air.escN || 0)),
    elem_coh: med(C(r => r.air.coh || [])), air_sync: med(C(r => r.air.sync || [])), sync_n: C(r => r.air.sync || []).length,
    bomb_lost: ratio(S(r => r.air.lostArmed || 0), S(r => r.air.bombers || 0)), jettisons: rounds.length ? S(r => r.air.jett || 0) / rounds.length : null,
    ftr_leash: ratio(S(r => r.ftr.inLeash), S(r => r.ftr.t)), base_cap_leash: ratio(S(r => r.ftr.bin || 0), S(r => r.ftr.bt || 0)), ftr_bombers: ratio(S(r => r.ftr.bomberKillsUA), S(r => r.ftr.killsUA)),
    big_range: ratio(S(r => r.big.fs), S(r => r.big.fn)), big_band: ratio(S(r => r.big.band), S(r => r.big.fn)),
    focus: focus.length ? focus.reduce((a, b) => a + b, 0) / focus.length : null, broadside: ratio(S(r => r.big.broad), S(r => r.big.shots)),
    unseen_shots: intelOn && !S(r => r.intel.err) ? S(r => r.intel.unseen) : null, intel_err: S(r => r.intel.err), intel_on: intelOn,
    crip_away: ratio(S(r => r.cr.away), S(r => r.cr.n)), lc_away: ratio(S(r => r.lc.away), S(r => r.lc.n)),
    pt_torp_hit: ratio(S(r => r.th.pt.hit), S(r => r.th.pt.fired)), sub_torp_hit: ratio(S(r => r.th.submarine.hit), S(r => r.th.submarine.fired)),
    torp_parallel: ratio(S(r => r.torp.par), S(r => r.torp.passes)), torp_passes: S(r => r.torp.passes),
    usn_share: ratio(decided.filter(r => r.winner === 'USN').length, decided.length),
    bal_usn: ratio(rounds.filter(r => r.winner === 'USN').length, rounds.length), bal_ijn: ratio(rounds.filter(r => r.winner === 'IJN').length, rounds.length),
    usn_ci: wilson(decided.filter(r => r.winner === 'USN').length, decided.length),
    len_med: med(lens), len_min: amin(lens), len_max: amax(lens),
    first_fire: firsts('firstFire'), first_contact: firsts('firstContact'), first_sight: firsts('firstSight'),
    sub_killed_by: (() => { const k = {}; for (const r of rounds) for (const n in r.dd.kinds) k[n] = (k[n] || 0) + r.dd.kinds[n]; return Object.entries(k).map(e => e.join(':')).join(',') || null; })(),
    stuck_who: C(r => r.stuckWho.map(w => 's' + r.seed + ':' + w)).join(' ') || null,
    stuck: S(r => r.stuck), nan: S(r => r.nan),
    // night / weather (daylight.js, night_ops.js, weather.js)
    // rounds by kind (daylight.js: dawn / day / dusk / night), and how many ended in the dark (daylight < 0.3)
    tod: (() => { const k = { dawn: 0, day: 0, dusk: 0, night: 0 }; let dk = 0; for (const r of rounds) if (r.night) { k[r.night.tod] = (k[r.night.tod] || 0) + 1; if (r.night.dlEnd < 0.3) dk++; } return `dawn${k.dawn}/day${k.day}/dusk${k.dusk}/night${k.night} dark${dk}`; })(),
    dark_launch: rounds.length && rounds[0].night ? S(r => r.night.d.launchesDark || 0) : null,
    night_torps: rounds.length && rounds[0].night ? S(r => (r.night.d.nightTorps.USN || 0) + (r.night.d.nightTorps.IJN || 0)) / rounds.length : null,
    night_torps_n: rounds.length && rounds[0].night ? `U${S(r => r.night.d.nightTorps.USN || 0)}/J${S(r => r.night.d.nightTorps.IJN || 0)}` : null,
    star_shells: rounds.length && rounds[0].night ? S(r => r.night.n.starShells.USN + r.night.n.starShells.IJN) / rounds.length : null,
    searchlights: rounds.length && rounds[0].night ? `U${S(r => r.night.n.searchlights.USN)}/J${S(r => r.night.n.searchlights.IJN)}` : null,
    radar_sights: rounds.length && rounds[0].night ? S(r => r.night.n.radarSights) : null,
    night_land: rounds.length && rounds[0].night ? S(r => r.night.d.nightLandings) : null, night_land_loss: rounds.length && rounds[0].night ? S(r => r.night.d.nightLandingLoss) : null,
    recalls: rounds.length && rounds[0].night ? S(r => r.night.d.recalls) : null,
    det_day: med(C(r => r.det ? r.det.day : [])), det_dusk: med(C(r => r.det ? r.det.dusk : [])), det_night: med(C(r => r.det ? r.det.night : [])), det_radar: med(C(r => r.det ? r.det.radar : [])), det_flash: med(C(r => r.det ? r.det.flash : [])),
    wx_det_rain: med(C(r => r.det ? r.det.rain : [])), wx_det_clear: med(C(r => r.det ? r.det.clear : [])),
    wx_detect: (() => { const a = med(C(r => r.det ? r.det.rain : [])), b = med(C(r => r.det ? r.det.clear : [])); return a && b ? a / b : null; })(),
    dive_holds: rounds.length && rounds[0].night ? S(r => r.night.w.diveHolds) : null, dive_aborts: rounds.length && rounds[0].night ? S(r => r.night.w.diveAborts) : null,
    cv_shelter: rounds.length && rounds[0].night ? Math.round(S(r => r.night.w.shelter || 0)) : null,
    ...searchAgg(rounds)
  };
}
// search, form-up, reserve, strafing and PT spacing metrics (new air / light-force doctrine)
function searchAgg(rounds) {
  const R = rounds.filter(r => r.search), S = f => R.reduce((s, r) => s + f(r), 0), out = {};
  const sorties = S(r => r.search.sorties), lost = k => S(r => r.search.lost[k] || 0);
  out.srch_sect = R.length ? +(S(r => r.search.sect.USN + r.search.sect.IJN) / (2 * R.length)).toFixed(1) : null;
  out.srch_lost = sorties ? `${lost('out')}/${lost('station')}/${lost('home')} of ${sorties}` : null;
  const F = rounds.flatMap(r => r.forms || []), fm = (n, f) => med(F.filter(q => q.n === n && q.f === f).map(q => q.t));
  out.form_first = F.length ? `U${fmtv(fm('USN', true))} J${fmtv(fm('IJN', true))}` : null;
  out.form_later = F.length ? `U${fmtv(fm('USN', false))} J${fmtv(fm('IJN', false))}` : null;
  const lm = [fm('USN', false), fm('IJN', false)].filter(v => v !== null); out.form_later_max = lm.length ? Math.max(...lm) : null;
  out.sync_usn = med(rounds.flatMap(r => (r.syncN && r.syncN.USN) || [])); out.sync_ijn = med(rounds.flatMap(r => (r.syncN && r.syncN.IJN) || []));
  const rs = rounds.filter(r => r.reserve), tg = {};
  rs.forEach(r => { for (const k in r.reserve.targets) tg[k] = (tg[k] || 0) + r.reserve.targets[k]; });
  out.reserve = rs.length ? `held ${rs.reduce((s, r) => s + r.reserve.held, 0)} cvLaunch ${rs.reduce((s, r) => s + r.reserve.launches, 0)} rearmed ${rs.reduce((s, r) => s + r.reserve.rearmed, 0)} ${Object.entries(tg).map(e => e.join(':')).join(',')}` : null;
  out.strafe_hits = rounds.some(r => r.strafe) ? rounds.reduce((s, r) => s + (r.strafe ? r.strafe.hits : 0), 0) : null;
  const nn = rounds.flatMap(r => r.ptNN || []).sort((a, b) => a - b); out.pt_nn_p10 = nn.length ? nn[Math.floor(nn.length * 0.1)] : null;
  out.first_dmg = med(rounds.map(r => r.firstDmg).filter(v => v !== null && v !== undefined));
  return out;
}
const fmtv = v => (v === null || v === undefined ? '-' : v);
const LIGHT_CHECKS = ['bal_usn', 'bal_ijn', 'len_med', 'end_kill', 'end_time', 'nan', 'errors', 'dark_launch']; // light (balance) rounds sample nothing else
function judge(c, v, scen, nRounds) {
  if (c.only && !c.only.includes(scen)) return null;
  if (SCEN.find(s => s.name === scen && s.light) && !LIGHT_CHECKS.includes(c.id)) return null;
  let level = (c.levelIn && c.levelIn[scen]) || c.level;
  if (scen === 'fuzz' && !FZ.CHECKS.includes(c.id)) level = 'WARN'; // odd fleets: only the fuzz checks are hard
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
if (require.main === module) (async () => {
  const T0 = Date.now();
  const b = await HL.launch();
  let errs = [];
  // --pages K: K independent game pages run rounds in parallel (opened together in sim-only mode)
  async function openPage(k) {
    const p = await b.newPage({ viewport: { width: 640, height: 360 } });
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
    // 'domcontentloaded' + retries: a long-running python http.server sometimes stalls the 'load' event
    for (let tries = 0; ; tries++) {
      try { await p.goto(HL.url(), { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 }); break; }
      catch (e) { if (tries >= 2) throw e; console.log(`page ${k}: load retry (${e.message.split('\n')[0]})`); }
    }
    await p.waitForTimeout(HL.settle());
    // stop the render loop driving the sim (setScale clamps at 0.1; the director's slow-motion warp too): we drive it
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; __sim.setScale(0.1); });
    await p.evaluate(install, P);
    if (TUNE_OPT) await p.evaluate(t => { for (const kv of t.split(',')) { const [k, v] = kv.split('='); WW.islandBase.TUNE[k] = +v; } }, TUNE_OPT);
    return p;
  }
  const pages = [];
  if (HL.RENDER) for (let k = 0; k < PAGES; k++) pages.push(await openPage(k));
  else pages.push(...await Promise.all([...Array(PAGES).keys()].map(openPage)));
  const results = {}, raw = {};
  let hardFails = 0;
  const totals = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  for (const sc of scens) {
    const t0 = Date.now(), e0 = errs.length, specs = [];
    for (let i = 0; i < SEEDS; i++) {
      const seed = SEED0 + i, light = !!sc.light;
      if (sc.fuzz) { specs.push(...FZ.specs(seed)); continue; }
      if (sc.random) specs.push(...(sc.mirror ? [{ seed, random: true, light, base: BASE_OPT }, { seed, random: true, swap: true, light, base: BASE_OPT }] : [{ seed, random: true, light, tod: sc.tod, wx: sc.wx, base: BASE_OPT }]));
      else specs.push({ seed, A: sc.A, B: sc.B, aNation: sc.aFixed || (seed % 2 ? 'USN' : 'IJN'), cripple: sc.cripple === undefined ? -1 : sc.cripple, noStall: !!sc.noStall, base: BASE_OPT || sc.base || null });
    }
    if (DAY_CLEAR) for (const sp of specs) sp.dayClear = true;
    const rounds = new Array(specs.length);
    let next = 0;
    await Promise.all(pages.map(async pg => { while (next < specs.length) { const i = next++; rounds[i] = await pg.evaluate(s => window.__beh.run(s), specs[i]); } }));
    const M = aggregate(rounds); M.errors = errs.length - e0;
    results[sc.name] = M; raw[sc.name] = rounds;
    const wall = ((Date.now() - t0) / 1000).toFixed(1);
    const wins = { USN: 0, IJN: 0, draw: 0, A: 0, B: 0 };
    for (const r of rounds) { wins[r.winner || 'draw']++; if (r.aNation && r.winner) wins[r.winner === r.aNation ? 'A' : 'B']++; }
    console.log(`\n== ${sc.name}  (${rounds.length} rounds, ${wall}s)  USN ${wins.USN} IJN ${wins.IJN} draw ${wins.draw}${sc.A ? `  fleetA ${wins.A} fleetB ${wins.B}` : ''}  len ${M.len_min}/${M.len_med}/${M.len_max}s  ends ${['kill', 'retire', 'time', 'cap'].map(k => k + ' ' + rounds.filter(r => r.end === k).length).join(' ')}`);
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
        `;  ${(Date.now() - t0) / 1000 / rounds.length * PAGES >= 0 ? ((Date.now() - t0) / 1000 / rounds.length).toFixed(2) : ''} s wall/round (${HL.label()})` +
        (sc.mirror ? `;  same fleet won both sides in ${pairs(rounds)} of ${rounds.length >> 1} pairs` : ''));
      const own = o => rounds.filter(r => (r.base && r.base.has ? r.base.owner : 'none') === o);
      console.log('  by base owner: ' + ['USN', 'IJN', 'none'].map(o => { const L = own(o); return `${o} base: ${L.length} rounds, USN ${L.filter(r => r.winner === 'USN').length} / IJN ${L.filter(r => r.winner === 'IJN').length} / draw ${L.filter(r => !r.winner).length}`; }).join(';  '));
      const dk = rounds.filter(r => r.night && r.night.dlEnd < 0.3), wx = rounds.filter(r => r.night && r.night.wx !== 'clear');
      console.log(`  night / weather: ${M.tod} (rounds by kind; dark = daylight < 0.3 at the end), dark rounds ${dk.length}: USN ${dk.filter(r => r.winner === 'USN').length} IJN ${dk.filter(r => r.winner === 'IJN').length};` +
        `  weather rounds ${wx.length}: USN ${wx.filter(r => r.winner === 'USN').length} IJN ${wx.filter(r => r.winner === 'IJN').length};  dark launches ${M.dark_launch}`);
    }
    if (rounds.some(r => r.adm)) admTable(rounds);
    if (!sc.light) console.log('  info: ' + INFO.map(k => `${k} ${fmt(M[k])}`).join('  '));
    else console.log('  info: ' + [...BASE_INFO, ...DOCTRINE_INFO, ...FB_INFO, 'end_retire', 'wipeout', 'cv_escaped', 'pursuit_kills', 'escaped', 'usn_rescues', 'usn_survivors', 'usn_pilots', 'usn_lost_srv', 'ijn_abandoned', 'ijn_scuttled'].map(k => `${k} ${fmt(M[k])}`).join('  '));
    if (sc.fuzz) { const fz = FZ.report(rounds, l => console.log(l)); hardFails += fz.fails; totals.FAIL += fz.fails; totals.WARN += fz.warns; }
  }
  // admirals.js: win rate per admiral matchup (USN admiral vs IJN admiral) and the command metrics
  function admTable(rounds) {
    const T = {}, per = {}, n = rounds.length, S = f => rounds.reduce((a, r) => a + (r.adm ? f(r.adm.st) : 0), 0);
    for (const r of rounds) {
      if (!r.adm) continue;
      const k = r.adm.USN + ' v ' + r.adm.IJN, t = T[k] = T[k] || { n: 0, USN: 0, IJN: 0 };
      t.n++; if (r.winner) t[r.winner]++;
      for (const nat of ['USN', 'IJN']) { const q = per[nat + ':' + r.adm[nat]] = per[nat + ':' + r.adm[nat]] || { n: 0, w: 0 }; q.n++; if (r.winner === nat) q.w++; }
    }
    console.log('  admirals (USN v IJN: rounds, USN wins / IJN wins): ' + Object.keys(T).sort().map(k => `${k} ${T[k].n}: ${T[k].USN}/${T[k].IJN}`).join(';  '));
    console.log('  admiral win rate: ' + Object.keys(per).sort().map(k => `${k} ${per[k].w}/${per[k].n} (${(per[k].w / per[k].n).toFixed(2)})`).join('  '));
    const ords = {}; for (const r of rounds) if (r.adm) for (const k in r.adm.st.orders) ords[k] = (ords[k] || 0) + r.adm.st.orders[k];
    console.log(`  command: flag lost ${(S(s => s.flagLost) / n).toFixed(2)}/round, transfers ${(S(s => s.transfers) / n).toFixed(2)}/round, leaderless ${S(s => s.leaderless)}, confusion ${(S(s => s.confusionSec) / n).toFixed(1)} s/round; orders/round ` +
      Object.keys(ords).sort().map(k => `${k} ${(ords[k] / n).toFixed(2)}`).join(' '));
  }
  console.log('\n=== SUMMARY ===');
  console.log(`checks: PASS ${totals.PASS}  FAIL ${totals.FAIL}  WARN ${totals.WARN}  SKIP ${totals.SKIP}   scenarios ${scens.length} x ${SEEDS} seeds   wall ${((Date.now() - T0) / 1000).toFixed(0)}s (${HL.label()})`);
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

// tests/balance_ab.js reuses the page side and the aggregation
module.exports = { install, P, aggregate, wilson };
