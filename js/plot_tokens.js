// plot_tokens.js - WW.plotTokens: the live layer of the plot table (plot_table.js; visual / UI only).
//  - Ships are little painted wooden blocks (sprites cached per type, nation and screen scale), shaped by type:
//    a carrier's flight deck and island, turrets on battleships and cruisers, a slim destroyer, a dark submarine.
//  - Planes are small painted crosses. Strike waves get a grease-pencil track: carrier -> the wave -> its target.
//  - Omniscient plot: every ship and plane at its true position. A side's plot: its own forces true; the enemy
//    from WW.intel only: tokens at last-known positions in the REPORTED type (flying-boat misidentification:
//    contact.reportedType, marked with a pencilled "?"), a pencil circle that grows with the contact's age (and
//    contact.err), a dashed course arrow, fading as the contact goes stale; pinned paper notes for its sighting
//    reports (WW.diary.notes). Sunk ships the side saw go down are crossed out where they sank.
// Wobble and tilt come from per-unit hashes (no per-frame randomness, so nothing shimmers).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  if (WW.simOnly) return;
  const PAINT = { USN: ['#4f78ad', '#33547e', '#7d9fca'], IJN: ['#c4574c', '#8a3a33', '#e08a7e'] };
  const PENCIL = { USN: 'rgba(40,70,130,', IJN: 'rgba(170,40,35,' };
  const BEAM = { carrier: 0.26, battleship: 0.24, cruiser: 0.2, destroyer: 0.17, submarine: 0.15, pt: 0.34 };
  const SHORT = { carrier: 'CV', battleship: 'BB', cruiser: 'CA', destroyer: 'DD', submarine: 'SS', pt: 'PT' };
  const sprites = new Map();
  let wrecks = [];
  const hash = o => { const v = o && (o.id || 0); return ((v * 2654435761) % 1000) / 1000; };
  const tokLen = t => 14 + (WW.SHIP_TYPES[t] ? WW.SHIP_TYPES[t].length : 12) * 2.1; // toy scale: about 2.5x the hull

  // ---------- token sprites ----------
  function hull(g, type, L, B) {
    g.beginPath();
    if (type === 'carrier') { g.moveTo(-L / 2, -B / 2); g.lineTo(L * 0.38, -B / 2); g.lineTo(L / 2, -B * 0.2); g.lineTo(L / 2, B * 0.2); g.lineTo(L * 0.38, B / 2); g.lineTo(-L / 2, B / 2); }
    else if (type === 'submarine') g.ellipse(0, 0, L / 2, B / 2, 0, 0, Math.PI * 2);
    else {
      const sb = type === 'pt' ? 0.1 : 0.22;
      g.moveTo(-L / 2, -B * 0.38); g.quadraticCurveTo(-L / 2, -B / 2, -L / 2 + B * sb, -B / 2); g.lineTo(L * 0.18, -B / 2);
      g.quadraticCurveTo(L * 0.4, -B / 2, L / 2, 0); g.quadraticCurveTo(L * 0.4, B / 2, L * 0.18, B / 2);
      g.lineTo(-L / 2 + B * sb, B / 2); g.quadraticCurveTo(-L / 2, B / 2, -L / 2, B * 0.38);
    }
    g.closePath();
  }
  function sprite(type, nation, faded) {
    const k = type + nation + (faded ? 1 : 0), have = sprites.get(k);
    if (have) return have;
    const P = WW.plot.P, u = P.s * P.dpr, L = tokLen(type) * u, B = L * (BEAM[type] || 0.2), th = Math.max(1.5, 0.09 * B);
    const c = document.createElement('canvas'), pad = 6 * P.dpr;
    c.width = Math.ceil(L + pad * 2); c.height = Math.ceil(B + pad * 2 + th);
    const g = c.getContext('2d'), col = PAINT[nation] || PAINT.USN;
    g.translate(c.width / 2, pad + B / 2);
    // block side (the thickness shows below the top face), then the painted top with a soft highlight
    g.save(); g.translate(0, th); hull(g, type, L, B); g.fillStyle = col[1]; g.fill(); g.restore();
    hull(g, type, L, B);
    const gr = g.createLinearGradient(0, -B / 2, 0, B / 2); gr.addColorStop(0, col[2]); gr.addColorStop(0.45, col[0]); gr.addColorStop(1, col[1]);
    g.fillStyle = type === 'submarine' ? '#4a4f57' : gr; g.fill();
    g.lineWidth = Math.max(0.8, u * 0.25); g.strokeStyle = 'rgba(30,20,10,0.55)'; g.stroke();
    const det = (x, y, w, h, f) => { g.fillStyle = f; g.fillRect(x - w / 2, y - h / 2, w, h); };
    const tur = (x, r) => { g.fillStyle = 'rgba(40,40,40,0.55)'; g.beginPath(); g.arc(x, 0, r, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, -r * 0.18, r * 1.4, r * 0.36); };
    if (type === 'carrier') {
      det(-L * 0.03, 0, L * 0.84, B * 0.7, '#c9a876');                            // the wooden flight deck
      g.setLineDash([L * 0.04, L * 0.03]); g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = Math.max(0.7, B * 0.05);
      g.beginPath(); g.moveTo(-L * 0.42, 0); g.lineTo(L * 0.36, 0); g.stroke(); g.setLineDash([]);
      det(L * 0.05, B * 0.42, L * 0.16, B * 0.2, '#6f7680');                      // island, starboard
      if (nation === 'IJN') { g.fillStyle = '#fff'; g.beginPath(); g.arc(L * 0.28, 0, B * 0.16, 0, 7); g.fill(); g.fillStyle = '#c33'; g.beginPath(); g.arc(L * 0.28, 0, B * 0.1, 0, 7); g.fill(); }
      else { g.fillStyle = '#fff'; g.beginPath(); g.arc(L * 0.28, 0, B * 0.13, 0, 7); g.fill(); }
    } else if (type === 'battleship' || type === 'cruiser') {
      const r = B * (type === 'battleship' ? 0.3 : 0.26);
      tur(L * 0.26, r); tur(L * 0.1, r); tur(-L * 0.3, r);
      det(-L * 0.08, 0, L * 0.2, B * 0.5, 'rgba(225,225,215,0.75)');
    } else if (type === 'destroyer') { det(0, 0, L * 0.22, B * 0.45, 'rgba(230,230,220,0.7)'); tur(L * 0.25, B * 0.24); }
    else if (type === 'submarine') det(L * 0.05, 0, L * 0.16, B * 0.5, '#2c3036');
    else det(-L * 0.05, 0, L * 0.18, B * 0.45, 'rgba(230,230,220,0.7)');
    if (faded) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(239,229,203,0.38)'; g.fillRect(-c.width, -c.height, c.width * 2, c.height * 2); }
    const out = { c, cx: c.width / 2, cy: pad + B / 2, L, B };
    sprites.set(k, out);
    return out;
  }
  function token(g, P, type, nation, x, z, h, alpha, faded) {
    const sp = sprite(type, nation, faded), d = P.dpr, X = WW.plot.sx(x), Y = WW.plot.sy(z);
    g.save(); g.globalAlpha = alpha;
    g.translate(X + 1.5, Y + 2.5); g.rotate(h); // the shadow on the paper
    g.fillStyle = 'rgba(40,25,10,0.22)'; g.beginPath(); g.ellipse(0, 0, sp.L / 2 / d + 1, sp.B / 2 / d + 1.5, 0, 0, 7); g.fill();
    g.restore(); g.save(); g.globalAlpha = alpha;
    g.translate(X, Y); g.rotate(h); g.drawImage(sp.c, -sp.cx / d, -sp.cy / d, sp.c.width / d, sp.c.height / d);
    g.restore();
  }

  // ---------- pencil ----------
  function wobble(g, X, Y, r, ph, col, w) {
    g.strokeStyle = col; g.lineWidth = w;
    for (let pass = 0; pass < 2; pass++) {
      g.beginPath();
      for (let i = 0; i <= 44; i++) {
        const t = i / 44 * Math.PI * 2 + pass * 0.4, rr = r * (1 + 0.035 * Math.sin(3 * t + ph * 9) + 0.02 * Math.sin(7 * t + ph * 4)) + pass * 0.8;
        i ? g.lineTo(X + Math.cos(t) * rr, Y + Math.sin(t) * rr) : g.moveTo(X + Math.cos(t) * rr, Y + Math.sin(t) * rr);
      }
      g.stroke();
    }
  }
  function arrow(g, X, Y, h, len, col, dash) {
    const ex = X + Math.cos(h) * len, ey = Y + Math.sin(h) * len;
    g.strokeStyle = col; g.lineWidth = 1.4; g.setLineDash(dash ? [4, 3.5] : []);
    g.beginPath(); g.moveTo(X, Y); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
    g.beginPath(); g.moveTo(ex - Math.cos(h - 0.45) * 6, ey - Math.sin(h - 0.45) * 6); g.lineTo(ex, ey); g.lineTo(ex - Math.cos(h + 0.45) * 6, ey - Math.sin(h + 0.45) * 6); g.stroke();
  }
  function label(g, text, X, Y, col, size, italic) {
    g.font = (italic ? 'italic ' : '') + size + 'px "Cormorant Garamond", Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = 'rgba(239,229,203,0.75)'; const w = g.measureText(text).width; g.fillRect(X - w / 2 - 2, Y, w + 4, size + 1);
    g.fillStyle = col; g.fillText(text, X, Y);
  }
  function plane(g, p, x, z, h, nation, alpha) {
    const X = WW.plot.sx(x), Y = WW.plot.sy(z), r = 4.2;
    g.save(); g.globalAlpha = alpha; g.translate(X, Y); g.rotate(h);
    g.strokeStyle = PAINT[nation] ? PAINT[nation][1] : '#333'; g.lineCap = 'round';
    g.lineWidth = 2.2; g.beginPath(); g.moveTo(-r, 0); g.lineTo(r, 0); g.stroke();                 // fuselage
    g.lineWidth = 2; g.beginPath(); g.moveTo(r * 0.25, -r * 0.95); g.lineTo(r * 0.25, r * 0.95); g.stroke(); // wings
    g.lineWidth = 1.4; g.beginPath(); g.moveTo(-r * 0.85, -r * 0.4); g.lineTo(-r * 0.85, r * 0.4); g.stroke();
    g.restore();
  }

  // ---------- strikes ----------
  function strikes(g, P, owner) {
    const W = WW.strike && WW.strike._waves ? WW.strike._waves() : [];
    for (const w of W) {
      if (w.done || (owner && w.nation !== owner)) continue;
      let x = 0, z = 0, k = 0; const sq = [];
      for (const p of w.members) if (p.alive && !p.removed && p.y > 3) { x += p.x; z += p.z; k++; if (p.squadron && sq.indexOf(p.squadron.short) < 0) sq.push(p.squadron.short); }
      if (!k) continue;
      x /= k; z /= k;
      const col = (PENCIL[w.nation] || PENCIL.USN), cv = w.carrier, t = w.target;
      let tx = null, tz = null;
      if (t && t.alive) { const c = owner ? WW.intel.known(owner, t) : t; if (c) { tx = c.x; tz = c.z; } }
      g.lineCap = 'round';
      if (cv && cv.alive) { g.strokeStyle = col + '0.55)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(WW.plot.sx(cv.x), WW.plot.sy(cv.z)); g.lineTo(WW.plot.sx(x) + 0.8, WW.plot.sy(z) - 0.6); g.stroke(); }
      if (tx !== null) {
        const X = WW.plot.sx(x), Y = WW.plot.sy(z), TX = WW.plot.sx(tx), TY = WW.plot.sy(tz), h = Math.atan2(TY - Y, TX - X), len = Math.hypot(TX - X, TY - Y);
        if (len > 12) arrow(g, X, Y, h, len - 8, col + '0.6)', true);
        g.strokeStyle = col + '0.75)'; g.lineWidth = 2; g.beginPath(); g.moveTo(TX - 5, TY - 5); g.lineTo(TX + 5, TY + 5); g.moveTo(TX + 5, TY - 5); g.lineTo(TX - 5, TY + 5); g.stroke();
      }
      const cvn = cv && WW.diary ? WW.diary.nameOf(cv) : '';
      if (sq.length) label(g, sq.every(n => cvn && n.indexOf(cvn) === 0) ? cvn + ' air group' : sq.join(' · '), WW.plot.sx(x), WW.plot.sy(z) + 9, col + '0.95)', 11, true);
    }
  }

  // ---------- notes ----------
  // a note is pinned up and right of its sighting; a later note that would cover an earlier one slides down
  function note(g, n, owner, now, placed) {
    const age = now - n.t, a = age < 120 ? 1 : Math.max(0, 1 - (age - 120) / 80);
    if (a <= 0) return;
    const P = WW.plot.P, X = WW.plot.sx(n.x), Y = WW.plot.sy(n.z), ph = n.id, ang = (ph - 0.5) * 0.16;
    g.font = '11px "Special Elite", "Courier New", monospace';
    const hw = (g.measureText(n.text).width + 14) / 2, x0 = P.ox + hw + 4, x1 = P.ox + WW.cfg.MAP_W * P.s - hw - 4;
    let nx = WW.clamp(X + 30 + ph * 16, x0, x1), ny = WW.clamp(Y - 50 - ph * 12, P.oy + 8, P.oy + WW.cfg.MAP_H * P.s - 30);
    for (let k = 0; k < 12 && placed.some(r => Math.abs(r[0] - nx) < r[2] + hw && Math.abs(r[1] - ny) < 25); k++) ny += 26;
    placed.push([nx, ny, hw]);
    g.save(); g.globalAlpha = a;
    g.strokeStyle = (PENCIL[owner] || PENCIL.USN) + '0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X, Y); g.lineTo(nx, ny + 10); g.stroke();
    g.translate(nx, ny); g.rotate(ang);
    g.font = '11px "Special Elite", "Courier New", monospace'; const w = g.measureText(n.text).width + 14;
    g.fillStyle = 'rgba(40,25,10,0.25)'; g.fillRect(-w / 2 + 2, 2, w, 22);
    g.fillStyle = '#fbf6e6'; g.fillRect(-w / 2, 0, w, 22);
    g.fillStyle = 'rgba(120,150,200,0.35)'; g.fillRect(-w / 2, 6, w, 0.7);
    g.fillStyle = '#2b2622'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n.text, 0, 13);
    WW.plot.pin(g, 0, 1, 3.2, '#c8463c');
    g.restore();
  }

  // ---------- the layer ----------
  function rings(g, owner) {
    let c = null;
    if (owner) { for (const s of WW.world.ships) if (s.alive && s.nation === owner && s.type === 'carrier') { c = s; break; } }
    const x = c ? c.x : WW.cfg.MAP_W / 2, z = c ? c.z : WW.cfg.MAP_H / 2, X = WW.plot.sx(x), Y = WW.plot.sy(z), s = WW.plot.P.s;
    g.strokeStyle = owner ? (PENCIL[owner] + '0.16)') : 'rgba(80,70,60,0.12)'; g.lineWidth = 1;
    for (const r of [100, 200, 300]) { g.beginPath(); g.arc(X, Y, r * s, 0, Math.PI * 2); g.stroke(); }
    g.beginPath();
    for (let a = 0; a < 360; a += 30) { const t = a * Math.PI / 180; g.moveTo(X + Math.sin(t) * 92 * s, Y - Math.cos(t) * 92 * s); g.lineTo(X + Math.sin(t) * 308 * s, Y - Math.cos(t) * 308 * s); }
    g.stroke();
  }
  function draw(g, P) {
    const owner = P.owner, now = WW.time.now, ships = WW.world.ships, planes = WW.world.planes;
    rings(g, owner);
    for (const w of wrecks) if (!owner || w.seen[owner]) {
      const X = WW.plot.sx(w.x), Y = WW.plot.sy(w.z), col = (PENCIL[w.nation] || PENCIL.USN) + '0.7)';
      g.strokeStyle = col; g.lineWidth = 1.8; g.beginPath(); g.moveTo(X - 6, Y - 6); g.lineTo(X + 6, Y + 6); g.moveTo(X + 6, Y - 6); g.lineTo(X - 6, Y + 6); g.stroke();
      label(g, w.name, X, Y + 8, col, 11, true);
    }
    strikes(g, P, owner);
    const capital = s => s.type === 'carrier' || s.type === 'battleship';
    // own (or all) ships at their true positions
    for (const s of ships) {
      if (!s.alive || s.removed || (owner && s.nation !== owner)) continue;
      token(g, P, s.type, s.nation, s.x, s.z, s.heading, s.submerged ? 0.55 : 1, false);
      if (capital(s) && WW.diary) label(g, WW.diary.nameOf(s), WW.plot.sx(s.x), WW.plot.sy(s.z) + tokLen(s.type) * P.s * 0.3 + 4, PAINT[s.nation][1], 11, true);
    }
    if (owner && WW.intel) {
      const foe = WW.enemyOf(owner), col = PENCIL[foe] || PENCIL.IJN;
      for (const c of WW.intel.contacts(owner)) {
        const u = c.unit; if (!u || !u.stats) continue;
        const age = now - c.seenAt, fresh = age <= 3, a = fresh ? 1 : Math.max(0.5, 1 - age / 120), ph = hash(u);
        const t = c.reportedType || (WW.intel.typeOf ? WW.intel.typeOf(c) : null) || u.type, X = WW.plot.sx(c.x), Y = WW.plot.sy(c.z);
        const r = (fresh ? 0 : Math.min(50, age * (c.speed || 0) * 0.5) + 6) + (c.err || 0);
        if (r > 2) wobble(g, X, Y, Math.max(r * P.s, 9), ph, col + (0.3 + 0.35 * a).toFixed(2) + ')', 1.4);
        token(g, P, t, foe, c.x, c.z, c.heading, a, !fresh);
        if ((c.speed || 0) > 0.3) arrow(g, X, Y, c.heading, Math.min(60, 10 + c.speed * 5), col + (0.3 + 0.5 * a).toFixed(2) + ')', !fresh);
        if (c.misid) { g.fillStyle = col + '0.9)'; g.font = 'bold 15px "Special Elite", "Courier New", monospace'; g.textAlign = 'left'; g.fillText('?', X + tokLen(t) * P.s * 0.45, Y - 6); }
        if (!fresh || capital(u)) label(g, SHORT[t] + (fresh ? '' : ' ' + Math.round(age / 2) + ' min'), X, Y + tokLen(t) * P.s * 0.28 + 3, col + '0.85)', 10, true);
      }
      for (const c of WW.intel.contacts(owner)) {
        const u = c.unit; if (!u || u.stats) continue;
        const age = now - c.seenAt; plane(g, u, c.x, c.z, c.heading, foe, Math.max(0.15, 1 - age / 10));
      }
      const placed = [], NS = WW.diary ? WW.diary.notes(owner) : [];
      for (let i = Math.max(0, NS.length - 5); i < NS.length; i++) note(g, NS[i], owner, now, placed);
    }
    for (const p of planes) if (p.alive && !p.removed && p.y > 2 && (!owner || p.nation === owner)) plane(g, p, p.x, p.z, p.heading, p.nation, 1);
  }
  // the cartouche: whose plot, the admiral, the clock, the keys
  function caption(g, P) {
    const o = P.owner, A = o && WW.admirals && WW.admirals.of ? WW.admirals.of(o) : null;
    const title = o ? (o === 'USN' ? 'U.S. Pacific Fleet — Task Force Plot' : 'Kido Butai — Flag Plot') : 'Omniscient Plot — all true positions';
    const sub = (A ? A.title + '  ·  ' : '') + (WW.diary ? WW.diary.clock() + ' hrs' : '');
    const y = P.py + WW.plot.BORDER * P.s * 0.42;
    g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillStyle = o ? PAINT[o][1] : '#3b3328';
    g.font = '600 ' + Math.max(12, Math.min(18, 15 * P.s)) + 'px "Cormorant Garamond", Georgia, serif';
    g.fillText(title.toUpperCase(), P.px + 22, y);
    const tw = g.measureText(title.toUpperCase()).width;
    g.font = 'italic ' + Math.max(11, Math.min(16, 14 * P.s)) + 'px "Cormorant Garamond", Georgia, serif'; g.fillStyle = '#4b3f33';
    g.fillText(sub, P.px + 34 + tw, y);
    g.textAlign = 'right'; g.font = '10px "Special Elite", "Courier New", monospace'; g.fillStyle = 'rgba(60,50,40,0.7)';
    g.fillText('G whose plot  ·  X danger  ·  L diary  ·  C close', P.px + P.pw - 22, P.py + P.ph - WW.plot.BORDER * P.s * 0.4);
  }
  WW.on('shipSunk', s => {
    try {
      if (!s || !s.stats || !WW.intel) return;
      const foe = WW.enemyOf(s.nation), seen = { [s.nation]: true }; seen[foe] = WW.intel.visible(foe, s, 20);
      wrecks.push({ x: s.x, z: s.z, nation: s.nation, name: WW.diary ? WW.diary.nameOf(s) : s.type, seen });
    } catch (e) { /* visual only */ }
  });
  WW.on('roundStart', () => { wrecks = []; });
  WW.on('setupStart', () => { wrecks = []; });
  WW.plotTokens = { draw, caption, resize() { sprites.clear(); }, sprite };
})(window.WW);
