// plot_table.js - WW.plot: the admiral's plotting room (visual / UI only). In map view (C) during a battle the
// screen becomes a plot table: a paper chart on a warm wooden table, drawn on a 2D canvas over the 3D view (the
// 3D render is skipped while the plot covers it, so map view is cheap). The chart (cached per map and screen
// size): paper, sea grid with edge letters, a compass rose, island outlines from WW.terrain.depthAt (marching
// squares, the 4-unit line dotted), shallows washed in blue, land hatched. The live layer (plot_tokens.js)
// draws painted toy tokens, plane markers, strike tracks, pencilled uncertainty circles and pinned notes.
// Whose plot: G cycles Omniscient (true positions) -> USN plot -> IJN plot (only what that side knows: WW.intel).
// X toggles the danger layer (the owner's WW.threat field: red guns / torpedoes, blue AA umbrella).
// Rules: Math.random only (wood grain, paper fibres); reads the sim, never writes it; nothing in sim-only mode.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  if (WW.simOnly) return;
  const W = WW.cfg.MAP_W, H = WW.cfg.MAP_H, BORDER = 34, OWNERS = [null, 'USN', 'IJN'];
  const P = { owner: null, danger: false, cv: null, ctx: null, base: null, key: '', s: 1, ox: 0, oy: 0, dpr: 1, vw: 0, vh: 0, px: 0, py: 0, pw: 0, ph: 0, onT: 0, active: false };
  let dz = null, dzT = -1, dzOwner = null;

  function make() {
    const c = document.createElement('canvas'); c.id = 'plot';
    const film = document.getElementById('film');
    document.body.insertBefore(c, film || null);
    P.cv = c; P.ctx = c.getContext('2d');
  }
  // screen layout: the chart fitted left of a strip kept for the diary card
  function layout() {
    const vw = window.innerWidth, vh = window.innerHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const R = vw > 900 ? Math.min(330, vw * 0.27) : 0, pad = Math.max(18, Math.min(vw, vh) * 0.045);
    const aw = vw - R - pad * 2, ah = vh - pad * 2, s = Math.min(aw / (W + BORDER * 2), ah / (H + BORDER * 2));
    const pw = (W + BORDER * 2) * s, ph = (H + BORDER * 2) * s, px = pad + (aw - pw) / 2, py = pad + (ah - ph) / 2;
    Object.assign(P, { vw, vh, dpr, s, pw, ph, px, py, ox: px + BORDER * s, oy: py + BORDER * s });
    if (P.cv.width !== Math.round(vw * dpr) || P.cv.height !== Math.round(vh * dpr)) { P.cv.width = Math.round(vw * dpr); P.cv.height = Math.round(vh * dpr); }
  }
  const sx = x => P.ox + x * P.s, sy = z => P.oy + z * P.s;

  // ---------- the static chart ----------
  function wood(g, w, h) {
    g.fillStyle = '#6e4529'; g.fillRect(0, 0, w, h);
    const plank = h / 5.5;
    for (let y = 0; y < h; y += 2) { // grain: long wavy streaks, a plank seam every `plank` px
      const k = Math.random();
      g.strokeStyle = k < 0.5 ? 'rgba(40,20,8,' + (0.05 + 0.1 * Math.random()) + ')' : 'rgba(190,120,70,' + (0.04 + 0.07 * Math.random()) + ')';
      g.lineWidth = 0.6 + Math.random() * 1.6;
      g.beginPath();
      const a = Math.random() * 6, f = 0.002 + Math.random() * 0.004, amp = 1 + Math.random() * 3;
      for (let x = 0; x <= w; x += 24) { const yy = y + Math.sin(x * f + a) * amp; x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
      g.stroke();
    }
    g.fillStyle = 'rgba(20,10,4,0.55)';
    for (let y = plank; y < h; y += plank) g.fillRect(0, y, w, 1.5);
    const lamp = g.createRadialGradient(w * 0.42, h * 0.45, h * 0.1, w * 0.42, h * 0.45, Math.max(w, h) * 0.75);
    lamp.addColorStop(0, 'rgba(255,214,150,0.22)'); lamp.addColorStop(0.6, 'rgba(0,0,0,0.05)'); lamp.addColorStop(1, 'rgba(10,5,0,0.55)');
    g.fillStyle = lamp; g.fillRect(0, 0, w, h);
  }
  function paper(g, d) {
    const x = P.px * d, y = P.py * d, w = P.pw * d, h = P.ph * d;
    g.save(); g.shadowColor = 'rgba(20,10,0,0.55)'; g.shadowBlur = 26 * d; g.shadowOffsetX = 6 * d; g.shadowOffsetY = 10 * d;
    g.fillStyle = '#efe5cb'; g.fillRect(x, y, w, h); g.restore();
    for (let i = 0; i < w * h / (60 * d * d); i++) { // fibres and foxing
      g.fillStyle = Math.random() < 0.5 ? 'rgba(120,90,50,0.06)' : 'rgba(255,255,240,0.1)';
      g.fillRect(x + Math.random() * w, y + Math.random() * h, (1 + Math.random() * 3) * d, 0.7 * d);
    }
    const edge = g.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.45, x + w / 2, y + h / 2, Math.max(w, h) * 0.62);
    edge.addColorStop(0, 'rgba(160,120,60,0)'); edge.addColorStop(1, 'rgba(150,105,50,0.22)');
    g.fillStyle = edge; g.fillRect(x, y, w, h);
  }
  // depth samples every 2 units; returns { v, nx, nz }
  function sampleDepth() {
    const c = 2, nx = Math.floor(W / c) + 1, nz = Math.floor(H / c) + 1, v = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = WW.terrain.depthAt(i * c, j * c);
    return { v, nx, nz, c };
  }
  // marching squares: the contour at depth `lvl` as segments in world units
  function contour(D, lvl, path) {
    const { v, nx, nz, c } = D;
    const lerp = (a, b) => (lvl - a) / (b - a);
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = v[j * nx + i], b = v[j * nx + i + 1], d = v[(j + 1) * nx + i], e = v[(j + 1) * nx + i + 1];
      const k = (a > lvl ? 1 : 0) | (b > lvl ? 2 : 0) | (e > lvl ? 4 : 0) | (d > lvl ? 8 : 0);
      if (k === 0 || k === 15) continue;
      const x = i * c, z = j * c, p = [];
      if ((k & 1) !== ((k >> 1) & 1)) p.push([x + lerp(a, b) * c, z]);
      if (((k >> 1) & 1) !== ((k >> 2) & 1)) p.push([x + c, z + lerp(b, e) * c]);
      if (((k >> 2) & 1) !== ((k >> 3) & 1)) p.push([x + lerp(d, e) * c, z + c]);
      if (((k >> 3) & 1) !== (k & 1)) p.push([x, z + lerp(a, d) * c]);
      for (let q = 0; q + 1 < p.length; q += 2) { path.moveTo(sx(p[q][0]), sy(p[q][1])); path.lineTo(sx(p[q + 1][0]), sy(p[q + 1][1])); }
    }
  }
  function chart(g, d) {
    const D = sampleDepth(), { v, nx, nz } = D;
    // land and shallows: a small raster stretched over the map rect (soft edges; the ink line hides them)
    const r = document.createElement('canvas'); r.width = nx; r.height = nz;
    const rg = r.getContext('2d'), img = rg.createImageData(nx, nz);
    for (let k = 0; k < nx * nz; k++) {
      const h = v[k], o = k * 4;
      if (h <= 0) { img.data[o] = 214; img.data[o + 1] = 186; img.data[o + 2] = 132; img.data[o + 3] = 255; }
      else if (h < 9) { img.data[o] = 120; img.data[o + 1] = 170; img.data[o + 2] = 196; img.data[o + 3] = Math.round(120 * (1 - h / 9)); }
    }
    rg.putImageData(img, 0, 0);
    g.save(); g.scale(d, d);
    g.fillStyle = 'rgba(150,185,200,0.10)'; g.fillRect(P.ox, P.oy, W * P.s, H * P.s); // a faint sea wash
    g.imageSmoothingEnabled = true; g.drawImage(r, P.ox, P.oy, W * P.s, H * P.s);
    // hatch the land: diagonal pencil lines kept to the land by the raster's alpha
    const hc = document.createElement('canvas'); hc.width = Math.ceil(W * P.s * d); hc.height = Math.ceil(H * P.s * d);
    const hg = hc.getContext('2d'); hg.drawImage(r, 0, 0, hc.width, hc.height);
    hg.globalCompositeOperation = 'source-in'; hg.strokeStyle = 'rgba(110,80,40,0.45)'; hg.lineWidth = d * 0.8;
    hg.beginPath(); for (let t = -hc.height; t < hc.width; t += 5 * d) { hg.moveTo(t, hc.height); hg.lineTo(t + hc.height, 0); } hg.stroke();
    g.globalAlpha = 0.5; g.drawImage(hc, P.ox, P.oy, W * P.s, H * P.s); g.globalAlpha = 1;
    // grid with edge letters / numbers
    g.strokeStyle = 'rgba(70,95,120,0.16)'; g.lineWidth = 0.8; g.beginPath();
    const GS = 80;
    for (let x = GS; x < W; x += GS) { g.moveTo(sx(x), sy(0)); g.lineTo(sx(x), sy(H)); }
    for (let z = GS; z < H; z += GS) { g.moveTo(sx(0), sy(z)); g.lineTo(sx(W), sy(z)); }
    g.stroke();
    g.fillStyle = 'rgba(60,50,40,0.6)'; g.font = Math.max(8, 10 * P.s) + 'px "Special Elite", "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let x = GS / 2, n = 0; x < W; x += GS, n++) { g.fillText(String.fromCharCode(65 + n), sx(x), P.oy - 8 * P.s); g.fillText(String.fromCharCode(65 + n), sx(x), sy(H) + 8 * P.s); }
    for (let z = GS / 2, n = 1; z < H; z += GS, n++) { g.fillText(n, P.ox - 9 * P.s, sy(z)); g.fillText(n, sx(W) + 9 * P.s, sy(z)); }
    // coast in ink, the shoal line dotted
    const coast = new Path2D(), shoal = new Path2D();
    contour(D, 0, coast); contour(D, 4, shoal);
    g.strokeStyle = 'rgba(70,90,110,0.45)'; g.lineWidth = 0.7; g.setLineDash([1.5, 2.5]); g.stroke(shoal); g.setLineDash([]);
    g.strokeStyle = '#4a3622'; g.lineWidth = 1.3; g.lineCap = 'round'; g.stroke(coast);
    // neat line: a double frame with a chequered degree scale
    g.strokeStyle = '#3b3328'; g.lineWidth = 1.2; g.strokeRect(P.ox, P.oy, W * P.s, H * P.s);
    const o = 4 * P.s; g.lineWidth = 0.6; g.strokeRect(P.ox - o, P.oy - o, W * P.s + 2 * o, H * P.s + 2 * o);
    g.fillStyle = '#3b3328';
    for (let x = 0; x < W; x += 40) if ((x / 40) % 2 === 0) { g.fillRect(sx(x), P.oy - o, 40 * P.s, o * 0.6); g.fillRect(sx(x), sy(H) + o * 0.4, 40 * P.s, o * 0.6); }
    for (let z = 0; z < H; z += 40) if ((z / 40) % 2 === 0) { g.fillRect(P.ox - o, sy(z), o * 0.6, 40 * P.s); g.fillRect(sx(W) + o * 0.4, sy(z), o * 0.6, 40 * P.s); }
    rose(g, 70, H - 70, 48);
    g.restore();
    // brass pins at the paper corners
    for (const [x, y] of [[P.px + 9, P.py + 9], [P.px + P.pw - 9, P.py + 9], [P.px + 9, P.py + P.ph - 9], [P.px + P.pw - 9, P.py + P.ph - 9]]) pin(g, x * d, y * d, 4 * d, '#c9a24a');
  }
  function rose(g, x, z, r) {
    const cx = sx(x), cy = sy(z), R = r * P.s;
    g.save(); g.translate(cx, cy); g.strokeStyle = 'rgba(90,60,40,0.55)'; g.fillStyle = 'rgba(90,60,40,0.55)'; g.lineWidth = 0.7;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(0, 0, R * 0.82, 0, Math.PI * 2); g.stroke();
    for (let a = 0; a < 360; a += 10) { const t = a * Math.PI / 180, l = a % 90 ? 0.92 : 0.82; g.beginPath(); g.moveTo(Math.sin(t) * R * l, -Math.cos(t) * R * l); g.lineTo(Math.sin(t) * R, -Math.cos(t) * R); g.stroke(); }
    for (let q = 0; q < 8; q++) { // the star: long cardinal points, short intercardinal ones
      const t = q * Math.PI / 4, l = q % 2 ? 0.45 : 0.78, w = 0.1;
      g.beginPath(); g.moveTo(Math.sin(t) * R * l, -Math.cos(t) * R * l); g.lineTo(Math.sin(t + Math.PI / 2) * R * w, -Math.cos(t + Math.PI / 2) * R * w);
      g.lineTo(0, 0); g.closePath(); g.fill();
    }
    g.font = 'bold ' + Math.max(9, 12 * P.s) + 'px "Cormorant Garamond", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', 0, -R * 1.18); g.restore();
  }
  function pin(g, x, y, r, col) {
    g.save(); g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(x + r * 0.5, y + r * 0.6, r, 0, Math.PI * 2); g.fill();
    const gr = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
    gr.addColorStop(0, '#fff6d8'); gr.addColorStop(0.35, col); gr.addColorStop(1, 'rgba(60,30,10,0.9)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.restore();
  }
  function buildBase() {
    const d = P.dpr, b = P.base || (P.base = document.createElement('canvas'));
    b.width = Math.round(P.vw * d); b.height = Math.round(P.vh * d);
    const g = b.getContext('2d');
    wood(g, b.width, b.height); paper(g, d); chart(g, d);
  }

  // ---------- danger layer: the owner's threat field, repainted when the commander rebuilds it ----------
  function danger(g) {
    const n = P.owner;
    if (!P.danger || !n || !WW.threat) return;
    const f = WW.threat.field(n);
    if (!dz || dz.width !== f.nx) { dz = document.createElement('canvas'); dz.width = f.nx; dz.height = f.nz; dzT = -1; }
    if (f.t !== dzT || dzOwner !== n) {
      dzT = f.t; dzOwner = n;
      const dg = dz.getContext('2d'), img = dg.createImageData(f.nx, f.nz), ref = WW.threat.DREF;
      for (let k = 0; k < f.nx * f.nz; k++) {
        const s = Math.min(1, f.surf[k] / (ref * 2.5)), a = Math.min(1, f.air[k] / 30), o = k * 4;
        if (s > 0.02) { img.data[o] = 200; img.data[o + 1] = 60; img.data[o + 2] = 40; img.data[o + 3] = Math.round(150 * s); }
        else if (a > 0.02) { img.data[o] = 60; img.data[o + 1] = 110; img.data[o + 2] = 200; img.data[o + 3] = Math.round(70 * a); }
      }
      dg.putImageData(img, 0, 0);
    }
    const ex = (f.nx - 1) * f.cell, ez = (f.nz - 1) * f.cell, c = f.cell * P.s / 2;
    g.save(); g.globalCompositeOperation = 'multiply'; g.imageSmoothingEnabled = true;
    g.drawImage(dz, sx(0) - c, sy(0) - c, ex * P.s + 2 * c, ez * P.s + 2 * c); g.restore();
  }

  // ---------- frame ----------
  const live = () => !!(WW.cam && WW.cam.mode === 'map' && WW.game && (WW.game.state === 'battle' || WW.game.state === 'victory'));
  function frame(rdt) {
    if (!P.cv) make();
    const on = live();
    if (on !== P.active) { P.active = on; P.onT = 0; P.cv.classList.toggle('on', on); }
    if (!on) return;
    P.onT += rdt;
    layout();
    const key = P.vw + 'x' + P.vh + '@' + P.dpr + '/' + (WW.terrain && WW.terrain.seed);
    if (key !== P.key) { P.key = key; buildBase(); if (WW.plotTokens) WW.plotTokens.resize(); }
    const g = P.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(P.base, 0, 0);
    g.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
    g.save(); g.beginPath(); g.rect(P.px, P.py, P.pw, P.ph); g.clip();
    danger(g);
    if (WW.plotTokens) WW.plotTokens.draw(g, P);
    g.restore();
    if (WW.plotTokens) WW.plotTokens.caption(g, P);
  }
  const camUpdate = WW.cam && WW.cam.update;
  if (camUpdate) WW.cam.update = function (rdt) { camUpdate.call(WW.cam, rdt); try { frame(rdt); } catch (e) { console.error('plot', e); } };
  // the plot covers the screen once faded in: skip the 3D render (camera.js still grabs a frame on the way out)
  const postRender = WW.post && WW.post.render;
  if (postRender) WW.post.render = function (scene, camera) { if (P.active && P.onT > 0.8) return; postRender.call(WW.post, scene, camera); };

  WW.plot = {
    P, sx, sy, pin, BORDER, active: () => P.active, owner: () => P.owner,
    set(n) { P.owner = n || null; return 'Plot: ' + (P.owner ? P.owner + ' plot' : 'omniscient'); },
    // G: into map view (the current plot), then Omniscient -> USN -> IJN
    cycle() {
      if (WW.cam && WW.cam.mode !== 'map') { WW.cam.toggle(); return 'Plot: ' + (P.owner ? P.owner + ' plot' : 'omniscient'); }
      return WW.plot.set(OWNERS[(OWNERS.indexOf(P.owner) + 1) % OWNERS.length]);
    },
    toggleDanger() { P.danger = !P.danger; return 'Danger layer ' + (P.danger ? (P.owner ? 'on' : 'on (pick a side with G)') : 'off'); },
    rebuild() { P.key = ''; }
  };
})(window.WW);
