# Normandy mode: Omaha Beach + Pointe du Hoc, D-Day dawn

## Context
This is a second battle type, completely different from the Pacific fleet battle but in the same toy-toon art style, with the same lighting, post-processing, water and combat model (ballistic gunnery with dispersion, fires, flooding, AA, air strikes). It should feel as if you had **scrolled the existing map until you reached France**. It uses the same sea, scale and camera, but the south edge of the map becomes a continuous French coastline at true scale (1 u ≈ 9.6 m).

Decisions made with the user (2026-10-13):
- **Scope:** a beach assault. Landing craft, infantry, obstacles, bunkers, the bluffs and the draws. No push inland into the bocage.
- **Site:** Omaha Beach (about 830 u) plus the Pointe du Hoc cliffs. This fits on today's 2400×1350 map at true scale.
- **Play:** a self-playing film like the Pacific mode (director camera, plot table, war diary, AAR card). The AI runs both sides, and the setup screen gains a Pacific | Normandy toggle.
- **Forces:** USN and RN (plus the French cruisers) against Germany: WN strongpoints, 88/75/50 mm casemates, MG42s, mortars, the Pointe du Hoc 155s, S-boats and the Luftwaffe.

## Groundwork (checked against the code)
1. **`game.mode` is already used** for `'setup'`/`'auto'` (`main.js:128,167`). Add `WW.game.scenario` (`'pacific'|'normandy'`), a `WW.scenarios[id]` registry and `WW.scn()`.
2. **Friend and foe is `s.nation !== n` everywhere, and `WW.enemyOf` is a fixed literal** (`core.js:70`).
   - `nation` stays the side key: `USN` for all Allied units, a new `GER` for German ones.
   - RN and French hulls carry `flag: 'RN'|'FNFL'`. Only palette, ensign, crew uniform, class picking and doctrine shading read `flag`.
3. **A new nation key crashes in some places and falls back quietly in others.**
   - **Crashes:**
     - `main.js:118` `SIDE[c.nation]`
     - the `['USN','IJN']` loops in `randomComposition`, `repositionComposition`, `deadline` (`:275`) and `updateGame`
     - `endgame.homeX` (`:44`, `:290`)
     - `ships.js:464`
     - `fleet_cmd.js:59-62`
   - **Quiet fallbacks:**
     - `fleet_groups.js:91` `BASE[n] || BASE.USN`
     - the palettes in `models.js:14` and `models_crew.js:108`
     - `island_base` `SEE_PLANE`
     - the tracer colour in `combat.js:149`
   - There are about 170 `USN`/`IJN` literals across about 40 files.
4. **`island_base` is a single object hooked from 7 sim call sites:**
   - `combat.js:198`
   - `combat_weapons.js:147`
   - `combat_aa.js:261`
   - `intel.js:194`
   - `aircraft.js:196`
   - `ai_surface.js:172`
   - `air_staff.js:52`

   There are also `camera_scenes.js:25` and `ui.js:219-226`. Normandy calls `build(null)`, which is the existing "no base" path.
5. **`terrain.heightRaw` forces open sea at the map edges** (`:54-55`). `rawDepth` (`:164`) samples outside the map for the water's depth texture. The Normandy coast function must therefore be defined **past the map edges**, so the coast runs on out of view (the "scrolled to France" feel).
6. **`fireShell` always aims at y = 0** (`combat.js:155`). Use `target.y || 0`, with no extra random draw, so shells reach casemates on the bluff top. Pacific stays bit-identical.
7. **`findHit` only searches `WW.world.ships`.** Anything with `alive` and `takeDamage(amt,x,z,kind,cal)` can be a target. Landing craft and strongpoints follow that contract.
8. **`updateGame` uses USN/IJN literals throughout.** Normandy supplies its own `scn.updateGame` instead of adding branches.
9. **The posture machine and the danger field (`ai_threat.js`) would fight the history.** Three S-boats would count as "beaten", and destroyers would keep away from the coastal guns. Normandy needs its own fire-support posture.
10. **Determinism rules:**
    - New sim modules return early on the scenario check **before** any `WW.rand` call in `roundStart` listeners. `island_base` draws random numbers there (`:308-311`).
    - New update slots go in fixed positions after `islandBase` in `main.js:324-335`.
    - Visuals go in separate `models_*`/`*_fx` files, because `?sim` turns `WW.fx` into no-ops.
