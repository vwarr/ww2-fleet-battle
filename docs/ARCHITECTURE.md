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
  - A replay: stop the render loop (`requestAnimationFrame = () => 0`, `WW.time.warp = 1`), then `WW.aces.reset()` (aces carry over between rounds by design), `WW.terrain.generate(seed)`, `WW.seedRandom(seed)`, `WW.time.now = 0`, `WW.game.startRound({ keepMap: true })`, and drive `__sim.fastForward`. `tests/determinism.js [seed] [seconds]` checks that this gives identical traces in one page, after another seed, and in a fresh page.
- Code that the combat code calls must not throw errors into the combat code. `WW.damage` catches its own errors.

## Load order

`index.html` loads the scripts in this order. A file can use the files above it at run time.

```
vendor/three.min.js     Three.js r149 (UMD build, global THREE)
js/core.js              WW.cfg, data tables, helpers, event bus
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
js/terrain.js           WW.terrain: sea floor, islands, depth grid
js/models.js            WW.models: ship models
js/models_detail.js     fine ship detail, merged into one mesh per material
js/models_planes.js     WW.models.buildPlane
js/models_scout.js      WW.models.buildScout: scout floatplanes
js/models_crew.js       WW.crew: tiny sailors on every ship (instanced), deck stations, idle / fire / abandon-ship motion
js/effects.js           WW.fx: pooled particle effects
js/damage.js            WW.damage: fires and smoke at hit points, WW.wind
js/combat.js            WW.combat: projectile pool, shells, anti-aircraft fire
js/combat_weapons.js    torpedoes, bombs, depth charges
js/combat_aa.js         WW.combatAA: heavy/light anti-aircraft fire, flak bursts, plane jinking
js/ships.js             WW.Ship, WW.ships: movement, damage, sinking, wrecks
js/ships_nav.js         WW.shipNav: hull outline checks, ship collisions
js/intel.js             WW.intel: fog of war, per-side contact tables (what each side has seen)
js/ai_threat.js         WW.threat: per-side danger field (grid), danger(), bestHeading()
js/ai_threat_view.js    WW.threatView: debug overlay (key G): danger field + contact picture
js/fleet_groups.js      WW.fleetGroups: doctrine tables, group assignment, formation stations
js/fleet_cmd.js         WW.fleetCmd: per-side commander and blackboard (posture, groups, focus, strikes, sectors)
js/ships_ai.js          WW.shipAI core: setup, retarget, guns / turrets, dispatch to the role files, shared helpers (WW.shipAI.h)
js/ai_surface.js        WW.shipAI.roles.surface: battleship / cruiser / destroyer behaviour, destroyer sub hunt
js/ai_carrier.js        WW.shipAI.roles.carrier: carrier movement and air ops (CAP queue, strikes, launches), pickStrikeTarget
js/ai_light.js          WW.shipAI.roles.submarine: submarine behaviour; WW.lightAI.h helpers shared with ai_pt.js
js/ai_pt.js             WW.shipAI.roles.pt: PT boat behaviour (loads after ai_light.js)
js/aircraft.js          WW.air, WW.Plane: carrier planes
js/air_dogfight.js      WW.dogfight: fighter-vs-plane manoeuvres, wing guns, tracer rounds
js/air_intercept.js     WW.intercept: fighter gun passes on bombers (wheel arc lead, dive line, stern passes)
js/air_aces.js          WW.aces: pilots, kill credit, aces and kill marks
js/air_scouts.js        WW.scouts, WW.Scout: catapult scout floatplanes and spotting
js/air_props.js         WW.airProps: pooled parachutes, life rafts, sheared-off wings
js/lifeboats.js         WW.lifeboats: a sinking ship's boats row to a friendly ship or the shore
js/air_deaths.js        WW.airDeaths: shoot-down / ditch / bail-out / deck slide-off deaths
js/air_deck.js          WW.airDeck: deck parking, wing folding, takeoff runs, into-the-wind turns, landing pattern
js/air_fx.js            WW.airFx: prop disc, dive brakes, wing-tip vapour, exhaust flicker, canopy glint
js/air_strikes.js       WW.strike: strike waves (form-up, vics), sequential dive bombing, anvil torpedo attack
js/air_squadrons.js     WW.squadrons: carrier names, VF/VB/VT squadrons per carrier slot, sections / divisions / shotai, wingman slots
js/air_ops.js           WW.airOps: air boss (CAP relief, scrambles, strike hold, deck-aware launches), fighter director, jettison, scout sectors
js/air_cag.js           WW.cag: strike leader (handover, redirect, AA detour), VT/VB timing, close and top cover escorts
js/camera.js            WW.cam: director camera and map camera
js/freecam.js           WW.freecam: camera that the user controls
js/camera_action.js     WW.camAction: bomb / torpedo hand-offs, over-the-shoulder shot, slow motion
js/camera_story_shots.js WW.storyShots: story-mode shot goals (chase, wingman, over-the-shoulder, side, water, high, deck, fall)
js/camera_story.js      WW.camStory: story mode: follow one squadron / division through its mission (key F)
js/air_captions.js      WW.airCaptions: squadron / leader film captions for what the director films (visual only)
js/post.js              WW.post: HDR render target, bloom, tone curve
js/ui.js                WW.ui: panels, setup clicks, captions, fullscreen
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

1. Advance the simulation. For each step (`step`):
   1. `WW.terrain.update`, then `WW.intel.update` (contact tables, every 0.5 s), then `WW.fleetCmd.update` (side commanders and danger fields, every 2 s per side)
   2. `WW.ships.update`: ship AI, movement, the collision pass (`WW.shipNav.resolve`), sinking, wrecks and `WW.damage.update`
   3. `WW.air.update`
   4. `WW.combat.update`: projectiles and anti-aircraft fire
   5. `WW.fx.update`, then `WW.lifeboats.update`
   6. Round logic: victory, time limit and the next round
2. `WW.water.update`, `WW.cam.update`, `WW.crew.update` (after the camera: it uses the camera distance), `WW.audio.update`, `WW.sky.update` and `WW.ui.update` on real time.
3. Render through `WW.post.render` (HDR, bloom, tone curve). If `WW.post` is not available, render directly.

`__sim.fastForward(seconds)` runs simulation steps without a render. The tests use it.

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
  generate(seed),                     // make a new map; remove the old meshes
  depthAt(x, z) -> number,            // water depth in units; 0 or less is land; off the map is 0
  isNavigable(x, z, minDepth) -> bool,
  randomSeaPoint(minDepth, xMin, xMax) -> {x, z},
  update(dt), seed, landFraction
};
```

