// main.js (owner A): renderer, camera, loop, round logic (WW.game), window.__sim.
window.WW = window.WW || {};
(function (WW) {
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
  const STEP = 0.05;          // max sim step
  const BASE_SPEED = 0.5;     // calm pace: the UI's 1x runs the simulation at half speed
  const VICTORY_TIME = 9;     // sim seconds the banner shows
  const SUB_STALL = 60;       // see updateGame
  const SUB_CLOSE = 150;      // ... and starts this long after first contact (time to close: a sub makes 3.5 u/s)
  const SUB_SEARCH = 240;     // a subs-only side that never made contact: the stall ends the round after this long
  // start zones hug the west / east edges; the open sea between them is the approach
  const SIDE = { USN: { x0: 15, x1: 115, cx: 65, heading: 0 }, IJN: { x0: W - 115, x1: W - 15, cx: W - 65, heading: Math.PI } };

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
    const out = [];
    for (const nation of ['USN', 'IJN']) {
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
    for (const nation of ['USN', 'IJN']) {
      const mine = comp.filter(c => c.nation === nation);
      if (!mine.length) continue;
      let mx = 0, mz = 0;
      mine.forEach(c => { mx += c.x; mz += c.z; });
      mx /= mine.length; mz /= mine.length;
      const placed = [];
      for (const c of mine) {
        const x = WW.clamp(c.x - mx + SIDE[nation].cx, 5, W - 5), z = WW.clamp(c.z - mz + H / 2, 8, H - 8);
        const p = nearestOk(x, z, c.type, placed);
        placed.push(p);
        out.push({ type: c.type, nation, x: p.x, z: p.z });
      }
    }
    return out;
  }
  function spawnComposition(comp) {
    for (const c of comp) call('ships', 'spawn', c.type, c.nation, c.x, c.z, SIDE[c.nation].heading);
  }
  function clearModules() {
    ALL_MODULES.forEach(m => call(m, 'clearAll'));
    WW.world.planes.length = 0;
    WW.world.ships.length = 0;
  }

  // ---------- round logic ----------
  const game = {
    mode: 'setup', state: 'setup', composition: null, winner: null, custom: false,
    roundTime: 0, victoryTime: 0, seed: 0, lastSink: 0, contactT: null, endReason: null, noRetire: false, // noRetire: tests (no retire ending)
    hadMajor: { USN: true, IJN: true },
    // opts.keepMap: start on the current map (used by "Start battle" in setup mode)
    startRound(opts) {
      opts = opts || {};
      if (!opts.keepMap || !WW.terrain.seed) {
        game.seed = (WW.rand() * 1e9) >>> 0; // WW.rand: the round after a seeded round replays too
        WW.terrain.generate(game.seed);
      }
      clearModules();
      WW.stats.round++;
      game.winner = null; game.endReason = null; game.roundTime = 0; clearT.USN = clearT.IJN = 0; harmT.USN = harmT.IJN = 0; game.victoryTime = 0; game.lastSink = 0; game.contactT = null; game.lastHit = 0;
      let comp;
      if (game.composition && game.composition.length) {
        comp = opts.keepMap ? game.composition : repositionComposition(game.composition);
      } else comp = randomComposition();
      game.state = 'battle';  // set before spawn so ships know a battle is live
      spawnComposition(comp);
      game.hadMajor = { USN: afloat('USN', true) > 0, IJN: afloat('IJN', true) > 0 };
      WW.emit('roundStart', { round: WW.stats.round, seed: game.seed });
    },
    // setup mode: fleets placed and waiting for Start (ships do not act in 'setup').
    // newMap: a fresh map (the composition is moved onto it); fresh: new random fleets for both sides.
    enterSetup(newMap, fresh) {
      game.mode = 'setup'; game.state = 'setup'; game.winner = null;
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
    randomComposition, minSpacing,
    spawnComposition,
    tonnage(nation) { return (call('ships', 'alive', nation) || []).reduce((s, sh) => s + (sh.stats ? sh.stats.tons : 0), 0) + (WW.islandBase ? WW.islandBase.tons(nation) : 0); }, // + an intact island base
    // reason: 'kill' (a side's surface fleet sunk) | 'retire' (the loser's survivors left the map) | 'time' | 'stall'
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
  //    fly: time to spot and launch a pursuit strike) and no strike bound for it. Not with game.noRetire (tests).
  //  - the time limit, ROUND_TIMEOUT, is stretched for a pursuit: while a broken side still has ships afloat it
  //    is at least PURSUE_T s after the side broke, at most EXT_MAX s past the limit. Then tonnage decides ('time').
  const PURSUE_T = 150, EXT_MAX = 150, RETIRE_MIN = 40, CLEAR_R = 300, CLEAR_AIR = 400, CLEAR_T = 15, STALE_T = 30, STALE_AIR = 75;
  const GUNS = { battleship: 1, cruiser: 1, destroyer: 1 }, clearT = { USN: 0, IJN: 0 }, harmT = { USN: 0, IJN: 0 }, OUT = { transit: 1, inbound: 1, attack: 1 }; // OUT: a bomber on its way in (not one flying home armed)
  WW.on('shipHit', e => { if (e && e.ship && harmT[e.ship.nation] !== undefined) harmT[e.ship.nation] = game.roundTime; });
  // the broken side n is out of the enemy's reach: no enemy gun ship within CLEAR_R, no armed enemy bomber within
  // CLEAR_AIR or bound for one of its ships (its own target or its wave's)
  function clear(n) {
    const S = WW.world.ships, P = WW.world.planes, mine = q => q && q.nation === n && q.alive;
    for (const p of P) if (p.alive && p.nation !== n && p.ordnance && OUT[p.state] && (p.kind === 'dive' || p.kind === 'torpedo') && (mine(p.target) || mine(p.wave && p.wave.target))) return false;
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
  function gotClear(n, dt) {
    const B = WW.fleetCmd && WW.fleetCmd.side(n);
    if (game.noRetire || !B || !B.brokenAt || B.posture !== 'withdraw' || game.roundTime - B.brokenAt < RETIRE_MIN || !afloat(n, true) || !clear(n)) { clearT[n] = 0; return false; }
    clearT[n] += dt;
    return clearT[n] >= CLEAR_T;
  }
  const MAJOR = { carrier: 1, battleship: 1, cruiser: 1, destroyer: 1 };
  const afloat = (n, major) => WW.world.ships.reduce((k, s) => k + (s.alive && s.nation === n && (!major || MAJOR[s.type]) ? 1 : 0), 0);
  function out(n) {
    if (game.noRetire || !game.hadMajor[n]) return afloat(n, false) === 0; // noRetire: tests (the ASW hunt runs on)
    return afloat(n, true) === 0;
  }
  function deadline() {
    let T = WW.cfg.ROUND_TIMEOUT;
    if (WW.fleetCmd) for (const n of ['USN', 'IJN']) {
      const B = WW.fleetCmd.side(n);
      if (B && B.brokenAt && afloat(n, true)) T = Math.max(T, Math.min(WW.cfg.ROUND_TIMEOUT + EXT_MAX, B.brokenAt + PURSUE_T));
    }
    return T;
  }
  game.deadline = deadline;
  const lastEscaped = n => !!(WW.endgame && WW.endgame.lastOut && WW.endgame.lastOut(n) === 'escaped');

  function updateGame(dt) {
    if (game.state === 'battle') {
      game.roundTime += dt;
      // A side left with only submarines ends the round when nothing has been sunk, hit or attacked (a weapon dropped or fired) for SUB_STALL s since the
      // sides met (no sub hide-and-seek). The clock starts SUB_CLOSE s after first contact (the big map takes longer
      // than SUB_STALL to cross) and restarts at every attack; with no contact at all, the round ends after SUB_SEARCH s.
      const subOnly = n => (call('ships', 'alive', n) || []).every(s => s.type === 'submarine');
      const stalled = (subOnly('USN') || subOnly('IJN')) && (game.contactT === null ? game.roundTime > SUB_SEARCH
        : game.roundTime - Math.max(game.lastSink, game.lastHit || 0, game.contactT + SUB_CLOSE) > SUB_STALL);
      const oU = out('USN'), oJ = out('IJN'), gU = gotClear('USN', dt), gJ = gotClear('IJN', dt);
      if (!oU && !oJ && (gU !== gJ)) { const loser = gU ? 'USN' : 'IJN'; game.endRound(WW.enemyOf(loser), 'retire', loser); }
      else if (oU || oJ) {
        if (oU && oJ) { const tu = game.tonnage('USN'), tj = game.tonnage('IJN'); game.endRound(tu > tj ? 'USN' : tj > tu ? 'IJN' : null, 'kill'); }
        else { const loser = oU ? 'USN' : 'IJN'; game.endRound(WW.enemyOf(loser), lastEscaped(loser) ? 'retire' : 'kill', loser); }
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
    call('endgame', 'update', dt);  // escapes off the map, survivor pickups, scuttling (endgame.js)
    call('shipFires', 'update', dt); // fires, flooding, damage control (ship_fires.js)
    call('charge', 'update', dt);   // smoke screens, escorts charging to save a carrier (ai_charge.js)
    call('air', 'update', dt);
    call('combat', 'update', dt);
    if (!WW.simOnly) { call('fx', 'update', dt); call('lifeboats', 'update', dt); } // visual only
    updateGame(dt);
  }
  function advance(simDt) {
    const n = Math.max(1, Math.ceil(simDt / STEP - 1e-6));
    const d = simDt / n;
    for (let i = 0; i < n; i++) step(d);
  }
  let last = 0;
  function frame(t) {
    requestAnimationFrame(frame);
    const rdt = last ? Math.min(0.1, (t - last) / 1000) : 1 / 60;
    last = t;
    call('dmgVis', 'unpose');      // the sim never sees the visual settling / trim (damage_visuals.js)
    // WW.time.warp: brief cinematic slow motion set by the director camera (camera.js); 1 otherwise
    advance(rdt * WW.time.scale * BASE_SPEED * (WW.time.warp || 1));
    call('dmgVis', 'pose', rdt);    // battle damage: settling and trim, knocked-out turrets, toppling masts
    call('water', 'update', rdt);  // water, foam and glitter animate on real time
    call('cam', 'update', rdt);
    call('crew', 'update', rdt);    // sailors: after the camera (distance LOD), visual only
    call('baseFx', 'update', rdt);  // the island base: craters, fires, parked planes (base_fx.js), visual only
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
    call('dmgVis', 'unpose');
    while (left > 1e-9) { const d = Math.min(STEP, left); step(d); left -= d; if (onStep) onStep(d); }
  }
  window.__sim = { stats: WW.stats, game: WW.game, world: WW.world, fastForward, setScale,
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
    if (/[?&]auto\b/.test(location.search)) game.enterAuto(); // screensaver / tests: start fighting at once
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
