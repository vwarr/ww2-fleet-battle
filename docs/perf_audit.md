# Performance audit (2026-10-13, branch `perf`)

The question: features were added one at a time, so is any code needlessly slow, and why does the game drain the battery?

**Short answer.** On this machine (M1 Pro) the game uses about 4-5 ms of CPU per frame, and the CPU sits idle for 65-74% of every 60 Hz frame. No single JS hotspot explains the battery drain. The drain comes from how often frames are drawn:

- On a ProMotion display the uncapped rAF loop drew at **120 fps**: `tests/fps.js` measured 119.8 before this branch.
- In render mode the sim takes one step per frame, so 120 Hz also doubled the sim's work per real second.
- The ready (setup) screen, where nothing happens, was the *most expensive* frame in the game: every ship and terrain prop is in view, giving 1,303 draw calls, and it was redrawn at full rate.

Phase 2 fixed both of these, plus the GPU upload waste in the instanced effects. The rest of this doc ranks what is left.

## How it was measured

`tests/perf_probe.js` (new) runs in the headless shell with the real GPU (ANGLE Metal, 60 Hz vsync), 1600x900 at dpr 2. For a few seconds of a live round it records:
- the ms of each `WW[mod].update / pose / unpose / draw` call that main.js `step()` / `frame()` makes (each wrapped in place);
- the whole rAF callback;
- `post.render` + `gl.finish` (CPU plus GPU);
- the draw calls;
- a V8 CPU profile (self time by function and by file).

With `--inst` it also records the bytes sent through `gl.bufferSubData` per second.

Scenarios, all at seed 1:
- **std**: an auto round at 150 s.
- **busy**: a carrier round at 240 s, 71 planes airborne.
- **normandy**: Normandy at 200 s, the beach crowded.
- **setup**: the ready screen.

Numbers are ms per drawn frame. Other agents' tests were running on the machine at the same time, so treat differences under about 0.3 ms as noise.

## Top 10 costs (before this branch)

| # | Cost | Where | Measured | Fix | Status / risk |
|---|------|-------|----------|-----|---------------|
| 1 | **Frame rate**: uncapped rAF draws at 120 Hz on ProMotion. Every cost below is paid twice, and the sim steps twice as often | main.js `frame()` | fps.js: 119.8 fps | Cap at 60 | **Fixed**: fps.js now reports 60.1 drawn (rAF still 120.2). This halves all per-frame CPU and GPU work on 120 Hz displays |
| 2 | **Idle ready screen** redrawn at full rate, with 1,303 draw calls (about 670 ship meshes plus 270 terrain-prop meshes, then the shadow pass on top) | main.js; ships / terrain props | render+finish 3.9 ms, 4.3 ms rAF, at 60 (or 120) fps | 30 fps while on setup with no input for 1.5 s | **Fixed**: probe shows 29.3 drawn fps (rAF 58.8), a 50% cut on 60 Hz and 75% on 120 Hz. The ship merge is listed below |
| 3 | GPU render (main + shadow + post passes), dpr 2 | three.js / post.js | 2.1-2.8 ms per battle frame | dpr cap 1.5, cheaper shadows, see "Options" | Not changed: it would change the look |
| 4 | Scene-graph CPU in three.js: `updateMatrixWorld` 0.48-0.58, projectObject 0.34, `multiplyMatrices` 0.24-0.31 | three.min.js, called by ships / props | about 2.1-2.4 ms/frame in three.min.js | `matrixAutoUpdate = false` on static terrain / base props; merge static ship sub-meshes | Listed: medium risk, because the sim reads turret / deck / hull transforms |
| 5 | Sim `air` | aircraft.js, air_*.js | 0.70-0.82 ms/step | see the sim list below | Listed: changing it would alter the bit-identical traces |
| 6 | Sim `ships` | ships.js, ships_ai.js, ships_nav.js | 0.45-0.47 ms/step | see the sim list below | Listed |
| 7 | **GPU uploads**: instanced meshes re-uploaded at full capacity every frame, even when 0 instances are drawn | effects.js Pool, combat_aa.js, defence_fx, hoc_fx, vehicles_fx, normandy_fleet, rocket_barrage, terrain_normandy_props, beachhead_fx, air_render, models_crew | Normandy 77 MB/s (`bufferSubData` 0.57 ms/frame); std 28 MB/s; busy 22 MB/s | `WW.instUsed(im)` / `WW.attrUsed(a, n)` (core.js): upload `[0, count)` only, nothing when empty | **Fixed**: Normandy 25.6 MB/s (`bufferSubData` 0.38 ms); std 13 MB/s; busy 3.6 MB/s. The crew (models_crew) and the defence_fx tracers were converted after these numbers were taken |
| 8 | Normandy visual modules: landingFx 0.31, infantryFx 0.29, beachheadFx 0.23, defenceFx 0.18, hocFx 0.11, vehicleFx 0.05 | models_landing / models_infantry / beachhead_fx / defence_fx / hoc_fx / vehicles_fx | 1.6 ms/frame total | see the visual list below (per-frame allocations, haze splice) | Partly (uploads only) |
| 9 | `fx` (effects pools, runs in `step`) | effects.js `Pool.update` | 0.06-0.26 ms (Normandy is the highest) | already ranged; could skip the pose writes for pools off-screen | Listed |
| 10 | Normandy wave height: `waves.heightAt` 0.30 ms plus `terrain_normandy.heightRaw` 0.14 ms (self time) | waves.js:56, terrain_normandy.js:76 | 0.44 ms/frame | cache the height per object per frame, or a coarse height grid | Listed: waves are near the wakes agent's area |

