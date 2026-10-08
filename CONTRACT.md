# Module contract

All agents use this contract. Do not change a name or a signature here without telling the other agents.

## Rules

- Plain classic `<script>` files. No ES modules. No build step. The page must work from `file://`.
- All code goes in the global namespace `window.WW`. Each file starts with `window.WW = window.WW || {};`.
- A module must not touch `WW.scene` when the file loads. It does that work in its `init()`. `main.js` calls each `init()` after it makes the scene.
- Keep each file under about 400 lines. If a file gets bigger, split it (for example `ships.js` + `ships_ai.js`) and tell the integrator the new load order.
- Never make a new geometry or material for each projectile, particle or plane. Cache and share them. Use object pools for projectiles and particles. On `clearAll()`, remove objects from the scene and put them back in the pool.

## Load order (index.html)

```
vendor/three.min.js   (Three.js r149 UMD, global THREE)
js/core.js            owner: A
js/terrain.js         owner: A
js/models.js          owner: B
js/models_planes.js   owner: B   (buildPlane; result also has optional `payload` mesh: hide it on bomb/torpedo drop)
js/effects.js         owner: B
js/combat.js          owner: D
js/combat_weapons.js  owner: D   (torpedoes, bombs, depth charges)
js/ships.js           owner: C
js/ships_ai.js        owner: C   (WW.shipAI)
js/aircraft.js        owner: C
js/camera.js          integrator (WW.cam: track / map camera; main calls init, resize, update)
js/ui.js              owner: A
js/main.js            owner: A
```

## World coordinates

- Units: 1 unit = about 2 m. The map is `WW.cfg.MAP_W` (x, 0 → 480) by `WW.cfg.MAP_H` (z, 0 → 300). Sea level is y = 0. Up is +y.
- Heading `h` is in radians. It is measured from +x toward +z. Forward vector = `(cos h, 0, sin h)`.
- Every model (ship and plane) is built with its bow / nose on local **+x**. To show heading `h`, set `group.rotation.y = -h`.
- A ship hull length is about: carrier 26, battleship 24, cruiser 18, destroyer 12, submarine 10, PT boat 5 units. Models use these lengths.

## core.js (A)

