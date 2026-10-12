// Endgame before / after (diagnosis): the survey C patterns of docs/airdiag (tests/endgame_survey.js --json) side by
// side for two runs, with the brief's targets (each pattern at least halved; C1 and C2 cut by 2/3 or more).
// Usage: node tests/endgame_compare.js BEFORE.json AFTER.json [--list PATTERN]
'use strict';
const fs = require('fs');
const [fa, fb] = process.argv.slice(2), li = process.argv.indexOf('--list'), LIST = li > 0 ? process.argv[li + 1] : null;
const A = JSON.parse(fs.readFileSync(fa)), B = fb && fs.existsSync(fb) ? JSON.parse(fs.readFileSync(fb)) : null;
const dark = r => r.tod === 'dusk' || r.tod === 'night', timeEnd = r => r.end === 'time' || r.end === 'cap';
const P = [ // [key, label, test, cut (target share removed)]
  ['C1a', 'dusk / night: dead air >= 120 s in the last third', r => dark(r) && r.a.dead.gap >= 120, 2 / 3],
  ['C1b', 'dusk / night: time ending after 300 s', r => dark(r) && timeEnd(r) && r.len > 300, 2 / 3],
  ['C2', 'finish-off failure, loser broken (>= 60 s)', r => r.a.finish && r.a.finish.gap >= 60 && r.a.finish.broken, 2 / 3],
  ['C3', 'last sinking then >= 90 s to the end', r => r.a.lastSink && r.a.lastSink.toEnd >= 90, 1 / 2],
  ['C4', 'time ending with enemies within 500', r => timeEnd(r) && r.a.timeEnd && r.a.timeEnd.d < 500, 1 / 2],
  ['C5a', 'standoff >= 120 s in the last third', r => r.a.standoff.gap >= 120, 1 / 2],
  ['C5b', 'subs-only stall with no attack (sub scenarios, time/stall end, no hit)', r => /sub_|ss_|dd6_vs_ss6/.test(r.scen) && timeEnd(r) && r.a.dead.gap >= 0.3 * r.len, 1 / 2],
  ['C6', 'hulk afloat at the end', r => r.a.hulk.length, 1 / 2],
  ['C8a', 'last sinking far from every ship, no action', r => r.a.lastSink && r.a.lastSink.nearest > 300 && r.a.lastSink.act10 === 0, 1 / 2],
  ['C8b', 'spinning ship (PT idle spins)', r => r.a.spin.length, 1 / 2],
  ['-', 'dead air >= 120 s in the last third (all)', r => r.a.dead.gap >= 120, 1 / 2],
  ['-', 'finish-off failure (>= 60 s, all)', r => r.a.finish && r.a.finish.gap >= 60, 1 / 2],
  ['-', 'long retirement (tail >= 120 s, dead >= 60 s)', r => r.a.retire && r.a.retire.tail >= 120 && r.a.retire.maxDead >= 60, 1 / 2],
  ['-', 'time ending (any)', r => timeEnd(r), 0]
];
const pc = (n, N) => (100 * n / N).toFixed(0) + '%';
console.log(`rounds: before ${A.length}` + (B ? `, after ${B.length}` : ''));
for (const [k, label, test, cut] of P) {
  const a = A.filter(test).length, b = B ? B.filter(test).length : null;
  const ok = B && cut ? (b <= a * (1 - cut) ? 'MET' : 'missed') : '';
  console.log(`${k.padEnd(4)} ${label.padEnd(70)} ${String(a).padStart(4)} (${pc(a, A.length)})` + (B ? ` -> ${String(b).padStart(4)} (${pc(b, B.length)})  ${cut ? 'target -' + Math.round(cut * 100) + '% ' + ok : ''}` : ''));
}
const len = R => { const l = R.map(r => r.len).sort((x, y) => x - y); return l[l.length >> 1]; };
console.log(`median round length ${len(A)}` + (B ? ` -> ${len(B)}` : ''));
const ends = R => ['kill', 'retire', 'time', 'stall', 'cap', 'night', 'lull'].map(k => k + ' ' + R.filter(r => r.end === k).length).join(' ');
console.log(`ends: ${ends(A)}` + (B ? `\n   -> ${ends(B)}` : ''));
if (LIST) {
  const p = P.find(q => q[0] === LIST); const pick = R => R.filter(p[2]).map(r => `${r.scen}:${r.seed}:${r.tod}:${r.end}@${r.len}`).join(' ');
  console.log(`\n${LIST} before: ${pick(A)}` + (B ? `\n${LIST} after: ${pick(B)}` : ''));
}
