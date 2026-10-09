// Island base clipping check (render mode, fake frame clock, nothing drawn): everything on and over the airfield is
// measured as footprints in the ground plane, every SAMPLE sim s, over many seeds. Zero overlaps tolerated.
// Usage: BASE_URL=http://localhost:PORT/ CHROMIUM=<headless shell> node tests/base_clip.js [rounds=8] [seed0=1] [--workers K] [--secs S]
//   Bodies: planes on the ground (sim planes taxiing / rolling / parked in slots / ground wrecks) as two rectangles
//   (fuselage len x 0.16 len, wing 0.3 len x span), base vehicles (fuel truck, bomb cart, crash truck, roller) and
//   ground-crew figures (base_ground_fx.js trace), facilities (the models' own footprints), revetment berms
//   (WW.baseModels.revetWalls), terrain and palms.
// Checks (FAIL if not 0):
//   plane_plane    two ground planes overlapping (a parked one too)
//   plane_veh      a vehicle through a plane on the ground
//   plane_fig      a ground-crew figure inside a plane's footprint (its wing or fuselage)
//   plane_fac      a ground plane overlapping a building, tank, pit or gun
//   plane_berm     a ground plane through a revetment berm (its own or another's)
//   plane_hill     a ground plane's wheels below the terrain (taxiing into a hill)
//   air_hill       a base plane in the air (take-off, circuit, final) below the terrain / a palm / a building
//   veh_fac        a vehicle inside a building or a tank
//   veh_berm       a vehicle through a revetment berm
//   fig_fac        a figure inside a solid building (huts, tents, the mess, tanks, towers; pits, trenches and the
//                  laundry line are walked into)
//   fig_veh        a figure inside a vehicle's footprint (a truck driving through people)
//   veh_veh        two vehicles overlapping
// Info: samples, max ground planes, vehicles, figures; the first examples of each.
'use strict';
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const pos = []; for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) { i++; continue; } pos.push(args[i]); }
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? +args[i + 1] : d; };
const ROUNDS = +(pos[0] || 8), SEED0 = +(pos[1] || 1), WORKERS = Math.min(4, opt('workers', 4)), SECS = opt('secs', 300), SAMPLE = 0.25, FORCE_T = 80;

function install() {
  window.__raf = []; window.__fakeT = 0;
  window.requestAnimationFrame = cb => { __raf.push(cb); return __raf.length; };
  window.__step = n => { for (let i = 0; i < n; i++) { __fakeT += 1000 / 30; const cbs = __raf.splice(0); cbs.forEach(cb => cb(__fakeT)); } };
}
function setup() {
  WW.post.render = () => {};
  const t0 = performance.now(); performance.now = () => t0 + __fakeT;
  __step(3);
  // ---- 2D oriented boxes: { x, z, c, s, hu, hv } (centre, heading cos / sin, half length / half width) ----
  window.__box = (x, z, h, l, w, off) => { const c = Math.cos(h), s = Math.sin(h); off = off || 0; return { x: x + c * off, z: z + s * off, c, s, hu: l / 2, hv: w / 2 }; };
  window.__sat = (A, B, eps) => { // overlap depth > eps along every separating axis
    const ax = [[A.c, A.s], [-A.s, A.c], [B.c, B.s], [-B.s, B.c]], dx = B.x - A.x, dz = B.z - A.z;
    for (const [ux, uz] of ax) {
      const ra = A.hu * Math.abs(A.c * ux + A.s * uz) + A.hv * Math.abs(-A.s * ux + A.c * uz);
      const rb = B.hu * Math.abs(B.c * ux + B.s * uz) + B.hv * Math.abs(-B.s * ux + B.c * uz);
      if (Math.abs(dx * ux + dz * uz) > ra + rb - eps) return false;
    }
    return true;
  };
  window.__planeBoxes = (x, z, h, C) => [__box(x, z, h, C.len, C.len * 0.16, 0), __box(x, z, h, C.len * 0.3, C.span, C.len * 0.05)];
}

