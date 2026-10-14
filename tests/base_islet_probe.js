// Island base: is everything on the airfield's own island? (sim, pure geometry). For each seed and owner, flood-fills
// the land (depthAt < -0.35, the ground people and trucks walk on: base_life_paths.js) from the pad's centre and counts
// the facilities and camp items (base.decor: the motor pool's trucks and jeeps among them) with their centre or a point
// of their footprint off that connected land: on an islet, the reef or a second island. The coastal batteries count by
// their centre (shorePoints() puts them on the shore); the seaplane ramp is reported apart (its boats come by water).
// Usage: node tests/base_islet_probe.js [seeds=24] [seed0=1] [--verbose] [--browser]
'use strict';
const HL = require('./headless');
const args = HL.argv.filter(a => !a.startsWith('--')), VERB = HL.argv.includes('--verbose');
const N = +(args[0] || 24), S0 = +(args[1] || 1);
(async () => {
  const b = await HL.launch(), p = await b.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(HL.url()); await p.waitForFunction(() => window.__sim && window.WW && WW.game);
  const out = await p.evaluate(([n, s0]) => {
    const res = [];
    for (let seed = s0; seed < s0 + n; seed++) for (const owner of ['USN', 'IJN']) {
      WW.terrain.generate(seed); WW.seedRandom(seed);
      const base = WW.islandBase.build(owner); if (!base) continue;
      const S = base.site, R = 230, W = 2 * R + 1, id = (x, z) => Math.round(z - S.z + R) * W + Math.round(x - S.x + R);
      const land = (x, z) => WW.terrain.depthAt(x, z) < -0.35, seen = new Uint8Array(W * W);
      const q = [id(S.x, S.z)]; seen[q[0]] = 1;
      for (let h = 0; h < q.length; h++) {
        const c = q[h], i = c % W, j = (c - i) / W;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, bb = j + dj; if (a < 0 || bb < 0 || a >= W || bb >= W) continue;
          const k = bb * W + a; if (seen[k] || !land(S.x - R + a, S.z - R + bb)) continue;
          seen[k] = 1; q.push(k);
        }
      }
      const on = (x, z) => { const i = Math.round(x - S.x + R), j = Math.round(z - S.z + R); return i >= 0 && j >= 0 && i < W && j < W && seen[j * W + i] === 1; };
      const off = (it, r) => { if (!on(it.x, it.z)) return 'centre'; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (!on(it.x + Math.cos(a) * r, it.z + Math.sin(a) * r)) return 'edge'; } return null; };
      const bad = [];
      for (const f of base.facilities) { if (f.kind === 'ramp') continue; const w = off(f, f.kind === 'battery' ? 0 : (f.r || 2) * 0.7); if (w) bad.push(f.kind + ':' + w + '@' + Math.round(f.x) + ',' + Math.round(f.z)); }
      for (const d of base.decor || []) { const w = off(d, Math.min(d.hx, d.hz)); if (w) bad.push(d.kind + ':' + w + '@' + Math.round(d.x) + ',' + Math.round(d.z)); }
      const ramp = base.facilities.find(f => f.kind === 'ramp'), rampOff = ramp ? (off(ramp, 2) ? 1 : 0) : -1;   // -1: no ramp
      const veh = (base.decor || []).filter(d => d.kind === 'truck' || d.kind === 'jeep' || d.kind === 'fire');
      const vehBad = veh.filter(d => !on(d.x, d.z)).length;
      const crashHome = base.facilities.filter(f => (f.kind === 'tower' || f.kind === 'hangar' || f.kind === 'fuel' || f.kind === 'ammo') && !on(f.x, f.z)).length;
      res.push({ seed, owner, kind: S.kind, facs: base.facilities.length, decor: (base.decor || []).length, veh: veh.length, bad: bad.length, vehBad, crashHome, rampOff,
        list: bad, counts: base.facilities.reduce((o, f) => (o[f.kind] = (o[f.kind] || 0) + 1, o), {}) });
    }
    return res;
  }, [N, S0]);
  let tot = 0, seeds = 0, vb = 0, ro = 0, rn = 0, fk = {};
  for (const r of out) {
    tot += r.bad; vb += r.vehBad + r.crashHome; if (r.bad) seeds++; if (r.rampOff > 0) ro++; if (r.rampOff < 0) rn++;
    for (const k in r.counts) fk[k] = (fk[k] || 0) + r.counts[k];
    console.log(`seed ${r.seed} ${r.owner} ${r.kind}: facs ${r.facs} decor ${r.decor} veh ${r.veh} | off-island ${r.bad} (vehicles ${r.vehBad}, vehicle homes ${r.crashHome})${r.rampOff < 0 ? ' no ramp' : r.rampOff ? ' ramp across the water' : ''}` +
      (r.bad && (VERB || r.bad < 12) ? '  ' + r.list.join(' ') : '') + (VERB ? '  ' + JSON.stringify(r.counts) : ''));
  }
  console.log(`TOTAL off-island items ${tot} over ${seeds} / ${out.length} bases; vehicles + vehicle homes off-island ${vb}`);
  console.log(`seaplane ramp across the water (not counted) ${ro}, no ramp ${rn}; facilities ${JSON.stringify(fk)}; camp items ${out.reduce((s, r) => s + r.decor, 0)}, motor pools ${out.filter(r => r.veh).length}`);
  if (errs.length) console.log('errors', errs.slice(0, 5));
  await b.close();
})().catch(e => { console.error(e); process.exit(2); });
