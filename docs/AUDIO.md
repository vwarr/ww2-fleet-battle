# Audio

All sound is synthesized with the Web Audio API. There are no audio files and no music: only sound effects and ambience.
The engine is `WW.audio` (`js/audio.js`). The shared synth parts are `WW.audio.syn` (`js/audio_synth.js`).
The sound families are in `js/audio_amb.js` (ambience, UI, cinematic), `js/audio_aa.js` (AA and flak) and `js/audio_naval.js` + `js/audio_naval_wire.js` (guns, shells, hits, ships); `js/audio_base.js` is now empty (its examples moved into the families).

## Rules

- Sound starts muted. The user turns it on with the 🔊 corner button, the **Sound** button in the panel, or `M`.
  The browser allows an AudioContext to start only inside a click or a key press, so the engine makes the
  context in that gesture. The on/off state and the volume are kept in `localStorage` (`ww.audio`).
  If sound was on last time, the corner button shows **Tap to start**, and the first click or key press starts it.
- When sound is off, or the tab is hidden, or the browser has no Web Audio, `play()` returns `null` at once
  and `loop()` returns a handle without any nodes. The simulation runs headless in the tests and at 4×,
  so a sound call in sim code must stay this cheap (about 7 ns when sound is off). No AudioContext exists until the user turns sound on.
- Sound code uses `Math.random`, never `WW.rand`. It must not change a seeded round.
- Make nodes only with `ctx.createX()` (not `new GainNode(ctx)`). The engine and the tests count nodes through these methods.
- Never throw. The engine wraps every patch build and `set` call in `try`/`catch` and counts failures in `stats().errors`.

## Signal flow

```
patch nodes -> voice gain -> air low-pass -> stereo pan -> bus ──┐        (positional voices)
patch nodes -> voice gain ─────────────────────────────> bus ──┤        (ui: true voices)
                      └─ reverb send (more for far sounds) -> convolver ┘

bus sfx (0.9) ──────────────┐
reverb return (0.55) ───────┼─> slow-motion low-pass ─┐
bus ambience (0.55) -> duck ┘                         ├─> master (volume²) -> compressor -> limiter -> trim 0.85 -> speakers
bus ui (0.45) ────────────────────────────────────────┘
```

- Compressor: threshold -18 dB, ratio 4, knee 10, attack 6 ms, release 300 ms. Limiter: threshold -4 dB, ratio 20,
  attack 1 ms. A stress of 200 big booms at the camera peaks at approximately -3 dBFS.
- Reverb: one ConvolverNode with a generated 2.2 s impulse (decaying stereo noise that gets darker). It is made once.
- Ducking: `duck(amount, secs)` lowers the ambience bus. A patch with `duck` set does this when it plays,
  scaled by how loud it is at the camera.

## Spatial model

The listener is the camera (`WW.camera`), updated every frame after `WW.cam.update`. The engine uses its own
gain, low-pass and StereoPanner for each voice, not a PannerNode, so culling and the mix use the same numbers.

| Constant (`WW.audio.C`) | Value | Meaning |
|---|---|---|
| `REF` | 30 units | Default reference distance. Full level inside it. A patch sets its own `ref`. |
| `ROLLOFF` | 1 | Inverse falloff outside `ref`: gain = ref / (ref + rolloff × (d − ref)). |
| `ABSORB`, `LP_MAX`, `LP_MIN` | 60, 16000 Hz, 450 Hz | Air absorption: cutoff = 16000 / (1 + d / 60). 200 units → 3.7 kHz, 400 units → 2.1 kHz. Behind the camera it is up to 35% lower. |
| `PAN` | 0.85 | Stereo width. Sounds nearer than 8 units are panned less. |
| `SOUND_SPEED` | 250 units/s | Fake speed of sound in real seconds at 1×. Delay = d / 250 / (`WW.time.scale` × `WW.time.warp`), at most `MAX_SOS` = 1.5 s. 150 units → 0.6 s at 1×. |
| `DOPPLER_SPEED` | 150 units/s | Used by `doppler()`. Smaller than the sound speed, so a plane pass is easy to hear (about ±15%). |
| `CULL` | 0.004 (-48 dB) | A one-shot with vol × distance gain below this is not built. |
| `LOOP_IN`, `LOOP_OUT` | 0.006, 0.003 | A loop gets real nodes above `LOOP_IN` and loses them below `LOOP_OUT`. |
| `MAX_VOICES` | 48 | Global voice cap (one-shots and real loops). |
| `PATCH_MAX` | 8 | Default per-patch cap (`max`). |

