// prisoners.js - WW.prisoners: the Germans who surrendered (Normandy realism pass). Sim code, no WW.rand (the numbers
// follow from the strongpoint's crews), Normandy only, stepped from infantry.js update. Visuals: vehicles_fx.js.
// When the strongpoints fell, from mid-morning, their last men came out with their hands up, many of them conscripts
// from the east (Ostlegionen) or boys, and were marched down to the beach by a couple of GIs, through the minefield
// paths and down the bluff, to be held at the shingle and taken off to the ships in the empty landing craft.
// Here a strongpoint silenced with American infantry at it (a squad on the top, at the assault or holding, within
// TAKE_R: one silenced by the ships' fire alone yields nobody: its crews dead or gone back) gives up SURR_K of its
// crews (crew0 summed: knockOut has zeroed the live count), between MIN and MAX men; with ESCORT GIs they walk the route
// down (to the bluff top above the nearest climb path, down it, across the shelf to the shingle) at WALK u/s, and wait
// there in a huddle. At Pointe du Hoc the Rangers, cut off on the point, kept theirs on the top.
// Records: { id, wn, n, escort, pts [[x, z]...], len, d (walked), state march | held, t0 }; pos(rec, at) -> {x, z, h}.
// Events: 'prisonerEvent' { kind: surrender | held, rec, wn, n, text }.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const TAKE_R = 45, SURR_K = 0.22, MIN = 2, MAX = 12, ESCORT = 2, WALK = 0.22;
  const TAKERS = { top: 1, assault: 1, hold: 1, climb: 1, guns: 1 };
  const on = () => WW.isScn('normandy');
  const T = () => WW.normandyTerrain, rt = () => (WW.game ? WW.game.roundTime : 0);
  let recs = [], stats = null, nid = 0;
  function newStats() { return { groups: 0, men: 0, held: 0 }; }
  function surrender(w) {
    const I = WW.infantry; if (!I) return;
    let by = null;
    for (const q of I.squads) if (q.alive && q.kind !== 'tank' && TAKERS[q.state] && Math.hypot(q.x - w.x, q.z - w.z) < TAKE_R && (!by || /Tank|vehicles/.test(by.unit))) by = q;   // infantry before tank crews and drivers
    if (!by) return;
    const crew = w.elements.reduce((a, e) => a + (e.dormant ? 0 : e.crew0 || 0), 0);
    const n = Math.max(MIN, Math.min(MAX, Math.round(crew * SURR_K)));
    const t = T(), pts = [[w.x, w.z]];
    if (!w.hoc) {
      const cx = WW.infRoutes ? WW.infRoutes.climbX(w.x) : w.x;
      pts.push([cx, Math.max(t.bluffTopZ(cx) + 2, Math.min(w.z, t.bluffTopZ(cx) + 12))], [cx, t.bluffFootZ(cx)], [cx + 1, t.shingleZ(cx) + 1.2]);
    } else pts.push([w.x + 3, w.z - 4]);
    let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const r = { id: nid++, wn: w, n, escort: ESCORT, pts, len, d: 0, state: 'march', t0: rt(), by: by.unit || '' };
    recs.push(r); stats.groups++; stats.men += n;
    WW.emit('prisonerEvent', { kind: 'surrender', rec: r, wn: w, n, text: n + ' men of the garrison of ' + w.name + ' come out with their hands up; two GIs of ' + (r.by || 'the infantry') + ' march them down to the beach' });
  }
  function pos(r, at) {
    let d = WW.clamp(at === undefined ? r.d : at, 0, r.len);
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d <= L || i === r.pts.length - 1) { const f = L > 0 ? Math.min(1, d / L) : 1; return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, h: Math.atan2(b[1] - a[1], b[0] - a[0]) }; }
      d -= L;
    }
    const p = r.pts[r.pts.length - 1]; return { x: p[0], z: p[1], h: Math.PI / 2 };
  }
  function update(dt) {
    if (!on()) return;
    for (const r of recs) {
      if (r.state !== 'march') continue;
      r.d += WALK * dt;
      if (r.d >= r.len) { r.d = r.len; r.state = 'held'; stats.held += r.n; WW.emit('prisonerEvent', { kind: 'held', rec: r, wn: r.wn, n: r.n, text: r.n + ' prisoners from ' + r.wn.name + ' under guard at the shingle' }); }
    }
  }
  WW.on('defenceEvent', e => { if (on() && e && e.kind === 'silenced' && e.wn) surrender(e.wn); });
  function reset() { recs = []; stats = newStats(); nid = 0; }
  WW.on('roundStart', reset);
  WW.on('setupStart', reset);
  WW.prisoners = { update, pos, get recs() { return recs; }, get stats() { return stats; } };
  stats = newStats();
})(window.WW);
