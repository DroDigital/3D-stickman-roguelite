# Abyssal Stride

A cinematic third-person 3D action roguelite set in a cosmic-horror / dark-fantasy abyss. Four-slot arsenal combat with evolving weapons, magic and superpowers, escalating waves, procedural worlds, bosses and a persistent skill tree. Everything is plain JavaScript and WebGL2: no engine, no framework, no build step and no runtime dependencies. The default look, **Abyssal Cinematic**, combines that code with free sourced assets (PBR textures, HDR environments, a skinned character mesh and a sound library, all CC0 or CC BY; see [assets/CREDITS.md](assets/CREDITS.md)).

## Run it

```bash
npm start
```

Then open <http://localhost:8080>. For a standalone window instead, see [Desktop app](#desktop-app-windows-macos-linux). Any static file server works, since the game is just `index.html`, ES modules and the `assets/` folder. You need a browser with WebGL2 and float render targets (any current Chrome, Edge, Firefox or Safari). Without float targets the game falls back to the Ink Requiem look.

URL options for previews: `?gfx=low|medium|high|ultra` picks the graphics preset, `?style=<id>` picks a pack and `?dim=0..3` starts a run straight in a realm.

```bash
npm test
```

```bash
npm run smoke
```

`npm test` runs the unit tests for the pure game logic (Node 18+). `npm run smoke` runs a headless Chromium playthrough that writes screenshots to `tools/shots/` and needs Playwright (it uses the Low preset by default so software rendering keeps up). `node tools/autoplay.mjs 120` is a soak test: a bot plays the game and logs its progress. `node tools/fetch-assets.mjs` re-downloads and re-converts the sourced assets (see the comment at the top of the file).

## Desktop app (Windows, macOS, Linux)

The launcher runs the game in its own window, with no browser chrome, from the same files as the web build. Saves and settings stay with each install. F11 toggles fullscreen.

**Installers.** `.github/workflows/desktop.yml` builds every platform on its own runner, on each version tag (and on demand), and attaches the results to the release:

| Platform | Files | Notes |
| --- | --- | --- |
| Windows 10/11, x64 | `Abyssal Stride Setup …exe` (installer) or the `…portable.exe` (no install) | Unsigned, so SmartScreen may ask: *More info → Run anyway*. |
| macOS 11+, Apple silicon or Intel | `.dmg` (drag to Applications) or `.zip` | Unsigned: right-click the app and choose *Open* the first time, or run `xattr -dr com.apple.quarantine "/Applications/Abyssal Stride.app"`. |
| Linux, x64 | `…AppImage` (`chmod +x`, then run) or `…amd64.deb` | The deb adds a menu entry. |

**Run from the source tree** (Node 20 or newer):

```bash
npm install
npm run desktop
```

**Build installers yourself:**

```bash
npm run dist          # this platform's installers, into dist/
npm run dist:linux    # AppImage and deb
npm run dist:win      # NSIS installer and portable exe (best on Windows)
npm run dist:mac      # DMG and ZIP for Intel and Apple silicon (needs macOS)
```

Notes:
- Installers are unsigned. Signing and notarisation need your own certificates; electron-builder reads them from environment variables (see its documentation). `package.json` → `build` holds the configuration.
- The launcher serves the game from an in-app `app://game` origin, so it needs no server and no network.
- On Linux, the AppImage runs with the Chromium sandbox disabled, because Ubuntu's AppArmor rules block its setup. The app only loads its own files.
- `npm run desktop:selftest` loads the game headlessly, saves `tools/shots/desktop-selftest.png` and exits. On a Linux machine with no display, run it under `xvfb-run -a`.
- Icons come from `tools/make-icons.py` (needs Pillow).

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move / sprint | WASD / hold Shift | Left stick / L3 |
| Camera | Mouse (click to capture) | Right stick |
| Lock on / off | Tab or middle mouse | R3 or LT |
| Switch lock target | Mouse wheel, C / Z, or a sharp mouse flick | Flick the right stick |
| Blade slot (melee chain, hold to keep cutting) | LMB / J | X |
| Arms slot (hold to fire) | RMB / K | Y |
| Arcana slot (spell) | Q | B |
| Power slot (superpower) | F | RB |
| Dodge roll / backflip | Space | A |
| Rend Reality (ultimate) | R | RT |
| Open loot container | E | LB |
| Pick upgrade / reroll | 1 2 3 (4) / X | D-pad up/down/left/right / Back |
| Pause | Esc / P | Start |

