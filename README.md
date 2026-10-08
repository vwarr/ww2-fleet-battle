# Fleet Battle 1942

A retro 3D sea battle. Two fleets of World War 2 ships fight: the USN (blue) and the IJN (red).
Carriers launch planes. The planes attack with bombs and torpedoes. Destroyers hunt submarines.
Sunk ships stay on the seabed as wrecks. In shallow water, part of a wreck stays above the water.

You can watch it as a screensaver. A new round starts automatically after each battle.

## Open the game

1. Open a terminal in this folder.
2. Start a web server:

   ```
   python3 -m http.server 8000
   ```

3. In your web browser, go to `http://localhost:8000/`.

You can also open `index.html` directly from the disk. The game does not need a build step.
The game uses one web font from Google Fonts. If you are offline, the game uses a monospace font.

## Auto mode

Auto mode is the default mode.

- The game makes a new map and two random fleets for each round.
- The camera moves slowly to the area with the most action.
- A round ends when one side has no ships. The banner shows the winner.
- A round has a time limit of 5.5 minutes. At the time limit, the side with more tonnage wins.
- After the banner, the next round starts automatically.

A typical round lasts 3 to 4 minutes at 1X speed.

## Setup mode

Use setup mode to put your own ships on the map.

1. Click **MODE: AUTO > SETUP** in the panel at the top left.
2. In the **FLEET SETUP** panel, click a ship type (for example, **DESTROYER**).
3. Click **SIDE** to select the nation (USN or IJN).
4. Click the water to put a ship there.
   - The water must be deep enough for that ship type. If it is too shallow, a message shows.
   - Do not put ships too near to other ships.
5. Right-click near a ship to remove it.
6. Click **START** to start the battle. Each side must have at least one ship.

Other buttons:

- **RANDOMIZE** makes two random fleets.
- **CLEAR** removes all ships.

After a battle in setup mode, the game uses your fleets again on a new map.
To go back to auto mode, click **MODE: SETUP > AUTO**.

## Controls

| Key or button | Action |
|---|---|
| `H` | Show or hide the HUD panel. |
| `B` | Show or hide the health bars above the ships. |
| `C` | Change the camera: TRACK (follows the action) or MAP (shows all of the map). |
| `1`, `2`, `4` | Set the game speed to 1X, 2X or 4X. |
| **1X / 2X / 4X** buttons | Set the game speed. |

In setup mode, the camera always shows all of the map.

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
| `js/core.js` | Settings, ship data and helpers. |
| `js/terrain.js` | The sea floor, islands and water. |
| `js/models.js`, `js/models_planes.js` | Ship and plane models. |
| `js/effects.js` | Splashes, explosions, smoke, wakes and oil. |
| `js/combat.js`, `js/combat_weapons.js` | Shells, anti-aircraft fire, torpedoes, bombs and depth charges. |
| `js/ships.js`, `js/ships_ai.js` | Ship movement, damage, sinking, wrecks and ship AI. |
| `js/aircraft.js` | Planes. |
| `js/camera.js` | The camera. |
| `js/ui.js` | The HUD, the setup panel and the health bars. |
| `js/main.js` | The main loop and the rounds. |