Not a problem: the Normandy modules in a Pacific round (and the reverse) cost 0.001-0.003 ms each, because they all return early. `ui.update` costs 0.013-0.024 ms (its text refreshes at 4 Hz). `cam` costs 0.06-0.10 ms (out of scope anyway).

## Phase 2: what changed

1. **Frame pacing** (main.js `frame()`): `FPS_CAP = 60`, and `FPS_IDLE = 30` on the ready screen once there has been no pointer, wheel or key input for 1.5 s.
   - A skipped rAF does nothing (no sim step, no render) and does not move `last`. The next drawn frame's `rdt` is the whole real time since the last drawn frame, so the sim still advances by real time. The 0.1 s clamp still holds: 30 fps × 4× speed × 0.5 = 0.067 s.
   - The threshold has 3 ms of slack, so a 60 cap on a 120 Hz display draws on every other vsync instead of alternating 8 ms and 16 ms frames.
   - `WW.frames = {drawn, skipped}` counts both.
   - `?nocap` turns the cap off. `tests/air_stress.js` uses it in its uncapped (`--disable-frame-rate-limit`) mode.
   - Tests are unaffected: they drive `__sim.fastForward`, and determinism / trace_dump stub rAF.
2. **Hidden tab** (checked): browsers stop rAF on a hidden tab, and audio.js mutes on `visibilitychange`. No `setInterval` keeps running (the only timers are a one-shot in audio.js and one in ui.js). Nothing to add.
3. **Pause**: the game has none (the speed buttons are 1× / 2× / 4×). The idle throttle covers the ready screen.
4. **Instanced uploads**: `WW.instUsed(im, color)` / `WW.attrUsed(attr, floats)` in core.js, used at every site listed in row 7 of the table. Only visual modules were touched.
5. **Tools**:
   - `tests/perf_probe.js`: per-module ms, CPU profile, `--inst` upload bytes, `--dpr`.
   - `tests/perf_smoke.js`: a seeded, frozen render shot.
   - `tests/fps.js` prints the drawn fps beside the rAF rate.

Gates, all against the pre-branch HEAD:
- trace_dump seeds 1-3: **identical** (run before and after the crew change).
- determinism `--cross` (render / browser / node): **identical**.
- sim_behaviour, 6 seeds: the same 3 FAILs as the baseline with the same values (`pt_pen_med` 0.29, `ftr_leash` 0.76, `crip_away` 0.55), and none new.
- Smoke shots: Pacific and Normandy before / after pairs look identical.

## Left for later

