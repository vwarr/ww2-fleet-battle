# Player fighter mode: plan (filed 2026-10-13, not started)

## Goal
The player picks a side, takes off in a fighter (the USN **F4U Corsair**, kept on purpose despite 1942; the IJN **A6M Zero**) from their carrier or their side's island runway, and flies it in the live battle. Every AI plane, ship and AA gun treats the player's plane exactly like one of their own or an enemy AI plane: it gets intercepted, escorted, shot at by flak, and counted in strikes and CAP. The rest of the battle carries on as the self-playing film.

## Decisions (user, 2026-10-13)
- **Controls:** direct keyboard / joystick, not mouse-aim.
- **Flight model:** semi-arcade, from the game's existing plane stats.
  - Turn, climb, dive and speed, with energy bled in hard turns and a stall only at very low speed.
  - The national matchup still matters: the Zero out-turns and out-climbs; the Corsair dives faster, is tougher and hits harder.
- **Start / death:** take off from the deck or runway. When shot down or ditched, respawn in another fighter from a deck or field with fighters left, after a short delay. The battle continues meanwhile.
- **Scope:**
  - strafe ships and PT boats;
  - land and rearm;
  - wingmen with simple orders;
  - spawn into a role (CAP over the fleet, or escort for the next strike).

## Defaults I've assumed (change any)
- **Camera:** chase camera behind the plane by default, plus a cockpit/gunsight view on `V`, and a "look at target" padlock while held. The director camera is off while flying. The plot table (`C`) and the war diary (`L`) still work.
- **Time:** the battle runs at 1× while the player flies, with no time warp. Pause is allowed (`Esc`).
- **Entry:** a "Fly" button on the setup screen (side: USN / IJN), and a "Take a fighter" key during a running Pacific battle.
- **Scenario:** Pacific only for the first version, not Normandy.
- **Difficulty:** AI planes are the existing AI. No aim assist except a lead-indicator pipper.

## Architecture
The player's plane must be a real `WW.Plane` in `WW.world.planes`, so all the AI just works (`air_dogfight.js` pick, `air_intercept.js`, `air_cap.js`, `combat_aa.js` priority, `air_strafe.js`). Only its brain is replaced.

1. **New `js/player.js`** (input → control state):
   - Key / gamepad mapping:
     - pitch: W/S or ↑/↓;
     - roll: A/D or ←/→;
     - rudder: Q/E;
     - throttle: Shift/Ctrl or a gamepad trigger;
     - guns: Space or a trigger;
     - flaps / airbrake: F;
     - land assist: L, hold;
     - wingman orders: 1-4;
     - camera: V;
     - padlock: hold C.
   - Uses the Gamepad API when a pad is present.
   - Must not collide with the existing global keys. They're disabled while flying:
     - N new battle;
     - Tab / 8 / 9 / F camera keys;
     - Konami.
   - Produces `{ pitch, roll, yaw, throttle, fire }` each frame.
2. **New `js/player_flight.js`** (semi-arcade flight model for one plane):
   - Rate-based pitch, roll and yaw, scaled by speed: control authority drops at low speed.
   - Speed comes from throttle, minus drag, plus gravity along the flight path (energy).
   - Turn rate and climb come from `WW.planeType()` / `PLANE_NATION` / `PLANE_FLIGHT` (the same numbers the AI uses).
   - Stalls below about 0.45× cruise: the nose drops and roll authority fades. No spins in v1.
   - Terrain and sea floors via `Plane.floorAt()` (merged today), with a crash on contact through `air_impact.js`.
   - Altitude uses the game's compressed scale (`WW.altOf`); the HUD shows real feet / metres.
   - Hooks in by overriding the player plane's `update()` / `fighter()` branch (`aircraft.js`), the way `air_strafe.js` wraps `Plane.fighter`. When `p.player` is set, the AI brain is skipped.
3. **Guns:**
   - The same rounds and damage as AI fighters (`air_dogfight.js` fireRound → `planeTracers`), with the player's convergence and the plane's `gun` factor: Corsair six .50s, Zero 2×7.7 mm plus 2×20 mm with limited cannon ammo.
   - Ammunition counts, with rearm on landing.
   - Hits on ships go through the existing strafe damage (`air_strafe.js` small-craft rules: real damage to PT boats and subs, AA suppression on big ships, `combat_aa` `aaSup`).