function round(P) {
  const G = WW.game, I = WW.islandBase, AL = WW.airfieldLayout, LG = WW.landGround, VAR = WW.landAir.VAR, PK = WW.cfg.PLANE_K || 1;
  WW.terrain.generate(P.seed); WW.seedRandom(P.seed); G.seed = P.seed;
  const comp = G.randomComposition();
  if (WW.aces) WW.aces.reset();
  WW.seedRandom(P.seed * 7919 + 1); WW.time.now = 0;
  if (WW.dayNight) WW.dayNight.force = 'day';
  G.baseChoice = P.owner; G.composition = comp; G.mode = 'auto'; G.startRound({ keepMap: true }); G.composition = null; G.baseChoice = null;
  __sim.setScale(1);
  const b = I.base, L = b.layout, tr = WW.baseGroundFx._trace(true);
  WW.cam.update = function () { WW.camera.position.set(b.x, 40, b.z + 30); WW.camera.lookAt(b.x, 0, b.z); WW.camera.updateMatrixWorld(); };
  const R = { seed: P.seed, owner: P.owner, samples: 0, maxGround: 0, maxVeh: 0, maxFig: 0, ex: {} };
  const CK = ['plane_plane', 'plane_veh', 'plane_fig', 'plane_fac', 'plane_berm', 'plane_hill', 'air_hill', 'veh_fac', 'veh_berm', 'fig_fac', 'fig_veh', 'veh_veh'];
  for (const k of CK) R[k] = 0;
  const hit = (k, msg) => { R[k]++; const e = R.ex[k] = R.ex[k] || []; if (e.length < 3) e.push(msg + ' t' + G.roundTime.toFixed(0)); };
  const CLS = v => AL.CLS[(VAR[v] && VAR[v].cls) || 'S'];
  const gear = v => (VAR[v] && VAR[v].gear) || WW.air._pool.deckY;
  const ground = (x, z) => Math.max(b.site.padH, -WW.terrain.depthAt(x, z));
  // static bodies: facilities (model footprints), berms, palms
  const built = WW.baseFx._built(), facs = [];
  const SOFT = { aa: 1, battery: 1, mg: 1, trench: 1, laundry: 1, light: 1 };   // walked into (pits, trenches) or under (the line)
  if (built) for (const part of built.parts) {
    const m = part.mesh; if (!m || (part.decor && WW.baseLifeCars && WW.baseLifeCars.cars.some(c => c.d === part.f))) continue;   // the drill ground: open grass; the camp's trucks are vehicles (below)
    const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox, h = -m.rotation.y, c = Math.cos(h), s = Math.sin(h), k = m.scale.x, cx = (bb.min.x + bb.max.x) / 2 * k, cz = (bb.min.z + bb.max.z) / 2 * k;
    facs.push({ k: part.f.kind, f: part.f, decor: !!part.decor, solid: !SOFT[part.f.kind], top: m.position.y + bb.max.y * m.scale.y,
      box: { x: m.position.x + c * cx - s * cz, z: m.position.z + s * cx + c * cz, c, s, hu: (bb.max.x - bb.min.x) / 2 * k, hv: (bb.max.z - bb.min.z) / 2 * k } });
  }
  const berms = [];
  for (const sp of L.spots) for (const w of WW.baseModels.revetWalls(sp)) {
    const c = Math.cos(sp.h), s = Math.sin(sp.h);
    berms.push({ sp, box: { x: sp.x + c * w[0] - s * w[1], z: sp.z + s * w[0] + c * w[1], c: Math.cos(sp.h - w[4]), s: Math.sin(sp.h - w[4]), hu: w[2] / 2, hv: w[3] / 2 } });
  }
  const palms = [], pg = WW.terrain._props && WW.terrain._props();
  if (pg) for (const g of pg.children) if (WW.dist(g.position.x, g.position.z, b.x, b.z) < 160) { const bx = new THREE.Box3().setFromObject(g); palms.push({ x: g.position.x, z: g.position.z, top: bx.max.y, r: Math.max(bx.max.x - bx.min.x, bx.max.z - bx.min.z) / 2 }); }
  const VD = { fuel: [2.4, 1.05], bombs: [2.4, 0.95], crash: [2.3, 1.05], roller: [2.0, 0.95], truck: [2.4, 1.05], jeep: [1.8, 0.95] }, VK = WW.baseModels.VEH_K || 1;
  let forced = false;
  while (G.state === 'battle' && G.roundTime < P.SECS) {
    __sim.fastForward(P.SAMPLE - 1 / 30); __step(1);
    if (!forced && G.roundTime >= P.FORCE_T) { // two bombs on the main runway: a closure, a repair gang and the roller
      forced = true; const rw = b.runways[0], en = WW.enemyOf(b.nation);
      I.impact(en, rw.x + rw.c * 10, rw.z + rw.s * 10, 180, 'bomb'); I.impact(en, rw.x - rw.c * 12, rw.z - rw.s * 12, 180, 'bomb');
    }
    R.samples++;
    // ground planes
    const gp = [];
    for (const s of b.slots) if (s.spot && (s.state === 'parked' || s.state === 'rearm' || s.state === 'wreck')) gp.push({ k: 'slot' + s.i + '/' + s.v, v: s.v, x: s.x, z: s.z, h: s.h, slot: s, y: null });
    for (const w of b.wrecks || []) gp.push({ k: 'wreck/' + w.v, v: w.v, x: w.x, z: w.z, h: w.h, y: null });
    for (const p of WW.world.planes) {
      if (p.carrier !== b || !p.alive || p.removed) continue;
      if (LG.onGround(p)) { gp.push({ k: (p.rwPh || p.state) + '/' + p.variant + '#' + p.gid, v: p.variant, x: p.x, z: p.z, h: p.heading, slot: p.slot, y: p.y, p }); continue; }
      // in the air over the island: wheels above the ground, the palms and the buildings
      if (WW.dist(p.x, p.z, b.x, b.z) > 150 || p.y > 30) continue;
      const bot = p.y - gear(p.variant), gh = -WW.terrain.depthAt(p.x, p.z);
      if (gh > 0 && bot < gh - 0.05) hit('air_hill', 'terrain ' + (p.rwPh || p.state) + '/' + p.variant + ' y' + p.y.toFixed(2) + ' ground ' + gh.toFixed(2));
      for (const t of palms) if (Math.hypot(t.x - p.x, t.z - p.z) < t.r + CLS(p.variant).span * 0.4 && bot < t.top) { hit('air_hill', 'palm ' + (p.rwPh || p.state) + '/' + p.variant + ' y' + p.y.toFixed(2) + ' top ' + t.top.toFixed(2)); break; }
      const pb = __planeBoxes(p.x, p.z, p.heading, CLS(p.variant));
      for (const f of facs) if (bot < f.top && (__sat(pb[0], f.box, 0.05) || __sat(pb[1], f.box, 0.05))) { hit('air_hill', 'fac ' + f.k + ' ' + (p.rwPh || p.state) + '/' + p.variant + ' y' + p.y.toFixed(2)); break; }
    }
    for (const q of gp) q.b = __planeBoxes(q.x, q.z, q.h, CLS(q.v));
    R.maxGround = Math.max(R.maxGround, gp.length);
    const ov = (A, B, e) => __sat(A[0], B[0], e) || __sat(A[0], B[1], e) || __sat(A[1], B[0], e) || __sat(A[1], B[1], e);
    for (let i = 0; i < gp.length; i++) for (let j = i + 1; j < gp.length; j++) {
      const a = gp[i], c = gp[j];
      if ((a.p && a.p.slot === c.slot && c.slot) || (c.p && c.p.slot === a.slot && a.slot)) continue; // a plane and its own slot entry
      if (ov(a.b, c.b, 0.05)) { const qa = L.toL(a.x, a.z), qc = L.toL(c.x, c.z); hit('plane_plane', a.k + ' @' + qa.u.toFixed(1) + ',' + qa.v.toFixed(1) + ' ~ ' + c.k + ' @' + qc.u.toFixed(1) + ',' + qc.v.toFixed(1)); }
    }
    for (const q of gp) {
      for (const f of facs) if (__sat(q.b[0], f.box, 0.05) || __sat(q.b[1], f.box, 0.05)) { hit('plane_fac', q.k + ' ~ ' + f.k); break; }
      for (const w of berms) if (__sat(q.b[0], w.box, 0.05) || __sat(q.b[1], w.box, 0.05)) { const qq = L.toL(q.x, q.z); hit('plane_berm', q.k + ' @' + qq.u.toFixed(1) + ',' + qq.v.toFixed(1) + (w.sp === (q.slot && q.slot.spot) ? ' own' : ' spot' + w.sp.i)); break; }
      if (q.y !== null) { // wheels vs the terrain under the fuselage ends and the wingtips
        const C = CLS(q.v), c = Math.cos(q.h), s = Math.sin(q.h), bot = q.y - gear(q.v);
        for (const [u, v] of [[C.len / 2, 0], [-C.len / 2, 0], [0, C.span / 2], [0, -C.span / 2]]) {
          const gh = ground(q.x + c * u - s * v, q.z + s * u + c * v);
          if (gh > bot + 0.15) { hit('plane_hill', q.k + ' bot ' + bot.toFixed(2) + ' ground ' + gh.toFixed(2)); break; }
        }
      }
    }
    // vehicles and figures (base_ground_fx.js, drawn this frame)
    R.maxVeh = Math.max(R.maxVeh, tr.veh.length); R.maxFig = Math.max(R.maxFig, tr.figs.length);
    const camp = WW.baseLifeCars ? WW.baseLifeCars.cars.filter(c => !c.away && !c.d.out).map(c => ({ kind: c.kind === 'fire' ? 'crash' : c.kind, x: c.x, z: c.z, h: c.h, parked: c.d })) : [];
    const vall = tr.veh.concat(camp);   // the camp's trucks parked in the motor pool too
    for (const v of vall) {
      const d = VD[v.kind] || [2.4, 1], vb = __box(v.x, v.z, v.h, d[0] * VK, d[1] * VK, 0);
      for (const q of gp) if (__sat(vb, q.b[0], 0.05) || __sat(vb, q.b[1], 0.05)) { const qq = L.toL(q.x, q.z); hit('plane_veh', v.kind + ' @' + L.toL(v.x, v.z).u.toFixed(1) + ',' + L.toL(v.x, v.z).v.toFixed(1) + ' ~ ' + q.k + ' @' + qq.u.toFixed(1) + ',' + qq.v.toFixed(1)); break; }
      for (const f of facs) if (!(v.parked && v.parked === f.f) && __sat(vb, f.box, 0.05)) { hit('veh_fac', v.kind + ' h' + v.h.toFixed(2) + ' d' + Math.hypot(v.x - f.box.x, v.z - f.box.z).toFixed(2) + ' ~ ' + f.k + ' ' + (f.box.hu * 2).toFixed(1) + 'x' + (f.box.hv * 2).toFixed(1) + (v.t ? ' trip p0 ' + Math.hypot(v.t.p0.x - f.box.x, v.t.p0.z - f.box.z).toFixed(2) + ' n' + v.t.n + ' out ' + v.t.out.toFixed(1) + '/' + v.t.len.toFixed(1) : '')); break; }
      const vq = L.toL(v.x, v.z); let vs = v.kind + ' @' + vq.u.toFixed(1) + ',' + vq.v.toFixed(1);
      if (v.t) vs += ' trip n' + v.t.n + ' p0 ' + L.toL(v.t.p0.x, v.t.p0.z).u.toFixed(1) + ',' + L.toL(v.t.p0.x, v.t.p0.z).v.toFixed(1) + ' out ' + v.t.out.toFixed(1);
      for (const w of berms) if (__sat(vb, w.box, 0.05)) { hit('veh_berm', vs + ' ~ spot' + w.sp.i + ' @' + w.sp.u.toFixed(1) + ',' + w.sp.v.toFixed(1) + ' lane ' + w.sp.laneV.toFixed(1) + ' col ' + w.sp.col + ' ' + w.sp.cls); break; }
    }
    const FR = 0.12 * (WW.crew ? WW.crew.SCALE : 1) * 2;
    const vbs = vall.map(v => { const d = VD[v.kind] || [2.4, 1]; return { v, b: __box(v.x, v.z, v.h, d[0] * VK, d[1] * VK, 0) }; });
    for (let i = 0; i < vbs.length; i++) for (let j = i + 1; j < vbs.length; j++) if (__sat(vbs[i].b, vbs[j].b, 0.05)) hit('veh_veh', vbs[i].v.kind + (vbs[i].v.parked ? '(camp)' : vbs[i].v.t ? '(trip ' + vbs[i].v.t.out.toFixed(1) + '/' + vbs[i].v.t.len.toFixed(1) + ')' : '') + ' ~ ' + vbs[j].v.kind + (vbs[j].v.parked ? '(camp)' : vbs[j].v.t ? '(trip ' + vbs[j].v.t.out.toFixed(1) + '/' + vbs[j].v.t.len.toFixed(1) + ')' : '') + ' @' + L.toL(vbs[i].v.x, vbs[i].v.z).u.toFixed(1) + ',' + L.toL(vbs[i].v.x, vbs[i].v.z).v.toFixed(1));
    for (const f of tr.figs) {
      const fb = __box(f.x, f.z, 0, FR, FR, 0);
      for (const q of gp) if (__sat(fb, q.b[0], 0.02) || __sat(fb, q.b[1], 0.02)) { const c = Math.cos(q.h), s = Math.sin(q.h), dx = f.x - q.x, dz = f.z - q.z; hit('plane_fig', f.role + (f.act ? '/' + f.act : '') + ' ~ ' + q.k + ' a' + (dx * c + dz * s).toFixed(2) + ' b' + (-dx * s + dz * c).toFixed(2) + ' len' + CLS(q.v).len.toFixed(2) + ' span' + CLS(q.v).span.toFixed(2)); break; }
      for (const g of facs) if (g.solid && __sat(fb, g.box, 0.02)) { const fq = L.toL(f.x, f.z); hit('fig_fac', f.role + (f.act ? '/' + f.act : '') + ' ~ ' + g.k + ' @' + fq.u.toFixed(1) + ',' + fq.v.toFixed(1)); break; }
      if (!f.ride) for (const q of vbs) if (__sat(fb, q.b, 0.02)) { hit('fig_veh', f.role + (f.act ? '/' + f.act : '') + ' ~ ' + q.v.kind); break; }
    }
  }
  WW.baseGroundFx._trace(false);
  return R;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const pages = [];
  for (let k = 0; k < Math.min(WORKERS, ROUNDS); k++) {
    const p = await b.newPage({ viewport: { width: 320, height: 200 } }), errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.addInitScript(install);
    await p.goto((process.env.BASE_URL || 'http://localhost:8790/') + 'index.html?auto&v=' + Date.now());
    await p.waitForFunction(() => window.__sim && window.WW && WW.game && WW.baseFx);
    await p.waitForTimeout(800);
    await p.evaluate(setup);
    p.errs = errs; pages.push(p);
  }
  const specs = []; for (let i = 0; i < ROUNDS; i++) specs.push({ seed: SEED0 + i, owner: (SEED0 + i) % 2 ? 'USN' : 'IJN', SECS, SAMPLE, FORCE_T });
  const out = new Array(specs.length); let next = 0;
  await Promise.all(pages.map(async pg => { while (next < specs.length) { const i = next++; out[i] = await pg.evaluate(`(${round.toString()})(${JSON.stringify(specs[i])})`); } }));
  const CK = ['plane_plane', 'plane_veh', 'plane_fig', 'plane_fac', 'plane_berm', 'plane_hill', 'air_hill', 'veh_fac', 'veh_berm', 'fig_fac', 'fig_veh', 'veh_veh'];
  for (const r of out) {
    console.log(`seed ${r.seed} ${r.owner}: samples ${r.samples} ground<=${r.maxGround} veh<=${r.maxVeh} figs<=${r.maxFig}  ` + CK.map(k => k + ' ' + r[k]).join('  '));
    for (const k in r.ex) console.log('   ' + k + ': ' + r.ex[k].join(' | '));
  }
  let fails = 0;
  console.log('\n=== base clipping (' + ROUNDS + ' rounds, ' + SECS + ' s) ===');
  for (const k of CK) { const v = out.reduce((s, r) => s + r[k], 0); if (v) fails++; console.log(`  ${k.padEnd(12)} ${v}  ${v ? 'FAIL' : 'PASS'}`); }
  const errs = pages.flatMap(p => p.errs);
  if (errs.length) { console.log('page errors:', errs.slice(0, 5)); fails++; }
  await b.close();
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
