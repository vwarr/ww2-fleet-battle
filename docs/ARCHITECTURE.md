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
js/ships_ai.js          WW.shipAI: targets, guns, torpedoes, behaviour per ship type
js/aircraft.js          WW.air, WW.Plane: carrier planes
js/air_aces.js          WW.aces: pilots, kill credit, aces and kill marks
js/air_scouts.js        WW.scouts, WW.Scout: catapult scout floatplanes and spotting
js/air_props.js         WW.airProps: pooled parachutes, life rafts, sheared-off wings
js/lifeboats.js         WW.lifeboats: a sinking ship's boats row to a friendly ship or the shore
js/air_deaths.js        WW.airDeaths: shoot-down / ditch / bail-out / deck slide-off deaths
js/air_deck.js          WW.airDeck: deck parking, wing folding, takeoff runs, into-the-wind turns, landing pattern
js/air_fx.js            WW.airFx: prop disc, dive brakes, wing-tip vapour, exhaust flicker, canopy glint
js/air_strikes.js       WW.strike: strike waves (form-up, vics), sequential dive bombing, anvil torpedo attack
js/camera.js            WW.cam: director camera and map camera
js/freecam.js           WW.freecam: camera that the user controls
js/camera_action.js     WW.camAction: bomb / torpedo hand-offs, over-the-shoulder shot, slow motion
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
   1. `WW.terrain.update`, then `WW.intel.update` (contact tables, every 0.5 s)
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
  carrier:    { hp:900,  speed:5.0, turn:0.25, length:26, minDepth:6,   tons:30000, planes:{ fighter:6, dive:4, torpedo:4 }, ... },
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
WW.shipAI = { setup(ship), update(ship, dt) };
```

- Navigation: `ships_nav.js` checks points along the keel and on the two sides of each hull. All points must be at a depth of 0.5 or more. If a move is not permitted, the ship tries a smaller turn, a turn in place, astern with a turn, a slow forward move, then straight astern.
- If a ship pivots against shallow water for more than 2 s, it goes to the heading with the most clear water.
- Spacing: each type has a personal space (carrier 70, battleship and cruiser 35, destroyer 20, PT boat and submarine 12). Escorts stay 50 to 80 units from their carrier.
- After all ships move, `WW.shipNav.resolve` pushes overlapping hulls apart. The lighter ship moves more. Wrecks above the water and sinking ships do not move.
- Sinking takes approximately 8 s. The ship moves at most 15 units and does not go into another wreck or onto land. The wreck stays on the seabed until the next round. In shallow water, one end of the wreck stays above the water.
- A submarine must come to the surface for 25 s after 45 s under water. A submerged submarine casts no shadow.
- Ship AI: each ship selects a target and keeps a range that is correct for its weapons. Destroyers find submarines in a 65-unit radius and attack with depth charges. PT boats move in fast, fire torpedoes and move away. Carriers stay back and launch strikes. Late in a round, they move nearer to the enemy.
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
  age(contact) -> s, R, T, stats             // R: every detection range, T: timing (one table each, top of intel.js)
};
// Contact: { unit, x, z, heading, speed, seenAt, firstSeenAt, quality: 'visual' | 'sonar' | 'scout' | 'air', by }
```

