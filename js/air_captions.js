// air_captions.js — WW.airCaptions: small film captions for the air war, only about what the director camera
// is filming (WW.cam._shot(): its subject, or the plane of a dive-bomb orbit). "VT-8 begins its run",
// "Lt. Cmdr. Thach leads VB-6 in", "Strike away: VF-6, VB-6, VT-6", "CAP vectored to raid, 040, 25 miles",
// an ace's kill. At most one air caption every GAP s of real time, none in free camera / map view or while
// another caption (the victory card) is showing. Also adds camera candidates for squadron moments (WW.camHooks).
// Visual only: wall clock and Math.random, never WW.rand; reads the sim, never writes it. Load after camera.js (it wraps WW.cam.update).
window.WW = window.WW || {};
(function () {
  const GAP = 15, SECS = 4.5, KEEP = 20;     // s between air captions, caption hold, how long a moment stays fresh
  let moments = [], lastCap = -1e9, lastShot = null, said = new Set(), checkT = 0;
  const ST = { shown: 0 };
  const wall = () => performance.now() / 1000;
  const sqName = p => (p && p.squadron ? p.squadron.short : null);
  const who = p => (WW.squadrons ? WW.squadrons.rank(p) : null);
  const KIND = { carrier: 'carrier', battleship: 'battleship', cruiser: 'cruiser', destroyer: 'destroyer', submarine: 'submarine', pt: 'PT boat' };

  function note(m) { m.at = wall(); m.sim = WW.time.now; moments.push(m); if (moments.length > 24) moments.shift(); }
  WW.on('airOrder', e => { if (e && (e.order === 'strikeAway' || e.order === 'scramble' || e.order === 'redirect' || e.order === 'cag')) note(Object.assign({}, e)); });
  WW.on('planeKill', e => { const s = e && e.shooter; if (s && s.pilot && (s.ace || s.pilot.kills >= 4)) note({ order: 'kill', plane: s, victim: e.victim, carrier: s.carrier }); });
  WW.on('ace', e => { if (e && e.plane) note({ order: 'ace', plane: e.plane, pilot: e.pilot, carrier: e.plane.carrier }); });
  WW.on('roundStart', () => { moments = []; said.clear(); lastShot = null; });

  // compass bearing (north = -z, east = +x) and a period-style distance for the fighter-director call
  function vector(cv, r) {
    const deg = Math.round(((Math.atan2(r.x - cv.x, cv.z - r.z) * 180 / Math.PI) + 360) % 360);
    return ('00' + deg).slice(-3) + ', ' + Math.max(5, Math.round(r.d / 40) * 5) + ' miles';
  }
  // What the shot shows: the subject plane (or the diving plane of an orbit), or the subject ship.
  function filmed(shot) {
    const s = shot.plane || shot.subj;
    if (!s || s.diorama) return null;
    return s;
  }
  function lineFor(s) {
    const now = WW.time.now, fresh = moments.filter(m => now - m.sim < KEEP);   // fresh in sim time too
    const isP = s.pt && s.kind && s.alive && s.squadron, k0 = isP && (s.t0id || (s.t0id = Math.random()));
    if (isP && s.kind === 'torpedo' && s.phase === 'run' && !said.has('run' + k0)) { said.add('run' + k0); return [sqName(s) + ' begins its run', who(s) || '']; }
    if (isP && s.kind === 'dive' && (s.phase === 'roll' || s.phase === 'dive') && !said.has('dive' + k0)) { said.add('dive' + k0); return [sqName(s) + ' pushes over', who(s) || '']; }
    const isPlane = s.pt && s.kind, cv = isPlane ? s.carrier : s.type === 'carrier' ? s : null;
    // events first: they are rarer
    for (let i = fresh.length - 1; i >= 0; i--) {
      const m = fresh[i], key = m.order + ':' + (m.plane ? m.plane.t0id || (m.plane.t0id = Math.random()) : '') + ':' + m.at;
      if (said.has(key)) continue;
      let line = null;
      if ((m.order === 'kill' || m.order === 'ace') && m.plane === s) {
        const k = s.pilot ? s.pilot.kills : s.kills;
        line = [who(s) || 'Ace', (m.order === 'ace' ? 'becomes an ace, ' : '') + k + (k === 1 ? ' kill' : ' kills') + (sqName(s) ? ' · ' + sqName(s) : '')];
      } else if (m.order === 'strikeAway' && m.squadrons && m.squadrons.length && (s === m.carrier || (isPlane && s.wave && s.wave.carrier === m.carrier && s.sk === 'form')))
        line = [m.carrier.nation === 'USN' ? 'Strike away: ' + m.squadrons.join(', ') : 'Strike away from ' + (m.carrier.name || 'the carrier'), (m.carrier.nation === 'USN' ? '' : m.squadrons.length + ' units, ') + (m.target ? 'against a ' + (KIND[m.target.type] || 'ship') : '')];
      else if (m.order === 'scramble' && m.raid && cv === m.carrier && (s === cv || (isPlane && s.kind === 'fighter' && !s.target)))
        line = ['CAP vectored to raid', vector(m.carrier, m.raid) + (cv.name ? ' · ' + cv.name : '')];
      else if (m.order === 'redirect' && isPlane && s.wave && s.wave.carrier === m.carrier && m.target)
        line = [(sqName(m.leader) || 'Strike') + ' redirected', 'new target: ' + (KIND[m.target.type] || 'ship')];
      else if (m.order === 'cag' && m.plane === s)
        line = [(who(s) || 'Next leader') + ' takes the lead', sqName(s) || ''];
      if (line) { said.add(key); return line; }
    }
    if (!isPlane || !s.alive || !s.squadron) return null;
    // the plane's own state
    const sq = sqName(s), key = s.t0id || (s.t0id = Math.random());
    if (s.wave && s.wave.cag === s && s.state === 'transit' && s.sk === 'form' && !said.has('lead' + key)) { said.add('lead' + key); return [(who(s) || 'The CAG') + ' leads ' + sq + ' in', s.wave.target ? 'target: ' + (KIND[s.wave.target.type] || 'ship') : '']; }
    if (s.kind === 'fighter' && !s.target && s.state === 'attack' && s.foe && (s.foe.kind === 'torpedo' || s.foe.kind === 'dive') && !said.has('cap' + key)) {
      said.add('cap' + key); return [sq + ' CAP engages ' + (s.foe.kind === 'torpedo' ? 'torpedo bombers' : 'dive bombers'), who(s) || ''];
    }
    return null;
  }
  function tick() {
    if (!WW.cam || !WW.ui || !WW.ui.caption) return;
    const st = WW.game && WW.game.state;
    if (st !== 'battle' || WW.cam.mode !== 'director' || (WW.freecam && WW.freecam.active())) return;
    const shot = WW.cam._shot && WW.cam._shot();
    if (!shot || shot.t < 0.6) return;                       // let the cut settle first
    if (wall() - lastCap < GAP || (WW.ui.captionOn && WW.ui.captionOn())) return;
    const s = filmed(shot);
    if (!s) return;
    const line = lineFor(s);
    if (!line) return;
    WW.ui.caption(line[0], line[1], SECS, true);
    lastCap = wall(); ST.shown++; ST.last = line;
  }
  if (WW.cam && WW.cam.update) {
    const u = WW.cam.update;
    WW.cam.update = function (rdt) { const r = u.apply(this, arguments); if ((checkT -= rdt) <= 0) { checkT = 0.25; try { tick(); } catch (e) { /* captions never break the camera */ } } return r; };
  }

  // camera candidates for squadron moments: the CAG leading a strike in, a CAP division / shotai in formation
  (WW.camHooks = WW.camHooks || []).push(function (add, dur) {
    for (const p of WW.world.planes) {
      if (!p.alive || !p.squadron) continue;
      if (p.wave && p.wave.cag === p && p.wave.go && p.sk === 'form' && p.state === 'transit') add(5.5, 'chase', p, { dur: dur(12, 15) });
      else if (p.kind === 'fighter' && !p.target && p.wing === 0 && p.element && p.element.members.length >= 2 && p.state === 'transit') add(3.5, 'chase', p, { dur: dur(11, 14) });
    }
  });
  // story mode title card (camera_story.js): shown only when the throttle allows; true if shown
  function say(main, sub) {
    if (!WW.ui || !WW.ui.caption || wall() - lastCap < GAP || (WW.ui.captionOn && WW.ui.captionOn())) return false;
    WW.ui.caption(main, sub || '', SECS, true);
    lastCap = wall(); ST.shown++; ST.last = [main, sub];
    return true;
  }
  WW.airCaptions = { stats: ST, lineFor, tick, say };
})();
