// diary_normandy.js - WW.diaryNormandy: the war diary's land battle at Omaha and Pointe du Hoc (Normandy only; visual /
// UI, docs/NORMANDY_PLAN.md P9). It writes into WW.diary (war_diary.js: the card, the clock, the flash captions) in the
// diary's terse log voice, on the D-Day clock (normandy.js clock: war_diary's clock reads it through WW.dayNight.hourAt,
// so 60 sim s is "0630"), from the sim's own events, aggregated so a wave of forty craft is a line, not forty:
//   the bombardment and the B-24s (airOffmap 'drop', with the cloud: inland), the rocket barrage at 06:25 (the clock),
//   the DD tanks launched and foundering (craftEvent; a tally, and how many reached the beach), H-Hour, each sector's
//   first touchdown (the first ramp: craftEvent 'ramp'), craft lost (batched over BATCH s: mined / hit, the LCIs and LCTs by
//   name), the first men across the shingle per sector (squadEvent 'shelf'), gaps blown (gapBlown; gapEvent from
//   beach_engineers.js when present), the leaders who got the beach moving (squadEvent 'leader', leaders.js: their own
//   line; junior leaders at most one every JUNIOR_GAP s), the first men on the bluff per sector, positions taken and
//   strongpoints silenced (by assault or by naval gunfire: who was hitting it), draws opened (drawOpened) and their road
//   blocks (drawExit), the destroyers closing the beach, the Rangers at Pointe du Hoc (the ropes, the top, the guns found:
//   gunsSpiked), the P-47s, prisoners (prisonerEvent), the tide (07:30 the obstacles awash, 08:15 the sea at the
//   shingle, 11:00 high water), an hourly state of the beach, and the end: the beachhead won or the landing repulsed
//   (normandy_game.js; the victory line is this file's, not war_diary's).
// Entry priorities as war_diary.js: 3 a key moment (bold), 2 notable (may flash as a caption), 1 minor, 0 routine.
// Visual only: never WW.rand; handlers only read the sim and never throw.
window.WW = window.WW || {};
(function (WW) {
  'use strict';
  if (WW.simOnly) return;
  const BATCH = 6, JUNIOR_GAP = 45;
  const on = () => !!WW.isScn && WW.isScn('normandy') && !!WW.normandyTerrain && !!WW.scenarios.normandy.clock;
  const D = () => WW.diary, N = () => WW.scenarios.normandy;
  const rt = () => (WW.game ? WW.game.roundTime : 0);
  const SEC = () => WW.normandyData.SECTORS;
  const secName = id => (id === 'hoc' ? 'Pointe du Hoc' : (SEC().find(s => s.id === id) || {}).name || id || 'the beach');
  const num = n => (n >= 1000 ? Math.floor(n / 1000) + ',' + String(n % 1000).padStart(3, '0') : String(n));
  let said = new Set(), leadT = new Map(), lost = [], dd = null, timed = null, hourly = 0, juniorT = -1e9, hits = new Map(), lastClosed = null;
  const once = k => (said.has(k) ? false : (said.add(k), true));
  function add(text, pri, nation, kind, t) { if (D() && D().add) D().add(text, pri, nation || 'USN', { kind: kind || 'land' }, t); }
  function ev(name, fn) { WW.on(name, e => { if (!on() || !e) return; try { fn(e); } catch (err) { /* visual only */ } }); }

  WW.on('roundStart', () => {
    said = new Set(); leadT = new Map(); lost = []; dd = { launched: 0, foundered: 0, ashore: 0 }; hourly = 0; juniorT = -1e9; hits = new Map(); lastClosed = null;
    if (!on()) return;
    const C = N().clock;
    timed = [   // [clock minutes, text, pri, nation, test]
      [6 * 60 + 25, () => 'LCT(R)s fire the rocket barrage over the first wave: a thousand rockets a craft; most fall short in the surf', 2],
      [6 * 60 + 30, () => 'H-Hour. The first wave goes in on the eight sectors from Charlie to Fox Red', 3],
      [7 * 60 + 30, () => 'Tide rising fast: the obstacle belts going under; the coxswains can no longer see the mines', 1],
      [8 * 60 + 15, () => 'The sea at the shingle on much of the beach: no sand left to cross; the wounded on the flat drowning as it comes in', 2],
      [9 * 60, () => { const I = WW.infantry ? WW.infantry.stats : {}; return (I.onTop || 0) < 200 ? 'First Army off Omaha: V Corps reports the landing in a desperate state; Bradley weighs diverting the follow-up waves to Utah and Gold' : null; }, 2],
      [11 * 60, () => 'High water', 0]
    ].map(r => ({ t: C.at(r[0]), text: r[1], pri: r[2] }));
    add('Force O off Omaha. Naval bombardment begins: Texas on Pointe du Hoc, Arkansas and the cruisers on the beach exits', 1, 'USN', 'land', 0);
  });

  // ---------- the air ----------
  ev('airOffmap', e => {
    const p = e.plane;
    if (e.kind === 'drop' && p.kind === 'b24' && once('b24')) add('B-24s of the 8th Air Force over the beach' + ((N().settings || {}).cloud !== false ? ': bombing through overcast, the sticks fall three miles inland' : ', bombing the strongpoints'), 1);
    else if (e.kind === 'strafe' && p.kind === 'p47' && p.target && p.target.wn && once('p47:' + p.target.wn.wid)) add('P-47s strike ' + p.target.wn.name, 1);
    else if (e.kind === 'shotDown') add((p.kind === 'fw190' ? 'Fw 190' : p.kind === 'p47' ? 'P-47' : p.kind === 'b24' ? 'B-24' : 'Spitfire') + ' shot down over the beach', 1, p.nation);
  });

  // ---------- the craft ----------
  ev('craftEvent', e => {
    const u = e.craft;
    if (u.type === 'dd') {
      if (e.kind === 'launched') { dd.launched++; if (once('ddLaunch')) add('741st Tank Bn launches its DD tanks 5,000 yards out in a heavy chop', 1); }
      else if (e.kind === 'foundered') {
        dd.foundered++;
        if (dd.foundered === 1) add('DD tanks foundering: their canvas screens collapse in the swell and they go down like stones', 2);
        else if (dd.foundered % 5 === 0) add(dd.foundered + ' of ' + dd.launched + ' DD tanks foundered; the crews in their rafts', 1);
      } else if (e.kind === 'beached') dd.ashore++;
      ddDone();
      return;
    }
    if (e.kind === 'ramp') {
      if (once('ramp:' + u.sector)) add(secName(u.sector) + ': ' + (u.unit || 'first craft') + ' touches down' + (u.type === 'lct' ? ', the tanks off the ramps' : ''), u.wave <= 11 ? 2 : 1);
      else if (/5th Ranger/.test(u.unit || '') && once('5th')) add('5th Ranger Bn lands on ' + secName(u.sector), 1);
      else if (u.type === 'lci' && once('lci:' + u.unit)) add(secName(u.sector) + ': LCI(L) beached, ' + u.unit + ' ashore down both ramps', 1);
    } else if (e.kind === 'wrecked' || e.kind === 'mined') {
      lost.push({ u, how: e.kind, t: rt() });
      if (u.type === 'lci' || u.type === 'lct') add(u.C.name + (e.kind === 'mined' ? ' mined' : ' hit and burning') + ' off ' + secName(u.sector) + (u.unit ? ', ' + u.unit + ' aboard' : ''), 2);
    }
  });
  function ddDone() {   // the DD tanks' tally once none is still swimming
    if (!dd.launched || said.has('ddDone') || !WW.landingCraft || rt() < N().clock.H || dd.foundered + dd.ashore === 0) return;
    if (WW.landingCraft.live.some(u => u.type === 'dd' && u.state === 'run')) return;
    said.add('ddDone');
    add('Of ' + dd.launched + ' DD tanks launched, ' + dd.ashore + ' reached the beach', 2);
  }
  function flushLost(force) {   // craft lost over BATCH s: one line
    if (!lost.length || (!force && rt() - lost[0].t < BATCH)) return;
    const L = lost.filter(r => r.u.type !== 'lci' && r.u.type !== 'lct'), t = lost[0].t; lost = [];
    if (!L.length) return;
    const secs = [...new Set(L.map(r => secName(r.u.sector)))], m = L.filter(r => r.how === 'mined').length;
    add(L.length + (L.length > 1 ? ' craft' : ' craft') + ' lost off ' + secs.slice(0, 3).join(', ') + (m ? ' (' + (m === L.length ? 'mined' : m + ' mined, ' + (L.length - m) + ' to gunfire') + ')' : ' to gunfire'), L.length >= 3 ? 1 : 0, 'USN', 'land', t);
  }

  // ---------- the men ----------
  ev('squadEvent', e => {
    const q = e.squad;
    if (e.kind === 'landed' && q && q.state === 'rope' && once('rope')) add('Pointe du Hoc: Rangers at the foot of the cliffs, firing the rocket grapnels under grenades from the top', 2);
    else if (e.kind === 'shelf' && q && q.kind !== 'tank') {
      if (once('shingle')) add(secName(q.sector) + ': first men across the shingle (' + (q.unit || 'the infantry') + ')', 3);
      else if (once('shingle:' + q.sector)) add(secName(q.sector) + ': men across the shingle', 1);
    } else if (e.kind === 'top' && q) {
      if (q.sector === 'hoc') { if (once('hocTop')) add('Rangers atop Pointe du Hoc. The casemates ' + ((N().settings || {}).hocGuns === 'moved' ? 'are empty: the guns are gone' : 'and the guns under fire'), 3); }
      else if (once('top')) add(secName(q.sector) + ': first men on the bluff top (' + (q.unit || 'the infantry') + ')', 3);
      else if (once('top:' + q.sector)) add(secName(q.sector) + ': men on the bluff', 1);
    } else if (e.kind === 'gunsSpiked') add('Rangers find the 155s in an orchard inland, unmanned and laid on Utah, and spike them with thermite', 3);
    else if (e.kind === 'leader') {
      const named = e.key && e.key !== 'junior', text = e.text || ((e.name || 'An officer') + ' gets the men up' + (q && q.unit ? ' (' + q.unit + ')' : ''));
      if (named) { const k = 'leader:' + e.key, last = leadT.get(k); if (last === undefined) add(text, 3); else if (rt() - last > 90) add(text, 1); else return; leadT.set(k, rt()); }   // his line once, then now and then
      else if (rt() - juniorT > JUNIOR_GAP) { juniorT = rt(); add(text, 1); }
    } else if (e.kind === 'captured' && e.el && e.el.wn && once('cap:' + e.el.wn.wid)) add(e.el.wn.name + ': positions taken by the infantry', 1, 'GER');
  });
  ev('gapBlown', g => { const s = g.by && g.by.sector; if (s && once('gap:' + s)) add(secName(s) + ': gap blown in the wire behind the shingle', 1); });
  ev('gapEvent', e => { if (e.kind === 'blown' && e.lane && once('lane:' + (e.lane.sector || e.lane.x))) add((e.lane.sector ? secName(e.lane.sector) + ': ' : '') + 'gap team blows a lane through the obstacles', 1); });
  ev('hocEvent', e => { if (e.kind === 'dukwLadder' && once('dukw')) add('Pointe du Hoc: a DUKW runs in with a London fire ladder; a Ranger fires its Lewis guns from the top', 1); });
  ev('prisonerEvent', e => { if (e.kind === 'surrender' && e.text) add(e.text, 1, 'GER'); });

  // ---------- the strongpoints and the draws ----------
  ev('defenceHit', e => { if (e.el && e.el.wn) hits.set(e.el.wn, { t: rt(), naval: e.cal === 'big' || e.cal === 'med' }); });
  ev('defenceEvent', e => {
    if (e.kind !== 'silenced' || !e.wn) return;
    const w = e.wn, inf = WW.infantry && WW.infantry.squads.some(q => q.alive && q.wn === w && (q.state === 'assault' || q.state === 'top')), h = hits.get(w);
    const by = inf ? ': taken by assault' : h && h.naval && rt() - h.t < 30 ? ': silenced by naval gunfire' : '';
    add(w.name + ' silenced' + by + (w.draw ? ' (' + w.draw + ')' : ''), w.hoc ? 2 : 3, 'GER', 'silenced');
  });
  ev('drawOpened', e => { const d = e.draw; add(d.id + ' open: the ' + d.name + ', the way off ' + exitOf(d) + ', is clear of fire', 3, 'USN', 'draw', e.t); });
  ev('drawExit', e => { const d = e.draw; if (d && once('exit:' + (d.id || d))) add((d.id || d) + ': engineers blow the road block; the first vehicles move up the draw', 2); });
  ev('vehicleEvent', e => { if (e.kind === 'offBeach' && once('offBeach')) add('First vehicles off the beach and inland', 2); });
  function exitOf(d) { const s = SEC().find(q => d.x >= q.x0 && d.x < q.x1); return s ? s.name : 'the beach'; }

  // ---------- the fleet ----------
  ev('shellFired', e => {
    const s = e.ship;
    if (!s || s.type !== 'destroyer' || !e.proj || !e.proj.target || !e.proj.target.isLand || said.has('ddClose')) return;
    if (WW.normandyTerrain.shoreZ(s.x) - s.z > 140) return;
    said.add('ddClose');
    const near = WW.world.ships.filter(o => o.alive && o.type === 'destroyer' && WW.normandyTerrain.shoreZ(o.x) - o.z < 160).map(o => o.name).filter(Boolean);
    add('Destroyers close the beach, scraping bottom: ' + (near.length ? near.slice(0, 4).join(', ') : s.name) + ' firing point-blank at the strongpoints', 2);
  });

  // ---------- the clock: timed entries, the hourly state of the beach ----------
  function poll() {
    if (!on() || !(WW.game && (WW.game.state === 'battle' || WW.game.state === 'victory')) || !timed) return;
    const t = rt(), C = N().clock;
    for (const r of timed) if (!r.done && t >= r.t) { r.done = true; const x = r.text(); if (x) add(x, r.pri, 'USN', 'land', r.t); }
    flushLost(false); if (dd) ddDone();
    const h = Math.floor(C.minutes(t) / 60);
    if (h >= 7 && h > hourly && WW.game.state === 'battle') {
      hourly = h;
      const at = C.at(h * 60), R = WW.normandyGame ? WW.normandyGame.result() : null;
      if (R) add('State of the beach, ' + String(h).padStart(2, '0') + '00: ' + num(R.landed) + ' men ashore, ' + num(R.lost) + ' casualties, ' + num(R.onTop) + ' on the bluffs; ' + R.silenced + ' of ' + R.wns + ' strongpoints silenced, ' + Object.keys(R.draws).length + ' draws open', 0, 'USN', 'land', at);
    }
  }
  const camUpdate = WW.cam && WW.cam.update;
  if (camUpdate) WW.cam.update = function (rdt) { camUpdate.call(WW.cam, rdt); try { poll(); } catch (e) { /* visual only */ } };

  // ---------- the end (normandy_game.js) ----------
  ev('victory', d => {
    flushLost(true);
    const R = WW.normandyGame ? WW.normandyGame.result() : {}, nd = Object.keys(R.draws || {}).length;
    const text = d.reason === 'beachhead' ? 'Beachhead won: ' + nd + ' draws open, ' + num(R.onTop || 0) + ' men on the bluffs. V Corps is ashore on Omaha'
      : d.reason === 'repulsed' ? 'The landing repulsed: the waves spent, too few men left ashore. The follow-up diverted to Utah and Gold'
      : 'The day ends with Omaha still contested: ' + nd + ' draws open, ' + num(R.onTop || 0) + ' men on the bluffs';
    add(text + '.', 3, d.winner || null, 'victory');
  });

  // the German side's tag on the card (style.css colours USN / IJN)
  if (typeof document !== 'undefined') {
    const st = document.createElement('style');
    st.textContent = '#diary .de i.ger, #aar .ger h3 { color: #4d5a48; }';
    document.head.appendChild(st);
  }
  WW.diaryNormandy = { on, dd: () => dd, _poll: poll };
})(window.WW);
