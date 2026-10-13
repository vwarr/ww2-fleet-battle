// The island base's reaction on its patrol boat's report, as the director films it (render mode, tests/camera_audit.js's
// fake 30 fps frame clock and per-second recorder). Per round: the boats' sightings (whose boat, ramp or edge), the
// alarm (kind, by), the scrambles and the base strikes, the base captions, and a per-second timeline from the first
// sighting on: the shot (kind / story mood / phase), its subject class, the camera's distance from the field and whether
// the field is in frame. Ends with a summary: did the camera show the field within 30 s of the alarm, and for how long.
// Usage: BASE_URL=http://localhost:8133/ CHROMIUM=... node tests/base_alarm_probe.js [--scen midway] [--seeds 1,2,3]
//        [--workers 2] [--after 60] [--sim 420] [--quiet] [--shots: frames every 2 s from the alarm in tests/shots/base_alarm/]
'use strict';
const { chromium } = require('playwright');
const CA = require('./camera_audit');
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SCENS = arg('--scen', 'midway').split(','), SEEDS = arg('--seeds', '1,2,3').split(',').map(Number);
const WORKERS = +arg('--workers', 2), AFTER = +arg('--after', 60), SIM = +arg('--sim', 420), QUIET = args.includes('--quiet'), SHOTS = args.includes('--shots');
const fs = require('fs'), path = require('path');

function hooks() {
  const A = window.__audit, P = window.__bap = { ev: [], sec: [] }, wall = () => performance.now() / 1000;
  const b = () => WW.islandBase && WW.islandBase.base;
  const shot = () => { const s = WW.cam._shot(); if (!s) return '-'; const d = WW.camStory._dbg() || {}; return (s.story ? 'story/' + (s.sk || '') + '/' + (d.phase || '') : s.kind + (s.sk ? '/' + s.sk : '')) + (s.alarm ? '[ALARM]' : '') + (s.beat ? '[' + s.beat + ']' : ''); };
  const E = (k, o) => P.ev.push(Object.assign({ k, w: +wall().toFixed(1), sim: +WW.game.roundTime.toFixed(1), shot: shot() }, o || {}));
  WW.on('flyingBoat', e => { if (e && e.order === 'sighting') { const B = b(); E('sighting', { n: e.nation, own: !!(B && B.nation === e.nation), boat: e.plane ? (e.plane.ramp ? 'ramp' : 'edge') + ' ' + e.plane.state : '?', cv: e.carriers, planes: e.planes, d: B ? Math.round(WW.dist(B.x, B.z, e.x, e.z)) : null, alarmed: !!(B && B.alarm) }); } });
  WW.on('baseAlarm', e => E('ALARM', { kind: e.kind, by: b() && b().alarm ? b().alarm.by : null }));
  WW.on('baseEvent', e => { if (e && e.kind !== 'alarm') E('base:' + e.kind, e.target ? { tgt: e.target.type } : null); });
  WW.on('contact', e => { if (e && e.first && !P.ev.some(x => x.k === 'contact' && x.n === e.nation)) E('contact', { n: e.nation, by: e.by ? (e.by.kind || e.by.type || '?') : '?' }); });
  const uc = WW.ui.caption;
  WW.ui.caption = function (a, c) { E('caption', { t: (a || '') + (c ? ' | ' + c : '') }); return uc.apply(this, arguments); };
  const ar = WW.cam.afterRender; let fr = 0;
  WW.cam.afterRender = function () {
    ar.call(this);
    if (++fr % 30 || WW.game.state !== 'battle') return;
    const B = b(), c = WW.camera; let d = null, inF = false, run = 0, up = 0;
    if (B) {
      d = Math.round(Math.hypot(c.position.x - B.x, c.position.z - B.z));
      // the field in frame: the base's centre, its camp or one of its planes on the ground, within 250 of the camera
      const v = new THREE.Vector3(), seen = (x, y, z) => { v.set(x, y, z).project(c); return v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && Math.hypot(c.position.x - x, c.position.z - z) < 250; };
      const C = (B.decor || []).filter(q => q.kind === 'hut' || q.kind === 'tent' || q.kind === 'mess');
      inF = seen(B.x, 2, B.z) || (C.length && seen(C.reduce((s, q) => s + q.x, 0) / C.length, 2, C.reduce((s, q) => s + q.z, 0) / C.length));
      for (const p of WW.world.planes) if (p.alive && p.carrier === B) { if (p.y < 6) { run++; if (!inF && seen(p.x, p.y, p.z)) inF = true; } else up++; }
    }
    P.sec.push({ w: Math.round(wall()), sim: Math.round(WW.game.roundTime), shot: shot(), d, inF, low: run, up, al: !!(B && B.alarm) });
  };
}

