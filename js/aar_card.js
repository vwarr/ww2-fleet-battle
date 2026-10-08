// aar_card.js - WW.aar: the after-action report card (visual / UI only). On 'victory' it takes a snapshot of
// the round (sunk ships are gone after the next clearAll) and types a period report on paper: the winner and how
// (annihilated / retired / time), each side's admiral (WW.admirals, when present), ships lost per side by name and
// type, planes lost, the side's MVP ship (most sinkings credited: ships and strike planes whose target it was) and
// best pilot (kills this round), and the key moments (the top diary entries). It appears after the victory
// caption, stays through the victory pause and on the ready screen (setup mode) until the next battle starts; in
// auto mode it stays into the opening of the next round (AUTO_HOLD s of real time in all). A click hides it.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  if (WW.simOnly) return;
  const DELAY = 4.5, AUTO_HOLD = 34;
  const SHORT = { carrier: 'CV', battleship: 'BB', cruiser: 'CA', destroyer: 'DD', submarine: 'SS', pt: 'PT' };
  const ORDER = { carrier: 0, battleship: 1, cruiser: 2, destroyer: 3, submarine: 4, pt: 5 };
  let credit = new Map(), kills = new Map(), seenPlanes = new Set(), sunk = [], escaped = { USN: 0, IJN: 0 }, el = null, showAt = 0, hideAt = 0, last = null;

  function on(name, fn) { WW.on(name, e => { try { fn(e); } catch (err) { /* visual only */ } }); }
  on('roundStart', () => {
    credit = new Map(); kills = new Map(); seenPlanes = new Set(); sunk = []; escaped = { USN: 0, IJN: 0 };
    if (el && WW.game.mode !== 'auto') hide(); // a standalone battle starts: the old report goes
  });
  // sinking credit: gun ships aiming at the victim within 1.3 x their gun range, and the strike planes after it
  on('shipSunk', v => {
    if (!v || !v.stats) return;
    if (sunk.indexOf(v) < 0) sunk.push(v);
    for (const s of WW.world.ships) {
      if (!s.alive || s.nation === v.nation || s.target !== v) continue;
      const st = s.stats, r = Math.max(60, (st.guns || []).reduce((m, g) => Math.max(m, g.range), 0), st.torpedoes ? st.torpedoes.range : 0) * 1.3;
      if (WW.dist(s.x, s.z, v.x, v.z) < r) credit.set(s, (credit.get(s) || 0) + 1);
    }
    for (const p of WW.world.planes) if (p.target === v && p.carrier && p.nation !== v.nation) { credit.set(p.carrier, (credit.get(p.carrier) || 0) + 0.5); break; }
  });
  on('shipScuttled', s => { if (s && s.stats && sunk.indexOf(s) < 0) sunk.push(s); });
  on('shipEscaped', s => { if (s && escaped[s.nation] !== undefined) escaped[s.nation]++; });
  on('planeKill', e => { const p = e.shooter && e.shooter.pilot; if (p) kills.set(p, (kills.get(p) || 0) + 1); });
  on('victory', d => { last = snapshot(d); showAt = performance.now() + DELAY * 1000; hideAt = 0; });

  function snapshot(d) {
    const D = WW.diary, nm = s => D ? D.nameOf(s) : s.type;
    for (const p of WW.world.planes) seenPlanes.add(p);
    const side = n => {
      const lost = sunk.filter(s => s.nation === n).sort((a, b) => ORDER[a.type] - ORDER[b.type]), esc = escaped[n];
      let mvp = null, mv = 0;
      credit.forEach((v, s) => { if (s.nation === n && v > mv) { mv = v; mvp = s; } });
      let ace = null, ak = 0;
      kills.forEach((v, p) => { if (p.nation === n && v > ak) { ak = v; ace = p; } });
      let planes = 0; seenPlanes.forEach(p => { if (p.nation === n && p.alive === false) planes++; });
      const A = WW.admirals && WW.admirals.of ? WW.admirals.of(n) : null;
      return {
        n, adm: A ? (A.full || A.title || A.name) : null, flag: A && A.flagName,
        lost: lost.map(s => nm(s) + ' (' + (SHORT[s.type] || s.type) + ')'), escaped: esc, planes,
        mvp: mvp ? nm(mvp) + ' (' + (SHORT[mvp.type] || '') + '), ' + (mv >= 1 ? Math.round(mv) + ' sunk' : 'a shared sinking') : null,
        ace: ace ? ace.name + ', ' + ak + (ak === 1 ? ' kill' : ' kills') + (ace.ace ? ' (ace)' : '') : null
      };
    };
    const E = D ? D.entries() : [];
    // key moments: losses, fires and the admirals first; of the sightings only each side's first of a carrier
    const firstCv = {}, score = e => e.pri * 10 + (e.kind === 'sunk' || e.kind === 'damage' || e.kind === 'admiral' ? 6 : e.kind === 'strike' ? 2 : 0) - (e.kind === 'sighting' ? 4 : 0);
    const key = E.filter(e => {
      if (e.pri < 2 || e.kind === 'victory') return false;
      if (e.kind !== 'sighting') return true;
      if (firstCv[e.nation] || !/carrier/.test(e.text)) return false;
      return (firstCv[e.nation] = true);
    }).sort((a, b) => score(b) - score(a) || a.t - b.t).slice(0, 5).sort((a, b) => a.t - b.t);
    const how = d.reason === 'kill' ? (d.loser ? 'the ' + d.loser + ' surface fleet destroyed' : 'the enemy fleet annihilated')
      : d.reason === 'retire' ? (d.loser || 'the enemy') + ' fleet retired from the action'
      : d.reason === 'stall' ? 'only submarines left; decided on tonnage' : 'the action broken off at dusk; decided on tonnage';
    return { winner: d.winner, how, round: d.round, t0: D ? D.clock(0) : '', t1: D ? D.clock() : '', sides: [side('USN'), side('IJN')], key };
  }

  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  function html(r) {
    const col = s => '<div class="col ' + s.n.toLowerCase() + '"><h3>' + (s.n === 'USN' ? 'United States Navy' : 'Imperial Japanese Navy') + '</h3>' +
      (s.adm ? '<p><u>Commanding</u> ' + esc(s.adm) + (s.flag ? ', flag in ' + esc(s.flag) : '') + '</p>' : '') +
      '<p><u>Ships lost</u> ' + (s.lost.length ? esc(s.lost.join(', ')) : 'none') + (s.escaped ? '; ' + s.escaped + ' escaped' : '') + '</p>' +
      '<p><u>Aircraft lost</u> ' + s.planes + '</p>' +
      (s.mvp ? '<p><u>Ship of the day</u> ' + esc(s.mvp) + '</p>' : '') + (s.ace ? '<p><u>Top pilot</u> ' + esc(s.ace) + '</p>' : '') + '</div>';
    return '<div class="stamp">Secret</div><div class="hd">Action Report</div>' +
      '<div class="meta">Round ' + r.round + ' · ' + r.t0 + '–' + r.t1 + ' hrs</div>' +
      '<div class="res">' + (r.winner ? esc(r.winner) + ' victory' : 'No decision') + '<span>' + esc(r.how) + '</span></div>' +
      '<div class="cols">' + col(r.sides[0]) + col(r.sides[1]) + '</div>' +
      (r.key.length ? '<div class="km"><u>Key moments</u>' + r.key.map(e => '<div><b>' + e.clock + '</b> ' + esc(e.text) + '</div>').join('') + '</div>' : '') +
      '<div class="sig">— Flag Secretary, for the Commander</div>';
  }
  function show(r) {
    if (!el) { el = document.createElement('div'); el.id = 'aar'; document.body.appendChild(el); el.addEventListener('click', hide); }
    el.innerHTML = html(r); el.classList.add('on');
    hideAt = WW.game.mode === 'auto' ? performance.now() + (AUTO_HOLD - DELAY) * 1000 : 0;
  }
  function hide() { if (el) el.classList.remove('on'); hideAt = 0; }
  let sampleT = 0;
  function update() {
    const now = performance.now();
    if (WW.game.state === 'battle' && now > sampleT) { sampleT = now + 400; for (const p of WW.world.planes) seenPlanes.add(p); } // planes lost: every plane flown
    if (showAt && now > showAt) { showAt = 0; if (last) show(last); }
    if (hideAt && now > hideAt) hide();
  }
  const camUpdate = WW.cam && WW.cam.update;
  if (camUpdate) WW.cam.update = function (rdt) { camUpdate.call(WW.cam, rdt); try { update(); } catch (e) { /* visual only */ } };
  WW.aar = { last: () => last, show: r => show(r || last), hide, visible: () => !!(el && el.classList.contains('on')) };
})(window.WW);