4. **Take-off and landing:**
   - **Carrier:** spawn spotted on the deck through the deck queue (`air_deck.js`). The player holds the brakes, runs up the throttle and releases; the existing deck-run physics hand over to `player_flight` at lift-off.
   - **Island:** the runway hold-short and line-up from `land_ground.js`; the take-off roll is player-controlled.
   - **Landing:** a hold-to-land assist (L) flies the existing recovery path (`air_recovery.js` groove and trap for carriers, `land_flow.js` for the island), with a wave-off if the approach is bad. The player only has to arrive near the ship or field, slow and low, in the pattern.
   - **On landing:** refuel, rearm and repair over a short timer, then launch again.
5. **Respawn:**
   - On death (`shotDown` / ditch / crash), a 10-15 s cut to the director film with a "Return to the fight" prompt. Pressing it spawns a fighter from the nearest friendly deck or field with fighters left (`cv.hangar.fighter`, `base slots`), on the deck / hold-short.
   - Respawns consume real planes from the side's inventory. If none are left, the mode ends and the film continues.
6. **AI integration:**
   - The player plane is `kind 'fighter'` with a squadron (VF-x / Tainan) and `p.player = true`.
   - Enemy CAP and escorts pick it like any fighter. AA treats it normally.
   - Friendly AI doesn't shoot it; friendly fire stays as it is now.
   - The fleet commander counts it in air strength. `air_staff` "known CAP" sees it like any fighter.
7. **Roles / spawn choice:**
   - At spawn the player picks:
     - **CAP:** a marker on the fleet's CAP station and the incoming-raid bearing from radar (`intel`), with a "Vector" HUD arrow;
     - **Escort the next strike:** joins `air_strikes` as an escort member when the next wave forms, with a HUD marker on the strike leader;
     - **Free hunt.**
   - The HUD shows contacts known to the player's side only (fog of war: `intel.enemyPlanes`), with a mini radar ring.
8. **Wingmen:**
   - On take-off the player leads a section of two (USN; 3 for an IJN shotai) taken from the deck's fighters.
   - The AI wingmen fly in formation off the player (`air_dogfight` has wingman logic, `df.def`; reuse the mutual-support code).
   - **Orders:** 1 attack my target, 2 cover me / break, 3 rejoin, 4 go home.
   - The HUD shows wingman status.
9. **HUD** (`js/player_hud.js`, DOM overlay in the film style):
   - speed, altitude, throttle, heading, ammo, damage;
   - a gunsight with a lead pipper on the targeted plane;
   - target box and name;
   - the role marker;
   - the landing-assist cue;
   - a damage vignette and engine-smoke warning;
   - a "Bingo fuel" warning (fuel from the plane's existing `fuel`).
10. **Camera** (`js/player_cam.js`):
    - chase: spring arm, slight lag, rolls with the plane;
    - cockpit: the gunsight view from the model's canopy, frame overlay;
    - padlock;
    - the director suspended while the player is alive. Reuse `WW.cam.update` override patterns (as the shot scripts and the easter egg do) and `shader_warm.js` stays effective.
11. **Sim / determinism:**
    - Player input makes the round non-deterministic by nature. That's fine: player mode is excluded from `?sim`, the tests and the traces.
    - All player code is inert unless the mode is on, so `trace_dump` stays identical with the mode off. This is the gate for every phase.

## Phases (each mergeable and testable)
1. **P1 Fly:**
   - side select and spawn airborne in the battle (a debug air start);
   - `player.js` input, `player_flight.js`, chase camera, minimal HUD;
   - guns and tracers;
   - AI engages the player.
   - **Test:** a Playwright script holds keys and checks the plane responds, isn't NaN, and enemy fighters target it (`p.foe === player`).
2. **P2 Deck and runway take-off, landing assist, rearm.**
3. **P3 Respawn, inventory, end-of-mode handling.**
4. **P4 Roles:** CAP vectoring, strike escort, radar contacts on the HUD.
5. **P5 Wingmen and orders.**
6. **P6 Strafing ships and PT boats, cockpit view, padlock, polish:** sounds (engine pitch from throttle and speed, guns), damage effects.
7. **P7 Gamepad support and key remapping.**

## Risks
- **Flight feel:** semi-arcade needs a tuning pass by hand. Plan one session of the user flying and giving feedback after P1.
- **Scale:** planes are small against the map, and the compressed altitude makes 1:1 feel odd. The chase-camera distance and HUD in real units should handle it.
- **Key conflicts** with the existing global hotkeys (an input-mode switch is required).
- **Performance:** a close chase camera means more first-time shader variants, which `shader_warm.js` covers. Fine tracer detail near the camera was fixed today.
- **AI fairness:** the AI fighters' gunnery was tuned against other AI. A human may find them too easy or too hard. Expose a difficulty factor (AI fighter accuracy).
