// Paired balance statistics: the USN win rate, and the effect of a change on it, with less noise per round.
//
// Every round is a seeded replay (the same seed gives the same map, fleets and round), so the noise can be paired out:
//  - mirrored fleets (default): each seed is fought twice, the same fleets with the sides swapped (the balance_mirror
//    rounds of sim_behaviour.js). A seed's score is the mean of its two rounds (USN win 1, draw 0.5, IJN win 0), so
//    "this fleet was stronger" cancels inside the pair and only nation bias is left. The standard error comes from
//    the spread of the pair scores.
//  - A/B on common random numbers: --a / --b run the same seeds (and mirrors) under two configurations; the report is
//    the per-seed difference B - A with its own standard error. Seeds where the change makes no difference give 0
//    and add no noise, so a small effect shows with far fewer rounds than two independent samples need.
//  - before / after a code change: --save FILE keeps the per-seed scores; a later run with --against FILE (same
//    seeds, same mirror setting) is paired against them the same way.
// Besides the win score, each round gives a loss margin: the share of its starting tonnage IJN lost minus the share
// USN lost (-1..1, + favours USN). It is continuous, so it usually detects a shift with fewer rounds than the win
// score; both are reported.
// Limit: the sim is chaotic. A 0.1% change to one doctrine number flips the winner in ~18% of rounds, so pairing is
// worth ~2-2.7x the rounds (win score) and ~2.4-3.6x (loss margin), not more; a 3-point win-rate effect still needs
// ~3000-4000 rounds in all. See docs/ARCHITECTURE.md "Paired balance statistics".
//
// Usage: node tests/balance_ab.js [--seeds N=100] [--seed0 S=1] [--no-mirror] [--workers K] [--browser]
//          [--a CFG] [--b CFG | --ab CFG] [--save FILE] [--against FILE] [--base USN|IJN|none] [--json FILE]
//   CFG: items separated by ';'.  path=value with a dot assigns WW.<path> in every game after it loads (a typo
//   fails: the property must exist), e.g. "SHIP_TYPES.cruiser.hp=1400; TORPEDO.dmg=200"; the value is JSON when it
//   parses, else a string. name or name=value without a dot is a query flag for index.html (e.g. "nopatrol").
//   Only settings read at run time can be switched this way (not constants captured when a module loads); for a
//   code change use --save before it and --against after it.
//   --ab CFG is short for --b CFG (A: the build as it is).
// Examples:
//   node tests/balance_ab.js --seeds 100                                # USN win rate, mirrored pairs (200 rounds)
//   node tests/balance_ab.js --seeds 100 --ab "SHIP_TYPES.cruiser.hp=1400"   # effect of a change, 400 rounds
//   node tests/balance_ab.js --seeds 100 --save before.json; (edit); node tests/balance_ab.js --seeds 100 --against before.json
'use strict';
const fs = require('fs');
const HL = require('./headless');
const SB = require('./sim_behaviour');

const argv = HL.argv, has = k => argv.includes(k), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const SEEDS = +arg('--seeds', 100), SEED0 = +arg('--seed0', 1), MIRROR = !has('--no-mirror'), BASE = arg('--base', null);
const CFG_A = arg('--a', ''), CFG_B = arg('--b', arg('--ab', null)), SAVE = arg('--save', null), AGAINST = arg('--against', null), JSON_OUT = arg('--json', null);

function parseCfg(s) {
  const cfg = { text: (s || '').trim() || '(as built)', query: [], assign: [] };
  for (const it of (s || '').split(';').map(x => x.trim()).filter(Boolean)) {
    const eq = it.indexOf('='), k = eq < 0 ? it : it.slice(0, eq).trim(), v = eq < 0 ? null : it.slice(eq + 1).trim();
    if (k.includes('.')) {
      let val; try { val = JSON.parse(v); } catch (e) { val = v; }
      cfg.assign.push([k.replace(/^WW\./, ''), val]);
    } else cfg.query.push(v === null ? k : k + '=' + encodeURIComponent(v));
  }
  return cfg;
}

// the round specs, in a fixed order: seed s, then (mirror) the same seed with the sides swapped
function specs() {
  const out = [];
  for (let i = 0; i < SEEDS; i++) {
    const seed = SEED0 + i;
    out.push({ seed, random: true, light: true, base: BASE });
    if (MIRROR) out.push({ seed, random: true, light: true, swap: true, base: BASE });
  }
  return out;
}

