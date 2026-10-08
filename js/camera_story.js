// camera_story.js (camera): story mode for the director (camera.js). Every few minutes, when a good arc is
// available, the director picks a protagonist: a strike's torpedo or dive squadron leader (or its CAG), a CAP
// fighter division / shotai leader scrambling to meet a raid, or a named ace. It then follows that mission
// for ~1-3 min (deck launch, form-up, transit, bandits, the attack, the aftermath), cutting like a film every
// 6-12 s between the shots in camera_story_shots.js (plus camera_action.js over-the-shoulder for a fighter
// in a fight, and its bomb / torpedo hand-offs). Brief cutaways (<= 6 s) for a ship going down elsewhere.
// If the leader dies the camera stays on the fall, then hands off to the wingman / next leader; when the
// whole group is gone the story ends on a wide shot and the director goes back to its usual shots.
// A title card ("VT-6 · Lt. Cmdr. Lindsey") goes through the air-caption throttle (air_captions.js).
// Key F (ui.js) toggles a story now; a click on a plane in the free camera follows its element (freecam.js).
// Never in setup or map view; stops on roundStart / setupStart / victory and when the user takes the camera.
// Visual only: Math.random and the wall clock, never WW.rand; reads the sim, never writes it.
window.WW = window.WW || {};
(function (WW) {
  const MIN_T = 60, MAX_T = 180, GAP = [120, 220];       // story length (real s) and the rest between stories
  const CUT = [6, 12], CUTAWAY = 5, CUTAWAY_GAP = 35, FALL = 4.5, CAPS = 12;
  const wall = () => performance.now() / 1000;
  const dur = (a, b) => a + (b - a) * Math.random();     // camera: Math.random, never WW.rand (seeded rounds)
  const ok = p => p && !p.removed && p.alive;
  const airborne = p => ok(p) && p.state !== 'takeoff' && p.state !== 'rollout' && p.state !== 'landing';
  const KIND = { carrier: 'carrier', battleship: 'battleship', cruiser: 'cruiser', destroyer: 'destroyer', submarine: 'submarine', pt: 'PT boat' };
  let S = null, nextAt = 0, checkT = 0, lastSq = null, scrambles = [];
  const log = [];                                         // recent shots (tests): { sk, kind, phase, at, dur, hard }
  const ST = { stories: 0, handoffs: 0, cutaways: 0, ended: 0 };

  // ---------- arcs ----------
  function rank(p) { return (WW.squadrons && WW.squadrons.rank(p)) || (p.pilot ? p.pilot.name : null); }
  function wavesNow() { return WW.strike && WW.strike._waves ? WW.strike._waves().filter(w => !w.done) : []; }
  function leadOfWave(w) {
    const ms = w.members.filter(ok), pickK = Math.random() < 0.5 ? 'torpedo' : 'dive';
    const el = ms.find(m => m.kind === pickK && m.wing === 0 && m.ordnance) || ms.find(m => m.wing === 0 && m.ordnance && m.kind !== 'fighter');
    return Math.random() < 0.4 && ok(w.cag) ? w.cag : el || (ok(w.cag) ? w.cag : null);
  }
  // the best arc right now: { lead, score, mission }
  function bestArc() {
    let best = null;
    const add = (lead, score, mission) => {
      if (!lead) return;
      if (lead.squadron && lead.squadron === lastSq) score -= 3;
      score += Math.random();
      if (!best || score > best.score) best = { lead, score, mission };
    };
    for (const w of wavesNow()) {
      const lead = leadOfWave(w);
      if (!lead) continue;
      const forming = !w.go || w.members.some(m => ok(m) && m.state === 'takeoff');
      add(lead, forming ? 9 : w.dT > 200 ? 7 : 4, 'strike');
    }
    const now = WW.time.now;
    scrambles = scrambles.filter(e => now - e.sim < 40);
    for (const p of WW.world.planes) {
      if (!airborne(p) && !(ok(p) && p.state === 'takeoff')) continue;
      if (p.kind === 'fighter' && !p.target && p.wing === 0 && p.element) {
        if (scrambles.some(e => e.carrier === p.carrier)) add(p, 8, 'cap');
        else if (p.state === 'attack' && p.foe && p.foe.kind !== 'fighter') add(p, 6, 'cap');
      }
      if (p.ace && airborne(p)) add(p, 5, 'ace');
    }
    return best;
  }
  function anyArc() { // the F key with no good arc: any element leader in the air, else any plane
    let a = bestArc();
    if (a) return a;
    const p = WW.world.planes.find(q => airborne(q) && q.wing === 0 && q.squadron) || WW.world.planes.find(airborne);
    return p ? { lead: p, score: 0, mission: p.ordnance ? 'strike' : 'cap' } : null;
  }

  // ---------- the story ----------
  function groupOf(p) { // the protagonist's group: its element (and paired section), else its wave's squadron
    const g = [];
    const el = p.element;
    if (el) { g.push(...el.members); if (el.div) g.push(...el.div.members); if (el.pair) g.push(...el.pair.members); }
    if (p.wave) for (const m of p.wave.members) if (m.squadron === p.squadron && g.indexOf(m) < 0) g.push(m);
    if (g.indexOf(p) < 0) g.unshift(p);
    return g;
  }
  function titleOf(p, mission) {
    const sq = p.squadron ? p.squadron.short : null, who = rank(p);
    const main = [sq, who].filter(Boolean).join(' · ') || 'Strike leader';
    let sub = '';
    if (mission === 'strike' && p.kind === 'fighter') sub = 'escort' + (p.wave && p.wave.target && KIND[p.wave.target.type] ? ' for a strike on a ' + KIND[p.wave.target.type] : '');
    else if (mission === 'strike') { const t = p.target || (p.wave && p.wave.target); sub = (p.wave && p.wave.cag === p ? 'leads the strike' : 'strike') + (t && KIND[t.type] ? ' on a ' + KIND[t.type] : ''); }
    else if (mission === 'cap') sub = 'CAP' + (p.carrier && p.carrier.name ? ' over ' + p.carrier.name : '');
    else if (mission === 'ace') sub = 'ace · ' + ((p.pilot && p.pilot.kills) || p.kills || 0) + ' kills';
    return [main, sub];
  }
  function start(arc, user) {
    const p = arc.lead;
    S = { lead: p, group: groupOf(p), mission: arc.mission, nation: p.nation, t0: wall(), user: !!user, shots: 0,
      last: '', phase: '', fall: null, ending: 0, cutaway: null, lastCutaway: -1e9, title: titleOf(p, arc.mission), titleUntil: wall() + CAPS };
    lastSq = p.squadron || null; ST.stories++;
    log.push({ start: true, lead: p.kind + ' ' + (p.squadron ? p.squadron.short : ''), mission: arc.mission, at: wall() });
    S.begun = false;
    if (user) WW.cam.cut(); // the director's own pick waits for the current shot to end (never cuts an action shot)
    return true;
  }
  function end(quiet) {
    if (!S) return;
    S = null; ST.ended++;
    nextAt = wall() + dur(GAP[0], GAP[1]);
    log.push({ end: true, at: wall() });
    if (!quiet && WW.cam) WW.cam.cut();
  }

  function phaseOf(p) {
    if (!ok(p)) return 'down';
    if (p.state === 'takeoff') return 'launch';
    if (p.state === 'landing' || p.state === 'rollout') return 'home';
    if (p.phase === 'pull' || p.phase === 'exit' || p.phase === 'out') return 'after';
    if (p.state === 'return') return 'home';
    if (p.phase === 'roll' || p.phase === 'dive' || p.phase === 'run' || p.sk === 'anvil' || (p.kind !== 'fighter' && p.state === 'attack')) return 'attack';
    if (p.kind === 'fighter' && p.state === 'attack' && p.foe) return 'bandits';
    if (p.kind !== 'fighter') for (const q of WW.world.planes) if (ok(q) && q.foe && q.nation !== p.nation && S && S.group.indexOf(q.foe) >= 0) return 'bandits';
    if (p.sk === 'form' && p.wave && !p.wave.go) return 'form';
    return 'transit';
  }
  // shot menu per phase: [sub-kind, weight]
  const MENU = {
    launch: [['deck', 3], ['high', 1], ['side', 1]],
    form: [['side', 3], ['high', 2], ['chase', 2], ['wing', 2]],
    transit: [['chase', 3], ['wing', 3], ['side', 2], ['high', 2]],
    bandits: [['ots', 4], ['chase', 2], ['wing', 2]],
    attack: [['chase', 3], ['ots', 3], ['water', 4], ['high', 1]],
    after: [['chase', 3], ['side', 2], ['high', 1]],
    home: [['high', 2], ['side', 2], ['chase', 1]]
  };
  function choose(phase, L) {
    const opts = [];
    for (const [sk, w] of MENU[phase] || MENU.transit) {
      if (sk === 'ots' && phase === 'bandits') { if (L.kind === 'fighter' && ok(L.foe)) opts.push(['afots', w]); continue; }
      if (WW.storyShots.valid(sk, L, S.group)) opts.push([sk, w]);
    }
    if (opts.length > 1) for (let i = opts.length - 1; i >= 0; i--) if (opts[i][0] === S.last) opts.splice(i, 1); // never the same shot twice running
    if (!opts.length) return airborne(L) ? 'chase' : 'high';
    let tot = 0; for (const o of opts) tot += o[1];
    let r = Math.random() * tot;
    for (const o of opts) if ((r -= o[1]) <= 0) return o[0];
    return opts[0][0];
  }
  function mk(sk, L, d, hard) {
    S.last = sk; S.shots++;
    const c = sk === 'afots' ? { kind: 'ots', subj: L, dur: d, story: true, hard }
      : { kind: 'story', sk, subj: L, group: S.group, nation: S.nation, dur: d, story: true, hard, kP: sk === 'high' || sk === 'side' ? 2.5 : sk === 'water' ? 3 : 4.5, kL: sk === 'high' ? 2 : 4.5 };
    if (sk === 'chase' && S.phase === 'attack') c.back = 18;
    log.push({ sk, kind: c.kind, phase: S.phase, at: wall(), dur: +d.toFixed(1), hard: !!hard, lead: L.kind + (L.wing ? ' wing' + L.wing : ' lead') });
    if (log.length > 200) log.shift();
    return c;
  }
  function successor() {
    const live = S.group.filter(m => airborne(m));
    const old = S.lead;
    let n = old.element && old.element.members.find(m => m !== old && airborne(m));
    if (!n) n = live[0];
    if (!n && old.wave) n = old.wave.members.find(m => airborne(m) && m.kind === old.kind) || (airborne(old.wave.cag) ? old.wave.cag : null);
    return n || null;
  }

  // camera.js pickShot(): the next story shot, or null (the director picks as usual)
  function pick() {
    if (!S) return null;
    if (!S.begun) { if (!ok(S.lead)) { S = null; return null; } S.begun = true; S.t0 = wall(); S.titleUntil = wall() + CAPS; }
    const now = wall();
    if (S.ending) { if (S.ending === 1) { S.ending = 2; const L = S.lead, c = mk('high', L, 7, false); if (L.removed) c.subj = { x: L.x, y: L.y, z: L.z, heading: L.heading, nation: L.nation }; return c; } end(true); return null; }
    if (S.fall && !S.fall.shown && S.lead && !S.lead.removed && now - S.fall.at < FALL) { // watch the leader go down
      S.fall.shown = true; S.last = 'fall';
      log.push({ sk: 'fall', kind: 'story', phase: 'down', at: now, dur: FALL, hard: false });
      return { kind: 'story', sk: 'fall', subj: S.lead, dur: FALL - (now - S.fall.at) + 0.5, story: true, kP: 1.5, kL: 4 };
    }
    if (S.fall) { // after the fall: the wingman / next leader takes the story on
      S.fall = null;
      const n = successor();
      if (!n) { S.ending = 1; return pick(); }
      S.lead = n; S.group = groupOf(n).concat(S.group.filter(m => ok(m) && groupOf(n).indexOf(m) < 0)); ST.handoffs++;
      log.push({ handoff: n.kind + ' ' + (rank(n) || ''), at: now });
      S.title = [(rank(n) || 'The wingman') + ' takes the lead', n.squadron ? n.squadron.short : '']; S.titleUntil = now + CAPS;
    }
    if (S.cutaway && now - S.cutaway.at < 8 && S.cutaway.s && !S.cutaway.s.removed) { // a ship going down elsewhere
      const s = S.cutaway.s; S.cutaway = null; S.lastCutaway = now; ST.cutaways++;
      log.push({ sk: 'cutaway', kind: 'orbit', phase: S.phase, at: now, dur: CUTAWAY, hard: false });
      S.last = 'cutaway';
      return { kind: 'orbit', subj: s, r: s.stats.length * 1.5 + 18, dur: CUTAWAY, w: 0.05, story: true, cutaway: true };
    }
    S.cutaway = null;
    const L = S.lead;
    if (!ok(L)) { S.ending = 1; return pick(); }
    S.phase = phaseOf(L);
    const age = now - S.t0;
    if (age > MAX_T || (S.phase === 'home' && age > MIN_T) || (S.phase === 'home' && L.state !== 'return' && age > 20)) { S.ending = 1; return pick(); }
    const sk = choose(S.phase, L);
    const d = S.phase === 'attack' && sk !== 'high' ? dur(10, 14) : dur(CUT[0], CUT[1]);
    // hard cuts inside a scene; a soft cross-fade into the story, out of a cutaway and on a new phase
    const hard = S.shots > 0 && S.last !== 'cutaway' && S.prevPhase === S.phase && Math.random() < 0.5;
    S.prevPhase = S.phase;
    return mk(sk, L, d, hard);
  }

  // per frame, before the director (wraps WW.cam.update)
  function tick(rdt) {
    const st = WW.game && WW.game.state, fc = WW.freecam && WW.freecam.active();
    const can = st === 'battle' && WW.cam.mode === 'director' && !fc;
    if (!can) { if (S) end(true); return; }
    const now = wall();
    if (!S) {
      if ((checkT -= rdt) > 0 || now < nextAt) return;
      checkT = 2;
      if (WW.game.roundTime !== undefined && WW.game.roundTime < 20) return;
      const a = bestArc();
      if (a && a.score >= 7) start(a, false);
      return;
    }
    const shot = WW.cam._shot();
    if (!S.begun) return; // waiting for the director's current shot to end
    if ((S.regroupT = (S.regroupT || 0) - rdt) <= 0 && ok(S.lead)) { // the group grows as the strike forms up
      S.regroupT = 2; const g = groupOf(S.lead);
      for (const m of S.group) if (ok(m) && g.indexOf(m) < 0) g.push(m);
      S.group = g; if (shot && shot.story && shot.group) shot.group = g;
    }
    // the leader is down: stay on the fall (in place when we are filming it, no cut), then hand off (pick())
    if (!ok(S.lead) && !S.fall && !S.ending) {
      S.fall = { at: now, shown: false };
      log.push({ fall: S.lead.kind, at: now });
      if (shot && shot.story && !shot.stage && shot.subj === S.lead && shot.kind === 'story' && shot.sk !== 'high') {
        shot.sk = 'fall'; shot.fP = null; shot.dur = shot.t + FALL; S.fall.shown = true;
      } else if (shot && !shot.stage) shot.dur = Math.min(shot.dur, shot.t); // cut to a fall shot now
    }
    // a new phase (the push-over, the run, bandits, leaving the deck): cut early to a shot that suits it
    if (shot && shot.story && !shot.stage && !S.fall && !shot.cutaway && ok(S.lead) && shot.t > 2.5) {
      const ph = phaseOf(S.lead);
      if (ph !== S.phase && (ph === 'attack' || ph === 'bandits' || ph === 'after' || S.phase === 'launch')) shot.dur = Math.min(shot.dur, shot.t);
    }
    if (S.cutaway && shot && shot.story && !shot.stage && shot.t > 3 && !shot.cutaway && S.phase !== 'attack' && !S.fall) shot.dur = Math.min(shot.dur, shot.t);
    // the title card, through the air-caption throttle
    if (S.title && now < S.titleUntil && shot && shot.t > 0.8 && WW.airCaptions && WW.airCaptions.say && WW.airCaptions.say(S.title[0], S.title[1])) S.title = null;
  }

  WW.camStory = {
    init() {
      WW.on('roundStart', () => { S = null; nextAt = wall() + dur(30, 60); scrambles = []; });
      WW.on('setupStart', () => { S = null; });
      WW.on('victory', () => { if (S) end(false); });
      WW.on('shipSunk', s => { if (S && s && !s.removed && wall() - S.lastCutaway > CUTAWAY_GAP) S.cutaway = { s, at: wall() }; });
      WW.on('airOrder', e => { if (e && e.order === 'scramble' && e.carrier) scrambles.push({ carrier: e.carrier, sim: WW.time.now }); });
      if (WW.cam && WW.cam.update) {
        const u = WW.cam.update;
        WW.cam.update = function (rdt) { try { tick(rdt || 0); } catch (e) { console.error('camStory', e); S = null; } return u.apply(this, arguments); };
      }
    },
    pick() { try { return pick(); } catch (e) { console.error('camStory', e); S = null; return null; } },
    active() { return !!S; },
    // key F: start a story now on the best arc, or end the current one
    toggle() {
      if (S) { end(false); return 'Follow: off'; }
      const st = WW.game && WW.game.state;
      if (st !== 'battle') return 'Follow: only in battle';
      if (WW.cam.mode === 'map') WW.cam.toggle();
      if (WW.freecam && WW.freecam.release) WW.freecam.release();
      const a = anyArc();
      if (!a) return 'Follow: no planes in the air';
      start(a, true);
      return 'Follow: ' + titleOf(a.lead, a.mission)[0];
    },
    // freecam click on a plane: follow it (and its element) as a story
    follow(p) {
      if (!p || !p.pt || !p.kind || !ok(p) || !(WW.game && WW.game.state === 'battle')) return false;
      if (S) end(true);
      return start({ lead: p, score: 0, mission: p.ordnance || p.target ? 'strike' : p.ace ? 'ace' : 'cap' }, true);
    },
    // tests
    start(p, mission) { if (S) end(true); return start({ lead: p, score: 0, mission: mission || (p.ordnance ? 'strike' : 'cap') }, true); },
    stop() { end(false); },
    lead() { return S && S.lead; },
    _dbg() { return S ? { phase: S.phase, lead: S.lead && S.lead.kind, shots: S.shots, last: S.last, fall: !!S.fall, ending: S.ending, age: wall() - S.t0 } : null; },
    log, stats: ST, bestArc
  };
})(window.WW);
