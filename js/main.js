// main.js (owner A): renderer, camera, loop, round logic (WW.game), window.__sim.
window.WW = window.WW || {};
(function (WW) {
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H;
    const STEP = 0.05;          // max sim step
  const VICTORY_TIME = 9;     // sim seconds the banner shows
  const SUB_STALL = 60;       // see updateGame
  const SIDE = { USN: { x0: 15, x1: 115, cx: 65, heading: 0 }, IJN: { x0: 365, x1: 465, cx: 415, heading: Math.PI } };
  // Where each type sits inside its side's zone (0 = rear edge of the map, 1 = toward the enemy).
  const DEPTH_IN_ZONE = { carrier: [0.0, 0.3], battleship: [0.3, 0.6], cruiser: [0.4, 0.75], destroyer: [0.6, 1.0],
                          submarine: [0.7, 1.0], pt: [0.7, 1.0] };

  const call = (mod, fn, ...a) => { const m = WW[mod]; if (m && typeof m[fn] === 'function') return m[fn](...a); };
  const ALL_MODULES = ['fx', 'combat', 'air', 'ships'];

  // ---------- renderer / scene / camera ----------
  let renderer, scene, camera;
  const VFOV = 38;

  let pixelMode = false;     // optional retro mode (P key): low internal resolution, upscaled
  function setupRenderer() {
    const canvas = document.getElementById('game');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setClearColor(0xd6ecf4);
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
  }
  WW.view = { togglePixel() { pixelMode = !pixelMode; resize(); return pixelMode; } };

  // ---------- fleets ----------
  function randomComposition() {
    const counts = { carrier: WW.randInt(1, 2), battleship: WW.randInt(1, 2), cruiser: 2, destroyer: WW.randInt(3, 4),
                     submarine: WW.randInt(1, 2), pt: WW.randInt(2, 3) };
    const out = [];
    for (const nation of ['USN', 'IJN']) {
      const placed = [];
      for (const type in counts) for (let i = 0; i < counts[type]; i++) {
        const p = placeInZone(type, nation, placed);
        if (p) { placed.push(p); out.push({ type, nation, x: p.x, z: p.z }); }
      }
    }
    return out;
  }
  function zoneRange(type, nation) {
    const s = SIDE[nation], f = DEPTH_IN_ZONE[type];
    const a = s.x0 + (s.x1 - s.x0) * f[0], b = s.x0 + (s.x1 - s.x0) * f[1];
    return nation === 'USN' ? [a, b] : [s.x1 - (b - s.x0), s.x1 - (a - s.x0)];
  }
  function clearOf(x, z, len, placed) {
    for (const p of placed) {
      const need = (len + p.len) * 0.6 + 2;
      if (WW.dist2(x, z, p.x, p.z) < need * need) return false;
    }
    return true;
  }
  function placeInZone(type, nation, placed) {
    const st = WW.SHIP_TYPES[type], r = zoneRange(type, nation);
    for (let k = 0; k < 40; k++) {
      const p = WW.terrain.randomSeaPoint(st.minDepth, r[0], r[1]);
      if (p && clearOf(p.x, p.z, st.length, placed) && WW.terrain.isNavigable(p.x, p.z, st.minDepth)) return { x: p.x, z: p.z, len: st.length };
    }
    const p = WW.terrain.randomSeaPoint(st.minDepth, SIDE[nation].x0, SIDE[nation].x1);
    return p ? { x: p.x, z: p.z, len: st.length } : null;
  }
  // nearest navigable point (spiral search) that is clear of other ships
  function nearestOk(x, z, type, placed) {
    const st = WW.SHIP_TYPES[type];
    for (let r = 0; r < 160; r += 3) {
      const n = Math.max(1, Math.round(r / 2));
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2, px = WW.clamp(x + Math.cos(a) * r, 5, W - 5), pz = WW.clamp(z + Math.sin(a) * r, 8, H - 8);
        if (WW.terrain.isNavigable(px, pz, st.minDepth + 1) && clearOf(px, pz, st.length, placed)) return { x: px, z: pz, len: st.length };
      }
    }
    return { x, z, len: st.length };
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
    randomComposition,
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
    advance(rdt * WW.time.scale);
    call('cam', 'update', rdt);
    call('sky', 'update', rdt);
    call('ui', 'update', rdt);
    renderer.render(scene, camera);
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
    ['sky', 'terrain', 'models', 'fx', 'combat', 'ships', 'air', 'ui'].forEach(m => {
      try { call(m, 'init'); } catch (e) { console.error('init ' + m, e); }
    });
    resize();
    call('cam', 'init');
    game.startRound();
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.WW);