Each map has 3 to 6 islands, 4 to 8 islets, 2 to 4 sandbars and 3 to 6 reefs, spread over the sea between the start zones (x 135 to `MAP_W` − 135). Land is approximately 2 to 6% of the map. The two start zones (x < 120 and x > `MAP_W` − 120) stay open. `generate` takes approximately 200 ms (headless, 960 × 600). The terrain bakes soft ambient occlusion into its vertex colours. `generate` sends the depth grid to `WW.water.setDepth`.

### sky.js, water.js, post.js

- `WW.sky`: a sky dome with a golden-hour gradient (peach near the sun, blue away from the sun), smooth toon clouds, a warm low sun (approximately 21°) with soft shadows, a strong cool sky fill light, and fog. It gives `HORIZON`, `SUN_DIR` and `sunColor()`.
- `WW.water`: one large water plane to the horizon. A small depth texture controls the depth colours, the foam lines around islands and shoals, the clear shallows, the sun glitter and the fog. It also has a pool of soft dark contact-shadow blobs under ship hulls.
- `WW.post`: renders the scene into a half-float target with MSAA, adds a soft bloom (bright pass and blur at quarter resolution), then applies a soft tone curve and 10% desaturation. `WW.post.toggle()` turns it off. Three.js ACES tone mapping is not used, because it made the pastel colours grey.

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
            adopt(ship, n), stations(type, nation), SCALE, FAR };