11. **Wiring:** follow the `island_base` pattern (build and reset on `roundStart`/`setupStart`), not `bootSim` init lists.
12. **Geography:**
    - North is −z. The coast runs along the **south edge**, so Omaha faces north as it really does.
    - Omaha spans about x 1350–2180.
    - Pointe du Hoc is about x 725 (about 625 u west of Vierville).
    - The Allies, and off-map "England" for aircraft, come in from the north edge.

### Historical corrections to put in the data
- The heavy bombers over Omaha were 8th AF **B-24s**, and they dropped about 3 mi inland because of cloud. The B-26s bombed Utah.
- The two Fw 190s (Priller and Wodarczyk) strafed Sword and Juno. Include them only as an optional flavour setting.
- The Pointe du Hoc 155 mm guns had been moved about 1 km inland into an orchard. Make this a setting: guns in the casemates, or moved.
- The 741st Tank Battalion launched its DD tanks about 5 km out and 27 of 32 sank. The 743rd was landed directly on the beach.
- **Ships:**
  - Gun destroyers: Carmick, McCook, Frankford, Doyle, Emmons, Baldwin, Harding, Thompson, Satterlee, and HMS Talybont. Satterlee and Talybont covered the Rangers.
  - Heavy ships: Texas, Arkansas, HMS Glasgow, Montcalm and Georges Leygues.

## Phases
The order is P1 → P2 → P3 → P4 → (P5 ∥ P6) → P7 → P8 → P9. Each phase can be merged and tested on its own, and each gets a durable brief at `~/.claude/projects/-Users-varunwarrier-Github-ww2-fleet-battle/briefs/normandy_pN.md`.

### P1. Scenario plumbing, nations and setup toggle
- New `js/scenario.js`, loaded early:
  - `WW.scenarios = {pacific, normandy}` with optional hooks: `sides`, `enemyOf`, `terrain`, `composition`, `spawnHeading`, `homeEdge`, `updateGame`, `timeout`, `daylight`.
  - The URL parameter `?scn=normandy` selects the scenario.
- `core.js`: table-driven `enemyOf`, `NATIONS.GER`, and `WW.FLAGS` (RN, FNFL).
- `main.js`: `SIDE`, the composition functions, the spawn heading and `deadline` read `scn.sides`. Add an early return to `scn.updateGame`.
- `endgame.js`: `homeX` becomes a home-edge vector. Escapes are off in Normandy.
- Fix `fleet_cmd.js:59-62` and `ships.js:464`.
- `ui.js`: the Pacific | Normandy toggle.
- New `tests/nation_lint.js`: flags `['USN','IJN']` loops, and `[nation]` lookups with no fallback, in sim files.
- **Gate:** `determinism.js --cross` passes, and `sim_behaviour.js --only standard,midway` matches the baseline.

### P2. Coast terrain
- `terrain_normandy.js` and `terrain_normandy_data.js`: a hand-written cross-shore profile per x station.
  - **Offshore depth:**
    - battleships need depth ≥ 8 at about 400–500 u out
    - destroyers need depth ≥ 4 at about 90–100 u out
  - **Tidal flat:** depth 0–1.5 over a 30–40 u band, at low tide (H-hour).
  - **Shore line:**
    - the shingle bank
    - the sea wall (Vierville to Les Moulins only)
    - the marsh shelf
    - the bluffs at 3–5 u, with a vertical exaggeration setting of about 1.3
    - the five draws (D-1, D-3, E-1, E-3, F-1) as notches
  - **Pointe du Hoc:** a sheer headland jutting north, with cratered ground on top.
  - The noise is seeded and for detail only. The layout is the same on every seed.
