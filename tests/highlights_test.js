// Highlight reel test (js/highlights.js): sim-then-reel on a few seeds. Each seed: a random Pacific battle from the ready
// screen run sim-only to its end (WW.highlights.simRound(), the ?simthenreel path), then the reel played through with the
// director on a fake 30 fps frame clock. Checks: the moments (count, time order, no overlap, weights, captions), the
// "Watch highlights" button on the report, the replay's hash equal to the played round's at every clip start (and every
// HSTEP on the way), each clip's key subject in frame and in sight around its climax, and the page put back as the
// battle left it (the report, the stats, the RNG, the map, the fleets).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=... node tests/highlights_test.js [--seeds 1,2,3] [--sheet DIR] [--every 3]
//   --sheet DIR: a contact sheet of the first seed's reel (a frame every --every real s of each clip) in DIR
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const A = require('./camera_audit');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SEEDS = arg('--seeds', '1,2,3').split(',').map(Number), SHEET = arg('--sheet', ''), EVERY = +arg('--every', 3);
const BASE = process.env.BASE_URL || 'http://localhost:8000/';
const wait = ms => new Promise(r => setTimeout(r, ms));

async function run(b, seed, sheet) {
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(A.INIT(seed * 31 + 7));
  await p.goto(BASE + 'index.html', { timeout: 240000 });
  await p.waitForTimeout(1500);
  const t0 = Date.now();
  await p.evaluate(seed => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (!window.__render) return; const mr = Math.random; Math.random = window.__prng2; try { pr(a, b); } finally { Math.random = mr; } };
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __step(5);
    WW.seedRandom(seed * 7919 + 1); WW.game.enterSetup(true, true);
    __step(2);
  }, seed);
  const ok1 = await p.evaluate(() => WW.highlights.simRound());
  const simS = (Date.now() - t0) / 1000;
  const before = await p.evaluate(() => {
    __step(3);
    const S = WW.highlights.snapshot(), aar = document.getElementById('aar');
    return { ok: !!S, moments: WW.highlights.moments(), endN: S && S.endN, events: S && S.ev.length, aar: (r => r ? JSON.stringify({ w: r.winner, h: r.how, s: r.sides, k: r.key.map(e => e.clock + ' ' + e.text) }) : '')(WW.aar.last()), stats: JSON.stringify(WW.stats), rand: WW.randState(),
      terrain: WW.terrain.seed, comp: JSON.stringify(WW.game.composition), state: WW.game.state, button: !!(aar && aar.querySelector('.hl-btn')), winner: S && S.winner, reason: S && S.reason };
  });
  const R = { seed, simS: +simS.toFixed(1), ok: ok1 && before.ok, n: before.moments.length, events: before.events, endN: before.endN, winner: before.winner, reason: before.reason, moments: before.moments, clips: [], fail: [] };
  if (!R.ok) { R.fail.push('no snapshot'); R.errs = errs.slice(0, 5); await p.close(); return R; }
  // the moments
  const M = before.moments;
  if (M.length < 3) R.fail.push('only ' + M.length + ' moments');
  for (let i = 1; i < M.length; i++) if (M[i].n0 < M[i - 1].n1) R.fail.push('clips ' + (i - 1) + ' and ' + i + ' overlap');
  for (const m of M) if (!(m.n0 < m.climax && m.climax < m.n1 && m.n1 < before.endN)) R.fail.push('clip window ' + JSON.stringify(m));
  if (!before.button) { R.fail.push('no Watch highlights button (state ' + before.state + ')'); R.errs = errs.slice(0, 5); await p.close(); return R; }
  // the reel
  const t1 = Date.now();
  await p.evaluate(() => document.querySelector('#aar .hl-btn').click());
  const frames = [];
  let cur = -1, climaxSeen = false, samples = [], lastShot = -1e9;
  for (let guard = 0; guard < 200000; guard++) {
    const st = await p.evaluate(() => { const r = WW.highlights.reel(); return r ? { i: r.i, state: r.state, n: WW.game.stepN, clip: r.clip } : null; });
    if (!st) break;
    if (st.state !== 'play') { await wait(60); continue; }
    if (st.i !== cur) {
      if (cur >= 0) R.clips.push(clipRes(M[cur], samples));
      cur = st.i; samples = []; climaxSeen = false; lastShot = -1e9;
      const shown = await p.evaluate(() => ['#film .caption', '#follow-label', '#diary'].filter(q => { const e = document.querySelector(q); return e && getComputedStyle(e).display !== 'none'; }));
      if (shown.length) R.fail.push('clip ' + cur + ': the game\'s own ' + shown.join(', ') + ' showing over the reel');
    }
    const m = M[cur];
    const info = await p.evaluate(([m, wantShot]) => {
      const out = [];
      for (let k = 0; k < 6; k++) {
        const r = WW.highlights.reel(); if (!r || r.state !== 'play') break;
        __step(1);
        const n = WW.game.stepN, spr = WW.time.base * 120;
        // around the climax (an air battle: from its first kill to its last): any of its key subjects (the ship; the planes going down)
        if (n >= m.w0 - spr * 1 && n <= m.w1 + spr * 4) {
          const c = WW.camera;
          let vis = false, inF = false, has = false;
          for (const o of m.keys.map(k => WW.lookahead.obj(k))) {
            if (!o || !c || (o.pt && o.removed)) continue;
            has = true;
            // the hull's middle and ends (a plane: itself); in sight when one of them is in frame with a clear sight line
            const y = o.stats ? 3 : o.y || 0, h = o.heading || 0, l = o.stats ? o.stats.length * 0.4 : 0;
            for (const f of o.stats ? [0, 1, -1] : [0]) {
              const q = { x: o.x + Math.cos(h) * l * f, y, z: o.z + Math.sin(h) * l * f }, v = new THREE.Vector3(q.x, q.y, q.z).project(c);
              const inq = v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95;
              inF = inF || inq;
              if (inq && (!WW.camDirector || WW.camDirector.sight(c.position, q, o))) vis = true;
            }
          }
          const s = WW.cam._shot();
          out.push({ n, inF, vis, has, shot: s ? (s.story ? 'story' : s.kind) + (s.subj && s.subj.stats ? ':' + (WW.lookahead.idOf(s.subj) || '') + (m.keys.includes(WW.lookahead.idOf(s.subj)) ? '*' : '') : '') : '-' });   // (* the clip's own subject)
        }
      }
      return out;
    }, [m, false]);
    samples.push(...info);
    if (sheet) {
      const w = await p.evaluate(() => WW.game.stepN);
      if (w - lastShot >= EVERY * 0.3057 * 120) {
        lastShot = w;
        await p.evaluate(() => { __render = true; __step(1); __render = false; const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0'; });
        const file = path.join(sheet, `c${String(cur).padStart(2, '0')}_${String(frames.length).padStart(3, '0')}.png`);
        await p.screenshot({ path: file, timeout: 180000 });
        const lab = await p.evaluate(() => { const s = WW.cam._shot(); return (s ? (s.story ? 'story/' + s.sk : s.kind) : '-') + ' ' + (WW.diary ? WW.diary.clock(WW.game.roundTime) : ''); });
        frames.push({ file, clip: cur, lab });
      }
    }
  }
  if (cur >= 0) R.clips.push(clipRes(M[cur], samples));
  R.reelS = +((Date.now() - t1) / 1000).toFixed(1);
  const after = await p.evaluate(() => ({ last: WW.highlights.lastReel(), aar: (r => r ? JSON.stringify({ w: r.winner, h: r.how, s: r.sides, k: r.key.map(e => e.clock + ' ' + e.text) }) : '')(WW.aar.last()), stats: JSON.stringify(WW.stats), rand: WW.randState(), terrain: WW.terrain.seed,
    comp: JSON.stringify(WW.game.composition), state: WW.game.state, aarOn: WW.aar.visible() }));
  R.hash = after.last ? { ok: after.last.hashOk, bad: after.last.bad, starts: after.last.starts.map(s => ({ i: s.i, n: s.n, eq: s.hash === s.want })) } : null;
  if (!R.hash || R.hash.bad || R.hash.starts.some(s => !s.eq)) R.fail.push('replay hash differs ' + JSON.stringify(R.hash && (R.hash.bad || R.hash.starts.filter(s => !s.eq))));
  if (R.clips.length !== M.length) R.fail.push('played ' + R.clips.length + ' of ' + M.length + ' clips');
  for (const c of R.clips) if (!c.vis) R.fail.push('clip ' + c.kind + ' @' + c.climax + ' key never in sight');
  for (const k of ['aar', 'stats', 'rand', 'terrain', 'comp', 'state']) if (before[k] !== after[k]) R.fail.push(k + ' changed by the reel');
  if (!after.aarOn) R.fail.push('report not shown after the reel');
  R.errs = errs.slice(0, 5); if (errs.length) R.fail.push('page errors');
  if (sheet && frames.length) await contact(b, frames, M, sheet);
  await p.close();
  return R;
}
function clipRes(m, s) {
  const inF = s.filter(x => x.inF).length, vis = s.filter(x => x.vis).length;
  const shots = {}; for (const x of s) shots[x.shot] = (shots[x.shot] || 0) + 1;
  return { kind: m.kind, title: m.title, climax: m.climax, samples: s.length, inFrame: s.length ? +(inF / s.length).toFixed(2) : 0, vis: s.length ? +(vis / s.length).toFixed(2) : 0, shots };
}
async function contact(b, frames, M, dir) {
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const rows = M.map((m, i) => `<h3>${i + 1}. ${m.title} <small>${m.sub || ''} [${m.kind}, ${m.value}, ${m.real} s]</small></h3><div class="r">` +
    frames.filter(f => f.clip === i).map(f => `<figure><img src="data:image/png;base64,${fs.readFileSync(f.file).toString('base64')}"><figcaption>${f.lab}</figcaption></figure>`).join('') + '</div>').join('');
  await p.setContent(`<style>body{background:#111;color:#ddd;font:13px sans-serif;margin:8px}h3{margin:10px 0 4px;font-weight:600}small{color:#999;font-weight:400}.r{display:flex;flex-wrap:wrap;gap:4px}figure{margin:0;width:256px}img{width:256px}figcaption{font-size:11px;color:#aaa}</style>${rows}`);
  await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(dir, 'sheet.png'), fullPage: true });
  await p.close();
  console.log('  sheet: ' + path.join(dir, 'sheet.png'));
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--allow-file-access-from-files'] });
  let fail = 0;
  for (const [k, sd] of SEEDS.entries()) {
    const sheet = SHEET && k === 0 ? SHEET : '';
    if (sheet) fs.mkdirSync(sheet, { recursive: true });
    const R = await run(b, sd, sheet);
    if (R.fail.length) fail++;
    console.log(`${R.fail.length ? 'FAIL' : 'ok  '} seed ${sd}: ${R.winner || 'no'} victory (${R.reason}), ${R.endN} steps, ${R.events} events, sim ${R.simS} s, reel ${R.reelS} s wall, ${R.n} moments, hash ok ${R.hash ? R.hash.ok : '-'}`);
    for (const [i, m] of R.moments.entries()) {
      const c = R.clips[i] || {};
      console.log(`   ${i + 1}. [${m.kind} ${m.value}] ${m.title}${m.sub ? ' / ' + m.sub : ''}  (${m.real} s, steps ${m.n0}-${m.n1}, climax ${m.climax})  in frame ${c.inFrame} in sight ${c.vis} ${JSON.stringify(c.shots || {})}`);
    }
    for (const f of R.fail) console.log('   ! ' + f);
    if (R.errs && R.errs.length) console.log('   errors: ' + R.errs.join(' | '));
  }
  await b.close();
  console.log(fail ? `FAIL: ${fail}` : 'PASS: the highlight reel');
  process.exit(fail ? 1 : 0);
})();