Lock-on camera assist and flick-switch sensitivity are adjustable in Settings.

## How a run works

1. **Explore a procedurally generated open world** (about 300 × 300 m) for the current dimension and **survive its waves.** Each wave has a quota of enemies and a short breather after it. Every third wave ends in a **Tide** that crashes in from one side, and every fourth is an **Elite wave**.
2. **Earn shards and experience.** Kills drop soul wisps (XP) and shards. Experience is lean and the level curve is steep. Each level-up pauses the game and offers **one of three cards**: a new item for an empty slot, a level for an item you own, a rare replacement, a passive attribute, or (when one is ready) an **Evolution**. Each card's rarity is one of six tiers: Common, Uncommon, Rare, Epic, Legendary or Eldritch.
3. **Open loot containers** with shards. There are three tiers (Reliquary, Ossuary Casket, Eldritch Coffer). They cost more as you open more of them and as you go deeper, and higher tiers guarantee rarer offers and more weapons.
4. **Awaken obelisks.** Each one you charge pays out loot and brings the **timed Rift** closer. Once the Rift opens it closes again after 80 seconds. If you miss it, an elite hunt spawns and the Rift reopens later.
5. **Step into the Rift to fight the dimension's boss** in a sanctum floating over the void. When it dies it drops a relic reward and an exit portal that takes you one Depth further down. The next dimension is harder.
6. **Death ends the run** and converts your progress into **Echoes**. You spend Echoes in the **Ossuary of Echoes** skill tree (25 nodes across Body, Blade, Mind and Rift). The tree has a full-refund reset.

## Features

**Combat: four designated slots**
- **Blade** (melee chain), **Arms** (held ranged fire), **Arcana** (spells on a cooldown) and **Power** (superpowers on a long cooldown). All four are equipped at once, each on its own input.
- There is no lunging, countering or combo scaling. Cuts land where you stand, every enemy attack has a red telegraph and must be dodged, and only heavy hits break a windup.
- **Lock-on** frames the target beside you, makes you strafe around it, and aims Arms and Arcana at it. Switch targets with the wheel or a quick flick. The lock hops to the next foe when the target dies.
- **Sprint** for speed: it holds fire, kicks up the realm under your feet and streaks the air.
- Dodges and dashes have i-frames. A dodge with no direction becomes a backflip. Damage dealt slowly charges **Rend Reality**, an ultimate that hits everything around you.

**The arsenal**
| Slot | Items |
| --- | --- |
| Blade | Crescent Katana, Twin Fangs, Greatcleaver, Reaper Scythe, Voidspear, Spirit Fists |
| Arms | Ofuda Talismans, Spirit Bow, Kunai Fan, Chakram Halo, Soul Revolver |
| Arcana | Thunder Sigil, Frost Lotus, Hellfire Kanji, Blood Moon, Void Orb |
| Power | Afterimage, Gravity Crush, Chrono Stop, Berserk Aura, Phantom Arms |

- Every item levels from 1 to 5. Blade levels also upgrade the procedural model (fullers, runes, horns), and several items gain new behaviour at Lv 3 and Lv 5.
- **Evolutions use marked combinations.** Each recipe has a unique mark (ϟ, ◐, ❄ …) shown on both ingredients' cards and on the slot bar, and it lights up when you own the partner. A max-level base plus its marked partner offers an Evolution card that transforms the base in place. Some items branch: Crescent Katana becomes **Raijin Edge** with Thunder Sigil or **Muramasa** with Blood Moon, and Spirit Bow becomes **Glacier Comet** with Frost Lotus or **Raiju Longbow** with Thunder Sigil.
- 16 evolutions: Raijin Edge, Muramasa, Shadow Waltz, Worldsplitter, Eclipse Reaper, Glacial Pike, Asura Hundred Fists, Thousand Seal Inferno, Glacier Comet, Raiju Longbow, Thousand Kunai Storm, Clockwork Halo, Last Rites, Infernal Calligraphy, Event Horizon and Crimson Moonrise.
- Status effects: freeze (frozen foes take +25% damage and some evolutions shatter them), stopped time, burn and bleed.

