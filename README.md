# Fleet Battle 1942

A calm, toy-like 3D sea battle that plays like a short film. Two fleets of World War 2 ships fight: the USN (blue) and the IJN (red).
Carriers launch planes. The planes attack with bombs and torpedoes. Destroyers hunt submarines.
Sunk ships stay on the seabed as wrecks. In shallow water, part of a wreck stays above the water.
Most battles are fought by day, in the golden afternoon light. Some start late in the afternoon, and dusk falls during the battle. A few are night actions from the start, under a low moon. At night the fight is lit by gun flashes, burning ships, star shells and searchlights. Carriers stop flying at dusk. IJN lookouts see farther in the dark, and USN ships have radar. Rain squalls drift across some maps. Ships can hide in them, and they spoil dive bombing.

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
5. Click **Base** to choose who holds the island airfield: USN, IJN or none. The airfield shows on the map.
6. Click **Start** to start the battle. Each side must have at least one ship.

### The island base

Each map has one or two large islands. One has an airfield, like Midway: runways, hangars, a control tower, fuel tanks, AA guns and coastal guns. The side that holds it has an air group on the island (fighters, dive bombers, B-17s and B-26s for the USN; Zeros and Betty bombers for the IJN). The other side tries to knock the base out with carrier strikes and battleship gunfire: bombs crater the runways (work crews fill them again), hangars and fuel tanks burn, and guns are silenced. When the runways are closed and the guns are out, the base is "neutralized". A base that survives counts for its owner when the time runs out.

During a battle, push `H` and click **Edit fleet** to go back to your fleets.

## Controls

