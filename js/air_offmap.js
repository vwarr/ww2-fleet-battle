// air_offmap.js - WW.offmapAir: the air over Omaha (P8 of docs/NORMANDY_PLAN.md). Sim code (WW.rand), Normandy only.
// The planes come from England, off the north edge, and go back there: they never land, so they live in their own
// list, not WW.world.planes (the carrier air code, the CAP, the dogfights and the Pacific AA never see them; the German
// flak here does). Visuals: air_offmap_fx.js.
//  - B-24 boxes of the 8th Air Force (H-25 to H-5): level bombing across the beach from ~6,000 m. With settings.cloud
//    (the default, as on the day) they bombed through overcast on instruments with a delay to spare the landing craft,
//    and the sticks fell ~3 mi inland (INLAND_CLOUD u behind the bluff tops): no strongpoint was hit. Without cloud
//    they aim at the strongpoints and their sticks (WW.combat.dropBomb) fall among them.
//  - P-47 Thunderbolt flights (from H+60, a flight every P47_EVERY s): fighter-bombers on call. A flight picks a
//    position that has shown itself (or any live one of a strongpoint not silenced) with no friendly squad within SAFE_R,
//    dives on it, strafes (WW.combat.fireShell 'mg') and releases two bombs low, pulls out and goes home.
//  - Spitfire top cover: a flight of four circling high over the beach, relieved every SPIT_RELIEF s.
//  - settings.fw190: Oberstleutnant Priller and Uffz. Wodarczyk's two Fw 190s (they strafed Sword and Juno; flavour
//    here): one low pass along the beach, the men in the path take casualties; the top cover goes after them.
//  - Flak: the 2 cm guns (coast_defence.js 'flak') fire at planes below FLAK_ALT within their range: FLAK_P a tick.
// Events: 'airOffmap' { kind: 'arrive' | 'drop' | 'strafe' | 'shotDown' | 'home', plane }.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  const NORTH = -60, B24 = { speed: 26, y: 62, n: 6, hp: 60 }, P47 = { speed: 34, y: 40, hp: 30 }, SPIT = { speed: 32, y: 72, hp: 25 }, FW = { speed: 38, y: 6, hp: 22 };
  const INLAND_CLOUD = 480, P47_EVERY = 150, P47_FROM = 60, SAFE_R = 30, DIVE_D = 120, RELEASE_D = 26, SPIT_RELIEF = 220;
  const FLAK_ALT = 45, FLAK_TICK = 0.5, FLAK_P = 0.035, FLAK_DMG = 9, GRAV = 9.8;
  const on = () => WW.isScn('normandy');
  const N = () => WW.scenarios.normandy, T = () => WW.normandyTerrain, CD = () => WW.coastDefence;
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  let planes = [], sched = [], nid = 0, flakT = 0, stats = null, nextP47 = 0, spitT = 0;

  function newStats() { return { b24: 0, b24Bombs: 0, p47: 0, p47Bombs: 0, strafes: 0, shotDown: 0, fwKills: 0 }; }
  function make(kind, x, z, y, speed, hp, extra) {
    const p = Object.assign({ id: 40000 + nid++, kind, nation: kind === 'fw190' ? 'GER' : 'USN', x, z, y, heading: Math.PI / 2, speed, hp, maxHp: hp, alive: true, state: 'in', t0: rt(), muzzleY: y }, extra || {});
    planes.push(p); WW.emit('airOffmap', { kind: 'arrive', plane: p });
    return p;
  }
  function reset() {
    planes = []; sched = []; nid = 0; flakT = 0; stats = newStats(); nextP47 = 0; spitT = 0;
    if (!on()) return;
    const C = N().clock, S = N().settings || {};
    // the B-24 boxes: one per group of strongpoints (west, centre, east), three minutes apart
    [[1380, [6, 5]], [1700, [6, 8]], [1960, [6, 11]]].forEach(([x, hm], i) => sched.push({ t: C.at(hm[0] * 60 + hm[1]), kind: 'b24box', x, i }));
    if (S.fw190) sched.push({ t: C.at(8 * 60), kind: 'fw190' });
    sched.sort((a, b) => a.t - b.t);
    nextP47 = C.H + P47_FROM;
  }
  // a box of six in a loose vee, flying south over x
  function b24box(r) {
    const cloud = (N().settings || {}).cloud !== false, T0 = T();
    for (let k = 0; k < B24.n; k++) {
      const dx = ((k % 3) - 1) * 9, dz = -Math.floor(k / 3) * 12 - Math.abs((k % 3) - 1) * 5;
      const p = make('b24', r.x + dx, NORTH + dz, B24.y + (k % 2) * 3, B24.speed, B24.hp);
      const aimZ = cloud ? T0.bluffTopZ(r.x + dx) + INLAND_CLOUD : T0.bluffTopZ(r.x + dx) + 8;
      const tf = Math.sqrt(2 * p.y / GRAV);
      p.dropZ = aimZ - p.speed * 0.6 * tf - 6;   // dropBomb throws at 0.6 x the plane's speed
      p.bombs = 6; p.box = r.i; stats.b24++;
    }
  }
  function p47flight() {
    const C = CD(); if (!C) return;
    const S = WW.infantry ? WW.infantry.squads : [], now = WW.time.now;
    let best = null, bs = -1;
    for (const e of C.elements) {
      if (!e.alive || e.dormant || e.type === 'wall' || e.wn.silenced) continue;
      if (S.some(q => q.alive && Math.hypot(q.x - e.x, q.z - e.z) < SAFE_R)) continue;   // our own men too close
      const s = (e.revealUntil > now ? 3 : 1) * (e.type === 'casemate' || e.type === 'gunpit' ? 2 : 1);
      if (s > bs) { bs = s; best = e; }
    }
    if (!best) return;
    for (let k = 0; k < 4; k++) {
      const p = make('p47', best.x + (k - 1.5) * 8, NORTH - k * 10, P47.y, P47.speed, P47.hp, { target: best, bombs: 2, passes: 2, slot: k });
      stats.p47++; p.target = best;
    }
  }
  function spits() {
    const cx = 1650;
    for (let k = 0; k < 4; k++) make('spit', cx + (k - 1.5) * 12, NORTH - k * 8, SPIT.y, SPIT.speed, SPIT.hp, { orbit: { x: cx + (k < 2 ? -120 : 120), z: T().shoreZ(cx) - 60, r: 110 + k * 10, dir: k % 2 ? 1 : -1 }, until: rt() + SPIT_RELIEF });
  }
  function fw190() { for (let k = 0; k < 2; k++) make('fw190', 1200 - k * 14, T().shoreZ(1250) - 160, 30, FW.speed, FW.hp, { heading: 0, run: 0 }); }

  function fly(p, gx, gz, gy, dt, turn) {
    const want = Math.atan2(gz - p.z, gx - p.x), d = WW.angleDiff(p.heading, want);
    p.heading += WW.clamp(d, -turn * dt, turn * dt);
    p.x += Math.cos(p.heading) * p.speed * dt; p.z += Math.sin(p.heading) * p.speed * dt;
    p.y += WW.clamp(gy - p.y, -14 * dt, 8 * dt); p.muzzleY = p.y;
    return Math.hypot(gx - p.x, gz - p.z);
  }
  function home(p, dt) {
    fly(p, p.x, NORTH - 100, 50, dt, 0.9);
    if (p.z < NORTH - 40) { p.alive = false; WW.emit('airOffmap', { kind: 'home', plane: p }); }
  }
  function step(p, dt) {
    if (p.kind === 'b24') {
      p.x += Math.cos(p.heading) * p.speed * dt; p.z += Math.sin(p.heading) * p.speed * dt;
      if (p.bombs > 0 && p.z >= p.dropZ) {   // the stick: a bomb every 0.4 s from the drop point
        p.dropAcc = (p.dropAcc || 0) - dt;
        if (p.dropAcc <= 0) { p.dropAcc = 0.4; p.bombs--; WW.combat.dropBomb(p, null); stats.b24Bombs++; if (p.bombs === 5) WW.emit('airOffmap', { kind: 'drop', plane: p }); }
      }
      if (p.z > WW.cfg.MAP_H + 700 && p.bombs <= 0) p.alive = false;   // on inland past the drop, and home the long way round
    } else if (p.kind === 'p47') {
      const e = p.target;
      if (p.state === 'home' || !e || !e.alive) { p.state = 'home'; return home(p, dt); }
      const off = (p.slot - 1.5) * 4;
      if (p.state === 'in') { const d = fly(p, e.x + off, e.z - DIVE_D, P47.y, dt, 1.2); if (d < 20) p.state = 'dive'; }
      else if (p.state === 'dive') {
        const d = fly(p, e.x + off, e.z, Math.max(e.y + 6, 8), dt, 1.6);
        p.y = Math.max(e.y + 6, p.y - 22 * dt);
        if (d < 70 && (p.gunT = (p.gunT || 0) - dt) <= 0) { p.gunT = 0.3; if (WW.combat.fireShell(p, null, e, 'mg')) stats.strafes++; }
        if (d < RELEASE_D && p.bombs > 0) {
          p.dropV = { x: Math.cos(p.heading) * p.speed * 0.8, y: -8, z: Math.sin(p.heading) * p.speed * 0.8 };
          while (p.bombs > 0) { p.bombs--; WW.combat.dropBomb(p, e); stats.p47Bombs++; }
          p.dropV = null; WW.emit('airOffmap', { kind: 'strafe', plane: p });
        }
        if (d < 8) { p.passes--; p.state = p.passes > 0 ? 'pullout' : 'home'; p.outT = rt(); }
      } else if (p.state === 'pullout') {
        fly(p, e.x + Math.cos(p.heading) * 200, e.z - 120, P47.y, dt, 1.0);
        if (rt() - p.outT > 9) p.state = 'in';
      }
    } else if (p.kind === 'spit') {
      const o = p.orbit, fw = planes.find(q => q.alive && q.kind === 'fw190');
      if (rt() > p.until) return home(p, dt);
      if (fw && Math.hypot(fw.x - p.x, fw.z - p.z) < 300) {   // after the raiders
        fly(p, fw.x, fw.z, fw.y + 4, dt, 1.6);
        if (Math.hypot(fw.x - p.x, fw.z - p.z) < 12 && WW.rand() < 0.15 * dt) shotDown(fw);
        return;
      }
      const a = Math.atan2(p.z - o.z, p.x - o.x) + o.dir * 0.6;
      fly(p, o.x + Math.cos(a) * o.r, o.z + Math.sin(a) * o.r, SPIT.y, dt, 0.8);
    } else if (p.kind === 'fw190') {
      // in from the west over the sea, down to the deck, a pass east along the beach, out over the sea to the east
      if (p.state === 'in') { fly(p, 1300, T().shoreZ(1300) + 4, FW.y, dt, 1.4); if (Math.abs(p.x - 1300) < 15) p.state = 'run'; }
      else if (p.state === 'run') {
        p.heading = 0; p.x += p.speed * dt; p.z = T().shoreZ(p.x) + 4 + (p.id % 2) * 6; p.y = Math.max(p.y - 10 * dt, FW.y);
        if (WW.infantry) for (const q of WW.infantry.squads) if (q.alive && q.kind !== 'tank' && Math.abs(q.x - p.x) < 2 && Math.abs(q.z - p.z) < 6 && WW.rand() < 0.5) stats.fwKills += WW.infantry.lose(q, 1 + (WW.rand() < 0.4 ? 1 : 0));
        if (p.x > 2150) p.state = 'out';
      } else { fly(p, 2600, -100, 40, dt, 1.0); if (p.x > 2500) p.alive = false; }
    }
  }
  function shotDown(p) {
    if (!p.alive) return;
    p.alive = false; p.down = true; stats.shotDown++;
    WW.emit('airOffmap', { kind: 'shotDown', plane: p });
  }
  function flak(dt) {
    flakT -= dt; if (flakT > 0) return; flakT = FLAK_TICK;
    const C = CD(); if (!C) return;
    for (const e of C.elements) {
      if (e.kind !== 'flak' || !e.alive || e.suppressedUntil > WW.time.now) continue;
      for (const p of planes) {
        if (!p.alive || p.nation === 'GER' || p.y > FLAK_ALT || Math.hypot(p.x - e.x, p.z - e.z) > e.K.range) continue;
        e.firedAt = WW.time.now; C.reveal(e, 10);
        if (WW.rand() < FLAK_P) { p.hp -= FLAK_DMG; if (p.hp <= 0) shotDown(p); }
        WW.emit('defenceFire', { el: e, kind: 'flak', target: p });
        break;
      }
    }
  }
  function update(dt) {
    if (!on() || !WW.game || WW.game.state !== 'battle') return;
    const t = rt();
    while (sched.length && sched[0].t <= t) { const r = sched.shift(); if (r.kind === 'b24box') b24box(r); else if (r.kind === 'fw190') fw190(); }
    if (t >= nextP47) { p47flight(); nextP47 = t + P47_EVERY; }
    if (t >= spitT) { spits(); spitT = t + SPIT_RELIEF; }
    for (const p of planes) if (p.alive) step(p, dt);
    flak(dt);
    if (planes.length > 120) planes = planes.filter(p => p.alive || p.down);
  }
  WW.on('roundStart', reset);
  WW.on('setupStart', () => { planes = []; sched = []; });
  WW.offmapAir = { update, get planes() { return planes; }, get stats() { return stats; } };
  stats = newStats();
})(window.WW);
