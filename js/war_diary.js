// war_diary.js - WW.diary: the admiral's war diary (visual / UI only). A running log of the battle's key
// moments with in-battle clock times ("0714 — Enemy carriers sighted bearing 040 (Kingfisher from Northampton)"),
// built from sim events: contact / firstSighting and flying-boat 'report' (batched per side into sighting
// reports, which also become the pinned notes of the plot table), airOrder strikeAway, shipHit / deckHit /
// magazine / engineHit, shipSunk / shipScuttled / shipEscaped, escortCharge, rescue, ace, admiralOrder,
// misidResolved, flyingBoat 'lost' and victory. Events that a branch does not emit are simply never heard.
// Display: a typed log card (#diary) that slides in at the right in map view; L toggles it (per view). An
// important entry flashes as a small caption in the director view through WW.airCaptions.say (its 15 s throttle).
// Clock: WW.dayNight.hourAt(roundTime) when present, else 0600 + roundTime / 120 h (1 sim s = half a minute).
// Rules: Math.random never needed; handlers only read the sim and never throw (WW.emit catches anyway).
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  if (WW.simOnly) return;
  const MAX = 160, SHOW = 13, BATCH = 1.5, NOTE_KEEP = 7;
  const CODE = { carrier: 'CV', battleship: 'BB', cruiser: 'CA', destroyer: 'DD', submarine: 'SS', pt: 'PT', flyingboat: 'VP' };
  const WORD = { carrier: ['carrier', 'carriers'], battleship: ['battleship', 'battleships'], cruiser: ['cruiser', 'cruisers'],
    destroyer: ['destroyer', 'destroyers'], submarine: ['submarine', 'submarines'], pt: ['PT boat', 'PT boats'] };
  const RANK = { carrier: 6, battleship: 5, cruiser: 4, destroyer: 3, submarine: 2, pt: 1 };
  // fallback period names (the admirals branch names ships itself: ship.name wins). Carriers follow the
  // squadron slots of air_squadrons.js, so the n-th carrier gets the same name its air group uses.
  const NAMES = {
    USN: { carrier: ['Enterprise', 'Yorktown', 'Hornet', 'Saratoga', 'Lexington', 'Wasp'],
      battleship: ['North Carolina', 'Washington', 'South Dakota', 'Massachusetts', 'Indiana', 'Alabama'],
      cruiser: ['Northampton', 'Pensacola', 'Astoria', 'Minneapolis', 'Portland', 'New Orleans', 'Chester', 'Vincennes'],
      destroyer: ['Hammann', 'Balch', 'Benham', 'Monaghan', 'Aylwin', 'Phelps', 'Gwin', 'Hughes', 'Anderson', 'Morris', 'Fletcher', "O'Bannon"],
      submarine: ['Nautilus', 'Grouper', 'Gudgeon', 'Trout'], pt: ['PT-109', 'PT-59', 'PT-20', 'PT-21', 'PT-22', 'PT-23'] },
    IJN: { carrier: ['Akagi', 'Kaga', 'Soryu', 'Hiryu', 'Shokaku', 'Zuikaku'],
      battleship: ['Kirishima', 'Haruna', 'Hiei', 'Kongo', 'Nagato', 'Mutsu'],
      cruiser: ['Tone', 'Chikuma', 'Mogami', 'Mikuma', 'Chokai', 'Atago', 'Takao', 'Haguro'],
      destroyer: ['Arashi', 'Nowaki', 'Hagikaze', 'Maikaze', 'Isokaze', 'Hamakaze', 'Urakaze', 'Tanikaze', 'Kagero', 'Shiranui', 'Yukikaze', 'Amatsukaze'],
      submarine: ['I-168', 'I-26', 'I-19', 'I-176'], pt: ['Gyoraitei 1', 'Gyoraitei 2', 'Gyoraitei 3', 'Gyoraitei 4', 'Gyoraitei 5', 'Gyoraitei 6'] }
  };
  const names = new Map();
  let entries = [], pend = { USN: [], IJN: [] }, notes = { USN: [], IJN: [] }, sighted = { USN: false, IJN: false };
  let hitSaid = new Set(), reported = new Map(), round = 0, dirty = true, el = null, pref = { map: true, film: false }, tick = 0;

  // ---------- helpers ----------
  function nameOf(s) {
    if (!s) return 'unknown';
    if (s.name) return s.name;
    let n = names.get(s);
    if (n) return n;
    let i = 0;
    for (const o of WW.world.ships) { if (o === s) break; if (o.nation === s.nation && o.type === s.type) i++; }
    const L = (NAMES[s.nation] || NAMES.USN)[s.type];
    n = L ? L[i % L.length] + (i >= L.length ? ' II' : '') : (WW.SHIP_TYPES[s.type] || { name: 'ship' }).name;
    names.set(s, n);
    return n;
  }
  function hours(rt) {
    const d = WW.dayNight;
    try { if (d && d.hourAt) return d.hourAt(rt); } catch (e) { /* fall back */ }
    return 6 + rt / 120;
  }
  function clock(rt) {
    const h = hours(rt === undefined ? (WW.game ? WW.game.roundTime : 0) : rt), m = Math.floor(((h % 24) + 24) % 24 * 60 + 1e-6);
    return String(Math.floor(m / 60)).padStart(2, '0') + String(m % 60).padStart(2, '0');
  }
  const bearing = (fx, fz, x, z) => String(Math.round(((Math.atan2(x - fx, -(z - fz)) * 180 / Math.PI) + 360) % 360) % 360).padStart(3, '0');
  function fleetCentre(n) {
    let x = 0, z = 0, k = 0;
    for (const s of WW.world.ships) if (s.alive && s.nation === n) { x += s.x; z += s.z; k++; }
    return k ? { x: x / k, z: z / k } : null;
  }
  function observer(by) {
    if (!by) return '';
    if (by.stats) return nameOf(by);
    if (by.kind === 'scout') return (by.nation === 'IJN' ? 'Pete' : 'Kingfisher') + (by.carrier ? ' from ' + nameOf(by.carrier) : '');
    if (by.kind === 'flyingboat') return by.boatType || (by.nation === 'IJN' ? 'H6K' : 'PBY');
    return (by.squadron && by.squadron.short) || 'aircraft';
  }
  const word = (t, k) => (WORD[t] || [t, t + 's'])[k > 1 ? 1 : 0];
  const typeOf = c => (c && (c.reportedType || (WW.intel && WW.intel.typeOf && WW.intel.typeOf(c)))) || (c && c.unit && c.unit.type);
  const battle = () => WW.game && (WW.game.state === 'battle' || WW.game.state === 'victory');

  // pri: 0 routine, 1 minor, 2 notable (may flash as a caption), 3 key moment
  function add(text, pri, nation, extra, rt) {
    if (!battle()) return null;
    const t = rt === undefined ? WW.game.roundTime : rt;
    const e = Object.assign({ t, clock: clock(t), text, pri: pri || 0, nation: nation || null, n: entries.length }, extra || {});
    let i = entries.length; while (i > 0 && entries[i - 1].t > t) i--; // a batched sighting keeps its own time
    entries.splice(i, 0, e); if (entries.length > MAX) entries.shift();
    dirty = true;
    if (e.pri >= 2) flash(e);
    WW.emit('diaryEntry', e);
    return e;
  }

  // ---------- sightings: batched per side into one report (and one plot note) ----------
  function queue(nation, unit, by, rep) {
    if (!battle() || !unit || !unit.stats || !pend[nation]) return;
    flush(nation); // a batch older than BATCH s is written first (works under fastForward too)
    const P = pend[nation], old = P.find(q => q.unit === unit);
    if (old) { if (rep) Object.assign(old, rep); return; }
    P.push(Object.assign({ unit, by, t: WW.time.now, rt: WW.game.roundTime }, rep || {}));
  }
  function flush(nation) {
    const P = pend[nation];
    if (!P.length || WW.time.now - P[0].t < BATCH) return;
    pend[nation] = [];
    const count = {}, by = P[0].by;
    let x = 0, z = 0, k = 0, top = 0, misid = false;
    for (const q of P) {
      const c = WW.intel && WW.intel.known(nation, q.unit);
      const t = q.reportedType || typeOf(c) || q.unit.type;
      count[t] = (count[t] || 0) + 1; top = Math.max(top, RANK[t] || 0);
      x += q.x !== undefined ? q.x : c ? c.x : q.unit.x; z += q.z !== undefined ? q.z : c ? c.z : q.unit.z; k++;
      if (q.misid) misid = true;
      reported.set(q.unit, t);
    }
    x /= k; z /= k;
    const types = Object.keys(count).sort((a, b) => (RANK[b] || 0) - (RANK[a] || 0));
    const f = fleetCentre(nation) || { x, z }, brg = bearing(f.x, f.z, x, z), rt = P[0].rt, now = clock(rt);
    const short = types.map(t => count[t] + ' ' + (CODE[t] || t)).join(', ') + ', ' + brg + ', ' + now;
    const N = notes[nation];
    N.push({ text: short, x, z, t: WW.time.now, misid, top, id: Math.random() });
    if (N.length > NOTE_KEEP) N.shift();
    const first = !sighted[nation]; sighted[nation] = true;
    if (top < 4 && !first) return;
    const what = types.map(t => (count[t] > 1 ? count[t] + ' ' : '') + word(t, count[t])).join(', ');
    const ob = observer(by);
    add('Enemy ' + what + ' sighted bearing ' + brg + (ob ? ' (' + ob + ')' : ''), top >= 6 ? 3 : top >= 5 ? 2 : first ? 2 : 1, nation, { kind: 'sighting' }, rt);
  }

  // ---------- event wiring (each handler only reads) ----------
  function on(name, fn) { WW.on(name, e => { try { fn(e); } catch (err) { /* visual only */ } }); }
  on('roundStart', () => {
    round++; entries = []; pend = { USN: [], IJN: [] }; notes = { USN: [], IJN: [] }; sighted = { USN: false, IJN: false };
    hitSaid = new Set(); reported = new Map(); names.clear(); dirty = true;
    for (const s of WW.world.ships) nameOf(s); // name every ship now: the list shrinks as ships sink
    add('Task forces at sea. All hands to battle stations.', 0);
  });
  on('setupStart', () => { entries = []; dirty = true; });
  on('contact', e => { if (e.first) queue(e.nation, e.unit, e.by); });
  on('report', e => queue(e.nation, e.unit, e.by, { reportedType: e.reportedType, misid: !!e.misid, x: e.x, z: e.z }));
  on('misidResolved', e => {
    const was = reported.get(e.unit), now = e.type || (e.unit && e.unit.type);
    if (was && was !== now) add('Correction: the reported ' + word(was, 1) + ' are ' + word(now, 2), 1, e.nation);
    reported.set(e.unit, now);
  });
  on('airOrder', e => {
    if (e.order !== 'strikeAway' || !e.carrier) return;
    const cvn = nameOf(e.carrier), L = e.squadrons || [];
    const sq = !L.length ? 'air group' : L.every(n => n.indexOf(cvn) === 0) ? cvn + ' air group' : L.join(', ');
    add('Strike away from ' + cvn + ': ' + sq + (e.target && e.target.type ? ' (target: ' + word(reported.get(e.target) || e.target.type, 1) + ')' : ''), 2, e.carrier.nation, { kind: 'strike' });
  });
  on('shipHit', e => {
    const s = e.ship;
    if (!s || !s.alive || !RANK[s.type] || RANK[s.type] < 4) return;
    if ((e.kind === 'bomb' || e.kind === 'torpedo') && !hitSaid.has(s)) {
      hitSaid.add(s);
      add(nameOf(s) + (e.kind === 'bomb' ? ' hit by bombs' : ' takes a torpedo'), s.type === 'carrier' ? 2 : 1, s.nation);
    }
    if (s.hp < s.maxHp * 0.5 && !hitSaid.has('half' + s.id)) {
      hitSaid.add('half' + s.id);
      add(nameOf(s) + ' hit, burning', RANK[s.type] >= 5 ? 2 : 1, s.nation, { kind: 'damage' });
    }
  });
  on('deckHit', e => e.ship && add(nameOf(e.ship) + ': flight deck ablaze' + (e.planes ? ', ' + e.planes + ' planes lost on deck' : ''), 3, e.ship.nation, { kind: 'damage' }));
  on('magazine', e => e.ship && add(nameOf(e.ship) + ' blows up: magazine explosion', 3, e.ship.nation, { kind: 'damage' }));
  on('engineHit', e => e.ship && RANK[e.ship.type] >= 5 && add(nameOf(e.ship) + ' hit in the engine room, losing way', 1, e.ship.nation));
  on('shipSunk', s => s && s.stats && add(nameOf(s) + (s.type === 'carrier' || s.type === 'battleship' ? ' sinks' : ' sunk'), RANK[s.type] >= 5 ? 3 : RANK[s.type] >= 3 ? 2 : 1, s.nation, { kind: 'sunk', ship: s }));
  on('shipScuttled', s => s && s.stats && add(nameOf(s) + ' scuttled by her own escorts', 2, s.nation, { kind: 'sunk' }));
  on('shipEscaped', s => s && s.stats && add(nameOf(s) + ' breaks away and escapes ' + (s.x < WW.cfg.MAP_W / 2 ? 'west' : 'east'), 1, s.nation));
  on('escortCharge', e => e.carrier && add((e.ships || []).slice(0, 2).map(nameOf).join(' and ') + ((e.ships || []).length > 2 ? ' and others' : '') + ' charge to cover ' + nameOf(e.carrier), 2, e.carrier.nation));
  on('rescue', e => {
    const who = e.ship ? nameOf(e.ship) : e.air ? observer(e.air) : null;
    if (who) add(who + ' picks up ' + (e.kind === 'pilot' ? 'a downed flyer' : (e.n > 1 ? e.n + ' ' : '') + 'survivors'), 1, (e.ship || e.air || {}).nation);
  });
  on('ace', e => e.pilot && add(e.pilot.name + ' of ' + (e.plane && e.plane.squadron ? e.plane.squadron.short : 'the air group') + ' makes ace', 2, e.pilot.nation));
  on('flyingBoat', e => e.order === 'lost' && e.plane && add(observer(e.plane) + ' patrol plane lost', 1, e.nation || e.plane.nation));
  on('admiralOrder', e => {
    if (!e.text) return;
    const pri = { transfer: 3, flagLost: 3, leaderless: 3, strike: 2, retire: 2, press: 2, command: 1 }[e.order];
    add(e.text, pri === undefined ? 1 : pri, e.nation, { kind: 'admiral', order: e.order });
  });
  on('victory', d => {
    const how = d.reason === 'retire' && d.loser ? d.loser + ' fleet retires' : d.reason === 'kill' ? 'enemy fleet destroyed' : d.reason === 'stall' ? 'only submarines remain' : 'night falls on the action';
    add('Action ends: ' + how + '. ' + (d.winner ? d.winner + ' victory' : 'No decision') + '.', 3, d.winner, { kind: 'victory' });
  });

  // ---------- the card ----------
  function build() {
    el = document.createElement('div'); el.id = 'diary';
    el.innerHTML = '<div class="dh">War Diary</div><div class="ds"></div><div class="db"></div>';
    document.body.appendChild(el);
    el.sub = el.querySelector('.ds'); el.body = el.querySelector('.db');
  }
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  function render() {
    const L = entries.slice(-SHOW);
    el.sub.textContent = 'Round ' + (WW.stats ? WW.stats.round : round) + ' · ' + (battle() ? clock() + ' hrs' : '');
    el.body.innerHTML = L.map((e, i) => '<div class="de p' + e.pri + (i === L.length - 1 ? ' last' : '') + '"><b>' + e.clock + '</b>' +
      (e.nation ? '<i class="' + e.nation.toLowerCase() + '">' + e.nation + '</i>' : '<i></i>') + '<span>' + esc(e.text) + '</span></div>').join('');
  }
  const mapView = () => !!(WW.cam && WW.cam.mode === 'map');
  function update(rdt) {
    if (!el) build();
    for (const n of ['USN', 'IJN']) flush(n);
    const want = battle() && entries.length > 0 && (mapView() ? pref.map : pref.film);
    el.classList.toggle('on', want);
    el.classList.toggle('film', !mapView());
    tick += rdt;
    if (want && (dirty || tick > 1)) { tick = 0; dirty = false; render(); }
  }
  function flash(e) {
    if (mapView() || (el && el.classList.contains('on')) || !WW.airCaptions || !WW.airCaptions.say) return;
    WW.airCaptions.say(e.text, e.clock + ' hrs');
  }
  // drive from the camera update (after it): no main.js hook needed
  const camUpdate = WW.cam && WW.cam.update;
  if (camUpdate) WW.cam.update = function (rdt) { camUpdate.call(WW.cam, rdt); try { update(rdt); } catch (e) { /* visual only */ } };

  WW.diary = {
    entries: () => entries, notes: n => notes[n] || [], add, clock, hours, nameOf, observer, bearing, CODE, WORD,
    reportedOf: u => reported.get(u),
    toggle() { const k = mapView() ? 'map' : 'film'; pref[k] = !pref[k]; return 'War diary ' + (pref[k] ? 'on' : 'off'); },
    show(on) { pref.map = pref.film = on !== false; }
  };
})(window.WW);