### Sim (each must be checked bit-identical with trace_dump before merging)
Most of these are pure reorderings of tests, which should be bit-identical. They came from reading the code and were not measured one by one. The `air` total is about 0.7 ms per step.
1. air_dogfight.js:35-46 `threat()` does a full plane scan (with `d3` / atan2) per engaged fighter per step, so O(F·P). Test `q.foe !== p` first. Pure.
2. air_ops.js:134-160 `capPick` calls `escorting()` and `claimed()` (each O(P)) per contact, so O(F·E·P) at 2.5 Hz. Skip `escorting` outside the leash band (:144), and call `claimed` only when it could change the pick (:156). Pure.
3. air_cag.js:250-266 `escort()` runs per escort per step with `strikeBombers` (a new array), two `.filter` calls and a `[cx, cz]` array. Use scratch arrays / counting loops.
4. air_cag.js:150-179 `armedOn` with `.filter` / `.some`, per holding bomber per step. Replace with one counting loop.
5. ships_ai.js:304-312 `airEvade`: every ship scans every plane every step, O(S·P). Build the live armed-plane list once per `ships.update` (check that no ship AI writes plane state).
6. intel.js:173-191: `staff.seeK()` (atan2 + weather) is computed for every pair before the range test. Reject on distance first (seeK ≤ 1, no RNG).
7. combat.js:48-58 `findHit`: `onHull` (cos / sin) against every ship for every torpedo / shell per step. Add a bounding-circle reject first.
8. ships_ai.js:214, combat.js:127: `ship.group.updateMatrixWorld(true)` on each firing step recomputes the whole ship subtree. Use `barrel.updateWorldMatrix(true, false)`.
9. Small allocations: air_dogfight.js:49 `elementMates`, air_ops.js:199 `capState`, ships_nav.js:194 `clearance` closures (up to 14 per `planNav`), air_search.js:211-218 `.some` / `.filter` before the `srchT` gate, ships.js:369 `ships.slice()` per step, ships.js:259 sub opacity written every step.
10. Normandy sim: beach_engineers.js:74, :147, :150 and infantry.js:148, :152 run `.some` / `.filter` per lane / block / squad per step. Use alloc-free loops in the same order.

### Visual (no sim risk)
1. **Merge static ship sub-meshes** (about 30 meshes per ship, so about 670 draw calls plus the shadow pass when the whole fleet is in view). Keep turrets / barrels / decks the sim reads as separate nodes. This is the biggest remaining draw-call item, and also cuts `updateMatrixWorld`.
2. **Static terrain / base props** (270 meshes): merge them per material, or set `matrixAutoUpdate = false`. island_base.js is off limits for now (taxi-crash), and so is the base decor that the taxi-crash work moves.
3. models_infantry.js:133, :170, :199-202: a new `Map` plus closure every frame, a pose string per man per frame, and every body's matrix copied every frame.
4. beachhead_fx.js:197-216 haze: an object per puff, `list.shift()` and `splice` in the loop (O(n²)), full uploads. Use a ring buffer with `updateRange`.
5. air_fx.js:131, :141: ribbon buffers are uploaded in full every frame even with nothing live. Use `attrUsed`, and skip `drawRibbons` when no ribbon is active.
6. ui.js:290-296: five `classList.toggle` calls and two `style.display` writes every frame. Write them only when they change (cheap now: 0.02 ms).
7. Remaining full-capacity uploads: damage_visuals.js:295, :362; crew_props.js:61, :74; base_life_fx.js:91; base_ground_fx.js:294; base_life_cars.js:143; easter_b29_fx.js. All are small in a normal round. The `WW.instUsed` conversion is mechanical.
8. "Nothing moves" detection, for a lower frame rate in a quiet battle: not done. The camera director almost always moves.

### Out of scope here (owned by other agents)
- **camera_*.js / air_captions.js** (camera4): `cam` is 0.06-0.10 ms/frame, which is fine. The director keeps the camera moving, which rules out any "nothing moves" idle frame rate.
- **Wakes / water foam** (wakes agent): `water` is 0.008-0.011 ms. The ship wakes are written in ships.js (`toWorld` returns a new array per wake, :291 / :296). waves.js `heightAt` costs 0.30 ms/frame in Normandy (row 10).
- **Strafing / tracers** (strafe-guns agent): air_tracers.js:80-88 uploads its whole instanced buffer every frame (`instanceMatrix.needsUpdate` with no range). Use `WW.instUsed`. Not touched.
- **Airfield crash logic** (taxi-crash agent: air_impact.js, land_air.js, island_base.js):
  - aircraft.js:28-31 `deckInfo` forces `updateMatrixWorld(true)` on the carrier and returns a new object. This only happens when `WW.airDeck` / `WW.landAir` are absent.
  - The island base's ground life (base_life_fx / base_ground_fx / base_life_cars) uploads its buffers in full (see visual item 7).
  - The base decor is static meshes (visual item 2).
  - `islandBase.update` measured 0.000-0.001 ms in these rounds. No base raid was profiled; `tests/base_fps.js` covers that case.

## Options that change the look (for the user to decide)
- Pixel ratio capped at 1.5 instead of 2 on retina: about 44% fewer pixels for the scene, shadow-free post passes and MSAA.
- `PCFShadowMap` instead of `PCFSoftShadowMap`, or a smaller shadow map on the setup screen.
- `antialias: false` when the post stack already smooths the frame.
- A "battery saver" toggle that combines these with a 30 fps cap.