**Upgrades**
- 17 passive attributes with deliberately modest values: damage, attack/fire rate, movement and sprint speed, health, lifesteal, crit, reach and area, pickup radius, luck, armour, Arcana/Power cooldowns, regeneration, experience, dodge cooldown and thorns.

**Difficulty**
- The player starts lean: 90 health, low regeneration, and 65% experience gain on a steep level curve.
- Every wave survived across the run raises enemy health, damage, speed, attack frequency and elite odds, and every Depth raises them further.
- Bosses scale with depth, with waves survived and with each guardian already slain. During the fight they call in waves of adds, then enrage after 100 seconds or below 25% health.

**Enemies**
| Enemy | What it does |
| --- | --- |
| Strung Husk | A marionette that hangs on strings from the void |
| Gloomhound | A procedurally legged quadruped that pounces |
| Skitterling | An IK-legged spider that arrives in broods |
| Drifting Gazer | A floating eyeball that fires bolts |
| Bellwether Brute | Ground slams |
| Hollow Chorister | Teleports and calls down void pillars |
| Abyssal Maw | A tentacled spawner |

Elite "Eldritch" variants of all of these can appear.

**Bosses**
- **The Hollow / Flayed Shepherd**: an antlered giant with a lantern staff and a summoned flock.
- **The Tidewyrm**: a burrowing serpent with telegraphed breaches, a surface phase and bite and spit attacks.
- **Oculus Primordial**: a giant eye that sweeps a beam and fires bolt rings, eye rain and dives.

Every boss has a second phase.

**Dimensions**
| Dimension | Theme |
| --- | --- |
| Ashen Hollows | Embers, dead trees, bone spires |
| Drowned Abyss | Coral, tendrils, bubbles |
| Starless Veil | Floating rocks, monoliths, starfall |
| Flesh Cathedral | Ribcages, egg sacs, spores |

Each dimension has its own lighting, fog, sky (with a nebula and a watching eclipse), terrain palette, props, enemy pool and boss.

**Simulation and visual effects**
- Verlet **ragdolls**, generated from any creature rig, with **dismemberment** on brutal kills.
- A Verlet cloth scarf on the player.
- Rigid-ish **debris physics** from **destructible** pillars, urns, crystals and egg sacs.
- About 27k pooled particles (sparks, blood, smoke, embers), persistent blood decals, shockwaves, lightning and up to 16 dynamic point lights.
- **Smoke is a dithered cutout**: an ordered 4×4 screen-door with inked edges instead of a translucent blend. It thins out further around the player on screen, so fighters always read through it.
- **Realm atmosphere** in layers: ash, embers and dust in the Ashen Hollows; bubbles, plankton and silt in the Drowned Abyss; star motes, void sparks and glyph rings in the Starless Veil; spores and blood drips in the Flesh Cathedral. Every ambient particle parts around the player and gets swept along in their wake, much harder while sprinting.
- **Dense foliage per realm**: ash grass, kelp, crystal shards or flesh cilia. Tufts are streamed in 4 m cells around the player and drawn as one instanced batch. The vertex shader bends every blade away from the player, the last second of footsteps (which spring back), nearby enemies and blasts. Running or dodging through dense patches throws blades into the air.

**Animation**
- The procedural stickman has FK arms and **two-bone IK legs**.
- Feet adapt to the terrain, and the gait is generated from movement speed.
- Spring-driven secondary motion covers leaning into acceleration and hit reactions.
- Keyframed action clips include rolls and flips.

**Original retro look** (still selectable as `retro`)
- The scene renders at a low internal resolution with vertex snapping and is upscaled nearest-neighbour.
- Post-processing adds ordered dithering with colour quantisation, bloom, chromatic aberration, a reality-warp effect, film grain and a vignette.

## Art style: Abyssal Cinematic

The default pack renders the game as a dark-fantasy action title:

