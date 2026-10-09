# Architecture

This document tells you how the code is organized. Read it before you change a module.

## Rules for the code

- Use plain classic `<script>` files. Do not use ES modules. Do not add a build step. The page must work from `file://`.
- Put all code in the global namespace `window.WW`. Each file starts with `window.WW = window.WW || {};`.
- A module must not use `WW.scene` when its file loads. The module does that work in its `init()` function. `main.js` calls each `init()` after it makes the scene.
- Keep each file at approximately 400 lines or fewer. If a file becomes larger, split it into two files and add the new file to `index.html`.
- Do not make a new geometry or a new material for each projectile, particle or plane. Make them one time and share them. Use object pools for projectiles and particles. In `clearAll()`, put the objects back in the pool.
- Effects use `Math.random`. The simulation uses the seeded `WW.rand`. This keeps a round the same for the same seed.
  - Visual and sound code (effects, camera, audio, smoke/fire timers, how a dead plane falls or how long a ditched wreck floats) must not call `WW.rand`, and sim code must not depend on it: for example AA timers run only while a live plane exists, not while a wreck lingers. Per-round state that feeds the sim is reset in `clearAll()`/`roundStart` (ship ids, `WW.wind`, which steers carriers). The next auto round's seed comes from `WW.rand`.
  - A replay: stop the render loop (`requestAnimationFrame = () => 0`, `WW.time.warp = 1`), then `WW.aces.reset()` (aces carry over between rounds by design), `WW.terrain.generate(seed)`, `WW.seedRandom(seed)`, `WW.time.now = 0`, `WW.game.startRound({ keepMap: true })`, and drive `__sim.fastForward`. `tests/determinism.js [seed] [seconds]` checks that this gives identical traces in one page, after another seed, and in a fresh page; `tests/determinism.js --cross [seeds]` checks that a rendered page and a sim-only page (below) give identical traces.
- Code that the combat code calls must not throw errors into the combat code. `WW.damage` catches its own errors.

## Load order

`index.html` loads the scripts in this order. A file can use the files above it at run time.

```
vendor/three.min.js     Three.js r149 (UMD build, global THREE)
js/core.js              WW.cfg, data tables, helpers, event bus
js/daylight.js          WW.dayNight, WW.daylight: the round's clock (day / dusk / night), no flying after dusk, night landings
js/audio.js             WW.audio: synthesized sound engine (buses, voices, spatial model, loops)
js/audio_synth.js       WW.audio.syn: noise buffers, envelopes, bursts, booms, crackle
js/audio_base.js        (empty: its example patches moved into the families)
js/audio_amb.js         ambience (sea, wind, surf, gulls, battle rumble), cinematic cues, UI sounds
js/audio_aa.js          AA and flak sounds: heavy AA, flak bursts, Bofors / Oerlikon / 25 mm, tracer whiz, distant barrage bed
js/audio_naval.js       naval sound patches: guns, shells, splashes, hits, sinking, torpedoes, depth charges, subs, fires, engines
js/audio_naval_wire.js  plays the naval patches from sim events; polls engines, fires, sinking and sub dives while sound is on
js/audio_air.js         aircraft sounds: engines, wing guns, hits, ordnance release, deaths, carrier deck
js/sky.js               WW.sky: sky dome, clouds, lights, fog
js/water.js             WW.water: water shader, foam, contact shadows
js/terrain_islands.js   WW.terrainIslands: the island layout (atoll or volcanic island), the airfield pad and site
js/sky_time.js          WW.skyTime: the look of the time of day and the rain (palettes, sun / moon light, fog, water, bloom)
js/weather_fx.js        WW.weatherFx: rain curtains and cloud decks over the squalls (visual)
js/terrain.js           WW.terrain: sea floor, islands, depth grid
js/models.js            WW.models: ship models
js/models_detail.js     fine ship detail, merged into one mesh per material
js/models_planes.js     WW.models.buildPlane
js/models_landplanes.js WW.models.buildPlane for the land planes: B-17, B-26, G4M Betty (models_planes.js lofting kit)
js/models_base.js       WW.baseModels: the airfield (runways, hangars, tower, fuel tanks, barracks, revetments, AA pits, batteries)
js/models_scout.js      WW.models.buildScout: scout floatplanes
js/models_flyingboats.js WW.models.buildFlyingBoat: PBY Catalina / H6K Mavis (lofted with models_planes.js WW.models._planeKit)
js/models_crew.js       WW.crew: tiny sailors on every ship (instanced, posable arms), deck stations, idle / fire / abandon-ship motion
js/crew_ops.js          WW.crewOps: crews at work: AA crews, loaders, damage-control hoses, lookouts, cheer, salute, deck crews, cargo nets
js/crew_props.js        WW.crewProps: hose water streams and cargo nets (pooled, ship-local)
js/effects.js           WW.fx: pooled particle effects
js/damage.js            WW.damage: fires and smoke at hit points, WW.wind
js/damage_visuals.js    WW.dmgVis: scorch / hole decals, knocked-out turrets, toppled masts, bent funnels, settling, deck wrecks
js/weather.js           WW.weather: rain squalls drifting with WW.wind, cover(x, z), along(a, b), shelter()
js/combat.js            WW.combat: projectile pool, shells, anti-aircraft fire
js/combat_weapons.js    torpedoes, bombs, depth charges
js/combat_aa.js         WW.combatAA: heavy/light anti-aircraft fire, flak bursts, plane jinking
js/ships.js             WW.Ship, WW.ships: movement, damage, sinking, wrecks
js/ships_nav.js         WW.shipNav: hull outline checks, ship collisions
js/ship_speed.js        WW.shipSpeed: damage slows ships (hull damage, torpedo flooding, engine-room hits)
js/intel.js             WW.intel: fog of war, per-side contact tables (what each side has seen)
js/night_ops.js         WW.nightOps: sight in the dark and rain, USN ship radar, star shells, searchlights, night doctrine factors
js/ai_threat.js         WW.threat: per-side danger field (grid), danger(), bestHeading()
js/ai_threat_view.js    WW.threatView: debug overlay (WW.threatView.toggle(); key G only without the plot table)
js/fleet_groups.js      WW.fleetGroups: doctrine tables, group assignment, formation stations
js/fleet_cmd.js         WW.fleetCmd: per-side commander and blackboard (posture, groups, focus, strikes, sectors)
js/fleet_search.js      WW.fleetSearch: long search (sweep, barrier patrol), PT pair spots, PT deep runs (commander tick)
js/admirals.js          WW.admirals: the admiral per side (personality -> doctrine), flagship, chain of command, admiralOrder events
js/ships_ai.js          WW.shipAI core: setup, retarget, guns / turrets, dispatch to the role files, shared helpers (WW.shipAI.h)
js/ai_surface.js        WW.shipAI.roles.surface: battleship / cruiser / destroyer behaviour, destroyer sub hunt
js/ai_carrier.js        WW.shipAI.roles.carrier: carrier movement and air ops (CAP queue, strikes, launches), pickStrikeTarget
js/ai_light.js          WW.shipAI.roles.submarine: submarine behaviour; WW.lightAI.h helpers shared with ai_pt.js
js/ai_pt.js             WW.shipAI.roles.pt: PT boat behaviour (loads after ai_light.js)
js/ai_endgame.js        WW.endgameAI: a broken side runs for its home edge (doctrine: rescue / escort or best speed), rescue steering, pursuit seams
js/ai_charge.js         WW.smoke (smoke screens that block ship-to-ship sight), WW.charge (escorts charge an enemy closing on their carrier)
js/aircraft.js          WW.air, WW.Plane: carrier planes
js/air_dogfight.js      WW.dogfight: fighter-vs-plane manoeuvres, wing guns, tracer rounds
js/air_intercept.js     WW.intercept: fighter gun passes on bombers (wheel arc lead, dive line, stern passes)
js/air_aces.js          WW.aces: pilots, kill credit, aces and kill marks
js/air_scouts.js        WW.scouts, WW.Scout: catapult scout floatplanes and spotting
js/air_props.js         WW.airProps: pooled parachutes, life rafts, sheared-off wings
js/lifeboats.js         WW.lifeboats: a sinking ship's boats row to a friendly ship or the shore
js/air_deaths.js        WW.airDeaths: shoot-down / ditch / bail-out / deck slide-off deaths
js/endgame.js           WW.endgame: escapes off the map, survivor rescue tasks, scuttling, endgame stats (sim)
js/air_deck.js          WW.airDeck: deck parking, wing folding, takeoff runs, into-the-wind turns, landing pattern
js/ship_fires.js        WW.shipFires: fires, flooding and damage control as sim state, the loaded flight deck, magazine explosions
js/air_fx.js            WW.airFx: prop disc, dive brakes, wing-tip vapour, exhaust flicker, canopy glint
js/air_strikes.js       WW.strike: strike waves (form-up, vics), sequential dive bombing, anvil torpedo attack
js/air_squadrons.js     WW.squadrons: carrier names, VF/VB/VT squadrons per carrier slot, sections / divisions / shotai, wingman slots
js/air_ops.js           WW.airOps: air boss (CAP relief, scrambles, strike hold, deck-aware launches, reserve strike), fighter director, jettison
js/air_search.js        WW.search: search sector claims, carrier search flights, shadowing, break-away and routed return (scouts too)
js/air_strafe.js        WW.strafe: fighters strafe PT boats, surfaced subs and damaged destroyers
js/air_cag.js           WW.cag: strike leader (handover, redirect, AA detour), VT/VB timing, close and top cover escorts
js/island_base.js       WW.islandBase: the island air base (owner, facilities, craters, coastal guns, AA pits, neutralized, events)
js/base_ai.js           WW.baseAI: the fight for the island in the AI (objective, bombardment aim, strike value, defence)
js/land_air.js          WW.landAir: the base air group (roster, CAP, strikes), the runway (takeoff, circuit, landing), level bombing
js/air_flyingboats.js   WW.flyingBoats, WW.FlyingBoat: flying boats from off the map; the Catalina "Dumbo" rescue (endgame.js tasks)
js/air_patrol.js        WW.patrol: long-range patrol flying boats (search, shadow from standoff, evade fighters, Mavis bombing); bad-report strike metrics
js/camera.js            WW.cam: director camera and map camera
js/freecam.js           WW.freecam: camera that the user controls
js/camera_action.js     WW.camAction: bomb / torpedo hand-offs, over-the-shoulder shot, slow motion
js/camera_story_shots.js WW.storyShots: story-mode shot goals (chase, wingman, over-the-shoulder, side, water, high, deck, fall)
js/camera_story.js      WW.camStory: story mode: follow one squadron / division through its mission
js/camera_finder.js     WW.camFinder: imminent-action finder (attacks about to happen, by eta and drama)
js/camera_follow.js     WW.camFollow: keys F / Tab / 8 / 9, the follow label, finder candidates for the director
js/air_captions.js      WW.airCaptions: squadron / leader film captions for what the director films (visual only)
js/base_fx.js           WW.baseFx: the base on screen (models, craters, fires, parked planes, captions, diary, camera hooks)
js/admirals_flags.js    WW.admiralFlags: pennant, signal hoists and night blinker lamps on the flagships, admiral captions (visual only)
js/night_fx.js          WW.nightFx: night lights (pooled), star shell flares, searchlight cones, night camera candidates (visual)
js/post.js              WW.post: HDR render target, bloom, tone curve
js/ui.js                WW.ui: panels, setup clicks, captions, fullscreen
js/war_diary.js         WW.diary: the war diary (clock times, sightings, key events; key L), ship names
js/plot_table.js        WW.plot: plot table in map view (2D canvas chart; whose plot: key G; danger layer: key X)
js/plot_tokens.js       WW.plotTokens: the plot's live layer (toy tokens, contacts, pencil, notes, strike tracks)
js/aar_card.js          WW.aar: the after-action report card
js/main.js              renderer, main loop, rounds (WW.game), window.__sim
```

## World coordinates

- 1 unit is approximately 2 m. The map is `WW.cfg.MAP_W` (x, 0 to 960) by `WW.cfg.MAP_H` (z, 0 to 600). Sea level is y = 0. Up is +y.
- A heading `h` is in radians. It goes from +x toward +z. The forward vector is `(cos h, 0, sin h)`.
- Each model (ship and plane) has its bow or nose on local **+x**. To show heading `h`, set `group.rotation.y = -h`.
- Hull lengths: carrier 26, battleship 24, cruiser 18, destroyer 12, submarine 10, PT boat 5 units.
- The USN fleet starts on the west side (x 15 to 115). The IJN fleet starts on the east side (x `MAP_W` − 115 to `MAP_W` − 15, so 845 to 945). The formations keep their size; approximately 670 units of open sea lie between the two screens at the start. Light forces (destroyers, PT boats) meet after approximately 35 s, the battleships and cruisers after approximately 90 s.

## Time

- `WW.time.now` and `WW.time.dt` are simulation time in seconds.
- `main.js` multiplies real time by `WW.time.scale` (the 1×, 2× and 4× buttons) and by `BASE_SPEED = 0.5`. Thus, at 1×, the battle moves at half speed.
- Each simulation step is 0.05 s or less. At high speed, `main.js` does more steps in one frame.
- The camera, the cross-fades, the captions, the clouds and the water animation use real time. They do not slow down.
- `WW.time.warp` (normally 1) also multiplies the simulation time. The director camera sets it to approximately 0.5 for approximately 1.5 s when it films a kill or a direct bomb or torpedo hit (at most one time in 20 s, never in free camera or map view). `fastForward` ignores it.

## Main loop

Each animation frame (`main.js`, `frame`):

1. `WW.dmgVis.unpose` (the sim must not see the visual settling), then advance the simulation. For each step (`step`):
   1. `WW.terrain.update`, then `WW.dayNight.update` (`WW.daylight`), `WW.weather.update` and `WW.nightOps.update`, then `WW.intel.update` (contact tables, every 0.5 s), then `WW.fleetCmd.update` (side commanders and danger fields, every 2 s per side)
   2. `WW.ships.update`: ship AI, movement, the collision pass (`WW.shipNav.resolve`), sinking, wrecks and `WW.damage.update`, then `WW.islandBase.update` (the island base: repairs, coastal guns, raid warning, the base air group), `WW.endgame.update` (escapes, survivor pickups, scuttling), `WW.shipFires.update` (fires, flooding, damage control, once a sim second) and `WW.charge.update` (smoke clouds, escort charges)
   3. `WW.air.update`
   4. `WW.combat.update`: projectiles and anti-aircraft fire
   5. `WW.fx.update`, then `WW.lifeboats.update`
   6. Round logic: victory, time limit and the next round
