// Render-mode screenshots of the 1942 ship classes (ship_classes.js, models_cv/usn/ijn.js) at true relative size.
//   node tests/class_shots.js [outdir] [--only lineup,close,planes,formation]
//   cls_lineup_USN.png / cls_lineup_IJN.png  each nation's classes side by side, broadside, one camera (true relative size)
//   cls_lineup_both.png                       both nations' battle lines, one above the other
//   cls_<key>.png                             a 3/4 close-up of every class (same camera distance per hull length)
//   cls_planes_<scale>.png                    a Yorktown with its deck park and a fighter alongside, at PLANE_SCALE
//                                             0.41 (true), 0.82 (~2x) and 1.7 (current arcade scale)
//   cls_formation.png                         a fleet in formation shortly after a round starts
// Needs BASE_URL (a server on the repo) and CHROMIUM (headless shell). Ships are spawned in 'setup' state (they hold
// still); the director camera is switched off and the camera placed directly.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const args = process.argv.slice(2), oi = args.indexOf('--only'), only = oi >= 0 ? args[oi + 1].split(',') : null;
const out = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--only') || path.join(__dirname, 'shots');
fs.mkdirSync(out, { recursive: true });
const want = k => !only || only.includes(k);

async function page(b, q, w, h) {
  const p = await b.newPage({ viewport: { width: w || 1600, height: h || 900 } });
  p.on('pageerror', e => console.log('PAGE', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await p.goto(process.env.BASE_URL + 'index.html?' + (q || '') + '&v=' + Date.now());
  await p.waitForFunction(() => window.__sim && window.WW && WW.game && WW.cam);
  await p.waitForTimeout(1500);
  // a quiet stage: setup mode on a fixed map, no fleets, the HUD hidden, the director camera off
  await p.evaluate(() => {
    WW.game.composition = []; WW.game.enterSetup(false, false);
    WW.ships.clearAll();
    WW.cam.update = function () {};
    document.querySelectorAll('body > *:not(canvas)').forEach(e => { if (!e.querySelector('canvas')) e.style.display = 'none'; });
    // the deepest open rectangle near the map centre: the lineup's water
    let best = null;
    for (let x = 160; x <= WW.cfg.MAP_W - 160; x += 20) for (let z = 120; z <= WW.cfg.MAP_H - 120; z += 20) {
      let m = 1e9;
      for (let dx = -130; dx <= 130; dx += 10) for (let dz = -70; dz <= 70; dz += 10) m = Math.min(m, WW.terrain.depthAt(x + dx, z + dz));
      if (!best || m > best.m) best = { x, z, m };
    }
    window.__stage = best;
    window.surface = s => { if (s.type === "submarine") { s.wantSurface = true; s.depthY = 0; s.updateDepth(0); } };
  });
  return p;
}
async function cam(p, P, L, fov) {
  await p.evaluate(([P, L, fov]) => {
    const c = WW.camera; c.position.set(P[0], P[1], P[2]); c.lookAt(L[0], L[1], L[2]);
    if (fov) { c.fov = fov; c.updateProjectionMatrix(); }
  }, [P, L, fov || 0]);
  await p.waitForTimeout(900);
}
// spawn a row of classes along +x (bows east), centred at (cx, z); returns the ships' x
async function row(p, keys, z, gap, x0) {
  return p.evaluate(([keys, z, gap, x0]) => {
    const S = window.__stage, C = WW.SHIP_CLASSES;
    let tot = 0; keys.forEach(k => { tot += C[k].len + gap; }); tot -= gap;
    let x = (x0 === null ? S.x : x0) - tot / 2;
    return keys.map(k => { const c = C[k], s = WW.ships.spawn(c.type, c.nation, x + c.len / 2, S.z + z, 0, k); s.x = x + c.len / 2; s.z = S.z + z; s.speed = 0; surface(s); x += c.len + gap; return [k, s.name, +s.x.toFixed(1)]; });
  }, [keys, z, gap, x0 === undefined ? null : x0]);
}
const USN = ['lexington', 'yorktown', 'northcarolina', 'southdakota', 'northampton', 'neworleans', 'atlanta', 'fletcher', 'benson', 'gato', 'elco'];
const IJN = ['akagi', 'kaga', 'shokaku', 'soryu', 'hiryu', 'nagato', 'kongo', 'takao', 'mogami', 'kagero', 'fubuki', 'iboat', 'gyoraitei'];

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  if (want('lineup')) {
    for (const [n, keys] of [['USN', USN], ['IJN', IJN]]) {
      const p = await page(b, '', 2400, 700);
      const r = await row(p, keys, 0, 4);
      console.log(n, JSON.stringify(r));
      const S = await p.evaluate(() => window.__stage), span = r[r.length - 1][2] - r[0][2] + 30;
      await cam(p, [S.x, 26, S.z + span * 0.62], [S.x, 1.5, S.z], 28);
      await p.screenshot({ path: `${out}/cls_lineup_${n}.png` });
      await p.close();
    }
    const p = await page(b, '', 2400, 1100);
    await row(p, ['yorktown', 'northcarolina', 'northampton', 'atlanta', 'fletcher', 'gato', 'elco'], -14, 5);
    await row(p, ['akagi', 'nagato', 'takao', 'mogami', 'kagero', 'iboat', 'gyoraitei'], 14, 5);
    const S = await p.evaluate(() => window.__stage);
    await cam(p, [S.x, 70, S.z + 150], [S.x, 0, S.z - 2], 34);
    await p.screenshot({ path: `${out}/cls_lineup_both.png` });
    await p.close();
  }
  if (want('close')) {
    const p = await page(b, '', 1200, 700);
    for (const k of USN.concat(IJN)) {
      const info = await p.evaluate(k => {
        WW.ships.clearAll();
        const S = window.__stage, c = WW.SHIP_CLASSES[k], s = WW.ships.spawn(c.type, c.nation, S.x, S.z, 0, k);
        s.x = S.x; s.z = S.z; s.speed = 0; surface(s);
        return { name: s.name, cls: c.name, len: c.len, L: c.lenM };
      }, k);
      const S = await p.evaluate(() => window.__stage), L = Math.max(info.len, 6), d = L * 1.15 + 3;
      await cam(p, [S.x + d * 0.55, d * 0.42, S.z + d * 0.95], [S.x + L * 0.02, L * 0.06 + 0.6, S.z], 30);
      await p.screenshot({ path: `${out}/cls_${k}.png` });
      console.log(k, info.name, '-', info.cls, info.L + ' m');
    }
    await p.close();
  }
  if (want('cvside')) {   // carriers low from both beams: islands, funnels, sponsons (cls_side_<key>_<stbd|port>.png)
    const p = await page(b, '', 1200, 600);
    for (const k of ['yorktown', 'lexington', 'akagi', 'kaga', 'shokaku', 'soryu', 'hiryu']) {
      await p.evaluate(k => { WW.ships.clearAll(); const S = window.__stage, c = WW.SHIP_CLASSES[k], s = WW.ships.spawn(c.type, c.nation, S.x, S.z, 0, k); s.x = S.x; s.z = S.z; s.speed = 0; }, k);
      const S = await p.evaluate(() => window.__stage);
      for (const [sd, sz] of [['stbd', 1], ['port', -1]]) {
        await cam(p, [S.x + 9, 6, S.z + sz * 30], [S.x, 1.5, S.z], 40);
        await p.screenshot({ path: `${out}/cls_side_${k}_${sd}.png` });
      }
    }
    await p.close();
  }
  if (want('planes')) {
    for (const ps of [0.41, 0.82, 1.7]) {
      const p = await page(b, 'planeScale=' + ps, 1600, 900);
      await p.evaluate(() => {
        const S = window.__stage, s = WW.ships.spawn('carrier', 'USN', S.x, S.z, 0, 'yorktown'); s.x = S.x; s.z = S.z; s.speed = 0;
        __sim.fastForward(0.2);
        // a fighter and a dive bomber in the air alongside, wheels-up, at the plane scale
        const k = WW.cfg.PLANE_SCALE;
        [['fighter', 6, 9, 7], ['dive', -4, 10.5, 12]].forEach(([kind, x, y, z]) => { const m = WW.models.buildPlane(kind, 'USN'); m.group.scale.setScalar(k); m.group.position.set(S.x + x, y, S.z + z); WW.scene.add(m.group); });
      });
      const S = await p.evaluate(() => window.__stage);
      await cam(p, [S.x + 16, 17, S.z + 30], [S.x - 1, 2.5, S.z + 1], 34);
      await p.evaluate(ps => { const d = document.createElement('div'); d.textContent = 'PLANE_SCALE ' + ps + (ps < 0.5 ? '  (true scale)' : ps < 1 ? '  (~2x, default)' : '  (old arcade, ~4x)'); Object.assign(d.style, { position: 'fixed', left: '20px', top: '16px', font: 'bold 28px sans-serif', color: '#fff', textShadow: '0 1px 4px #000', zIndex: 99 }); document.body.appendChild(d); }, ps);
      await p.screenshot({ path: `${out}/cls_planes_${ps}.png` });
      console.log('planes', ps, await p.evaluate(() => WW.airDeck.parkedCount()));
      await p.close();
    }
  }
  if (want('formation')) {
    const p = await page(b, '', 1600, 900);
    const r = await p.evaluate(() => {
      const G = WW.game; WW.seedRandom(5); G.composition = null; G.mode = 'auto'; G.startRound({ keepMap: true });
      __sim.fastForward(25);
      const sh = WW.world.ships.filter(s => s.nation === 'USN');
      let x = 0, z = 0; sh.forEach(s => { x += s.x; z += s.z; }); x /= sh.length; z /= sh.length;
      return { x, z, ships: sh.map(s => s.mk + ':' + s.name).join(', ') };
    });
    console.log('formation', r.ships);
    await cam(p, [r.x - 40, 95, r.z + 120], [r.x + 10, 0, r.z], 42);
    await p.screenshot({ path: `${out}/cls_formation.png` });
    await p.close();
  }
  await b.close();
})();
