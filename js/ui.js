// ui.js (owner A): retro HUD, victory banner, setup-mode placement, HP bars.
window.WW = window.WW || {};
(function (WW) {
  const TYPES = ['carrier', 'battleship', 'cruiser', 'destroyer', 'submarine', 'pt'];
  const SHORT = { carrier: 'CV', battleship: 'BB', cruiser: 'CA', destroyer: 'DD', submarine: 'SS', pt: 'PT' };
  let el = {}, hudOn = true, barsOn = true, selType = 'destroyer', selNation = 'USN';
  const bars = [];           // pool of HP bar divs
  const v3 = new THREE.Vector3();
  let lastHud = 0, msgTimer = 0;

  const $ = (tag, cls, parent, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };
  function btn(parent, text, fn, cls) {
    const b = $('button', 'btn' + (cls ? ' ' + cls : ''), parent, text);
    b.addEventListener('click', e => { e.stopPropagation(); fn(b); });
    return b;
  }

  function init() {
    const root = document.getElementById('hud') || $('div', '', document.body);
    root.id = 'hud';
    el.root = root;
    el.bars = $('div', 'bars', root);
    el.panel = $('div', 'panel', root);
    el.round = $('div', 'row title', el.panel);
    el.usn = $('div', 'row usn', el.panel);
    el.ijn = $('div', 'row ijn', el.panel);
    el.info = $('div', 'row dim', el.panel);
    const sp = $('div', 'row', el.panel);
    el.speed = [1, 2, 4].map(n => btn(sp, n + 'X', () => { WW.time.scale = n; }));
    el.mode = btn($('div', 'row', el.panel), 'MODE: AUTO', () => {
      if (WW.game.state === 'setup') WW.game.enterAuto();
      else WW.game.enterSetup(false);
    });
    $('div', 'row dim small', el.panel, 'H HUD  B BARS  C CAMERA');

    // setup palette
    el.setup = $('div', 'panel setup', root);
    $('div', 'row title', el.setup, 'FLEET SETUP');
    const pr = $('div', 'row grid', el.setup);
    el.typeBtns = TYPES.map(t => btn(pr, WW.SHIP_TYPES[t].name.toUpperCase(), () => { selType = t; }));
    el.nat = btn($('div', 'row', el.setup), 'SIDE: USN', b => { selNation = WW.enemyOf(selNation); b.textContent = 'SIDE: ' + selNation; b.style.color = WW.NATIONS[selNation].ui; });
    $('div', 'row dim small', el.setup, 'CLICK WATER: PLACE  RIGHT-CLICK: REMOVE');
    const ar = $('div', 'row', el.setup);
    btn(ar, 'RANDOMIZE', randomizeFleets);
    btn(ar, 'CLEAR', clearFleets);
    btn(ar, 'START', startBattle, 'go');
    el.count = $('div', 'row dim small', el.setup);
    el.msg = $('div', 'msg', root);

    el.banner = $('div', 'banner', root);

    const canvas = document.getElementById('game');
    canvas.addEventListener('mousedown', onMouse);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', onKey);
  }

  function say(text) { el.msg.textContent = text; msgTimer = 2.5; }

  function onKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'h') { hudOn = !hudOn; el.panel.style.display = hudOn ? '' : 'none'; }
    else if (k === 'b') barsOn = !barsOn;
    else if (k === 'c' && WW.cam) say('CAMERA: ' + WW.cam.toggle().toUpperCase());
    else if (k === '1' || k === '2' || k === '4') WW.time.scale = +k;
  }

  // ---- setup placement ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function groundPoint(e) {
    const r = e.target.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, WW.camera);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }
  function onMouse(e) {
    if (WW.game.state !== 'setup') return;
    const p = groundPoint(e);
    if (!p) return;
    if (e.button === 2) return removeNearest(p.x, p.z);
    if (e.button !== 0) return;
    const st = WW.SHIP_TYPES[selType];
    if (!WW.terrain.isNavigable(p.x, p.z, st.minDepth)) return say('TOO SHALLOW FOR ' + st.name.toUpperCase());
    for (const c of WW.game.composition) {
      const need = (st.length + WW.SHIP_TYPES[c.type].length) * 0.5;
      if (WW.dist2(p.x, p.z, c.x, c.z) < need * need) return say('TOO CLOSE TO ANOTHER SHIP');
    }
    const c = { type: selType, nation: selNation, x: p.x, z: p.z };
    WW.game.composition.push(c);
    WW.game.spawnComposition([c]);
  }
  function removeNearest(x, z) {
    const comp = WW.game.composition;
    let best = -1, bd = 40 * 40;
    comp.forEach((c, i) => { const d = WW.dist2(x, z, c.x, c.z); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return;
    comp.splice(best, 1);
    respawnSetup(); // clearAll + respawn the remaining composition
  }
  function respawnSetup() { WW.game.enterSetup(false); }
  function randomizeFleets() { WW.game.composition = WW.game.randomComposition(); respawnSetup(); }
  function clearFleets() { WW.game.composition = []; respawnSetup(); }
  function startBattle() {
    const c = WW.game.composition || [];
    if (!c.some(s => s.nation === 'USN') || !c.some(s => s.nation === 'IJN')) return say('BOTH SIDES NEED SHIPS');
    WW.game.startRound({ keepMap: true });
  }

  // ---- HP bars ----
  function getBar(i) {
    while (bars.length <= i) {
      const b = $('div', 'hpbar', el.bars);
      b._fill = $('div', 'fill', b);
      bars.push(b);
    }
    return bars[i];
  }
  function updateBars() {
    let n = 0;
    if (barsOn && WW.camera) {
      const w = window.innerWidth, h = window.innerHeight;
      for (const s of WW.world.ships) {
        if (!s.alive || s.submerged) continue;
        v3.set(s.x, (s.hullTop || 4) + 1.5, s.z).project(WW.camera);
        if (v3.z > 1) continue;
        const b = getBar(n++);
        const fr = WW.clamp(s.hp / (s.maxHp || 1), 0, 1);
        const ppu = WW.cam && WW.cam.pxPerUnit ? WW.cam.pxPerUnit() : 2.6; // bar follows the zoom
        const len = WW.clamp(Math.round((s.stats ? s.stats.length : 10) * ppu * 0.7), 10, 90);
        b.style.display = 'block';
        b.style.width = len + 'px';
        b.style.transform = 'translate(' + Math.round((v3.x * 0.5 + 0.5) * w - len / 2) + 'px,' + Math.round((-v3.y * 0.5 + 0.5) * h - 4) + 'px)';
        b._fill.style.width = Math.round(fr * 100) + '%';
        b._fill.style.background = fr > 0.6 ? '#5fd35f' : fr > 0.3 ? '#e8c840' : '#e04030';
        b.style.borderColor = s.nation === 'USN' ? WW.NATIONS.USN.ui : WW.NATIONS.IJN.ui;
      }
    }
    for (let i = n; i < bars.length; i++) bars[i].style.display = 'none';
  }

  function sideLine(nation) {
    const ships = WW.world.ships.filter(s => s.nation === nation && s.alive);
    const byType = {};
    ships.forEach(s => { byType[s.type] = (byType[s.type] || 0) + 1; });
    const planes = WW.world.planes.filter(p => p.nation === nation && p.alive).length;
    const parts = TYPES.filter(t => byType[t]).map(t => SHORT[t] + byType[t]);
    return nation + ' ' + String(ships.length).padStart(2) + ' SHIPS  ' + planes + ' AIR  ' + parts.join(' ');
  }

  function update(rdt) {
    if (!el.root) return;
    const g = WW.game;
    lastHud += rdt;
    if (lastHud > 0.25) { // text refresh at 4 Hz
      lastHud = 0;
      const t = g.state === 'battle' ? Math.max(0, WW.cfg.ROUND_TIMEOUT - g.roundTime) : 0;
      el.round.textContent = 'ROUND ' + WW.stats.round + (g.state === 'battle' ? '  ' + Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '  ' + g.state.toUpperCase());
      el.usn.textContent = sideLine('USN');
      el.ijn.textContent = sideLine('IJN');
      el.info.textContent = 'SUNK ' + WW.stats.shipsSunk + '  PLANES LOST ' + WW.stats.planesLost;
      el.speed.forEach((b, i) => b.classList.toggle('on', WW.time.scale === [1, 2, 4][i]));
      el.mode.textContent = g.state === 'setup' ? 'MODE: SETUP > AUTO' : g.mode === 'setup' ? 'EDIT FLEET' : 'MODE: AUTO > SETUP';
      const inSetup = g.state === 'setup';
      el.setup.style.display = inSetup ? '' : 'none';
      if (inSetup) {
        el.typeBtns.forEach((b, i) => b.classList.toggle('on', TYPES[i] === selType));
        el.nat.textContent = 'SIDE: ' + selNation;
        el.nat.style.color = WW.NATIONS[selNation].ui;
        const c = g.composition || [];
        el.count.textContent = 'USN ' + c.filter(s => s.nation === 'USN').length + '  IJN ' + c.filter(s => s.nation === 'IJN').length;
      }
    }
    if (g.state === 'victory') {
      el.banner.style.display = 'block';
      el.banner.textContent = g.winner ? g.winner + ' VICTORY' : 'DRAW';
      el.banner.style.color = g.winner ? WW.NATIONS[g.winner].ui : '#ffffff';
    } else el.banner.style.display = 'none';
    if (msgTimer > 0) { msgTimer -= rdt; el.msg.style.display = msgTimer > 0 ? 'block' : 'none'; }
    updateBars();
  }

  WW.ui = { init, update, say };
})(window.WW);
