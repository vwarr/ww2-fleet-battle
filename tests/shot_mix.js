// Shot mix of a camera_audit.js survey (read-only, node side): per scenario, the share of filmed seconds by shot kind
// (story shots as story/<sk>) and by subject class (the ship / plane type the shot follows), so a before / after
// pair of surveys on the same seeds shows what the director spent its time on (night_plan.js: the night fight, not
// parked carriers).
// Usage: node tests/shot_mix.js <camera_audit raw dir> [scen,...]
'use strict';
const fs = require('fs'), path = require('path');
const dir = process.argv[2], only = process.argv[3] ? process.argv[3].split(',') : null;
const by = {};
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
  const scen = f.replace(/_\d+\.json$/, ''); if (only && !only.includes(scen)) continue;
  const R = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), M = by[scen] = by[scen] || { n: 0, kind: {}, subj: {} };
  for (const r of R.rec || []) {
    const s = r.shot; if (!s) continue;
    const k = s.story ? 'story/' + s.sk : s.kind; M.kind[k] = (M.kind[k] || 0) + 1;
    const c = (r.subj ? r.subj.c || '?' : '-') + (r.tgt ? '>' + (r.tgt.c || '?') : ''); M.subj[c] = (M.subj[c] || 0) + 1; M.n++;
  }
}
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / n).toFixed(0)}%`).join(', ');
for (const s in by) console.log(`${s} (${by[s].n} s)\n  kinds: ${top(by[s].kind, by[s].n)}\n  subjects: ${top(by[s].subj, by[s].n)}`);
