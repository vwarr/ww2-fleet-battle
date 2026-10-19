// main.js (owner A): renderer, camera, loop, round logic (WW.game), window.__sim.
window.WW = window.WW || {};
(function (WW) {
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
  const STEP = 0.05;          // max sim step
  const BASE_SPEED = 0.5;     // calm pace: the UI's 1x runs the simulation at half speed
  const VICTORY_TIME = 9;     // sim seconds the banner shows
  const SUB_STALL = 60;       // see updateGame
  const SUB_CLOSE = 150;      // ... and starts this long after first contact (time to close: a sub makes 3.5 u/s)
  const SUB_SEARCH = 240 + (W - 960) / 8; // a subs-only side that never made contact: the stall ends the round after this long (240 s on the old 960 map, + the crossing of the bigger one at 8 u/s: 420 s)
  // start zones (scenario.js side specs): Pacific hugs the west / east edges, the open sea between them is the approach
  const SIDE = n => WW.sideSpec(n);
  const scn = () => WW.scn();

  const call = (mod, fn, ...a) => { const m = WW[mod]; if (m && typeof m[fn] === 'function') return m[fn](...a); };
  const ALL_MODULES = ['fx', 'combat', 'air', 'ships'];

  // ---------- renderer / scene / camera ----------
  let renderer, scene, camera;
  const VFOV = 38;

  let pixelMode = false;     // optional retro mode (P key): low internal resolution, upscaled
  function setupRenderer() {
    const canvas = document.getElementById('game');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(0xa6d6f2);
    // tone mapping is done once in post.js (a soft filmic shoulder over the whole frame)
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // soft edges (VSM left a faint box-shaped tint on the seabed)
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(VFOV, 16 / 9, 1, 5000);
    WW.renderer = renderer; WW.scene = scene; WW.camera = camera;
    window.addEventListener('resize', resize);
  }
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    if (pixelMode) { renderer.setPixelRatio(1); renderer.setSize(Math.round(w * 360 / h), 360, false); }
    else { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.setSize(w, h, false); }
    renderer.domElement.classList.toggle('pixel', pixelMode);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    call('cam', 'resize');
    call('post', 'resize');
  }
  WW.view = { togglePixel() { pixelMode = !pixelMode; resize(); return pixelMode; } };

  // ---------- fleets ----------
  // Realistic spacing: a carrier keeps ~70 units from any ship, big ships ~35, small craft ~20.
  const SPACE = { carrier: 70, battleship: 35, cruiser: 35, destroyer: 20, submarine: 20, pt: 20 };
  const minSpacing = (a, b) => Math.max(SPACE[a] || 20, SPACE[b] || 20);
  // Task-force formation in local (forward f, lateral l) units: carriers at the rear,
  // battleships ahead, cruisers on the wings, a destroyer screen, then subs and PT boats.
  const SLOTS = {
    carrier: [[0, 0]], carrier2: [[0, -50], [0, 50]],
    battleship: [[72, -28], [72, 28]], cruiser: [[36, -64], [36, 64]], cruiser2: [[40, -112], [40, 112]],
    destroyer: [[98, -56], [100, 0], [98, 56]], submarine: [[118, -30]], pt: [[112, 32], [108, 84]]
  };
  function randomComposition() {
    if (scn().composition) return scn().composition();
    const out = [];
    for (const nation of WW.sides()) {
      const counts = { carrier: WW.rand() < 0.25 ? 2 : 1, battleship: WW.randInt(1, 2), cruiser: 2, destroyer: 3, submarine: 1, pt: 2 };
      const dir = nation === 'USN' ? 1 : -1, rearX = nation === 'USN' ? 26 : W - 26, cz = WW.randRange(H / 2 - 70, H / 2 + 70);
      const placed = [];
      for (const type in counts) {
        const slots = SLOTS[(type === 'carrier' || type === 'cruiser') && counts.carrier === 2 ? type + '2' : type];
        for (let i = 0; i < counts[type]; i++) {
          const [f, l] = slots[i % slots.length];
          const p = nearestOk(rearX + dir * f, cz + l * dir, type, placed);
          placed.push(p); out.push({ type, nation, x: p.x, z: p.z });
        }
      }
    }
    return out;
  }
  function clearOf(x, z, type, placed) {
    for (const p of placed) {
      const need = minSpacing(type, p.type);
      if (WW.dist2(x, z, p.x, p.z) < need * need) return false;
    }
    return true;
  }
  // nearest navigable point (spiral search) that is clear of other ships
  function nearestOk(x, z, type, placed) {
    const st = WW.SHIP_TYPES[type];
    for (let r = 0; r < 160; r += 3) {
      const n = Math.max(1, Math.round(r / 2));
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, px = WW.clamp(x + Math.cos(a) * r, 5, W - 5), pz = WW.clamp(z + Math.sin(a) * r, 8, H - 8);
        if (WW.terrain.isNavigable(px, pz, st.minDepth + 1) && clearOf(px, pz, type, placed)) return { x: px, z: pz, type };
      }
    }
    // no fully clear spot: take the nearest navigable one
    for (let r = 0; r < 200; r += 3) for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, px = WW.clamp(x + Math.cos(a) * r, 5, W - 5), pz = WW.clamp(z + Math.sin(a) * r, 8, H - 8);
      if (WW.terrain.isNavigable(px, pz, st.minDepth + 1)) return { x: px, z: pz, type };
    }
    return { x, z, type };
  }
  // keep the fleet shape, move its centre into the side's start zone, then fix each ship onto good water
  function repositionComposition(comp) {
    const out = [];
    for (const nation of WW.sides()) {
      const mine = comp.filter(c => c.nation === nation);
      if (!mine.length) continue;
      let mx = 0, mz = 0;
      mine.forEach(c => { mx += c.x; mz += c.z; });
      mx /= mine.length; mz /= mine.length;
      const placed = [];
      for (const c of mine) {
        const x = WW.clamp(c.x - mx + SIDE(nation).cx, 5, W - 5), z = WW.clamp(c.z - mz + SIDE(nation).cz, 8, H - 8);
        const p = nearestOk(x, z, c.type, placed);
        placed.push(p);
        const o = { type: c.type, nation, x: p.x, z: p.z };
        for (const k of ['flag', 'cls', 'name', 'fs', 'heading']) if (c[k] !== undefined) o[k] = c[k];
        out.push(o);
      }
    }
    return out;
  }
  function spawnComposition(comp) {
    for (const c of comp) {
      const s = call('ships', 'spawn', c.type, c.nation, c.x, c.z, c.heading !== undefined ? c.heading : SIDE(c.nation).heading, c.cls, c.flag);
      if (s && c.fs) s.fs = c.fs;           // a scenario role (Normandy fire support: ai_fire_support.js)
      if (s && c.name) s.name = c.name;     // a historical name (the composition knows which ship it is)
    }
  }
  function clearModules() {
    ALL_MODULES.forEach(m => call(m, 'clearAll'));
    WW.world.planes.length = 0;
    WW.world.ships.length = 0;
  }

  // ---------- round logic ----------
  const game = {
    mode: 'setup', state: 'setup', composition: null, winner: null, custom: false,
    roundTime: 0, victoryTime: 0, seed: 0, lastSink: 0, contactT: null, metT: null, endReason: null, noRetire: false, // noRetire: tests (no retire ending)
    hadMajor: {},
    // opts.keepMap: start on the current map (used by "Start battle" in setup mode)
    // opts.replay: a round record (WW.roundRec.capture, below): the look-ahead copy of the round (lookahead_worker.js)
    // starts the same round from the same state
    startRound(opts) {
      opts = opts || {};
      const rec = opts.replay || null;
      if (rec) { opts.keepMap = rec.keepMap; if (WW.terrain.seed !== rec.terrain) WW.terrain.generate(rec.terrain); }
      else if (!opts.keepMap || !WW.terrain.seed) {
        game.seed = (WW.rand() * 1e9) >>> 0; // WW.rand: the round after a seeded round replays too
        WW.terrain.generate(game.seed);
      }
      const rng0 = WW.randState();      // (before clearModules: damage.js rolls the round's wind there)
      if (rec) { WW.setRandState(rec.rng); WW.time.now = rec.now; }
      clearModules();
      if (rec) WW.roundRec.apply(rec); else game.rec = WW.roundRec.capture(opts.keepMap, rng0);
      game.stepN = 0;
      WW.stats.round++;
      game.winner = null; game.endReason = null; game.roundTime = 0; sideReset(); game.victoryTime = 0; game.lastSink = 0; game.contactT = null; game.metT = null; game.lastHit = 0;
      let comp;
      if (game.composition && game.composition.length) {
        comp = opts.keepMap ? game.composition : repositionComposition(game.composition);
      } else comp = randomComposition();
      game.state = 'battle';  // set before spawn so ships know a battle is live
      spawnComposition(comp);
      game.hadMajor = WW.perSide(n => afloat(n, true) > 0); game.hadCV = WW.world.ships.some(s => s.type === 'carrier');
      WW.emit('roundStart', { round: WW.stats.round, seed: game.seed });
    },
    // setup mode: fleets placed and waiting for Start (ships do not act in 'setup').
    // newMap: a fresh map (the composition is moved onto it); fresh: new random fleets for both sides.
    enterSetup(newMap, fresh) {
      game.mode = 'setup'; game.state = 'setup'; game.winner = null; game.infinite = false; // the ready screen waits for the user: never infinite
      if (newMap || !WW.terrain.seed) {
        game.seed = (Math.random() * 1e9) >>> 0; WW.terrain.generate(game.seed);
        if (!fresh && game.composition && game.composition.length) game.composition = repositionComposition(game.composition);
      }
      clearModules();
      if (fresh) { game.composition = randomComposition(); game.custom = false; }
      if (game.composition) {
        game.composition = game.composition.filter(c => WW.terrain.isNavigable(c.x, c.z, WW.SHIP_TYPES[c.type].minDepth));
        spawnComposition(game.composition);
      } else game.composition = [];
      WW.emit('setupStart', {});
    },
    // auto (screensaver): endless random battles on new maps
    enterAuto() { game.mode = 'auto'; game.composition = null; game.baseChoice = null; game.startRound(); }, // baseChoice: setup's Base button (island_base.js)
    // infinite (?infinite, the corner \u221e): auto battles that never wait for the user. The director camera only
    // (camera.js, freecam.js), no action report (aar_card.js), the chrome hides while idle (ui.js). Off: the battle runs on in auto mode.
    infinite: false,
    setInfinite(on) { game.infinite = !!on; if (on && (game.mode !== 'auto' || game.state === 'setup')) game.enterAuto(); return game.infinite; },
    randomComposition, minSpacing,
    spawnComposition,
    tonnage(nation) { return (call('ships', 'alive', nation) || []).reduce((s, sh) => s + (sh.stats ? sh.stats.tons : 0), 0) + (WW.islandBase ? WW.islandBase.tons(nation) : 0); }, // + an intact island base
    // reason: 'kill' (a side's surface fleet sunk) | 'retire' (the loser's survivors left the map) | 'time' | 'stall' | 'night' (both retire for the night) | 'lull' (a raid is over)
    endRound(winner, reason, loser) {
      game.state = 'victory'; game.winner = winner; game.victoryTime = 0; game.endReason = reason || 'time';
      WW.emit('victory', { winner, round: WW.stats.round, reason: game.endReason, loser: loser || null });
    }
  };
  WW.game = game;
  WW.on('shipSunk', () => { game.lastSink = game.roundTime; });
  WW.on('contact', () => { if (game.state === 'battle' && game.contactT === null) game.contactT = game.roundTime; }); // the sides first met
  const act = () => { if (game.state === 'battle') game.lastHit = game.roundTime; }; // the stall clock restarts on any attack
  WW.on('shipHit', act); WW.on('weaponDropped', act);

  // How a round ends (updateGame):
  //  - a side is out when it has no carrier, battleship, cruiser or destroyer left afloat (its submarines and PT boats
  //    scatter; a side that started without such ships, a PT or submarine raid, is out when all its ships are gone).
  //    The way its last ship went decides the reason: over its home edge (a broken side running home, endgame.js):
  //    'retire'; sunk: 'kill' (the winner ran down the last of them; ships that got away earlier are counted in
  //    WW.endgame.stats.escaped). Both out at once: tonnage.
  //  - a broken side that has got clear also retires (the big map's long run home is no battle): RETIRE_MIN s after
  //    the break, once no enemy gun ship is within CLEAR_R of any of its ships and no armed enemy bomber is within
  //    CLEAR_AIR of them or sent against one of them, for CLEAR_T s running (the pursuit has lost touch and no strike
  //    is on its way). A pursuit that is not biting counts as lost touch too: no hit on the broken side for STALE_T s
  //    (a stern chase at equal speed out of gun reach is no battle; STALE_AIR while the pursuer has a carrier that can
  //    fly: time to spot and launch a pursuit strike) and no strike bound for it. Only once the surface fleets have
  //    met (game.metT: the first shell between their ships): a side broken by the air war alone must run for home
  //    (or be caught on the way) so the fleets almost always meet; unless it has no surface force left to meet them
  //    with (SURFACE_K). Not with game.noRetire (tests).
  //  - the time limit, ROUND_TIMEOUT, is stretched for a pursuit: while a broken side still has ships afloat it
  //    is at least PURSUE_T s after the side broke, at most EXT_MAX s past the limit. Then tonnage decides ('time').
  const PURSUE_T = 150, EXT_MAX = 150, RETIRE_MIN = 40, CLEAR_R = 300, CLEAR_AIR = 400, CLEAR_T = 8, STALE_T = 35, STALE_AIR = 42;
  //  - the round is not cut off in the middle of a fight: the limit stretches to ACT_T s after the last attack (a hit,
  //    a weapon dropped or fired), at most EXT_MAX s past it; in a round with no carrier on either side (no air war
  //    to fill the approach: a battle line steams 330 s to meet) the limit runs from first contact, CONTACT_K x
  //    ROUND_TIMEOUT after it, at most 2 x EXT_MAX past it.
  //  - a pursuit that is closing (WW.endgame.closing: an enemy gun ship getting nearer the broken side) keeps the
  //    broken side from counting as clear; both sides with nothing to fight a night action with end it ('night',
  //    WW.endgame.nightOut).
  const ACT_T = 30, CONTACT_K = 0.75;
  const GUNS = { battleship: 1, cruiser: 1, destroyer: 1 }, clearT = {}, harmT = {}, OUT = { transit: 1, inbound: 1, attack: 1 }; // OUT: a bomber on its way in (not one flying home armed)
  WW.on('shipHit', e => { if (e && e.ship && harmT[e.ship.nation] !== undefined) harmT[e.ship.nation] = game.roundTime; });
  const FLEET = { carrier: 1, battleship: 1, cruiser: 1, destroyer: 1 }; // the surface fleets (not PT pickets, submarines or the island's batteries)
  WW.on('shellFired', e => { // the fleets have met: a fleet ship's gun (not MG) fired at an enemy fleet ship
    const t = e && e.proj && e.proj.target;
    if (game.metT === null && game.state === 'battle' && e.cal !== 'mg' && e.ship && FLEET[e.ship.type] && !e.ship.isBase && t && FLEET[t.type] && !t.isBase && t.nation !== e.ship.nation) game.metT = game.roundTime;
  });
  // the broken side n is out of the enemy's reach: no enemy gun ship within CLEAR_R, no armed enemy bomber within
  // CLEAR_AIR or bound for one of its ships (its own target or its wave's)
  function clear(n) {
    const S = WW.world.ships, P = WW.world.planes, mine = q => q && q.nation === n && q.alive;
    for (const p of P) if (p.alive && p.nation !== n && p.ordnance && OUT[p.state] && (p.kind === 'dive' || p.kind === 'torpedo') && (mine(p.target) || mine(p.wave && p.wave.target))) return false;
    for (const p of P) if (p.alive && (p.kind === 'dive' || p.kind === 'torpedo') && p.ordnance && (p.state === 'attack' || p.phase) && !(p.target && (!p.target.alive || p.target.sinking))) return false;   // an attack under way (either side's, on a ship still afloat) drops before the card
    const B = WW.fleetCmd && WW.fleetCmd.side(n);
    if (B && game.roundTime - Math.max(harmT[n], B.brokenAt) >= (canStrike(WW.enemyOf(n)) ? STALE_AIR : STALE_T)) return true; // the pursuit is not biting
    for (const s of S) {
      if (!s.alive || s.sinking || s.nation !== n || s.type === 'submarine') continue;
      for (const e of S) if (e.alive && !e.sinking && e.nation !== n && GUNS[e.type] && WW.dist2(s.x, s.z, e.x, e.z) < CLEAR_R * CLEAR_R) return false;
      for (const p of P) if (p.alive && p.nation !== n && p.ordnance && OUT[p.state] && (p.kind === 'dive' || p.kind === 'torpedo') && WW.dist2(s.x, s.z, p.x, p.z) < CLEAR_AIR * CLEAR_AIR) return false;
    }
    return true;
  }
  // side n has a fit carrier and the light to fly from it
  function canStrike(n) {
    const D = WW.dayNight;
    if (D && !D.canFly()) return false;
    return WW.world.ships.some(s => s.alive && !s.sinking && s.nation === n && s.type === 'carrier' && s.hp >= WW.fleetGroups.CRIP * s.maxHp);
  }
  // The pursuit is spent: nothing of broken side n sunk for SPENT_T s since it broke (or since its last loss), no hit
  // on it for SPENT_HIT s, no bomber of the enemy on its drop (attacking, within SPENT_AIR) at one of its ships and no enemy
  // gun ship in reach (SPENT_GUN x its range; merge A/B: kills 19 -> 17% without this): the side retires even
  // though enemy guns or strikes are still about (a pursuit that scores only the odd hit is no finish; the tail after
  // the climax was 2-3 minutes)
  const SPENT_T = 75, SPENT_HIT = 20, SPENT_AIR = 200, SPENT_GUN = 1.5, lostT = {};
  WW.on('shipSunk', s => { if (s && lostT[s.nation] !== undefined && game.state === 'battle') lostT[s.nation] = game.roundTime; });
  // per-side clocks, zeroed for this scenario's sides at round start
  function sideReset() { for (const n of WW.sides()) clearT[n] = harmT[n] = 0; }
  WW.on('roundStart', () => { for (const n of WW.sides()) lostT[n] = 0; });
  function spent(n, B) {
    const t = game.roundTime;
    if (t - Math.max(B.brokenAt, lostT[n]) < SPENT_T || t - harmT[n] < SPENT_HIT) return false;
    for (const p of WW.world.planes) if (p.alive && p.nation !== n && p.ordnance && p.state === 'attack' && p.target && p.target.nation === n && WW.dist2(p.x, p.z, p.target.x, p.target.z) < SPENT_AIR * SPENT_AIR) return false;
    // a pursuer in reach is still at it: an enemy gun ship within SPENT_GUN x its main battery range of one of her ships
    for (const e of WW.world.ships) {
      if (!e.alive || e.sinking || e.nation === n || !GUNS[e.type]) continue;
      const R = e.stats.guns[0].range * SPENT_GUN;
      for (const s of WW.world.ships) if (s.alive && !s.sinking && s.nation === n && s.type !== 'submarine' && WW.dist2(s.x, s.z, e.x, e.z) < R * R) return false;
    }
    return true;
  }
  function gotClear(n, dt) {
    const B = WW.fleetCmd && WW.fleetCmd.side(n);
    if (game.noRetire || (game.metT === null && B && B.fitTons >= SURFACE_K * B.startTons) || !B || !B.brokenAt || B.posture !== 'withdraw' || game.roundTime - B.brokenAt < RETIRE_MIN || !afloat(n, true) || (!clear(n) && !spent(n, B)) || (WW.endgame && WW.endgame.closing(n))) { clearT[n] = 0; return false; }
    clearT[n] += dt;
    return clearT[n] >= CLEAR_T;
  }
  const MAJOR = { carrier: 1, battleship: 1, cruiser: 1, destroyer: 1 };
  // the fleets-met gate on the retire (above) holds only a side that still has a surface force to meet the enemy with:
  // fit gun tonnage at least SURFACE_K of what it started with (fleet_cmd.js BREAK); a lone carrier or the three
  // destroyers left of a sunk battle line just go home
  const SURFACE_K = 0.15;
  const afloat = (n, major) => WW.world.ships.reduce((k, s) => k + (s.alive && s.nation === n && (!major || MAJOR[s.type]) ? 1 : 0), 0);
  function out(n) {
    if (game.noRetire || !game.hadMajor[n]) return afloat(n, false) === 0; // noRetire: tests (the ASW hunt runs on)
    return afloat(n, true) === 0;
  }
  function deadline() {
    const T0 = WW.cfg.ROUND_TIMEOUT, MAX = T0 + EXT_MAX;
    let T = Math.max(T0, Math.min(MAX, (game.lastHit || 0) + ACT_T));
    if (!game.hadCV && game.contactT !== null) T = Math.max(T, Math.min(T0 + 2 * EXT_MAX, game.contactT + CONTACT_K * T0));
    if (WW.fleetCmd) for (const n of WW.sides()) {
      const B = WW.fleetCmd.side(n);
      if (B && B.brokenAt && afloat(n, true)) T = Math.max(T, Math.min(MAX, B.brokenAt + PURSUE_T));
    }
    return T;
  }
  game.deadline = deadline;
  const lastEscaped = n => !!(WW.endgame && WW.endgame.lastOut && WW.endgame.lastOut(n) === 'escaped');

  function updateGame(dt) {
    if (scn().updateGame && scn().updateGame(dt, game)) return; // the scenario's own ending rules (Normandy: normandy_game.js)
    if (game.state === 'battle') {
      game.roundTime += dt;
      // A side left with only submarines ends the round when nothing has been sunk, hit or attacked (a weapon dropped or fired) for SUB_STALL s since the
      // sides met (no sub hide-and-seek). The clock starts SUB_CLOSE s after first contact (the big map takes longer
      // than SUB_STALL to cross) and restarts at every attack and while the boats still get nearer the enemy (WW.endgame
      // subCloseT: an ambush closing in is no stall); with no contact at all, the round ends after SUB_SEARCH s.
      const subOnly = n => (call('ships', 'alive', n) || []).every(s => s.type === 'submarine');
      const stalled = (subOnly('USN') || subOnly('IJN')) && (game.contactT === null ? game.roundTime > SUB_SEARCH
        : game.roundTime - Math.max(game.lastSink, game.lastHit || 0, game.contactT + SUB_CLOSE, WW.endgame ? WW.endgame.subCloseT() : 0) > SUB_STALL);
      const oU = out('USN'), oJ = out('IJN'), gU = gotClear('USN', dt), gJ = gotClear('IJN', dt);
      if (!oU && !oJ && (gU !== gJ)) { const loser = gU ? 'USN' : 'IJN'; game.endRound(WW.enemyOf(loser), 'retire', loser); }
      else if (oU || oJ) {
        if (oU && oJ) { const tu = game.tonnage('USN'), tj = game.tonnage('IJN'); game.endRound(tu > tj ? 'USN' : tj > tu ? 'IJN' : null, 'kill'); }
        else { const loser = oU ? 'USN' : 'IJN'; game.endRound(WW.enemyOf(loser), lastEscaped(loser) ? 'retire' : 'kill', loser); }
      } else if (WW.endgame && (WW.endgame.nightOut() || WW.endgame.lullOut())) { // both retire for the night; a raid that is over
        const tu = game.tonnage('USN'), tj = game.tonnage('IJN');
        game.endRound(tu > tj ? 'USN' : tj > tu ? 'IJN' : null, WW.endgame.nightOut() ? 'night' : 'lull');
      } else if (game.roundTime >= deadline() || stalled) {
        const tu = game.tonnage('USN'), tj = game.tonnage('IJN');
        game.endRound(tu > tj ? 'USN' : tj > tu ? 'IJN' : null, stalled ? 'stall' : 'time');
      }
    } else if (game.state === 'victory') {
      game.victoryTime += dt;
      if (game.victoryTime >= VICTORY_TIME) {
        if (game.mode === 'auto') game.startRound();
        else game.enterSetup(true, !game.custom); // standalone battles: back to fleets placed and waiting on a new map
      }
    }
  }

  // ---------- loop ----------
  function step(dt) {
    WW.time.dt = dt; WW.time.now += dt;
    call('terrain', 'update', dt);
    call('dayNight', 'update', dt); call('weather', 'update', dt); call('nightOps', 'update', dt); // daylight.js, weather.js, night_ops.js
    call('intel', 'update', dt);   // fog of war: contact tables (intel.js), before the AI reads them
    call('fleetCmd', 'update', dt); // side commanders + danger fields (fleet_cmd.js, ai_threat.js), every ~2 s
    call('ships', 'update', dt);
    call('islandBase', 'update', dt); // the island air base: repairs, coastal guns, base planes (island_base.js, land_air.js)
    call('coastDefence', 'update', dt); // Normandy: the strongpoints' guns, MG cones and mortar zones (coast_defence*.js)
    call('landingCraft', 'update', dt); // Normandy: the landing craft (landing_craft.js)
    call('infantry', 'update', dt);     // Normandy: the squads ashore and their fight (infantry*.js)
    call('offmapAir', 'update', dt);    // Normandy: B-24s, P-47s, Spitfires, Fw 190s from off the map (air_offmap.js)
    call('endgame', 'update', dt);  // escapes off the map, survivor pickups, scuttling (endgame.js)
    call('shipFires', 'update', dt); // fires, flooding, damage control (ship_fires.js)
    call('charge', 'update', dt);   // smoke screens, escorts charging to save a carrier (ai_charge.js)
    call('air', 'update', dt);
    call('combat', 'update', dt);
    if (!WW.simOnly) { call('fx', 'update', dt); call('lifeboats', 'update', dt); } // visual only
    updateGame(dt);
  }
  // The live game steps the sim in FIXED steps of LIVE_STEP sim s (camera5): the same steps in the same order whatever the
  // frame rate, the time scale or the slow motion, so a second copy of the round (lookahead_worker.js) stepping the same
  // LIVE_STEP from the same round record (game.rec) reproduces it bit for bit, ahead of the screen. At 1x and 60 fps it is
  // one step a frame (as before); a frame takes as many whole steps as its sim time holds and carries the remainder
  // (acc). A frame never shrinks or skips a step: when the steps of one frame cost more than STEP_BUDGET ms of wall time
  // (a high time scale on a slow machine) the rest waits and the backlog is capped (the battle then runs slower than asked,
  // never differently). The tests' fastForward keeps its 0.05 s steps (their baselines); __sim.stepFixed(n) runs n live steps.
  const LIVE_STEP = 1 / 120, STEP_BUDGET = 30, MAX_BACKLOG = 0.5;
  let acc = 0;
  // WW.afterStep(n): optional hook after each live step (n: the round's step count): the look-ahead worker's log, tests
  function stepLive() { step(LIVE_STEP); game.stepN = (game.stepN || 0) + 1; if (WW.afterStep) WW.afterStep(game.stepN); }
  // (SNAP: a frame within a quarter step of a whole number of steps takes that number, so the frame clock's jitter at 1x
  // never makes a 0-step frame followed by a 2-step one: the sim clock runs a hair elastic against the wall clock instead)
  const SNAP = 0.25;
  function advance(simDt) {
    acc += simDt;
    let n = Math.floor(acc / LIVE_STEP + SNAP);
    if (n <= 0) return;
    acc -= n * LIVE_STEP;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      stepLive();
      if (i < n - 1 && performance.now() - t0 > STEP_BUDGET) { acc = Math.min(acc + (n - 1 - i) * LIVE_STEP, MAX_BACKLOG); break; }
    }
  }
  WW.on('roundStart', () => { acc = 0; });
  // Frame pacing (battery): at most FPS_CAP frames a second (a 120 Hz ProMotion display otherwise draws, and steps
  // the sim, twice as often for no visible gain), and FPS_IDLE on the ready screen while the user is not touching
  // anything. A skipped rAF does nothing at all (no sim step, no render) and leaves `last` alone, so the next drawn
  // frame's rdt is the whole real time since the last one: the sim still advances by real time (in render mode its
  // step size already follows the frame rate; the tests drive __sim.fastForward and never see this). The 3 ms slack
  // keeps a 60 cap on a 120 Hz display at every other vsync instead of alternating 8 / 16 ms. A hidden tab gets no
  // rAF at all (the browser stops it; audio.js mutes on visibilitychange). ?nocap: uncapped (fps / stress tests).
  const FPS_CAP = 60, FPS_IDLE = 30, IDLE_AFTER = 1500, NO_CAP = /[?&]nocap\b/.test(location.search);
  let lastInput = -1e9;
  const touched = () => { lastInput = performance.now(); };
  ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'].forEach(k => window.addEventListener(k, touched, { passive: true }));
  WW.frames = { drawn: 0, skipped: 0 };
  function frameCap(t) {
    if (NO_CAP) return 0;
    if (game.state === 'setup' && t - lastInput > IDLE_AFTER) return FPS_IDLE;
    return FPS_CAP;
  }
  // A low camera rides a little above the local sea: never under a crest. A soft floor (the sea's own smooth motion),
  // so a shot held low over the swell rises and falls with it instead of cutting through it.
  const SEA_CLEAR = 0.5;
  function seaFloor() {
    if (!WW.sea || !WW.sea.active || !camera) return;
    const p = camera.position, h = WW.sea.height(p.x, p.z) + SEA_CLEAR;
    if (p.y < h + 0.3) { p.y = Math.max(p.y, h + 0.3 * Math.exp((p.y - h - 0.3) / 0.3)); camera.updateMatrixWorld(); }
  }
  let last = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const cap = frameCap(t);
    if (cap && last && t - last < 1000 / cap - 3) { WW.frames.skipped++; return; }
    WW.frames.drawn++;
    const rdt = last ? Math.min(0.1, (t - last) / 1000) : 1 / 60;
    last = t;
    call('shipSwell', 'unpose');   // Normandy: the swell's pose comes off first (ship_swell.js)
    call('dmgVis', 'unpose');      // the sim never sees the visual settling / trim (damage_visuals.js)
    // WW.time.warp: brief cinematic slow motion set by the director camera (camera.js); 1 otherwise
    advance(rdt * WW.time.scale * BASE_SPEED * (WW.time.warp || 1));
    call('sea', 'update', rdt);     // the sea state's clock and the round's sea (sea_state.js), visual only; before what rides it
    call('dmgVis', 'pose', rdt);    // battle damage: settling and trim, knocked-out turrets, toppling masts
    call('shipSwell', 'pose', rdt); // Normandy: the ships heave, pitch and roll on the swell (ship_swell.js), visual only
    call('water', 'update', rdt);  // water, foam and glitter animate on real time
    call('cam', 'update', rdt);
    seaFloor();                     // the camera never dips under a crest (sea_state.js), visual only
    if (WW.afterCamera) for (const f of WW.afterCamera) f(rdt); // camera-facing visuals re-faced to this frame's camera (a cut: no frame sized for the old view)
    call('crew', 'update', rdt);    // sailors: after the camera (distance LOD), visual only
    call('baseFx', 'update', rdt);  // the island base: craters, fires, parked planes (base_fx.js), visual only
    call('normandyProps', 'update', rdt); // Normandy: the beach obstacles still standing (terrain_normandy_props.js), visual only
    call('waves', 'update', rdt);         // Normandy: the rough sea and the surf (waves.js), visual only; before what rides it
    call('normandySky', 'update', rdt);   // Normandy: the low cloud deck, smoke from the bluffs (normandy_sky.js), visual only
    call('normandyFleet', 'update', rdt); // Normandy: the transport area, the boats before the sim has them (normandy_fleet.js), visual only; before landingFx
    call('landingFx', 'update', rdt);     // Normandy: the landing craft (models_landing.js), visual only
    call('infantryFx', 'update', rdt);    // Normandy: the men and tanks ashore (models_infantry.js), visual only
    call('beachheadFx', 'update', rdt);   // Normandy: craters, scorch, wire, hulks, debris (beachhead_fx.js), visual only
    call('vehicleFx', 'update', rdt);     // Normandy: vehicles, DUKWs, lane markers, draw blocks, leaders, prisoners (vehicles_fx.js), visual only
    call('hocFx', 'update', rdt);         // Normandy: the Rangers' ropes and ladders at Pointe du Hoc (hoc_fx.js), visual only
    call('rocketBarrage', 'update', rdt); // Normandy: the LCT(R)s' rockets at H-5 (rocket_barrage.js), visual only
    call('defenceFx', 'update', rdt);     // Normandy: the German crews, MG 42 tracers, gun flashes (defence_fx.js), visual only
    call('offmapAirFx', 'update', rdt);   // Normandy: the planes from England (air_offmap_fx.js), visual only
    call('dmgVis', 'draw', rdt);    // scorch / hole decals and deck wrecks on the posed hulls
    call('audio', 'update', rdt);  // after the camera: the listener follows this frame's camera
    call('sky', 'update', rdt);
    call('ui', 'update', rdt);
    if (WW.post) WW.post.render(scene, camera); else renderer.render(scene, camera);
    call('cam', 'afterRender');
  }

  function setScale(n) { WW.time.scale = WW.clamp(+n || 1, 0.1, 64); }
  // onStep: optional test hook, called after every sim step of fastForward
  function fastForward(seconds, onStep) {
    let left = seconds;
    if (WW.lookahead && WW.lookahead.desync && seconds > 0) WW.lookahead.desync('fastForward');   // (0.05 s steps: not the live round the worker copies)
    call('shipSwell', 'unpose');
    call('dmgVis', 'unpose');
    while (left > 1e-9) { const d = Math.min(STEP, left); step(d); left -= d; if (onStep) onStep(d); }
  }
  function stepFixed(n, onStep) {
    call('shipSwell', 'unpose');
    call('dmgVis', 'unpose');
    for (let i = 0; i < n; i++) { stepLive(); if (onStep) onStep(); }
  }
  window.__sim = { stats: WW.stats, game: WW.game, world: WW.world, fastForward, setScale, stepFixed, LIVE_STEP,
    focus: (x, z, w, hold) => call('cam', 'focus', x, z, w, hold), snapCamera: () => call('cam', 'snap') };

  // Sim-only mode (WW.simOnly, index.html?sim): a scene graph for the models (the sim reads turret, deck and hull
  // transforms) but no renderer, no visual modules and no render loop; the tests drive __sim.fastForward.
  // Visual-only modules are switched off: fx calls become no-ops, airFx / airProps are absent (callers check).
  function bootSim() {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(VFOV, 16 / 9, 1, 5000);
    WW.scene = scene; WW.camera = camera;
    const nop = () => {};
    for (const k in WW.fx) if (typeof WW.fx[k] === 'function') WW.fx[k] = nop;
    WW.airFx = null; WW.airProps = null;
    ['terrain', 'models', 'combat', 'ships', 'air'].forEach(m => {
      try { call(m, 'init'); } catch (e) { console.error('init ' + m, e); }
    });
    startGame();
  }
  function startGame() {
    if (/[?&]infinite\b/.test(location.search)) game.setInfinite(true); // endless director-camera battles
    else if (/[?&]auto\b/.test(location.search)) game.enterAuto(); // screensaver / tests: start fighting at once
    else game.enterSetup(true, true);                         // random fleets placed and waiting for Start
  }

  function boot() {
    if (WW.simOnly) return bootSim();
    setupRenderer();
    ['audio', 'sky', 'terrain', 'models', 'fx', 'combat', 'ships', 'air', 'crew', 'lifeboats', 'dmgVis', 'ui', 'freecam'].forEach(m => {
      try { call(m, 'init'); } catch (e) { console.error('init ' + m, e); }
    });
    call('post', 'init');
    resize();
    call('cam', 'init');
    startGame();
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.WW);
