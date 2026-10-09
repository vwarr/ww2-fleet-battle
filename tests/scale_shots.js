// Plane scale screenshots (render mode, software GL, fake frame clock as tests/airwing_shots.js): ships vs planes at
// a given PLANE_SCALE, for before / after comparisons. Writes tests/shots/scale/<tag>_<scene>.png.
//   deck      a carrier's deck spotted for launch (crew on deck)
//   strike    a strike stacked over / near its carrier, forming up
//   dogfight  a fighter close behind its foe
//   overview  the director camera (default view) mid-battle, and a high fleet overview
//   base      busy ground ops at the island base (taxi queue)
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/scale_shots.js [planeScale=default] [tag=now] [scenes] [seed=2]
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots', 'scale');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = require('playwright');
const PS = process.argv[2] && process.argv[2] !== 'default' ? process.argv[2] : null, TAG = process.argv[3] || 'now';
const WHICH = (process.argv[4] || 'deck,strike,dogfight,overview,base').split(','), SEED = +(process.argv[5] || 2);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0; window.__render = true;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8790/') + 'index.html?auto' + (PS ? '&planeScale=' + PS : ''));
  await p.waitForTimeout(1500);
  await p.addStyleTag({ content: '#hud, .panel, #film .caption, .caption { visibility: hidden !important; }' });
  const setup = (seed, comp) => p.evaluate(([seed, comp]) => {
    if (!window.__inst) {
      window.__inst = true;
      const pr = WW.post.render.bind(WW.post); WW.post.render = (a, b) => { if (__render) pr(a, b); };
      const t0 = performance.now(); performance.now = () => t0 + __fakeT;
      __step(5);
      const camUpd = WW.cam.update.bind(WW.cam);
      WW.cam.update = function (rdt) {
        if (!window.__lookFn) return camUpd(rdt);
        const L = __lookFn(); if (!L) return camUpd(rdt);
        WW.camera.position.set(L.x, Math.max(L.y, 1.5), L.z); WW.camera.lookAt(L.tx, L.ty, L.tz); WW.camera.updateMatrixWorld();
      };
      window.until = (cond, max) => { for (let i = 0; i < max * 4; i++) { const r = cond(); if (r) return r; __sim.fastForward(0.25); } return cond(); };
      window.rel = (c, a, s, h, ta, ts, th) => {
        const ch = Math.cos(c.heading), sh = Math.sin(c.heading), w = (u, v) => [c.x + ch * u - sh * v, c.z + sh * u + ch * v];
        const e = w(a, s), t = w(ta || 0, ts || 0);
        return { x: e[0], y: h, z: e[1], tx: t[0], ty: th || 2, tz: t[1] };
      };
    }
    window.__lookFn = null;
    const G = WW.game, W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    if (WW.aces) WW.aces.reset();
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
    if (WW.dayNight) WW.dayNight.force = 'day';
    if (comp === 'duel') {
      const g = (n, x, s) => [{ type: 'carrier', nation: n, x, z: H / 2 }, { type: 'destroyer', nation: n, x: x + s * 50, z: H / 2 - 50 }, { type: 'destroyer', nation: n, x: x + s * 50, z: H / 2 + 50 }];
      G.composition = [...g('USN', 70, 1), ...g('IJN', W - 70, -1)];
    } else { G.composition = null; if (comp === 'base') G.baseChoice = 'USN'; }
    G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
    __sim.setScale(1);
    return 'PLANE_SCALE ' + WW.cfg.PLANE_SCALE + ' DECK_K ' + WW.cfg.DECK_K.toFixed(2);
  }, [seed, comp]);
  const snap = async (tag) => {
    const info = await p.evaluate(() => { __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0'; return 't=' + WW.game.roundTime.toFixed(1); });
    const file = `${TAG}_${tag}.png`;
    await p.screenshot({ path: path.join(OUT, file), timeout: 180000 });
    console.log('  shot tests/shots/scale/' + file + '  ' + info);
  };
  const frames = (k) => p.evaluate((k) => { __render = false; __step(k); }, k);
  const say = (s) => console.log(s);

  if (WHICH.includes('deck') || WHICH.includes('strike')) {
    say('[duel] ' + await setup(SEED, 'duel'));
    if (WHICH.includes('deck')) {
      say('[deck] ' + await p.evaluate(() => {
        const cv = WW.world.ships.find(s => s.type === 'carrier' && s.nation === 'USN');
        until(() => cv._deck && cv._deck.mode === 'idle' && WW.game.roundTime > 15 && cv._deck.cols.reduce((s, c) => s + c.e.filter(e => e.ph === 'park').length, 0) >= WW.airDeck.spotCap(cv), 60);
        window.__cv = cv; window.__lookFn = () => rel(cv, 24, 18, 14, -4, 0, 1.5);
        const D = cv._deck; return 'spotted ' + D.cols.reduce((s, c) => s + c.e.length, 0) + ' (spotCap ' + WW.airDeck.spotCap(cv) + ')';
      }));
      await frames(2); await snap('deck_spotted');
      await p.evaluate(() => { const cv = __cv; window.__lookFn = () => rel(cv, -9, 7, 3.2, -4, 0, 1.6); }); await frames(1); await snap('deck_crew_close');
    }
    if (WHICH.includes('strike')) {
      say('[strike] ' + await p.evaluate(() => {
        const cv = WW.world.ships.find(s => s.type === 'carrier' && s.nation === 'USN'); window.__cv = cv;
        const w = until(() => (WW.strike._waves() || []).find(w => w.carrier === cv && w.members.length >= 8 && !w.go), 200);
        if (!w) return 'no wave';
        window.__w = w; window.__lookFn = () => rel(cv, -50, 70, 40, 10, 0, 18);
        return 'wave members ' + w.members.length + ', t ' + WW.game.roundTime.toFixed(0);
      }));
      await frames(2); await snap('strike_stack_carrier');
    }
  }
  if (WHICH.includes('dogfight')) {
    say('[dogfight] ' + await setup(SEED, 'duel'));
    say('  ' + await p.evaluate(() => {
      const f = until(() => WW.world.planes.find(q => q.alive && q.kind === 'fighter' && q.foe && q.foe.alive && WW.dist(q.x, q.z, q.foe.x, q.foe.z) < 25 && q.y > 8), 400);
      if (!f) return 'no dogfight';
      window.__lookFn = () => { const h = f.heading; return { x: f.x - Math.cos(h) * 10 + Math.sin(h) * 6, y: f.y + 3, z: f.z - Math.sin(h) * 10 - Math.cos(h) * 6, tx: f.foe && f.foe.alive ? f.foe.x : f.x + Math.cos(h) * 10, ty: f.foe && f.foe.alive ? f.foe.y : f.y, tz: f.foe && f.foe.alive ? f.foe.z : f.z + Math.sin(h) * 10 }; };
      return 'fighter ' + f.nation + ' vs ' + f.foe.kind + ', t ' + WW.game.roundTime.toFixed(0);
    }));
    await frames(2); await snap('dogfight');
  }
  if (WHICH.includes('overview')) {
    say('[overview] ' + await setup(SEED + 3, 'random'));
    say('  ' + await p.evaluate(() => { until(() => WW.world.planes.filter(q => q.alive).length > 30 && WW.game.roundTime > 120, 400); return 'planes ' + WW.world.planes.filter(q => q.alive).length + ', t ' + WW.game.roundTime.toFixed(0); }));
    await frames(90); await snap('overview_director');
    await p.evaluate(() => WW.cam.film({ kind: 'wide', dur: 30 })); await frames(150); await snap('overview_wide');
    await p.evaluate(() => { const f = WW.world.ships.filter(s => s.alive); const c = f[0]; WW.cam.film({ kind: 'orbit', subj: { x: c.x, z: c.z, y: 0, diorama: true }, r: 120, dur: 30, w: 0.022, hgt: 0.3 }); }); await frames(150); await snap('overview_diorama');
    const ch = await p.evaluate(() => { const q = WW.world.planes.find(q => q.alive && q.state === 'transit' && q.ordnance && q.y > 10); if (!q) return 'none'; WW.cam.film({ kind: 'chase', subj: q, dur: 30 }); return q.kind; });
    if (ch !== 'none') { await frames(90); await snap('director_chase_' + ch); }
    await p.evaluate(() => {
      const sh = WW.world.ships.filter(s => s.alive && s.nation === 'USN'); let x = 0, z = 0; sh.forEach(s => { x += s.x; z += s.z; }); x /= sh.length; z /= sh.length;
      window.__lookFn = () => ({ x: x - 60, y: 80, z: z + 110, tx: x, ty: 0, tz: z });
    });
    await frames(1); await snap('overview_fleet');
  }
  if (WHICH.includes('base')) {
    say('[base] ' + await setup(3, 'base'));
    say('  ' + await p.evaluate(() => {
      const B = WW.islandBase.base; if (!B) return 'no base';
      const G = () => WW.world.planes.filter(p => p.carrier === B && p.alive && WW.landGround.onGround(p));
      until(() => G().length >= 4 && G().some(p => p.rwPh === 'taxi'), 300);
      const ps = G(); if (!ps.length) return 'none';
      const h = ps.find(p => p.rwPh === 'taxi') || ps[0];
      const gy = (x, z) => Math.max(0, -WW.terrain.depthAt(x, z)); window.__lookFn = () => { const e = WW.islandBase.base.layout.toL(h.x, h.z), q = WW.islandBase.base.layout.toW(e.u - 12, e.v + Math.sign(e.v || 1) * 12); return { x: q.x, y: Math.max(gy(q.x, q.z), gy(h.x, h.z)) + 8, z: q.z, tx: h.x, ty: gy(h.x, h.z) + 0.5, tz: h.z }; };
      return ps.length + ' on the ground, t ' + WW.game.roundTime.toFixed(0);
    }));
    await frames(2); await snap('base_ground');
    await p.evaluate(() => { const L = WW.islandBase.base.layout, c = L.toW(0, 0), e = L.toW(-30, 70); window.__lookFn = () => ({ x: e.x, y: 55, z: e.z, tx: c.x, ty: 0, tz: c.z }); });
    await frames(1); await snap('base_field');
  }
  if (errs.length) console.log('page errors: ' + errs.length + '\n  ' + errs.slice(0, 5).join('\n  '));
  await b.close();
})();