- `terrain.js` `generate` calls `scn.terrain.heightRaw` and skips `makeFeatures` and the land-fraction tuning.
- `terrain_normandy_props.js`:
  - villages (Vierville, St-Laurent, Colleville, with church spires)
  - hedgerows
  - obstacle belts: hedgehogs, Belgian gates, and stakes topped with Teller mines. The obstacle positions are sim data.
- The plot-table outlines and the water's depth texture should work without changes.

### P3. A shared list of land targets
- New `js/land_sites.js`: `WW.landSites.register(provider)` with `impact`, `scan`, `shooters`, `roofAt`, `bombardTarget` and `hitTest`.
- `islandBase` registers itself, and the 7 call sites loop over the providers.
- `findHit` also asks each provider's `hitTest`.
- `fireShell` aims at the target's y (Groundwork 6).
- **Gate:** traces from `determinism.js --cross` and `--only midway` are identical.

### P4. German defences
- `coast_defence.js`, `coast_defence_fire.js` and `coast_defence_data.js` (WN60–74 with their real weapons), plus `models_bunker.js` for the visuals.
- Each element is a duck-typed unit: `{nation:'GER', kind, x, z, y, arc, hp, crew, takeDamage}`. Kinds:
  - 88/75/50 mm casemates
  - Tobruk pits and MG42 nests
  - mortar pits
  - the Pointe du Hoc 155 battery
- **Realism rule:** the casemates **enfilade along the beach**, behind a concrete wall that faces the sea.
  - A shell from the sea does about 0.15× damage; one through the embrasure arc does 1×.
  - Near misses suppress the crew (`suppressedUntil`).
  - So close, angled destroyer fire is what works, as historically.
- **Direct fire** goes through `WW.combat.fireShell`. Generalise the reload logic in `island_base.batteries()`.
- **MG and mortar fire is abstract:** fire cones and registered beach zones. Infantry hits are rolled in P7; tracers are visual only.
- **Intel:** one aggregate scan, not one per element. Muzzle flashes reveal positions.
- Register with `landSites`.

### P5. Allied fire-support ships (in parallel with P6)
- New classes in `ship_classes.js`:
  - `newyork` (Texas), `wyoming` (Arkansas)
  - `town` (Glasgow) and the French cruisers
  - `gleaves`/`benson` (the destroyers)
  - `hunt` (RN)
- Models are parameterised `models_usn` generators plus an RN palette.
- `ai_fire_support.js` replaces search/strike:
  - **H−40 to H−5:** pre-planned fire. Texas takes Pointe du Hoc; the others take assigned WNs. Fire lifts inland at H-hour.
  - **After that, call fire:** shore fire control parties and spotting planes set `spottedUntil`, which reuses `SPOT_DISP`.
  - **Destroyers:** after about H+60 they close to 90–100 u (depth ≥ 4) and fire at whatever has been seen firing.
  - The danger field's coastal-gun penalty is scaled by a doctrine setting.
- Pull `base_ai` `aimLines`/`shipAim` into a helper that P3 also shares.

### P6. Landing craft
- `landing_craft.js`, `landing_waves.js` (the sector schedule: Charlie, Dog Green/White/Red, Easy Green/Red, Fox Green/Red) and `models_landing.js` (LCVP, LCT, LCI(L), DD tank; instanced).
- **Not in `WW.world.ships`,** so `fleet_cmd`, `intel`, `endgame` and `tonnage` are untouched. Craft are hit through the `landSites` hit test.
- **State machine:** line of departure (about 420 u out) → run-in at about 2 u/s → beach (stops on the tidal-flat depth) → ramp drops → unload → back off.
- **Hazards:**
  - The tidal current drifts craft east of their sectors.
  - A mined obstacle can wreck a craft.
  - DD tanks founder on a sea-state roll.

### P7. Infantry (the biggest phase)
- Files:
  - `infantry.js`: the squad sim
  - `infantry_fire.js`: suppression and casualties
  - `infantry_routes.js`: wire gaps, bluff paths and WN assaults
  - `models_infantry.js`: one InstancedMesh of about 3000 soldiers plus instanced bodies; visuals use Math.random
