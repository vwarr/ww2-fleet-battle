// plot_normandy.js - WW.plotNormandy: the plot table's land battle (Normandy only; visual / UI, docs/NORMANDY_PLAN.md
// P9). plot_table.js shows its window (VIEW: Omaha and Pointe du Hoc from beyond the line of departure to the plateau;
// the Transport Area lies off the top edge, eleven miles out) and calls chart() for the static ink and draw() for the
// live layer before plot_tokens.js draws the ships:
//   static  the eight assault sectors (Charlie to Fox Red: terrain_normandy_data.js SECTORS) with their boundaries, the
//           line of departure (landing_craft.js LOD off the H-hour waterline) and the boat lanes in to each sector,
//           the DD tanks' launch line, the five draws, the villages, Pointe du Hoc, the arrow to the Transport Area
//   live    the tide line now (tide.js waterZ, once the flood has come in), the craft (wooden chips; the running waves
//           labelled with their clock time; wrecks pencilled out), the DD tanks, the men ashore (dots by state: in the
//           water, on the sand, at the shingle, on the bluff; pinned ringed red), the tanks ashore, the strongpoints (a
//           German symbol per WN, red ticks while it fires, struck through with the time once silenced), the draws
//           (barred while held, an arrow up them once open, with the time), the Pointe du Hoc 155s, and the beachhead
//           line pencilled along the bluff top wherever the men hold it
// Owners (key G): Omniscient -> USN (Force O) -> GER (the 352nd Division): both see the whole beach (the strongpoints
// were on the Allies' charts from the aerial photographs; the Germans looked down on it), so the owner changes only the
// cartouche and the ships' plot (plot_tokens.js). Visual only: reads the sim, never writes it; no Math.random needed.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  if (WW.simOnly) return;
  const on = () => !!WW.isScn && WW.isScn('normandy') && !!WW.normandyTerrain && !!WW.scenarios.normandy.clock;
  const VIEW = { x: 600, z: 590, w: 1680, h: 720, rose: [665, 655] };
  const OWNERS = [null, 'USN', 'GER'];
  const INK = '#3b3328', BLUE = 'rgba(40,70,130,', RED = 'rgba(170,40,35,', GREY = 'rgba(60,70,55,';
  const T = () => WW.normandyTerrain, D = () => WW.normandyData, C = () => WW.scenarios.normandy.clock;
  const X = x => WW.plot.sx(x), Y = z => WW.plot.sy(z);
  const hm = t => C().label(t).replace(':', '');
  function text(g, s, x, y, size, col, opt) {
    g.font = (opt && opt.italic ? 'italic ' : '') + (opt && opt.bold ? '600 ' : '') + size + 'px ' + (opt && opt.type ? '"Special Elite", "Courier New", monospace' : '"Cormorant Garamond", Georgia, serif');
    g.textAlign = (opt && opt.align) || 'center'; g.textBaseline = (opt && opt.base) || 'middle';
    if (opt && opt.paper) { const w = g.measureText(s).width; g.fillStyle = 'rgba(239,229,203,0.8)'; g.fillRect(x - (g.textAlign === 'center' ? w / 2 : g.textAlign === 'right' ? w : 0) - 2, y - size / 2 - 1, w + 4, size + 2); }
    g.fillStyle = col; g.fillText(s, x, y);
  }
  function dashLine(g, pts, col, w, dash) { g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])))); g.stroke(); g.setLineDash([]); }
  function arrow(g, x0, y0, x1, y1, col, w) {
    const h = Math.atan2(y1 - y0, x1 - x0);
    g.strokeStyle = col; g.lineWidth = w || 1.3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
    g.moveTo(x1 - Math.cos(h - 0.45) * 5, y1 - Math.sin(h - 0.45) * 5); g.lineTo(x1, y1); g.lineTo(x1 - Math.cos(h + 0.45) * 5, y1 - Math.sin(h + 0.45) * 5); g.stroke();
  }
  const along = (x0, x1, f) => { const out = []; for (let x = x0; x <= x1 + 1e-6; x += 6) out.push([x, f(x)]); return out; };

  // ---------- the static ink (plot_table.js chart(): the cached base) ----------
  function chart(g) {
    const t = T(), S = D().SECTORS, LOD = WW.landingCraft ? WW.landingCraft.LOD : 420, x0 = S[0].x0, x1 = S[S.length - 1].x1;
    // the line of departure and the DD launch line
    dashLine(g, along(x0 - 20, x1 + 20, x => t.shoreZ(x) - LOD), BLUE + '0.55)', 1.2, [7, 4]);
    text(g, 'Line of departure', X(x0 - 24), Y(t.shoreZ(x0) - LOD), 11, BLUE + '0.85)', { italic: true, align: 'right' });
    dashLine(g, along(1650, 2010, x => t.shoreZ(x) - 280), 'rgba(70,95,60,0.45)', 1, [2, 4]);
    text(g, 'DD tanks launched', X(2016), Y(t.shoreZ(2010) - 280), 9.5, 'rgba(70,95,60,0.8)', { italic: true, align: 'left' });
    // the sectors: the boat lanes in from the line of departure, the boundaries on the beach and the names
    for (const s of S) {
      const cx = (s.x0 + s.x1) / 2, zs = t.shoreZ(cx);
      dashLine(g, [[cx, zs - LOD + 4], [cx, zs - 14]], BLUE + '0.22)', 0.9, [3, 5]);
      g.strokeStyle = 'rgba(59,51,40,0.55)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(s.x0), Y(t.shoreZ(s.x0) - 26)); g.lineTo(X(s.x0), Y(t.shoreZ(s.x0) + 2)); g.stroke();
      text(g, s.name.toUpperCase(), X(cx), Y(zs - 34), 9.5, INK, { bold: true });
    }
    g.strokeStyle = 'rgba(59,51,40,0.55)'; g.beginPath(); g.moveTo(X(x1), Y(t.shoreZ(x1) - 26)); g.lineTo(X(x1), Y(t.shoreZ(x1) + 2)); g.stroke();
    text(g, 'O M A H A', X((x0 + x1) / 2), Y(t.shoreZ((x0 + x1) / 2) - 120), 22, 'rgba(59,51,40,0.5)', { bold: true });
    // the draws: their names on the plateau
    for (const d of D().DRAWS) text(g, d.id, X(d.x), Y(t.bluffTopZ(d.x) + 30), 10, INK, { type: true });
    // the villages, Pointe du Hoc, the Percée
    for (const v of D().VILLAGES) { const vx = v.x, vz = t.bluffTopZ(vx) + v.u; if (vx < VIEW.x || vx > VIEW.x + VIEW.w) continue; g.fillStyle = 'rgba(80,60,40,0.5)'; g.fillRect(X(vx) - 3, Y(vz) - 3, 6, 6); text(g, v.name, X(vx), Y(vz) + 9, 9.5, 'rgba(59,51,40,0.75)', { italic: true }); }
    text(g, 'Pointe du Hoc', X(725), Y(t.shoreZ(725) - 22), 12, INK, { italic: true, bold: true });
    text(g, 'Pointe de la Percée', X(1250), Y(t.shoreZ(1250) - 16), 10, INK, { italic: true });
    // the Transport Area: off the top edge, eleven miles out
    const tx = 1650, y0 = Y(VIEW.z) + 34;
    arrow(g, X(tx), y0, X(tx), Y(VIEW.z) + 6, BLUE + '0.7)', 1.4);
    text(g, 'Transport Area, 11 miles', X(tx), y0 + 9, 11, BLUE + '0.9)', { italic: true });
    text(g, 'Force O: the attack transports, the LSIs', X(tx), y0 + 21, 9.5, BLUE + '0.7)', { italic: true });
  }

  // ---------- the live layer ----------
  const ST_COL = { swim: '#3c6f9e', wade: '#3c6f9e', cross: '#2d4f7a', shingle: '#2a3f66', shelf: '#22355a', climb: '#1d2e4f', top: '#16233e', hold: '#16233e', assault: '#8a2a20', rope: '#2a3f66', guns: '#16233e' };
  function draw(g, P, owner) {
    if (!on()) return;
    const t = T(), now = WW.time.now, rt = WW.game ? WW.game.roundTime : 0, S = D().SECTORS, x0 = S[0].x0, x1 = S[S.length - 1].x1;
    // the tide line now
    if (WW.tide && WW.tide.level() > 0.05) {
      dashLine(g, along(x0, x1, x => WW.tide.waterZ(x)), 'rgba(60,110,170,0.6)', 1.2, [5, 3]);
      text(g, 'Tide ' + hm(rt), X(x1 + 4), Y(WW.tide.waterZ(x1)), 9, 'rgba(60,110,170,0.9)', { italic: true, align: 'left' });
    }
    // the beachhead: the bluff top pencilled where the men hold it (bins of 20 u)
    const I = WW.infantry, held = new Map();
    if (I) for (const q of I.squads) if (q.alive && q.kind !== 'tank' && q.topped && q.sector !== 'hoc') { const k = Math.floor(q.x / 20); held.set(k, Math.max(held.get(k) || 0, q.z - t.bluffTopZ(q.x))); }
    if (held.size) {
      const keys = [...held.keys()].sort((a, b) => a - b);
      let run = [];
      const flush = () => { if (run.length) { dashLine(g, run.map(k => [k * 20 + 10, t.bluffTopZ(k * 20 + 10) + Math.max(4, held.get(k)) + 3]), BLUE + '0.75)', 3); run = []; } };
      for (let i = 0; i < keys.length; i++) { if (run.length && keys[i] - run[run.length - 1] > 2) flush(); run.push(keys[i]); }
      flush();
      const k = keys[Math.floor(keys.length / 2)];
      text(g, 'Beachhead', X(k * 20 + 10), Y(t.bluffTopZ(k * 20 + 10) + held.get(k) + 14), 10.5, BLUE + '0.95)', { italic: true, bold: true, paper: true });
    }
    // the draws: barred while held, an arrow up once open
    const open = WW.normandyGame ? WW.normandyGame.drawsOpen() : {};
    for (const d of D().DRAWS) {
      const zs = t.shingleZ(d.x), zt = t.bluffTopZ(d.x);
      if (open[d.id] !== undefined) { arrow(g, X(d.x), Y(zs + 2), X(d.x), Y(zt + 16), BLUE + '0.9)', 2); text(g, 'open ' + hm(open[d.id]), X(d.x) + 4, Y((zs + zt) / 2), 9, BLUE + '0.95)', { type: true, align: 'left', paper: true }); }
      else { g.strokeStyle = RED + '0.8)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(X(d.x - d.w * 0.8), Y((zs + zt) / 2)); g.lineTo(X(d.x + d.w * 0.8), Y((zs + zt) / 2)); g.stroke(); }
    }
    // the strongpoints: a German symbol, ticks while firing, struck through once silenced
    const CD = WW.coastDefence;
    if (CD) for (const w of CD.wns) {
      const cx = X(w.x), cy = Y(w.z), firing = w.elements.some(e => e.alive && e.firedAt > now - 4);
      g.strokeStyle = w.silenced ? GREY + '0.55)' : GREY + '0.95)'; g.fillStyle = w.silenced ? 'rgba(150,150,140,0.25)' : 'rgba(110,122,104,0.45)'; g.lineWidth = 1.4;
      g.beginPath(); g.ellipse(cx, cy, 7, 4.5, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(cx, cy - 4.5); g.lineTo(cx, cy - 11); g.lineTo(cx + 5, cy - 9); g.lineTo(cx, cy - 7); g.stroke();   // the pennant
      if (firing && !w.silenced) { g.strokeStyle = RED + '0.85)'; g.lineWidth = 1.2; g.beginPath(); for (let k = -1; k <= 1; k++) { g.moveTo(cx + k * 4, cy - 5); g.lineTo(cx + k * 6, cy - 14 + Math.abs(k) * 2); } g.stroke(); }   // muzzle-flash ticks toward the sea
      if (w.silenced) { g.strokeStyle = BLUE + '0.9)'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(cx - 8, cy - 6); g.lineTo(cx + 8, cy + 6); g.moveTo(cx + 8, cy - 6); g.lineTo(cx - 8, cy + 6); g.stroke(); }
      text(g, w.wid.replace('WN', 'WN ') + (w.silenced ? '  ' + hm(w.silencedAt) : ''), cx, cy + 11, 9, w.silenced ? GREY + '0.75)' : GREY + '1)', { type: true, paper: true });
    }
    // the Pointe du Hoc 155s (in the casemates, or in the orchard inland)
    if (CD) for (const e of CD.elements) if (e.kind === 'h155') {
      const cx = X(e.x), cy = Y(e.z);
      g.fillStyle = e.alive ? GREY + '0.9)' : 'rgba(150,150,140,0.6)'; g.fillRect(cx - 2, cy - 2, 4, 4);
      if (!e.alive) { g.strokeStyle = BLUE + '0.9)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 3, cy - 3); g.lineTo(cx + 3, cy + 3); g.stroke(); }
    }
    // the craft: chips on the water, the running waves labelled; wrecks pencilled out
    const L = WW.landingCraft, waves = new Map();
    if (L) for (const u of L.craft) {
      if (u.state === 'wrecked') { if (rt - u.stateT < 400) { const cx = X(u.x), cy = Y(u.z); g.strokeStyle = BLUE + '0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(cx - 2.5, cy - 2.5); g.lineTo(cx + 2.5, cy + 2.5); g.moveTo(cx + 2.5, cy - 2.5); g.lineTo(cx - 2.5, cy + 2.5); g.stroke(); } continue; }
      if (!u.alive || u.removed) continue;
      const len = Math.max(3, u.C.len * P.s * 1.8), wid = Math.max(1.8, u.C.beam * P.s * 3);
      g.save(); g.translate(X(u.x), Y(u.z)); g.rotate(u.heading);
      g.fillStyle = u.type === 'dd' ? '#5d6e4c' : '#4f78ad'; g.strokeStyle = 'rgba(30,20,10,0.5)'; g.lineWidth = 0.6;
      g.fillRect(-len / 2, -wid / 2, len, wid); g.strokeRect(-len / 2, -wid / 2, len, wid); g.restore();
      if (u.state === 'run' && u.type !== 'dd') { const W = WW.landingWaves && WW.landingWaves.WAVES[u.wave], k = W ? W.time.join(':') : '?'; const a = waves.get(k) || waves.set(k, { x: 0, z: 0, n: 0, t: W ? W.time : null }).get(k); a.x += u.x; a.z += u.z; a.n++; }
    }
    for (const [k, a] of waves) if (a.n >= 2 && a.t) text(g, String(a.t[0]).padStart(2, '0') + String(a.t[1]).padStart(2, '0') + ' wave', X(a.x / a.n), Y(a.z / a.n) - 9, 9, BLUE + '0.9)', { type: true, paper: true });
    // the men ashore and the tanks
    if (I) for (const q of I.squads) {
      if (!q.alive) continue;
      const cx = X(q.x), cy = Y(q.z);
      if (q.kind === 'tank') { g.fillStyle = '#5d6e4c'; g.fillRect(cx - 2.2, cy - 1.6, 4.4, 3.2); continue; }
      const r = 1.2 + Math.min(1.4, q.men / 10);
      g.fillStyle = ST_COL[q.state] || '#2a3f66'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      if (q.sup > 1) { g.strokeStyle = RED + '0.7)'; g.lineWidth = 0.8; g.beginPath(); g.arc(cx, cy, r + 1.3, 0, Math.PI * 2); g.stroke(); }
    }
  }
  WW.plotNormandy = { on, VIEW, OWNERS, chart, draw };
})(window.WW);