**Lighting and materials**
- A linear HDR pipeline with physically based (GGX) shading.
- Image-based lighting from real HDR environments (Poly Haven), with spherical-harmonic diffuse and prefiltered reflections, tinted per realm.
- Soft directional shadows from the eclipse that hangs in every sky.
- Point lights for fire, magic and lightning.
- PBR texture sets (Poly Haven / ambientCG) applied triplanar to the terrain and every prop: ash, sand, moon dust and flesh grounds blend into cliff rock on slopes. Bark, ruins, bone, coral, obsidian, forged steel, iron, leather and cloth are textured in object space, so moving props and weapons never swim.
- Glowing veins in the ground (embers, bioluminescence, void light, pulsing blood).
- Surfaces react to weather: rain darkens and glosses everything and fills puddles that ripple with every drop, while ash fall settles a grey dust on up-facing surfaces.

**Characters**
- The hero and humanoid enemies are a skinned mannequin mesh (Quaternius, CC0) driven by the game's own procedural animation. The 28-joint skeleton is retargeted onto the mesh's 53 bones every frame using aim constraints and bone stretch, so every combat clip, IK step and ragdoll still applies, and fingers curl around the grip.
- Each cast is dressed in PBR materials: a dark iron knight with a hood, mantle, coat tails and glowing joints and eyes, porcelain husk marionettes, flesh brutes with horns, robed choristers, and a bark-skinned shepherd.

**Atmosphere**
- A half-resolution volumetric fog march, with god rays from the shadow map, scattering from point lights and drifting noise. The hero and every blast push holes in the fog.
- Screen-space ambient occlusion.
- Soft, depth-faded particles: additive sparks and embers glow in HDR, and smoke is lit.
- A painted eclipse sky with a cloud deck, a corona and lightning flashes.

**Weather**
Each realm cycles through its own states:

| Realm | Weather states |
| --- | --- |
| Ashen Hollows | Ash fall, ember storms, dry lightning storms |
| Drowned Abyss | Rain, thunderstorms, mist |
| Starless Veil | Void snow, starfall with meteor impacts |
| Flesh Cathedral | Blood rain, spore fog |

- Precipitation is a GPU particle field around the camera.
- Wind veers and gusts, bending the dense foliage in rolling waves.
- Lightning lights the whole scene, scorches the ground where it strikes, and its thunder arrives after the flash.
- Flocks of crows, glowing fish, void moths or carrion flies settle around you and scatter at sprints, blasts and thunder.

**Camera**
A director layers several effects over the gameplay camera:
- Trauma-based rotational shake, FOV punches and dutch-angle kicks on heavy hits.
- Slow-motion finisher orbits with shallow depth of field and letterbox on elite and last-enemy kills.
- A low letterboxed orbit when a guardian is introduced, and long pull-backs for boss and hero deaths.

**Post-processing**
- Physically based bloom with lens dirt, and depth of field.
- ACES filmic tonemapping with per-realm grading (lift, gamma, gain and split toning).
- Chromatic aberration, radial speed blur, vignette, film grain, a low-health pulse and FXAA.
- Smooth HDR ribbon trails follow the blade.

**Sound**
- Layered, randomised samples (Oculus Audio Pack, CC BY 4.0, and sfx-kit, CC0): flesh, bone, steel, cloth, voices, creatures, footsteps by surface, thunder, rain and wind.
- Placed in 3D with HRTF panning and sent through a per-realm convolution reverb.
- Ducked under big impacts, and muffled in slow motion and at low health.
- An adaptive score (drone bed, creepy strings and organ swells, war drums, low ostinato, and a boss choir) rises and falls with the fight.

**Interface**
The HUD and menus are minimal and engraved:
- Hairline vitals at the bottom left and circular ability slots at the bottom right.
- A single objective line, and secondary information that recedes when nothing is happening.
- Serif damage numerals, quiet edge-clamped markers and a thin lock-on reticle.

Menus support keyboard and gamepad navigation with focus descriptions. Settings are tabbed (Video, Audio, Camera & Controls) and can restore defaults. There are Controls and Credits screens, and the pause screen shows run stats and asks for confirmation before abandoning a run.

**Graphics presets** (Settings → Video, or `?gfx=`)