WW.lifeboats = { init(), update(dt), figures(), clearAll(), stats() };
```

- Visual only: `Math.random`, no effect on the simulation. Both clear themselves on `roundStart` and `setupStart`.
- Sailors are about 0.48 units tall (`SCALE` 1.1). That is larger than true scale, like the planes' `PLANE_SCALE`, so they read in close shots. All sailors in the scene are 4 `InstancedMesh`es (shirt and arms, trousers, head, cap). The 4 meshes share one instance-matrix buffer and use per-instance colours: USN dungarees with a white cap, IJN whites with a dark cap, khaki officers, grey-helmeted gunners and coloured carrier deck jerseys.
- Stations per type are in ship-local coordinates (carrier 13, battleship 10, cruiser 7, destroyer 5, PT boat 3, submarine 3). The surplus valid stations are spares for rescued sailors. Deck heights come from vertical-line hits on a throwaway model of each type and nation, made one time in `init`. A station that would be in the air, inside superstructure or without head room is dropped. Each deck sailor also gets a walkable lane along x.
- `WW.crew.update` runs each frame on real time. Sailors idle, sway, look around and walk a step along their lane. Two of them run to the worst fire site (`ship.dmgSites`) or to a fresh hit (`shipHit`). The PT boat gunner turns with his mount. When the ship sinks, the sailors go below or run to the rail and jump. A sailor whose feet go under water is hidden. A submarine's crew shows only while it is surfaced. Ships more than `FAR` (115) units from the camera are skipped. Wrecks have no crew.
- `WW.lifeboats.update` runs on simulation time. 1.2 s into a sinking, whaleboats (carrier 4, battleship 3, cruiser 2) or 1 raft (destroyer, submarine, PT boat) launch from the sides. Every 3 s, each boat picks the nearer goal: a live friendly ship or the shore (a ring search with `WW.terrain.depthAt`, sized from `WW.cfg`). It rows at 1.2 units/s, steers around hulls and keeps off land. A friendly ship picks it up (its sailors join that ship's crew through `WW.crew.adopt`). On land it beaches and its sailors stand on the sand until the round ends. With no goal for 90 s, it fades. The pool has 36 boats.

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

Shells fly on a ballistic arc to a lead point. Accuracy decreases with range. Shells and bombs do not hit a submerged submarine. Torpedoes and depth charges do. `combat.update` also does the anti-aircraft fire of each ship. Combat calls `ship.takeDamage(amount, x, z, kind, cal)`.

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
- **Torpedo combing** (`h.comb`): a track from `WW.intel.torpedoes` that will pass within half a hull length + 6 inside 70 units. After a reaction delay (PT 0.4 s, DD 0.7 s, sub 1 s, CA 1.2 s, CV 1.8 s, BB 2 s), the ship turns parallel to the track, bow or stern on, whichever is the smaller turn, until the torpedo has passed.
- Surface ships (`ai_surface.js`; the order inside `surfaceAI`: sub hunt, then AA cover / press / station / engage, torpedoes, torpedo angling, early combing, the carrier keep-off, and last `crippleHome`):
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
  - **Carrier keep-off**: no surface ship closes inside `CV_KEEP` (108) of a known enemy carrier (contact ≤ 10 s old, moved along its course).
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
  - **Lurk**: the commander's PT station (own flank), pulled to an island cover point within 150 of it (deep water beside land that blocks line of sight; `coverPts()`, sampled once per map). The spot stays at least 0.06 half-map inside the own half and outside known gun reach: `WW.threat` danger, plus heavy ships seen this round and since lost (`ghosts`, kept 240 s, moved along their last course). The wing of a pair lurks 14 beside its leader. At the spot a PT patrols in legs: out stern-on to the enemy at 0.9 throttle, back to the spot at 0.5.
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
};
// Contact: { unit, x, z, heading, speed, seenAt, firstSeenAt, quality: 'visual' | 'radar' | 'sonar' | 'scout' | 'air', by }
// Track: { proj, x, z, h, speed, run, seenAt, firstSeenAt } - one object per running torpedo, dropped when it ends
```

