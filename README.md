# Fleet Battle 1942

A calm, toy-like 3D sea battle that plays like a short film. Two fleets of World War 2 ships fight: the USN (blue) and the IJN (red).
Carriers launch planes. The planes attack with bombs and torpedoes. Destroyers hunt submarines.
Sunk ships stay on the seabed as wrecks. In shallow water, part of a wreck stays above the water.

You can watch it as a screensaver. A new round starts automatically after each battle.

Play it online: <https://varunwarrier.com/fleet-battle/>

## Documents

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | The modules, the load order, the coordinates, the main loop and the public functions of each module. |
| [docs/AUDIO.md](docs/AUDIO.md) | The sound engine: buses, the distance model, voice caps and how to write a sound patch. |

## Open the game

1. Open a terminal in this folder.
2. Start a web server:

   ```
   python3 -m http.server 8000
   ```

3. In your web browser, go to `http://localhost:8000/`.

You can also open `index.html` directly from the disk. The game does not need a build step.
The game uses two web fonts from Google Fonts. If you are offline, the game uses system fonts.

## Start a battle

When the game opens, it makes a new map and places two random fleets. The fleets wait for you.

- Click **Start** to start the battle.
- Click **Randomize** for two new random fleets, **New map** for a new map with the same fleets, or **Clear** to remove all ships.
- To change the fleets, see [Set up your own fleets](#set-up-your-own-fleets).

Each battle stands alone. During the battle, the panel is not shown. Only three small buttons (menu, fullscreen and sound) show at the top left. In fullscreen, these buttons are hidden too; push `H` for the panel.

- The camera works like a film director. It selects an interesting subject and films it with a slow, smooth shot.
  Subjects are, for example, a ship that sinks, a torpedo attack, a dive-bomb attack, a carrier that launches planes, a dogfight, a battleship that fires and a Catalina landing among survivors.
- A battle ends when one side has no ships. A caption shows the winner and the ships that each side lost.
- A battle has a time limit of 14 minutes at 1× speed. At the time limit, the side with more tonnage wins.
- After the caption, the game goes back to the start: a new map with fleets placed and waiting. If you placed your own fleets, the game keeps them.

The game runs at a calm pace: at 1× speed, the ships and planes move at half of their normal speed.
The fleets start on opposite sides of a large map, so each battle begins with an approach: the carriers launch strikes and the scouts search first. Long-range flying boats come in from off the map: a PBY Catalina or an H6K Mavis searches and shadows the enemy fleet from a distance (fighters hunt them), and a Catalina "Dumbo" lands beside downed airmen and sailors to pick them up. Air sighting reports can be wrong: a cruiser reported as a carrier sends a strike to the wrong ship. The light forces meet after about a minute, and the big guns open after about three minutes.
A typical battle lasts 9 to 13 minutes at 1× speed.

## Auto battles (screensaver)

Click **Auto battles** in the panel to watch endless random battles on new maps. A new battle starts automatically after each one.
You can also open `index.html?auto` to start in this mode.

## Set up your own fleets

1. In the **Fleet setup** panel, click a ship type (for example, **Destroyer**).
2. Click **Side** to select the nation (USN or IJN).
3. Click the water to put a ship there.
   - The water must be deep enough for that ship type. If it is too shallow, a message shows.
   - Do not put ships too near to other ships.
4. Right-click near a ship to remove it.
5. Click **Start** to start the battle. Each side must have at least one ship.

During a battle, push `H` and click **Edit fleet** to go back to your fleets.

## Controls

| Key or button | Action |
|---|---|
| `H`, or the **Menu** button | Show or hide the panel during the battle. The panel always shows in setup mode. |
| `N`, or **New battle** in the panel | Make a new map with new random fleets, placed and waiting. In auto battles, the next battle starts at once. |
| **Fullscreen** button | Show the game on the full screen. Click again (or push `Esc`) to go back. |
| `M`, or the 🔊 / 🔇 **Sound** button | Set the sound on or off. The default is off. The game remembers your choice. If the sound was on last time, the button shows **Tap to start**: the first click or key press starts the sound (browsers need this). |
| Volume slider in the panel | Set the sound volume. |
| `C` | Change the camera: CINEMATIC (the director camera) or MAP (shows all of the map from above). |
| `F` | Follow the action: start a story now. The camera picks a squadron or a fighter division and follows its mission like a film: the launch, the form-up, the flight out, the attack and the flight home. Push `F` again to stop. The director also tells a story by itself every few minutes. |
| `T` | Set the tilt-shift effect on or off. Tilt-shift blurs the top and bottom of the picture, so the scene looks like a small model. The default is on. |
| `P` | Set pixel mode on or off. Pixel mode shows the game at a low resolution, as in an old game. The default is off. |
| `1`, `2`, `4` | Set the game speed to 1×, 2× or 4×. |
| **1× / 2× / 4×** buttons | Set the game speed. These buttons are in the panel. |

### Free camera

During a battle, you can move the camera yourself:

| Input | Action |
|---|---|
| Drag with the left mouse button | Turn the camera around the point it looks at. |
| Mouse wheel | Move the camera nearer or farther. |
| Drag with the right mouse button, or `W` `A` `S` `D`, or the arrow keys | Move the camera across the sea. |
| `Q`, `E` | Turn the camera left or right. |
| `R`, `V` (or `Page Up`, `Page Down`) | Move the camera up or down. |
| Click a ship | Follow it. |
| Click a plane | Follow that plane and its wingmen as a story (the director camera takes over). |
| `Esc`, or click empty water | Stop following. |

When you do not touch the mouse or the keys for 20 seconds, the director camera starts again.

In setup mode, the camera always shows all of the map from above.
The game does not show health bars.

## Ships

| Ship | Weapons |
|---|---|
| Carrier | Fighters, dive bombers and torpedo bombers. Small guns. |
| Battleship | Large guns with a long range. |
| Cruiser | Medium guns and torpedoes. |
| Destroyer | Small guns, torpedoes and depth charges. |
| Submarine | Torpedoes. It can dive. It must come up to the surface after some time. |
| PT boat | A machine gun and torpedoes. It is very fast. |

## Files

| File | Contents |
|---|---|
| `index.html` | The page. It loads the scripts in the correct order. |
| `style.css` | The panels, the captions and the tilt-shift bands. |
| `vendor/three.min.js` | Three.js r149 (MIT licence). |
| `js/core.js` | Settings, ship data, the random number generator, the event bus and helpers. |
| `js/audio.js`, `js/audio_synth.js`, `js/audio_base.js`, `js/audio_amb.js` | The sound engine, the shared synth parts, the first sounds, and the ambience / UI / cinematic sounds. All sound is made by the code (no audio files). |
| `js/audio_aa.js` | Anti-aircraft sounds: heavy AA, flak bursts, light AA by gun type, tracer whiz, a distant barrage rumble. |
| `js/audio_naval.js`, `js/audio_naval_wire.js` | Naval sounds: guns by calibre, shell whistles, splashes, hits, fires, sinking, torpedoes, depth charges, submarines, ship engines. |
| `js/sky.js` | The sky, the clouds, the lights and the haze. |
| `js/water.js` | The water surface, the foam, the depth colours and the contact shadows under hulls. |
| `js/terrain.js` | The sea floor, the islands and the depth grid. |
| `js/models.js`, `js/models_detail.js`, `js/models_planes.js` | Ship models, fine ship detail and plane models. |
| `js/effects.js` | Splashes, explosions, smoke, fire, wakes, trails and oil. |
| `js/damage.js` | Fires and smoke at the points where ships are hit. The wind. |
| `js/combat.js`, `js/combat_weapons.js` | Shells, anti-aircraft fire, torpedoes, bombs and depth charges. |
| `js/ships.js` | Ship movement, damage, sinking and wrecks. |
| `js/ships_nav.js` | The hull outline checks against land, and the collisions between ships. |
| `js/ships_ai.js` | Ship AI: targets, guns, torpedoes, submarines, PT boats and carriers. |
| `js/aircraft.js` | Planes. |
| `js/camera.js` | The director camera and the map camera. |
| `js/camera_story.js`, `js/camera_story_shots.js` | Story mode: the camera follows one squadron or fighter division through its mission (key `F`). |
| `js/freecam.js` | The free camera (mouse and keys). |
| `js/post.js` | The bloom and the soft tone curve. |
| `js/ui.js` | The panels, the setup clicks, the captions and fullscreen. |
| `js/main.js` | The renderer, the main loop and the rounds. |
| `tests/` | Browser tests (Playwright). Run `npm install`, then `npm test`. The simulation tests (`npm run test:ai`, `test:balance`, `test:determinism`) run the game in sim-only mode (`index.html?sim`: no rendering, the same results); add `--render` for the full game. Refer to `docs/ARCHITECTURE.md`, "Sim-only mode". |

## Licence

Three.js is © the Three.js authors and has the MIT licence. Refer to the header of `vendor/three.min.js`.
The other files in this repository do not have a licence yet.