| Preset | Render scale | Shadows | Fog steps | SSAO | Extras |
| --- | --- | --- | --- | --- | --- |
| Low | 60% | 1024 | 12 | No | — |
| Medium | 75% | 2048 | 18 | Yes | Depth of field |
| High (default) | 90% | 2048 | 26 | Yes | Fog lights, denser foliage |
| Ultra | 100% | 4096 | 36 | Yes | All of the above |

Assets stream in while the title screen runs. Anything that fails to load falls back to the procedural version.

## Hand-drawn packs

The earlier looks stay available in **Settings → Video → Art style**, or with `?style=`.

| Pack | Id | Render | Cast | Camera and timing | Sound |
| --- | --- | --- | --- | --- | --- |
| **Abyssal Cinematic (default)** | `cinematic` | HDR PBR, volumetrics, weather | Skinned mannequins | Perspective, full frame rate, director shots | Sampled, adaptive score |
| Original | `retro` | Smooth lighting, dithered, no outlines | Stick figures | Perspective, full frame rate | Retro synth |
| 1 · Ink Requiem | `requiem` | 90s OVA colour cel, black boiling ink | Silver-haired swordsman in an indigo long coat | Perspective, on twos | Anime: shings, bells, sparkles |
| 2 · Black Sutra | `sutra` | Monochrome manga screentone, red survives | Ponytailed swordswoman, talisman ghouls, oni brute | Perspective, on twos | Taiko: drums, clacks, flute, chimes |
| 3 · Paper Lantern | `lantern` | Storybook cut-out, thick brush lines, hatching | Button-eyed lantern bearer, rag dolls, paper ghosts | Pseudo-3D orthographic diorama, on threes | Folk: woodblocks, music box, kalimba |

Combinations: `requiem+neon`, `sutra+colour`, `requiem+diorama`, `lantern+perspective`.

The hand-drawn packs share the same character tech:

- **Models.** The 16-joint pose drives a 28-joint skeleton with a curved spine, clavicles, a lagging head, wrists, thumbs, heels and rolling toes. Hair, coat tails and robes run on physics chains.
- **Ink pass.** Depth and normal edges become outlines that re-trace a few times a second ("line boil").
- **Impact frames and speed lines** on decisive hits and sprints.

Their HUD and menus are drawn in CSS, inline SVG and canvas code in a matching anime style. `node tools/previz.mjs <id>` replays seeded scenes in one pack and saves stills (needs Playwright).

## Architecture

```
src/
  core/   math (column-major mat4, TRS/segment writers), seeded RNG, noise, spatial hash, input (+gamepad), WebAudio synth,
          asset loader (assets.js), sampled soundscape with reverb, 3D panning and adaptive score (soundscape.js)
  gfx/    WebGL2 renderer (instanced primitive batches, terrain, quads/decals, sky, bloom, post), toon/ink shaders + style presets, meshes, particle pools,
          cinematic shaders + realm looks + quality presets (cinematic.js), the cinematic frame (cinepipe.js), skinned mannequin retarget (skinned.js),
          PBR material ids (materials.js)
  game/   game loop/orchestrator, player controller, humanoid solver + clips, anatomy (expanded skeleton + skinned bodies), legged locomotion, rig + ragdolls,
          enemies, bosses, abilities, spawner, world generation, dimensions, weapons, upgrades table, meta skill tree,
          weather + critters (weather.js), camera director (director.js), ribbon trails (trails.js)
  ui/     DOM HUD + 2D overlay (damage numbers, markers, prompts), level-up cards, menus with keyboard/gamepad navigation, skill tree
assets/   sourced textures, HDRIs, mannequin mesh and sound banks + CREDITS.md (fetched and converted by tools/fetch-assets.mjs)
```

**Performance**
- All props and creatures other than the mannequins are built from a handful of low-poly primitives (box, sphere, cylinder, cone, octahedron, orb) drawn as **instanced batches**, about 7 draw calls for every creature, weapon and prop, with per-instance PBR material ids. All mannequins share one bone texture.
- Static props are uploaded once. Destroyed props are hidden by zeroing their instance slot.
- Particles live in structure-of-arrays pools that don't allocate each frame.
- Neighbour queries go through a spatial hash.
- Headless Chromium on SwiftShader measured about 2–5 ms of JavaScript per frame with 40+ enemies on screen.
