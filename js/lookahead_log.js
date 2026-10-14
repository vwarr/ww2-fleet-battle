// lookahead_log.js (sim-side recorder, read-only): WW.laLog, the round's event log in a form two copies of the same
// round can share (camera5). The look-ahead worker (lookahead_worker.js) runs it 60-90 s ahead of the screen and sends
// the log to the page (lookahead.js); the page runs the same recorder on the displayed round only to name its entities
// the same way and to check the two copies stay identical (checkpoint hashes).
//  - Stable names: a ship is 's' + its id (ships.js ids restart at 1 every round); a plane gets a round ordinal `lid` the
//    step it first appears in WW.world.planes (planes are only ever appended, in the same order in both copies).
//  - Events { n: live step, t: sim s, k, ... }: drop (a plane releases a bomb / torpedo: p, w, tg), tfire (a ship's
//    torpedo spread: s, tg), imp (a bomb / torpedo arrives: w, p or s source, hit ship or null, x, z, dud), hit (a ship
//    hit: s, kind, cal, amount, x, z), sh (a heavy / medium shell landing on a ship: src, hit, cal), sunk, mag (a magazine / critical explosion), down (a plane shot down / ditched:
//    p, x, y, z, how), wet (the wreck meets the sea, a deck or the land: p, x, z, on), phase (a plane starts its attack:
//    run / roll / dive / anvil, with its target), go (a strike wave leaves: cv, tg, members).
//  - Checkpoints: every CHECK steps a hash of every ship and live plane (position, heading, hp), so the page can tell
//    the copy is still the same round (lookahead.js turns the look-ahead off for the round if not).
// Recording is off until WW.laLog.on = true (lookahead.js / the worker). Reads the sim, never writes it (the lid tag
// excepted), no randoms.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const CHECK = 600, SCAN = 6;
  const L = WW.laLog = { on: false, dbg: !!window.__laDbg, ev: [], checks: [], CHECK, lidOf: p => p && p.lid, byLid: new Map() };
  let lid = 0, downs = [], phaseOf = new Map();
  const battle = () => WW.game && WW.game.state === 'battle';
  const sid = s => (s && s.stats && !s.isBase ? 's' + s.id : s && s.isBase ? 'base' : null);
  const pid = p => (p && p.pt && p.lid ? 'p' + p.lid : null);
  const who = o => sid(o) || pid(o);
  const r1 = v => Math.round(v * 10) / 10;
  function rec(k, o) { if (!L.on || !battle()) return; o.k = k; o.n = WW.game.stepN || 0; o.t = WW.time.now; L.ev.push(o); }
  L.reset = function () { L.ev = []; L.checks = []; lid = 0; downs = []; phaseOf = new Map(); L.byLid = new Map(); };
  WW.on('roundStart', () => L.reset());

  WW.on('weaponDropped', e => {
    if (!e || !e.proj) return;
    const o = e.plane;
    if (o && o.stats) rec('tfire', { s: sid(o), tg: who(o.target), x: r1(e.proj.x), z: r1(e.proj.z), h: e.proj.h });
    else rec('drop', { w: e.kind, p: pid(o), tg: who((o && (o.diveTgt || o.target)) || e.target), x: r1(e.proj.x), z: r1(e.proj.z) });
  });
  WW.on('weaponImpact', e => {
    if (!e) return;
    const o = e.proj && (e.proj.owner || e.proj.plane);
    const sh = e.ship && e.ship.stats ? e.ship : null;
    rec('imp', { w: e.kind, src: who(o), hit: sid(e.ship), x: r1(e.x), z: r1(e.z), dud: !!e.dud, sx: sh ? r1(sh.x) : undefined, sz: sh ? r1(sh.z) : undefined });
  });
  WW.on('shipHit', e => { if (e && e.ship) rec('hit', { s: sid(e.ship), kind: e.kind || '', cal: e.cal || '', a: r1(e.amount || 0), x: r1(e.x || e.ship.x), z: r1(e.z || e.ship.z), sx: r1(e.ship.x), sz: r1(e.ship.z), hp: r1(e.ship.hp) }); });
  // a heavy / medium shell landing on a ship (the gun duels): its source
  WW.on('shellLanded', e => { if (e && e.ship && e.ship.stats && (e.cal === 'big' || e.cal === 'med')) { const o = e.proj && e.proj.owner; rec('sh', { src: who(o), hit: sid(e.ship), cal: e.cal, x: r1(e.x), z: r1(e.z), sx: r1(e.ship.x), sz: r1(e.ship.z) }); } });
  WW.on('shipSunk', s => { if (s) rec('sunk', { s: sid(s), x: r1(s.x), z: r1(s.z) }); });
  WW.on('magazine', e => { if (e && e.ship) rec('mag', { s: sid(e.ship), x: r1(e.ship.x), z: r1(e.ship.z) }); });
  WW.on('waveGo', e => { if (e) rec('go', { cv: sid(e.carrier), tg: who(e.target), nation: e.nation }); });
  // the plane's death (wrapped after aircraft.js; the original runs unchanged)
  if (WW.Plane) {
    const P = WW.Plane.prototype;
    for (const nm of ['shotDown', 'ditch']) {
      const f = P[nm]; if (typeof f !== 'function') continue;
      P[nm] = function () {
        if (L.on && this.alive && this.lid && battle()) { rec('down', { p: pid(this), how: nm, x: r1(this.x), y: r1(this.y), z: r1(this.z), kind: this.kind, nation: this.nation, ord: !!this.ordnance, ph: this.phase || '' }); downs.push(this); }
        return f.apply(this, arguments);
      };
    }
  }
  const ATT = { run: 1, roll: 1, dive: 1 };
  // after each live step (main.js stepLive -> WW.afterStep chain, lookahead.js): names, phases, falls, checkpoints
  L.step = function (n) {
    const arr = WW.world.planes;
    for (let i = arr.length - 1; i >= 0 && arr[i].lid === undefined; i--) arr[i].lid = 0;   // (marked, numbered in order below)
    for (let i = 0; i < arr.length; i++) if (arr[i].lid === 0) { arr[i].lid = ++lid; L.byLid.set(lid, arr[i]); }
    if (!L.on || !battle()) return;
    if (n % SCAN === 0) {
      for (const p of arr) {
        if (!p.alive || p.removed || !p.lid) continue;
        const ph = ATT[p.phase] ? p.phase : p.sk === 'anvil' ? 'anvil' : '';
        const was = phaseOf.get(p.lid) || '';
        if (ph !== was) { phaseOf.set(p.lid, ph); if (ph) rec('phase', { p: pid(p), ph, tg: who(p.diveTgt || p.target), kind: p.kind, x: r1(p.x), y: r1(p.y), z: r1(p.z) }); }
      }
      for (let i = downs.length - 1; i >= 0; i--) {
        const p = downs[i];
        const on = p.removed ? 'gone' : p.deathMode === 'ditched' || p.state === 'ditched' ? 'sea' : (p.y || 0) <= 0.8 ? 'sea' : p.deathMode === 'slide' ? 'deck' : null;
        if (on || WW.time.now - (p._laDown || (p._laDown = WW.time.now)) > 40) { rec('wet', { p: pid(p), x: r1(p.x), z: r1(p.z), on: on || 'lost' }); downs.splice(i, 1); }
      }
    }
    if (n % CHECK === 0) L.checks.push(L.dbg ? { n, h: L.hash(), d: L.detail() } : { n, h: L.hash() });
  };
  // the round's state in one 32-bit number (FNV-1a over the rounded numbers)
  L.hash = function () {
    let h = 0x811c9dc5;
    const mix = v => { const s = typeof v === 'number' ? (Object.is(v, -0) ? 0 : v).toFixed(5) : String(v); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
    for (const s of WW.world.ships) { mix(s.id); mix(s.x); mix(s.z); mix(s.heading); mix(s.hp); mix(s.alive ? 1 : 0); }
    for (const p of WW.world.planes) if (p.alive) { mix(p.lid || 0); mix(p.x); mix(p.y); mix(p.z); mix(p.hp); }
    mix(WW.time.now);
    return h >>> 0;
  };
  // (debug, L.dbg: the hashed values per entity, to find where two copies part)
  L.detail = function () {
    const f = v => (typeof v === 'number' ? v.toFixed(5) : String(v));
    const ac = WW.aces ? ['aces ' + Object.keys(WW.aces.rosters).map(n => n + ':' + WW.aces.rosters[n].map(r => r.idle.map(pl => pl.id + '/' + pl.kills).join('.')).join('|')).join(' ')] : [];
    return ac.concat(WW.world.ships.map(s => 's' + s.id + ' ' + [s.x, s.z, s.heading, s.hp, s.speed].map(f).join(','))).concat(WW.world.planes.filter(p => p.alive).map(p => 'p' + p.lid + ' ' + p.kind + ' ' + p.state + ' ' + [p.x, p.y, p.z, p.hp, p.heading].map(f).join(',')));
  };
  const prev = WW.afterStep;
  WW.afterStep = function (n) { if (prev) prev(n); try { L.step(n); } catch (e) { console.error('laLog', e); } };
})(window.WW);
