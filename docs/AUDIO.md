# Audio

All sound is synthesized with the Web Audio API. There are no audio files and no music: only sound effects and ambience.
The engine is `WW.audio` (`js/audio.js`). The shared synth parts are `WW.audio.syn` (`js/audio_synth.js`).
The first example patches are in `js/audio_base.js`.

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
| `shell.*`, `splash.*`, `hit.*`, `ship.*` | `shell.whistle`, `splash.big`, `hit.armor`, `ship.sink`, `ship.fire` | ship damage |
| `torpedo.*`, `bomb.*`, `dc.*` | `torpedo.launch`, `bomb.whistle`, `dc.blast` | weapons |
| `plane.*` | `plane.engine.radial`, `plane.dive`, `plane.gun`, `plane.crash` | aircraft |
| `aa.*`, `flak.*` | `aa.light`, `aa.heavy`, `flak.burst` | anti-aircraft |
| `amb.*` | `amb.sea`, `amb.wind`, `amb.gulls` | ambience |
| `ui.*` | `ui.click`, `ui.caption` | UI |

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
| `shellFired` (combat.js `fireShell`) | `{ ship, cal, x, y, z }` | `gun.big` for `cal === 'big'` |
| `weaponDropped`, `weaponImpact` | see ARCHITECTURE.md | from a plane: `bomb.release` + `bomb.whistle` loop (stopped at impact), `plane.torpdrop` (impact sounds: weapons family) |
| `planeHit` (aircraft.js `Plane.damage`) | `{ plane, amount }` | `plane.hit` |
| polled every frame (audio_air.js) | `WW.world.planes`, carrier decks | aircraft: see below |
| `shipSunk`, `planeKill`, `ace`, `roundStart`, `victory` | | |
| UI buttons (ui.js `btn`) | | `ui.click` |
| always | | `amb.sea` loop, level and tone follow the camera height |

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