| Key or button | Action |
|---|---|
| `H`, or the **Menu** button | Show or hide the panel during the battle. The panel always shows in setup mode. |
| `N`, or **New battle** in the panel | Make a new map with new random fleets, placed and waiting. In auto battles, the next battle starts at once. |
| **Fullscreen** button | Show the game on the full screen. Click again (or push `Esc`) to go back. |
| `M`, or the 🔊 / 🔇 **Sound** button | Set the sound on or off. The default is off. The game remembers your choice. If the sound was on last time, the button shows **Tap to start**: the first click or key press starts the sound (browsers need this). |
| Volume slider in the panel | Set the sound volume. |
| `C` | Change the camera: CINEMATIC (the director camera) or MAP. In a battle, the map is the admiral's plot table: a paper chart on a wooden table, with the ships as small painted wooden tokens, the planes as small markers and the strikes as pencil lines. |
| `G` | Choose whose plot (it also opens the plot table): OMNISCIENT (every ship at its true position), USN PLOT or IJN PLOT. A side's plot shows only what that side knows: enemy tokens at their last-known positions in the type that was reported (a scout can make a mistake), pencil circles that grow as a contact gets old, dashed course arrows, and pinned paper notes for the sighting reports ("2 CV, 040, 0714"). |
| `X` | On the plot table, show or hide the danger layer: where the chosen side thinks the enemy guns and torpedoes reach (red) and where the enemy AA is (blue). |
| `L` | Show or hide the war diary: a typed log of the battle with clock times (sightings, strikes, hits, sinkings, the admirals' orders). It shows at the side of the plot table; in the director view it is off until you push `L`. Important entries also show as a short caption. |
| `F` | Follow the action. The camera goes at once to the attack that is about to happen (a strike closing on its target, dive bombers about to push over, a torpedo run, torpedoes running at a ship) and follows it like a film. If no attack is coming, it shows the best action now. A small label at the bottom left says what you follow, for example "VT-6 strike reaches the carrier in ~25 s". While you follow something, push `F` again to give the camera back to the director. The director also tells such stories by itself, and it tries to arrive 10 to 30 s before an attack. |
| `Tab`, `Shift` + `Tab` | Go to the next or the previous upcoming attack, in time order. |
| `8` | Go to the next dogfight. |
| `9` | Go to the next ship in danger (torpedoes running at it, fires, flooding). |
| `O` | When you move the camera around a subject that you follow: keep your view fixed to the subject's heading (the default: the view turns with it) or fixed to the world. |
| `T` | Set the tilt-shift effect on or off. Tilt-shift blurs the top and bottom of the picture, so the scene looks like a small model. The default is on. |
| `P` | Set pixel mode on or off. Pixel mode shows the game at a low resolution, as in an old game. The default is off. |
| `1`, `2`, `4` | Set the game speed to 1×, 2× or 4×. |

After each battle, an **action report** shows: the winner and how, each side's admiral, the ships and planes each side lost, the ship of the day and the top pilot, and the key moments from the war diary. It stays on the ready screen until the next battle (in auto battles, for about half a minute). Click it to hide it.
| **1× / 2× / 4×** buttons | Set the game speed. These buttons are in the panel. |

### Free camera

During a battle, you can move the camera yourself:

| Input | Action |
|---|---|
| Drag with the left mouse button | Turn the camera around the point it looks at. When you follow a ship or a plane, you turn around it. |
| Mouse wheel (or a trackpad pinch) | Move the camera nearer or farther. |
| Drag with the right mouse button, or `W` `A` `S` `D`, or the arrow keys | Move the camera across the sea. This stops following. |
| `Q`, `E` | Turn the camera left or right. |
| `R`, `V` (or `Page Up`, `Page Down`) | Move the camera up or down. |
| Click a ship | Follow it. You can then turn around it, move nearer or farther, and move up or down; the camera stays at that place relative to the ship (see `O`). |
| Click a plane | Follow that plane and its wingmen as a story (the director camera takes over). |
| `Esc`, or click empty water | Stop following. |

If you touch the mouse or the keys while the director camera films a ship or a plane (also in a story), the camera keeps that subject, and you move around it. The director does not cut away while you control the camera. When you do not touch the mouse or the keys for some seconds (10 s when you took over a director shot, 25 s after you clicked a ship, 20 s otherwise), or when you push `F`, the director camera starts again.

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
| `js/sky.js`, `js/sky_time.js` | The sky, the clouds, the lights and the haze. The look of the time of day (dusk, the blue hour, a moonlit night) and of the rain. |
| `js/daylight.js`, `js/weather.js`, `js/night_ops.js` | The round's clock and daylight, the rain squalls, and what darkness and rain change for the fleets: what they see, star shells, searchlights, radar and night tactics. |
| `js/night_fx.js`, `js/weather_fx.js` | Night lighting (fires, star shells, searchlights, gun flashes) and the rain curtains and cloud decks. |
| `js/water.js` | The water surface, the foam, the depth colours and the contact shadows under hulls. |
| `js/terrain.js`, `js/terrain_islands.js` | The sea floor, the islands (a Midway-style atoll or a big volcanic island, with an airfield) and the depth grid. |
| `js/island_base.js`, `js/base_ai.js`, `js/land_air.js`, `js/base_fx.js`, `js/models_base.js`, `js/models_landplanes.js` | The island air base: runways, hangars, guns, its planes (B-17s, B-26s, Bettys), the fight for the island, and how it looks. |
| `js/models.js`, `js/models_detail.js`, `js/models_planes.js` | Ship models, fine ship detail and plane models. |
| `js/effects.js` | Splashes, explosions, smoke, fire, wakes, trails and oil. |
| `js/damage.js` | Fires and smoke at the points where ships are hit. The wind. |
| `js/combat.js`, `js/combat_weapons.js` | Shells, anti-aircraft fire, torpedoes, bombs and depth charges. |
| `js/ships.js` | Ship movement, damage, sinking and wrecks. |
| `js/ships_nav.js` | The hull outline checks against land, and the collisions between ships. |
| `js/ships_ai.js` | Ship AI: targets, guns, torpedoes, submarines, PT boats and carriers. |
| `js/aircraft.js` | Planes. |
| `js/camera.js` | The director camera and the map camera. |
| `js/camera_story.js`, `js/camera_story_shots.js` | Story mode: the camera follows one squadron or fighter division through its mission. |
| `js/camera_finder.js`, `js/camera_follow.js` | The imminent-action finder (attacks that are about to happen) and the follow keys `F`, `Tab`, `8`, `9`, with the follow label. |
| `js/freecam.js` | The free camera (mouse and keys). |
| `js/post.js` | The bloom and the soft tone curve. |
| `js/ui.js` | The panels, the setup clicks, the captions and fullscreen. |
| `js/plot_table.js`, `js/plot_tokens.js` | The plot table in map view: the chart, the tokens, the pencil marks and the notes (keys `G`, `X`). |
| `js/war_diary.js` | The war diary (key `L`). |
| `js/aar_card.js` | The action report after a battle. |
| `js/main.js` | The renderer, the main loop and the rounds. |
| `tests/` | Browser tests (Playwright). Run `npm install`, then `npm test`. The simulation tests (`npm run test:ai`, `test:balance`, `test:rounds`, `test:determinism`) run the game's sim-only mode (`index.html?sim`: no rendering, the same results) natively in Node worker threads, with no browser or server; they need a Node with V8 15 or newer (`npm run get-node` fetches one, the tests switch to it by themselves). Add `--browser` for headless Chrome, `--render` for the full game, `--workers K` for the parallelism. Refer to `docs/ARCHITECTURE.md`, "Sim-only mode". |

## Licence

Three.js is © the Three.js authors and has the MIT licence. Refer to the header of `vendor/three.min.js`.
The other files in this repository do not have a licence yet.
