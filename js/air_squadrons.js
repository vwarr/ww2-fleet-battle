// air_squadrons.js — WW.squadrons: the air group's command structure. Each carrier gets a name and one fighter,
// dive bomber and torpedo squadron (USN VF-/VB-/VT-<n>, IJN "<carrier> fighter / dive-bomber / attack unit").
// Squadrons belong to a carrier slot (the n-th carrier of a nation, like air_aces.js rosters), so they and their
// pilots carry over between rounds; WW.aces.reset() resets both. A launched plane joins its squadron and an
// element of the same mission: USN fighters fly 2-plane sections paired into 4-plane divisions, IJN fighters
// 3-plane shotai, bombers 3-plane vics. plane.squadron, plane.element, plane.leader (null for a leader),
// plane.wing (0 = leader). If a leader is lost or turns for home, the next plane leads; a lone survivor joins
// another element of the mission. follow() keeps a wingman on its slot (CAP, escort transit). Events:
// 'airOrder' { carrier, squadron, order: 'launch' | 'reform' | 'rejoin', plane, leader }. Load after air_aces.js.
// Names come from the slot, never from WW.rand, so they cannot change the sim's random sequence.
window.WW = window.WW || {};
(function () {
  const CV = WW.CV_ROSTER || { // the slot roster lives in ship_classes.js (a carrier's class follows its name)
    USN: [['Enterprise', 6], ['Yorktown', 5], ['Hornet', 8], ['Saratoga', 3], ['Lexington', 2], ['Wasp', 7]],
    IJN: [['Akagi'], ['Kaga'], ['Soryu'], ['Hiryu'], ['Shokaku'], ['Zuikaku']]
  };
  const CODE = { fighter: 'VF', dive: 'VB', torpedo: 'VT' };
  const IJN_UNIT = { fighter: 'fighter unit', dive: 'dive-bomber unit', torpedo: 'attack unit' };
  const SIZE = { USN: { fighter: 2, dive: 3, torpedo: 3 }, IJN: { fighter: 3, dive: 3, torpedo: 3 } };
  const JOIN_T = 30;                      // a new launch joins an open element of its mission for this long
  // wingman slots off the element leader: [ahead, right, up]. 10 abeam ~ 2 spans (span ~5 at PLANE_SCALE 1.7):
  // a clear wingtip gap of about one span, so close camera shots read two planes, not one stacked pair
  const SLOT = { 2: [[0, 0, 0], [-6, 10, 1]], 3: [[0, 0, 0], [-6, 10, 1], [-6, -10, 1.5]] };
  const DIV2 = [-13, -23, 3];             // USN second section leader off the division leader
  let persist = { USN: [], IJN: [] }, elems = [], nextEl = 1;
  const ST = { elements: 0, reforms: 0, rejoins: 0 };

  function slotOf(cv) {
    let n = 0;
    for (const s of WW.world.ships) { if (s === cv) break; if (s.nation === cv.nation && s.hangar) n++; }
    return n;
  }
  // The carrier's name and squadrons (made once per slot, kept across rounds).
  function group(cv) {
    if (cv._sq) return cv._sq;
    const slot = slotOf(cv), L = persist[cv.nation] || (persist[cv.nation] = []);
    let g = L[slot];
    if (!g) {
      const t = CV[cv.nation] || CV.USN, e = t[slot % t.length], num = e[1] || slot + 1, sq = {};
      for (const k in CODE) {
        const name = cv.nation === 'USN' ? CODE[k] + '-' + num : e[0] + ' ' + IJN_UNIT[k];
        sq[k] = { kind: k, nation: cv.nation, name, short: name, cvName: e[0], leader: null, sorties: 0, lost: 0 };
      }
      g = L[slot] = { name: e[0], sq };
    }
    cv.name = cv.name || g.name;
    return (cv._sq = g);
  }
  function squadronOf(cv, kind) { return cv && cv.hangar ? group(cv).sq[kind] || null : null; }

  // ---------- elements ----------
  const live = p => p && p.alive && !p.removed && p.state !== 'return' && p.state !== 'landing' && p.state !== 'rollout';
  function mission(p) { return (p.target ? 'S' : 'C') + p.carrier.id + p.kind; }
  function join(p) {
    const sq = squadronOf(p.carrier, p.kind);
    if (!sq) return;
    p.squadron = sq; sq.sorties++;
    const key = mission(p), size = (SIZE[p.nation] || SIZE.USN)[p.kind] || 3, now = WW.time.now;
    let el = null;
    for (const e of elems) if (e.key === key && e.members.length < size && now - e.t0 < JOIN_T && live(e.members[0])) { el = e; break; }
    if (!el) {
      el = { id: nextEl++, key, kind: p.kind, nation: p.nation, sq, size, members: [], t0: now, div: null };
      if (p.kind === 'fighter' && p.nation === 'USN') { // pair sections into a division
        for (const e of elems) if (e.key === key && !e.div && e.pair === undefined && now - e.t0 < JOIN_T * 2 && live(e.members[0])) { el.div = e; e.pair = el; break; }
      }
      elems.push(el); ST.elements++;
    }
    el.members.push(p);
    setRoles(el);
    if (p.wing === 0 && WW.emit) WW.emit('airOrder', { carrier: p.carrier, squadron: sq, order: 'launch', plane: p, leader: p, mission: key[0] === 'S' ? 'strike' : 'cap' });
  }
  function setRoles(el) {
    const L = el.members[0];
    el.members.forEach((m, i) => { m.element = el; m.wing = i; m.leader = i ? L : null; });
  }
  function update() {
    for (let i = elems.length - 1; i >= 0; i--) {
      const el = elems[i], M = el.members, L0 = M[0];
      for (let j = M.length - 1; j >= 0; j--) {
        const m = M[j];
        if (!m.alive || m.removed) { M.splice(j, 1); if (m.squadron && m.squadron.leaderPlane === m) m.squadron.leaderPlane = null; if (!m.alive && m._downed) m.squadron && m.squadron.lost++; continue; }
        if (j > 0 && !live(m)) { M.splice(j, 1); m.element = null; m.leader = null; } // a wingman going home leaves
      }
      if (M.length && !live(M[0]) && M.length > 1) { const l = M.shift(); l.element = null; l.leader = null; }
      if (!M.length) { if (el.pair) el.pair.div = null; if (el.div) el.div.pair = undefined; elems.splice(i, 1); continue; }
      if (M[0] !== L0) { setRoles(el); ST.reforms++; if (WW.emit) WW.emit('airOrder', { carrier: M[0].carrier, squadron: el.sq, order: 'reform', plane: M[0], leader: M[0] }); }
      if (M.length === 1 && live(M[0])) { // lone survivor: join another element of the same mission with room
        for (const e of elems) {
          if (e === el || e.key !== el.key || e.members.length >= e.size || !live(e.members[0])) continue;
          const p = M[0]; M.length = 0; e.members.push(p); setRoles(e); ST.rejoins++;
          if (WW.emit) WW.emit('airOrder', { carrier: p.carrier, squadron: el.sq, order: 'rejoin', plane: p, leader: e.members[0] });
          break;
        }
      }
    }
    // pilots belong to their squadron; the squadron leader is its senior pilot in the air
    for (const p of WW.world.planes) {
      if (!p.pilot || !p.squadron || !p.alive) continue;
      const sq = p.squadron;
      p.pilot.squadron = sq.name;
      if (!sq.leader || sq.leader.lost) sq.leader = p.pilot;
      if (p._downed) p.pilot.lost = true;
    }
  }
  // Wingman station keeping: true while it flies its slot on the element (or division) leader.
  function follow(pl, dt) {
    const el = pl.element;
    if (!el) return false;
    let L = pl.leader, sl;
    if (L) sl = (SLOT[el.size] || SLOT[3])[Math.min(pl.wing, 2)];
    else if (el.div && pl.target && live(el.div.members[0])) { L = el.div.members[0]; sl = DIV2; } // escorts: the division flies together; CAP sections hold their own stations (air_cap.js)
    if (!L || !live(L) || L.state === 'takeoff') return false;
    if (L.foe && L.state === 'attack') sl = [-9, sl[1] * 1.6, 2];   // loose cover behind the leader in a fight
    const c = Math.cos(L.heading), s = Math.sin(L.heading);
    const sx = L.x + c * sl[0] - s * sl[1], sz = L.z + s * sl[0] + c * sl[1];
    const ex = sx - pl.x, ez = sz - pl.z, d = Math.hypot(ex, ez), ea = ex * c + ez * s;
    const la = d > 25 ? Math.min(50, d) : 16 + Math.max(0, -ea);   // a long look-ahead: shallow, smooth corrections
    const v = d > 25 ? pl.pt.speed * 1.15 : WW.clamp(L.speed + ea * 0.8, L.speed * 0.7, pl.pt.speed * 1.2);
    pl.fly(sx + c * la, sz + s * la, L.y + sl[2], dt, v, L.foe ? 1.7 : d > 25 ? 1.4 : 1.0);
    return true;
  }
  // "Lt. Cmdr. Thach" style name for a plane's pilot (captions)
  function rank(p) {
    const pl = p && p.pilot; if (!pl) return null;
    const usn = p.nation === 'USN', sq = p.squadron;
    const r = sq && sq.leader === pl ? (usn ? 'Lt. Cmdr.' : 'Lt.') : p.wing === 0 ? (usn ? 'Lt.' : 'Lt. (jg)') : (usn ? 'Ens.' : 'PO1c');
    return r + ' ' + pl.name;
  }

  function clear() { elems = []; nextEl = 1; } // element ids feed the escort weave phase: same ids every round
  if (WW.air) {
    const launch = WW.air.launch, upd = WW.air.update;
    WW.air.launch = function (cv, kind, target) {
      const p = launch.apply(this, arguments);
      if (p) try { join(p); } catch (e) { console.error('squadrons', e); }
      return p;
    };
    WW.air.update = function (dt) { const r = upd.apply(this, arguments); try { update(); } catch (e) { console.error('squadrons', e); } return r; };
  }
  if (WW.aces && WW.aces.reset) { const r0 = WW.aces.reset; WW.aces.reset = function () { persist = { USN: [], IJN: [] }; return r0.apply(this, arguments); }; }
  WW.on('roundStart', clear);
  WW.on('setupStart', clear);
  WW.squadrons = { group, squadronOf, follow, rank, stats: ST, elements: () => elems, SIZE };
})();