```js
WW.cfg = { MAP_W: 480, MAP_H: 300, CELL: 2, ROUND_TIMEOUT: 330 /* sim seconds */ };  // ship hp below is scaled x1.6 at load
WW.rand(); WW.randRange(a,b); WW.randInt(a,b); WW.pick(arr); WW.clamp(v,a,b); WW.lerp(a,b,t);
WW.angleDiff(a,b)  // signed shortest diff b-a in (-PI, PI]
WW.dist(ax,az,bx,bz); WW.dist2(ax,az,bx,bz);
WW.on(name, fn); WW.emit(name, data);   // simple event bus
WW.time = { now: 0, dt: 0, scale: 1 };  // sim time in seconds, set by main
WW.scene; WW.camera; WW.renderer;       // set by main before init() calls
WW.stats = { planesLaunched:0, planesLanded:0, planesLost:0, shellsFired:0, torpedoesFired:0,
             bombsDropped:0, depthCharges:0, hits:0, shipsSunk:0, round:0 };
WW.NATIONS = {
  USN: { id:'USN', name:'USN', hull:0x7d8a99, deck:0x9a8f78, super:0x6c7a8a, accent:0x2b4f8c, mark:'star', ui:'#7fb2ff' },
  IJN: { id:'IJN', name:'IJN', hull:0x6b7366, deck:0x8c7a5a, super:0x5d6658, accent:0xb02a2a, mark:'disc', ui:'#ff7a6b' }
};
WW.enemyOf = n => n === 'USN' ? 'IJN' : 'USN';
WW.SHIP_TYPES = {
  carrier:    { name:'Carrier',    hp:900, speed:5.0, turn:0.25, length:26, minDepth:6, tons:30000,
                guns:[{cal:'small', count:2, range:60, reload:3}], aa:{range:45, dps:6},
                planes:{ fighter:6, dive:4, torpedo:4 }, torpedoes:null, depthCharges:false },
  battleship: { name:'Battleship', hp:1200, speed:4.2, turn:0.22, length:24, minDepth:7, tons:45000,
                guns:[{cal:'big', count:3, range:170, reload:9}, {cal:'small', count:2, range:60, reload:3}], aa:{range:40, dps:7},
                planes:null, torpedoes:null, depthCharges:false },
  cruiser:    { name:'Cruiser',    hp:650, speed:5.5, turn:0.35, length:18, minDepth:5, tons:12000,
                guns:[{cal:'med', count:3, range:120, reload:5}], aa:{range:42, dps:8},
                planes:null, torpedoes:{count:4, range:110, reload:40}, depthCharges:false },
  destroyer:  { name:'Destroyer',  hp:300, speed:7.5, turn:0.6, length:12, minDepth:3, tons:2000,
                guns:[{cal:'small', count:2, range:70, reload:2.5}], aa:{range:30, dps:3},
                planes:null, torpedoes:{count:4, range:100, reload:30}, depthCharges:true },
  submarine:  { name:'Submarine',  hp:200, speed:3.5, turn:0.4, length:10, minDepth:9, tons:1500,
                guns:[], aa:null, planes:null, torpedoes:{count:2, range:120, reload:25}, depthCharges:false },
  pt:         { name:'PT Boat',    hp:80,  speed:11,  turn:1.2, length:5,  minDepth:1.5, tons:50,
                guns:[{cal:'mg', count:1, range:35, reload:0.4}], aa:{range:20, dps:1},
                planes:null, torpedoes:{count:2, range:70, reload:35}, depthCharges:false }
};
WW.SHELL = { mg:{dmg:2, speed:120, splash:0.6}, small:{dmg:12, speed:90, splash:1.2},
             med:{dmg:35, speed:80, splash:2}, big:{dmg:110, speed:70, splash:3.5} };
WW.TORPEDO = { dmg:220, speed:14 };  WW.BOMB = { dmg:180 };  WW.DEPTH_CHARGE = { dmg:120, radius:6 };
WW.PLANE_TYPES = { fighter:{hp:20, speed:38, range:500}, dive:{hp:28, speed:30, range:500}, torpedo:{hp:30, speed:26, range:500} };
WW.world = { ships: [], planes: [] };   // filled by ships.js / aircraft.js
```

## terrain.js (A)

```js
WW.terrain = {
  init(),                        // nothing heavy
  generate(seed),                // build a new map + meshes (sea floor colour bands, water, islands, palms). Dispose the old one.
  depthAt(x, z) -> number,       // water depth in units. <= 0 means land. Off-map returns 0 (treat as blocked).
  isNavigable(x, z, minDepth) -> bool,
  randomSeaPoint(minDepth, xMin, xMax) -> {x, z}   // random point with enough depth, x in [xMin, xMax]
  update(dt)                     // animate water
};
```

## models.js (B)

```js
WW.models = {
  init(),
  buildShip(type, nation) -> {
    group,            // THREE.Group, bow on +x, waterline at y = 0
    turrets: [ { obj, barrel, cal } ],   // obj rotates around y to aim (local angle 0 = forward). barrel: Object3D at muzzle tip (use getWorldPosition).
    stacks: [ Object3D ],                // funnel tops, for smoke
    deck: Object3D | null,               // carrier only: deck centre, y = deck height
    hullMats: [ Material ]               // per-instance materials that main/ships may tint when damaged (clone ONLY these few)
  },
  buildPlane(kind, nation) -> { group, prop }   // nose on +x, about 2.5 units long. prop spins around x.
};
```

## effects.js (B)

All effects are pooled and placed in world coordinates.

```js
WW.fx = {
  init(), update(dt), clearAll(),
  splash(x, z, size),            // white water column, size 0.5 → 4
  explosion(x, y, z, size),      // fireball + debris
  muzzleFlash(x, y, z),
  flak(x, y, z),                 // small black AA burst in the air
  smoke(x, y, z, dark, size),    // one puff that rises and fades
  fire(x, y, z)                  // short flame flicker (ships call this each frame while burning)
  wake(x, z, heading, size),     // short foam trail puff
  oilSlick(x, z, size),          // dark patch on the water that fades slowly
  sparks(x, y, z)
};
```

