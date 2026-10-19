// Render-mode screenshots of a PT ambush (ai_pt.js AMB; BASE_URL, CHROMIUM as for the other tests):
//   node tests/pt_ambush_shots.js <seed> [pt|pt_night] [outdir]
// Plays the tests/torpedo_review.js 'pt' / 'pt_night' round for the seed (a cruiser, two destroyers and four PT boats a
// side) until a boat is lying in wait off the bow of a ship that is coming on (inside TRIG + 40 of it, the boat within
// ~35 deg of her bow), then films the
// boat and its target from above: SHOTS frames (default 6), STEP sim s apart (default 1.5). Prints the boat's state
// per frame (wait, run, out) with the range and the target angle.
'use strict';
const { chromium } = require('playwright');
const seed = +(process.argv[2] || 1), scen = process.argv[3] || 'pt', out = process.argv[4] || require('path').join(__dirname, 'shots');
require('fs').mkdirSync(out, { recursive: true });
const SB = require('./sim_behaviour');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', e => console.log('PAGE', e.message));
  await p.goto(process.env.BASE_URL + 'index.html?v=' + Date.now());
  await p.waitForFunction(() => window.__sim && window.WW && WW.game);
  await p.waitForTimeout(2000);
  await p.evaluate(SB.install, SB.P);
  const found = await p.evaluate(({ seed, scen }) => {
    __sim.setScale(0.1);
    const A = ['cruiser', 'destroyer', 'destroyer', 'pt', 'pt', 'pt', 'pt'];
    const spec = { seed, A, B: A, aNation: seed % 2 ? 'USN' : 'IJN', cripple: -1, noStall: false, base: null, light: true, tod: scen === 'pt_night' ? 'night' : undefined };
    const ff = __sim.fastForward, STOP = {};
    let hit = null;
    __sim.fastForward = function (s) { // the harness's own loop, in small steps, until a boat lies in wait with its target close
      let left = s;
      while (left > 0) {
        const d = Math.min(0.25, left); ff.call(__sim, d); left -= d;
        for (const sh of WW.world.ships) {
          const L = sh.alive && sh.type === 'pt' && sh.ai && sh.ai.lt;
          if (!L || L.state !== 'wait' || !L.amb || !L.amb.u.alive) continue;
          const u = L.amb.u, r = WW.dist(sh.x, sh.z, u.x, u.z);
          const ta = Math.abs(WW.angleDiff(u.heading, Math.atan2(sh.z - u.z, sh.x - u.x)));
          if (r < (u.type === 'cruiser' ? 125 : 90) + 40 && ta < 0.6) { hit = { boat: sh, u }; throw STOP; } // she is coming on, the boat off her bow
        }
      }
    };
    try { window.__beh.run(spec); } catch (e) { if (e !== STOP) throw e; } finally { __sim.fastForward = ff; }
    if (!hit) return null;
    window.__amb = hit;
    const { boat, u } = hit;
    __sim.focus((boat.x + u.x) / 2, (boat.z + u.z) / 2, +(window.__ambW || 120), 60);
    return { t: WW.game.roundTime.toFixed(1), boat: boat.nation + ' pt' + boat.id, target: u.nation + ' ' + u.type, dl: WW.daylight.toFixed(2) };
  }, { seed, scen });
  console.log('pt_ambush', scen, seed, JSON.stringify(found));
  if (found) {
    const n = +(process.env.SHOTS || 6);
    for (let i = 0; i < n; i++) {
      await p.waitForTimeout(1500);
      const st = await p.evaluate(() => {
        const { boat, u } = window.__amb, L = boat.ai.lt;
        __sim.focus((boat.x + u.x) / 2, (boat.z + u.z) / 2, +(window.__ambW || 120), 60);
        const ta = Math.abs(WW.angleDiff(u.heading, Math.atan2(boat.z - u.z, boat.x - u.x))) * 180 / Math.PI;
        return `t ${WW.game.roundTime.toFixed(1)} ${boat.alive ? L.state + (L.ambRun ? ' (ambush run)' : '') : 'lost'} range ${WW.dist(boat.x, boat.z, u.x, u.z).toFixed(0)} target angle ${ta.toFixed(0)} boat speed ${boat.speed.toFixed(1)}`;
      });
      console.log(i, st);
      await p.screenshot({ path: `${out}/pt_ambush_${scen}_${seed}_${i}.png` });
      await p.evaluate(s => __sim.fastForward(s), +(process.env.STEP || 1.5));
    }
  }
  await b.close();
})();
