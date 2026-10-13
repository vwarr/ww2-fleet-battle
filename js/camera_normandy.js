// camera_normandy.js (camera): WW.camNormandy, the director's land battle at Omaha and Pointe du Hoc (Normandy only;
// docs/NORMANDY_PLAN.md P9 "film layer"). The Pacific director films ships and planes from tens of units out; here the
// men are 0.43 u tall and the craft 1.5-5 u long, so every shot is a low, human-scale rig a few units off its subject,
// close to the sand and the water: the camera rides behind a coxswain, lies with the men at the shingle, looks up the
// cliff at the Rangers' ropes. Candidates go through the same machinery as the Pacific's (camera.js candidates() via
// WW.camHooks, one drama ladder with camera_score.js re-evaluating the running shot, WW.cam.interrupt for the big
// moments, camera_lock.js for a shot committed to a result):
//   9.5 a draw opened, the Rangers' guns found, the LCT(R) rocket barrage at 06:25   9 a strongpoint silenced
//   8.5 a DD tank foundering, the first ramps of a wave going down (the first wave 9 as an interrupt)
//   7.2-8 MG fire on men crossing the sand (the killing ground), an assault on a strongpoint, a gap blown in the wire,
//         a craft mined or wrecked, the Rangers at the foot of the cliff, a P-47 diving on a position
//   6-7 the run-in (closer = more), DD tanks swimming, men in the surf, the climb, a casemate firing along the beach,
//       a destroyer closed on the beach and firing   4.5-6 the shingle, men on the bluff top looking down, tanks ashore
//   2-4 a quiet walk along the busiest beach; the establishing shot (camera.js 'wide' -> wide(): the bay from the
//       water, the beach from a German position on the bluff, the waterline along the curve of the bay)
// Shot kinds start with 'n' (variety: camera.js penalises a kind repeated) and carry shot.nd; each names a rig:
//   rig     camera behind / beside the subject A, looking toward B (a target, or 'beach' / 'sea' / 'top' / 'along'
//           from A): back, lat (from -> to: a slow dolly), h above the ground or the sea under the camera, ahead (the look
//           point toward B), ly (its height over A, or toward B's height: lookB)
//   orbit   a low arc round a point (a silenced strongpoint, a foundered tank)
//   sky     standing on the beach looking up at planes
//   chase   behind a plane in its dive
//   follow  the user's follow (keys F / Tab: camera_normandy_follow.js), heading-relative
// sane(): Normandy's own floor (the sand, the bluff or the sea under the camera + minH, the view line clear of the
// ground), in place of camera.js keepSane (whose floors are for ships: 11 u over a beach). lock(): a ramp shot holds
// until the men are off, the rocket barrage until it lands. Visual only: Math.random and the wall clock (never
// WW.rand); reads the sim, never writes it; every hook returns first outside Normandy (no dice drawn in the Pacific).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const on = () => !WW.simOnly && !!WW.isScn && WW.isScn('normandy') && !!WW.normandyTerrain && !!WW.scenarios.normandy.clock;
  const battle = () => !!(WW.game && WW.game.state === 'battle');
  const wall = () => performance.now() / 1000;
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  const T = () => WW.normandyTerrain, N = () => WW.scenarios.normandy;
  const ease = x => x * x * (3 - 2 * x);
  const rnd = (a, b) => a + (b - a) * Math.random();
  const pick = L => L[Math.floor(Math.random() * L.length)];
  const ok = o => o && !o.removed && o.alive;
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
  const ST = { shots: {}, interrupts: 0, refused: 0 };

  // ---------- the ground ----------
  const sea = () => (WW.tide ? WW.tide.level() : 0);
  const land = (x, z) => WW.terrain.heightRaw(x, z);
  const groundAt = (x, z) => Math.max(land(x, z), sea());            // what the camera stands on (the sand, the sea)
  const floorAt = (x, z) => Math.max(land(x, z), sea() + 0.25, WW.waves && WW.waves.active ? WW.waves.height(x, z) + 0.15 : -1e9);   // + the swell's crests
  function sane(gP, gL, shot) {
    gP.x = WW.clamp(gP.x, -120, W + 120); gP.z = WW.clamp(gP.z, -120, H + 160);
    const min = shot && shot.minH !== undefined ? shot.minH : 0.5;
    let y = Math.max(gP.y, floorAt(gP.x, gP.z) + min), need = y;
    for (const f of [0.1, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9]) {         // the view line over the bank, the bluff, the cliff edge
      const x = WW.lerp(gP.x, gL.x, f), z = WW.lerp(gP.z, gL.z, f), ly = WW.lerp(y, gL.y, f), g = land(x, z) + 0.12;
      if (ly < g) need = Math.max(need, y + (g - ly) / (1 - f));
    }
    gP.y = Math.min(need, y + 30);
    for (const s of WW.world.ships) {                                  // never inside a ship's hull (a destroyer closed on the beach)
      if (s.removed || gP.y > 9) continue;
      const R = s.stats.length * 0.5 + 2.5, dx = gP.x - s.x, dz = gP.z - s.z, d = Math.hypot(dx, dz);
      if (d < R && d > 0.01) { gP.x = s.x + dx / d * R; gP.z = s.z + dz / d * R; }
    }
  }
  function floor(P) { const f = floorAt(P.x, P.z) + 0.3; if (P.y < f) P.y = f; }

  // ---------- recent events (event handlers only read; wall clock) ----------
  let mg = new Map(), gun = new Map(), shipFire = new Map(), hot = [], spots = new Map(), firsts = new Set(), lastInt = -1e9, rocketsCut = false;
  function spot(key, x, z, y) {   // one stable point per place (camera.js's repeat penalty keys on the subject object)
    let s = spots.get(key);
    // (not a 'diorama': camera_score.js must see a running shot on it as about it, or it recuts to the same place)
    if (!s) spots.set(key, s = { x, z, y: y !== undefined ? y : Math.max(0, land(x, z)), alive: true, spot: true, key });
    return s;
  }
  function heat(c, secs) {   // an event's candidate, fresh for secs of real time
    for (let i = hot.length - 1; i >= 0; i--) if (hot[i].c.subj === c.subj && hot[i].c.kind === c.kind) hot.splice(i, 1);
    hot.push({ c, until: wall() + secs }); if (hot.length > 24) hot.shift();
  }
  function interrupt(c, gap) {
    if (!WW.cam || !WW.cam.interrupt || !battle()) return false;
    const now = wall();
    if (now - lastInt < (gap !== undefined ? gap : c.pr >= 9 ? 6 : 14)) { ST.refused++; return false; }
    if (WW.cam.interrupt(Object.assign({ interrupt: true, nd: true }, c))) { lastInt = now; ST.interrupts++; return true; }
    ST.refused++; return false;
  }
  const first = k => (firsts.has(k) ? false : (firsts.add(k), true));
  const sectorName = o => (o && (o.sectorName || (WW.normandyData.SECTORS.find(s => s.id === o.sector) || {}).name)) || (o && o.sector === 'hoc' ? 'Pointe du Hoc' : '');
  const clock = () => N().clock.label(rt());
  const capOf = (o, line) => [line, [sectorName(o), o && o.unit, clock()].filter(Boolean).join('  ·  ')];
  function ev(name, fn) { WW.on(name, e => { if (!on() || !e) return; try { fn(e); } catch (err) { /* never break the sim */ } }); }

  ev('defenceFire', e => {
    if (e.kind === 'mg' && e.target && e.target.isSquad) mg.set(e.target, { el: e.el, at: wall() });
    else if (e.kind === 'gun' && e.el) gun.set(e.el, { at: wall(), tgt: e.target });
  });
  ev('shellFired', e => { if (e.ship && e.proj && e.proj.target && e.proj.target.isLand) shipFire.set(e.ship, wall()); });
  ev('craftEvent', e => {
    const u = e.craft;
    if (e.kind === 'ramp') {
      const c = ramp(u, u.wave <= 11 ? 8.4 : 8, 'cut');
      heat(c, 5);
      if (first('ramp:' + u.wave)) interrupt(Object.assign({}, c, { pr: u.wave <= 11 ? 9 : 8.5 }));   // the first ramp of each wave cuts in (the assault waves the hardest)
    } else if (e.kind === 'foundered') {
      const w = spot('wreck:' + u.id, u.x, u.z, 0);
      const c = { kind: 'nFounder', rig: 'orbit', subj: w, pr: 8.5, r: 3.4, h: 0.55, w: 0.07, ly: 0.1, dur: rnd(8, 11), minH: 0.35, cap: ['A DD tank founders', '741st Tank Battalion  ·  ' + clock()] };
      heat(c, 5);
      if (first('dd:' + Math.floor(wall() / 30))) interrupt(c);
    } else if (e.kind === 'mined' || e.kind === 'wrecked') {
      const w = spot('wreck:' + u.id, u.x, u.z, 0), big = u.type === 'lci' || u.type === 'lct';
      const c = { kind: 'nWreck', rig: 'orbit', subj: w, pr: big ? 8.3 : 7.6, r: 2.6 + u.C.len, h: 0.8, w: 0.05, ly: 0.2, dur: rnd(8, 11), minH: 0.4,
        cap: capOf(u, u.C.name + (e.kind === 'mined' ? ' blown up on a mined obstacle' : ' hit and burning')) };
      heat(c, 10);
      if (big) interrupt(c);
    }
  });
  ev('defenceEvent', e => {
    const w = e.wn;
    if (e.kind === 'silenced' && w) {
      const c = { kind: 'nSilenced', rig: 'orbit', subj: spot('wn:' + w.wid, w.x, w.z), pr: 9, r: 9, h: 3.2, w: 0.05, ly: 0.6, dur: rnd(10, 13), cap: [w.name + ' silenced', clock()] };
      heat(c, 14); interrupt(c);
    } else if (e.kind === 'out' && e.el && !e.el.dormant) heat({ kind: 'nOut', rig: 'orbit', subj: spot('el:' + e.el.id, e.el.x, e.el.z, e.el.y), pr: 7, r: 6, h: 2.6, w: 0.06, ly: 0.4, dur: rnd(8, 10) }, 10);
  });
  ev('drawOpened', e => {
    const d = e.draw, z = T().shingleZ(d.x), c = { kind: 'nDraw', rig: 'rig', subj: spot('draw:' + d.id, d.x, z), toward: 'top', back: [26, 15], lat: [0, 0], h: 3.6, ahead: 30, ly: 1, lookB: true, pr: 9.5, dur: rnd(12, 15),
      cap: [d.id + ' open: ' + d.name, 'the exit off the beach  ·  ' + clock()] };
    heat(c, 16); interrupt(c, 4);
  });
  ev('gapBlown', g => {
    const x = g.x, c = { kind: 'nGap', rig: 'rig', subj: spot('gap:' + Math.round(x), x, T().shingleZ(x) - 0.6), toward: 'top', back: [7, 5.5], lat: [3, 2], h: 1.4, ahead: 10, ly: 0.8, lookB: true, pr: 7.8, dur: rnd(9, 12),
      cap: ['A gap blown in the wire', 'Bangalore torpedoes  ·  ' + clock()] };
    heat(c, 12);
    const q = g.by; if (q && first('gap:' + q.sector)) interrupt(Object.assign({}, c, { pr: 8 }));
  });
  ev('squadEvent', e => {
    const q = e.squad; if (!q) return;
    if (e.kind === 'landed' && q.state === 'rope' && first('rope')) interrupt(rope(q, 8.5));
    else if (e.kind === 'gunsSpiked') {
      const c = { kind: 'nGuns', rig: 'orbit', subj: spot('guns', q.x, q.z, q.y), pr: 9.5, r: 7, h: 2.4, w: 0.05, ly: 0.5, dur: rnd(11, 14), cap: ['The Pointe du Hoc guns found', 'unmanned in an orchard inland: the Rangers spike them  ·  ' + clock()] };
      heat(c, 14); interrupt(c, 4);
    } else if (e.kind === 'top' && first('top:' + q.sector)) heat(topShot(q, 7.4, q.sector === 'hoc' ? ['Rangers atop Pointe du Hoc', clock()] : capOf(q, 'First men on the bluff')), 14);
    else if (e.kind === 'captured' && e.el) heat({ kind: 'nOut', rig: 'orbit', subj: spot('el:' + e.el.id, e.el.x, e.el.z, e.el.y), pr: 7.4, r: 6, h: 2.4, w: 0.06, ly: 0.4, dur: rnd(8, 11), cap: [e.el.name + ' taken', (e.el.wn ? e.el.wn.name + '  ·  ' : '') + clock()] }, 10);
    else if (e.kind === 'leader') heat(Object.assign(follow(q), { kind: 'nLeader', user: false, pr: 7.6, dur: rnd(10, 13), cap: capOf(q, (e.name || e.leader || 'An officer') + ' rallies the men') }), 12);
  });
  ev('airOffmap', e => {
    const p = e.plane; if (!p) return;
    if (e.kind === 'drop' && p.kind === 'b24' && first('box:' + p.box)) heat(sky(p, 6.2, ['B-24s over the beach', 'the 8th Air Force bombs through the overcast  ·  ' + clock()]), 10);
  });
  WW.on('roundStart', () => { mg = new Map(); gun = new Map(); shipFire = new Map(); hot = []; spots = new Map(); firsts = new Set(); lastInt = -1e9; rocketsCut = false; cool = {}; });

  // ---------- shot builders (Math.random: only ever called in Normandy) ----------
  function ramp(u, pr, why) {
    const small = u.C.len < 2.5, r = Math.random();   // over the coxswain's shoulder (the boats), from the deckhouse (an LCT / LCI), or from the sand
    const v = small && r < 0.55 ? { rv: 'cox', toward: 'beach', back: [u.C.len * 0.42, u.C.len * 0.3], lat: [0, 0], h: 0.95, ahead: 14, ly: 0.35, minH: 0.55, hRel: 's' }
      : !small && r < 0.4 ? { rv: 'deck', toward: 'beach', back: [u.C.len * 0.62, u.C.len * 0.5], lat: [0.3, 0.2], h: 1.9, ahead: 10, ly: 0.2, minH: 0.8, hRel: 's' }
      : { rv: 'beach', toward: 'sea', back: [u.C.len * 0.5 + 3.2, u.C.len * 0.5 + 2.4], lat: [1.4, 0.9], h: 0.6, ahead: 0, ly: 0.3, minH: 0.3 };
    return Object.assign({ kind: 'nRamp', rig: 'rig', subj: u, pr, dur: rnd(9, 12), kP: 2, kL: 2.5, why, cap: capOf(u, 'Ramp down') }, v);
  }
  function run(u, pr) {
    const L = u.C.len, v = pick([
      { rv: 'stern', toward: 'beach', back: [L * 1.3 + 1.8, L * 1.3 + 1.2], lat: [0.9, 0.5], h: 1.2, ahead: 22, ly: 0.7, minH: 0.6 },
      { rv: 'abreast', toward: 'along', back: [7, 6], lat: [1.5, 1], h: 0.9, ahead: 10, ly: 0.3, minH: 0.45 },
      { rv: 'bow', toward: 'sea', back: [L + 5, L + 3], lat: [2, 1.2], h: 0.7, ahead: 0, ly: 0.3, minH: 0.4 }]);
    return Object.assign({ kind: u.type === 'dd' ? 'nDD' : 'nRun', rig: 'rig', subj: u, pr, dur: rnd(10, 13), kP: 2.2, kL: 2.6, cap: capOf(u, u.type === 'dd' ? 'DD tanks swimming in' : u.wave <= 11 ? 'The first wave goes in' : 'Run-in') }, v);
  }
  function rope(q, pr) {
    return { kind: 'nRope', rig: 'rig', subj: q, toward: 'top', back: [13, 10], lat: [4, 3], h: 1.9, ahead: 2, ly: 2.6, lookB: false, noCompose: true, pr, dur: rnd(11, 14), cap: ['Rangers on the ropes', '2nd Ranger Battalion  ·  Pointe du Hoc  ·  ' + clock()] };
  }
  function topShot(q, pr, cap) {
    return { kind: 'nTop', rig: 'rig', subj: q, toward: 'sea', back: [4.5, 3.5], lat: [1.6, 1.2], h: 1.5, ahead: 14, ly: -1.6, minH: 0.6, pr, dur: rnd(10, 13), cap };
  }
  function sky(p, pr, cap) {
    const x = WW.clamp(p.x, 1300, 2150), z = T().shingleZ(x) - 3;
    return { kind: 'nSky', rig: 'sky', subj: p, px: x - 4, pz: z, h: 1.3, pr, dur: rnd(8, 11), noCompose: true, kL: 2, cap };
  }
  function follow(o) {   // the user's follow (and a leader rallying his men): heading-relative, a chase-cam at the men's scale
    const land = o.isSquad, L = o.isCraft ? o.C.len : 1;
    return { kind: 'nFollow', rig: 'follow', subj: o, back: land ? (o.kind === 'tank' ? 3.2 : 4) : L * 1.6 + 2.2, lat: land ? 1.4 : 1.1, h: land ? 1.1 : 0.85, ahead: 6, minH: 0.4, kP: 2.2, kL: 2.6, pr: 99, user: true, nd: true, dur: 600 };
  }

  // ---------- candidates (camera.js candidates(): WW.camHooks) ----------
  const COOL = 30, COOL_K = 1.8;   // a kind of shot just begun loses up to COOL_K for COOL s (six foundering tanks are not six shots)
  let cool = {};
  const STATE_PR = { shingle: 5.4, shelf: 4.6, climb: 6.2, top: 4.4, hold: 3.8, assault: 7.2, rope: 7.8, guns: 7.4, swim: 6.4, wade: 5.6, cross: 6, tank: 5.4 };
  function candidates(add0, dur) {
    if (!on() || !battle()) return;
    const add = (pr, kind, subj, x) => { const k = x.kind || kind, c = cool[k]; if (c && now - c < COOL) pr -= COOL_K * (1 - (now - c) / COOL); add0(pr, k, x.subj || subj, Object.assign(x, { pr, nd: true })); };   // x's own pr / kind / subj would win in camera.js add
    const now = wall(), t = rt(), C = N().clock, Tn = T();
    for (const h of hot) if (h.until > now && h.c.subj && !h.c.subj.removed && !(h.c.subj.isCraft && h.c.subj.state === 'off')) add(h.c.pr, h.c.kind, h.c.subj, Object.assign({}, h.c));
    // the rocket barrage (rocket_barrage.js: 06:25, a ripple of 9 s and 2.6 s of flight)
    const R = WW.rocketBarrage, tF = C.at(6 * 60 + 25);
    if (R && R.ships.length && t > tF - 8 && t < tF + 13) add(t < tF ? 8.2 : 9.5, 'nRockets', R.ships[4] || R.ships[0], rockets(dur));
    // the craft
    const L = WW.landingCraft ? WW.landingCraft.live : [];
    for (const u of L) {
      const s = Tn.shoreZ(u.x) - u.z;
      if (u.state === 'run') {
        if (u.type === 'dd') {
          if (u.flood > 0.8) add(8.2, 'nSinking', u, { rig: 'rig', toward: 'beach', back: [2.6, 2.2], lat: [1.6, 1.2], h: 0.45, ahead: 4, ly: 0.1, minH: 0.25, dur: dur(8, 10), kP: 2.5, kL: 3, cap: capOf(u, 'A DD tank shipping water') });
          else if (s < 270) add(6 + (u.flood > 0.55 ? 1.2 : u.flood > 0.3 ? 0.6 : 0), 'nDD', u, run(u, 0));
        }
        else if (s < 170 && s > 6) add(5.6 + 1.3 * (1 - s / 170) + (u.wave <= 11 ? 0.4 : 0) + (u.sector === 'hoc' ? 0.6 : 0), 'nRun', u, run(u, 0));
      } else if (u.state === 'beached' || u.state === 'ramp' || (u.state === 'unload' && u.men > 6)) add(u.state === 'unload' ? 7 : 7.8, 'nRamp', u, ramp(u, 0));
    }
    // the men
    const S = WW.infantry ? WW.infantry.squads : [], best = {};
    for (const q of S) {
      if (!q.alive) continue;
      const f = mg.get(q);
      if (f && now - f.at < 2.5 && ok(f.el) && (q.state === 'wade' || q.state === 'cross' || q.state === 'shingle' || q.state === 'swim')) { add(7.2 + Math.min(0.6, q.men / 20) + (q.state === 'cross' ? 0.3 : 0), 'nMg', q, mgShot(q, f.el)); continue; }
      let pr = STATE_PR[q.state]; if (pr === undefined) continue;
      if (q.sup > 1) pr += 0.4;
      const b = best[q.state]; if (b && b.pr >= pr + q.men * 0.02) continue;   // one candidate per state: the most dramatic
      best[q.state] = { q, pr: pr + q.men * 0.02 };
    }
    for (const k in best) { const { q, pr } = best[k]; add(pr, ...squadShot(q, pr)); }
    // the guns: a casemate firing along the beach, a destroyer closed on the beach
    for (const [e, g] of gun) if (now - g.at < 6 && ok(e) && e.K.wall) { add(6.6, 'nCasemate', e, casemate(e)); break; }
    for (const s of WW.world.ships) {
      const at = shipFire.get(s); if (!ok(s) || !at || now - at > 7) continue;
      const off = Tn.shoreZ(s.x) - s.z;
      if (s.type === 'destroyer' && off < 170) add(6.4 + (off < 120 ? 0.4 : 0), 'nShip', s, shipShot(s));
      else if (s.type === 'battleship') add(5.4, 'nShip', s, shipShot(s));
    }
    // the air
    const A = WW.offmapAir ? WW.offmapAir.planes : [];
    for (const p of A) if (p.alive && p.kind === 'p47' && p.state === 'dive') { add(7.2, 'nP47', p, { rig: 'chase', back: 14, h: 3, ahead: 30, ly: -6, dur: dur(7, 9), noCompose: true, kP: 3, kL: 3, cap: ['P-47s on call', 'Thunderbolts dive on ' + (p.target && p.target.wn ? p.target.wn.name : 'a strongpoint') + '  ·  ' + clock()] }); break; }
    // a quiet moment: along the busiest beach
    const q = busiest(S);
    if (q) add(3.6, 'nBeach', spot('beach:' + q.sector, q.x, Tn.shingleZ(q.x) - 6), { rig: 'rig', toward: 'along', back: [12, 9], lat: [6, 3.5], h: 1.8, ahead: 12, ly: 0.5, sd: 'sea', dur: dur(11, 14) });
  }
  function busiest(S) {
    const n = {}; let b = null, bn = 0;
    for (const q of S) if (q.alive && q.kind !== 'tank' && q.sector !== 'hoc' && (q.state === 'shingle' || q.state === 'cross' || q.state === 'wade')) { const k = q.sector; n[k] = (n[k] || 0) + q.men; if (n[k] > bn) { bn = n[k]; b = q; } }
    return b;
  }
  function rockets(dur) {
    return { rig: 'rig', toward: 'beach', back: [11, 9], lat: [5, 3], h: 2.2, ahead: 40, ly: 7, noCompose: true, dur: dur(12, 14), kP: 1.2, kL: 1.4, cap: ['The rocket barrage', 'LCT(R)s of Force O, H-5  ·  ' + clock()] };
  }
  function mgShot(q, e) {
    const v = pick([
      { rv: 'behind', subj: q, tgt: e, back: [5.5, 4.5], lat: [1.8, 1.2], h: 0.85, ahead: 8, ly: 0.5, lookB: true, minH: 0.4 },
      { rv: 'side', subj: q, tgt: e, back: [4, 3.5], lat: [12, 10], h: 2.6, aheadF: 0.25, ly: 0.6, lookB: true },
      { rv: 'gun', subj: e, tgt: q, back: [3.2, 2.8], lat: [1.6, 1.3], h: 1.6, ahead: 6, ly: -0.6, minH: 0.6, sd: 'land' }]);
    return Object.assign({ rig: 'rig', dur: rnd(9, 12), cap: capOf(q, 'Under fire on the sand') }, v);
  }
  function squadShot(q, pr) {
    const top = { toward: 'top', lookB: true };
    switch (q.state) {
      case 'shingle': return ['nShingle', q, Math.random() < 0.5 ? { rig: 'rig', toward: 'along', back: [5.5, 4.5], lat: [1.4, 1], h: 0.7, ahead: 8, ly: 0.3, sd: 'sea', minH: 0.35, dur: rnd(10, 13), cap: capOf(q, 'Pinned at the shingle') }
        : Object.assign({ rig: 'rig', back: [6, 5], lat: [2, 1.4], h: 1.2, ahead: 10, ly: 0.8, dur: rnd(10, 13), cap: capOf(q, 'At the shingle') }, top)];
      case 'climb': return ['nClimb', q, Object.assign({ rig: 'rig', back: [6.5, 5], lat: [4, 3], h: 1.8, ahead: 4, ly: 0.5, dur: rnd(10, 13), cap: capOf(q, 'Up the bluff between the draws') }, top)];
      case 'assault': return ['nAssault', q, { rig: 'rig', tgt: ok(q.foe) ? q.foe : null, toward: 'top', back: [4.2, 3.4], lat: [2, 1.4], h: 1.3, ahead: 6, ly: 0.4, lookB: true, dur: rnd(10, 13), cap: capOf(q, 'Assault on ' + (q.wn ? q.wn.name : 'a strongpoint')) }];
      case 'rope': return ['nRope', q, rope(q, pr)];
      case 'guns': return ['nGuns', q, { rig: 'rig', tgt: null, toward: 'top', back: [4.5, 3.5], lat: [2, 1.5], h: 1.4, ahead: 8, ly: 0.4, dur: rnd(10, 13), cap: ['Rangers inland', 'looking for the 155s  ·  ' + clock()] }];
      case 'top': case 'hold': return ['nTop', q, topShot(q, pr, capOf(q, 'On the bluff top'))];
      case 'tank': { let e = null, bd = 120; if (WW.coastDefence) for (const x of WW.coastDefence.elements) if (ok(x) && !x.dormant) { const d = Math.hypot(x.x - q.x, x.z - q.z); if (d < bd) { bd = d; e = x; } }
        return ['nTank', q, { rig: 'rig', tgt: e, toward: 'top', back: [3.4, 2.8], lat: [1.6, 1.1], h: 0.9, ahead: 8, ly: 0.4, lookB: !!e, minH: 0.4, dur: rnd(9, 12), cap: capOf(q, 'A Sherman on the beach') }]; }
      default: return ['nSurf', q, { rig: 'rig', toward: 'beach', back: [3.6, 3], lat: [1.6, 1.1], h: 0.55, ahead: 10, ly: 0.35, minH: 0.3, dur: rnd(9, 12), cap: capOf(q, q.state === 'swim' ? 'Men in the water' : 'Wading in') }];
    }
  }
  function casemate(e) {
    return { rig: 'rig', toward: 'aim', back: [3, 2.6], lat: [1.5, 1.2], h: 1.3, ahead: 12, ly: -0.3, sd: 'land', minH: 0.6, dur: rnd(9, 11), cap: [e.wn.name, e.name + ', enfilading the beach  ·  ' + clock()] };
  }
  function shipShot(s) {
    const L = s.stats.length;
    return { rig: 'rig', toward: 'beach', back: [L * 0.75 + 4, L * 0.6 + 3], lat: [L * 0.55 + 3, L * 0.45 + 2], h: 2.2, ahead: 40, ly: 1.4, dur: rnd(10, 13), kP: 1.5, kL: 1.8,
      cap: [s.name || 'Destroyer', (s.type === 'destroyer' ? 'closed on the beach, firing on the strongpoints' : 'the bombardment') + '  ·  ' + clock()] };
  }
  (WW.camHooks = WW.camHooks || []).push(candidates);

  // the Pacific's ship-scale candidates (the fleet's chase into the sunrise, the gun duels, the ship shots) stay in the
  // mix as quiet-moment picks, capped under the land battle's action (camera.js candidates())
  const DAMP = 6.2;
  function damp(out) { for (const c of out) if (!c.nd && c.pr > DAMP) c.pr = DAMP + (c.pr - DAMP) * 0.15; }

  // the establishing shot (camera.js pickShot, in place of the fleet 'wide')
  function wide(opening) {
    if (!on()) return null;
    const Tn = T(), t = rt(), C = N().clock, live = WW.coastDefence ? WW.coastDefence.elements.filter(e => ok(e) && !e.dormant && !e.wn.hoc && e.y > 1.5) : [];
    const r = Math.random(), x = 1380 + Math.random() * 700;
    const run0 = WW.landingCraft ? WW.landingCraft.live.filter(u => u.state === 'run' && u.type !== 'dd' && u.sector !== 'hoc' && Tn.shoreZ(u.x) - u.z < 380) : [];
    if (opening && run0.length) {             // the first wave on its way in: low astern of a boat, the others abreast of it
      const u = pick(run0), L = u.C.len;
      return { kind: 'nWide', rig: 'rig', nd: true, subj: u, toward: 'beach', back: [L * 2 + 3, L * 2 + 2], lat: [2.5, 1.5], h: 1.1, ahead: 30, ly: 1, minH: 0.5, kP: 2.2, kL: 2.6, dur: rnd(12, 15), pr: 2,
        cap: ['Omaha Beach', '6 June 1944  ·  ' + clock()] };
    }
    if (opening || t < C.H + 10 || r < 0.4)   // the bay from the water: the craft between the camera and the beach
      return { kind: 'nWide', rig: 'rig', nd: true, subj: spot('bay:' + Math.round(x / 100), x, Tn.shoreZ(x)), toward: 'beach', back: [opening ? 80 : 65, opening ? 60 : 50], lat: [8, -8], h: 3, ahead: 30, ly: 2, dur: opening ? rnd(11, 14) : rnd(9, 12), pr: 2,
        cap: opening ? ['Omaha Beach', '6 June 1944  ·  ' + clock()] : null };
    if (live.length && r < 0.75) {           // a German position on the bluff, the beach below it
      const e = pick(live);
      return { kind: 'nWide', rig: 'rig', nd: true, subj: e, toward: 'sea', back: [4.5, 3.5], lat: [2.5, 1.5], h: 1.8, ahead: 25, ly: -2, sd: 'land', minH: 0.8, dur: rnd(9, 12), pr: 2, cap: [e.wn.name, 'the beach from the bluff  ·  ' + clock()] };
    }
    return { kind: 'nWide', rig: 'rig', nd: true, subj: spot('wl:' + Math.round(x / 100), x, (WW.tide ? WW.tide.waterZ(x) : Tn.shoreZ(x)) + 1), toward: 'along', back: [16, 11], lat: [4, 2], h: 2.2, ahead: 30, ly: 1.5, sd: 'sea', dur: rnd(10, 13), pr: 2 };
  }

  // ---------- the rigs (camera.js shotGoal: shot.nd) ----------
  const V = () => new THREE.Vector3();
  const _b = { x: 0, z: 0, y: 0 };
  function towardOf(shot, A) {   // B, the point the rig looks toward
    const Tn = T(), tg = shot.tgt;
    if (tg && !tg.removed) { _b.x = tg.x; _b.z = tg.z; _b.y = (tg.y || 0) + 0.3; return _b; }
    switch (shot.toward) {
      case 'sea': _b.x = A.x; _b.z = A.z - 80; _b.y = sea(); break;
      case 'top': _b.x = A.x; _b.z = Tn.bluffTopZ(A.x) + 10; _b.y = Math.max(0, land(_b.x, _b.z)) + 1; break;
      case 'aim': _b.x = A.x + Math.cos(A.heading || 0) * 60; _b.z = A.z + Math.sin(A.heading || 0) * 60; _b.y = Math.max(sea(), land(_b.x, _b.z)) + 0.5; break;
      case 'along': { if (shot.dir === undefined) shot.dir = Math.random() < 0.5 ? -1 : 1; _b.x = A.x + shot.dir * 80; _b.z = A.z; _b.y = A.y || 0; break; }
      default: _b.x = A.x; _b.z = Tn.shoreZ(A.x) + 25; _b.y = Math.max(0, land(A.x, _b.z)); // 'beach'
    }
    return _b;
  }
  function begin(shot) {   // once: the side (the lower, more open ground; or the sea / land side), the caption
    shot.init = true;
    const A = shot.subj;
    if (shot.rig === 'rig' || shot.rig === 'follow') {
      const B = towardOf(shot, A), d = Math.hypot(B.x - A.x, B.z - A.z) || 1, ux = (B.x - A.x) / d, uz = (B.z - A.z) / d, rx = -uz, rz = ux;
      const lat = shot.lat ? (shot.lat[0] + shot.lat[1]) / 2 : 0, back = shot.back ? (Array.isArray(shot.back) ? shot.back[0] : shot.back) : 3;
      const at = sd => ({ x: A.x - ux * back + rx * lat * sd, z: A.z - uz * back + rz * lat * sd });
      if (shot.sd) { const k = at(1).z < at(-1).z ? 1 : -1; shot.side = shot.sd === 'sea' ? k : -k; }   // sd: the camera on the sea / the land side
      else { const g1 = land(at(1).x, at(1).z), g2 = land(at(-1).x, at(-1).z); shot.side = Math.abs(g1 - g2) < 0.4 ? (Math.random() < 0.5 ? 1 : -1) : g1 < g2 ? 1 : -1; }
    } else if (shot.rig === 'orbit') {
      let best = -1e9; const off = Math.random() * Math.PI * 2;
      for (let i = 0; i < 8; i++) { const a = off + i * Math.PI / 4, g = -Math.max(0, land(A.x + Math.cos(a) * shot.r, A.z + Math.sin(a) * shot.r) - (A.y || 0)) + (Math.sin(a) < 0 ? 0.3 : 0); if (g > best) { best = g; shot.a0 = a; } }   // the low side, seaward if level
      shot.side = Math.random() < 0.5 ? -1 : 1;
    }
    ST.shots[shot.kind] = (ST.shots[shot.kind] || 0) + 1; cool[shot.kind] = wall();
    for (let i = hot.length - 1; i >= 0; i--) if (hot[i].c.subj === A && hot[i].c.kind === shot.kind) hot.splice(i, 1);   // this moment is filmed
    if (shot.cap && !shot.user && WW.airCaptions && WW.airCaptions.say && !(WW.freecam && WW.freecam.active())) WW.airCaptions.say(shot.cap[0], shot.cap[1]);
  }
  function goal(shot, gP, gL, rdt) {
    if (!on()) return false;
    const A = shot.subj; if (!A) return false;
    if (!shot.init) begin(shot);
    const k = ease(Math.min(1, shot.t / Math.max(1, shot.dur))), ay = A.y || 0;
    const lr = a => (Array.isArray(a) ? WW.lerp(a[0], a[1], k) : a || 0);
    switch (shot.rig) {
      case 'rig': case 'follow': {
        let ux, uz;
        if (shot.rig === 'follow') {   // heading-relative, the heading eased (a calm chase)
          const h = shot.hS = shot.hS === undefined ? (A.heading || 0) : shot.hS + WW.angleDiff(shot.hS, A.heading || 0) * (1 - Math.exp(-rdt * 1.2));
          ux = Math.cos(h); uz = Math.sin(h);
        } else {
          const B = towardOf(shot, A), d = Math.hypot(B.x - A.x, B.z - A.z) || 1;
          ux = (B.x - A.x) / d; uz = (B.z - A.z) / d;
          if (!shot.u) shot.u = { x: ux, z: uz }; else { const e = 1 - Math.exp(-rdt * 0.7); shot.u.x += (ux - shot.u.x) * e; shot.u.z += (uz - shot.u.z) * e; const n = Math.hypot(shot.u.x, shot.u.z) || 1; shot.u.x /= n; shot.u.z /= n; }
          ux = shot.u.x; uz = shot.u.z; shot.bd = d; shot.by = B.y;
        }
        const back = lr(shot.back), lat = lr(shot.lat) * (shot.side || 1), rx = -uz, rz = ux;
        const px = A.x - ux * back + rx * lat, pz = A.z - uz * back + rz * lat;
        gP.set(px, (shot.hRel === 's' ? ay : groundAt(px, pz)) + shot.h, pz);
        const ah = shot.aheadF ? (shot.bd || 10) * shot.aheadF : Math.min(shot.ahead || 0, shot.bd || 1e9);
        const lyb = shot.lookB && shot.bd ? WW.lerp(ay, shot.by, ah / shot.bd) : ay;
        gL.set(A.x + ux * ah, lyb + (shot.ly || 0), A.z + uz * ah);
        shot.aim = (shot.aim || V()).set(A.x, ay + 0.3, A.z);
        return true;
      }
      case 'orbit': {
        const a = shot.a0 + shot.w * shot.side * shot.t, r = shot.r * (1.06 - 0.12 * k), px = A.x + Math.cos(a) * r, pz = A.z + Math.sin(a) * r;
        gP.set(px, Math.max(groundAt(px, pz), ay) + shot.h, pz);
        gL.set(A.x, ay + (shot.ly || 0), A.z);
        shot.aim = (shot.aim || V()).set(A.x, ay + 0.3, A.z);
        return true;
      }
      case 'sky': {
        gP.set(shot.px, groundAt(shot.px, shot.pz) + shot.h, shot.pz);
        gL.set(A.x, A.y || 0, A.z);
        if (!ok(A)) shot.dur = Math.min(shot.dur, shot.t + 1.5);
        return true;
      }
      case 'chase': {
        const h = A.heading || 0, fx = Math.cos(h), fz = Math.sin(h);
        gP.set(A.x - fx * shot.back, (A.y || 0) + shot.h, A.z - fz * shot.back);
        gL.set(A.x + fx * shot.ahead, (A.y || 0) + shot.ly, A.z + fz * shot.ahead);
        if (A.state === 'home' || !ok(A)) shot.dur = Math.min(shot.dur, shot.t + 1.5);
        return true;
      }
    }
    return false;
  }

  // ---------- the lock (camera_lock.js) ----------
  function lock(shot) {
    if (!on() || shot.user || shot.pr >= 99) return null;
    const s = shot.subj;
    if (shot.kind === 'nRamp' && shot.t < 14 && s && s.isCraft && s.alive && (s.state === 'beached' || s.state === 'ramp' || (s.state === 'unload' && s.men > 0))) return { why: 'ramp', release: false };
    if (shot.kind === 'nRockets' && shot.t < 13 && WW.rocketBarrage && WW.rocketBarrage.rockets.some(r => !r.done)) return { why: 'rockets', release: false };
    if (shot.kind === 'nFounder' && shot.t < 6) return { why: 'founder', release: false };
    return null;
  }
  // every second: the rocket barrage cuts in as it fires
  let tickT = 0;
  function tick(rdt) {
    if ((tickT -= rdt) > 0 || !on() || !battle()) return;
    tickT = 0.5;
    const R = WW.rocketBarrage, tF = N().clock.at(6 * 60 + 25), t = rt();
    if (!rocketsCut && R && R.ships.length && t > tF - 1.5 && t < tF + 6) { rocketsCut = true; interrupt(Object.assign({ kind: 'nRockets', subj: R.ships[4] || R.ships[0], pr: 9.5 }, rockets(rnd)), 0); }
  }
  if (WW.cam && WW.cam.update) { const u = WW.cam.update; WW.cam.update = function (rdt) { try { tick(rdt || 0); } catch (e) { /* never break the camera */ } return u.apply(this, arguments); }; }

  WW.camNormandy = { on, goal, sane, floor, lock, wide, follow, damp, groundAt, stats: ST, underFire: (q, now) => { const f = mg.get(q); return !!(f && now - f.at < 3); }, _hot: () => hot, _candidates: candidates, ramp, run };
})(window.WW);
