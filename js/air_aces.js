// air_aces.js - pilots, kill credit and aces (WW.aces). Load after aircraft.js.
// Every carrier plane gets a pilot from its carrier's roster. A pilot who lands goes back to the roster and
// flies again; a pilot who is shot down or ditches is lost. Rosters belong to a carrier slot (the n-th carrier
// of a nation), so surviving pilots carry over into the next round. A kill is credited to the pilot of
// victim.killedBy (set by the dogfight code) or, if that is missing, to an enemy plane whose foe was the victim.
// At ACE_KILLS a pilot becomes an ace: plane.ace = true, plane.kills, small kill marks on the fuselage sides,
// and a slight skill bonus (plane.skill, +5% speed, +15% hp).
// Hooks: wraps WW.air.update / clearAll and WW.Plane.prototype.shotDown / ditch (no edits to aircraft.js).
window.WW = window.WW || {};
(function () {
  'use strict';
  var ACE_KILLS = 5, MAX_MARKS = 10, SKILL_SPEED = 1.05, SKILL_HP = 1.15;
  var KINDS = { fighter: 1, dive: 1, torpedo: 1 };
  // fuselage half-width per kind in model units (models_planes.js SPEC.fw * ~0.54): marks sit on the skin
  var SIDE_Z = { fighter: 0.235, dive: 0.255, torpedo: 0.265 };
  var NAMES = {
    USN: ['O\'Hare', 'Thach', 'Vejtasa', 'Swett', 'Galer', 'Foss', 'Flatley', 'McCuskey', 'Mehle', 'Hanson', 'Dibb', 'Brassfield'],
    IJN: ['Sakai', 'Nishizawa', 'Iwamoto', 'Sugita', 'Ota', 'Sasai', 'Okumura', 'Muto', 'Hayashi', 'Ishii', 'Fukumoto', 'Kanno']
  };
  var rosters = { USN: [], IJN: [] };   // [slot] -> { idle: [pilot] }
  var nextId = 1, flying = [], pending = [], acePT = {};
  var markPool = [], G = null;

  function newPilot(nation, kind) {
    var id = nextId++, n = NAMES[nation] || NAMES.USN;
    return { id: id, nation: nation, kind: kind, name: n[(id * 7) % n.length], kills: 0, sorties: 0, ace: false };
  }
  function roster(carrier) {
    if (carrier._roster) return carrier._roster;
    var slot = 0;
    for (var i = 0; i < WW.world.ships.length; i++) {
      var s = WW.world.ships[i];
      if (s === carrier) break;
      if (s.nation === carrier.nation && s.hangar) slot++;
    }
    var list = rosters[carrier.nation] || (rosters[carrier.nation] = []);
    return (carrier._roster = list[slot] || (list[slot] = { idle: [] }));
  }
  function assign(p) {
    p._pilotDone = true;
    if (!KINDS[p.kind] || !p.carrier) return;
    var r = roster(p.carrier), pl = null;
    for (var i = 0; i < r.idle.length; i++) if (r.idle[i].kind === p.kind) { pl = r.idle.splice(i, 1)[0]; break; }
    if (!pl) pl = newPilot(p.nation, p.kind);
    pl.sorties++;
    p.pilot = pl; p.kills = pl.kills; p.ace = pl.ace;
    if (pl.ace) promote(p);
    flying.push(p);
  }

  // ---- kill marks: pooled strips of tiny flags (USN ace: rising-sun flags; IJN ace: white stars-and-bar ticks) ----
  function geo() {
    if (G) return G;
    var m = WW.models;
    G = { flag: new THREE.BoxGeometry(0.11, 0.075, 0.012), dot: new THREE.BoxGeometry(0.04, 0.04, 0.016) };
    m._whiten(G.flag); m._whiten(G.dot);
    G.white = m._mat(0xf4efe4); G.red = m._mat(0xd2564c); G.blue = m._mat(0x34507e);
    return G;
  }
  function getMarks(nation) {
    var mk = markPool.pop();
    if (!mk) {
      var g = geo(), grp = new THREE.Group();
      mk = { group: grp, items: [] };
      for (var i = 0; i < MAX_MARKS * 2; i++) {
        var f = new THREE.Mesh(g.flag, g.white), d = new THREE.Mesh(g.dot, g.red);
        grp.add(f); grp.add(d); mk.items.push({ f: f, d: d });
      }
    }
    return mk;
  }
  // Lay out n marks on both fuselage sides, below and ahead of the canopy, two rows of five.
  function layout(mk, kind, nation, n) {
    var g = geo(), z = SIDE_Z[kind] || 0.24, usn = nation === 'USN';
    for (var i = 0; i < mk.items.length; i++) {
      var it = mk.items[i], j = i % MAX_MARKS, side = i < MAX_MARKS ? 1 : -1, show = j < n;
      it.f.visible = it.d.visible = show;
      if (!show) continue;
      var col = j % 5, row = Math.floor(j / 5), x = 0.6 - col * 0.135, y = 0.07 - row * 0.1;
      it.f.position.set(x, y, side * z); it.d.position.set(x, y, side * (z + 0.003));
      it.f.material = usn ? g.white : g.blue;   // USN pilots paint Japanese flags; IJN pilots white-on-blue ticks
      it.d.material = usn ? g.red : g.white;
    }
  }
  function showMarks(p) {
    if (!p.group) return;
    if (!p._marks) { p._marks = getMarks(p.nation); p.group.add(p._marks.group); }
    layout(p._marks, p.kind, p.nation, Math.min(MAX_MARKS, p.kills));
  }
  function dropMarks(p) {
    if (!p._marks) return;
    if (p._marks.group.parent) p._marks.group.parent.remove(p._marks.group);
    markPool.push(p._marks); p._marks = null;
  }

  function promote(p) {
    p.ace = true;
    p.skill = 1 + 0.03 * Math.min(10, p.kills);
    if (p.pt && !p._acePT) {
      var k = p.kind + p.nation, b = p.pt; // per nation: dogfight.equip gives each nation its own stats
      p.pt = acePT[k] || (acePT[k] = Object.assign({}, b, { speed: b.speed * SKILL_SPEED, hp: b.hp * SKILL_HP }));
      p._acePT = true;
      if (p.alive && p.hp === p.maxHp) { p.maxHp = p.pt.hp; p.hp = p.maxHp; }
    }
    showMarks(p);
  }

  function credit(victim) {
    var by = victim.killedBy;
    if (!by || by.nation === victim.nation || by.stats) {  // missing, or a ship's AA: fall back to a fighter on the victim
      if (by && by.stats) return;                          // AA kill: no pilot credit
      by = null;
      for (var i = 0; i < WW.world.planes.length; i++) {
        var q = WW.world.planes[i];
        if (q.alive && q.foe === victim && q.nation !== victim.nation && Math.hypot(q.x - victim.x, q.y - victim.y, q.z - victim.z) < 25) { by = q; break; }
      }
      if (!by) return;
    }
    if (!by.pilot && !by._pilotDone && by.kind) assign(by);
    var pl = by.pilot;
    if (!pl) return;
    pl.kills++; by.kills = pl.kills; stats.credited++;
    if (pl.kills >= ACE_KILLS) {
      var first = !pl.ace;
      pl.ace = true;
      if (by.alive || by.state !== 'falling') promote(by);
      if (first) { WW.emit('ace', { plane: by, pilot: pl }); stats.acesMade++; }
    } else if (by.ace) showMarks(by);
  }

  var stats = { kills: 0, credited: 0, acesMade: 0 };
  function update() {
    var arr = WW.world.planes, i;
    for (i = 0; i < arr.length; i++) if (!arr[i]._pilotDone && !arr[i].removed) assign(arr[i]);
    for (i = 0; i < pending.length; i++) { stats.kills++; credit(pending[i]); }
    pending.length = 0;
    var j = 0;
    for (i = 0; i < flying.length; i++) {
      var p = flying[i];
      if (!p.removed) { flying[j++] = p; continue; }
      dropMarks(p);
      // landed (removed without being shot down / ditched): the pilot rejoins the carrier's roster
      if (!p._downed && p.state !== 'falling' && p.state !== 'ditch' && p.pilot && p.carrier) roster(p.carrier).idle.push(p.pilot);
    }
    flying.length = j;
  }
  // round reset: pilots still in the air at the end of a round survive and go back to their roster
  function clear() {
    for (var i = 0; i < flying.length; i++) {
      var p = flying[i];
      dropMarks(p);
      if (!p._downed && p.alive && p.pilot && p.carrier && p.carrier._roster) p.carrier._roster.idle.push(p.pilot);
    }
    flying.length = 0; pending.length = 0;
  }

  function wrap(obj, name, after) {
    var f = obj && obj[name];
    if (typeof f !== 'function') return;
    obj[name] = function () { var r = f.apply(this, arguments); after.call(this, r, arguments); return r; };
  }
  if (WW.Plane && WW.air) {
    var P = WW.Plane.prototype;
    // mark before the original runs (it may remove the plane or change state)
    ['shotDown', 'ditch'].forEach(function (nm) {
      var f = P[nm];
      if (typeof f !== 'function') return;
      P[nm] = function () {
        if (this.alive && !this._downed) { this._downed = nm; if (nm === 'shotDown') pending.push(this); }
        return f.apply(this, arguments);
      };
    });
    wrap(WW.air, 'update', function () { try { update(); } catch (e) { console.error('aces', e); } });
    var oc = WW.air.clearAll;
    if (typeof oc === 'function') WW.air.clearAll = function () { try { clear(); } catch (e) { /* never throw */ } return oc.apply(this, arguments); };
  } else console.error('air_aces.js must load after aircraft.js');

  // camera hook (camera.js candidates(): WW.camHooks): an ace in a dogfight is a good subject
  (WW.camHooks = WW.camHooks || []).push(function (add, dur) {
    for (var i = 0; i < flying.length; i++) {
      var p = flying[i];
      if (p.ace && p.alive && p.state === 'attack' && p.foe) add(6.5, 'chase', p, { dur: dur(11, 14) });
    }
  });

  WW.aces = {
    ACE_KILLS: ACE_KILLS,
    stats: stats,
    rosters: rosters,
    // all pilots (in the air and in rosters), for tests / ui
    pilots: function () {
      var out = [], seen = {};
      function add(pl) { if (pl && !seen[pl.id]) { seen[pl.id] = 1; out.push(pl); } }
      flying.forEach(function (p) { add(p.pilot); });
      ['USN', 'IJN'].forEach(function (n) { rosters[n].forEach(function (r) { r.idle.forEach(add); }); });
      return out;
    },
    count: function (nation) { return this.pilots().filter(function (pl) { return pl.ace && (!nation || pl.nation === nation); }).length; },
    infoText: function () {
      var u = this.count('USN'), j = this.count('IJN');
      return u + j ? '   aces USN ' + u + ' IJN ' + j : '';
    },
    reset: function () { rosters.USN.length = 0; rosters.IJN.length = 0; clear(); }
  };
})();
