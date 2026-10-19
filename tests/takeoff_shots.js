// Take-off contact sheet (render mode, software GL): frame by frame through the bow of a USN and an IJN deck launch.
// A seeded random round (the set-up of tests/takeoff_probe.js). The page's rAF is driven by hand: one frame = 1/30 s of
// real time = 1/60 sim s at the 1x pace = 2 live sim steps. The camera rides with the carrier abeam of the bow, so the
// plane's speed relative to the deck and the prop look (disc / blades) read frame to frame. Writes OUT/<tag>_<nation>_NN.png,
// OUT/<tag>_<nation>.json (per frame: sim s from the bow, speed, ground speed, height over the deck, pitch, disc / blades)
// and OUT/<tag>_<nation>_sheet.png (the shots in a captioned grid).
// Usage: CHROMIUM=... BASE_URL=http://localhost:PORT/ node tests/takeoff_shots.js OUT_DIR TAG [seed=1] [nations=USN,IJN]
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const OUT = process.argv[2], TAG = process.argv[3] || 'shot', SEED = +(process.argv[4] || 1), NATIONS = (process.argv[5] || 'USN,IJN').split(',');
const PRE = 10, POST = 90, EVERY = 9;   // frames (1/30 s real = 1/60 sim s at the 1x pace) before the bow, after it; a shot every EVERY frames

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 480, height: 270 } });
  p.on('pageerror', e => console.error('PAGE', e.message));
  await p.addInitScript(() => {
    window.__raf = []; window.__fakeT = 0;
    window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
    window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
  });
  await p.goto((process.env.BASE_URL || 'http://localhost:8000/') + 'index.html?auto&cam=forecast');
  await p.waitForTimeout(1500);
  await p.evaluate((seed) => {
    const t0 = performance.now(); performance.now = () => t0 + __fakeT;
    window.__render = true; const pr = WW.post.render.bind(WW.post); WW.post.render = (x, y) => { if (__render) pr(x, y); };   // frames without a shot are not drawn (software GL is slow)
    __step(3);
    const camUpd = WW.cam.update.bind(WW.cam);
    WW.cam.update = function (rdt) { if (!window.__lookFn) return camUpd(rdt); const L = __lookFn(); WW.camera.position.set(L.x, L.y, L.z); WW.camera.lookAt(L.tx, L.ty, L.tz); WW.camera.updateMatrixWorld(); };
    const G = WW.game;
    WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed;
    const comp = G.randomComposition();
    if (WW.aces) WW.aces.reset();
    WW.seedRandom(seed * 7919 + 1); WW.time.now = 0; WW.time.warp = 1;
    G.composition = comp; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null;
    __sim.setScale(1);
    for (const s of ['.panel.setup', '.caption', '#fade']) { const e = document.querySelector(s); if (e) e.style.display = 'none'; }
  }, SEED);
  for (const nat of NATIONS) {
    // run the sim until a plane of this nation is on its deck run within PRE frames of the bow
    const ok = await p.evaluate((a) => {
      const [nat, pre] = a;
      for (let i = 0; i < 400 * 120; i++) {
        const q = WW.world.planes.find(q => q.alive && q.nation === nat && q.state === 'takeoff' && q.deckPh === 'run' && q.carrier && q.carrier._deck && !q.carrier.isBase);
        if (q) {
          const D = q.carrier._deck, left = D.k.bow - q.lx, tLeft = (-q.rel + Math.sqrt(q.rel * q.rel + 2 * 21 * left)) / 21;
          if (tLeft <= pre / 60) {
            window.__q = q; const c = q.carrier;
            // the eye rides with the carrier, abeam of the bow on the side away from the island, and pans with the plane
            window.__lookFn = () => { const e = c.toWorld(D.k.bow + 4, -D.s * 14);
              return { x: e[0], y: D.dy + 1.8, z: e[1], tx: q.x, ty: q.y, tz: q.z }; };
            return true;
          }
        }
        __sim.stepFixed(1);
      }
      return false;
    }, [nat, PRE]);
    if (!ok) { console.log(nat + ': no deck launch found'); continue; }
    const rows = [];
    let bowF = null;
    for (let f = 0; f < PRE + POST + 12 && (bowF === null || f - bowF <= POST); f++) {
      const shot = f % EVERY === 0 || f === PRE - 1 || f === PRE;
      const r = await p.evaluate((shot) => {
        window.__render = shot; const q = __q, x0 = q.x, z0 = q.z, t0 = WW.time.now;
        __step(1);
        const gs = Math.hypot(q.x - x0, q.z - z0) / Math.max(1e-6, WW.time.now - t0), m = q.model, c = q.carrier;
        return { ph: q.state === 'takeoff' ? q.deckPh : q.state, sp: +q.speed.toFixed(2), gs: +gs.toFixed(2), rel: +(gs - c.speed).toFixed(2),
          h: +(q.y - c._deck.dy).toFixed(2), pitch: +((q.pitch || 0) * 180 / Math.PI).toFixed(1), disc: m.disc.visible ? 1 : 0, blades: m.blades.visible ? 1 : 0, kind: q.kind, cv: c.cls && c.cls.key };
      }, shot);
      if (bowF === null && r.ph !== 'run') bowF = f;
      r.f = f; rows.push(r);
      if (shot) {
        const file = `${TAG}_${nat}_${String(f).padStart(2, '0')}.png`;
        await p.screenshot({ path: path.join(OUT, file), timeout: 180000 });
        r.file = file;
      }
    }
    for (const r of rows) r.tBow = +((r.f - bowF) / 60).toFixed(3);   // sim s
    fs.writeFileSync(path.join(OUT, `${TAG}_${nat}.json`), JSON.stringify(rows, null, 1));
    console.log(`${TAG} ${nat} ${rows[0].kind} (${rows[0].cv}): bow at frame ${bowF}`);
    for (const r of rows) console.log(`  ${r.tBow >= 0 ? '+' : ''}${r.tBow.toFixed(2)}s ${r.ph.padEnd(8)} sp ${String(r.sp).padStart(6)} gs ${String(r.gs).padStart(6)} rel ${String(r.rel).padStart(6)} h ${String(r.h).padStart(5)} pitch ${String(r.pitch).padStart(5)} ${r.disc ? 'DISC' : 'blades'}${r.file ? '  ' + r.file : ''}`);
    // the contact sheet: the shots in a grid, captioned
    const shots = rows.filter(r => r.file), html = '<html><body style="margin:0;background:#111;color:#eee;font:11px monospace;display:flex;flex-wrap:wrap;width:1440px">' +
      shots.map(r => `<div style="width:240px"><img src="file://${path.join(path.resolve(OUT), r.file)}" style="width:240px;height:135px;display:block"><div style="padding:1px 3px">${r.tBow >= 0 ? '+' : ''}${r.tBow.toFixed(2)}s ${r.ph} gs ${r.gs} ${r.disc ? 'DISC' : '<b style="color:#f66">BLADES</b>'}</div></div>`).join('') + '</body></html>';
    const hp = path.join(path.resolve(OUT), `${TAG}_${nat}_sheet.html`); fs.writeFileSync(hp, html);
    const sp = await b.newPage({ viewport: { width: 1440, height: 200 } });
    await sp.goto('file://' + hp); await sp.screenshot({ path: path.join(OUT, `${TAG}_${nat}_sheet.png`), fullPage: true }); await sp.close();
  }
  await b.close();
})();
