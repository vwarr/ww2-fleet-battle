// main.js (owner A): renderer, camera, loop, round logic (WW.game), window.__sim.
window.WW = window.WW || {};
(function (WW) {
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
  const STEP = 0.05;          // max sim step
  const BASE_SPEED = 0.5;     // calm pace: the UI's 1x runs the simulation at half speed
  const VICTORY_TIME = 9;     // sim seconds the banner shows
  const SUB_STALL = 60;       // see updateGame
  const SIDE = { USN: { x0: 15, x1: 115, cx: 65, heading: 0 }, IJN: { x0: 365, x1: 465, cx: 415, heading: Math.PI } };

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
    camera = new THREE.PerspectiveCamera(VFOV, 16 / 9, 1, 4000);
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
      const dir = nation === 'USN' ? 1 : -1, rearX = nation === 'USN' ? 26 : W - 26, cz = WW.randRange(115, 185);
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
    mode: 'auto', state: 'setup', composition: null, winner: null,
    roundTime: 0, victoryTime: 0, seed: 0, lastSink: 0,
    // opts.keepMap: start on the current map (used by "Start battle" in setup mode)
    startRound(opts) {
      opts = opts || {};
      if (!opts.keepMap || !WW.terrain.seed) {
        game.seed = (Math.random() * 1e9) >>> 0;
        WW.terrain.generate(game.seed);
      }
      clearModules();
      WW.stats.round++;
      game.winner = null; game.roundTime = 0; game.victoryTime = 0; game.lastSink = 0;
      let comp;
      if (game.composition && game.composition.length) {
        comp = opts.keepMap ? game.composition : repositionComposition(game.composition);
      } else comp = randomComposition();
      game.state = 'battle';  // set before spawn so ships know a battle is live
      spawnComposition(comp);
      WW.emit('roundStart', { round: WW.stats.round, seed: game.seed });
    },
    // setup mode: keep the map, clear ships, show the composition (ships do not act in 'setup')
    enterSetup(newMap) {
      game.mode = 'setup'; game.state = 'setup'; game.winner = null;
      if (newMap || !WW.terrain.seed) { game.seed = (Math.random() * 1e9) >>> 0; WW.terrain.generate(game.seed); }
      clearModules();
      if (game.composition) {
        game.composition = game.composition.filter(c => WW.terrain.isNavigable(c.x, c.z, WW.SHIP_TYPES[c.type].minDepth));
        spawnComposition(game.composition);
      } else game.composition = [];
      WW.emit('setupStart', {});
    },
    enterAuto() { game.mode = 'auto'; game.composition = null; game.startRound(); },
    randomComposition, minSpacing,
    spawnComposition,
    tonnage(nation) { return (call('ships', 'alive', nation) || []).reduce((s, sh) => s + (sh.stats ? sh.stats.tons : 0), 0); },
    endRound(winner) {
      game.state = 'victory'; game.winner = winner; game.victoryTime = 0;
      WW.emit('victory', { winner, round: WW.stats.round });
    }
  };
  WW.game = game;
  WW.on('shipSunk', () => { game.lastSink = game.roundTime; });

  function updateGame(dt) {
    if (game.state === 'battle') {
      game.roundTime += dt;
      const u = (call('ships', 'alive', 'USN') || []).length, j = (call('ships', 'alive', 'IJN') || []).length;
      // A side left with only submarines, and no sinking for SUB_STALL s, ends the round (no sub hide-and-seek).
      const subOnly = n => (call('ships', 'alive', n) || []).every(s => s.type === 'submarine');
      const stalled = game.roundTime - game.lastSink > SUB_STALL && (subOnly('USN') || subOnly('IJN'));
      if (u === 0 || j === 0) game.endRound(u > 0 ? 'USN' : j > 0 ? 'IJN' : null);
      else if (game.roundTime >= WW.cfg.ROUND_TIMEOUT || stalled) {
        const tu = game.tonnage('USN'), tj = game.tonnage('IJN');
        game.endRound(tu > tj ? 'USN' : tj > tu ? 'IJN' : null);
      }
    } else if (game.state === 'victory') {
      game.victoryTime += dt;
      if (game.victoryTime >= VICTORY_TIME) game.startRound();
    }
  }

  // ---------- loop ----------
  function step(dt) {
    WW.time.dt = dt; WW.time.now += dt;
    call('terrain', 'update', dt);
    call('ships', 'update', dt);
    call('air', 'update', dt);
    call('combat', 'update', dt);
    call('fx', 'update', dt);
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
    // WW.time.warp: brief cinematic slow motion set by the director camera (camera.js); 1 otherwise
    advance(rdt * WW.time.scale * BASE_SPEED * (WW.time.warp || 1));
    call('water', 'update', rdt);  // water, foam and glitter animate on real time
    call('cam', 'update', rdt);
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
    while (left > 1e-9) { const d = Math.min(STEP, left); step(d); left -= d; if (onStep) onStep(d); }
  }
  window.__sim = { stats: WW.stats, game: WW.game, world: WW.world, fastForward, setScale,
    focus: (x, z, w, hold) => call('cam', 'focus', x, z, w, hold), snapCamera: () => call('cam', 'snap') };

  function boot() {
    setupRenderer();
    ['audio', 'sky', 'terrain', 'models', 'fx', 'combat', 'ships', 'air', 'ui', 'freecam'].forEach(m => {
      try { call(m, 'init'); } catch (e) { console.error('init ' + m, e); }
    });
    call('post', 'init');
    resize();
    call('cam', 'init');
    game.startRound();
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.WW);
