// Ship classes probe (Node, sim-only): builds every 1942 class (ship_classes.js) and prints its true size, model
// extents, turret count vs guns, merged draw calls, deck API (carriers), and the class stats vs the type baseline.
// Also spawns a few seeded rounds and prints the classes / names picked. Exit 1 on a model error or mismatch.
// Usage: node tests/class_probe.js [rounds=3]
'use strict';
const { boot } = require('./node_env');
const out = console.log.bind(console);
boot({ query: 'sim', consoleError: m => { errs.push(m); process.stderr.write('console.error: ' + m + '\n'); } });
const errs = [];
const WW = globalThis.WW, THREE = globalThis.THREE;
let bad = 0;
const U = WW.cfg.U_PER_M;
out(`L = ${WW.cfg.L} u (carrier hull), 1 u = ${(1 / U).toFixed(2)} m, PLANE_SCALE ${WW.cfg.PLANE_SCALE} (true ${WW.cfg.PLANE_SCALE_TRUE}), DECK_K ${WW.cfg.DECK_K.toFixed(2)}`);
out('class            type        nat  len u (m)    beam u  model x/z/y extent    turrets  meshes  hp    speed  turn   guns');
for (const k in WW.SHIP_CLASSES) {
  const c = WW.SHIP_CLASSES[k];
  let m;
  try { m = WW.models.buildShip(c.type, c.nation, k); } catch (e) { out(k, 'BUILD ERROR', e.stack); bad++; continue; }
  const b = new THREE.Box3().setFromObject(m.group), sz = b.getSize(new THREE.Vector3());
  let meshes = 0; m.group.traverse(o => { if (o.isMesh) meshes++; });
  const base = WW.shipType(c.type, c.nation), st = WW.classStats(base, c);
  const nG = st.guns.reduce((a, g) => a + g.count, 0);
  if (nG !== m.turrets.length) { bad++; out('  TURRET MISMATCH', k, nG, m.turrets.length); }
  out(`${k.padEnd(16)} ${c.type.padEnd(11)} ${c.nation}  ${c.len.toFixed(1).padStart(5)} (${c.lenM})`.padEnd(46) +
    `${c.beam.toFixed(2).padStart(5)}  ${sz.x.toFixed(1)}/${sz.z.toFixed(1)}/${sz.y.toFixed(1)}`.padEnd(30) +
    `${String(m.turrets.length).padStart(4)}  ${String(meshes).padStart(6)}  ${String(st.hp).padStart(5)} ${st.speed.toFixed(2).padStart(6)} ${st.turn.toFixed(2).padStart(5)}  ` +
    st.guns.map(g => `${g.count}x${g.cal}/${g.reload}`).join(' '));
  if (m.deckDims) { const d = m.deckDims; out(`    deck ${d.len.toFixed(1)} x ${d.w.toFixed(2)} top ${d.top.toFixed(2)} island ${d.islandSide > 0 ? 'stbd' : 'port'} [${d.island.map(v => v.toFixed(1))}] stern ${d.stern.toFixed(1)} bow ${d.bow.toFixed(1)} td ${d.tdX.toFixed(1)} elev ${d.elevX.toFixed(1)} lane ${d.lane.toFixed(2)}`); }
  const parts = WW.models.parts(k, c.nation); out(`    parts ${parts.length} stacks ${m.stacks.length} crew stations ${WW.crew && WW.crew.stations ? WW.crew.stations(k, c.nation).length : '-'}`);
}
const n = +(process.argv[2] || 3);
for (let r = 1; r <= n; r++) {
  WW.seedRandom(r); WW.game.composition = null; WW.game.startRound();
  out(`round seed ${r}: ` + WW.world.ships.map(s => `${s.nation[0]}:${s.mk}:${s.name}`).join('  '));
}
if (errs.length) bad++;
out(bad ? 'FAIL ' + bad : 'OK');
process.exit(bad ? 1 : 0);