- **The sim unit is a squad** of about 12 men, tracked as an alive count. Its path:
  1. wade ashore
  2. take cover behind obstacles
  3. reach the shingle
  4. blow a Bangalore gap in the wire
  5. climb the bluff **between** the draws (as historically)
  6. take a WN from the flank or rear
- **Cover** comes from a grid built off the terrain and obstacles. Suppression and casualties come from the P4 fire cones through a spatial hash.
- **Tanks ashore** are single-vehicle squads that fire at embrasures.
- **Rangers at Pointe du Hoc** get a grapnel climb sequence.
- **Budget:** ≤ 1.5 ms per step with 200 active squads.

### P8. Air
- `air_offmap.js`: planes spawn at the north edge and return there; they don't land. `aircraft.js` needs a "no carrier" home path.
- **B-24 boxes:** level bombing reuses `land_air.js:313`. A cloud setting pushes the drop point inland.
- **P-47s** strafe and bomb the WNs (`air_strafe`/`air_attack`).
- **Spitfire top cover** uses `air_cap`.
- **Optional:** 2 Fw 190 strafers.

### P9. Film layer, victory and tests
- **Camera:** director candidates for ramp drops, casemate fire, Rangers on the cliff, a draw being opened, and the destroyer runs.
- **Chart, diary and report card:**
  - `plot_table.js`: WN symbols, sector names, boat lanes.
  - `war_diary.js`: a compressed clock starting 06:30.
  - `aar_card.js`: a Normandy version with casualties, craft lost, WNs silenced, draws opened and time to beachhead.
- **Victory** goes in `scn.updateGame`:
  - **Win:** at least 3 of 5 draws open (their WNs silenced) and at least N squads on top of the bluffs.
  - **Fail:** the timeout (about 1000 s), or the waves are used up and landed strength is below the threshold.
- **Weather and light:** dawn, low overcast and a choppy sea, via `daylight.js`/`weather.js`. The tide is static at low water, because the depth texture is baked.
- **Tests:**
  - `tests/normandy_probe.js` (`node_sim`, `?sim&scn=normandy`) checks: no NaN, craft beach inside their lanes, squads reach the bluffs, at least one draw opens on most seeds, the step budget holds, and the run is deterministic.
  - Add a `normandy` row to `sim_behaviour.js` SCEN.
  - **Balance:** one pass at the end. The target is a hard-won victory in about 60–75% of seeds, with the heaviest losses at Dog Green and Easy Red.

## Risks
- **The nation-literal audit (P1).** The quiet fallbacks give the Germans USN doctrine and colours with no error. The lint test and a per-file review are the only protection.
- **Pacific determinism (P1 and P3 touch hot paths).** Watch random-draw order in `roundStart` listeners and the update slot order.
- **Time compression.** About 6 hours of history must fit a round of about 1000 s, so waves come every 60–90 s.
- **Vertical scale.** Bluffs at 3–5 u may read as flat, hence the exaggeration setting.
- **Performance.** Squads crossed with MG cones (spatial hash), instance counts, and intel scans. Keep defences out of the per-unit intel loop.
- **The 400-line file rule.** This adds about 20 new files to `index.html`, keeping the sim/visual split.

## Critical files
`js/main.js`, `js/core.js`, `js/terrain.js`, `js/island_base.js`, `js/combat.js`, `js/base_ai.js`, `js/ai_surface.js`, `js/fleet_cmd.js`, `js/endgame.js`, `js/ui.js`, `index.html`

## Verification
- **Every phase:** `npm run test:determinism`. Pacific traces must stay bit-identical, and the Normandy run must be deterministic.
- **Pacific regression:** `npm run test:ai -- --only standard,midway` matches the baseline.
- **Normandy:** `tests/run.sh normandy_probe.js` (from P2 on, growing each phase), plus `*_shots.js`-style Playwright screenshots of `index.html?scn=normandy` for the look: the coast seen from the fleet, the beach, the bluffs and Pointe du Hoc.