- Every 0.5 s of sim time (both sides in one tick) each side looks for enemy ships and planes. Detection uses no random numbers.
- A ship sees an enemy ship at `R.SEEN[target type] × R.EYE[observer type]` (battleship or carrier 240, cruiser 210, destroyer 170, surfaced sub 70, PT boat 75; a destroyer's eye is 0.85, a PT boat's 0.55, a submerged sub's periscope 0.5). A ship that fired its guns in the last 6 s is seen at `R.FLASH[cal]` (big 400). Land more than 0.4 above the sea between two ships blocks the view (up to 10 samples of `WW.terrain.depthAt`, cached per pair per tick).
- Destroyer sonar finds a submerged sub within 65. Nothing else sees a submerged sub.
- Airborne planes see ships within 100, scouts within 120, with no line-of-sight test. A scout also sets `ship.spottedUntil` / `spottedBy` within 85 for `combat.js` `SPOT_DISP`.
- Ships see planes at `R.SEE_PLANE` (carrier 170, battleship and cruiser 130, destroyer 110). `R.SEE_PLANE_NATION` overrides it per nation (USN carrier radar 250, quality `'radar'` beyond the visual range). Planes see planes within 100.
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
  posture,                                 // 'search' | 'approach' | 'engage' | 'withdraw' | 'press'
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
  fit, hadFit, brokenAt,                   // fit: own BB / CA / DD at >= CRIP hp; brokenAt: sim time the side lost its last
                                           // one (0 while it has one; never set for a side that never had one)
  airRaid: { carrier, n } | null,          // armed enemy bombers detected within 130 of an own carrier
  defend: [{ carrier, enemy, d }],         // per own carrier: nearest known enemy gun ship within 280 (seen in the last 30 s)
  sectors: [{ x, z, looked, stale, prio }] // 6 x 4 scout sectors
};
Order = { ship, group, role, slot, sx, sz, t };
// group: 'main' | 'carrier' | 'screen' | 'flotilla' | 'pt' | 'sub'
// role:  'line' | 'carrier' | 'escort' | 'asw' | 'torpedo' | 'ambush' | 'patrol' | 'withdraw'
// (sx, sz): the formation station. It is clamped 30 units inside the map; land is the nav layer's job.
```

- **Posture**: `withdraw` after 60 s once the side is *broken* (`brokenAt`: no battleship, cruiser or destroyer left at ≥ `CRIP` hp, after having had one), whatever the ratio says; main.js then ends the round when the side has got clear ("retires"). Otherwise `search` while the side has no contacts. `withdraw` after 60 s if the known strength ratio is below `doctrine.withdrawRatio`. `press` late in the round if the ratio is at least `pressRatio × (1.15 − 0.3 × aggression)`. Otherwise `engage` when any known enemy is within 260 of an own ship, else `approach`. Carriers never press.
- **Groups** (`WW.fleetGroups.assign`):
  - carriers go to `carrier`, together with the first cruiser (when there are 2 or more) and the first destroyer as escorts;
  - battleships and the other cruisers go to `main`;
  - one destroyer goes to `screen` (ASW), then up to `doctrine.flotilla` destroyers to `flotilla`, and any extra destroyers back to `screen`;
  - PT boats go to `pt`, submarines to `sub`;
  - any ship (not a sub) below `WW.fleetGroups.CRIP = 0.35` hp gets role `withdraw`.
- **Stations** (`WW.fleetGroups.stations`) are offsets (forward, lateral) along `axis.h`:
  - main: line abreast at lateral 0, ±45, ±90, …, advanced by the posture lead (search / approach +45, press +35, engage 0, withdraw −45);
  - carriers: `cvStandoff` behind the main guide (the guide is the centroid of the main group's ships that are not withdrawing cripples), in the band 0.15–0.35 of the width from the own edge; while the side withdraws, straight home to 0.08–0.1 of the width at the carrier's own z. Then `cvSafe` slides the station away from every known enemy gun ship (contacts ≤ 60 s) to 1.9 × its gun range + 20;
  - escorts: a ring about 80 out around the first carrier;
  - screen: `screenAhead` ahead of the main body;
  - flotilla: on the flanks (lateral ±110);
  - PT boats: lateral ±150, never past the midline;
  - subs: 220 ahead, ±100 to the flank;
  - withdrawing ships: 70 behind their own carrier (or the main body).
- **Focus** (per gun group): the 1 or 2 best fresh targets from the group's guide, scored by group weight × `VALUE` × damage × proximity. `incoming` is rebuilt every tick from every own ship's `ship.target` (gun dps in range × 0.35). A target is saturated when its incoming fire kills it within 20 s; the shooter's own share is not counted.
- **Carrier defence**: each `defend` enemy is the carrier group's focus and scores ×3 as a strike target (self-defence first).
- **Strikes**: for each carrier, the best contact that is at most 45 s old and within 650 of it. The score is value × damage × freshness, divided by distance and by the AA around the target (from the AA channel of the danger field). With no such contact there is no order. `hold` is set while that carrier is under an air raid.

#### Doctrine (WW.fleetGroups.BASE, rolled ±10% per round)

| field | USN | IJN | used by |
|---|---|---|---|
| aggression | 0.5 | 0.65 | press threshold |
| rangeFrac | 0.84 | 0.78 | battleship / cruiser preferred range (× main battery range); USN 0.84: its battleships were sunk more often (42% vs 34% of those fielded, torpedoes and shells), see AI_DESIGN §4 |
| torpedo | 0.35 | 0.8 | launch distance (× torpedo range: 0.6 + 0.3 × torpedo) |
| carrier | 0.8 | 0.55 | strike tempo (interval × (1.25 − 0.5 × carrier)) |
| night | 0.2 | 0.8 | how much closer the side fights when it presses (`prefRange` × (0.72 + 0.15 × (1 − night))) |
| cvStandoff | 230 | 200 | carrier station behind the main body |
| screenAhead | 70 | 60 | ASW screen station |
| flotilla | 1 | 2 | destroyers in the torpedo flotilla |
| pressRatio / withdrawRatio | 1.2 / 0.45 | 1.1 / 0.4 | posture |
| risk (cv, bb, ca, dd, ss, pt) | 0, .55, .45, .45, .35, .2 | 0, .5, .55, .6, .4, .3 | `WW.threat.bestHeading` risk tolerance |

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
- Overlay (`ai_threat_view.js`, `WW.threatView.toggle()`, key **G**): visual only and off by default. G cycles off → USN picture → IJN picture. It tints the sea red where the guns and torpedoes reach and blue under the AA umbrella. It shows a ring at each enemy contact's last-known position: coloured while fresh, grey and fading with age. A label shows the side's posture. Use it with the map camera (C) to see each side's contact picture.

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
- **Scouts**: `Scout.prototype.plan` flies a sweep round `WW.fleetCmd.scoutPoint` when there is one, and pushes search legs 110 out from known enemy carriers (their CAP).
- **Events**: `airOrder` `{ carrier, squadron, order, plane, leader, target, squadrons, raid }`, order one of `launch`, `cap`, `scramble`, `relief`, `recall`, `jettison`, `reform`, `rejoin`, `strikeAway`, `cag`, `attack`, `redirect`.
- **Captions** (`air_captions.js`, visual only): it wraps `WW.cam.update` and, every 0.25 s of real time, looks at the director's shot (`WW.cam._shot()`: its subject, or the diving plane of an orbit). If that subject has a squadron moment it shows a small caption (`WW.ui.caption(main, sub, 4.5, true)`): "VT-6 begins its run", "VB-6 pushes over", "Lt. Cmdr. X leads VB-6 in", "Strike away: VF-6, VB-6, VT-6", "CAP vectored to raid" with a compass bearing and distance, an ace's kill. At most one air caption every 15 s of real time, none in free camera, map view, or while another caption (the victory card) shows. It adds camera candidates for the CAG leading a strike in and a CAP element in formation (`WW.camHooks`).
- Tests: `tests/sim_behaviour.js` (cap_bkills: CAP gun kills on bombers per round, cap_on_bmb, cap_gap, esc_with, elem_coh, air_sync, bomb_lost, jettisons), `tests/air_probe.js` (one carrier round's air picture), `tests/air_shots.js` (screenshots, `tests/shots/air_*.png`).

### air_aces.js

Each carrier plane gets a pilot (`plane.pilot = { name, kills, sorties, ace }`) from its carrier's roster. A pilot who lands goes back to the roster and flies again. A pilot who is shot down or ditches is lost. A roster belongs to a carrier slot (the n-th carrier of a nation), so surviving pilots carry over into the next round. When a plane is shot down, the kill goes to the pilot of `victim.killedBy`. If `killedBy` is missing, it goes to an enemy plane whose `foe` is the victim. An AA kill (`killedBy` is a ship) gives no pilot credit. At 5 kills the pilot becomes an ace: `plane.ace = true`, `plane.kills`, `plane.skill`, +5% speed, +15% hp, and small pooled kill marks on both fuselage sides. The module emits the `ace` event. It wraps `WW.air.update`, `WW.air.clearAll`, `Plane.prototype.shotDown` and `Plane.prototype.ditch`. `WW.aces.infoText()` adds the ace count to the UI info line.

### air_scouts.js, models_scout.js

Each cruiser and battleship has one floatplane on its catapult (USN: Kingfisher-style monoplane, IJN: Pete-style biplane, both with one centre float and two wing floats). 5 to 25 s into a round, the catapult trains outboard and fires. The plane on the catapult model (`ship.model.floatplane`, from models_detail.js) is hidden while the scout flies. The scout is a `WW.Scout` (a `WW.Plane` with kind `'scout'`, `WW.PLANE_TYPES.scout`) in `WW.world.planes`, so fighters, AA and the camera see it. Its states are `catapult`, `transit` (search), `return`, `alight` and `afloat`. Other states, such as `falling` and `ditch`, use the Plane code. It flies a search arc 90 units from the centre of the enemy contacts (`WW.intel.centre`) on the near side, or around the middle of the enemy's half of the map when nothing is known. `intel.js` does its spotting: it reports contacts and sets `ship.spottedUntil = now + 20` (and `ship.spottedBy`) on enemy ships within 85 units. In `combat.fireShell`, the dispersion of a shot at a spotted target farther than 60 units is multiplied by `SPOT_DISP = 0.85`. After 130 s (the first approximately 35 s are the flight out on the big map), or below 50% hp, the scout flies home, alights beside its ship, taxis alongside for approximately 3.5 s and is taken back aboard. There are at most 2 sorties per ship, with 50 s between them.

`camera.js` `candidates()` calls each function in `WW.camHooks` (`fn(add, dur)`). The aces module adds aces in dogfights. The scouts module adds catapult launches and alightings.

`air_deaths.js` decides how a plane dies. `Plane.shotDown()`, `ditch()` and the crippled branch of `damage()` call `WW.airDeaths`; a plane with `deathMode` set is updated by `WW.airDeaths.updatePlane`. Modes: `spin`, `wing` (hides `model.wingL` or `wingR` and drops a pooled copy), `comet`, `crash` (rarely dives into a nearby enemy ship: `ship.takeDamage(.., 'bomb')`), `ditch` then `ditched` (floats tail-up 20 to 30 s with a raft, then sinks), `abandon` (crew bails out of a crippled plane) and `slide` (`WW.airDeaths.slideOff(plane, side)` tips a plane off a carrier deck). Some falling planes drop a parachute that drifts with `WW.wind` and leaves a raft. The mode choice uses `WW.rand`; `plane.killedBy === 'aa'` favours comets. `restore(model)` (from `release`) shows both wings again. `WW.airDeaths.force(mode)` forces a death for tests (`tests/deaths.js`).

### camera.js, freecam.js, camera_story.js

- `WW.cam` (director): it selects a live subject (a sinking, a torpedo or dive-bomb attack, a carrier launch, a dogfight, a burning ship or a battleship that fires). It films the subject for 12 to 25 s with a slow orbit, chase, fly-by or wide shot, then cross-fades in 1.4 s. Every second shot is a wide shot. A wide shot or diorama orbit looks at the front line when the nearest enemy ships are less than 280 units apart, and otherwise at one fleet on its approach. The opening shot of a round shows one fleet side-on. The subject stays in the middle third of the frame. The camera stays more than 7 units from a hull and above the terrain. Setup mode and map view (`C`) use a high overview.
- `WW.camAction` (`camera_action.js`) adds action shots to the director. When the director films a dive-bomb attack and the bomb falls, the camera follows the bomb to the impact and holds on the explosion. When it films a torpedo run and the plane drops its torpedo, the camera follows the wake to the hit or the miss. These hand-offs do not cut. They change the current shot. A fighter with a foe can get an over-the-shoulder shot: behind and above the fighter, its foe ahead, with a slow, rate-limited turn. Planes with `kills` or `ace` (if present) get a higher priority. `combat_weapons.js` sends the events `weaponDropped` `{ kind: 'bomb' | 'torpedo', proj, plane, target }` and `weaponImpact` `{ kind, proj, x, z, ship }` (`ship` is null for a miss). Test hook: `WW.cam.film(candidate)`; `tests/action_cam.js` records each action shot.
- `WW.freecam`: left-drag orbits, the wheel zooms, right-drag and `W` `A` `S` `D` pan, `Q` and `E` turn, `R` / `V` (or `Page Up` / `Page Down`) raise and lower. A click follows a ship. A click on a plane starts a story on it (`WW.camStory.follow`) and gives the camera back to the director. After 20 s with no input, the director starts again. `WW.freecam.release()` ends the free camera at once.
- `WW.camStory` (`camera_story.js`, story mode): every 2 to 4 min (never back-to-back: 120 to 220 s of normal director shots between stories, the first one 30 to 60 s into a round), when a good arc is available, the director picks a protagonist and follows its mission for 1 to 3 min of real time. Arcs (`bestArc()`): a strike wave (its CAG, or the leader of its torpedo or dive element; 9 while it forms up, 7 in transit, 4 near the target), a CAP fighter leader within 40 sim s of a `scramble` order from its carrier (8) or engaging bombers (6), an airborne ace (5); an arc needs 7, and the squadron of the last story gets −3. An automatic story starts when the director's current shot ends (it never cuts an action shot); the `F` key and a free-camera click start one at once.
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
- `kill`: one side has no ships;
- `retire` (`retiring()` in main.js): a side's commander has been broken (posture `withdraw`, no fit BB / CA / DD, `brokenAt`) for 30 s, the round is past 120 s, the side still has a ship that is not a submarine, and every such ship is either in its home band (0.18 of the width from its own edge) or has not been seen by the enemy (`WW.intel`) for 45 s. The other side wins. If both sides qualify at once, neither retires;
- `stall`: only submarines are left and nothing sinks for 60 s (tonnage decides);
- `time`: the time limit (420 simulation seconds, 14 minutes at 1×); the side with more tonnage wins.

`tests/sim_rounds.js` and `tests/sim_behaviour.js` report each round's end reason (kill / retire / time / cap). The behaviour suite's `cv_closing` judges a carrier on its own side's picture (`WW.intel.known`, last-known positions), not raw positions.

`endRound` emits `victory` `{ winner, round, reason, loser }`. The caption shows "<winner> victory" for 9 s, with "<loser> fleet retires" as the subtitle after a retire, else the ships each side lost.

`ui.js` shows the panels only in setup mode. In battle, `H` shows the panel. It also controls the captions, the tilt-shift bands (`T`) and fullscreen. There is no letterbox.
