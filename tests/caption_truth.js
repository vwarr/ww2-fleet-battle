// Attack captions against the truth (render mode): over a few rounds (day, dusk, with and without the island base)
// samples every attack label the camera layer can show and checks it against the plane's real state:
//   finder    WW.camFinder items (the F / Tab labels and the follow label's "in ~25 s" line);
//   title     WW.camStory.titleOf for every squadron plane in the air, with the mission camera_follow.js would give it;
//   caption   WW.airCaptions.lineFor (the director's air captions);
//   F         WW.camFollow.f() every 20 s: its message, about the subject it jumped to (and whether it chose a lone
//             run on the base over a strike about to hit a ship).
// Truth: the weapon (none once released; level bombing for B-17 / Betty level variants and carrier torpedo planes sent
// at the island; a fighter strafing; else the plane's kind), the real target (ship type or the airfield) and whether it
// is still carrying its weapon. Rules: torpedo words on a plane not making a torpedo attack; dive words on a non-dive
// bomber; level words on a non-level bomber; a target named that is not the plane's; attack words on a plane that has
// released / is going home; a strafing fighter called an escort or CAP; "CAP engages X bombers" with the wrong X.
// Prints mismatch counts per rule and source (samples, and distinct labels) and a few examples.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/caption_truth.js [seeds=4,5] [secs=420]
'use strict';
const { chromium } = require('playwright');
const SEEDS = (process.argv[2] || '4,5').split(',').map(Number), SECS = +(process.argv[3] || 420);
const ROUNDS = [['day', 'day', 'none'], ['day-baseUSN', 'day', 'USN'], ['day-baseIJN', 'day', 'IJN'], ['dusk-base', 150, 'USN']];
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGE ' + e.message));
  await p.goto((process.env.BASE_URL || 'http://localhost:8148/') + 'index.html?v=' + Date.now());
  await p.waitForTimeout(2500);
  await p.evaluate(() => {
    window.requestAnimationFrame = () => 0; // the probe steps the sim and the camera itself
    const KIND = { carrier: 'carrier', battleship: 'battleship', cruiser: 'cruiser', destroyer: 'destroyer', submarine: 'submarine', pt: 'PT boat' };
    const tk = t => (!t ? null : t.isBase ? 'airfield' : KIND[t.type] || (t.pt && t.kind ? 'plane' : 'target'));
    const ok = q => q && !q.removed && q.alive;
    const weapon = q => !q.ordnance ? (q.kind === 'fighter' ? (q.strafe ? 'strafe' : 'guns') : 'none')
      : q.level || (q.kind === 'torpedo' && q.target && q.target.isBase) ? 'level' : q.kind;
    const going = q => q.state === 'return' || q.state === 'landing' || q.state === 'rollout' || q.lvPh === 'away';
    const R = window.__R = { counts: {}, labels: {}, ex: {}, samples: 0, fBase: 0, fN: 0 };
    function bad(src, rule, q, text) {
      const k = src + ' ' + rule; R.counts[k] = (R.counts[k] || 0) + 1;
      (R.labels[k] = R.labels[k] || new Set()).add(text);
      (R.ex[k] = R.ex[k] || []).length < 4 && !R.ex[k].some(e => e.text === text) && R.ex[k].push({ text, truth: q.kind + ' w=' + weapon(q) + ' tgt=' + tk(q.target) + ' wave=' + tk(q.wave && q.wave.target) + ' ord=' + !!q.ordnance + ' st=' + q.state + ' ph=' + (q.phase || '') + ' sk=' + (q.sk || '') + ' lv=' + !!q.level });
    }
    // check one label about plane q; wave: the label speaks for q's strike wave (its target)
    function check(src, q, text, wave) {
      R.samples++;
      if (!text) return;
      const w = weapon(q);
      if (/torpedo attack|drops on|begins its run|torpedo run/i.test(text) && w !== 'torpedo') bad(src, 'torpedo-word', q, text);
      if (/push(es)? over|releases on|dive.bombing/i.test(text) && w !== 'dive') bad(src, 'dive-word', q, text);
      if (/level.bombing|bombing run|bomb the|high.level/i.test(text) && w !== 'level' && q.kind !== 'flyingboat') bad(src, 'level-word', q, text);
      const m = text.match(/\b(?:on|reaches|at|closing on) (?:the|a) (carrier|battleship|cruiser|destroyer|submarine|PT boat|airfield|target)\b/);
      if (m) { const real = wave || /escort for/.test(text) ? tk(q.wave ? q.wave.target : q.target) : tk(q.target) || tk(q.wave && q.wave.target); if (real && m[1] !== real) bad(src, 'target', q, text + ' [real ' + real + ']'); }
      if (/strike reaches|drops on|push|releases on|sets up its|begins its run|bombing run|level.bombing|strafes|strafing/i.test(text) && !wave && (going(q) || (w === 'none'))) bad(src, 'spent', q, text);
      if (q.kind === 'fighter' && q.strafe && /escort|CAP/.test(text) && !/strafe|strafing/i.test(text)) bad(src, 'strafe', q, text);
      const c = text.match(/engages (torpedo|dive|level) bombers/);
      if (c && q.foe) { const fw = weapon(q.foe); if (fw !== c[1] && !(fw === 'none')) bad(src, 'cap-foe', q, text + ' [foe ' + fw + ']'); }
    }
    const missionOf = q => (q.kind === 'fighter' && !q.target ? 'cap' : 'strike'); // camera_follow.js jump()
    window.__sample = () => {
      for (const it of WW.camFinder.list()) if (it.subj && it.subj.pt && it.subj.kind && ok(it.subj)) check('finder', it.subj, it.label, it.kind === 'strike');
      for (const q of WW.world.planes) {
        if (ok(q) && q.ordnance && q.kind === 'torpedo' && q.target && q.target.isBase) R.kateBase = (R.kateBase || 0) + 1;
        if (ok(q) && q.ordnance && q.level) R.levelN = (R.levelN || 0) + 1;
        if (!ok(q) || !q.squadron || q.state === 'takeoff' || q.state === 'landing' || q.state === 'rollout' || q.onDeck) continue;
        const ms = WW.camFollow._mission ? WW.camFollow._mission(q) : missionOf(q);
        check('title', q, WW.camStory.titleOf(q, ms).join(' · '));
        const L = WW.airCaptions.lineFor(q); if (L) check('caption', q, L.join(' · '));
      }
    };
    window.__f = () => {
      if (WW.game.state !== 'battle') return;
      if (WW.camFollow.following()) WW.camFollow.handBack();
      const L = WW.camFinder.list();
      const msg = WW.camFollow.f(), s = WW.camFollow.following() || (WW.cam._shot() && WW.cam._shot().subj);
      R.fN++;
      if (s && s.pt && s.kind) {
        check('F', s, msg.replace(/^Follow: /, ''), /strike (reaches|closing)/.test(msg));
        // a run on the base chosen while a strike is 10-45 s from a ship
        const t = s.target || (s.wave && s.wave.target);
        if (t && t.isBase && L.some(i => i.target && !i.target.isBase && i.target.stats && i.kind !== 'bandits' && i.etaReal >= 10 && i.etaReal <= 45)) { R.fBase++; (R.fBaseEx = R.fBaseEx || []).length < 4 && R.fBaseEx.push(msg); }
      }
      WW.camFollow.handBack();
    };
    window.__round = (seed, tod, base) => {
      const G = WW.game;
      if (WW.aces) WW.aces.reset();
      WW.dayNight.force = tod; WW.dayNight.pin = null; WW.dayNight.pinHour = null; WW.weather.force = 'clear';
      WW.terrain.generate(seed); WW.seedRandom(seed); G.seed = seed; WW.time.now = 0;
      G.composition = null; G.mode = 'auto'; G.noRetire = true; G.baseChoice = base; G.startRound({ keepMap: true });
    };
    window.__run = secs => {
      for (let t = 0; t < secs && WW.game.state === 'battle'; t += 1) {
        __sim.fastForward(1); WW.cam.update(1);
        __sample();
        if (t % 20 === 10) __f();
      }
    };
  });
  for (const seed of SEEDS) for (const [name, tod, base] of ROUNDS) {
    await p.evaluate(([s, t, bb]) => __round(s, t, bb), [seed, tod, base]);
    for (let t = 0; t < SECS; t += 60) await p.evaluate(n => __run(n), Math.min(60, SECS - t));
    console.log(`seed ${seed} ${name}: samples ${await p.evaluate(() => __R.samples)}`);
  }
  const R = await p.evaluate(() => ({ counts: __R.counts, labels: Object.fromEntries(Object.entries(__R.labels).map(([k, v]) => [k, v.size])), ex: __R.ex, samples: __R.samples, fBase: __R.fBase, fN: __R.fN, kateBase: __R.kateBase || 0, levelN: __R.levelN || 0, fBaseEx: __R.fBaseEx || [] }));
  let tot = 0, totL = 0;
  console.log('\nmismatches (samples / distinct labels):');
  for (const k of Object.keys(R.counts).sort()) { tot += R.counts[k]; totL += R.labels[k]; console.log(`  ${k.padEnd(24)} ${String(R.counts[k]).padStart(6)} / ${R.labels[k]}`); for (const e of R.ex[k]) console.log(`      "${e.text}"  <- ${e.truth}`); }
  console.log(`TOTAL ${tot} / ${totL} distinct, of ${R.samples} label samples; F chose a base run over a ship strike 10-45 s out: ${R.fBase} of ${R.fN}`, R.fBaseEx);
  console.log(`plane-samples: torpedo planes armed against the base ${R.kateBase}, level bombers armed ${R.levelN}`);
  console.log('errors', errs.length, errs.slice(0, 3));
  await b.close();
})();