## combat.js (D)

Combat owns all projectiles and AA.

```js
WW.combat = {
  init(), update(dt), clearAll(),
  fireShell(ship, turret, target, cal),   // ballistic arc from turret.barrel world pos to a lead point on target. Hit chance falls with range. Miss → splash. Hit → target.takeDamage(...)
  fireTorpedo(owner, x, z, heading, nation, range),  // runs at water level with a wake. Hits the first enemy SURFACE ship or submerged sub it touches. Stops on land.
  dropBomb(plane, target),                // falls from plane to target position
  dropDepthCharge(ship, x, z),            // sinks, then blows up after ~2 s. Damages subs within radius.
  // AA: in update(), for each live ship with stats.aa, shoot at the nearest enemy plane in range:
  // tracers + WW.fx.flak, and call plane.damage(stats.aa.dps * dt * hitChance).
};
```

`combat.js` increases the `WW.stats` counters for shells, torpedoes, bombs, depth charges and hits.

## ships.js (C)

```js
class WW.Ship {
  id, type, stats, nation, x, z, heading, speed, hp, maxHp,
  alive,        // false after it starts to sink
  sinking,      // true while the sink animation plays
  submerged,    // submarine only
  group,        // from WW.models.buildShip
  model,        // the full buildShip result
  update(dt),
  takeDamage(amount, x, z),   // starts fires / smoke under 60% hp. At 0 hp: explosion, emit('shipSunk', ship), stats.shipsSunk++, sink animation (list + go under ~8 s), oil slick, then remove from scene and from WW.world.ships.
}
WW.ships = {
  init(), update(dt), clearAll(),
  spawn(type, nation, x, z, heading) -> Ship,
  alive(nation) -> Ship[],     // live ships of that nation
};
```

Ship AI (also in ships.js, or in ships_ai.js): choose a target, keep a range that suits the weapons, stay in loose groups, never enter water shallower than `stats.minDepth` (use `WW.terrain.isNavigable` look-ahead and steer away). Turrets turn to aim. Destroyers hunt subs with depth charges. Subs stay submerged, surface sometimes. Carriers stay back and launch strikes with `WW.air.launch`.

## aircraft.js (C)

```js
WW.air = {
  init(), update(dt), clearAll(),
  launch(carrier, kind, target) -> Plane | null   // only if the carrier has that plane kind in its hangar
};
// Plane: { kind, nation, carrier, x, y, z, heading, hp, alive, state, group,
//          damage(amount) }   // at 0 hp: smoke trail, fall, splash, stats.planesLost++
```

Planes take off from `carrier.model.deck`, fly to the target, and attack (dive bombers dive and call `WW.combat.dropBomb`; torpedo bombers fly low and call `WW.combat.fireTorpedo`; fighters escort and dogfight enemy planes). Survivors fly back, land on the deck (`stats.planesLanded++`), and go back into the hangar to rearm. If the carrier sinks, its planes in the air ditch. `stats.planesLaunched++` at take-off.

## main.js + ui.js (A)

```js
WW.game = {
  mode: 'auto' | 'setup',
  state: 'setup' | 'battle' | 'victory',
  composition: null | [ { type, nation, x, z } ],   // set by placement UI
  startRound(),          // new seed → terrain.generate → clearAll on all modules → spawn fleets (composition re-positioned on the new map, else random fleets on opposite sides) → state 'battle'
  winner: null | 'USN' | 'IJN'
};
window.__sim = { stats: WW.stats, game: WW.game, world: WW.world, fastForward(seconds, onStep?), setScale(n),
                 focus(x, z, width, holdSeconds), snapCamera() };   // focus / snapCamera are test hooks
```

Main loop order each frame: `WW.terrain.update`, `WW.ships.update`, `WW.air.update`, `WW.combat.update`, `WW.fx.update`, `WW.ui.update`, render. Clamp the sim step to 0.05 s and do sub-steps at high time scale. `fastForward(s)` runs sim steps without rendering.
