// ui.js: HUD (setup mode; fades out in battle), setup-mode placement, film overlay (letterbox, captions).
window.WW = window.WW || {};
(function (WW) {
  const TYPES = ['carrier', 'battleship', 'cruiser', 'destroyer', 'submarine', 'pt'];
  const SHORT = { carrier: 'CV', battleship: 'BB', cruiser: 'CA', destroyer: 'DD', submarine: 'SS', pt: 'PT' };
  let el = {}, hudPeek = false, selType = 'destroyer', selNation = 'USN';
  let lastHud = 0, msgTimer = 0, capEnd = 0;

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
    el.panel = $('div', 'panel', root);
    el.round = $('div', 'row title', el.panel);
    el.usn = $('div', 'row usn', el.panel);
    el.ijn = $('div', 'row ijn', el.panel);
    el.info = $('div', 'row dim', el.panel);
    const sp = $('div', 'row', el.panel);
    el.speed = [1, 2, 4].map(n => btn(sp, n + '\u00d7', () => { WW.time.scale = n; }));
    el.mode = btn($('div', 'row', el.panel), 'MODE: AUTO', () => {
      if (WW.game.state === 'setup') WW.game.enterAuto();
      else WW.game.enterSetup(false);
    });
    $('div', 'row dim small', el.panel, 'H panel   C camera   T tilt-shift   P pixels');

    // setup palette
    el.setup = $('div', 'panel setup', root);
    $('div', 'row title', el.setup, 'Fleet setup');
    const pr = $('div', 'row grid', el.setup);
    el.typeBtns = TYPES.map(t => btn(pr, WW.SHIP_TYPES[t].name, () => { selType = t; }));
    el.nat = btn($('div', 'row', el.setup), 'Side: USN', b => { selNation = WW.enemyOf(selNation); b.textContent = 'Side: ' + selNation; b.style.color = (selNation === 'USN' ? '#3d6fb0' : '#c0504a'); });
    $('div', 'row dim small', el.setup, 'Click water: place    Right-click: remove');
    const ar = $('div', 'row', el.setup);
    btn(ar, 'Randomize', randomizeFleets);
    btn(ar, 'Clear', clearFleets);
    btn(ar, 'Start', startBattle, 'go');
    el.count = $('div', 'row dim small', el.setup);
    el.msg = $('div', 'msg', root);

    el.film = document.getElementById('film');
    el.cap = el.film.querySelector('.caption');
    el.capMain = el.cap.querySelector('.main'); el.capSub = el.cap.querySelector('.sub');
    WW.on('roundStart', d => caption('Round ' + d.round, '', 3, true));
    WW.on('setupStart', () => { capEnd = 0; el.cap.classList.remove('on'); });
    WW.on('victory', d => caption(d.winner ? d.winner + ' victory' : 'Stalemate', 'Round ' + d.round, 5, false));

    const canvas = document.getElementById('game');
    canvas.addEventListener('mousedown', onMouse);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', onKey);
  }

  function say(text) { el.msg.textContent = text; msgTimer = 2.5; }
  // film-style caption: fades in, holds, fades out
  function caption(main, sub, secs, small) {
    el.capMain.textContent = main; el.capSub.textContent = sub || '';
    el.cap.classList.toggle('small', !!small);
    el.cap.classList.add('on'); capEnd = performance.now() + secs * 1000; // wall-clock, so slow frames cannot stretch it
  }

  function onKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'h') hudPeek = !hudPeek;
    else if (k === 'c' && WW.cam) say('Camera: ' + WW.cam.toggle());
    else if (k === 'p' && WW.view) say('Pixel mode ' + (WW.view.togglePixel() ? 'on' : 'off'));
    else if (k === 't') say('Tilt-shift ' + (el.film.classList.toggle('notilt') ? 'off' : 'on'));
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
    if (!WW.terrain.isNavigable(p.x, p.z, st.minDepth)) return say('Too shallow for a ' + st.name.toLowerCase());
    for (const c of WW.game.composition) {
      const need = WW.game.minSpacing ? WW.game.minSpacing(selType, c.type) : (st.length + WW.SHIP_TYPES[c.type].length) * 0.5;
      if (WW.dist2(p.x, p.z, c.x, c.z) < need * need) return say('Too close to another ship');
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
    if (!c.some(s => s.nation === 'USN') || !c.some(s => s.nation === 'IJN')) return say('Both sides need ships');
    WW.game.startRound({ keepMap: true });
  }

  function sideLine(nation) {
    const ships = WW.world.ships.filter(s => s.nation === nation && s.alive);
    const byType = {};
    ships.forEach(s => { byType[s.type] = (byType[s.type] || 0) + 1; });
    const planes = WW.world.planes.filter(p => p.nation === nation && p.alive).length;
    const parts = TYPES.filter(t => byType[t]).map(t => SHORT[t] + byType[t]);
    return nation + '  ' + ships.length + ' ships  ' + planes + ' aircraft   ' + parts.join(' ');
  }

  function update(rdt) {
    if (!el.root) return;
    const g = WW.game, inSetup = g.state === 'setup';
    lastHud += rdt;
    if (lastHud > 0.25) { // text refresh at 4 Hz
      lastHud = 0;
      const t = g.state === 'battle' ? Math.max(0, WW.cfg.ROUND_TIMEOUT - g.roundTime) : 0;
      el.round.textContent = 'Round ' + WW.stats.round + (g.state === 'battle' ? '   ' + Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '   ' + g.state);
      el.usn.textContent = sideLine('USN');
      el.ijn.textContent = sideLine('IJN');
      el.info.textContent = 'Sunk ' + WW.stats.shipsSunk + '   planes lost ' + WW.stats.planesLost;
      el.speed.forEach((b, i) => b.classList.toggle('on', WW.time.scale === [1, 2, 4][i]));
      el.mode.textContent = g.state === 'setup' ? 'Back to auto' : g.mode === 'setup' ? 'Edit fleet' : 'Set up fleets';
      el.setup.style.display = inSetup ? '' : 'none';
      if (inSetup) {
        el.typeBtns.forEach((b, i) => b.classList.toggle('on', TYPES[i] === selType));
        el.nat.textContent = 'Side: ' + selNation;
        el.nat.style.color = (selNation === 'USN' ? '#3d6fb0' : '#c0504a');
        const c = g.composition || [];
        el.count.textContent = 'USN ' + c.filter(s => s.nation === 'USN').length + '  IJN ' + c.filter(s => s.nation === 'IJN').length;
      }
    }
    // HUD shows in setup; in battle it fades away (H shows it again)
    el.panel.classList.toggle('hidden', !inSetup && !hudPeek);
    el.film.classList.toggle('cinema', !inSetup && !(WW.cam && WW.cam.mode === 'map'));
    if (capEnd && performance.now() > capEnd) { capEnd = 0; el.cap.classList.remove('on'); }
    if (msgTimer > 0) { msgTimer -= rdt; el.msg.style.display = msgTimer > 0 ? 'block' : 'none'; }
  }

  WW.ui = { init, update, say };
})(window.WW);
