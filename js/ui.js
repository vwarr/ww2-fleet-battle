// ui.js: HUD (setup mode; fades out in battle), setup-mode placement, film overlay (captions), fullscreen.
window.WW = window.WW || {};
(function (WW) {
  const TYPES = ['carrier', 'battleship', 'cruiser', 'destroyer', 'submarine', 'pt'];
  const SHORT = { carrier: 'CV', battleship: 'BB', cruiser: 'CA', destroyer: 'DD', submarine: 'SS', pt: 'PT' };
  let el = {}, hudPeek = false, selType = 'destroyer', selNation = 'USN';
  let lastHud = 0, msgTimer = 0, capEnd = 0, s0 = null; // s0: WW.stats at battle start (the panel counts this battle only)

  const $ = (tag, cls, parent, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  };
  function btn(parent, text, fn, cls) {
    const b = $('button', 'btn' + (cls ? ' ' + cls : ''), parent, text);
    b.addEventListener('click', e => { e.stopPropagation(); fn(b); if (WW.audio) WW.audio.play('ui.click', { ui: true }); });
    return b;
  }
  // sound: starts muted; the first enable must happen inside a click or key press (browser rule)
  const AU = () => WW.audio && WW.audio.available ? WW.audio : null;
  function toggleSound() {
    const a = AU(); if (!a) return say('Sound is not available in this browser');
    a.toggle(); soundLabels(); say('Sound ' + (a.enabled ? 'on' : 'off'));
  }
  function soundLabels() {
    const a = AU(); if (!a || !el.sound) return;
    el.sound.textContent = a.pending ? '\ud83d\udd0a tap' : a.enabled ? '\ud83d\udd0a' : '\ud83d\udd07';
    el.sound.classList.toggle('off', !a.enabled && !a.pending);
    el.soundPanel.textContent = 'Sound: ' + (a.pending ? 'tap' : a.enabled ? 'on' : 'off');
    el.soundPanel.classList.toggle('on', a.enabled);
  }

  function init() {
    const root = document.getElementById('hud') || $('div', '', document.body);
    root.id = 'hud';
    el.root = root;
    el.panel = $('div', 'panel hidden', root); // shown by update() in setup; hidden in battle, no flash
    el.corner = $('div', 'corner', root); // small always-reachable icons while the panel is hidden (gone in fullscreen)
    btn(el.corner, '\u2630', () => { hudPeek = true; }, 'menu').title = 'Menu (H)';
    el.fsBtns = [btn(el.corner, '\u26f6', toggleFullscreen, 'menu')];
    el.fsBtns[0].title = 'Fullscreen';
    el.sound = btn(el.corner, '', toggleSound, 'menu');
    el.sound.title = 'Sound (M)';
    el.round = $('div', 'row title', el.panel);
    el.usn = $('div', 'row usn', el.panel);
    el.ijn = $('div', 'row ijn', el.panel);
    el.info = $('div', 'row dim', el.panel);
    const sp = $('div', 'row', el.panel);
    el.speed = [1, 2, 4].map(n => btn(sp, n + '\u00d7', () => { WW.time.scale = n; }));
    const mr = $('div', 'row', el.panel);
    el.mode = btn(mr, 'Auto battles', () => {
      if (WW.game.state === 'setup') WW.game.enterAuto();
      else if (WW.game.mode === 'auto') WW.game.enterSetup(false, true); // fresh random fleets on this map
      else WW.game.enterSetup(false);                                    // back to the fleets you placed
    });
    el.newRound = btn(mr, 'New battle', newRound);
    el.fsBtns.push(btn(mr, 'Fullscreen', toggleFullscreen));
    el.close = btn(mr, 'Hide', () => { hudPeek = false; });
    const sr = $('div', 'row', el.panel);
    el.soundPanel = btn(sr, 'Sound: off', toggleSound);
    el.vol = $('input', 'vol', sr);
    Object.assign(el.vol, { type: 'range', min: 0, max: 100, step: 1, title: 'Volume' });
    el.vol.value = Math.round((WW.audio ? WW.audio.volume : 0.7) * 100);
    el.vol.addEventListener('input', () => { if (WW.audio) WW.audio.setVolume(el.vol.value / 100); WW.emit('uiVolume', { v: el.vol.value / 100 }); });
    el.vol.addEventListener('keydown', e => e.stopPropagation()); // arrow keys change the volume, not the camera
    el.sound.dataset.audio = el.soundPanel.dataset.audio = '1'; // the gesture that starts a remembered "on" is the toggle itself
    if (!AU()) { el.sound.style.display = 'none'; sr.style.display = 'none'; }
    soundLabels();
    $('div', 'row dim small', el.panel, 'H panel   N new battle   C camera   T tilt-shift   P pixels   M sound');
    $('div', 'row dim small', el.panel, 'Drag orbit \u00b7 Scroll zoom \u00b7 Right-drag / WASD pan\nQ E turn \u00b7 R F camera up / down \u00b7 Click ship follow');

    // setup palette
    el.setup = $('div', 'panel setup', root);
    $('div', 'row title', el.setup, 'Fleet setup');
    $('div', 'row dim small', el.setup, 'The fleets are ready. Press Start, or change them first.');
    const pr = $('div', 'row grid', el.setup);
    el.typeBtns = TYPES.map(t => btn(pr, WW.SHIP_TYPES[t].name, () => { selType = t; }));
    el.nat = btn($('div', 'row', el.setup), 'Side: USN', b => { selNation = WW.enemyOf(selNation); b.textContent = 'Side: ' + selNation; b.style.color = (selNation === 'USN' ? '#3d6fb0' : '#c0504a'); });
    $('div', 'row dim small', el.setup, 'Click water: place    Right-click: remove');
    const ar = $('div', 'row', el.setup);
    btn(ar, 'Randomize', randomizeFleets);
    btn(ar, 'Clear', clearFleets);
    btn(ar, 'New map', () => WW.game.enterSetup(true));
    btn(ar, 'Start', startBattle, 'go');
    el.count = $('div', 'row dim small', el.setup);
    el.msg = $('div', 'msg', root);

    el.film = document.getElementById('film');
    el.cap = el.film.querySelector('.caption');
    el.capMain = el.cap.querySelector('.main'); el.capSub = el.cap.querySelector('.sub');
    WW.on('roundStart', () => { s0 = Object.assign({}, WW.stats); hudPeek = false; });
    WW.on('setupStart', () => { capEnd = 0; el.cap.classList.remove('on'); });
    WW.on('victory', d => caption(d.winner ? d.winner + ' victory' : 'Stalemate', lossLine(), 5, false));

    const canvas = document.getElementById('game');
    canvas.addEventListener('mousedown', onMouse);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('keydown', onKey);
  }

  // whole page (canvas + HUD) so the panel still works in fullscreen; webkit prefix for Safari
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  function toggleFullscreen() {
    const d = document, r = d.documentElement;
    try {
      if (fsEl()) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else (r.requestFullscreen || r.webkitRequestFullscreen).call(r);
    } catch (e) { say('Fullscreen is not available'); }
  }
  // victory subtitle: ships each side lost in this battle
  function lossLine() {
    const lost = n => WW.world.ships.filter(s => s.nation === n && !s.alive).length;
    const sh = k => k === 1 ? ' ship' : ' ships';
    return 'USN lost ' + lost('USN') + sh(lost('USN')) + '  \u00b7  IJN lost ' + lost('IJN') + sh(lost('IJN'));
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
    else if (k === 'n') newRound();
    else if (k === 'c' && WW.cam) say('Camera: ' + WW.cam.toggle());
    else if (k === 'p' && WW.view) say('Pixel mode ' + (WW.view.togglePixel() ? 'on' : 'off'));
    else if (k === 'm' && !e.repeat) toggleSound();
    else if (k === 't') say('Tilt-shift ' + (el.film.classList.toggle('notilt') ? 'off' : 'on'));
    else if (k === '1' || k === '2' || k === '4') WW.time.scale = +k;
    if (k.length === 1 && 'cptm'.includes(k) && !e.repeat) WW.emit('uiToggle', { on: !/off|map/.test(el.msg.textContent) }); // toggle tick (audio_amb.js)
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
    if (!WW.terrain.isNavigable(p.x, p.z, st.minDepth)) return uiError('Too shallow for a ' + st.name.toLowerCase());
    for (const c of WW.game.composition) {
      const need = WW.game.minSpacing ? WW.game.minSpacing(selType, c.type) : (st.length + WW.SHIP_TYPES[c.type].length) * 0.5;
      if (WW.dist2(p.x, p.z, c.x, c.z) < need * need) return uiError('Too close to another ship');
    }
    const c = { type: selType, nation: selNation, x: p.x, z: p.z };
    WW.game.composition.push(c); WW.game.custom = true;
    WW.game.spawnComposition([c]);
    WW.emit('uiPlace', { x: p.x, z: p.z });
  }
  function uiError(text) { say(text); WW.emit('uiError', {}); }
  function removeNearest(x, z) {
    const comp = WW.game.composition;
    let best = -1, bd = 40 * 40;
    comp.forEach((c, i) => { const d = WW.dist2(x, z, c.x, c.z); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return;
    comp.splice(best, 1); WW.game.custom = true;
    WW.emit('uiRemove', {});
    respawnSetup(); // clearAll + respawn the remaining composition
  }
  function respawnSetup() { WW.game.enterSetup(false); }
  function randomizeFleets() { WW.game.composition = WW.game.randomComposition(); respawnSetup(); }
  function clearFleets() { WW.game.composition = []; WW.game.custom = true; respawnSetup(); }
  // a new map with new random fleets, placed and waiting (auto mode: the next battle starts at once)
  function newRound() {
    if (WW.game.mode === 'auto' && WW.game.state !== 'setup') { WW.game.startRound(); say('New battle'); }
    else WW.game.enterSetup(true, true);
  }
  function startBattle() {
    const c = WW.game.composition || [];
    if (!c.some(s => s.nation === 'USN') || !c.some(s => s.nation === 'IJN')) return uiError('Both sides need ships');
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
      el.round.textContent = g.state === 'battle' ? 'Battle   ' + Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') + ' left'
        : g.state === 'setup' ? 'Ready' : 'Battle over';
      el.usn.textContent = sideLine('USN');
      el.ijn.textContent = sideLine('IJN');
      const since = k => WW.stats[k] - (inSetup || !s0 ? WW.stats[k] : s0[k]);
      el.info.textContent = 'Sunk ' + since('shipsSunk') + '   planes lost ' + since('planesLost') + (WW.aces ? WW.aces.infoText() : '');
      el.speed.forEach((b, i) => b.classList.toggle('on', WW.time.scale === [1, 2, 4][i]));
      el.fsBtns[1].textContent = fsEl() ? 'Exit fullscreen' : 'Fullscreen';
      soundLabels();
      el.mode.textContent = g.state === 'setup' ? 'Auto battles' : g.mode === 'setup' ? 'Edit fleet' : 'Set up fleets';
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
    el.corner.classList.toggle('hidden', inSetup || hudPeek || !!fsEl());
    el.close.style.display = inSetup ? 'none' : '';
    el.film.classList.toggle('cinema', !inSetup && !(WW.cam && WW.cam.mode === 'map'));
    if (capEnd && performance.now() > capEnd) { capEnd = 0; el.cap.classList.remove('on'); }
    if (msgTimer > 0) { msgTimer -= rdt; el.msg.style.display = msgTimer > 0 ? 'block' : 'none'; }
  }

  WW.ui = { init, update, say, caption, captionOn: () => capEnd > 0 }; // caption / captionOn: air_captions.js
})(window.WW);