async function runCfg(cfg, list) {
  const b = await HL.launch(), errs = [], t0 = Date.now();
  async function openPage() {
    const p = await b.newPage({ viewport: { width: 640, height: 360 } });
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
    await p.goto(HL.url(cfg.query.join('&')), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await p.waitForFunction(() => window.__sim && window.WW && WW.game, null, { timeout: 60000 });
    await p.waitForTimeout(HL.settle());
    await p.evaluate(() => { window.requestAnimationFrame = () => 0; WW.time.warp = 1; __sim.setScale(0.1); });
    await p.evaluate(SB.install, SB.P);
    for (const [path, val] of cfg.assign) {
      await p.evaluate(([path, val]) => {
        const ks = path.split('.'), last = ks.pop();
        let o = WW; for (const k of ks) { o = o == null ? o : o[k]; }
        if (o == null || typeof o !== 'object' || !(last in o)) throw new Error('balance_ab: no such setting WW.' + path);
        o[last] = val;
      }, [path, val]);
    }
    return p;
  }
  const pages = await Promise.all([...Array(Math.min(HL.WORKERS, list.length)).keys()].map(openPage));
  const rounds = new Array(list.length);
  let next = 0;
  await Promise.all(pages.map(async pg => { while (next < list.length) { const i = next++; rounds[i] = await pg.evaluate(s => window.__beh.run(s), list[i]); } }));
  await b.close();
  return { rounds, errs, wall: (Date.now() - t0) / 1000 };
}

// ---- statistics ----
const win = r => (r.winner === 'USN' ? 1 : r.winner === 'IJN' ? 0 : 0.5);
const lost = (r, n) => { const t = r.tons && r.tons[n]; return t && t[0] > 0 ? 1 - t[1] / t[0] : 0; };
const margin = r => lost(r, 'IJN') - lost(r, 'USN');
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const variance = a => { const m = mean(a); return a.length > 1 ? a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1) : 0; };
// two-sided 95% t quantile (normal from 30 degrees of freedom up)
const T95 = df => (df >= 30 ? 1.96 : [12.71, 4.30, 3.18, 2.78, 2.57, 2.45, 2.36, 2.31, 2.26, 2.23, 2.20, 2.18, 2.16, 2.14, 2.13, 2.12, 2.11, 2.10, 2.09, 2.09, 2.08, 2.07, 2.07, 2.06, 2.06, 2.06, 2.05, 2.05, 2.05][Math.max(1, df) - 1]);
// per-seed units: the mean over the seed's rounds (its mirror pair) of f
function units(rounds, f) {
  const per = MIRROR ? 2 : 1, out = [];
  for (let i = 0; i < rounds.length; i += per) out.push(mean(rounds.slice(i, i + per).map(f)));
  return out;
}
const pct = x => (100 * x).toFixed(1);
function describe(label, rounds) {
  const u = units(rounds, win), n = u.length, m = mean(u), se = Math.sqrt(variance(u) / n), h = T95(n - 1) * se;
  const w = rounds.map(win), seNaive = Math.sqrt(variance(w) / w.length);
  const mu = units(rounds, margin), mm = mean(mu), mse = Math.sqrt(variance(mu) / n);
  const W = { USN: 0, IJN: 0, draw: 0 }; for (const r of rounds) W[r.winner || 'draw']++;
  console.log(`${label}: ${rounds.length} rounds (${n} seeds${MIRROR ? ' x mirrored pair' : ''}): USN ${W.USN} / IJN ${W.IJN} / draw ${W.draw}`);
  console.log(`  USN score ${pct(m)}% +- ${pct(h)} (95% CI [${pct(m - h)}, ${pct(m + h)}])` +
    (MIRROR ? `;  as independent rounds the CI would be +- ${pct(1.96 * seNaive)} (mirror pairing worth ${(seNaive * seNaive / (se * se)).toFixed(2)}x the rounds)` : ''));
  if (MIRROR) {
    let both = 0, split = 0; for (let i = 0; i + 1 < rounds.length; i += 2) { const a = rounds[i].winner, b = rounds[i + 1].winner; if (a && b) (a !== b ? both++ : split++); }
    console.log(`  the same fleet won from both sides in ${both} of ${n} pairs (fleet strength, cancelled by the pairing); the same nation won both in ${split}`);
  }
  console.log(`  loss margin (IJN share lost - USN share lost) ${(mm * 100).toFixed(1)} +- ${(T95(n - 1) * mse * 100).toFixed(1)} points`);
  return { u, mu };
}
// paired difference B - A over the same seeds
function paired(label, uA, uB, what, roundsPerSeed) {
  const n = Math.min(uA.length, uB.length), d = [...Array(n).keys()].map(i => uB[i] - uA[i]);
  const m = mean(d), se = Math.sqrt(variance(d) / n), h = T95(n - 1) * se;
  const seU = Math.sqrt(variance(uA.slice(0, n)) / n + variance(uB.slice(0, n)) / n), same = d.filter(x => x === 0).length;
  const ss = 100;
  if (d.every(x => x === 0)) { console.log(`${label} ${what === 'win' ? 'USN score' : 'loss margin'}: identical in all ${n} seeds (B - A = 0)`); return { n, mean: 0, se: 0, half: 0, unpairedSe: seU }; }
  const need = eff => Math.ceil(n * Math.pow(2.8 * se / eff, 2)) * roundsPerSeed * 2; // rounds (both arms) for 80% power at 5%
  console.log(`${label} ${what === 'win' ? 'USN score' : 'loss margin'}: B - A = ${(m * ss).toFixed(1)} +- ${(h * ss).toFixed(1)} points (95% CI [${((m - h) * ss).toFixed(1)}, ${((m + h) * ss).toFixed(1)}]` +
    `, ${Math.abs(m) > h ? 'significant' : 'not significant'} at 5%);  unpaired it would be +- ${(T95(n - 1) * seU * ss).toFixed(1)} (pairing worth ${(seU * seU / (se * se || 1e-12)).toFixed(1)}x the rounds)` +
    (what === 'win' ? `;  ${same} of ${n} seeds scored the same in both;  rounds needed to detect 3 points (80% power): ${need(0.03)}` : ''));
  return { n, mean: m, se, half: h, unpairedSe: seU };
}