async function round(b, spec) {
  const { p, errs } = await CA.openRound(b, spec);
  await p.evaluate(hooks);
  let t0 = null, shotN = 0;
  const dir = SHOTS ? path.join(__dirname, 'shots', 'base_alarm', spec.name + '_' + spec.seed) : null;
  if (dir) fs.mkdirSync(dir, { recursive: true });
  for (;;) {
    if (dir) { // from the alarm on: a frame every 2 s for 40 s (the camera_audit sheet way: render only the frame shot)
      const a = await p.evaluate(() => { const e = window.__bap.ev.find(x => x.k === 'ALARM'); return e ? e.w : null; });
      if (a !== null) {
        for (let k = 0; k < 20 && (await p.evaluate(() => WW.game.state)) === 'battle'; k++) {
          const info = await p.evaluate(() => { __render = false; __step(59); __render = true; __step(1); const fd = document.getElementById('fade'); if (fd) fd.style.opacity = '0'; const s = window.__bap.sec.slice(-1)[0] || {}, cap = document.querySelector('.caption.on'); return { w: s.w, shot: s.shot, cap: cap ? cap.textContent.trim().slice(0, 90) : '' }; });
          const f = path.join(dir, 'f_' + String(shotN++).padStart(2, '0') + '.png');
          await p.screenshot({ path: f, timeout: 400000 });
          console.log(`  shot ${f} | ${info.w}s ${info.shot} | ${info.cap}`);
        }
        break;
      }
    }
    const r = await p.evaluate(() => { __step(150); const s = window.__bap.ev.find(e => e.k === 'sighting'); return { t: WW.game.state === 'battle' ? WW.game.roundTime : -1, s: s ? s.sim : null }; });
    if (r.t < 0 || r.t > SIM) break;
    if (r.s !== null && t0 === null) t0 = r.s;
    if (t0 !== null && r.t > t0 + AFTER) break;
  }
  const R = await p.evaluate(() => ({ ev: window.__bap.ev, sec: window.__bap.sec, base: WW.islandBase.base ? WW.islandBase.base.nation : null }));
  await p.close();
  R.errs = errs; R.spec = spec; return R;
}

function show(R) {
  const { ev, sec, spec } = R, out = [];
  const al = ev.find(e => e.k === 'ALARM'), s1 = ev.find(e => e.k === 'sighting');
  out.push(`== ${spec.name}/${spec.seed} base ${R.base} | first sighting ${s1 ? s1.sim + 's ' + s1.n + ' ' + s1.boat + (s1.own ? ' (own)' : ' (OTHER side)') + ' cv ' + s1.cv + ' d ' + s1.d + (s1.alarmed ? ' ALREADY ALARMED' : '') : 'none'} | alarm ${al ? al.sim + 's ' + al.kind + ' by ' + al.by + ' shot ' + al.shot : 'none'}`);
  for (const e of ev) if (e.k !== 'caption' || /Midway|Wake|PBY|Catalina|Mavis|alarm|siren|scramble|base|field|island|air raid/i.test(e.t)) out.push(`   ev ${String(e.sim).padStart(6)} w${e.w} ${e.k} ${JSON.stringify(Object.assign({}, e, { k: undefined, w: undefined, sim: undefined }))}`);
  const from = Math.min(s1 ? s1.w : 1e9, al ? al.w : 1e9) - 3;
  if (!QUIET && from < 1e8) for (const s of sec) if (s.w >= from && s.w <= from + AFTER + 5) out.push(`   ${String(s.w).padStart(4)} sim ${String(s.sim).padStart(4)} ${s.al ? 'AL' : '  '} ${s.shot.padEnd(34)} d ${String(s.d).padStart(5)} ${s.inF ? 'FIELD' : '     '} low ${s.low} up ${s.up}`);
  // the field on screen within 30 s of the alarm
  let onF = 0, first = null;
  if (al) for (const s of sec) if (s.w >= al.w && s.w < al.w + 30 && s.inF) { onF++; if (first === null) first = s.w - Math.round(al.w); }
  out.push(`   SUMMARY alarm->field on screen: ${al ? onF + ' s of 30, first at +' + first : 'no alarm'}`);
  if (R.errs.length) out.push('   ERRORS ' + R.errs.slice(0, 3).join(' | '));
  console.log(out.join('\n'));
  return { onF, first, alarm: al ? al.kind : 'none', by: al ? al.by : null };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const jobs = []; for (const sc of SCENS) for (const sd of SEEDS) jobs.push(CA.specOf(sc, sd));
  let next = 0; const res = [];
  await Promise.all([...Array(Math.min(WORKERS, jobs.length)).keys()].map(async () => { while (next < jobs.length) { const j = jobs[next++]; try { res.push(Object.assign({ j }, show(await round(b, j)))); } catch (e) { console.log(`${j.name}/${j.seed} FAILED ${e.message}`); } } }));
  await b.close();
  console.log('\nTOTAL ' + res.map(r => `${r.j.name}/${r.j.seed}: ${r.alarm}${r.by ? '(' + r.by + ')' : ''} field ${r.onF}s first +${r.first}`).join('; '));
})().catch(e => { console.error(e); process.exit(1); });