2. `WW.dmgVis.pose` (visual settling and trim), `WW.water.update`, `WW.cam.update`, `WW.crew.update` (after the camera: it uses the camera distance), `WW.dmgVis.draw` (decals on the posed hulls), `WW.baseFx.update` (the island base's craters, fires and parked planes), `WW.audio.update`, `WW.sky.update` and `WW.ui.update` on real time.
3. Render through `WW.post.render` (HDR, bloom, tone curve). If `WW.post` is not available, render directly.

`__sim.fastForward(seconds)` runs simulation steps without a render. The tests use it.

## Sim-only mode

`index.html?sim` sets `WW.simOnly` (and `WW.cfg.SIM_ONLY`) in `core.js`, before any module initializes. The page runs the full simulation and renders nothing. The headless sim tests use it; players never see it.

- `main.js bootSim()` makes a plain `THREE.Scene` and camera, but no `WebGLRenderer`. It initializes only `terrain`, `models`, `combat`, `ships` and `air`, starts the game as usual (`?auto` or setup), and never calls `requestAnimationFrame`. The test drives `__sim.fastForward`.
- Skipped: the renderer, `post`, `sky`, `water`, `cam` (director, story and action shots, captions), `freecam`, `ui`, `audio`, `crew` (with `crewOps`, `crewProps`), `lifeboats`, `dmgVis` and `baseFx` (the airfield models, craters, fires, parked planes) (no `init`, no `update`; their event listeners return at once). Every `WW.fx` function is a no-op and `fx.update` is not called. `WW.airFx` and `WW.airProps` are `null` (their callers check). `terrain.generate` builds only the depth grid (no floor mesh, baked AO, palms, huts or water depth texture). `damage.update` (fire and smoke emission), `Ship.effects` (wakes, funnel smoke), the plane gun tracers (`aircraft.js`, `air_dogfight.js`) and the flak and light-AA tracer visuals (`combat_aa.js`) are skipped.
- Kept, because the sim reads them: the ship and plane models (THREE geometry and Object3D graphs, built on the CPU). `Ship` measures its hull with `Box3.setFromObject`; `Ship.syncGroup` poses the group, and the sim reads turret muzzles (`combat.muzzlePos`), the carrier deck (`aircraft.js deckInfo`, `air_deaths.js deckY`), turret positions (`damage.js disableTurret`) and the parked planes on deck (`air_deck.js`) from it, after an explicit `updateMatrixWorld` / `getWorldPosition`. Sim code never relies on the matrices a render would update. The scene must exist: `air_deck.js` adds parked planes to it, and `damage.js` hit sites use the ship group's local matrix as its world matrix. `damage.hit` still runs (turret knock-out, torpedo list, the critical fire flag); only its visuals are skipped, so `ship.dmgSites` do not decay in this mode (nothing in the sim reads them).
- The sim is bit-identical to normal mode: visual code never calls `WW.rand`, and nothing the sim reads depends on a render. `node tests/determinism.js --cross 1,2,3 300` compares the traces of a rendered page, a sim-only page and the node runner; keep it passing when you add visual code that sim code calls (guard the visual work with `WW.simOnly`, never the sim work).
- Chrome for sim-only tests runs with `--disable-gpu` (no WebGL is created). A page boots in about 0.25 s instead of about 8 s, and a round takes about 40% less time (seed 1, 300 sim s: 1.7 s instead of 2.7 s).

### Running the tests

`tests/headless.js` holds the shared launch settings. The sim tests (`sim_behaviour.js`, `sim_rounds.js`, `determinism.js`, `ship_heel.js`, `air_probe.js`) take a mode switch:

- `--node` (default): sim-only mode run natively in Node by the node runner (below). No Chrome, no web server.
- `--browser`: a sim-only page in headless Chrome. Serve the folder (`python3 -m http.server PORT`), set `BASE_URL=http://localhost:PORT/` and `CHROMIUM=<headless shell>`.
- `--render` (or `RENDER=1`): the full game in Chrome on software GL (swiftshader), as `--browser` otherwise.

`--workers K` (alias `--pages K`) sets how many games run rounds in parallel: worker threads in node mode (default: cores − 2, capped by the `MAX_WORKERS` env var), pages in Chrome (default 6).

```
node tests/sim_behaviour.js                          # behaviour suite, 15 scenarios x 8 seeds
node tests/sim_behaviour.js --only balance --seeds 100   # balance gate (--seeds 400 for tuning)
node tests/sim_behaviour.js --only fuzz --seeds 42       # composition fuzz: odd and lopsided fleets (tests/fuzz.js)
node tests/oddfleets_shots.js search|spots|attack <seed> # render-mode shots of 3 carriers vs 10 PT boats
node tests/sim_behaviour.js --only midway --base IJN --tune guns=0.5,air=0.6   # island base: owner and strength knobs (island_base.js TUNE)
node tests/base_shots.js [seed]                      # render-mode island base shots (tests/shots/base/)
node tests/sim_rounds.js [rounds=8] [firstSeed=1]    # per-round report, seeds across the workers
node tests/determinism.js [seed] [seconds]           # same seed, same round: one game, after another seed, a fresh game
node tests/determinism.js --cross 1,2,3 300          # full rendered page vs sim-only page vs node runner (--modes browser,node: skip the render)
node tests/ship_heel.js, node tests/air_probe.js     # heel jitter, one carrier round's air picture
node tests/sim_behaviour.js --only night,dusk,weather   # night and weather scenarios and metrics
TOD=night WX=line node tests/determinism.js --cross 3,4 250   # force the time of day / the weather
node tests/night_shots.js [seed] [seq,duel,squall]   # dusk / night / squall screenshots (render mode)
node tests/endgame_shots.js rescue 19                # render-mode endgame screenshots (cripple 9, rescue 19, retreat 8)
node tests/crew_shots.js [outdir] [scene,scene]     # render-mode close shots: crews at work, battle damage (forced through test hooks)
node tests/doctrine.js [rounds=24] [seed0=1]         # doctrine metrics per nation: formation, zigzag, torpedoes, subs, supply
node tests/doctrine_shots.js ring 3                  # render-mode doctrine screenshots (ring, vanguard, wake_usn, wake_ijn, dud, lifeguard)
```

The browser `--pages` default of 6 was measured on an 8-core M1 Pro (6 performance cores): on the balance gate 5 and 6 pages tie (within run-to-run noise) and both beat 4 and 8; the 8-seed suite is slightly faster with 8 (its scenarios end in a barrier). The tests that take screenshots or film the camera (`final.js`, `peek.js`, `story_cam.js`, `air_shots.js`, `deaths.js`, `action_cam.js`, `clip.js`, `fps.js`, the audio tests and others) use the full game in Chrome (`bash tests/run.sh <script>` serves on port 8000).

### The node runner (tests/node_env.js, tests/node_sim.js)

- `node_env.js` boots what `index.html?sim` boots: it reads the `<script src>` list from `index.html` (so a new module needs no edit here) and runs each file in order with `vm.runInThisContext` in the current realm (classic-script semantics: top-level `const` / `let` share one global scope). A script that throws while loading fails the run with its name. The stub browser: `window` = `self` = the global, a minimal `document` (`createElement` gives an element whose canvas 2D context accepts every call, for the textures some modules draw at load), `location.search` = `?sim&…`, `requestAnimationFrame` a no-op, Node's `performance`. `console.error` from game code is reported as a page error. `DOMContentLoaded` / `load` listeners fire after the last script, and `main.js` then runs its usual `bootSim()`.
- `node_sim.js` runs one game per `worker_threads` Worker (its own V8 isolate and global) and gives it the small part of the Playwright API the sim tests use (`newPage`, `goto` (the query string selects `?sim&auto` and so on), `evaluate(fn, arg)`, `waitForFunction`, `on('console' | 'pageerror')`, `close`). So a test is written once and runs in both: `evaluate` sends the function as source text, as Playwright does (it cannot close over Node variables), and returns a structured clone. `node tests/node_sim.js [seed] [secs]` is a one-round smoke run.
- **Bit-identical results need the browser's `Math`.** Chrome 150+ (V8 15) computes `sin`, `cos`, `tan`, `atan`, `atan2`, `asin`, `acos`, `exp`, `log*`, `pow` and the rest with LLVM libc (correctly rounded); V8 14 and older (every stable Node up to 26.x) use fdlibm, which differs in the last bit for 5 to 10% of inputs, and a seeded round diverges within 5 sim seconds. So the runner needs a Node whose V8 is 15 or newer. `bash tests/get_node.sh` puts a verified nodejs.org v8-canary build in `~/.cache/fleet-battle/node`; when the running Node is older, the tests re-run themselves under that binary (or under `SIM_NODE=/path/to/node`), and fail with an explanation when there is none. `NODE_SIM_ANY_V8=1` runs on any Node (same statistics, not the same rounds). When a stable Node ships V8 15, it works directly. If Chrome changes its math library again, `determinism.js --cross` shows it.
- Proof: `node tests/determinism.js --cross 1,2,3 300 --modes browser,node` gives the same trace hash in Chrome (headless shell 1243, Chrome 153) and in the runner, and the behaviour suite's per-round JSON (`JSON=… node tests/sim_behaviour.js` vs `… --browser`) is identical.
- Limits: sim-only mode only (no renderer, so no screenshots, camera, audio or UI tests); game code must not touch browser APIs outside the stubs while loading or in the sim path (a new one fails loudly; add it to `node_env.js`); `waitForTimeout` is a no-op, since there is no render loop or network to wait for.
- Speed (M1 Pro, measured with load average 20 to 30 from other jobs, so read the ratios, not the seconds): one game runs a round at the same speed as a Chrome page (seed 1, 300 sim s: about 1.05 s in both once warm), so wall time and CPU time tie at the same parallelism. Behaviour suite (8 seeds, 2 games): browser 28.4 s / 62 CPU s, node 29.5 s / 63 CPU s. Balance gate (100 rounds, 2 games): browser 59.7 s / 128 CPU s, node 59.1 s / 121 CPU s. The gains: about 2.4× less memory (2 games: 373 to 449 MB against 882 to 925 MB; 6 games: about 0.9 GB against 2.4 GB); no Chrome, `CHROMIUM` path, web server or port; a game boots in about 0.3 s; and a run can use more games for the same memory. The old Node (V8 12.9) also ran a round about 1.5× slower than Chrome. A V8 15 Node closes that gap.

## Data tables (core.js)

```js
WW.cfg = { MAP_W: 960, MAP_H: 600, CELL: 2, ROUND_TIMEOUT: 420 /* simulation seconds: 14 min at 1× */ };
WW.SHIP_TYPES = {   // hp is multiplied by HP_SCALE = 2.0 when core.js loads
  carrier:    { hp:900,  speed:5.6, turn:0.25, length:26, minDepth:6,   tons:30000, planes:{ fighter:6, dive:4, torpedo:4 }, ... },
  battleship: { hp:1200, speed:4.2, turn:0.22, length:24, minDepth:7,   tons:45000, ... },
  cruiser:    { hp:650,  speed:5.5, turn:0.35, length:18, minDepth:5,   tons:12000, ... },
  destroyer:  { hp:300,  speed:7.5, turn:0.6,  length:12, minDepth:3,   tons:2000, depthCharges:true, ... },
  submarine:  { hp:200,  speed:3.5, turn:0.4,  length:10, minDepth:9,   tons:1500, ... },
  pt:         { hp:80,   speed:11,  turn:1.2,  length:5,  minDepth:1.5, tons:50, ... }
};
WW.SHELL = { mg:{dmg:2}, small:{dmg:12}, med:{dmg:35}, big:{dmg:110} };
WW.TORPEDO = { dmg:220, speed:14 };  WW.BOMB = { dmg:180 };  WW.DEPTH_CHARGE = { dmg:120, radius:6 };
WW.PLANE_TYPES = { fighter:{hp:20, speed:38, range:1000}, dive:{hp:28, speed:30, range:1000}, torpedo:{hp:30, speed:26, range:1000} };  // fuel = range / speed × 6 s
WW.NATIONS = { USN: {...}, IJN: {...} };   // only id and ui colours are used; models.js has its own palette
WW.world = { ships: [], planes: [], wrecks: [] };
WW.stats = { planesLaunched, planesLanded, planesLost, shellsFired, torpedoesFired,
             bombsDropped, depthCharges, hits, shipsSunk, round };
```

Read `js/core.js` for the full tables (guns, ranges, reload times, anti-aircraft values and torpedoes).

Helpers: `WW.rand`, `WW.seedRandom`, `WW.randRange`, `WW.randInt`, `WW.pick`, `WW.clamp`, `WW.lerp`, `WW.angleDiff`, `WW.dist`, `WW.dist2`, `WW.pastel`, `WW.enemyOf`. Events: `WW.on(name, fn)` and `WW.emit(name, data)`. Event names include `roundStart`, `setupStart`, `shipSunk` and `shellFired` (`{ ship, cal, x, y, z, proj }`, sent by `combat.fireShell` for sound). Sound hooks for the naval family: `shellLanded` (`{ cal, x, z, ship }`, `combat.landShell`; `ship` is null for a miss), `shipHit` (`{ ship, amount, x, z, kind, cal }`, `Ship.takeDamage`, before the sinking check), `shipBoom` (`{ ship, x, y, z, size }`, a secondary explosion: `damage.js emitShip` and `Ship.updateSinking`), `dcDropped` (`{ ship, x, z }`, `combat.dropDepthCharge`) and `dcBlast` (`{ x, z, ship }`, `combat_weapons.js updateDC`, not for a dud on land); and from `combat_aa.js` for the AA sounds (`audio_aa.js`): `aaHeavyFired` (`{ ship, x, y, z, target }`, one per heavy-AA salvo, at the firing mount), `flakBurst` (`{ x, y, z, ship, nation }`, one per fused burst when it detonates) and `aaLightFired` (`{ ship, target, hit }`, one per light-AA tracer stream); and `planeHit` (`{ plane, amount }`, aircraft.js `Plane.damage`, inside its 0.18 s hit-flash throttle) for `audio_air.js`.

## Modules

### terrain.js

```js
WW.terrain = {
  generate(seed),                     // make a new map; remove the old meshes (sim-only mode: the depth grid only)
  depthAt(x, z) -> number,            // water depth in units; 0 or less is land; off the map is 0
  isNavigable(x, z, minDepth) -> bool,
  randomSeaPoint(minDepth, xMin, xMax) -> {x, z},
  update(dt), seed, landFraction,
  site,                               // the airfield site: { kind: 'atoll' | 'volcanic', x, z, h, padH, apron, runways: [{ x, z, h, len, w }], atoll | island }
  padDist(x, z), PAD_H                // distance outside the airfield pad (0 on it); the pad's ground height (1.2)
};
```

Fewer, larger islands (`terrain_islands.js`, `WW.terrainIslands.make`, from terrain.js's own seeded generator):
- **Atoll maps (60%)**: a Midway-style reef ring (radius 115 to 128, the crest about 0.9 under water with surf, one shallow channel, a shallow lagoon inside) in the middle third of the map, holding a flat coral 'field' island with the airfield (Eastern Island) and a low sandy island (Sand Island), sometimes a cay; plus one volcanic island elsewhere.
- **Volcanic maps (40%)**: one big volcanic island (radius 58 to 70, peak 9 to 12) with the airfield on a coastal plain on its flank (the apron side to the sea), fringing reefs off the far side, and a second, smaller volcanic island.
- Plus 3 to 5 islets, 1 to 3 sandbars and 2 to 4 reefs. The free islands (not the atoll or the field) are scaled so land is 4.5 to 7% of the map. The start zones (x < 120 and x > `MAP_W` − 120) stay open. The reef crest is too shallow for any ship, so the atoll is one convex obstacle: ships go round it, nobody gets into the lagoon.
- **The airfield pad**: two crossing runways (86 and 60 long) and an apron, flattened to `PAD_H` = 1.2 with a 10-unit blend (`flatten`, after the surface roughness), so the base sits on flat land. Palms and huts keep off it.
- All of it is part of `heightRaw`, so the depth grid (both modes) and the floor mesh agree. `generate` takes approximately 80 ms (headless, 960 × 600). The terrain bakes soft ambient occlusion into its vertex colours. `generate` sends the depth grid to `WW.water.setDepth`.

### sky.js, water.js, post.js

- `WW.sky`: a sky dome with a golden-hour gradient (peach near the sun, blue away from the sun), smooth toon clouds, a warm low sun (approximately 21°) with soft shadows, a strong cool sky fill light, and fog. It gives `HORIZON`, `SUN_DIR` and `sunColor()`.
- `WW.water`: one large water plane to the horizon. A small depth texture controls the depth colours, the foam lines around islands and shoals, the clear shallows, the sun glitter and the fog. It also has a pool of soft dark contact-shadow blobs under ship hulls.
- `WW.post`: renders the scene into a half-float target with MSAA, adds a soft bloom (bright pass and blur at quarter resolution), then applies a soft tone curve and 10% desaturation. `WW.post.toggle()` turns it off. Three.js ACES tone mapping is not used, because it made the pastel colours grey.

### Time of day and weather: daylight.js, weather.js, night_ops.js, sky_time.js, night_fx.js, weather_fx.js

```js
WW.daylight                          // 1 day .. 0 night, sim state (main.js step), the same in sim-only mode
WW.dayNight = { kind: 'day' | 'dusk' | 'night', startHour, duskAt, hourAt(roundTime), level(t), canFly(), landRisk(),
                force,                // test hook: 'day' | 'dusk' | 'night' | n (dusk begins n s in), set before startRound
                pin, stats };         // pin: a fixed daylight (screenshots)
WW.weather  = { kind: 'clear' | 'scatter' | 'line', cells: [{ x, z, r, dens, vx, vz }], cover(x, z) -> 0..1,
                along(ax, az, bx, bz) -> worst cover on the line, shelter(x, z, maxD, lead) -> { x, z } | null, force, stats };
WW.nightOps = { seeR(s, o, size, glow), visK(s, o), radarR(s, o), airK(o), lit(o),        // intel.js hooks
                torpK(B, k), rangeK(B), pressK(B), cvFleeK(), subUp(),                      // doctrine hooks
                shells: [{ x, y, z, r, lit, nation, by, lightAt, until }], lights: [{ ship, target, until }], stats };
```

- The clock: `hourAt(t) = startHour + t / 120` (1 sim s = half a game minute). Daylight falls from 1 at 17:45 to 0 at 19:00. `roundStart` rolls the start (two `WW.rand` calls, also when forced) and the weather (fixed count of `WW.rand` calls; it reads the round's `WW.wind`, which damage.js rolls in `clearAll` before `roundStart`).
- Sim hooks elsewhere are one or two lines each: intel.js (sight ranges, radar pass, planes' sight), fleet_cmd.js (press threshold), ai_surface.js (preferred range, torpedo distance, cripples shelter in rain), ai_carrier.js (flee radius, shelter in rain), ai_light.js (night surface attacks), air_cag.js (low cloud spoils the dive, strikes route round rain), air_deck.js (night landing risk), air_scouts.js (no catapult launches after dusk); daylight.js wraps `WW.air.launch`. The doctrine fields `night`, `nightEye`, `radar` and `searchlight` are in fleet_groups.js. Ships carry `searchOn` / `searchTgt` (their own searchlight) and `searchLit` (lit by an enemy beam until that sim time).
- Visual (render mode only, `Math.random`): `sky.update` calls `WW.skyTime.update`, which keys every colour on daylight (1 golden hour, 0.7, 0.45 sunset, 0.25 blue hour, 0 night: the golden-hour look is unchanged at 1), sets the sun's dome height, the light direction (the sun, kept 10° up for the shadows, then the moon from the blue hour on; the shadow basis follows), the stars and moon in the dome, the water tint, horizon colours, glitter direction and the moon's path, the rain on the water, and post.js `setNight` (lower bloom threshold, stronger bloom). Under rain near the camera it greys and closes in the fog and dims the lights. It then calls `WW.nightFx.update` and `WW.weatherFx.update`.
- `night_fx.js` keeps a fixed pool of 5 PointLights (never added or removed: the light count is compiled into the materials; idle ones have intensity 0), handed each frame to the best sources near the camera (star shells, searchlight spots, burning ships, big-gun flashes, secondary explosions). It draws pooled star-shell flares, searchlight cones and light pools on the sea, brightens the tracers, adds night camera candidates (`WW.camHooks`: a lit target 9.5, a searchlight ship 8.5, a burning ship 7.5), calls `WW.camAction.slowmo()` when a star shell bursts over the director's subject, and wraps `WW.camStory` so air stories end and do not start after dusk.

### models.js, models_detail.js, models_planes.js

```js
WW.models.buildShip(type, nation) -> {
  group,                         // THREE.Group, bow on +x, waterline at y = 0
  turrets: [ { obj, barrel, cal } ],  // obj turns around y; aft turrets rest at rotation.y = PI
  stacks: [ Object3D ],          // funnel tops, for smoke
  deck: Object3D | null,         // carrier only
  hullMats: [ hull, deck, waterline band ],  // per-ship materials that can be tinted
  _hg                            // hull size [length, beam, top], for damage.js
};
WW.models.buildPlane(kind, nation) -> {
  group, prop, payload,          // payload: bomb or torpedo mesh, or null; prop spins about local x
  wingL, wingR,                  // Groups at the wing roots (port -z, starboard +z). Fold up: wingL.rotation.x = +a, wingR.rotation.x = -a
                                 //   Corsair: inverted gull wing; the inner panels are part of the body, wingL / wingR are the outer panels pivoting at the knee
  brakes,                        // null or { open, parts, set(a) } (a: 0 closed .. 1 open); SBD split flaps, D3A under-wing brakes
  blades, disc, fx, name         // prop blades / blurred disc, local fx anchors (exh, canopy, tipL, tipR), type name
};  // types: USN F4U Corsair / SBD Dauntless / TBD Devastator, IJN A6M Zero / D3A Val / B5N Kate
```

Materials are `MeshToonMaterial` with a shared 5-step gradient and baked vertex ambient occlusion. `models_detail.js` adds fine detail (gun tubs, lifeboats, radar, rails, catapults and more) and merges the static parts of a ship into one mesh per material. It makes this one time for each type and nation. Ships cast and receive shadows. Planes cast shadows.

### models_crew.js, lifeboats.js

```js
WW.crew = { init(), update(rdt), clearAll(), stats() -> { ships, sailors, visible, ms, maxMs, buildMs },
            addFigure(worldMatrix, nation, role),   // one extra figure this frame (lifeboats)
            adopt(ship, n), stations(type, nation), top(type, nation, x, z), halfW, deckY, HP, recs, SCALE, FAR };
WW.crewOps = { ship(rec, now), frame(rec, dt, now), step(s, rec, dt), atRail(s, rec), abandon(rec, mk), pose(s, rec, now), hullZ(type, x, y) };
WW.crewProps = { init(), update(dt), hose(ship, hx, hy, hz, tx, ty, tz, dt), clearAll(), stats() };
WW.lifeboats = { init(), update(dt), figures(), clearAll(), stats() };
```

- Visual only: `Math.random`, no effect on the simulation. Both clear themselves on `roundStart` and `setupStart`.
- Sailors are about 0.48 units tall (`SCALE` 1.1). That is larger than true scale, like the planes' `PLANE_SCALE`, so they read in close shots. All sailors in the scene are 4 `InstancedMesh`es (shirt, trousers, head, cap) that share one instance-matrix buffer, plus a 5th for the arms (2 instances per figure, its own matrix buffer, pivot at the shoulder). Per-instance colours: USN dungarees with a white cap, IJN whites with a dark cap, khaki officers, grey-helmeted gunners and coloured carrier deck jerseys.
- Poses: each frame a sailor gets an arm swing forward (`aL`, `aR`, radians; 0 hangs, π is straight up) and an outward flare (`oL`, `oR`), a crouch `cr` (0..1, the body squashes by up to 28%), a forward `lean`, a `hop` and a recoil offset `dx` along its facing. Walking swings the arms; `WW.crewOps.pose` sets the working poses.
- `stations()` also bakes a top-surface height map per type and nation (`top(type, nation, x, z)`: decks and low roofs up to 1.4 above the hull deck, the median of a 3 × 3 sample, so masts and rails do not count). `damage_visuals.js` puts its deck decals there.
- Stations per type are in ship-local coordinates (carrier 13, battleship 10, cruiser 7, destroyer 5, PT boat 3, submarine 3). The surplus valid stations are spares for rescued sailors. Deck heights come from vertical-line hits on a throwaway model of each type and nation, made one time in `init`. A station that would be in the air, inside superstructure or without head room is dropped. Each deck sailor also gets a walkable lane along x.
- `WW.crew.update` runs each frame on real time. Sailors idle, sway, look around and walk a step along their lane. The PT boat gunner turns with his mount. When the ship sinks, up to 4 more hands come up from below, and the sailors go below, run to the rail and jump, or climb down a cargo net (`crew_ops.js`). A sailor whose feet go under water is hidden. A submarine's crew shows only while it is surfaced. Ships more than `FAR` (115) units from the camera are skipped. Wrecks have no crew.
- `WW.lifeboats.update` runs on simulation time. 1.2 s into a sinking, whaleboats (carrier 4, battleship 3, cruiser 2) or 1 raft (destroyer, submarine, PT boat) launch from the sides. Every 3 s, each boat picks its goal: the destroyer sent to rescue survivors near it (`WW.endgame.rescuerNear`), else, while survivors near it still wait for a rescuer (`WW.endgame.taskNear`), the sinking position (it lies to there), else the nearer of a live friendly ship or the shore (a ring search with `WW.terrain.depthAt`, sized from `WW.cfg`). It rows at 1.2 units/s, steers around hulls and keeps off land. A friendly ship picks it up (its sailors join that ship's crew through `WW.crew.adopt`). On land it beaches and its sailors stand on the sand until the round ends. With no goal for 90 s, it fades. The pool has 36 boats.

### crew_ops.js, crew_props.js

Visual only (`Math.random`, real time); every listener returns at once in sim-only mode or for a ship without a crew. `models_crew.js` calls `crewOps.ship` every 0.5 s per near ship (jobs), `frame` per near ship and frame, `step` / `atRail` for the custom modes, `abandon` when the ship starts to sink and `pose` per sailor; `crewProps.update` runs at the end of `crew.update`.

- AA crews (`aaLightFired`, `aaHeavyFired`): for ~1 s the gunners (role `g` and mount-bound sailors) face the target, crouch, grip and shake with the recoil (a harder kick on a heavy salvo).
- Gun crews (`shellFired`): 2 deck hands walk to just aft of (or forward of) the firing turret and pass shells (arms pumping) until 5 s after the last shot. Near a firing big or medium turret, idle hands put their hands to their ears for a moment.
- Damage-control parties: every 0.5 s the worst 1 (carrier, battleship: 2) burning `ship.dmgSites` get 2 + ⌊severity⌋ hands (2–4), the nearest along their lanes (they may leave loading or a look at a hit). The lead stands ~1.5 units off and plays a hose: `crewProps.hose` sprays ~70 droplets/s along a parabola in ship-local space (the stream stays on the moving deck); a small white steam puff rises from the fire now and then. When the site stops burning they walk back. A fresh hit without fire still draws 2 hands to look.
- Lookouts: on a first `contact` (ships of that side within 400 units) or when an enemy plane comes within 85 units (at most every 12 s), an officer and one hand point at it for 3.5–5 s.
- Cheer: an enemy ship sinking within 160 units, or a plane the ship fired at going down (`killedBy`, or shot at in the last 2.5 s), starts a wave of arms-up and hops along the deck, bow to stern.
- Salute: a friendly ship sinking within 80 units: the crew stands still (no sway) facing her for 12 s; officers salute.
- Carrier deck: plane directors (yellow) circle an arm while a plane holds for launch and point down the deck during its run; the hand nearest the stern holds out his arms like an LSO's paddles for a plane on final and waves both arms overhead for a wave-off; 2 deck hands run to chock a plane that has just trapped (`state === 'rollout'`), crouch beside it, then return. All of it is read from `ship._deck` and the plane states; nothing is written.
- Cargo nets: at the rail, 70% of the sailors of a carrier, battleship, cruiser or destroyer climb down a net (up to 4, 3, 3, 2 nets per ship, 4 sailors each, staggered) facing the hull, arms climbing, then drop into the water with a small splash. `crewProps` hangs each net (rope-grid canvas texture, alpha-tested) from the rail to the water, following the hull's flare, in ship-local space.

### damage_visuals.js

```js
WW.dmgVis = { init(), pose(rdt), unpose(), draw(rdt), clearAll(), topple(ship, i), stats() };
```

Visual only (`Math.random`, real time, initialised only in render mode). `damage.js hit` emits `dmgSite` (`{ ship, lx, ly, lz, kind, cal, amount }`, ship-local, after the site is stored); `ship_fires.js` emits `deckHit`.

- Decals: 2 pooled `InstancedMesh`es of unlit, alpha-blended planes (`depthWrite` off, polygon offset): soft char scorches (360) and shell holes (220: a black ragged hole, torn grey plating, a rust ring). A shell scorches the deck or roof under it (`WW.crew.top`), size by calibre, and may hole the hull side near the waterline (small 20%, medium 45%, big 60%); a torpedo leaves a big hole at the waterline with a scorch above; a bomb a crater and a wide scorch. At most 12 deck and 10 side marks per ship (carrier +4): a further hit grows and darkens the nearest mark instead. Marks follow the hull (group matrix) and knocked-out turrets.
- Knocked-out turrets (`ai.turrets[i].disabled`, polled): the turret's merged gun mesh (the child that reaches furthest forward) droops 13–20° about its trunnions, the house turns 17–37° askew (`ships_ai` never writes a disabled turret's rotation again, and nothing in the sim reads it), a scorch and a hole on its roof, a small explosion.
- Masts and funnels (`PARTS`, per type and nation, ship-local boxes): a heavy hit (big or medium shell, bomb, torpedo) under 60% hp topples a mast or bends a funnel within ~3 units with chance 0.35 (under 30% hp any of them, 0.25). A mast carrying the admiral's flag hoist (`admirals_flags.js`) takes it down with it. The part's vertices in the ship's merged static meshes (cloned for that ship, disposed with it) rotate about its foot: masts fall 57–77° (mostly aft for forward masts and forward for aft ones, sometimes over the side) with a small bounce; funnels bend 20–31° above their base. A bent funnel's stack marker turns with it, so the smoke leaves the new mouth.
- Settling: under 75% hp (or flooding, `ship.flood`) a ship sinks lower, by up to 0.1 + 0.012 × length units, and trims down by its damaged end (up to min(0.05, 0.6 / length) rad), easing in over seconds, fading out in the first 3 s of a sinking. `pose` adds it to the group after the sim steps of a frame; `unpose` (start of the next frame, and `fastForward`) restores the sim pose if nothing changed it since, so sim code never sees it.
- Deck fire (`deckHit`): 1–4 burnt-out parked planes (charcoal `InstancedMesh`, 18 at most) near the hit, burning 25–45 s (fire and smoke puffs from them, no lights), plus wide scorches and a crater.

### effects.js

```js
WW.fx = {
  init(), update(dt), clearAll(),
  splash(x, z, size), explosion(x, y, z, size), muzzleFlash(x, y, z), flak(x, y, z),
  smoke(x, y, z, dark, size), fire(x, y, z), wake(x, z, heading, size),
  oilSlick(x, z, size), sparks(x, y, z),
  trail(x, y, z, dark, size, life)   // short-lived puff for plane trails and smoke plumes
};
```

The effects use instanced meshes in fixed pools. When a pool is full, the oldest particle is used again. Smoke drifts with `WW.wind`.

### damage.js

```js
WW.damage = {
  hit(ship, amount, x, z, kind, cal),  // kind: 'shell' | 'torpedo' | 'bomb' | 'dc'
  update(dt), clearAll(),
  load(),                     // share of the smoke budget in use; other emitters slow down when it is high
  stackSmoke(ship, funnel, dt), want(perSec)
};
WW.wind = { x, z, a };        // one wind direction for each round
```

Each hit becomes a damage site in the ship's local coordinates. Each frame, the sites move with the ship, so fires and smoke stay on the hull when the ship turns, lists and sinks. A torpedo hit gives the ship a small list toward that side. A heavy hit near a turret can stop that turret. A ship with less than 30% hp gets one large fire. Wrecks smoke lightly for approximately 30 s.

### combat.js, combat_weapons.js

```js
WW.combat = {
  init(), update(dt), clearAll(),
  fireShell(ship, turret, target, cal),
  fireTorpedo(owner, x, z, heading, nation, range),
  dropBomb(plane, target),
  dropDepthCharge(ship, x, z)
};
```

Shells fly on a ballistic arc to a lead point. Accuracy decreases with range. Shells and bombs do not hit a submerged submarine. Torpedoes and depth charges do. A torpedo takes its launcher's nation weapon (`ship.stats.torpedoes`, else `WW.torpSpec(nation, 'air')`): speed, `sight` and a dud roll at launch (`p.dud`). A dud that reaches a hull does no damage: a small splash and sparks, `torpedoDud` and `weaponImpact` with `dud: true` (sound: `torp.dud`). On the water a steam torpedo leaves a bubbly white streak (`fx.wake` + `fx.torpBubbles`), an oxygen one (`sight` < 1) a faint trace (`fx.wake(..., faint)`). A submerged sub with an enemy ship within 110 shows a periscope feather (`Ship.effects`). `combat.update` also does the anti-aircraft fire of each ship. Combat calls `ship.takeDamage(amount, x, z, kind, cal)`.

`combat_aa.js` (`WW.combatAA = { update, clearAll, applyJink, cfg, _debug }`) does the anti-aircraft fire; `combat.js` `updateAA` and `clearAll` call it.
- Each ship's `aa.dps` is split into a heavy share (battleship 60%, cruiser and carrier 55%) and a light share (all of it on destroyers and PT boats).
- Heavy AA fires a salvo of 3 time-fused bursts every 1.1 s at the best bomber above 10 units in `aa.range × 1.55`. The bursts pop at a predicted lead point, spread across the target's path. A burst damages every enemy plane within 6.5 units (falls off with distance squared) and leaves black puffs that drift with `WW.wind`. Puffs and orange flash cores are two bounded instanced rings (400 and 64).
- Light AA fires every 0.25 s at the nearest plane below 24 units in `aa.range`, with one hit roll per stream, and shows a stream of glowing tracer rounds (pooled projectiles of kind `aatracer`).
- A bomber near a burst gets `plane.jink` (0 to 1, decays). `Plane.update` calls `applyJink`: a small weave in heading and height, never during a run, dive or pull-out. Jinking lowers the chance to be hit; a steady torpedo run or dive raises it. When AA downs a plane, `plane.killedBy` is the ship.

### ships.js, ships_nav.js, ships_ai.js

```js
class WW.Ship {
  id, type, stats, nation, x, z, heading, speed, hp, maxHp,
  alive, sinking, wreck, submerged, group, model, hangar, dmgSites,
  update(dt), takeDamage(amount, x, z, kind, cal), remove()
}
WW.ships = { init(), update(dt), clearAll(), spawn(type, nation, x, z, heading) -> Ship, alive(nation?) -> Ship[] };
WW.shipNav = { hullPoints, hullOK, resolve, placeHull, wreckAt, nav, ... };
WW.shipAI = {
  setup(ship), update(ship, dt), retarget(ship), ROLE_W, VALUE,
  roles: { surface, carrier, submarine, pt },            // fn(ship, dt) per type, registered by the role files
  h: { bearing, seen, lead, fireSpread, blend, idle,      // shared helpers (ships_ai.js)
       withdraw, comb, score, riskOf, unreachable },
  surface: { followStation, prefRange, engage, torpedoes }, // ai_surface.js seams
  pickStrikeTarget(unit), capWanted(carrier) -> n, strikeTarget(carrier)  // ai_carrier.js; capWanted: CAP fighters wanted (air_ops.js)
};
```

- **Damage slows ships** (`ship_speed.js`, `WW.shipSpeed = { hit, k, vmax, hpK, stats }`): the target speed in `Ship.move` is `stats.speed × ship.speedK × throttle`. `speedK` = hull factor (1 above 70% hp, easing to 0.5 at 15% hp and below) × (1 − `flood`) × `engineK`. Each torpedo hit floods −0.08 (at most −0.3). A torpedo, bomb or big-shell hit knocks the engine room out with chance 0.12 (`WW.rand`, not PT boats): `engineK` 0.5, half the time for good, else for 25 to 60 s. `Ship.takeDamage` calls `hit` (after hp drops, before `damage.hit`); `ship.speedK`, `flood`, `engineK`, `engineT` are public. Visual: `Ship.cripList()` adds up to ~9° of list (flooding, hp under 60%) on the side of the torpedo list, and the wake shrinks with `speedK`. `WW.shipSpeed.vmax(ship)` is the current top speed the AI compares.
- **Leaving the map**: `ship.escapeEdge` (−1 west, +1 east, set by `ai_endgame.js` for a broken side) switches off the soft edge push and the planner's edge margin on that edge (`ships_nav.js clearance` plans as if the sea went on); `endgame.js` removes the ship once it is within `EXIT` (20) of the edge (a corner can pin a big hull short of the line).
- Navigation: `ships_nav.js` checks points along the keel and on the two sides of each hull. All points must be at a depth of 0.5 or more. If a move is not permitted, the ship tries a smaller turn, a turn in place, astern with a turn, a slow forward move, then straight astern.
- If a ship pivots against shallow water for more than 2 s, it goes to the heading with the most clear water.
- Spacing: each type has a personal space (carrier 70, battleship and cruiser 35, destroyer 20, PT boat and submarine 12). Escorts stay 50 to 80 units from their carrier.
- After all ships move, `WW.shipNav.resolve` pushes overlapping hulls apart. The lighter ship moves more. Wrecks above the water and sinking ships do not move.
- Sinking takes approximately 8 s. The ship moves at most 15 units and does not go into another wreck or onto land. The wreck stays on the seabed until the next round. In shallow water, one end of the wreck stays above the water.
- A submarine must come to the surface for 25 s after 45 s under water, 65 s while a known destroyer is within 90 (`ai_light.js`). A submerged submarine casts no shadow.
- Ship AI, per step: `ships_ai.js` retargets every 1 to 1.5 s, runs the role (`roles[type]`, else `roles.surface`), then the shared overrides `withdraw` (unless `ship.ai.ownWithdraw`) and `comb` (unless `ship.ai.ownComb`), then the guns. Roles write only `ship.desiredHeading` and `ship.throttle`, plus their own state on `ship.ai`.
- **Target score** (`h.score`): `ROLE_W[type][target] × VALUE[target] × pHit × finishBonus × WW.fleetCmd.assignment − exposure`. Only fresh contacts count.
  - pHit falls with range, rises when the target is broadside on, and is ×0.8 on a plane or scout sighting.
  - finishBonus is 1 + 0.8 × damage taken, +0.1 when the target has its big fire (`dmgCrit`, under 30% hp). Not `dmgSites.length`: hit-site fires last a `Math.random` time, and reading them broke seeded replays.
  - exposure is the danger at the target's position × (1 − risk).
  - Stickiness: a ship switches targets only for a score 1.3× the current one, recomputed each time.
  - A destroyer scores a carrier or battleship only when another own destroyer is within 150 (a flotilla attack, never a solo charge).
  - A carrier that is out of gun range and at least 0.9× as fast as the shooter scores ×0.3 (`h.unreachable`). A surface ship with such a target keeps its formation station instead of chasing.
- Per-mount guns:
  - the main battery takes the main target when it is in range, else the best target in range by its own weights;
  - secondaries take the closest small threat in range (`SEC_W`);
  - a PT boat's MG never fires at a battleship or cruiser (`GUN_W.mg`).
- `fireSpread` returns false and holds fire for 1.5 s when an allied surface ship is inside the fan, out to torpedo range.
- **Cripples** (`h.withdraw`, used by carriers' own code and PT boats; surface ships use `crippleHome` below): below `WW.fleetGroups.CRIP = 0.35` hp, any ship except a sub turns away from the nearest known enemy (contacts up to 45 s old). It turns toward its own carrier or station when that is also away, at full throttle, through `bestHeading` with risk 0. It still shoots back.
- **Torpedo combing** (`h.comb`; the track must first be seen: `R.TORP` × the torpedo's `sight`, so an IJN oxygen torpedo is seen at ~27, a USN steam torpedo at ~58): a track from `WW.intel.torpedoes` that will pass within half a hull length + 6 inside 70 units. After a reaction delay (PT 0.4 s, DD 0.7 s, sub 1 s, CA 1.2 s, CV 1.8 s, BB 2 s), the ship turns parallel to the track, bow or stern on, whichever is the smaller turn, until the torpedo has passed.
- Surface ships (`ai_surface.js`; the order inside `surfaceAI`: sub hunt, then AA cover / press / station / engage, torpedoes, torpedo angling, early combing, the carrier keep-off, and last `crippleHome`):
  - **Pursuit** (posture `pursue`, see fleet_cmd): with nothing in gun range a ship steams for `WW.endgameAI.pursueContact`: the nearest last-known enemy up to 120 s old (cripples count as 0.6 × the distance), aimed ahead along its course by the time it takes to get there (at most 60 s); carriers only when fair game; no lair or home-waters limit. It closes like a press (`prefRange` × press factor), is not tied to its station, and a destroyer may attack a crippled capital ship alone. `WW.endgameAI.fairGame(ship, cv, B)`: a carrier that is crippled (hp < `CRIP` or `speedK` < 0.75), slower than 0.95 × the pursuer, or with no fit known gun ship of its own within 150; for it the carrier keep-off, the `CV_KEEP` floor of `prefRange` and of `torpedoRun`, and `h.unreachable` are lifted;
  - with no target, they keep their commander station. While the side presses (`posture 'press'`) they steam instead for the nearest last-known enemy contact up to 60 s old (`pressContact`, `closeOn`): never a carrier, never a PT boat for a BB / CA, never a contact within 230 of a known enemy carrier (its lair) or inside the enemy's home waters (0.35 of the width from its edge). A target out of gun range in those home waters is not chased either (`homeWaters`): the press holds at the edge of the band and a broken enemy that gets home retires (main.js);
  - otherwise they orbit at `prefRange`: `doctrine.rangeFrac` × main range, and inside torpedo range for DDs;
    - while the side presses: × (0.72 + 0.15 × (1 − night)) (IJN closer);
    - while the side withdraws: × 1.15;
    - against a carrier: at least `CV_KEEP` + 5;
  - the orbit holds a pure broadside within ±10% of `prefRange`; a battleship or cruiser picks its orbit side (re-chosen every 20 s or on a new target) so that it runs across its target's bow: crossing the T;
  - they are tied to the station when more than 110 from it (escorts: 60; not while pressing), and every heading goes through `bestHeading` with the type's risk;
  - they launch torpedoes inside `(0.6 + 0.3 × doctrine.torpedo)` × torpedo range.
  - **Destroyer torpedo attack** (`torpedoRun`, a battleship or carrier target, which `h.score` only allows with another own destroyer within 150): the DD waits at 1.35 × its launch distance until a second destroyer is within 1.8 × that distance of the same quarry, runs in from the flank (flotilla members alternate sides by slot, so the pair come from different angles), launches beam on, then turns away for 14 s. It never goes inside 0.8 × the launch distance, the target's secondary range + 8, or `CV_KEEP` of a carrier: no ram-closing. Smoke is not modelled.
  - **AA cover** (`aaCover`): while `B.airRaid` names an own carrier, cruisers (and a battleship of the carrier group) within 300 of it with nothing in gun range close to 45 of it.
  - **Torpedo threats**: big ships turn parallel to any side-wide torpedo track (`WW.intel.torpedoes`, so an escort's sighting counts) that will pass close within 150 (BB) / 120 (CA), after the type's reaction delay (`earlyComb`); the core comb then holds it. A battleship also angles bow or stern on to a known DD / PT (seen in the last 5 s) inside 1.1 × its torpedo range that has it in its bow arc (`angleOnBoats`).
  - **Carrier keep-off**: no surface ship closes inside `CV_KEEP` (108) of a known enemy carrier (contact ≤ 10 s old, moved along its course), unless its side pursues and the carrier is fair game (above).
  - **Cripples** (`crippleHome`, replaces `h.withdraw` for surface ships: `ai.ownWithdraw`): below `CRIP` hp, head home (60 behind the own carrier, else the own map edge), pushed away from every known enemy that could shoot (contacts ≤ 45 s, within 1.2 × its gun range + 20), at full speed through `bestHeading` with risk 0.
- Destroyers hunt a known sub inside `SUB_HUNT` (100; ×2 for the commander's ASW screen and escorts, and out to 250 when the sub is known within 70 of an ally) before surface targets. The attack run is in `ai_surface.js` (`dcApproach`, the `DC_*` constants above `surfaceAI`): it steers for the sub's predicted position at detonation, lays a stern stick of 5 charges plus a K-gun pair as it passes over, then comes round to re-attack.
- **Carriers** (`ai_carrier.js`) never charge.
  - Station: the commander's, `cvStandoff` behind the battle line. It is kept 0.15 to 0.35 of the width from the carrier's own edge and 150 from the north and south edges; with no battle line it is a fixed home at 0.2 of the width.
  - Flee: the carrier runs from every known gun ship (contacts up to 90 s old, moved along their course for up to 20 s) inside `max(210, 1.5 × gun range + 50)`, summed with weights (1 − d / r)².
  - It turns into the wind (`WW.airDeck.steer`) only on station, outside the edge band, with no danger at its position and no gun ship known within 320.
  - Every heading goes through `bestHeading` with risk 0, with helm hysteresis: a course change of more than 0.3 rad at most every 2 s.
  - It handles its own cripple withdrawal (`ownWithdraw`).
  - CAP: `capWanted(carrier)` (one more fighter when detected raiders are within 200 and fewer than 3 are up).
  - Strikes: `strikeTarget(carrier)` returns `WW.fleetCmd.strikeOrder(carrier).target` unless it is on hold. The strike interval is 35 to 55 s × (1.25 − 0.5 × `doctrine.carrier`).
- **PT boats** (`ai_pt.js`, state in `ship.ai.lt`, tuning in `WW.lightAI.PT`): hit and run only.
  - **Spot**: the commander gives each pair its own spot (`fleet_search.js`, `order.spot`): pairs get lanes spread across the map; each lane's spot is the best island cover point within 150 of the lane point (low danger), at least 75 from every other pair's spot; the wing's spot is 15 beside its leader's, across the line of advance. `lurkSpot` takes it unless it is in danger (> 0.3) or ghost reach, or the boat is a cripple; then the old rule below applies. During a long search (`sweep`, no enemy gun ship seen yet) the lanes advance 4 u/s (6 for a PT / sub-only side, which starts after 25 s) and scan north-south; with `ptDeep` (no enemy battleship, cruiser or destroyer seen this round, and an enemy carrier known or 120 s of search) the midline limits become `PT.DEEP` (runs anywhere the danger field allows) and the lanes close on the known enemy to 110 short of it, 70 apart.
  - **Skirmish** (`gun`): an enemy PT boat or surfaced sub within 160, not deeper than the run limit and with no other danger there: up its beam (18 off, lead and wing on opposite beams) and pace it with the MG; other pairs already on it count against it (80 per boat), so the boats spread over the enemy's. Ends on a lost contact, after 40 s or 35% hp lost.
  - Break-off and run legs keep way on (`sweep`: a helm order past 1.1 rad is cut to 1.1, so the 1.2 rad speed penalty never applies), except past the midline, where the nav layer needs the real course home.
  - **Lurk** (no commander spot): the commander's PT station (own flank), pulled to an island cover point within 150 of it (deep water beside land that blocks line of sight; `coverPts()`, sampled once per map). The spot stays at least 0.06 half-map inside the own half and outside known gun reach: `WW.threat` danger, plus heavy ships seen this round and since lost (`ghosts`, kept 240 s, moved along their last course). The wing of a pair lurks 14 beside its leader. At the spot a PT patrols in legs: out stern-on to the enemy at 0.9 throttle, back to the spot at 0.5.
  - **Target of opportunity**, checked every 0.5 s with tubes loaded and hp ≥ 35%: a fresh contact (not a PT) that is isolated (no other enemy gun ship within 75), crippled (< 50% hp), slow (stats speed < 6 or making < 2.5), or a DD / CA within 30 of land. The firing point is 38 off the target's beam, from an 8 s look-ahead on its track; the pair splits bow-ward / aft-ward, and the far beam is used when it is clearer. The run needs the target within `DASH + FIRE`, a dash ≤ 130, the firing point ≤ 0.12 half-map past the midline, and danger along the path minus the target's own share (`ownDps`) ≤ `EX_MAX` 9 (× 1.6 crippled, × 1.4 near land, × 1.2 isolated). `WW.lightAI.stats` counts the refusals.
  - **Pairs**: the partner (`WW.fleetCmd` PT group, paired by slot, else the nearest own PT) joins a running mate's target from the other beam when its own path check passes.
  - **Run**: full speed to the firing point, then the bow on the lead point; it fires inside 50 when the core fan check and a local land check along the track pass. It aborts on a lost contact, after 24 s, past 0.16 half-map, after losing 30% hp, when the path danger spikes past 2.2 × `EX_MAX`, or when a fresh DD within 80 turns its bow toward the PT.
  - **Break off** (`out` after a run, `flee` from a known gun ship within 25 of its reach or any known danger > 0.6 while lurking): full speed straight away from the closest threat, leaning ±0.25 toward home with a ±0.18 jink, through the smaller turn first. Past the midline, home comes first. It returns to the spot once clear.
  - MG: only at PT boats, surfaced subs, or a DD within 25 (`calTarget` is rewritten every step). The PT handles its own cripples (`ownWithdraw`) and combs torpedo tracks only while lurking (`ownComb` otherwise).
- **Submarines** (`ai_light.js`, state in `ship.ai.ls`, tuning in `WW.lightAI.SUB`):
  - **Ambush**: every 0.5 s, the best contact up to 30 s old (CV 4, BB 3, CA 2; never a DD or PT; × 0.45 when a DD is within 80 of it, × 1.4 crippled, × 1.15 slow). The sub goes to a point 55 off the target's predicted track (from its last-known heading and speed) that it can reach before the target gets there. There it waits slowly, bow on the lead point. It fires inside 82 (not under 22) only from the target's bow or beam (angle on the bow < 115°), with the fan and land check.
  - **After firing** (`evadeT` 14 s): submerged, throttle 0.45, turned away from the target or a DD within 90.
  - **Depth**: down while a DD is known within 90, a plane within 125, a gun ship within 80, after a shot, or while closing a target within 105 with fresh air. A DD within 130 or a target within 105 keeps it down only until 18 s of dive time; then it surfaces to refresh while still unseen. Otherwise it runs surfaced. A surfacing aborts when any of these appears. The existing limit stands: 45 s under water forces 25 s on the surface; hunted (a known DD within 90) the boat stretches it to 65 s rather than surface under the destroyer.
  - **Destroyers**: headings go through `ddSteer`, which keeps 100 from every known DD's position and its position 8 s ahead. A DD inside sonar range (65), or one bearing down within 90, is "cornered" fire, the one time a sub targets a DD. With the tubes nearly ready, the sub holds its bow on that DD and fires inside 38. Otherwise it goes slow (0.3) and turns away. With the air running low and a gun ship within 130, it opens the distance before the forced surfacing; when forced up, it runs from the nearest threat. Crippled (< 35% hp) and forced up within 60 of a hunter, the crew scuttles her.
- The AI sees the enemy only through `WW.intel` (below). A ship's target and its per-calibre gun targets are fresh contacts, and guns and torpedoes fire only while `WW.intel.visible` is true. A destroyer that loses a sub runs to its last-known position and gives it up there. With no fresh target, a ship goes to the nearest last-known contact; with none, it searches toward the enemy's half of the map (the half away from its own fleet), then sweeps north and south.

### intel.js

```js
WW.intel = {
  update(dt), clear(),                       // main.js step(); cleared on roundStart / setupStart
  contacts(nation) -> Contact[],             // every live contact of that side (shared array, do not modify)
  known(nation, unit) -> Contact | null,     // any age up to its expiry
  lastKnown(nation, unit) -> Contact | null, // the same object: read x, z, heading, speed, seenAt
  visible(nation, unit, maxAge = 3) -> bool, // a firing solution: seen within maxAge s by any ship, plane or scout of the side
  canSee(nation, unit) -> bool,              // visible() with the default age
  enemyShips(nation, { fresh }) -> Contact[],  // fresh: true (3 s) or a number of s; filtered result is a shared scratch array
  enemyPlanes(nation, { fresh }) -> Contact[], // default fresh: true
  centre(nation) -> { x, z } | null,         // centre of the ship contacts' last-known positions
  torpedoes(nation) -> Track[],              // enemy torpedo tracks seen within R.TORP = 45 of any own ship (shared array)
  age(contact) -> s, R, T, stats             // R: every detection range, T: timing (one table each, top of intel.js)
  typeOf(contact) -> type                    // the type the side believes: contact.reportedType (a misidentification) or unit.type
};
// Contact: { unit, x, z, heading, speed, seenAt, firstSeenAt, quality: 'visual' | 'radar' | 'sonar' | 'patrol' | 'scout' | 'air', by,
//            reportedType, misid, err, ex, ez }   (x, z include the report error ex, ez; err = its length)
// Track: { proj, x, z, h, speed, run, seenAt, firstSeenAt } - one object per running torpedo, dropped when it ends
```

- Every 0.5 s of sim time (both sides in one tick) each side looks for enemy ships and planes. Detection uses no random numbers.
- A ship sees an enemy ship at `R.SEEN[target type] × R.EYE[observer type]` (battleship or carrier 240, cruiser 210, destroyer 170, surfaced sub 70, PT boat 75; a destroyer's eye is 0.85, a PT boat's 0.55, a submerged sub's periscope 0.5). A ship that fired its guns in the last 6 s is seen at `R.FLASH[cal]` (big 400). Land more than 0.4 above the sea between two ships blocks the view (up to 10 samples of `WW.terrain.depthAt`, cached per pair per tick).
- Destroyer sonar finds a submerged sub within 65. Nothing else sees a submerged sub.
- Airborne planes see ships within 100, scouts within 120, with no line-of-sight test. A scout also sets `ship.spottedUntil` / `spottedBy` within 85 for `combat.js` `SPOT_DISP`.
- Ships see planes at `R.SEE_PLANE` (carrier 170, battleship and cruiser 130, destroyer 110). `R.SEE_PLANE_NATION` overrides it per nation (USN carrier radar 250, quality `'radar'` beyond the visual range). Planes see planes within 100.
- Patrol flying boats (`kind 'flyingboat'`) see ships within `R.PATROL` = 140, quality `'patrol'` (between sonar and scout).
- **Imperfect sighting reports** (`report()`): a sighting by an air observer (scout, carrier plane, patrol flying boat) carries a position error and may misidentify the type; a ship's own lookouts, radar and sonar are exact. Per report (a new observer, or the same one after a 6 s gap) the error is `range × doctrine.reportErr × (0.4..1.6)` in a random direction (`WW.rand`; carrier aircrews × 1.25: not trained observers), and it shrinks ×0.88 per tick while the same observer keeps reporting (the plot firms up). The type is rolled only on a first sighting (or one regained after 30 s): `doctrine.misId × (cruiser 1, destroyer 1, battleship 0.6, carrier 0.4) × clamp(range / 120, 0.3, 1.2)` beyond `R.CLOSE_ID` = 45 reports a cruiser or battleship as a carrier, a destroyer as a cruiser, a carrier as a battleship. A ship's visual sighting, or an air observer within 45, corrects it. The strike scorers (`fleet_cmd.js` strikes, `air_ops.js pickTarget`) value a contact by `typeOf`; gunnery fires on the real unit and still needs `visible()`. A strike on a bad report flies to the reported spot, and its leader redirects on arrival (`air_cag.js`) to what is really there, often the escort. Stats per round (`WW.intel.stats`): `reports`, `misid`, `resolved`, `errSum`, `wrongStrikes` (strikes launched on a misidentified or > 25 off contact, counted in air_patrol.js), `wrongRedirects`. Events: `report` `{ nation, unit, reportedType, misid, x, z, err, by }`, `misidResolved` `{ nation, unit, type, by }`.
- A contact keeps its last-seen position. It is dropped after 90 s (ships) or 10 s (planes) out of sight, or when the unit dies.
- Events: `contact` `{ nation, unit, first, by }` when an enemy ship is sighted for the first time this round (`first: true`) or again after 30 s out of sight; `firstSighting` `{ nation, unit }` once per side per enemy carrier or battleship.
- What uses it: `ships_ai.js` retarget, guns, torpedoes, idle search, sub hunt, `pickStrikeTarget` (contacts up to 45 s old) and the carrier's CAP scan; `aircraft.js` fighter scan and `validTarget`; `air_strikes.js` (a wave flies to the last-known position); `air_scouts.js` search area; `combat_aa.js` target choice. Hit tests, flak bursts, crash targets and dogfight tail checks stay omniscient. The camera is omniscient.


### AI framework: fleet_cmd.js, fleet_groups.js, ai_threat.js, ships_ai.js and the role files

The ship AI has three layers. Each layer reads only what its side knows (`WW.intel`); the physics stays omniscient.

1. **Commander** (`fleet_cmd.js`, tables in `fleet_groups.js`): one per side, ticked from `main.js step()` right after `WW.intel.update`, every `TICK = 2` s of sim time (USN and IJN staggered by 1 s). Each tick rebuilds the side's danger field and writes the side's blackboard.
2. **Danger field** (`ai_threat.js`): a coarse grid per side of the damage per second that the known enemy can deliver at each point.
3. **Ships** (`ships_ai.js` core plus the role files): every 1 to 1.5 s, a ship rescores its targets with the shared target score. Every step, the role file for its type sets `ship.desiredHeading` and `ship.throttle`, and the core then applies its overrides (cripple withdrawal, torpedo combing). `ships_nav` `planNav` still has the last word on land and collisions.

Every tick is wrapped in try/catch, so nothing throws into the sim. The doctrine roll is the only randomness, and it uses `WW.rand` at `roundStart` (after the fleets spawn), so a seeded round replays the same way.

#### WW.fleetCmd (fleet_cmd.js)

```js
WW.fleetCmd = {
  update(dt), reset(), TICK, VALUE, stats: { ticks, ms, steps },  // ms / steps = commander + threat cost per sim step
  side(nation) -> Blackboard | null,
  order(ship) -> Order | null,             // null before the side's first tick
  doctrine(nation) -> Doctrine,
  focusFor(ship) -> Ship[],                // the focus targets of the ship's group (0 to 2)
  incoming(nation, target) -> dps,         // expected fire the side already has on that target
  assignment(ship, target) -> factor,      // target-score factor: a carrier's `defend` enemy x2.5 for ships within 380 of
                                           // that carrier; saturated (overkill) x0.6; focus x1.35; else 1
  strikeOrder(carrier) -> { target, contact, score, hold } | null,  // the strike decision (air ops read it)
  scoutPoint(nation, x, z) -> { x, z } | null                       // best search sector for a scout near (x, z)
};
Blackboard = {
  nation, t,                               // t: sim time of the last tick
  posture,                                 // 'search' | 'approach' | 'engage' | 'withdraw' | 'press' | 'pursue'
  postureAt, late, timeLeft,               // late: past 55% of ROUND_TIMEOUT
  strength: { own, known, ratio },         // POWER x hp share; known = intel contacts, weighted down with age
  doctrine,                                // see below
  axis: { x, z, h },                       // main-body guide and heading of advance (toward enemyCentre, else searchPoint)
  enemyCentre: { x, z } | null,            // age-weighted centre of the enemy ship contacts
  searchPoint: { x, z },                   // the highest-priority scout sector near the main body
  groups: { main, carrier, screen, flotilla, pt, sub },   // each { members: Ship[], guide: { x, z } }
  orders: Map(ship.id -> Order),
  focus: { main, carrier, screen, flotilla, pt, sub },    // Ship[] (0 to 2) per group
  incoming: Map(target Ship -> dps),
  strikes: Map(carrier.id -> { target, contact, score, hold }),
  fit, hadFit, brokenAt,                   // fit: own BB / CA / DD at >= CRIP hp; brokenAt: sim time the side broke (below)
  startTons, fitTons,                      // BB / CA / DD tonnage at the first tick, and the fit share of it now
  foeSeen, foeTons, foeFit, pursueAt,      // every enemy gun ship seen this round (Map id -> Ship), their tonnage, the fit part
  airRaid: { carrier, n } | null,          // armed enemy bombers detected within 130 of an own carrier
  defend: [{ carrier, enemy, d }],         // per own carrier: nearest known enemy gun ship within 280 (seen in the last 30 s)
  sectors: [{ x, z, looked, stale, prio }] // 6 x 4 scout sectors
};
Order = { ship, group, role, slot, sx, sz, t };
// group: 'main' | 'carrier' | 'screen' | 'flotilla' | 'pt' | 'sub'
// role:  'line' | 'carrier' | 'escort' | 'asw' | 'torpedo' | 'ambush' | 'patrol' | 'withdraw'
// (sx, sz): the formation station. It is clamped 30 units inside the map; land is the nav layer's job.
```

- **Posture**: `withdraw` after 60 s once the side is *broken* (`brokenAt`: its fit battleship / cruiser / destroyer tonnage, hp ≥ `CRIP`, is below `BREAK` = 0.15 of its starting BB / CA / DD tonnage; never for a side that never had one), whatever the ratio says: its ships run for the home edge and leave the map (`ai_endgame.js`). `pursue` when the side is not broken and judges the enemy broken by the same rule on what it has seen (`foeBroken`: fit tonnage of every enemy gun ship seen this round, still afloat, below `BREAK` of all of them; or an enemy with no gun ships at all whose carrier is known: unescorted carriers are hunted), with a contact and past 60 s; once taken it is latched while the enemy still has a seen gun ship or a known carrier afloat, contacts or not. When both sides are broken, the side with the larger fit share (own true share against the enemy's seen share) pursues instead of withdrawing. While pursuing: stations lead +60, strikes reach the whole map (`PURSUE_STRIKE_R` 2000) on contacts up to 120 s old and favour targets no own gun ship is within 150 of (×2.5: the gun ships run down the cripples, the planes go for what they cannot catch), the strike interval is ×0.55 (air_ops.js), a broken side launches no new strikes, the scout sectors within 0.42 W of the enemy's home edge get +70 priority (its escape route) and each catapult ship flies one more scout sortie. Otherwise `search` while the side has no contacts. `withdraw` after 60 s if the known strength ratio is below `doctrine.withdrawRatio`. `press` late in the round if the ratio is at least `pressRatio × (1.15 − 0.3 × aggression)`. Otherwise `engage` when any known enemy is within 260 of an own ship, else `approach`. Carriers never press.
- **Groups** (`WW.fleetGroups.assign`):
  - carriers go to `carrier`, together with the first cruiser (when there are 2 or more) and the first destroyer as escorts;
  - battleships and the other cruisers go to `main`;
  - one destroyer goes to `screen` (ASW), then up to `doctrine.flotilla` destroyers to `flotilla`, and any extra destroyers back to `screen`;
  - PT boats go to `pt`, submarines to `sub`;
  - any ship (not a sub) below `WW.fleetGroups.CRIP = 0.35` hp gets role `withdraw`.
- **Stations** (`WW.fleetGroups.stations`) are offsets (forward, lateral) along `axis.h`:
  - main: line abreast at lateral 0, ±45, ±90, …, advanced by the posture lead (search / approach +45, press +35, engage 0, withdraw −45);
  - carriers: `cvStandoff` behind the main guide (the guide is the centroid of the main group's ships that are not withdrawing cripples), in the band `CV_LO`–`CV_HI` (0.2–0.33) of the width from the own edge, withdrawing or not (a broken side's carrier then has a long run home and a pursuer a window, user decision Oct 2026). Then `cvSafe` slides the station away from every known enemy gun ship (contacts ≤ 60 s) to 1.9 × its gun range + 20 (down to 0.06 of the width from the edge: safety first);
  - escorts: each carrier's ring (`fleet_formation.js`, below): the USN AA ring (`ringR` 35) on the threat axis, live and turning with the carrier; the IJN loose ring about 80 out along the axis;
  - screen: `screenAhead` ahead of the main body;
  - flotilla: on the flanks (lateral ±110);
  - PT boats: lateral ±150, never past the midline;
  - subs: 220 ahead, ±100 to the flank; with `doctrine.subLine` (IJN) a patrol line across the axis, 90 apart, 0.55 of the way to the enemy's known centre (160 to 320 ahead);
  - withdrawing ships: 70 behind their own carrier (or the main body).
- **Focus** (per gun group): the 1 or 2 best fresh targets from the group's guide, scored by group weight × `VALUE` × damage × proximity. `incoming` is rebuilt every tick from every own ship's `ship.target` (gun dps in range × 0.35). A target is saturated when its incoming fire kills it within 20 s; the shooter's own share is not counted.
- **Carrier defence**: each `defend` enemy is the carrier group's focus and scores ×3 as a strike target (self-defence first).
- **Strikes**: for each carrier, the best contact that is at most 45 s old and within 650 of it (with none there, anything known within 1150: the planes have the fuel). Surfaced subs are worth a strike (`STRIKE_V` 1). The score is value × damage × freshness, divided by distance and by the AA around the target (from the AA channel of the danger field). With no such contact there is no order. `hold` is set while that carrier is under an air raid. Pursuing: 120 s old contacts anywhere on the map, see Posture.

#### Long search (fleet_search.js, ticked right after the stations)

- `searchFor`: s since the side last had a contact up to 30 s old. `sweep` past 75 s (25 s for a `blind` side: PT boats and subs only). `heavySeen`: an enemy BB / CA / DD was seen this round. `ptDeep`: see PT boats.
- The enemy-half bonus of the scout sectors (60) fades out between 60 and 120 s of `searchFor`: the enemy may be anywhere, even behind.
- `barrier` (surface sides with a battle line, screen or flotilla, past 45 s of `searchFor`, not pursuing or withdrawing): the search point is a north-south barrier patrol 0.08 half-map short of the midline (two lone searchers sweeping each other's halves otherwise mirror each other and never meet).
- With no battle line, screen or flotilla, a carrier's extra escorts (all but the first) sweep to claimed search sectors during a sweep.
- A PT-only or sub-only side gets stations too (the guide falls back to the PT, then the sub centroid).

#### Doctrine (WW.fleetGroups.BASE, rolled ±10% per round)

| field | USN | IJN | used by |
|---|---|---|---|
| aggression | 0.5 | 0.65 | press threshold |
| rangeFrac | 0.84 | 0.78 | battleship / cruiser preferred range (× main battery range); USN 0.84: its battleships were sunk more often (42% vs 34% of those fielded, torpedoes and shells), see AI_DESIGN §4 |
| torpedo | 0.35 | 0.8 | launch distance (× torpedo range: 0.6 + 0.3 × torpedo) |
| carrier | 0.8 | 0.55 | strike tempo (interval × (1.25 − 0.5 × carrier)) |
| night | 0.2 | 0.8 | how much closer the side fights when it presses (`prefRange` × (0.72 + 0.15 × (1 − night))); after dark: closer range, longer torpedo reach, readier to press, star shell tempo (night_ops.js) |
| nightEye | 0.3 | 0.5 | visual range in full dark, × the day range (IJN night optics and lookouts) |
| radar | 1 | 0 | surface search radar on BB / CA / DD when > 0.5 (USN SG radar, late 1942) |
| searchlight | 0.15 | 0.8 | share of BB / CA / DD that light their targets at night |
| cvStandoff | 230 | 200 | carrier station behind the main body |
| screenAhead | 70 | 60 | ASW screen station |
| flotilla | 1 | 2 | destroyers in the torpedo flotilla |
| pressRatio / withdrawRatio | 1.2 / 0.45 | 1.1 / 0.4 | posture |
| risk (cv, bb, ca, dd, ss, pt) | 0, .55, .45, .45, .35, .2 | 0, .5, .55, .6, .4, .3 | `WW.threat.bestHeading` risk tolerance |
| jointStrike (not rolled) | false | true | the first deck loads of all carriers form up together (air_strikes.js) |
| followUp (not rolled) | 'squadron' | 'deckload' | later strikes: each squadron goes once up / the load goes once up (at most 10 s) |
| reserveFrac (not rolled) | 0.2 | 0.4 | bombers held back, armed for ships, until enemy carriers are found (air_ops.js) |
| rescue / scuttle (flags, not rolled) | true / false | false / true | endgame: USN destroyers pick up survivors and escort cripples home; IJN runs at best speed and may scuttle a cripple about to be caught |
| damageControl | 1.5 | 1 | divides torpedo flooding, engine-room repair time and the permanent share (ship_speed.js); fires put out × it, spread ÷ it², fuel / magazine chain ÷ it²; above 1.15 flooding is pumped out (to 40% of its peak) and a ship over 60% hp with no fire patches up to 5% of its hp; at or below 1.15 flooding creeps on (ship_fires.js) |
| avgas | 0.8 | 1 | chance factor that a bomb on a loaded flight deck sets off the fuel and ordnance (ship_fires.js) |
| reportErr / misId | 0.09 / 0.18 | 0.07 / 0.12 | air sighting reports (intel.js): position error per unit of range, misidentification chance; IJN observers the better trained early in the war, USN as in the Midway PBY / SBD reports |
| patrolStandoff / patrolShadowT / patrolEvery | 122 / 110 / 215 | 104 / 150 / 215 | patrol flying boats (air_patrol.js): standoff from the shadowed ship, s on station, mean s between patrols after the first |
| patrolBombs (not rolled) | 0 | 2 | a Mavis may bomb a lone ship once |
| escortCharge | 1 | 0.6 | escort charge trigger: an enemy gun ship within (0.6 + 0.6 × it) × its gun range of an own carrier, or (≥ 0.8) closing on it inside 300 (ai_charge.js) |
| ringR | 35 | 0 | carrier escorts' ring radius (0: the old loose ring ~80); `fleet_formation.js` |
| ringDD / ringBB (flag) | 2 / true | 1 / false | destroyers per carrier ring; a battleship joins the ring when the side has two or more |
| vanguard | 0 | 0.33 | search / approach / engage: the carriers hold this × map width behind the main body (the surface vanguard) |
| zigzag | 1 | 1 | zigzag plan scale under sub threat |
| subLine / subShadow / lifeguard (flags) | false / false / true | true / true / false | sub patrol line, shadowing, lifeguard duty (`ai_sub_roles.js`) |
| subCV / subNear | 1 / 25 | 2.2 / 40 | sub ambush weight of a carrier; time scale (s) of the reach discount (lower: nearer targets win) |
| aaAmmo / ddFuel / torpReloads | 1.25 / 1.1 / 0 | 1 / 1 / 1 | `ship_supply.js`: AA ammunition and destroyer fuel factors, reload sets for DD / CA tubes (not rolled) |

Torpedo performance per nation is a stat table, `WW.TORPEDO_NATION` in `core.js` (per launcher: `ship` = DD / CA tubes, `submarine`, `pt`, `air`): `rangeK` × the type's torpedo range, `speed`, `dud` (share of hits that do not go off, rolled with `WW.rand` at launch), `sight` (× intel `R.TORP`: how close a ship must be to see the wake). IJN Type 93 / 95: long, fast, nearly wakeless; USN Mk 13 / 14 / 15: slower, shorter, steam wakes, duds. `WW.shipType(type, nation)` merges the nation's torpedoes into the per-nation `ship.stats` that every ship carries, so everything that reads `ship.stats.torpedoes` (launch distances, the danger field, the subs' and PTs' leads) sees the nation's weapon.

#### Formation doctrine (fleet_formation.js, WW.formation)

- **AA ring** (`ringR` > 0, USN): `assign` gives each carrier its escorts (`ringCounts`: a battleship with `ringBB` and two or more, the cruiser when the side has two or more, then `ringDD` destroyers, at least one), spread over the carriers round robin, big ships first. `ringStations` puts slot 0 on the threat axis (the bearing of the enemy's centre, else the axis of advance) and the others at ±1.15, ±2.2 rad and astern, `ringR` out (at least the two hulls' spacing + 6). The station is live (`ringPoint`): `followStation` hands a ring escort to `ringKeep`, which closes it with a lead along the carrier's course and on it matches the carrier's course and speed, so the group turns into the wind together. A ring escort keeps its station whatever it is shooting at (`ai_surface.js ringHold`) while its carrier lives and the side is not pressing, pursuing or withdrawing. `ship.ringCv` lets it inside the carrier's personal space (`ships.js move`).
- **Vanguard** (`vanguard` > 0, IJN): in search / approach / engage the carriers hold `max(cvStandoff, vanguard × MAP_W)` behind the main body, may hang back to 0.08 of the width from their own edge, and the line's lead grows by 35 in search / approach.
- **Zigzag**: with an enemy sub contact (≤ 75 s old) within 300 of the main body, the carrier group or the screen, or a sub's torpedo track seen or a sub's torpedo hit in the last 75 s, `B.zig` follows a shared plan (`ZIG` offsets, `LEG` 22 s each, from the sim clock) × `zigzag`. Not while pressing or pursuing. `followStation` adds it to the course; carriers on passage too (`ai_carrier.js`). Ring escorts follow their carrier.

#### Submarine doctrine (ai_sub_roles.js, WW.subRoles)

`ai_light.js ambush` multiplies a carrier contact by `subCV` and discounts the time to get ahead of a target by `subNear`. With `subShadow` (IJN) a contact the boat cannot get ahead of is shadowed from 110 off its quarter (intel shares the sighting). With `lifeguard` (USN), a boat at ≥ 50% hp with no destroyer within 160, no aircraft and no gun ship within 130, and no target within 200, claims an open survivor or aircrew pickup of its own side from the endgame task list (`WW.endgame.tasks()`, or `WW.rescue.tasks()` when that exists) that destroyers have left for 6 s, within 380 and in safe water (danger ≤ 8). It runs there surfaced, stops alongside and `endgame.js pickup` counts the rescue; lifeboats row to her. It gives the task up when a threat comes near.

#### Ammunition and fuel (ship_supply.js, WW.supply)

`ship.sup` per ship (lazy): main-battery turret shots (BB 80, CA 150, DD 200, CV 400), AA battery-seconds (CV 260, BB / CA 230, DD 170; × `aaAmmo`; a heavy salvo uses 1.1, a light tick 0.25), torpedo loads (DD / CA 1 + `torpReloads`, sub 7, PT 2), destroyer fuel (380 full-speed seconds × `ddFuel`, burning (speed / top)³ a second). Below 20%: the main battery holds fire past 0.8 × range, AA is × 0.6 and shows fewer tracers, a destroyer is held to 0.6 throttle; empty: silent / tubes empty (`torpReload` = ∞); fuel below 8%: 0.45 throttle. A ship with no fuel or nothing left to fight with is `spent`: role `withdraw`, and the surface role drops its target (its guns still answer). Hooks: `Ship.move` (fuel), `ships_ai.js guns` (`shell`), `fireSpread` (`torpFired`), `combat_aa.js` (`aa`). A normal battle rarely runs anything dry; long duels and pursuits feel it.

#### Doctrine metrics (WW.docStats)

`WW.dstat(key, nation, v)` (core.js) adds to per-round counters, reset on `roundStart`: torpedoes fired / hit / dud per launcher (`torpFiredShip`, `torpHitAir`, ...), first-sighting and combing distances (`torpSeenD/N`, `combD/N`), `zigT`, `subShadowT`, `subPatrolT`, `lifeguardClaim/Pick/T`, and the supply events (`supMainLow`, `supAAOut`, `supTorpOut`, `supFuelLow`, ...). Sim code only writes them; `tests/doctrine.js` reads them.

After the roll, the admiral of the round (`admirals.js`) changes the doctrine by his personality (multipliers and modes; see "Admirals" below) and adds `strikeRange` (× `STRIKE_R`) and `admiral` (his key).

#### WW.threat (ai_threat.js)

```js
WW.threat = {
  CELL: 20, DREF: 20, stats: { builds, ms, lookups },
  build(nation),                                   // fleet_cmd tick: rebuild nation's field from its contacts
  danger(nation, x, z, { air }) -> dps,            // bilinear; air: the AA channel (plane routing)
  bestHeading(ship, want, risk, { look, k, air }) -> heading,
  away(nation, x, z, { air }) -> heading | null,   // downhill direction of the field
  edge(x, z) -> 0..1.5,                            // map-edge penalty used by bestHeading
  field(nation) -> { surf, air, max, airMax, t, n, nx, nz, cell }  // raw grids (Float32Array, row-major by z)
};
```

- The grid is 49 × 31 nodes (20-unit cells over the 960 × 600 map), with a surface channel and an AA channel.
- Each enemy contact adds the following, scaled by its age weight (1 while fresh, falling to 0.3 at 90 s) and by `0.5 + 0.5 × hp share`:
  - every gun: `SHELL.dmg × count / reload × 0.5` inside its range, ×1.3 at point blank, tapering to 0 over 25 units outside it;
  - torpedoes: `TORPEDO.dmg × count / reload × 0.3` out to 0.85 × torpedo range, weighted toward the contact's bow arc (subs included);
  - the AA channel: `aa.dps` out to `aa.range × 1.55`.
  A stale contact is moved along its last course for up to 20 s, and its reach grows by `age × speed × 0.5` (at most 40).
- `bestHeading` samples 16 headings around `want`, looking `look` ahead (default speed × 9, 30 to 70) and half way. Each heading scores `cos(offset) − danger / DREF × k × (1 − risk) − edge − 0.15 × turn`. The result goes into `ship.desiredHeading`; `planNav` still steers around land.
- Overlay (`ai_threat_view.js`, `WW.threatView.toggle()`; key **G** only when the plot table is not loaded: the plot's danger layer, key X, replaces it): visual only and off by default. G cycles off → USN picture → IJN picture. It tints the sea red where the guns and torpedoes reach and blue under the AA umbrella. It shows a ring at each enemy contact's last-known position: coloured while fresh, grey and fading with age. A label shows the side's posture. Use it with the map camera (C) to see each side's contact picture.

### aircraft.js

```js
WW.air = { init(), update(dt), clearAll(), launch(carrier, kind, target) -> Plane | null };
// Plane: kind, nation, carrier, x, y, z, heading, hp, alive, state, group, damage(amount)
```

Planes take off from the carrier deck, fly to the target and attack. Dive bombers dive and drop bombs. Torpedo bombers fly low and drop torpedoes. Fighters escort the bombers and fight enemy planes. Planes that survive fly back, land and rearm in 10 s. If the carrier sinks, its planes in the air ditch. A damaged plane trails smoke (grey below 50% hp, charcoal below 30% hp). A bomber with less than 35% hp drops its weapon and flies home. `Plane.fighter` hands over to `WW.airOps.fighter`, bombers call `WW.airOps.bomber` every step, and `validTarget` retargets through `WW.cag.retarget`; the old code stays as the fallback.

### Air command: air_squadrons.js, air_ops.js, air_cag.js, air_captions.js

The air side has a command structure: squadrons and elements, an air boss and fighter director per carrier, and a strike leader (CAG) per strike. All of it is sim code (`WW.rand` only, names from slots, element ids restart each round), except `air_captions.js`, which is visual only.

```js
WW.squadrons = { group(carrier) -> { name, sq: { fighter, dive, torpedo } }, squadronOf(carrier, kind), follow(plane, dt) -> bool,
                 rank(plane) -> 'Lt. Cmdr. Thach', elements() -> Element[], stats, SIZE };
// Squadron: { kind, nation, name ('VF-6' | 'Akagi fighter unit'), short, cvName, leader (pilot), sorties, lost }
// Element:  { id, key, kind, nation, sq, size, members: [leader, wingmen...], div (USN: the section it pairs with) }
// Plane:    squadron, element, leader (null for the element leader), wing (0 = leader), cover ('close' | 'top', escorts)
WW.airOps = { plan(carrier, dt), fighter(plane, dt), bomber(plane, dt), pickTarget(from, { near }), capWanted(carrier),
              picture(carrier), underAttack(carrier), CAP_R: 35, LEASH: 52.5, LEASH2: 157.5, RAID_R: 120, stats };
WW.cag = { waveTick(wave), detour(wave, heading, target), retarget(plane), diveOK(plane, target, grp), vtWait(plane, target, grp),
           escortPick(plane), escort(plane, target, dt), cover(plane), stats };
WW.airCaptions = { lineFor(subject), tick(), stats };
```

- **Squadrons** (`air_squadrons.js`): each carrier slot (the n-th carrier of a nation, like the aces rosters) has a name (USN Enterprise, Yorktown, Hornet, ...; IJN Akagi, Kaga, Soryu, ...) and one fighter, dive bomber and torpedo squadron (USN VF-6 / VB-6 / VT-6; IJN "Akagi fighter unit", "dive-bomber unit", "attack unit"). They carry over between rounds; `WW.aces.reset()` resets them too. A launched plane joins its squadron and an element of its mission (CAP or strike) for 30 s: USN fighters fly 2-plane sections paired into 4-plane divisions, IJN fighters 3-plane shotai, bombers 3-plane vics. `follow()` keeps a wingman on its slot off the leader (CAP and transit); in a fight the wingman covers the leader. A lost leader or a leader going home: the next plane leads ('reform'); a lone survivor joins another element of the mission ('rejoin'). Pilots belong to their squadron (`pilot.squadron`); the squadron leader is its senior pilot in the air. `air_dogfight.js`: the Thach weave turns toward the plane's own section first (nearest friendly as the fallback), and a fighter answers an enemy on its leader's or wingman's tail.
- **Air boss** (`airOps.plan`, called from `ai_carrier.js` airOps): keeps `capWanted` fighters on CAP (a standing element: USN 2, IJN 3; 4 when enemy planes are detected inside 250, so USN radar scrambles earlier than IJN lookouts) and launches a relief when an on-station fighter has less than 45 s of fuel. CAP launches go first. A strike needs a known target (`WW.fleetCmd.strikeOrder`, else intel scored by value, damage, freshness, distance and AA); it is not queued or launched while the carrier is under air attack (an armed enemy bomber within 120; at most 30 s), and its planes wait while the deck recovers or 3 launches are queued (at most 25 s). Escorts are the fighters left after one CAP relief (at most 4). When the carrier is under air attack, its escorts within 320 that have the fuel recall to defend it (`plane.recall`). `air_deck.js`: a CAP launch waits at most 6 s for a recovery (20 s for a strike), and the carrier does not turn into the wind within 80 of the map edge.
- **Fighter director** (`airOps.fighter`): CAP orbits 35 over its carrier, shifted 15 toward the nearest detected raid and higher while one is up. Target priority: a torpedo bomber on its run (or anvil) > a dive bomber in the wheel or dive > other armed bombers > fighters attacking own planes > other fighters, nearer first. Leash: CAP engages only within 52.5 (1.5 × radius) of its carrier, or out to 157.5 an armed bomber inbound (closing on the carrier, or attacking one of our ships), or out to 118 a bomber below half hp (finish it as it turns for home); beyond that it lets go, except to defend itself (`dogfight.pick`'s tail check). Relieved CAP goes home under 27 s of fuel.
- **Gun passes on bombers** (`air_intercept.js`, `WW.intercept.attack`, called by `air_dogfight.js` offence for any foe that is not a fighter): a turning fight loses to a dive bomber circling in the wheel, so the fighter flies passes: set up above and outside the bomber's track (ahead along the wheel's arc; behind and above a torpedo bomber), dive onto it with the gun lead predicted along its arc (`predict(f, t)`), throttle back inside ~30 to stay on the gun line, a short burst, break away and extend 1.6 s, set up again. A dive bomber in its dive is chased down the dive line. The pass holds the foe (`df.lock`). Fighter hits on a bomber do `BOMBER_K = 5` × the normal damage (a big, steady, lightly protected target).
- **Bombers** (`airOps.bomber`): below 35% hp, or with a fighter on the tail for 3 s while below 55% hp and no friendly fighter within 45, the bomber jettisons and goes home (deterministic).
- **CAG** (`air_cag.js`, hooks in `air_strikes.js`): the senior armed bomber of a wave leads it (the squadron leader, else a VB element leader); if it is lost the next takes over ('cag'). It steers the wave guide round the detected AA umbrella while more than 120 from the target (`WW.threat.danger(..., { air: true })`, else known ships' `aa`), and within 140 of the target, if the target is gone or not seen in the last 4 s, redirects the whole strike to the best visible target within 170 (cripples preferred, 'redirect'). Timing: dive bombers hold in the wheel until the torpedo bombers turn in (at most 20 s), torpedo bombers wait at the anvil for the dive bombers to reach the wheel (at most 15 s), so the attacks land within a few seconds of each other.
- **Escorts**: the wave's first fighter element is close cover (just above and behind the bombers; engages fighters attacking them), the next is top cover (higher and ahead; engages fighters approaching the strike). Any escort breaks off for a fighter on a bomber's tail. Over the target they circle the bombers (close) or the target (top); then they ride home over the returning bombers.
- **Search** (`air_search.js`, `WW.search`, one system for scout floatplanes and carrier search flights):
  - claims: `claim(nation, who, x, z)` hands a searcher one of the commander's scout sectors that no other searcher of the side holds (prio - dist / 6 + a fan bonus up to 40 for a bearing from the fleet guide 0.6 rad clear of the other claims). `release(who)`; claims end on their own when the searcher heads home, lands or is lost. `legs(plane)`: out to the claimed sector, on along the same bearing (to 760 from the fleet), a dogleg of 0.3 rad back. `air_patrol.js` (flying boats) uses the same claims.
  - carrier search flights (`plan`, from the air boss): from 30 s, while the side has no fresh contact (posture `search`, or none for 45 s) and no strike order, a carrier queues an unarmed searcher every 6 s while it has fewer than 2 out and the side fewer than 3 (scout floatplanes included): a dive bomber, else a torpedo bomber, else a fighter if it has more than 3. The searcher leaves its CAP element and flies the legs at 30, turning home when its fuel just covers the way back + 25 s. When the search finds something, the carrier's strike timer drops to 4 s.
  - shadow: a searcher with a fresh contact within 200 holds a standoff ring round it (scout 80: inside its 85 gun-spotting range, outside ships' AA; others 90), on the ring point with the least risk (the AA channel of the danger field, a 150 circle round known enemy carriers for their CAP, detected fighters), for at most 70 s (scout) / 55 s, then goes home.
  - break away: a detected enemy fighter within 85 closing (or on its tail), or 15% hp lost: dive to 8, turn away (leaning home) for 6 s, then home.
  - home: `homeHeading` samples 9 headings round the straight line and takes the one with the least risk 40 and 90 ahead, low while risk or fighters are near; the scout's approach and alighting take over within 90 of its ship, the carrier's landing pattern within 120.
  - stats (`WW.search.stats`): sorties, shadows, breaks, `lost` by phase (`out`, `station`, `home`), `searched[nation]` (sector indices swept within 60).
- **Strafing** (`air_strafe.js`): small craft (PT boats, surfaced subs, destroyers below half hp). A strike's escorts strafe its small-craft target once within 150 of it; up to 2 CAP fighters per carrier strafe a fresh small-craft contact within 170 of it while no enemy plane is in the director's picture (`plane.target` is set to the boat for the pass, so the CAP accounting relieves them). Passes: set up 70 out at 20, run in low, bursts every 0.35 s inside 42 with the nose on (hit 55%, 6 x the plane's gun factor through `takeDamage(kind 'strafe', cal 'mg')`), break past and extend 2.5 s, set up from a new bearing.
- **Strike form-up by doctrine** (`air_strikes.js`): a carrier's first strike (its first deck load) forms up over it (`group`); IJN `jointStrike`: every first deck load forming at the time waits for the others (20 s extra at most), they leave together and the others fly on the lead carrier's wave (35+ abeam, 20 behind) until 160 from the target. Later strikes: `deckload` (IJN: leaves once all are up, or 10 s after the first) or `squadron` (USN: one wave per bomber squadron, escorts with the torpedo squadron, each leaving as soon as its first plane is up; stragglers catch up at 1.25 x the guide speed). Form-up circling costs fuel. Event `waveGo { carrier, nation, first, mode, formT, reserve, target }`; `WW.strike.stats.forms`. The CAG's VT / VB waits stay capped (20 s / 15 s).
- **Reserve strike** (`air_ops.js`, doctrine `reserveFrac`): while no enemy carrier is known, a strike on anything else leaves that share of the dive and torpedo bombers in the hangar. A carrier sighted (the strike order's target is a carrier, or a carrier contact up to 90 s old) launches it at once (the strike timer drops to 1 s). Held 110 s with no carrier found, it is rearmed for the targets at hand: 20 s in `carrier.rearm` (the deck load `ship_fires.js` reads: a bomb then is costly), then it goes with the next strike. `WW.airOps.reserve`: held, launches (carrier found), rearmed, targets by type.
- **Events**: `airOrder` `{ carrier, squadron, order, plane, leader, target, squadrons, raid }`, order one of `launch`, `cap`, `scramble`, `relief`, `recall`, `jettison`, `reform`, `rejoin`, `strikeAway`, `cag`, `attack`, `redirect`.
- **Captions** (`air_captions.js`, visual only): it wraps `WW.cam.update` and, every 0.25 s of real time, looks at the director's shot (`WW.cam._shot()`: its subject, or the diving plane of an orbit). If that subject has a squadron moment it shows a small caption (`WW.ui.caption(main, sub, 4.5, true)`): "VT-6 begins its run", "VB-6 pushes over", "Lt. Cmdr. X leads VB-6 in", "Strike away: VF-6, VB-6, VT-6", "CAP vectored to raid" with a compass bearing and distance, an ace's kill. At most one air caption every 15 s of real time, none in free camera, map view, or while another caption (the victory card) shows. It adds camera candidates for the CAG leading a strike in and a CAP element in formation (`WW.camHooks`).
- Tests: `tests/sim_behaviour.js` (cap_bkills: CAP gun kills on bombers per round, cap_on_bmb, cap_gap, esc_with, elem_coh, air_sync, bomb_lost, jettisons), `tests/air_probe.js` (one carrier round's air picture), `tests/air_shots.js` (screenshots, `tests/shots/air_*.png`).

### air_aces.js

Each carrier plane gets a pilot (`plane.pilot = { name, kills, sorties, ace }`) from its carrier's roster. A pilot who lands goes back to the roster and flies again. A pilot who is shot down or ditches is lost. A roster belongs to a carrier slot (the n-th carrier of a nation), so surviving pilots carry over into the next round. When a plane is shot down, the kill goes to the pilot of `victim.killedBy`. If `killedBy` is missing, it goes to an enemy plane whose `foe` is the victim. An AA kill (`killedBy` is a ship) gives no pilot credit. At 5 kills the pilot becomes an ace: `plane.ace = true`, `plane.kills`, `plane.skill`, +5% speed, +15% hp, and small pooled kill marks on both fuselage sides. The module emits the `ace` event. It wraps `WW.air.update`, `WW.air.clearAll`, `Plane.prototype.shotDown` and `Plane.prototype.ditch`. `WW.aces.infoText()` adds the ace count to the UI info line.

### air_scouts.js, models_scout.js

Each cruiser and battleship has one floatplane on its catapult (USN: Kingfisher-style monoplane, IJN: Pete-style biplane, both with one centre float and two wing floats). 5 to 25 s into a round, the catapult trains outboard and fires. The plane on the catapult model (`ship.model.floatplane`, from models_detail.js) is hidden while the scout flies. The scout is a `WW.Scout` (a `WW.Plane` with kind `'scout'`, `WW.PLANE_TYPES.scout`) in `WW.world.planes`, so fighters, AA and the camera see it. Its states are `catapult`, `transit` (search), `return`, `alight` and `afloat`. Other states, such as `falling` and `ditch`, use the Plane code. It flies a search arc 90 units from the centre of the enemy contacts (`WW.intel.centre`) on the near side, or around the middle of the enemy's half of the map when nothing is known. `intel.js` does its spotting: it reports contacts and sets `ship.spottedUntil = now + 20` (and `ship.spottedBy`) on enemy ships within 85 units. In `combat.fireShell`, the dispersion of a shot at a spotted target farther than 60 units is multiplied by `SPOT_DISP = 0.85`. After 130 s (the first approximately 35 s are the flight out on the big map), or below 50% hp, the scout flies home, alights beside its ship, taxis alongside for approximately 3.5 s and is taken back aboard. There are at most 2 sorties per ship, with 50 s between them.

`camera.js` `candidates()` calls each function in `WW.camHooks` (`fn(add, dur)`). The aces module adds aces in dogfights. The scouts module adds catapult launches and alightings.

`air_deaths.js` decides how a plane dies. `Plane.shotDown()`, `ditch()` and the crippled branch of `damage()` call `WW.airDeaths`; a plane with `deathMode` set is updated by `WW.airDeaths.updatePlane`. Modes: `spin`, `wing` (hides `model.wingL` or `wingR` and drops a pooled copy), `comet`, `crash` (rarely dives into a nearby enemy ship: `ship.takeDamage(.., 'bomb')`), `ditch` then `ditched` (floats tail-up 20 to 30 s with a raft, then sinks), `abandon` (crew bails out of a crippled plane) and `slide` (`WW.airDeaths.slideOff(plane, side)` tips a plane off a carrier deck). Some falling planes drop a parachute that drifts with `WW.wind` and leaves a raft. The mode choice uses `WW.rand`; `plane.killedBy === 'aa'` favours comets. `restore(model)` (from `release`) shows both wings again. `WW.airDeaths.force(mode)` forces a death for tests (`tests/deaths.js`).

### air_flyingboats.js, air_patrol.js, models_flyingboats.js

Long-range flying boats come in from off the map: USN PBY Catalina, IJN H6K Mavis (`models_flyingboats.js`: boat hull, parasol wing on a pylon with struts, the PBY's two engines, waist blisters and wingtip floats that swing out to form the wing tips in flight, the H6K's four engines, twin fins and fixed floats; baked once per nation with the `models_planes.js` lofting kit; flight scale `SCALE` 1.7, span ~11 / 13 units, ~2.5 × a carrier plane). A `WW.FlyingBoat` is a `WW.Plane` (kind `'flyingboat'`, `WW.PLANE_TYPES.flyingboat` hp 34, speed 22) in `WW.world.planes`, so fighters, AA and the camera see it. It has no carrier: `carrier` is a fixed base object 34 units beyond its side's edge (USN west, IJN east), where it comes from and where it is removed (`stats.home`). Sim code, `WW.rand` only; wake, spray, floats and props are visual (`Math.random`).

- **Dumbo rescue** (USN, `doctrine.rescue`): uses the endgame.js survivor tasks (`WW.endgame.tasks()`: `{ id, nation, x, z, n, kind: 'ship' | 'pilot', t0, by, air, done }`, at the sim position of the sinking / ditching). `openTask()` takes a task with no destroyer (`by`) and no Catalina, aircrew after 5 s, a ship's survivors after 30 s with no destroyer sent; it sets `task.air = plane`, which endgame.js `assign()` honours (no destroyer, no expiry while the plane lives) and the Catalina finishes with `WW.endgame.complete(task, plane)` (endgame stats, `rescue` event with `air`). At most 2 USN flying boats up at once and 4 Catalinas a round; a 6-16 s call delay. States: `inbound` (low, 18) → `circle` (34 around the survivors) → `alight` (into the wind, a glide path flared onto the water short of the survivors, wave-off if it turns unsafe) → `afloat` (taxi to them, stop, 9 s for aircrew / 16 s for a ship's survivors) → `liftoff` (into clear water) → the next open task within 220, else `return`. It lands only where the known enemy guns and AA do not reach (`WW.threat.danger` surface ≤ 10, AA ≤ 3) and no detected enemy fighter is within 150, unless an own fighter is within 70 (escort); otherwise it waits 90 toward home, for 80 s at most. On the water it takes off at once if a fighter comes within 110 or the guns come into reach. Hit below 50% hp: it gives up the task and goes home. Visual: lifeboats.js boats and air_props.js rafts within reach row / paddle to a Catalina on the water (`landedNear`), climb aboard (`boarded`), and a raft is kept afloat while a Catalina is coming (`awaiting`); if the aircrew's raft has drifted away, one is shown beside it.
- **Patrols** (`air_patrol.js`, both nations): the first at 15-45 s, then one every `doctrine.patrolEvery` × (0.8..1.2) s after the last one is gone, at most 3 a round, one up per side (two USN flying boats in all), none in the last 90 s or once the side is broken. A search leg from `WW.search.legs` (air_search.js sector claims; else the likely enemy area and `fleetCmd.scoutPoint`), steering round the known AA (`WW.threat` air channel), for 155 s. When it sees an enemy ship itself it **shadows**: on the side toward its home, `doctrine.patrolStandoff` out (pushed out past the AA umbrella), swinging slowly across, upgrading to a bigger ship in sight, for `doctrine.patrolShadowT` s, keeping the contact fresh for its fleet. A fighter on it or a detected fighter within 75: `evade` (low, toward home) until 14 s calm, then back on station (or home if hurt). A Mavis (`patrolBombs` 2) may make one level-bombing pass on a lone ship (no other enemy ship within 90, light AA, no fighters; 55% bomb weight; `WW.combat.dropBomb`). The way home uses `WW.search.homeHeading`.
- CAP (`air_ops.js`): a flying boat does not count in the raid picture (no scramble), but `capPick` hunts it (priority 200) out to the long leash (`LEASH2`, as for an inbound raid) while no armed enemy bomber is in its raid picture.
- Stats (`WW.flyingBoats.stats`, per round): `dispatched`, `landed`, `rescues`, `survivors`, `pilots`, `catLost`, `aborted`, `waited`, and per nation `patrols`, `sightings` (ships reported per boat), `lost`, `home`, `bombs`, `bombHits`, `shadowT`, `evades`. Event `flyingBoat` `{ plane, nation, order: 'dispatch' | 'patrol' | 'shadow' | 'evade' | 'bomb' | 'landed' | 'rescued' | 'abort' | 'home' | 'lost', x, z, unit }`.
- Camera (visual): `air_captions.js` adds director candidates (a Catalina landing / on the water, a shadower, a fighter attacking a flying boat) and captions ("Dumbo inbound", "Dumbo on the water", "Mavis shadowing the fleet", "Mavis hunted by fighters", "VF-6 jump the Mavis"); `camera_story.js` arcs `dumbo` (9 landing, 7.5 inbound) and `snooper` (6.5 shadowing, 8.5 hunted or bombing), a `rescue` phase (side / chase / high).
- A/B switches for balance diagnosis (page URL; with the tests: `Q=nopatrol node tests/sim_behaviour.js ...`, `tests/headless.js` appends `$Q`): `nopatrol` (no patrol flying boats), `nodumbo` (no Catalina rescues), `norep` (exact air sighting reports). Seeds 1-100 balance gate at merge time: all on USN 60 / IJN 39; nopatrol 53 / 47; nodumbo 59 / 40; norep 54 / 46; the branch without any of it (origin/endgame) 50 / 50; the merged deploy candidate (endgame + oddfleets + flyingboats, CAP snooper hunt on the long leash) 59 / 41. Not tuned here (balance is tuned once after the merges).
- Tests: `tests/flyingboats_probe.js [rounds] [seed0]` (per-round rescue, patrol and report numbers; `--log`, `--trace`), `tests/flyingboats_view.js [--live --seed N]` (render: 4 views of each model, then a Catalina on the water, a Mavis shadowing, CAP on a flying boat; `tests/shots/fb_*.png`); the suite's info line (`fb_rescues`, `fb_survivors`, `cat_lost`, `pat_sight_*`, `pat_lost_*`, `misid`, `bad_strikes`, `bad_redirects`).

### camera.js, freecam.js, camera_story.js, camera_finder.js, camera_follow.js

- `WW.cam` (director): it selects a live subject (a sinking, a torpedo or dive-bomb attack, a carrier launch, a dogfight, a burning ship or a battleship that fires). It films the subject for 12 to 25 s with a slow orbit, chase, fly-by or wide shot, then cross-fades in 1.4 s. Every second shot is a wide shot. A wide shot or diorama orbit looks at the front line when the nearest enemy ships are less than 280 units apart, and otherwise at one fleet on its approach. The opening shot of a round shows one fleet side-on. The subject stays in the middle third of the frame. The camera stays more than 7 units from a hull and above the terrain. Setup mode and map view (`C`) use a high overview.
- `WW.camAction` (`camera_action.js`) adds action shots to the director. When the director films a dive-bomb attack and the bomb falls, the camera follows the bomb to the impact and holds on the explosion. When it films a torpedo run and the plane drops its torpedo, the camera follows the wake to the hit or the miss. These hand-offs do not cut. They change the current shot. A fighter with a foe can get an over-the-shoulder shot: behind and above the fighter, its foe ahead, with a slow, rate-limited turn. Planes with `kills` or `ace` (if present) get a higher priority. `combat_weapons.js` sends the events `weaponDropped` `{ kind: 'bomb' | 'torpedo', proj, plane, target }` and `weaponImpact` `{ kind, proj, x, z, ship }` (`ship` is null for a miss). Test hook: `WW.cam.film(candidate)`; `tests/action_cam.js` records each action shot.
- `WW.freecam`: left-drag orbits, the wheel zooms (a trackpad pinch is a wheel event with `ctrlKey`), right-drag and `W` `A` `S` `D` pan (panning lets go of a followed subject), `Q` and `E` turn, `R` / `V` (or `Page Up` / `Page Down`) raise and lower. A click on a plane starts a story on it (`WW.camStory.follow`) and gives the camera back to the director.
  - Relative follow: a click on a ship (`'click'`), any input while the director films a ship or plane (`'inherit'`: the subject of `WW.cam._shot()`, so a story shot keeps its leader), or `WW.freecam.follow(o)` follows a subject. The orbit yaw, pitch and distance are then an offset in the subject's frame, measured from where the camera is (no jump): heading-relative by default (world yaw = `base(hS) + yaw`, `base(h)` puts the camera astern; `hS` is the subject heading eased at 1.5/s), or world-fixed (`toggleRel()`, key `O`, converts without a jump). The look point follows the subject tightly once settled (rate ramps 3 → 12/s over 1.5 s); an inherited distance glides in to a chase distance (≤ 48 units for a plane); a plane allows a pitch down to −0.3 (camera below it), the distance down to 12. A falling plane is followed until it is removed. `soft()` eases camera.js's manual rates for 1.2 s after a take-over.
  - Hand-back: after `FOLLOW_IDLE` 10 s without input for an inherited subject, `CLICK_IDLE` 25 s after a click, `IDLE` 20 s otherwise, or `release()` (F, Esc twice). While the user follows a story's leader or a member of its group, the story pauses (it is not ended) and resumes at the director's next pick; if the leader goes down meanwhile the story hands on to the successor after the fall (`retarget()`).
- `WW.camFinder` (`camera_finder.js`): `list()` ranks what is about to happen (cached 0.5 s of real time or 0.5 sim s): `strike` (a wave closing on its target: eta = (distance − 60) / 20 sim s, +15 s while forming), `push` (a dive leader in the wheel over the target, or diving), `anvil` (a torpedo leader on the anvil / run: eta = (distance − 55) / speed), `bandits` (a fighter closing on bombers), `torps` (torpedoes in the water whose track crosses a hull, from `WW.combat._i.active`: eta = distance / torpedo speed), `danger` (a ship burning, flooding, sinking, or latched for 20 s after a `magazine` / `deckHit` event; feature-detected). Each item: `{ kind, subj, target, eta, etaReal, drama, score, label }`; `score = drama × window(etaReal)`, highest for 10 to 30 s of real time ahead. `etaReal` uses the measured sim rate (`ΔWW.time.now / Δwall`, so time scale and slow motion count). `upcoming(kinds)` sorts by eta; `about(o)` finds the item of a subject (or its wave); `etaText()` gives "~25 s".
- `WW.camFollow` (`camera_follow.js`): key `F` (`f()`): while the user follows something (their story, a free-camera subject, a ship they jumped to) it hands back to the director; otherwise it jumps to the finder's best item (a plane: a user story on it; a ship: a user orbit on it, `film({ user: true })`), else the best current action (an arc, or the ship in the closest gunfight), else the front line. Keys `Tab` / `Shift+Tab` (`cycle(±1)`) step through `upcoming()` attacks; `8` the current dogfights, `9` ships in danger. A small label (`#follow-label`, bottom left, outside the HUD) shows "Following VT-6 · Lt. Cmdr. … · VT-6 strike reaches the carrier in ~25 s", or the free-camera hints. It also adds the finder's items 0 to 35 s ahead to the director's candidates (`WW.camHooks`).
- F, root causes of "ineffective" (fixed): F ended any running story, also an automatic one the user did not know about, or one still waiting for the director's shot to end (nothing changed on screen, "Follow: off"); F picked the best *arc*, often a strike still forming over its carrier or a CAP circle; the first story shot was often a wide shot behind a 1.4 s cross-fade; touching the camera ended the story; and an F-off muted automatic stories for 2 to 4 min. Now F never ends an automatic story, jumps to an imminent attack, opens a user story with a hard cut to a chase of the subject, and the label confirms it.
- `WW.camStory` (`camera_story.js`, story mode): every 2 to 4 min (never back-to-back: 120 to 220 s of normal director shots between stories, the first one 30 to 60 s into a round), when a good arc is available, the director picks a protagonist and follows its mission for 1 to 3 min of real time. Imminent attacks come first: a finder item 8 to 45 s (real) ahead with a plane subject scores 10 + drama (×1.5 to 1.6 for strike / push / anvil, ×0.8 for fighters closing), may start 40 s after the last story ended, and cuts into the director's current shot once it is 4 s old (never an action stage or a test / user `film()` shot, `pr >= 99`). An automatic story more than 20 s old, not in its attack, gives way to a better imminent attack elsewhere (its own item's value + 4, or > 12 when its leader has none), so a CAP circle cannot hide a strike. A user story (F, Tab, a click) opens with a hard cut to a chase of the subject. Arcs (`bestArc()`): a strike wave (its CAG, or the leader of its torpedo or dive element; 9 while it forms up, 7 in transit, 4 near the target), a CAP fighter leader within 40 sim s of a `scramble` order from its carrier (8) or engaging bombers (6), an airborne ace (5); an arc needs 7, and the squadron of the last story gets −3. An automatic story starts when the director's current shot ends (it never cuts an action shot); the `F` key and a free-camera click start one at once.
  - Integration in `camera.js` (small hooks): `pickShot()` asks `WW.camStory.pick()` first; `shotGoal()` asks `WW.storyShots.goal()` after `WW.camAction.goal()` (so a bomb or torpedo hand-off still takes over a story shot); a story shot (`shot.story`) is not dropped when its subject dies; `c.hard` makes a hard cut (no cross-fade); `WW.cam.cut()` drops the current shot so the next update picks again.
  - Phases come from the leader each frame: `launch` (state takeoff), `form` (`sk === 'form'`, wave not gone), `transit`, `bandits` (a fighter in a fight, or an enemy fighter on one of the group), `attack` (roll / dive / run / anvil), `after` (pull-out / exit / out), `home` (return / landing), `down`. A change to attack, bandits or after, or off the deck, cuts early. Each cut picks a shot from the phase's menu (never the same shot twice running) and lasts 6 to 12 s (10 to 14 s in the attack); about half the cuts inside a phase are hard cuts, the others cross-fade.
  - Shots (`camera_story_shots.js`, kind `'story'`, sub-kind `sk`): `chase` (behind, above and beside the leader), `wing` (outboard of a wingman, looking across at the leader), `ots` (behind the bomber, looking at its target), `side` (side-on tracking shot of the formation centre, 36 to 44 units out), `water` (a fixed spot 5 units over the sea ahead of a torpedo run at wave height; ends when the planes are past), `high` (high and well behind the strike, looking down its line toward the enemy, horizon on top), `deck` (off the carrier's beam at launch), `fall` (the camera holds still and watches the leader go down). A fighter in a fight uses the camera_action.js over-the-shoulder shot (`kind: 'ots'`). Every goal uses a smoothed heading and formation centre (stragglers more than 60 units out are left out) and per-shot easing rates (`kP`/`kL`).
  - Cutaways: a ship that sinks during a story (`shipSunk`) gets a 5 s orbit (at most one every 35 s, not during the attack), then the story goes on.
  - Death: when the leader dies, a shot on it turns into a `fall` shot in place (no cut; else the next cut is a fall shot) for 4.5 s; then the next live member of its element (the wingman), else its group, else a plane of the same kind in its wave, else the CAG takes over (caption "<rank> takes the lead"). With nobody left, the story ends on a 7 s `high` shot. A story also ends after 3 min, or in the `home` phase after 1 min.
  - Captions: a title card at the start ("VT-6 · Lt. Cmdr. Lindsey", "strike on a carrier" / "CAP over Enterprise" / "escort ..." / "ace · 6 kills") goes through `WW.airCaptions.say()`, which keeps the 15 s air-caption throttle and never covers another caption (the victory card); it is retried for 12 s. The squadron captions of air_captions.js work on story shots because the shot's subject is the leader.
  - Never in setup, map view or free camera; it stops on `roundStart`, `setupStart` and `victory`. Visual only: `Math.random` and `performance.now()`, never `WW.rand`; it only reads the sim. Test hooks: `WW.camStory.start(plane)`, `.stop()`, `.lead()`, `.log` (shot sequence), `._dbg()`; `tests/story_cam.js` screenshots each shot (tests/shots/story/), checks the death hand-off, the F key and a free-camera plane click.

### audio.js, audio_synth.js, audio_base.js, audio_amb.js

All sound is synthesized (no files, no music). Sound starts muted. Read [AUDIO.md](AUDIO.md) before you add sounds.

```js
WW.audio = {
  register(name, build | { build, bus, ref, max, minGap, sos, reverb, duck, dur, params }),
  play(name, { x, y, z } | { at: obj } | { ui: true }, + vol, rate, delay, sos, ref, duck, patch params) -> voice | null,
  loop(name, opts) -> { set(params), stop(fade), alive },   // virtual: real nodes only while on and audible
  stopAll(fade, all), duck(amount, secs), onUpdate(fn(rdt)),
  doppler(pos, vel, c?) -> rate factor, delayFor(dist) -> s, distGain(d, ref), distTo(x, y, z),
  init(), update(rdt), enabled, pending, live, available, volume, setEnabled(b), toggle(), setVolume(v),
  pitch, listener, C /* constants */, syn /* synth helpers */, stats(), meter(), renderOffline(name, params, secs)
};
```

When sound is off, `play` returns `null` at once and makes no nodes, and no AudioContext exists. The tests and 4× speed depend on this.
`ui.js` has the 🔊 corner button, the panel **Sound** button and volume slider, and the `M` key. `main.js` calls `WW.audio.update(rdt)` after the camera.

### main.js, ui.js

```js
WW.game = {
  mode: 'auto' | 'setup', state: 'setup' | 'battle' | 'victory',
  composition: null | [ { type, nation, x, z } ],
  startRound(opts),        // opts.keepMap keeps the current map (Start in setup mode)
  enterSetup(newMap), enterAuto(), randomComposition(), tonnage(nation), endRound(winner, reason, loser), winner,
  endReason,               // 'kill' | 'retire' | 'time' | 'stall' (null while a round runs)
  noRetire                 // test hook: no retire ending (the ASW scenarios of sim_behaviour.js)
};
window.__sim = { stats, game, world, fastForward(seconds, onStep), setScale(n), focus(x, z, width, hold), snapCamera() };
```

Each side gets 1 carrier (25% chance of 2), 1 to 2 battleships, 2 cruisers, 3 destroyers, 1 submarine and 2 PT boats in a task-force formation. A round ends (`game.endReason`):
- a side is *out* when it has no carrier, battleship, cruiser or destroyer afloat (its submarines and PT boats scatter). A side that started without such ships (a PT or submarine raid), or any side while `noRetire` is set, is out when all its ships are gone (`game.hadMajor`). The way its last major ship went decides the reason (`WW.endgame.lastOut`):
- `kill`: sunk. The winner ran down the last of them; ships that left the map earlier (often the carrier, which waits 0.08–0.35 W from its edge) are counted in `WW.endgame.stats.escaped`. The suite's `wipeout` counts the strict case (no major ship escaped at all);
- `retire`: it left the map over its home edge (a broken side, `endgame.js`). The caption shows "<loser> fleet retires";
- both out at once: tonnage decides (`kill`);
- `stall`: one side is only submarines, and nothing has been sunk, hit or attacked (a weapon dropped or fired) for `SUB_STALL` 60 s; the clock starts `SUB_CLOSE` 150 s after the sides first met (`contact` event; a sub makes 3.5 u/s), and with no contact at all the round ends at `SUB_SEARCH` 240 s (tonnage decides);
- `time`: the time limit (420 simulation seconds, 14 minutes at 1×), stretched for a pursuit (`game.deadline()`): while a broken side still has major ships afloat, at least `PURSUE_T` (150) s after it broke, at most `EXT_MAX` (150) s past the limit. The side with more tonnage wins.

`tests/sim_rounds.js` and `tests/sim_behaviour.js` report each round's end reason (kill / retire / time / cap) from `game.endReason` (a stall counts as time).

### Fires, the flight deck, magazines and the escort charge: ship_fires.js, ai_charge.js

```js
WW.shipFires = { hit(ship, amount, kind, cal, x, z), update(dt), deckLoad(cv), stats };  // ship.fireN, ship.avgas, ship.repaired
WW.airDeck.loaded(cv) -> bool          // deckLoad >= 2: strike planes queued, planes waiting on deck to launch, or rearming
WW.smoke = { add(x, z, nation), blocks(ax, az, bx, bz), clouds() };
WW.charge = { update(dt), steer(ship, dt), stats, CHARGE_R };                             // ship.ai.charge
// events: deckHit { ship, load, planes, x, z }, magazine { ship, x, z }, escortCharge { carrier, foe, ships }
```

All sim code with `WW.rand`; the flames, smoke puffs and explosions are visual (`WW.damage.syncFires`, `Math.random`).
- **Fires** (`Ship.takeDamage` → `hit`, after `WW.shipSpeed.hit`): a bomb starts a fire with chance 0.35, a torpedo 0.1, a big shell 0.15, a medium one 0.08 (at most 8). Once a sim second each fire burns 3 hp (an avgas fire × 2.5), may be put out (0.035 × damageControl), and the ship may get another (0.012 × fires / damageControl², avgas × 3). `damage.js syncFires` keeps that many sites burning on the model.
- **Flight deck** ("five fateful minutes"): a bomb on a carrier whose `deckLoad` is 2 or more sets off the deck with chance min(0.9, (0.25 + 0.08 × load) × doctrine.avgas): the strike planes queued (taken from the hangar), the planes waiting to take off (removed) and those rearming are lost, 2 + load / 3 avgas fires start, the secondary explosions do 25 × load hp (at most 400) and `deckHit` is emitted. While 3 or more avgas fires burn, a fuel / bomb magazine chain explosion (380 hp) follows with chance 0.012 / damageControl² a second. An empty deck takes the normal damage.
- **Magazine** (Hood, Arizona): a torpedo, bomb or big-shell hit on a battleship or cruiser detonates a magazine with chance 0.0004, × 3 within 3 units of a main turret: the ship blows up and sinks at once (`magazine` event; about 8 in 400 rounds). The same for both nations.
- **Smoke screen**: a cloud grows to radius 18, drifts with `WW.wind` and is gone after 40 s (at most 60). `intel.js los()` treats a ship-to-ship line through 0.8 × a cloud's radius as blocked (planes still see).
- **Escort charge** (Samar): once a second, an own carrier (at most once in 90 s) with a known enemy gun ship (seen in the last 10 s) inside the doctrine trigger sends every destroyer at ≥ 30% hp within 320 of it (not on a rescue) at that ship: full speed at its lead point with a weave, close aboard a swing across, guns on it, torpedoes through `WW.shipAI.surface.torpedoes`, a smoke cloud every 2 s. It ends when the foe is sunk or turned back (beyond 1.3 × the trigger from the carrier), the destroyer is below 30% hp, or after 75 s. `ai_endgame.js steer` hands the helm to `WW.charge.steer` first (not for a broken side).

### Endgame: endgame.js, ai_endgame.js

```js
WW.endgame = { update(dt), stats, EXIT, broken(n), homeX(n), engaged(ship), lastOut(n), tasks(), pending(n),
               taskNear(n, x, z, r), rescuerNear(n, x, z, r) };     // the last two are read-only helpers for lifeboats.js
// stats (reset on roundStart): per nation { escaped, sunk, scuttled, abandoned, rescues, survivors, lost, pilots,
//   pursuitKills }, escTypes { 'USN:carrier': n }, lastEsc { type, nation, t, hp }, brokenAt
// events: shipEscaped (ship), shipScuttled (ship), rescue { ship, x, z, n, kind }, engineHit { ship, permanent } (ship_speed.js)
WW.endgameAI = { steer(ship, dt), fairGame(ship, cv, B), pursueContact(ship, B), isCripple(ship), PURSUE_AGE };
```

All sim code (`WW.rand` only; the rescue and scuttle rules are deterministic apart from the scuttle roll).
- `ships_ai.js` calls `WW.endgameAI.steer` after the role; when it returns true it has the helm and the core cripple withdrawal is skipped (combing and the guns still run). Submarines are never steered.
- **Broken side** (`endgame.broken`: `brokenAt` and posture `withdraw`; not with `game.noRetire`): every ship sets `escapeEdge` and makes for its home edge at about its own z (`bestHeading` risk 0 until 90 from the edge, then straight). A surface cripple keeps `crippleHome`'s route (away from every gun in reach) until it is near the edge. The carrier leaves at once; its planes still up (CAP, scouts) are removed with it.
  - IJN (`doctrine.scuttle`): best speed, each ship on its own. The cripples it has when it breaks are counted as abandoned. Every 4 s, a cripple below 25% hp and 0.6 `speedK`, 30 s after the break, with a known enemy gun ship (seen in the last 5 s) at least 1.3× faster inside its gun range, is scuttled with chance 0.08.
  - USN (`doctrine.rescue`): a destroyer with a rescue task does that first; a fit destroyer escorts the nearest unescorted cripple (a station 26 off it toward the nearest known enemy, at the cripple's speed, `ship.escortBy` / `ai.escortOf`); a free fit destroyer waits 70 off the edge while survivors are still being picked up (`pending`).
- **Rescue tasks** (`doctrine.rescue`): a sunk ship (from `shipSunk`, at its position then) leaves boats × 12 survivors (carrier 4 boats, battleship 3, cruiser 2, destroyer and PT 1); a plane that ditches or is abandoned (`deathMode` 'ditch' / 'abandon', a wrapper on `Plane.shotDown` / `ditch`) leaves its crew. Not on land. Every 1 s each open task gets the nearest own destroyer that has no task, is at ≥ `CRIP` hp, is not on a depth-charge run, is within 320 (aircrew 220) and, unless the side is broken, is not in a gun fight (`engaged`: a fresh enemy gun ship inside its main range + 20) and sees known enemy fire below 12 dps at the survivors. A rescuer called into a gun fight (not broken) drops the task. It steams there, slows (half the length of the sunk hull + 14 off, aircrew 10) and recovers them after 10 s alongside under 1.6 units/s. A task with no rescuer is lost after 150 s, any after 240 s.
- No hidden per-nation handicaps: the two nations differ only in the doctrine flags. The rescue costs the USN nothing measurable on the balance gate (rescuers are only sent away from a gun fight), so nothing was compensated.
- `tests/endgame_shots.js <cripple|rescue|retreat> <seed>`: render-mode screenshots of a slowed, listing cripple being run down, a destroyer picking up boats, an IJN fleet running east (good seeds: 9, 19, 8). The behaviour suite's `cv_closing` judges a carrier on its own side's picture (`WW.intel.known`, last-known positions), not raw positions.

`endRound` emits `victory` `{ winner, round, reason, loser }`. The caption shows "<winner> victory" for 9 s, with "<loser> fleet retires" as the subtitle after a retire, else the ships each side lost.

`ui.js` shows the panels only in setup mode. In battle, `H` shows the panel. It also controls the captions, the tilt-shift bands (`T`) and fullscreen. There is no letterbox.

### plot_table.js, plot_tokens.js, war_diary.js, aar_card.js (the plotting room)

Visual / UI only: they read the sim and never write it, use `Math.random` only, and do nothing in sim-only mode (each file returns at once). Each wraps `WW.cam.update` (like air_captions.js) for its per-frame work, so main.js needs no hooks; ui.js has the keys `G`, `X`, `L`. Event handlers run inside the sim step: they only read, and catch their own errors.

- **Plot table** (`WW.plot`, `WW.plotTokens`): in map view (`WW.cam.mode === 'map'`) during a battle or the victory pause, a full-screen 2D canvas (`#plot`, between `#game` and `#film`) shows a paper chart on a wooden table. The chart is cached per map and screen size: paper, a grid with edge letters and numbers, a compass rose, island outlines (marching squares on `terrain.depthAt` every 2 units, the 4-unit shoal line dotted), blue shallows, hatched land. Once the plot has faded in, `WW.post.render` is skipped (the 3D view is covered), so map view is cheaper than the director view; camera.js still grabs the last 3D frame for its cross-fade on the way out. Setup mode keeps the 3D overview (placement clicks raycast against it).
  - Whose plot (`G`, `WW.plot.set(null | 'USN' | 'IJN')`): **Omniscient**: every ship and plane at its true position, both sides' strike tracks. A **side's plot**: its own ships and planes at their true positions; the enemy only from `WW.intel.contacts(side)`: a token of the reported type (`contact.reportedType` / `WW.intel.typeOf`: a misidentified ship is plotted as what was reported, with nothing to say it is wrong; the omniscient plot labels it "USN plot: BB?") at the last-known position, a wobbly pencil circle of radius min(50, age × speed × 0.5) + 6 + `contact.err` once the contact is older than `FRESH`, a dashed course arrow, fading to half strength as it ages; enemy plane contacts as markers fading over 10 s; the last 5 sighting notes (`WW.diary.notes(side)`, "1 CV, 072, 0639", pinned paper, stacked so they do not cover each other); range rings (100 / 200 / 300) round the side's carrier; ships it saw sink crossed out with their names.
  - Tokens: painted wooden blocks, 14 + 2.1 × hull length units long, cached sprites per type, nation and scale (flight deck and island, turrets, a dark submarine). Planes: small painted crosses. Strike tracks (`WW.strike._waves()`): a pencil line from the carrier to the airborne wave, a dashed arrow to the target's position as that side knows it, an X on the target, the squadrons' names.
  - Danger layer (`X`): the plot side's `WW.threat` field (red: guns and torpedoes, blue: AA), repainted when the commander rebuilds it. It replaces the `G` overlay of ai_threat_view.js, which keeps `WW.threatView.toggle()`.
- **War diary** (`WW.diary`): entries `{ t, clock, text, pri 0..3, nation, kind }`, kept in time order, at most 160. Clock: `WW.dayNight.hourAt(roundTime)` when the night branch is present, else 0600 + roundTime / 120 h (one sim second is half a minute). Sources: `contact` (first) and `report` (flying boats) batched per side over 1.5 s into one sighting report with a bearing from the side's fleet centre and the observer ("Kingfisher from Northampton"); `misidResolved`, `airOrder` strikeAway, `shipHit` (first bomb or torpedo, below half hp), `deckHit`, `magazine`, `engineHit`, `shipSunk`, `shipScuttled`, `shipEscaped`, `escortCharge`, `rescue`, `ace`, `flyingBoat` lost, `admiralOrder` (its `text`), `victory`. Ship names: `ship.name`, else a period name by nation, type and order (carriers follow the air-group slots). The card (`#diary`) slides in at the right in map view; `L` toggles it per view (off in the director view by default). An entry of priority 2 or more flashes as a small caption through `WW.airCaptions.say` (its 15 s throttle; never over the victory card), only when the card is hidden. It emits `diaryEntry`.
- **After-action report** (`WW.aar`): a snapshot at `victory` (winner and reason; per side: the admiral from `WW.admirals.of`, ships lost by name and type from the `shipSunk` / `shipScuttled` events, escaped ships, planes lost (every plane flown that is no longer alive), the ship of the day (sinkings credited to gun ships aiming at the victim within 1.3 × their longest weapon range, half a sinking to the carrier of a plane attacking it), the top pilot (`planeKill` this round); the 5 key moments from the diary). It shows 4.5 s after the victory caption, stays through the victory pause and on the ready screen until the next battle (auto mode: about 34 s of real time); a click hides it. `VICTORY_TIME` is unchanged.
- Test: `node tests/plot_shots.js [seed] [seconds]` (render mode) shoots the three plots of one moment, the danger layer, the diary card and the report into tests/shots/plot/ and prints the diary.

### The island air base: island_base.js, base_ai.js, land_air.js, base_fx.js, models_base.js, models_landplanes.js

"Toys fighting for Midway." One base per map, on the terrain's airfield site, owned by one side or by nobody.

```js
WW.islandBase = { base, stats, build(owner), update(dt), impact(nation, x, z, dmg, kind, cal) -> bool, scan(nation, sight),
                  shooters(ships) -> ships + AA pits, tons(nation), runwayOpen(), ID: 9001, BASE_TONS, BATTERY, PIT_AA, CLOSE };
// base: { isBase: true, id, type: 'base', nation, alive (always), x, z, heading (main runway), speed: 0, name ('Midway', 'Henderson Field',
//         'Wake', 'Rabaul'), site, stats: { guns: [battery x live batteries] | [], aa: { range, dps of the live pits }, length 40, tons },
//         hp / maxHp (facility hp), power, hangar, stock (planes on the ground by variant), rearm, runways: [{ craters, closed }],
//         craters, facilities: [{ kind: hangar | fuel | tower | barracks | aa | battery, x, z, r, hp, out, unit }], neutralized,
//         takeDamage(), toWorld() }
WW.baseAI = { objective(B), strikeValue(B, carrier), assign(ship, target), neutralized() };
WW.landAir = { setup(base), update(base, dt), launched(p), takeoff / goHome / landing / rollout(p, dt), hangarLost(base), aimFor(plane, base),
               VAR, ROSTER, stats };
```

- **Owner**: `WW.game.baseChoice` ('USN' | 'IJN' | 'none'; the ready screen's Base button, kept by Start; the tests set it), else a `WW.rand` roll in the `roundStart` listener (USN 40%, IJN 40%, none 20%). `enterAuto` clears the choice. The setup screen shows a preview owner (`game.basePreview`, Math.random) until the user picks one.
- **Not a ship**: the base is never in `WW.world.ships`. It is a duck-typed object with what the planes, the AI and combat read. Its ids (base 9001, pits 9011+, batteries 9031+) never collide with ship ids (intel's line-of-sight cache, orders).
- **Intel** (`intel.js` scan hook): the enemy side always has the base as a fresh contact (an island is on the chart); for its owner the base is a radar and lookout station (ships within 170, planes within 210 USN / 160 IJN, x `TUNE.radar`; x 0.7 with the tower out). The contact has `stats.guns` and `stats.aa`, so `WW.threat.build` stamps the coastal guns and the AA into the enemy's danger field: ships and plane routes respect them with no extra code.
- **Hits** (`combat.js landShell` and `combat_weapons.js updateBomb` hooks; `findHit` never takes the base as a hull): every shell or bomb that lands on the island goes to `impact()`:
  - a bomb, big or medium shell on a runway adds a crater (weight 1 / 0.8 / 0.35, at most 3.5 per runway); a runway with crater weight >= `CLOSE` 1.5 is closed. Repair crews fill 0.5 every 13 s (x 1.3 with the fuel farm out), the most damaged runway first;
  - the blast (bomb 7, big 5, medium 3, small 1.5) damages every facility in reach; at 0 hp it is out: a hangar burns and the base loses 30% of the planes on the ground, a fuel tank burns (rearm x 1.6), the tower costs the radar range, a pit or battery is silenced.
  - **Neutralized** (sticky): every runway closed, every battery silenced and at least half the AA pits out. The base stops launching and repairing, its planes in the air hold and then ditch off the reef, ships stop taking it as a target and strikes stop going to it.
- **Coastal batteries** (2, on the seaward shore): 2 medium guns each, range 140, reload 10 s / `TUNE.guns`, at the visible enemy ship in range with the most tons per distance (`combat.fireShell` from the battery unit). **AA pits** (3 x `TUNE.pits`): `shooters()` hands them to `combat_aa.js` as shooters (`PIT_AA` range 42, dps 4.5, heavy share 0.45).
- **Tonnage** (main.js `tonnage`): an intact base adds `BASE_TONS` (26000) to its owner's tonnage, so it counts heavily in the time-limit tiebreak. The kill / retire endings are unchanged (a side with only its base left is out).
- **AI** (`base_ai.js`; hooks in `fleet_cmd.js`: `POWER` -> `base.power`, `STRIKE_V` -> `strikeValue`, `B.objective`, `assignment`):
  - `B.objective = { kind: 'neutralize' | 'defend', base, x, z, state: 'intact' | 'runway closed' | 'neutralized', at }`, or null with no base.
  - Bombardment: `ROLE_W.battleship.base` 1, `cruiser` 0.8 (0 for the rest) x `TUNE.target`, `VALUE.base` 7; x 0.3 while the enemy fleet is known (a carrier, battleship or cruiser seen in the last 60 s: `B.objective.fleetFirst`). The ships' own target score takes the base when nothing better is in reach, and `engage` holds them at their preferred range: a battleship at 0.84 x 170 = 143, outside the batteries; a cruiser inside them, at its doctrine's risk. Each ship aims at one facility at a time (`fireShell` wrapper): the nearest live battery in range first (counter-battery), then a runway, the pits and the rest. No torpedoes at an island (`fireSpread` wrapper). A bombardment run is a ship's shells at the base with less than 30 s between them.
  - Carrier strikes: the base is worth 6 as a strike target (a runway open), 3.5 (runways closed, guns up) or 2, x `TUNE.target`, x 0.3 while the enemy fleet is known, and 0 in the first 150 s unless it is within 350 of the carrier (find the fleet first), against `STRIKE_V` carrier 12, battleship 9 (the Midway dilemma; the reserve doctrine of `air_ops.js` still applies). Carriers do not flee from the base (`ai_carrier.js fleeFrom`): the danger field keeps them off its guns.
  - Defence: an enemy ship within 230 of the own base is worth x `TUNE.defend` (1.2) to own ships within 420 of the base.
- **The base air group** (`land_air.js`; the base is the planes' `carrier`; `aircraft.js` hands takeoff / goHome / landing / rollout to it, and `WW.air.launch` hands the new plane to `launched` instead of `air_deck.js`): a variant is a plane kind with its own model and stats (`VAR`): USN `f4f` (fighter), `sbd` (dive), `b26` (torpedo, B-26 Marauder), `b17` (level bomber, B-17); IJN `a6m` (fighter), `g4m` (torpedo, G4M Betty), `g4mL` (level, Betty with bombs). `ROSTER` (x `TUNE.air` 0.6, rounded): USN 3 / 2 / 2 / 2, IJN 3 / 3 / 2. The squadrons and pilots are the base's own (`base._sq`, `base._roster`: VMF-221, VMSB-241, 69th BS, 431st BS; Tainan, Misawa and Chitose Kokutai).
  - Air boss: a standing CAP (`WW.airOps.capWanted`), and every 55 to 75 s a strike on the best known enemy ship within 560 (`WW.airOps.pickTarget`): dive and torpedo bombers as one `WW.strike` wave, level bombers on their own; IJN Zeros escort (up to 2). No launch with every runway closed, and none after dusk (`daylight.js` blocks `WW.air.launch`).
  - Runway: taxi from an apron spot to the open runway end most into the wind, wait for the runway (one roll at a time, 2.2 s apart, nobody on final), roll at 7 u/s^2, lift off at 0.78 x speed, climb out. Home: within 150 the plane joins the circuit (stacked orbits, one at a time on final), flies the centreline down to touchdown, rolls out, taxis to a spot and is rearmed after 22 s. No open runway: hold over the island, ditch off the reef after 70 s.
  - Level bombing (`pl.level`: a B-17 at 62 with 3 bombs, a Betty at 48 with 2; carrier torpedo planes sent against the island at 40 with 1, like the Kates' bombs at Midway): straight and level, released on the throw point. `dropBomb`'s scatter grows with height, so a B-17 rarely hits a ship.
  - A strike on the base aims each bomber at one facility (`aimFor`: the runways, then the batteries, pits, hangars and fuel; the dive wrapper moves the base's x / z to the aim point for that call).
- **Visuals** (`base_fx.js`, `models_base.js`, `models_landplanes.js`; never in sim-only mode): the airfield is built on `baseBuilt` (round start and the setup screen). Craters are pooled discs that shrink as they are filled; knocked-out facilities are scorched and slumped; hangars and fuel tanks burn with dark smoke columns for 3 min; the guns turn; the owner's flag flies on the tower; one parked model stands on the apron for each plane on the ground. The B-17, B-26 and Betty are lofted with the carrier planes' kit (`WW.models._planeKit`), the engines baked into the wing halves; the extra propellers copy the first one's spin and blur.
- **Events** `'baseEvent'` `{ kind, base, nation (owner), x, z, by?, target?, runway? }`, kind: `airRaid` (armed enemy bombers within 160 heading for it, at most once a minute: "Midway under air attack"), `cratered`, `runwayClosed` ("Runway cratered"), `runwayOpen` ("Runway repaired"), `battery` ("Coastal battery silenced"), `aa`, `hangar` ("Hangar ablaze"), `fuel` ("Fuel farm burning"), `tower`, `barracks`, `strikeOut` (with `target`: "Strike from the island inbound"), `bombard` (`by`: the ship starting a bombardment run), `neutralized` ("Midway neutralized"); and `'baseBuilt'` `{ base }`. `base_fx.js` turns them into captions (at most one every 12 s) and war diary entries (`WW.diary.add`).
- **Tests**: `tests/sim_behaviour.js` scenario `midway` (a USN base and carrier group against an IJN carrier striking force), `--base USN|IJN|none` for any scenario, and the info metrics `base_neut` (share of base rounds neutralized), `base_t_neut` (median s), `base_cap_leash`, `base_raids`, `rw_closures`, `batteries_out`, `land_strikes`, `land_sorties`, `land_hits` (ship hits by base planes), `bombard_runs`, `bombard_shells`. The balance gate prints the wins by base owner. The carrier CAP leash check leaves the base fighters out.
- **Tuning knobs** (the base's strength, for the balance pass): `WW.islandBase.TUNE` { tons, guns, pits, air, radar, defend, target, chart, power } (`tests/sim_behaviour.js --tune k=v,...`; defaults and the measurements in AI_DESIGN.md section 10), and below them `BASE_TONS`, `BATTERY`, `PIT_AA`, `CLOSE`, `REPAIR_T` / `REPAIR_W`, `HP` (island_base.js); `ROSTER`, the `VAR` stats, `REARM`, `STRIKE_R` (land_air.js); `W_BASE`, `VALUE`, `STRIKE_OPEN` / `STRIKE_SHUT` (base_ai.js); the owner roll (island_base.js `roundStart`).

### Admirals: admirals.js, admirals_flags.js

Each round, each side is commanded by a named admiral whose personality bends the side's doctrine. He flies his flag in a flagship. When the flagship is lost, the side is confused until the flag passes to another ship. `admirals.js` is sim code: `WW.rand` only, and no visuals. `admirals_flags.js` is visual only: `Math.random` and the wall clock. It does nothing in sim-only mode.

```js
WW.admirals = {
  of(nation) -> Admiral | null,   // null before the first roundStart and in setup mode
  list() -> Admiral[],
  preview(nation) -> rosterEntry, reroll(), startFromPreview(),   // setup panel (ui.js)
  before(B) -> bool, after(B),     // fleet_cmd.js hooks around each commander tick (true: confusion, skip the tick)
  isFlag(ship), targetK(ship) -> 1 | FLAG_K, ringK(carrier) -> 1 | RING_K, confused(nation),
  force(nation),                   // test hook: cripples the flagship (the next tick starts the confusion)
  stats: { flagLost, transfers, leaderless, confusionSec, orders: { kind: n } },   // per round
  ROSTER, FLAG_K: 1.15
};
Admiral = { nation, key: 'nagumo', name: 'Nagumo', title: 'Adm. Nagumo', full: 'Vice Adm. Chūichi Nagumo', style, blurb,
            flagship: Ship | null, flagName: 'Akagi', posture, confusedAt, confusedUntil /* 0: in command */, transfers };
```

**The roll.** `admirals.js` loads right after `fleet_cmd.js`, so its `roundStart` handler runs after `fleetCmd.reset()` has rolled the doctrine. It picks one admiral per side with `WW.rand`. A carrier admiral needs a carrier on his side; if the side has none, he is not picked, unless the whole roster is carrier admirals. In setup mode the panel shows a preview pair picked with `Math.random`. Setup rounds are not replayable anyway. A click on the panel picks another pair, and **Start** uses the pair the panel shows (`startFromPreview`). Ships without a name get one at round start (`ship.name`: Washington, Portland, Hammann, ...; Kirishima, Nagara, Nowaki, ...). Carriers keep their squadron group's name.

**Personality.** Each roster entry changes the rolled doctrine in four ways:

- `mul` multiplies a value;
- `risk` multiplies every type's risk, except the carrier's;
- `riskT` multiplies one type's risk;
- `add` adds to a value, and `set` sets a mode (a flag or a string).

An entry changes only keys that the doctrine already has, with the same type. Then the `rollDoctrine` clamps run again. The multipliers stay between 0.85 and 1.2. `reserveFrac` is the exception (0.4–1.5): it is the personality. `strikeRange` belongs to the admirals: `fleet_cmd.js` `strikes()` searches its first pass within `STRIKE_R × strikeRange`.

| admiral | flag | style | effects |
|---|---|---|---|
| Spruance (USN) | carrier | calculating | strikeRange 1.15, reserveFrac ×1.5, aggression 0.95, rangeFrac 1.03, escortCharge 1.1 |
| Halsey (USN) | carrier | aggressive | aggression 1.2, pressRatio 0.93, withdrawRatio 0.9, carrier 1.12, rangeFrac 0.97, reserveFrac ×0.5, cvStandoff 0.95, risk ×1.1, followUp 'deckload' |
| Fletcher (USN) | carrier | cautious | aggression 0.88, pressRatio 1.06, withdrawRatio 1.12, cvStandoff 1.12, carrier 0.95, escortCharge 1.15, reserveFrac ×1.3, ringR 0.9, risk ×0.88 |
| Nagumo (IJN) | carrier | cautious, by the book | aggression 0.9, carrier 0.9, reserveFrac ×1.4, cvStandoff 1.08, withdrawRatio 1.08, pressRatio 1.05, vanguard 1.1, jointStrike |
| Yamaguchi (IJN) | carrier | aggressive | carrier 1.15, aggression 1.12, strikeRange 1.08, reserveFrac ×0.4, pressRatio 0.95, risk ×1.08, followUp 'deckload' |
| Kondo (IJN) | battleship | gunnery | aggression 1.15, rangeFrac 0.96, pressRatio 0.93, screenAhead 1.2, vanguard 1.2, carrier 0.92, escortCharge 0.9, BB / CA risk ×1.15 |
| Tanaka (IJN) | cruiser | destroyers, night torpedoes | torpedo 1.15, night 1.1, searchlight 1.1, aggression 1.05, carrier 0.92, flotilla +1, DD risk ×1.2 |

**The flagship and the chain of command.**

- **The flagship.** A carrier admiral flies his flag in the side's first carrier, Kondo in a battleship and Tanaka in a cruiser. The fallbacks are battleship, then cruiser, then carrier, then destroyer.
- **Flag lost.** The flagship is lost when it is sunk or sinking, or when it is crippled (hp < `CRIP`, if it was fit when the flag went up). It is not lost when it has left the map. At the side's next commander tick, the admiral emits `flagLost`, and the side is in *confusion* for 30–60 s (`WW.randRange`).
- **Confusion.** `fleet_cmd.js update()` asks `WW.admirals.before(B)`, and while it returns true, the side's tick is skipped:
  - the danger field is still rebuilt;
  - `B.strikes` is cleared, so `air_ops.pickTarget` launches no new strike;
  - posture, groups, stations and focus stay as they were;
  - the broken / pursuit checks also wait.
- **Transfer.** After the confusion, the flag passes to the best ship left: BB 4, CA 3.6, CV 3, DD 1.5, +5 if it is fit, minus distance / 400. The admiral emits `transfer` ("Flagship lost — Adm. Nagumo transfers his flag to Nagara"). With no ship left, he emits `leaderless`.
- **The flagship as a target.** The enemy's focus and strike scores of the flagship are ×`FLAG_K` = 1.15 (`targetK`), except while its side is in confusion.
- **The escorts.** When the flagship is the ringed carrier, its escorts in the loose ring (IJN, `ringR` 0) stand at ×0.9 of the normal distance (`ringK`, in `fleet_groups.js` / `fleet_formation.js`). The USN AA ring is already tight. A surface flagship's escorts do not change.
- **Order events.** After each tick, `WW.admirals.after(B)` turns a change of posture into an order.

**Events** (sim code, same in both modes; for the war diary and the captions):

```js
'admiralOrder' { nation, admiral: 'Nagumo', title: 'Adm. Nagumo', order, text, t /* WW.time.now */, roundTime, ship /* flagship */, x, z,
                 sub?, posture?, from?, to? /* ship names */, carrier?, target?, first? }
// order: 'command'    round start ("Adm. Spruance commands", sub "flag in Enterprise · calculating: ...")
//        'strike'     a strike away (air_cag.js strikeAway): the first of the round in the admiral's words
//                     ("Adm. Yamaguchi: launch everything"), then "another strike away"; first: true / false
//        'reserve'    that carrier holds back an air_ops reserve ("Adm. Nagumo holds his reserve")
//        'posture'    search / approach / engage (posture)
//        'press', 'retire' (withdraw), 'pursue'   in the admiral's words ("Adm. Halsey: attack — repeat — attack!")
//        'flagLost'   (from), 'transfer' (from, to), 'leaderless'
// Throttle per side in sim time: posture 20 s, strike 90 s, press / retire / pursue / reserve 60 s.
'flagship' { nation, ship, admiral }   // each time a flag goes up (round start, transfer); admirals_flags.js listens
'admiralsPreview' { USN: key, IJN: key }   // setup panel
```

**What you see** (`admirals_flags.js`):

- **The pennant.** The admiral's pennant flies at the masthead. The USN pennant is blue with white stars. The IJN pennant is white, with a red sun and a red band.
- **The signal hoist.** A hoist of 1 to 3 toy signal flags hangs on the yardarm, and it changes with the posture:

  | posture | flags |
  |---|---|
  | search | P N |
  | approach | G H N |
  | engage | B O H |
  | press | B V B (IJN: the Z flag) |
  | withdraw | E P |
  | pursue | O B G |
  | strike launch (20 s) | G G B |

- **Where the rig goes.** The masthead is the model's highest vertex, cached per type and nation. The rig is parented to the flagship's group, so it goes down with a sinking flagship, and it moves to the new flagship at a transfer.
- **Pooling.** There are 2 rigs, 4 escort lamps, shared geometry and shared canvas-texture materials.
- **Blinker lamps.** When `WW.daylight` (a number, or `{ level }`) is below 0.35, the flagship's lamp flashes, and then its two nearest escorts answer.
- **Captions.**
  - Through `WW.airCaptions.say` (throttled): "Adm. Halsey vs Adm. Yamaguchi" at the start, the first strike, press, retire, pursue, the reserve, and the flag lost.
  - The flag transfer goes straight to `WW.ui.caption` as soon as no caption is showing, and the director gets the new flagship as a camera candidate for 25 s.
- **The panels.** `ui.js` shows the two admirals on the setup panel and puts the winner's admiral in the victory caption ("Adm. Spruance's task force victorious", sub "USN victory · ...").

**Tests:**

- `tests/sim_behaviour.js` round records carry `adm: { USN, IJN, st }`. Balance scenarios print the wins per matchup, the win rate per admiral, and the command metrics (flags lost, transfers, confusion s, orders per round).
- `tests/admirals_shots.js [seed] [outdir]` takes render-mode screenshots: the ready panel, each flagship's pennant and hoist, a forced flag transfer with its caption, and the lamps.
