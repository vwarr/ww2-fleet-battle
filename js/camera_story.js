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
  let S = null, nextAt = 0, lastEnd = -1e9, checkT = 0, lastSq = null, scrambles = [];
  const log = [];                                         // recent shots (tests): { sk, kind, phase, at, dur, hard }
  const ST = { stories: 0, handoffs: 0, cutaways: 0, ended: 0, strikeStories: 0, diveStories: 0, diveFilmed: 0 }; // dive*: strike stories whose wave dived while they ran / with a dive on screen >= DIVE_SEEN s
  const DIVE_SEEN = 1, DIVE_VIEW = 220, ndc = typeof THREE !== 'undefined' ? new THREE.Vector3() : null;
  // a dive bomber of the story's wave diving (roll / dive) in the frame, nearer than DIVE_VIEW: the dive is on screen
  function diveWatch(rdt) {
    const w = S.lead && S.lead.wave, c = WW.camera; if (!w || !c || !ndc) return;
    let dove = false, seen = false;
    for (const m of w.members) if (ok(m) && m.kind === 'dive' && (m.phase === 'roll' || m.phase === 'dive')) {
      dove = true;
      if (seen || Math.hypot(m.x - c.position.x, m.y - c.position.y, m.z - c.position.z) > DIVE_VIEW) continue;
      ndc.set(m.x, m.y, m.z).project(c);
      if (ndc.z < 1 && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.95) seen = true;
    }
    if (dove) S.waveDove = true;
    if (seen) S.diveSeen = (S.diveSeen || 0) + rdt;
  }
  // the push-over: the first of the story's wave to roll into its dive (the leader itself if it is diving); cut to it
  // once per story. A torpedo leader's story cuts away only while its own drop is still TORP_AWAY off (the dive
  // shot then ends with the dive and the story goes back to the run before the drop)
  const TORP_AWAY = 150;
  function diveCue() {
    const L = S.lead, w = L && L.wave, t = L && (L.target || (w && w.target));
    if (S.dive || !w || (L.kind === 'torpedo' && L.phase === 'run' && t && WW.dist(L.x, L.z, t.x, t.z) < TORP_AWAY)) return null;
    if (L.kind === 'dive' && L.phase === 'roll') return L;
    for (const m of w.members) if (ok(m) && m.kind === 'dive' && m.phase === 'roll') return m;
    return null;
  }
  const diving = m => ok(m) && (m.phase === 'roll' || m.phase === 'dive');

  // ---------- arcs ----------
  function rank(p) { return (WW.squadrons && WW.squadrons.rank(p)) || (p.pilot ? p.pilot.name : null); }
  function wavesNow() { return WW.strike && WW.strike._waves ? WW.strike._waves().filter(w => !w.done) : []; }
  function leadOfWave(w) {
    const ms = w.members.filter(ok), pickK = Math.random() < 0.5 ? 'torpedo' : 'dive';
    const el = ms.find(m => m.kind === pickK && m.wing === 0 && m.ordnance) || ms.find(m => m.wing === 0 && m.ordnance && m.kind !== 'fighter');
    return Math.random() < 0.4 && ok(w.cag) ? w.cag : el || (ok(w.cag) ? w.cag : null);
  }
  // how much an imminent finder item is worth as a story: attacks on ships beat fighters closing in
  const ATTACK = { strike: 1.5, push: 1.6, anvil: 1.6, bandits: 0.8 };
  function imm(it) { return 10 + 3 * it.score * (ATTACK[it.kind] || 1); } // score = drama x the 10-30 s window: a strike 60 s out loses to one 20 s out
  function bestImminent(not) {
    let b = null;
    if (WW.camFinder) for (const it of WW.camFinder.list()) {
      const p = it.subj;
      if (!p || !p.pt || !ok(p) || it.etaReal < 8 || it.etaReal > 45 || (not && not(p))) continue; // (a deck launch is a fine opening)
      if (!b || imm(it) > imm(b)) b = it;
    }
    return b;
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
    // the imminent-action finder (camera_finder.js): an attack 8-45 s away beats everything else
    if (WW.camFinder) for (const it of WW.camFinder.list()) {
      const p = it.subj;
      if (!p || !p.pt || !airborne(p) || it.etaReal < 8 || it.etaReal > 45) continue;
      add(p, imm(it), p.kind === 'fighter' ? 'cap' : 'strike');
      if (best && best.lead === p) best.item = it;
    }
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
      if (p.kind === 'flyingboat' && p.mission === 'rescue' && (p.state === 'circle' || p.state === 'alight' || (p.state === 'inbound' && p.t > 20))) add(p, p.state === 'inbound' ? 7.5 : 9, 'dumbo');
      if (p.kind === 'flyingboat' && p.mission === 'patrol' && (p.state === 'shadow' || p.state === 'evade' || p.state === 'bomb')) add(p, p.state === 'shadow' ? 6.5 : 8.5, 'snooper');
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
    else if (mission === 'dumbo') return ['Dumbo inbound', 'PBY Catalina · ' + (p.task ? p.task.n + (p.task.kind === 'pilot' ? ' aircrew' : ' survivors') + ' in the water' : 'air-sea rescue')];
    else if (mission === 'snooper') return p.nation === 'IJN' ? ['Mavis shadowing the fleet', 'H6K flying boat · reporting our position'] : ['Catalina shadowing the enemy', 'PBY patrol · contact report'];
    else if (mission === 'ace') sub = 'ace · ' + ((p.pilot && p.pilot.kills) || p.kills || 0) + ' kills';
    return [main, sub];
  }
  function start(arc, user) {
    const p = arc.lead;
    if (S) end(true);
    S = { lead: p, group: groupOf(p), mission: arc.mission, nation: p.nation, t0: wall(), user: !!user, shots: 0,
      last: '', phase: '', fall: null, ending: 0, cutaway: null, lastCutaway: -1e9, title: titleOf(p, arc.mission), title0: titleOf(p, arc.mission), titleUntil: wall() + CAPS };
    lastSq = p.squadron || null; ST.stories++;
    log.push({ start: true, lead: p.kind + ' ' + (p.squadron ? p.squadron.short : ''), mission: arc.mission, at: wall() });
    S.begun = false; S.item = arc.item || null; S.imminent = !!arc.item;
    if (user) WW.cam.cut(); // the director's own pick waits for the current shot to end (never cuts an action shot)
    return true;
  }
  function end(quiet) {
    if (!S) return;
    const short = S.user || S.imminent;
    if (S.mission === 'strike' && S.begun) { ST.strikeStories++; if (S.waveDove) { ST.diveStories++; if ((S.diveSeen || 0) >= DIVE_SEEN) ST.diveFilmed++; else log.push({ miss: 'dive seen ' + (S.diveSeen || 0).toFixed(1) + ' s, cut ' + (S.dive ? (S.dive.shown ? 'shown' : 'pending') : 'none') + ', lead ' + S.lead.kind, at: wall() }); } }
    S = null; ST.ended++; lastEnd = wall();
    nextAt = wall() + (short ? dur(40, 60) : dur(GAP[0], GAP[1]));
    log.push({ end: true, at: wall() });
    if (!quiet && WW.cam) WW.cam.cut();
  }

  function fbPhase(p) {   // a flying boat (air_flyingboats.js): its own states
    if (p.state === 'alight' || p.state === 'afloat' || p.state === 'liftoff') return 'rescue';
    if (p.state === 'return') return 'home';
    if (p.state === 'bomb') return 'attack';
    if (p.state === 'evade' || WW.world.planes.some(q => ok(q) && q.foe === p)) return 'bandits';
    return 'transit';
  }
  function phaseOf(p) {
    if (!ok(p)) return 'down';
    if (p.kind === 'flyingboat') return fbPhase(p);
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
    home: [['high', 2], ['side', 2], ['chase', 1]],
    rescue: [['side', 3], ['chase', 2], ['high', 1]]      // a Catalina down on the water among the survivors
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
      : { kind: 'story', sk, subj: L, group: S.group, nation: S.nation, dur: d, story: true, hard, kP: sk === 'high' || sk === 'side' ? 2.5 : sk === 'water' ? 3 : sk === 'ots' ? 6 : 4.5, kL: sk === 'high' ? 2 : 4.5 };
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
    if (S.cutaway && now - S.cutaway.at < 8 && S.cutaway.s && !S.cutaway.s.removed && phaseOf(S.lead) !== 'attack') { // a ship going down elsewhere
      const s = S.cutaway.s; S.cutaway = null; S.lastCutaway = now; ST.cutaways++;
      log.push({ sk: 'cutaway', kind: 'orbit', phase: S.phase, at: now, dur: CUTAWAY, hard: false });
      S.last = 'cutaway';
      return { kind: 'orbit', subj: s, r: s.stats.length * 1.5 + 18, dur: CUTAWAY, w: 0.05, story: true, cutaway: true };
    }
    S.cutaway = null;
    if (S.dive && !S.dive.shown && diving(S.dive.m)) { // the dive: chase the diver down, in slow motion while it dives
      const m = S.dive.m, away = m !== S.lead && S.lead.kind !== 'dive'; S.dive.shown = true; S.last = 'dive';
      log.push({ sk: 'dive', kind: 'story', phase: 'attack', at: now, dur: 9, hard: true, lead: m === S.lead ? 'dive lead' : 'dive wing' });
      if (WW.camAction && WW.camAction.slowmo) WW.camAction.slowmo(() => diving(m), 10);
      return { kind: 'story', sk: 'chase', subj: m, group: [m], nation: S.nation, dur: 9, story: true, hard: true, kP: 4.5, kL: 4.5, back: 18, nohand: away, diveOf: away ? m : null }; // a hard cut: no cross-fade over the push-over
    }
    const L = S.lead;
    if (!ok(L)) { S.ending = 1; return pick(); }
    S.phase = phaseOf(L);
    const age = now - S.t0;
    if (age > MAX_T || (S.phase === 'home' && age > MIN_T) || (S.phase === 'home' && L.state !== 'return' && age > 20)) { S.ending = 1; return pick(); }
    const sk = S.user && !S.shots && WW.storyShots.valid('chase', L, S.group) ? 'chase' // the user asked: open close on the subject
      : !S.shots && S.mission === 'strike' && (S.phase === 'form' || S.phase === 'transit') && WW.storyShots.valid('side', L, S.group) ? 'side' // open on the formation, side on: its size and stack
      : choose(S.phase, L);
    const d = S.phase === 'attack' && sk !== 'high' ? dur(10, 14) : dur(CUT[0], CUT[1]);
    // hard cuts inside a scene; a soft cross-fade into the story, out of a cutaway and on a new phase
    const hard = (S.user && !S.shots) || (S.shots > 0 && S.last !== 'cutaway' && S.prevPhase === S.phase && Math.random() < 0.5); // a key press answers at once
    S.prevPhase = S.phase;
    return mk(sk, L, d, hard);
  }

  // per frame, before the director (wraps WW.cam.update)
  function tick(rdt) {
    const st = WW.game && WW.game.state, fc = WW.freecam && WW.freecam.active();
    if (st !== 'battle' || WW.cam.mode !== 'director') { if (S) end(true); return; }
    const now = wall();
    if (fc) { // the user drives the camera: a story on the subject they follow pauses and resumes when they let go
      if (!S) return;
      const f = WW.freecam.following();
      if (!f || (f !== S.lead && S.group.indexOf(f) < 0)) { end(true); return; }
      S.begun = true;
      if (!ok(S.lead)) { // the leader went down while the user watched: after the fall, hand on to the wingman
        S.pauseFall = S.pauseFall || now;
        if (now - S.pauseFall > FALL) { const n = successor(); S.pauseFall = 0; if (n) { S.lead = n; ST.handoffs++; log.push({ handoff: n.kind + ' ' + (rank(n) || ''), at: now }); WW.freecam.retarget(n); } }
      }
      return;
    }
    if (!S) {
      if ((checkT -= rdt) > 0) return;
      checkT = 1;
      if (WW.game.roundTime !== undefined && WW.game.roundTime < 20) return;
      const a = bestArc();
      // an imminent attack may start after a short rest; anything else waits for the long one
      if (a && (a.item ? now - lastEnd >= 40 : now >= nextAt && a.score >= 7)) start(a, false);
      return;
    }
    const shot = WW.cam._shot();
    if (!S.begun) { // waiting for the director's current shot to end; an imminent attack cuts in (not into an action / test shot)
      if (!S.imminent && !S.user && now - lastEnd >= 40 && (checkT -= rdt) <= 0) { checkT = 1; const b = bestImminent(); if (b) start({ lead: b.subj, mission: b.subj.kind === 'fighter' ? 'cap' : 'strike', item: b }, false); }
      if (S.imminent && shot && !shot.stage && shot.t > (shot.story ? 1.5 : 4) && !(shot.pr >= 99)) shot.dur = Math.min(shot.dur, shot.t);
      return;
    }
    if (S.mission === 'strike') {
      diveWatch(rdt);
      const m = !S.fall && !S.ending ? diveCue() : null;
      if (m) { S.dive = { m, shown: false }; if (shot && !shot.stage && shot.t > 0.3) shot.dur = Math.min(shot.dur, shot.t); } // cut now (not a bomb / torpedo hand-off)
      if (shot && shot.diveOf && !diving(shot.diveOf) && shot.t > 1) shot.dur = Math.min(shot.dur, shot.t + 1.2); // a cut away to the dive: back to the story's own attack
    }
    if ((S.regroupT = (S.regroupT || 0) - rdt) <= 0 && ok(S.lead)) { // the group grows as the strike forms up
      S.regroupT = 2; const g = groupOf(S.lead);
      for (const m of S.group) if (ok(m) && g.indexOf(m) < 0) g.push(m);
      S.group = g; if (shot && shot.story && shot.group) shot.group = g;
    }
    // the leader has landed (taken below): the mission is over, end on a wide shot
    if (!ok(S.lead) && !S.ending && !S.fall && (S.lead.state === 'rollout' || S.lead.state === 'landing')) {
      S.ending = 1; if (shot && shot.story && !shot.stage) shot.dur = Math.min(shot.dur, shot.t + 2);
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
    // an automatic story gives way to a better attack about to happen elsewhere (a CAP circle must not hide a strike)
    if (!S.user && shot && shot.story && !shot.stage && !S.fall && !S.ending && S.phase !== 'attack' && now - S.t0 > 8 && (S.swT = (S.swT || 0) - rdt) <= 0) {
      S.swT = 2;
      const mine = WW.camFinder && WW.camFinder.about(S.lead), my = mine && mine.etaReal >= 0 && mine.etaReal < 60 ? imm(mine) : 0;
      const b = my && now - S.t0 < 20 ? null : bestImminent(p => p === S.lead || S.group.indexOf(p) >= 0 || (p.wave && p.wave === S.lead.wave)); // its own attack coming: 20 s
      if (b && (my ? imm(b) > my + 4 : imm(b) > 12)) { // hysteresis: no flapping between two strikes
        log.push({ switch: (b.subj.squadron ? b.subj.squadron.short : b.subj.kind) + ' ' + b.kind, at: now });
        start({ lead: b.subj, mission: b.subj.kind === 'fighter' ? 'cap' : 'strike', item: b }, false);
        S.begun = false; if (shot.t > 2) shot.dur = Math.min(shot.dur, shot.t);
        return;
      }
    }
    if (S.cutaway && shot && shot.story && !shot.stage && shot.t > 3 && !shot.cutaway && S.phase !== 'attack' && !S.fall) shot.dur = Math.min(shot.dur, shot.t);
    // the title card, through the air-caption throttle
    if (S.title && now < S.titleUntil && shot && shot.t > 0.8 && WW.airCaptions && WW.airCaptions.say && WW.airCaptions.say(S.title[0], S.title[1], S.lead)) S.title = null;
  }

  WW.camStory = {
    init() {
      WW.on('roundStart', () => { S = null; nextAt = wall() + dur(30, 60); lastEnd = -1e9; scrambles = []; });
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
      if (WW.camFollow) return WW.camFollow.f();
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
    // camera_follow.js: start on an arc { lead, mission, item } as the user's story; the running story, if any
    begin(arc) { return start(arc, true); },
    story() { return S ? { lead: S.lead, user: S.user, item: S.item, begun: S.begun, title: S.title0, mission: S.mission } : null; },
    titleOf, anyArc,
    lead() { return S && S.lead; },
    _dbg() { return S ? { phase: S.phase, lead: S.lead && S.lead.kind, shots: S.shots, last: S.last, fall: !!S.fall, ending: S.ending, age: wall() - S.t0 } : null; },
    log, stats: ST, bestArc
  };
})(window.WW);