Scale: 1 unit ≈ 2 m. The map is 480 × 300 units, a battleship is 24 units long, and the camera is usually 30 to 200 units from the action.
A good `ref` is the distance at which the sound should be at full level: about 70 for a battleship gun, 30 for an explosion,
15 to 20 for a plane engine, 8 to 10 for a machine gun.

## Voices

- **Throttle**: `minGap` (real seconds) per patch. A play inside the gap is skipped (`stats().throttled`).
  Throttles use real time, so at 4× the sound does not become 4× denser. A 3-gun salvo is one boom.
- **Per-patch cap** (`max`): for one-shots the oldest voice of that patch is stolen. For loops the quietest voice of that patch is
  stolen, but only when the new one is 1.5× louder (so two loops at similar distances do not flap). Example: 14 planes, `max: 8`: the 8 nearest have engines.
- **Global cap** (48): the quietest voice is stolen (a one-shot's level falls over its duration; loops count 1.5× as loud).
  If the new sound is quieter than all of them, it is dropped (`stats().dropped`).
- A stolen voice fades out in approximately 50 ms.

## Time

- Sound uses real time. `WW.time.scale` (1×, 2×, 4×) does not change pitch. Throttling keeps 4× clean.
- Slow motion (`WW.time.warp` < 1): the engine smooths warp (≈ 0.25 s), then sets `WW.audio.pitch = warp^0.45`
  (0.5 → 0.73) and closes a low-pass on the sfx bus and reverb (0.5 → about 1.6 kHz). A new one-shot gets `p.rate × pitch`.
  A loop gets `set({ rate })` from the engine when its effective rate (opts.rate × pitch × doppler) changes; `handle.set()` never forwards engine keys (x, y, z, at, vol, rate, ...) to the patch. A patch must use `rate` if it wants the slow-motion pitch.
- The speed-of-sound delay is divided by `scale × warp`, so it stays in step with the picture.

## Writing a patch

```js
WW.audio.register('gun.med', {
  bus: 'sfx',        // 'sfx' | 'ambience' | 'ui'                        (default 'sfx')
  ref: 50,           // full-level distance, units                       (default 30)
  max: 6,            // per-patch voice cap                              (default 8)
  minGap: 0.08,      // throttle, real seconds                           (default 0)
  sos: true,         // speed-of-sound delay by default                  (default false)
  reverb: 0.35,      // reverb send, grows with distance                 (default 0.15)
  duck: 0,           // duck the ambience by this much when it plays     (default 0)
  dur: 2,            // fallback duration if build returns no dur        (default 2)
  params: { size: 1 },  // default per-play params
  build(ctx, out, p) {
    // p = params + play opts, plus p.t (start time in ctx seconds), p.rate (opts.rate x slow-motion pitch), p.dist (units)
    const S = WW.audio.syn;
    return S.done(p, [
      S.boom(ctx, out, p.t, { f0: 90, f1: 40, dur: 1.2 * p.size, gain: 0.6, rate: p.rate }),
      S.burst(ctx, out, p.t, { type: 'bandpass', f: 2200, f1: 600, d: 0.15, gain: 0.3, rate: p.rate })
    ]);
  }
});
```

`build(ctx, out, p)` connects its nodes to `out` and starts them at `p.t`. It returns one of:

- `{ dur, stop(t), set(params) }`. `dur` is seconds from `p.t` (use `Infinity` for a loop). `stop(t)` stops all sources at ctx time `t`.
  `set` is optional. It gets the params a loop handle's `set()` receives (not the engine keys) and `{ rate }`.
- a number (the duration), or nothing (then `dur` from `register` is used).

The engine owns the voice gain, distance, pan, reverb and cleanup. A patch has its own level, about 0 to 1 peak at the reference distance.
`build` is also called with an `OfflineAudioContext` by `renderOffline`, so do not use `WW.audio.ctx` inside it.

A shorter form: `register(name, build)` uses all the defaults.

### Names

`family.thing[.variant]`, lower case, dots:

| Family | Examples | Owner |
|---|---|---|
| `gun.*` | `gun.big`, `gun.med`, `gun.small`, `gun.mg` | naval guns |
| `shell.*`, `ship.*`, `fire.*`, `sub.*` | `shell.whistle`, `shell.splash`, `ship.hit`, `ship.sink`, `fire.ship`, `sub.dive` | naval (audio_naval.js) |
| `torp.*`, `dc.*`, `bomb.*` | `torp.launch`, `torp.hit`, `dc.blast`, `bomb.whistle` | `torp.*`, `dc.*`: naval; `bomb.*`: aircraft |
| `plane.*` | `plane.engine.radial`, `plane.dive`, `plane.gun`, `plane.crash` | aircraft |
| `aa.*`, `flak.*` | `aa.light`, `aa.heavy`, `flak.burst` | anti-aircraft |
| `amb.*` | `amb.sea`, `amb.wind`, `amb.surf`, `amb.gull` | ambience |
| `cine.*` | `cine.slow`, `cine.bell`, `cine.horn` | ambience (cinematic cues) |
| `ui.*` | `ui.click`, `ui.toggle`, `ui.error` | ambience (UI) |

Put a family in its own file `js/audio_<family>.js`, loaded after `js/audio_base.js` in `index.html`. Register at load time and
subscribe to events with `WW.on`. Load-time code must not touch the AudioContext (it does not exist yet).

## Playing sounds

```js
WW.audio.play('gun.big', { x, y, z, size: 1.2 });       // at a world position
WW.audio.play('gun.big', { at: ship, vol: 0.8 });       // `at`: any object with x, (y), z
WW.audio.play('ui.click', { ui: true });                // not positional
const v = WW.audio.play('shell.whistle', { at: proj });  // returns a voice or null
if (v) v.stop(0.05);                                    // end it early (fade s). Other voice fields are internal.
// common opts: vol (1), rate (1), delay (s), sos (override the patch default), ref (override), duck (override)

const h = WW.audio.loop('plane.engine.radial', { at: plane, doppler: true, vol: 0.7 });
h.set({ throttle: 0.9 });   // patch params go to the patch's set(); x, y, z, at, vol, rate are read by the engine
h.stop(0.5);                // fade time, s. Stop loops when the source dies.
```

- A loop handle is virtual. It keeps its params while sound is off or the source is too far away, and gets real nodes when it can be heard.
- `at` is read every frame, so a loop can follow a plane without `set` calls. With `doppler: true`, the engine measures the
  source speed from its movement and multiplies the rate by `doppler()`.
- On `roundStart` and `setupStart`, the engine stops every loop not made with `persist: true`. Ambience uses `persist`.
- Per-frame code that should only run while sound is on: `WW.audio.onUpdate(fn(rdt))`.

## Events with sound

| Event | Data | Sound |
|---|---|---|
| `shellFired` (combat.js `fireShell`) | `{ ship, cal, x, y, z, proj }` | `gun.big` / `gun.med` / `gun.small` / `gun.mg`, one play per ship salvo (barrels of one frame grouped, `n` = barrels); `shell.whistle` if a big/med shell's path passes within 45 units of the camera, timed to the closest approach |
| `shellLanded` (combat.js `landShell`) | `{ cal, x, z, ship }` | miss: `shell.splash` (big, med), `shell.splash.small` (small, mg), `shell.land` on an island |
| `shipHit` (ships.js `takeDamage`) | `{ ship, amount, x, z, kind, cal }` | shell: `ship.hit` scaled by damage (ducks at size > 1.5), mg: `ship.ping`; bomb: `ship.hit` with `bang: 0` (the clang only; the blast is the aircraft family's); torpedo: `torp.hit` |
| `shipBoom` (damage.js, ships.js) | `{ ship, x, y, z, size }` | `ship.boom` |
| `shipSunk` | ship | `ship.magazine` (ducks) and `ship.sink`; when the wreck settles the sink voice fades and `ship.settle` plays |
| `weaponDropped` kind torpedo | | `torp.launch` (ship, PT or sub tube; not for plane drops), a `torp.run` loop that follows the torpedo |
| `weaponImpact` kind torpedo | `{ kind, proj, x, z, ship, dud }` | stops `torp.run`; a miss: `torp.fizz`; a dud on a hull (`dud: true`, USN torpedoes): `torp.dud`, a clunk and a ring with no explosion |
| `dcDropped`, `dcBlast` (combat_weapons.js) | `{ x, z }` | `dc.splash`, `dc.blast` (the sim's fuse is the delay) |
| polled (audio_naval_wire.js, 4 Hz, only while on) | | `ship.engine` loops for the 3 nearest moving ships within 150 units, `ship.engine.pt` for the 2 nearest PT boats within 110; `fire.ship` per burning ship (`n` = burning sites); `sub.dive` / `sub.surface` when a sub's `wantSurface` flips |
| `weaponDropped`, `weaponImpact` | see ARCHITECTURE.md | from a plane: `bomb.release` + `bomb.whistle` loop (stopped at impact), `plane.torpdrop` `bomb.blast` on a bomb impact (ship hit or miss) |
| `planeHit` (aircraft.js `Plane.damage`) | `{ plane, amount }` | `plane.hit` |
| polled every frame (audio_air.js) | `WW.world.planes`, carrier decks | aircraft: see below |
| `shipSunk`, `planeKill`, `ace`, `roundStart`, `victory` | | |
| `roundStart` | | `cine.bell` (two strikes, distant) |
| `victory` | `{ winner }` | `cine.horn` (two low blasts); a stalemate gets `cine.bell` with 3 slow strikes |
| `shellFired`, `weaponImpact`, `shipSunk`, `planeKill` | | add to the battle intensity (`amb.rumble`, `amb.thud`, calm) |
| UI buttons (ui.js `btn`) | | `ui.click` |
| `uiToggle` (ui.js, keys C P T M) | `{ on }` | `ui.toggle` |
| `uiVolume` (volume slider `input`) | `{ v }` 0..1 | `ui.tick` (throttled by `minGap` 0.06 s) |
| `uiPlace` (setup: ship placed) | `{ x, z }` | `ui.place` |
| `uiRemove` (setup: right-click removes) | | `ui.remove` |
| `uiError` (Too shallow / Too close / Both sides need ships) | | `ui.error` |
| `WW.time.warp` drops below 0.9 (polled) | | `cine.slow`, and a short ambience duck |
| a director cut from high (y > 55) to low (y < 40) (polled: listener jumps > 35 units in a frame) | | `cine.whoosh` |
| always | | `amb.sea`, `amb.wind`, `amb.rumble` loops (non-positional, `persist`), `amb.surf` loops at the shores, `amb.gull` now and then |

## Ambience, UI and cinematic sounds (`js/audio_amb.js`)

| Patch | What | Trigger / control |
|---|---|---|
| `amb.sea` | Swell (brown noise), stereo wash, a broad hiss, and lapping + slaps near the water | Loop. `height` (camera y): lapping fades out above ~45 units, the hiss grows high up. `wind` (0..1) roughens it. Level rises a little when calm. |
| `amb.wind` | Two gusty noise bands (each with its own gust curve, pitch lifts with the gust) and a narrow whistle | Loop. Louder with height and `WW.wind` speed. Whistle above ~50 units. |
| `amb.surf` | Waves breaking (crash, body thump, foam hissing back) | One positional loop per shore cluster (scan of `WW.terrain.depthAt`: coasts, reefs, sandbars, depth < 1.7). Volume fades to 0 by ~190 units; `max: 3` keeps the nearest three. Rebuilt when the map changes. |
| `amb.rumble` | Far-off rolling thunder bed | Loop, vol = battle intensity × (more on wide shots far from the fight). |
| `amb.thud` | One distant boom | Random-timed while intensity > 0.25 and the camera is > 160 units from the fight, placed 240+ units away in its direction. |
| `amb.gull` | 1 to 4 soft gull calls | Every 14 to 40 s, 75% chance, only when the camera is below 70 units, within 140 units of land, and calm. Never after dusk (`WW.daylight` < 0.5). |
| `cine.slow` | Low whoomp + swell | Slow motion starts. Bus `ui` (not pitched or filtered again). |
| `cine.whoosh` | Very soft air whoosh, panned across | Wide → close director cut. Bus `ui`. |
| `cine.bell` | Distant ship's bell with its own 4 s reverb | Round start (2 strikes); stalemate (3 slow strikes). |
| `cine.horn` | Distant ship's horn, two long low blasts, own reverb | Victory. |
| `ui.click`, `ui.toggle`, `ui.tick`, `ui.place`, `ui.remove`, `ui.error` | Soft click, two-tick toggle, slider detent, small splash, wooden thunk, low "nope" | See the events above. |

Battle intensity: events add heat (big shell 0.45, other shell 0.15, weapon impact 0.8, plane kill 1, sinking 3), which decays
with a 12 s time constant in real time. Intensity = 1 − exp(−(heat + 0.12 × planes in the air) / 12), about 0.6 for a busy battle at 1×.
Calm = 1 − intensity (1 between rounds and in setup), smoothed over ~4 s; it lifts the sea and wind and allows gulls.
Night and rain: the sea is quieter at night (× 0.72 in full dark, from `WW.daylight`) and the wind a little softer (× 0.8); rain near the camera (`WW.skyTime.wx()`, the smoothed squall cover) roughens the sea and wind and makes the wind louder (up to × 1.8).
The slow modulation of the beds comes from long "control" buffers (smooth random curves and event trains at 3 kHz,
61 to 240 s long, played at random offsets and rates), so they do not repeat audibly and also render offline.
All the world logic runs in one `onUpdate` hook, on wall-clock time, 5 times a second; while sound is off, nothing runs and the event
handlers return at once. `WW.ambState` is a read-only debug view (intensity, calm, play counts) for the tests.

## Mix guide

Levels are the master peak in dBFS heard at the camera with the volume at 100% (master gain 1, before the user's volume²).
The ambience bus is 0.55 and is ducked by big sounds. Measured with `tests/audio_amb.js` (live master captures):

| What | Bus | Target level at the camera | Notes |
|---|---|---|---|
| Ambience bed (sea + wind), calm, wide shot | ambience | peak about −16 dBFS, rms about −31 dBFS | Measured. It should sit well under everything else. |
| Ambience low over an island (+ surf, gulls) | ambience | peak about −11 dBFS, rms about −26 dBFS | Measured. |
| Distant battle rumble + thuds | ambience | peak −20 to −14 dBFS | Fills wide shots, never competes with real guns. |
| Battle overall (guns + bed) | all | peak −10 to −6 dBFS, never above −3 | Measured −10 dBFS with only `gun.big`; leave room for the other families. |
| Big gun / explosion at its `ref` | sfx | peak −8 to −4 dBFS | The loudest things in the film; `duck` 0.3 to 0.5. |
| Medium gun, bomb, torpedo hit | sfx | peak −12 to −8 dBFS | `duck` 0.15 to 0.3. |
| Plane engine at its `ref` | sfx | rms −24 to −20 dBFS | A loop: keep it below the bed of a close sea. 8 voices at once must not roar. |
| MG / AA fire, flak bursts | sfx | peak −18 to −12 dBFS | Many at once: keep each one small; use `minGap`. |
| Cinematic cues (bell, horn, whoosh, slow) | ambience / ui | peak −18 to −10 dBFS | The bell and the horn are distant; the whoosh is barely there. |
| UI clicks | ui | peak −20 to −14 dBFS | The ui bus (0.45) is not ducked or slowed. |

A patch's own level should be about 0.2 to 0.6 peak at its reference distance (offline render); use the per-play `vol` for variation.


## Aircraft (`js/audio_air.js`)

Most aircraft sounds are not driven by events. A `WW.audio.onUpdate` hook reads `WW.world.planes` and the carrier decks
every frame (only while sound is on) and reacts to state changes. `WW.audioAir.stats()` gives counters for the tests.

| Patch | Sound | Trigger |
|---|---|---|
| `plane.engine` (loop, `max` 7, `ref` 16) | radial drone: a pulse-wave firing tone (twin-row beat for the Wildcat and the torpedo bomber), a sub-octave, amplitude lump at the rev rate, exhaust noise pulsed by the firing tone, slipstream. Types `wildcat`, `zero`, `dive`, `torp`, `scout`. Params `thr` (0 idle, 1 cruise, 1.3 overspeed: pitch and brightness), `air` (slipstream), `dive` (rising howl), `whine` (falling engine), `fire` (crackle and roar), `cough` (sputter, with a backfire pop above 0.55) | one loop per plane, `at: plane`, doppler on at 1× and 2× (off at 4×). Only the 7 nearest get voices. `thr` follows speed and climb, the dive-bomber `phase` (`roll`/`dive` throttle back and howl, `pull` strains), the deck (`hold` run-up as the wings spread, `run` full power, `rollout` chopped) and the catapult. Damage below 55% hp coughs; below 30% hp, and in a comet or crash, it burns. In a spin the pitch falls and a whine is added. It stops when the plane is removed, ditches (with a last cough), slides off a deck, or is parked. |
| `plane.gun` (loop, `max` 4, `ref` 9) | wing-gun rattle: pulse-gated noise and thumps, guns out of step. Zero: light 7.7 mm rattle + slow 20 mm thump | one loop per burst (`plane.df.burst > 0`), follows the plane; not started beyond 160 units |
| `plane.hit` | metal ping + short rip | `planeHit` (throttled 0.09 s) |
| `plane.whoosh` | rush of air | a plane's predicted closest approach to the camera is within 12 units and 0.35 s (1× and 2× only) |
| `bomb.release`, `bomb.whistle` (loop) | rack clunk; a whistle whose pitch falls with the bomb's height | `weaponDropped` (bomb from a plane); the whistle only within 90 units, at most 4 |
| `plane.torpdrop` | clunk, plop, splash | `weaponDropped` (torpedo from a plane) |
| `plane.wingrip`, `plane.fireball` | crunch and a rough rip; a dark fuel whoomph (`size` 0.45 for a spin, 1.2 for a comet or crash) | `deathMode` becomes `wing` / `spin` / `comet` / `crash` |
| `plane.splash` | thump, spray, patter (`size` 0.4 to 3) | a falling plane is removed at the water (size by death mode); `slide` → `ditched`; a scout alights |
| `plane.crunch` | crunch, scrape, clanks | a crashing plane is removed with `crashedInto` set (the ship's hit sound is the naval family's) |
| `plane.ditch` | hull skid and splash | `deathMode` `ditch` → `ditched` |
| `chute.pop` | canopy snap and flutter | `plane.bailAt` is cleared above 6 units (the chute opens) |
| `deck.roll` | tyres on the deck planks (`dur` = the roll in real s) | launcher `deckPh` → `run` |
| `deck.trap` | wire twang, hook thunk, hiss | `state` → `rollout` with `deckPh` `trap` |
| `deck.barrier` | wire screech and crunch | `deathMode` → `slide` (a bad trap goes over the side) |
| `deck.fold` | hydraulic whir and lock clunk | a launcher's `fold` starts to drop; a parked entry's `fold` starts to rise |
| `deck.elevator` | clunk, motor hum, clunk (subtle) | launcher `deckPh` → `rise`; a deck entry comes up (`ph` `up`) or goes down |
| `deck.catapult` | cordite bang and the carriage slide | scout `fired` |

A raft makes no sound. `tests/audio_air.js` (`npm run test:audio:air`, port 8812; `OUT=dir` writes WAV renders) checks all of it.

## Testing a patch

`WW.audio.renderOffline(name, params, seconds)` renders one patch in an OfflineAudioContext (sound does not need to be on)
and resolves `{ peak, rms, dur, nan, buffer }`. `WW.audio.meter()` gives `{ peak, rms, nan }` of the live master output over the last 0.68 s.
`WW.audio.stats()` gives voice, node and counter totals. `tests/audio.js` checks all of this (`npm run test:audio`).
`tests/audio_amb.js` (`npm run test:audio-amb`) renders every `amb.`/`cine.`/`ui.` patch offline (peak, duration, NaN, clicks across loop seams,
spectral centroid and the share above 4 kHz), plays a full round with sound on, and writes WAV renders and master captures to `AMB_OUT`.

`tests/audio_naval.js` (`npm run test:audio:naval`) renders every naval patch (peak, duration, NaN, energy above 6 kHz) and saves WAVs,
then runs a battle with sound on at 1x and 4x and prints per-patch play / throttle / cull / drop counts and records 20 s of the master mix.
