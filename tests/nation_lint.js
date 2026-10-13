// Nation lint (Normandy plan P1): sim code must not assume the two sides are USN and IJN.
// A new side key (GER) crashes on a hard-coded ['USN', 'IJN'] loop and falls back quietly on a per-nation table
// lookup with no fallback (the Germans would get USN doctrine or NaN counters with no error). Static checks over the
// sim files (index.html order; visual-only files are skipped, see VISUAL):
//   loop    an array literal ['USN', 'IJN'] (or reversed): use WW.sides() (scenario.js)
//   lookup  T[expr] where T is declared as an object literal keyed USN and IJN with no GER key, and the lookup has no
//           fallback (`|| ...`, `?? ...`) and is not an assignment target; T.USN / T['IJN'] are fine (a fixed side)
// ALLOW lists the reviewed exceptions (file:table or file:loop) with the reason: Pacific-only data (a side the
// Normandy sim never fields, e.g. carrier air groups) or per-round tables rebuilt with WW.perSide().
// Usage: node tests/nation_lint.js [--all] (--all also lists the allowed hits). Exit 1 on any unallowed hit.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const VISUAL = /^js\/(audio|models|camera|sky|water|weather_fx|effects|damage_visuals|crew|post|ui|war_diary|plot|aar_card|air_captions|air_render|air_tracers|air_fx|air_props|lifeboats|night_fx|admirals_flags|base_fx|base_ground_fx|base_life|ai_threat_view)/;
// Reviewed: the GER side never fields carriers, carrier planes, submarines, flying boats or an island base, so these
// tables are only ever read with USN / IJN. Each entry: 'file:NAME' (a table) or 'file:loop@line-text-fragment'.
const ALLOW = {
  'js/scenario.js:loop': 'the Pacific scenario declares its two sides',
  'js/admirals.js:NAMES': 'admiral rosters: admirals.js picks GER from its own entry (WW.FLAGS / GER roster), never this table',
  'js/air_aces.js:NAMES': 'carrier fighter pilots: only sides with carriers',
  'js/air_aces.js:rosters': 'carrier fighter pilots: only sides with carriers',
  'js/air_boss.js:FULL': 'carrier air groups',
  'js/air_boss.js:ESCORT_FRAC': 'carrier strikes (doctrine escortFrac overrides)',
  'js/air_squadrons.js:NAMES': 'carrier names',
  'js/air_squadrons.js:SIZE': 'carrier squadrons',
  'js/air_squadrons.js:persist': 'carrier squadrons',
  'js/air_staff.js:DOC': 'carrier air staff',
  'js/air_cag.js:PEEL': 'carrier strike leaders',
  'js/air_alert.js:ALERT': 'carrier deck alert',
  'js/air_alert.js:ST': 'carrier deck alert',
  'js/air_search.js:ARMED': 'carrier search flights',
  'js/land_ground.js:MIX': 'island base air group (no island base in Normandy)',
  'js/island_base.js:NAMES': 'island base (no island base in Normandy)',
  'js/island_base.js:SEE_PLANE': 'has a fallback (|| 200)',
  'js/ship_classes.js:LIST': 'class lists: ship_classes.js reads the flag (WW.FLAGS) and a per-nation fallback',
  'js/core.js:TORPEDO_NATION': 'torpSpec falls back (|| {})',
  'js/core.js:PLANE_NATION': 'planeType falls back (|| {})'
};

function simFiles() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  return [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map(m => m[1]).filter(f => !VISUAL.test(f));
}
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));

function lint(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8'), src = strip(raw), out = [];
  const lineOf = i => src.slice(0, i).split('\n').length;
  for (const m of src.matchAll(/\[\s*'(USN|IJN)'\s*,\s*'(IJN|USN)'\s*\]/g)) {
    if (m[1] === m[2]) continue;
    const ln = lineOf(m.index), text = raw.split('\n')[ln - 1].trim();
    out.push({ kind: 'loop', key: `${file}:loop`, line: ln, text });
  }
  // tables: NAME = { ... USN: ... IJN: ... } with no GER key (top-level keys only, by brace depth)
  for (const m of src.matchAll(/(?:\b(?:const|let|var)\s+|\b)([A-Za-z_$][\w$]*)\s*=\s*\{/g)) {
    let i = m.index + m[0].length, d = 1, keys = new Set(), tok = '';
    for (; i < src.length && d > 0; i++) {
      const ch = src[i];
      if (ch === '{' || ch === '[' || ch === '(') d++;
      else if (ch === '}' || ch === ']' || ch === ')') d--;
      else if (d === 1) {
        if (/[\w$]/.test(ch)) tok += ch;
        else { if (ch === ':' && tok) keys.add(tok); if (!/\s/.test(ch)) tok = ''; }
      }
    }
    if (!(keys.has('USN') && keys.has('IJN')) || keys.has('GER')) continue;
    const name = m[1];
    const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}\\[([^\\]'"\`][^\\]]*)\\]`, 'g');
    for (const u of src.matchAll(re)) {
      const after = src.slice(u.index + u[0].length, u.index + u[0].length + 40);
      if (/^\s*(\|\||\?\?)/.test(after)) continue;                    // a fallback
      if (/^\s*(=(?!=)|\+=|-=|\+\+|--)/.test(after)) continue;        // written, not read
      if (/^\s*(\.\s*[\w$]+\s*)?(\|\||\?\?)/.test(after)) continue;   // T[n].x || ...
      if (/^\s*(!==?|===?)\s*undefined/.test(after) || /^\s*&&/.test(after)) continue; // guarded: T[n] !== undefined, T[n] && ...
      if (/^\s*;\s*if\s*\(\s*!/.test(after)) continue;                // const G = T[n]; if (!G) return
      if (src.slice(Math.max(0, u.index - u[0].length - 10), u.index).replace(/\s+/g, '').endsWith(u[0].replace(/\s+/g, '') + '&&')) continue; // T[n] && T[n].x
      const ln = lineOf(u.index), line = src.split('\n')[ln - 1];
      if (new RegExp(`for\\s*\\(\\s*(?:const|let|var)\\s+${u[1].trim()}\\s+in\\s+${name}\\b`).test(line)) continue; // its own keys
      const before = src.slice(Math.max(0, u.index - 300), u.index);
      if (new RegExp(`\\b${name}\\[${u[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\s*(!==?|===?)\\s*undefined`).test(before)) continue; // checked just before
      out.push({ kind: 'lookup', key: `${file}:${name}`, line: ln, text: raw.split('\n')[ln - 1].trim() });
    }
  }
  return out;
}

const ALL = process.argv.includes('--all');
let bad = 0, allowed = 0;
for (const f of simFiles()) {
  for (const h of lint(f)) {
    const ok = ALLOW[h.key];
    if (ok) { allowed++; if (ALL) console.log(`allow  ${f}:${h.line}  ${h.kind}  (${ok})`); continue; }
    bad++;
    console.log(`${h.kind.padEnd(6)} ${f}:${h.line}  ${h.text.slice(0, 150)}`);
  }
}
console.log(bad ? `FAIL: ${bad} nation-literal hit(s) in sim files (${allowed} allowed)` : `PASS: no unallowed nation literals in sim files (${allowed} allowed)`);
process.exit(bad ? 1 : 0);