- Every 0.5 s of sim time (both sides in one tick) each side looks for enemy ships and planes. Detection uses no random numbers.
- A ship sees an enemy ship at `R.SEEN[target type] × R.EYE[observer type]` (battleship or carrier 240, cruiser 210, destroyer 170, surfaced sub 70, PT boat 75; a destroyer's eye is 0.85, a PT boat's 0.55, a submerged sub's periscope 0.5). A ship that fired its guns in the last 6 s is seen at `R.FLASH[cal]` (big 400). Land more than 0.4 above the sea between two ships blocks the view (up to 10 samples of `WW.terrain.depthAt`, cached per pair per tick).
- Destroyer sonar finds a submerged sub within 65. Nothing else sees a submerged sub.
- Airborne planes see ships within 100, scouts within 120, with no line-of-sight test. A scout also sets `ship.spottedUntil` / `spottedBy` within 85 for `combat.js` `SPOT_DISP`.
- Ships see planes at `R.SEE_PLANE` (carrier 170, battleship and cruiser 130, destroyer 110). Planes see planes within 100.
- A contact keeps its last-seen position. It is dropped after 90 s (ships) or 10 s (planes) out of sight, or when the unit dies.
- Events: `contact` `{ nation, unit, first, by }` when an enemy ship is sighted for the first time this round (`first: true`) or again after 30 s out of sight; `firstSighting` `{ nation, unit }` once per side per enemy carrier or battleship.
- What uses it: `ships_ai.js` retarget, guns, torpedoes, idle search, sub hunt, `pickStrikeTarget` (contacts up to 45 s old) and the carrier's CAP scan; `aircraft.js` fighter scan and `validTarget`; `air_strikes.js` (a wave flies to the last-known position); `air_scouts.js` search area; `combat_aa.js` target choice. Hit tests, flak bursts, crash targets and dogfight tail checks stay omniscient. The camera is omniscient.

### aircraft.js

```js
WW.air = { init(), update(dt), clearAll(), launch(carrier, kind, target) -> Plane | null };
// Plane: kind, nation, carrier, x, y, z, heading, hp, alive, state, group, damage(amount)
```

Planes take off from the carrier deck, fly to the target and attack. Dive bombers dive and drop bombs. Torpedo bombers fly low and drop torpedoes. Fighters escort the bombers and fight enemy planes. Planes that survive fly back, land and rearm in 10 s. If the carrier sinks, its planes in the air ditch. A damaged plane trails smoke (grey below 50% hp, charcoal below 30% hp). A plane with less than 35% hp can drop its weapon and fly home.

### air_aces.js

Each carrier plane gets a pilot (`plane.pilot = { name, kills, sorties, ace }`) from its carrier's roster. A pilot who lands goes back to the roster and flies again. A pilot who is shot down or ditches is lost. A roster belongs to a carrier slot (the n-th carrier of a nation), so surviving pilots carry over into the next round. When a plane is shot down, the kill goes to the pilot of `victim.killedBy`. If `killedBy` is missing, it goes to an enemy plane whose `foe` is the victim. An AA kill (`killedBy` is a ship) gives no pilot credit. At 5 kills the pilot becomes an ace: `plane.ace = true`, `plane.kills`, `plane.skill`, +5% speed, +15% hp, and small pooled kill marks on both fuselage sides. The module emits the `ace` event. It wraps `WW.air.update`, `WW.air.clearAll`, `Plane.prototype.shotDown` and `Plane.prototype.ditch`. `WW.aces.infoText()` adds the ace count to the UI info line.

### air_scouts.js, models_scout.js

Each cruiser and battleship has one floatplane on its catapult (USN: Kingfisher-style monoplane, IJN: Pete-style biplane, both with one centre float and two wing floats). 5 to 25 s into a round, the catapult trains outboard and fires. The plane on the catapult model (`ship.model.floatplane`, from models_detail.js) is hidden while the scout flies. The scout is a `WW.Scout` (a `WW.Plane` with kind `'scout'`, `WW.PLANE_TYPES.scout`) in `WW.world.planes`, so fighters, AA and the camera see it. Its states are `catapult`, `transit` (search), `return`, `alight` and `afloat`. Other states, such as `falling` and `ditch`, use the Plane code. It flies a search arc 90 units from the centre of the enemy contacts (`WW.intel.centre`) on the near side, or around the middle of the enemy's half of the map when nothing is known. `intel.js` does its spotting: it reports contacts and sets `ship.spottedUntil = now + 20` (and `ship.spottedBy`) on enemy ships within 85 units. In `combat.fireShell`, the dispersion of a shot at a spotted target farther than 60 units is multiplied by `SPOT_DISP = 0.85`. After 130 s (the first approximately 35 s are the flight out on the big map), or below 50% hp, the scout flies home, alights beside its ship, taxis alongside for approximately 3.5 s and is taken back aboard. There are at most 2 sorties per ship, with 50 s between them.

`camera.js` `candidates()` calls each function in `WW.camHooks` (`fn(add, dur)`). The aces module adds aces in dogfights. The scouts module adds catapult launches and alightings.

`air_deaths.js` decides how a plane dies. `Plane.shotDown()`, `ditch()` and the crippled branch of `damage()` call `WW.airDeaths`; a plane with `deathMode` set is updated by `WW.airDeaths.updatePlane`. Modes: `spin`, `wing` (hides `model.wingL` or `wingR` and drops a pooled copy), `comet`, `crash` (rarely dives into a nearby enemy ship: `ship.takeDamage(.., 'bomb')`), `ditch` then `ditched` (floats tail-up 20 to 30 s with a raft, then sinks), `abandon` (crew bails out of a crippled plane) and `slide` (`WW.airDeaths.slideOff(plane, side)` tips a plane off a carrier deck). Some falling planes drop a parachute that drifts with `WW.wind` and leaves a raft. The mode choice uses `WW.rand`; `plane.killedBy === 'aa'` favours comets. `restore(model)` (from `release`) shows both wings again. `WW.airDeaths.force(mode)` forces a death for tests (`tests/deaths.js`).

### camera.js, freecam.js

- `WW.cam` (director): it selects a live subject (a sinking, a torpedo or dive-bomb attack, a carrier launch, a dogfight, a burning ship or a battleship that fires). It films the subject for 12 to 25 s with a slow orbit, chase, fly-by or wide shot, then cross-fades in 1.4 s. Every second shot is a wide shot. A wide shot or diorama orbit looks at the front line when the nearest enemy ships are less than 280 units apart, and otherwise at one fleet on its approach. The opening shot of a round shows one fleet side-on. The subject stays in the middle third of the frame. The camera stays more than 7 units from a hull and above the terrain. Setup mode and map view (`C`) use a high overview.
- `WW.camAction` (`camera_action.js`) adds action shots to the director. When the director films a dive-bomb attack and the bomb falls, the camera follows the bomb to the impact and holds on the explosion. When it films a torpedo run and the plane drops its torpedo, the camera follows the wake to the hit or the miss. These hand-offs do not cut. They change the current shot. A fighter with a foe can get an over-the-shoulder shot: behind and above the fighter, its foe ahead, with a slow, rate-limited turn. Planes with `kills` or `ace` (if present) get a higher priority. `combat_weapons.js` sends the events `weaponDropped` `{ kind: 'bomb' | 'torpedo', proj, plane, target }` and `weaponImpact` `{ kind, proj, x, z, ship }` (`ship` is null for a miss). Test hook: `WW.cam.film(candidate)`; `tests/action_cam.js` records each action shot.
- `WW.freecam`: left-drag orbits, the wheel zooms, right-drag and `W` `A` `S` `D` pan, `Q` and `E` turn. A click follows a ship or a plane. After 20 s with no input, the director starts again.

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
  enterSetup(newMap), enterAuto(), randomComposition(), tonnage(nation), endRound(winner), winner
};
window.__sim = { stats, game, world, fastForward(seconds, onStep), setScale(n), focus(x, z, width, hold), snapCamera() };
```

Each side gets 1 carrier (25% chance of 2), 1 to 2 battleships, 2 cruisers, 3 destroyers, 1 submarine and 2 PT boats in a task-force formation. A round ends when one side has no ships, when only submarines are left and nothing sinks for 60 s, or at the time limit (420 simulation seconds, 14 minutes at 1×). At the time limit, the side with more tonnage wins. The victory caption shows for 9 s.

`ui.js` shows the panels only in setup mode. In battle, `H` shows the panel. It also controls the captions, the tilt-shift bands (`T`) and fullscreen. There is no letterbox.
