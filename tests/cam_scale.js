// Director camera framing probe (render mode, fake frame clock as tests/story_cam.js): plays whole rounds at 1x with
// the director camera and, once per real second, measures the projected on-screen width of the largest visible ship
// (its hull box projected through the camera, clipped to the frame, as a share of the frame width), the planes in
// view and the shot kind. Reports the distribution (p10 / p50 / p90), the share of seconds with no ship above 5 % /
// 10 % of the frame width, the share inside the 25-60 % target band, and the same per shot kind.
// With --sheet N it also renders a screenshot every N real seconds of the first rounds and lays them out on contact
// sheets (tests/shots/camscale/<tag>_sheet_<k>.png).
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/cam_scale.js [tag=now] [--rounds 12] [--max 900] [--sheet 40] [--sheetRounds 2]
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'camscale');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TAG = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'now';
const ROUNDS = +arg('--rounds', 12), MAXS = +arg('--max', 900), SHEET = +arg('--sheet', 0), SHEET_R = +arg('--sheetRounds', 2);
const rep = (t, n) => Array(n).fill(t);
// scenario plan: [name, seed, A, B, base]; A / B null = the game's random fleets
const PLAN = [
  ['standard', 1], ['carrier_duel', 2, ['carrier', 'destroyer', 'destroyer'], ['carrier', 'destroyer', 'destroyer']],
  ['midway', 3, ['carrier', 'cruiser', 'destroyer', 'destroyer'], ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], 'USN'],
  ['surface', 4, ['battleship', 'battleship', 'cruiser', 'cruiser'], ['battleship', 'battleship', 'cruiser', 'cruiser']],
  ['standard', 5], ['pt_raid', 6, rep('pt', 3), ['carrier', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3)]],
  ['carrier_duel', 7, ['carrier', 'destroyer', 'destroyer'], ['carrier', 'destroyer', 'destroyer']],
  ['asymmetric', 8, ['carrier', 'battleship', 'battleship', 'cruiser', 'cruiser', ...rep('destroyer', 3), 'submarine', 'pt', 'pt'], ['cruiser', 'destroyer', 'destroyer']],
  ['standard', 9], ['surface', 10, ['battleship', 'battleship', 'cruiser', 'cruiser'], ['battleship', 'battleship', 'cruiser', 'cruiser']],
  ['midway', 11, ['carrier', 'cruiser', 'destroyer', 'destroyer'], ['carrier', 'carrier', 'battleship', 'cruiser', 'destroyer', 'destroyer'], 'USN'],
  ['standard', 12]
];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8797/') + 'index.html?auto');
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    __render = false; __step(5);
    // the largest visible ship's projected width (share of the frame), the planes in view
    const v = new THREE.Vector3();
    window.__measure = () => {
      const c = WW.camera, out = { fill: 0, ships: 0, planes: 0, near: 1e9 };
      for (const s of WW.world.ships) {
        if (s.removed || (!s.alive && !s.sinking) || s.submerged) continue;
        const h = s.heading, fx = Math.cos(h), fz = Math.sin(h), l = s.stats.length / 2, bm = (s.stats.beam || s.stats.length * 0.12) / 2;
        let x0 = 9, x1 = -9, y0 = 9, y1 = -9, front = false;
        for (const a of [-l, l]) for (const w of [-bm, bm]) for (const y of [0, Math.max(1.5, l * 0.25)]) {
          v.set(s.x + fx * a - fz * w, y, s.z + fz * a + fx * w).project(c);
          if (v.z > 1) continue; front = true;
          x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
        }
        if (!front || x1 < -1 || x0 > 1 || y1 < -1 || y0 > 1) continue;
        const wFr = (Math.min(1, x1) - Math.max(-1, x0)) / 2;
        if (wFr > 0.02) out.ships++;
        out.fill = Math.max(out.fill, wFr);
        out.near = Math.min(out.near, Math.hypot(c.position.x - s.x, c.position.z - s.z));
      }
      for (const q of WW.world.planes) {
        if (!q.alive || q.removed || Math.hypot(q.x - c.position.x, q.y - c.position.y, q.z - c.position.z) > 220) continue;
        v.set(q.x, q.y, q.z).project(c);
        if (v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) out.planes++;
      }
      const sh = WW.cam._shot();
      out.kind = sh ? (sh.kind === 'story' ? 'story:' + sh.sk : sh.kind + (sh.subj && sh.subj.diorama ? ':diorama' : sh.subj && sh.subj.pt ? ':plane' : '')) : '-';
      out.cy = c.position.y;
      const su = sh && sh.subj; // the subject (diagnostics): its type and distance from the camera
      if (su && su.x !== undefined) { out.st = su.stats ? su.type : su.kind || 'spot'; out.sd = Math.round(Math.hypot(su.x - c.position.x, su.z - c.position.z)); out.st += su.removed ? '-removed' : su.alive === false ? '-dead' : ''; }
      return out;
    };
  });

  const all = [], perRound = [], sheets = [];
  for (let r = 0; r < Math.min(ROUNDS, PLAN.length); r++) {
    const [name, seed, A, B, base] = PLAN[r];
    const res = await p.evaluate(([name, seed, A, B, base, MAXS, SHEET, doSheet]) => {
      const G = WW.game;
      if (WW.aces) WW.aces.reset();
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0; WW.time.warp = 1;
      if (WW.dayNight) WW.dayNight.force = 'day';
      if (WW.weather) WW.weather.force = 'clear';
      let comp = G.randomComposition();
      if (A) { // the named fleets on the random fleets' (good water) positions, same type first
        const out = [];
        for (const [n, types] of [['USN', seed % 2 ? A : B], ['IJN', seed % 2 ? B : A]]) {
          const pool = comp.filter(c => c.nation === n), used = new Set();
          for (const t of types) {
            const e = pool.find(c => !used.has(c) && c.type === t) || pool.find(c => !used.has(c) && c.type !== 'pt' && c.type !== 'submarine') || pool.find(c => !used.has(c));
            used.add(e); out.push({ type: t, nation: n, x: e.x, z: e.z });
          }
        }
        comp = out;
      }
      G.baseChoice = base || null; G.mode = 'auto'; G.composition = comp; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
      __sim.setScale(1); WW.cam.cut();
      const samples = [], snaps = [];
      for (let s = 0; s < MAXS && G.state === 'battle'; s++) {
        __step(30);
        if (WW.cam.mode !== 'director' || (WW.freecam && WW.freecam.active())) continue;
        const m = __measure(); m.t = s; samples.push(m);
        if (doSheet && SHEET && s % SHEET === SHEET - 1) snaps.push(s);
      }
      return { samples, end: G.state, sim: WW.time.now, snaps };
    }, [name, seed, A || null, B || null, base || null, MAXS, SHEET, r < SHEET_R]);
    perRound.push({ name, seed, n: res.samples.length, sim: res.sim, end: res.end });
    all.push(...res.samples.map(s => Object.assign(s, { round: r })));
    console.log(`[round ${r}] ${name} seed ${seed}: ${res.samples.length} s filmed, sim ${res.sim.toFixed(0)} s, ${res.end}`);
  }
  // contact sheets: replay the first rounds' openings with rendering on, a frame every SHEET s
  if (SHEET) {
    for (let r = 0; r < Math.min(SHEET_R, PLAN.length); r++) {
      const [name, seed, A, B, base] = PLAN[r];
      await p.evaluate(([seed, A, B, base]) => {
        const G = WW.game; if (WW.aces) WW.aces.reset();
        WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0; WW.time.warp = 1;
        let comp = G.randomComposition();
        if (A) { const out = []; for (const [n, types] of [['USN', seed % 2 ? A : B], ['IJN', seed % 2 ? B : A]]) { const pool = comp.filter(c => c.nation === n), used = new Set(); for (const t of types) { const e = pool.find(c => !used.has(c) && c.type === t) || pool.find(c => !used.has(c) && c.type !== 'pt' && c.type !== 'submarine') || pool.find(c => !used.has(c)); used.add(e); out.push({ type: t, nation: n, x: e.x, z: e.z }); } } comp = out; }
        G.baseChoice = base || null; G.composition = comp; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null; __sim.setScale(1); WW.cam.cut();
      }, [seed, A || null, B || null, base || null]);
      for (let s = 0, k = 0; s < Math.min(MAXS, 720) && k < 18; s += SHEET) {
        const st = await p.evaluate((n) => { __render = false; __step(n * 30 - 1); __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0'; const m = __measure(); return WW.game.state === 'battle' ? m : null; }, SHEET);
        if (!st) break;
        const f = path.join(OUT, `${TAG}_r${r}_${String(k++).padStart(2, '0')}.png`);
        await p.screenshot({ path: f, timeout: 180000 });
        sheets.push({ f, cap: `${name} ${s + SHEET}s ${st.kind} fill ${(st.fill * 100).toFixed(0)}%` });
      }
    }
    // lay the frames out 3 x 4 per sheet
    for (let i = 0, k = 0; i < sheets.length; i += 12, k++) {
      const part = sheets.slice(i, i + 12);
      const html = '<body style="margin:0;background:#222;display:grid;grid-template-columns:repeat(3,480px);gap:4px;font:13px sans-serif;color:#fff">' +
        part.map(s => `<div><img src="data:image/png;base64,${fs.readFileSync(s.f).toString('base64')}" style="width:480px;display:block"><div>${s.cap}</div></div>`).join('') + '</body>';
      const q = await b.newPage({ viewport: { width: 1452, height: 300 } });
      await q.setContent(html); await q.waitForTimeout(300);
      const fn = path.join(OUT, `${TAG}_sheet_${k}.png`);
      await q.screenshot({ path: fn, fullPage: true }); await q.close();
      console.log('  sheet', path.relative(path.join(__dirname, '..'), fn));
    }
  }
  // ---- report ----
  const pc = (a, q) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
  const share = (a, f) => a.length ? a.filter(f).length / a.length : 0;
  const pct = x => (x * 100).toFixed(0) + '%';
  const line = (lab, S) => {
    const f = S.map(s => s.fill);
    return `${lab.padEnd(18)} n ${String(S.length).padStart(5)}  fill p10 ${pct(pc(f, 0.1)).padStart(4)} p50 ${pct(pc(f, 0.5)).padStart(4)} p90 ${pct(pc(f, 0.9)).padStart(4)}  none>5% ${pct(share(S, s => s.fill < 0.05)).padStart(4)}  none>10% ${pct(share(S, s => s.fill < 0.1)).padStart(4)}  in 25-60% ${pct(share(S, s => s.fill >= 0.25 && s.fill <= 0.6)).padStart(4)}  >60% ${pct(share(S, s => s.fill > 0.6)).padStart(4)}  planes ${pct(share(S, s => s.planes > 0)).padStart(4)}  cam y p50 ${pc(S.map(s => s.cy), 0.5).toFixed(0)}`;
  };
  console.log(`\n=== director framing, tag ${TAG}: ${all.length} s over ${perRound.length} rounds ===`);
  console.log(line('ALL', all));
  const kinds = {}; for (const s of all) (kinds[s.kind] = kinds[s.kind] || []).push(s);
  for (const k of Object.keys(kinds).sort((a, b) => kinds[b].length - kinds[a].length)) console.log(line(k + ' ' + pct(kinds[k].length / all.length), kinds[k]));
  const byScen = {}; for (const s of all) { const n = perRound[s.round].name; (byScen[n] = byScen[n] || []).push(s); }
  for (const k of Object.keys(byScen)) console.log(line('scen ' + k, byScen[k]));
  fs.writeFileSync(path.join(OUT, `${TAG}_samples.json`), JSON.stringify({ perRound, all }));
  console.log('errors', errs.length, errs.slice(0, 5).join(' / '));
  await b.close();
})();