(async () => {
  const list = specs(), A = parseCfg(CFG_A), B = CFG_B === null ? null : parseCfg(CFG_B);
  console.log(`balance_ab: ${SEEDS} seeds from ${SEED0}${MIRROR ? ', mirrored pairs' : ''}, ${list.length} rounds per configuration (${HL.label()})`);
  const ra = await runCfg(A, list);
  console.log(`\nA = ${A.text}   (${ra.wall.toFixed(0)} s)`);
  const da = describe('A', ra.rounds), out = { seeds: SEEDS, seed0: SEED0, mirror: MIRROR, a: A.text, units: { win: da.u, margin: da.mu }, rounds: ra.rounds.map(r => ({ seed: r.seed, swap: r.swap, winner: r.winner, end: r.end, len: r.len, tons: r.tons })) };
  let errs = ra.errs.length;
  const per = MIRROR ? 2 : 1;
  if (B) {
    const rb = await runCfg(B, list); errs += rb.errs.length;
    console.log(`\nB = ${B.text}   (${rb.wall.toFixed(0)} s)`);
    const db = describe('B', rb.rounds);
    const agree = ra.rounds.filter((r, i) => r.winner === rb.rounds[i].winner).length;
    console.log(`\npaired over ${da.u.length} seeds (common random numbers: the same seeds, maps and fleets in A and B; the same winner in ${agree} of ${list.length} rounds)`);
    out.b = B.text; out.ab = { win: paired('  ', da.u, db.u, 'win', per), margin: paired('  ', da.mu, db.mu, 'margin', per) };
    out.unitsB = { win: db.u, margin: db.mu };
  }
  if (AGAINST) {
    const prev = JSON.parse(fs.readFileSync(AGAINST, 'utf8'));
    if (prev.seeds !== SEEDS || prev.seed0 !== SEED0 || prev.mirror !== MIRROR) console.log(`\n--against ${AGAINST}: different seeds / mirror setting (${prev.seeds} from ${prev.seed0}, mirror ${prev.mirror}): not comparable`);
    else {
      const agree = prev.rounds.filter((r, i) => r.winner === ra.rounds[i].winner).length;
      console.log(`\nthis run (A) against ${AGAINST} (${prev.a}), paired over ${SEEDS} seeds (the same winner in ${agree} of ${list.length} rounds)`);
      out.against = { win: paired('  ', prev.units.win, da.u, 'win', per), margin: paired('  ', prev.units.margin, da.mu, 'margin', per) };
    }
  }
  if (errs) console.log(`\npage errors: ${errs}\n` + [...ra.errs].slice(0, 5).join('\n'));
  if (SAVE) { fs.writeFileSync(SAVE, JSON.stringify(out)); console.log(`\nsaved per-seed scores to ${SAVE} (pair a later run with --against ${SAVE})`); }
  if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(Object.assign(out, { roundsFull: undefined }), null, 1));
  process.exitCode = errs ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
