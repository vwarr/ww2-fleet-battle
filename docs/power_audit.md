# Power audit (2026-10-20, branch `power`)

The question: get the game's total CPU and GPU work per real second down (battery, fan), keeping the look.

## How it was measured

`tests/energy_probe.js <scene>`: installed Chrome, headless, real GPU (ANGLE Metal), 1600x900 at dpr 2 (a 3200x1800
buffer, the MacBook's), 1x, 10 s per scene. Per real second:
- **main**: main-thread busy ms (CDP `Performance.getMetrics` TaskDuration);
- **worker**: the look-ahead worker's stepping ms (lookahead.js `busyMs`);
- **GPU**: the render's own work, timed in a held loop with a readPixels sync (CPU + GPU of one `WW.post.render`, the
  director's camera where it was), x frames drawn per second. The live `EXT_disjoint_timer_query_webgl2` numbers are in
  the output too (`gpuTimer*`), but on this loaded machine they barely move with the work (a 0.75 render scale took the
  held loop 5.0 -> 3.2 ms and the timer 10.0 -> 9.9 ms): they measure the GPU's idle clock and other processes' work;
- **CPU %** of the Chrome renderer and GPU processes from `ps` cumulative CPU time over the window.

Scenes (seed 1): **setup** the ready screen idle; **quiet** an auto round at 9 s (10 planes up); **busy** a carrier
battle at 154 s, 54 planes up; **night** a forced night round at 221 s; **victory** the end hold; **hidden** busy with
the tab hidden. There is no pause (the speed buttons are 1x / 2x / 4x). The machine ran at load 20-30 (other agents);
differences under ~10% are noise. Base = main ac0a227.

## Energy table (per real second)

| scene | | frames/s | main ms | worker ms | GPU ms | renderer CPU % | GPU proc CPU % |
|---|---|---|---|---|---|---|---|
| setup | base | 30 | 130 | 0 | 417 | 15.8 | 12.2 |
| | **now** | 20 | 78 | 0 | 228 | 9.8 | 7.8 |
| quiet | base | 60 | 181 | 11 | 533 | 23.6 | 20.0 |
| | **now** | 60 | 170 | 12 | 480 | 22.6 | 18.7 |
| | battery saver | 30 | 117 | 13 | 166 | 16.6 | 12.6 |
| busy | base | 60 | 259 | 16 | 571 | 35.3 | 22.4 |
| | **now** | 60 | 251 | 16 | 469 | 34.1 | 21.7 |
| | battery saver | 30 | 148 | 14 | 146 | 22.3 | 12.0 |
| night | base | 60 | 168 | 5 | 589 | 21.2 | 21.4 |
| | **now** | 60 | 158 | 5 | 394 | 20.3 | 19.9 |
| | battery saver | 30 | 92 | 6 | 162 | 12.9 | 13.0 |
| victory | base | 60 | 237 | 14 | 493 | 31.2 | 22.7 |
| | **now** | 60 | 246 | 13 | 494 | 33.4 | 22.6 |
| hidden | base | 0 | 36 | 0 | 0 | 6.5 | 1.5 |
| | **now** | 0 | 34 | 0 | 0 | 6.1 | 1.5 |

## Ranked costs (busy, per drawn frame, `tests/perf_probe.js busy --chrome --dpr 2 --cam lookahead`)

1. **GPU render** (gpu_probe busy, held loop): 5.0 ms at 3200x1800 with 4x MSAA, of which **post 2.9 ms** (the 4x
   half-float target's resolve, the bright pass and the composite at full size); the shadow map pass 0.13; the sea
   0.07. At dpr 1: 2.7 ms. MSAA 2x: 3.6 ms; no MSAA: 2.7; render scale 0.75: 3.2.
2. **three.js scene CPU** 2.1 ms (updateMatrixWorld 0.54, projectObject / Dt 0.24, multiplyMatrices 0.22,
   renderBufferDirect 0.10): ~337 draw calls. Scales with frames drawn.
3. **sim** 0.92 ms (air 0.51, ships 0.23, fx 0.15) at 0.62 steps a frame (36.7 steps per real second at 1x).
4. visual modules 0.28 (cam 0.09, shipSwell.pose 0.09).
5. look-ahead worker: 37 ms per sim s = ~12-16 ms per real second at 1x. It already idles once AHEAD (90 sim s) ahead
   (target = n + ahead) and while hidden; the only burst is the catch-up at round start (~3 s CPU on a worker thread).
6. shaderWarm sweep: 0.6 ms every 2 s (0.3 ms/s): noise, left.
7. hidden tab: 34 ms/s (the background beat's steps), no frames, no worker. As intended.

## What changed

- **post.js: MSAA 4x -> 2x** on the scene target (default; `?msaa=4` the old). At dpr 2 the same-frame shots are
  indistinguishable (mean |diff| 0.14 / 255 over the frame). GPU busy 9.5 -> 7.8 ms, night 9.8 -> 6.6 (held loop, loaded
  machine).
- **main.js: the ready screen idles at 20 fps** (was 30; `?idlefps=N`). Nothing moves there but the sea. -45% GPU,
  -40% main thread on that screen.
- **Battery saver** (the panel's "Battery saver: on / off", remembered in localStorage `ww.battery`; `?battery=1`).
  Off by default, because both parts show:
  - the frame at 0.75 of the device ratio (2400x1350 on the MacBook): slightly softer at native size (the parked planes
    on a deck, flags);
  - the battle at 30 fps (60 while the user drives the camera). GPU -70%, main thread -35-45%, Chrome CPU -35%.
- Tried and dropped: 30 fps gated on screen motion (main.js measured the ships, planes and a grid of sea points
  projected frame to frame). The director's camera drifts at a median ~135 CSS px/s (p10 45-80) at 1x, so a threshold
  low enough to be invisible at 30 fps (~24 px/s) held 0% of the time in every scene; at 240 px/s (visible judder) a
  busy battle still drew 51 fps. So the saver is a plain 30 cap.
- Not done, by agreement with shadowfix: shadow map every 2nd frame (casters move every frame in a battle: shadows a
  frame behind their casters bring the shimmer back). The pass is 0.13 ms GPU anyway.

## Hotspots in other owners' files (numbers above)

- Scene graph: updateMatrixWorld 0.54 ms/frame. Static terrain / island props and static ship sub-meshes with
  `matrixAutoUpdate = false` (or merged) would cut it and the draw calls (terrain.js, models_*.js).
- Sim `air` 0.51 ms/step: see docs/perf_audit.md "Left for later" (air_dogfight threat scan, air_ops capPick).

Tools: `tests/energy_probe.js` (new), `tests/gpu_probe.js --q <params>` (new option).
