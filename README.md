# Abyssal Stride

A third-person hand-drawn anime 3D roguelite set in a cosmic-horror / dark-fantasy abyss. Freeflow combat, procedural worlds, tiered loot, bosses and a persistent skill tree. Everything is plain JavaScript and WebGL2. There is no engine, no framework, no build step, no assets and no runtime dependencies.

## Run it

```bash
npm start
```

Then open <http://localhost:8080>. Any static file server works, since the game is just `index.html` and ES modules. You need a browser with WebGL2 (any current Chrome, Edge, Firefox or Safari).

```bash
npm test
```

```bash
npm run smoke
```

`npm test` runs the unit tests for the pure game logic (Node 18+). `npm run smoke` runs a headless Chromium playthrough that writes screenshots to `tools/shots/` and needs Playwright. `node tools/autoplay.mjs 120` is a soak test: a bot plays the game and logs its progress.

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move | WASD | Left stick |
| Camera | Mouse (click to capture) | Right stick |
| Strike (freeflow) | LMB / J | X |
| Heavy, or Takedown at 10+ combo | RMB / K | Y |
| Dodge roll / backflip | Space / Shift | A |
| Counter (cyan sigil) | Q / F | B |
| Rend Reality (ultimate) | R | RB |
| Open loot container | E | LB |
| Pick upgrade / reroll | 1 2 3 (4) / X | D-pad up/down/left/right / Back |
| Pause | Esc / P | Start |

## How a run works

1. **Explore a procedurally generated open world** (about 300 × 300 m) for the current dimension. Enemy spawns ramp up with time and depth, and periodic **Tides** send surges at you.
2. **Earn shards and experience.** Kills drop soul wisps (XP) and shards. Each level-up pauses the game and offers **one of three upgrades** rolled from the reward table. Each card's rarity is one of six tiers: Common, Uncommon, Rare, Epic, Legendary or Eldritch.
3. **Open loot containers** with shards. There are three tiers (Reliquary, Ossuary Casket, Eldritch Coffer). They cost more as you open more of them and as you go deeper, and higher tiers guarantee rarer offers and more weapons.
4. **Awaken obelisks.** Each one you charge pays out loot and brings the **timed Rift** closer. Once the Rift opens it closes again after 80 seconds. If you miss it, an elite hunt spawns and the Rift reopens later.
5. **Step into the Rift to fight the dimension's boss** in a sanctum floating over the void. When it dies it drops a relic reward and an exit portal that takes you one Depth further down. The next dimension is harder.
6. **Death ends the run** and converts your progress into **Echoes**. You spend Echoes in the **Ossuary of Echoes** skill tree (25 nodes across Body, Blade, Mind and Rift). The tree has a full-refund reset.

## Features

**Freeflow combat**
- Strikes auto-target the best enemy in your stick or camera direction and **lunge** up to 9 m to reach it.
- Combo chains differ per weapon. Light hits interrupt weaker enemies, and heavy hits break the poise of elites.
- **Counter** any enemy showing a cyan sigil (this also works on bosses) for a slow-motion riposte. Red telegraphs can't be countered and have to be dodged.
- Dodges have i-frames. A dodge with no direction becomes a backflip.
- Hits have hitstop, screen shake and FOV kicks. Combo ranks run from Fervent up to Godslayer, and the combo multiplies your damage.
- At 10+ combo, a heavy attack becomes a **Takedown**. Hits charge **Rend Reality**, an ultimate that hits everything in a wide area with a big shockwave.

**Weapons**
- Bare Knuckles, Crescent Blade, Greatcleaver, Voidspear, Twin Fangs, Grave Maul and Reaper Scythe.
- Each weapon has its own stance, moveset, reach and speed.
- Every rarity tier upgrades the procedural model: glowing fullers, rune studs, horned guards, a watching eye at Eldritch, plus orbiting relic shards. Trails and effects change with tier too: coloured trails, sparks, idle auras, lights, and void smoke at the top tier.

**Upgrades**
- 16 attributes, such as damage, attack speed, crit, lifesteal, reach and area, armour, momentum, phase step and thorns.
- 10 abilities that stack with "power": Void Orbitals, Starlight Arc (chain lightning), Blood Nova, Spectral Blades (homing), Entropy Field, Echo Strike, Starfall, Singularity (gravity well), Ember Step and Eldritch Gaze.

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
- About 15k pooled particles (sparks, blood, smoke, embers), persistent blood decals, shockwaves, lightning and up to 16 dynamic point lights.

**Animation**
- The procedural stickman has FK arms and **two-bone IK legs**.
- Feet adapt to the terrain, and the gait is generated from movement speed.
- Spring-driven secondary motion covers leaning into acceleration and hit reactions.
- Keyframed action clips include rolls and flips.

**Original retro look** (still selectable as `retro`)
- The scene renders at a low internal resolution with vertex snapping and is upscaled nearest-neighbour.
- Post-processing adds ordered dithering with colour quantisation, bloom, chromatic aberration, a reality-warp effect, film grain and a vignette.

## Art style: Ink Requiem

The game's look is **Ink Requiem**: 90s OVA colour cel shading with black boiling ink lines, drawn on twos, with an anime sound set. It was chosen from three asset packs; the others stay available in **Settings → Art style**, or with `?style=` in the URL, for example `http://localhost:8080/?style=sutra`. Each pack bundles a render style, its own cast of character designs, effects, animation timing, a camera and a sound set.

| Pack | Id | Render | Cast | Camera and timing | Sound |
| --- | --- | --- | --- | --- | --- |
| Original | `retro` | Smooth lighting, dithered, no outlines | Stick figures | Perspective, full frame rate | Retro synth |
| **1 · Ink Requiem (default)** | `requiem` | 90s OVA colour cel, black boiling ink | Silver-haired swordsman in an indigo long coat | Perspective, on twos | Anime: shings, bells, sparkles |
| 2 · Black Sutra | `sutra` | Monochrome manga screentone, red survives | Ponytailed swordswoman, talisman ghouls, oni brute | Perspective, on twos | Taiko: drums, clacks, flute, chimes |
| 3 · Paper Lantern | `lantern` | Storybook cut-out, thick brush lines, hatching | Button-eyed lantern bearer, rag dolls, paper ghosts | Pseudo-3D orthographic diorama, on threes | Folk: woodblocks, music box, kalimba |

Combinations: `requiem+neon`, `sutra+colour`, `requiem+diorama`, `lantern+perspective`.

The HUD and menus are drawn in the same anime style, entirely in CSS, inline SVG and canvas code with system fonts. They include ink-outlined slanted panels, screentone, speed lines and starbursts. The hero portrait changes its face when you are hit or low on health. Damage numbers overshoot into place. Title cards slam in letter by letter, and boss warnings come with hazard tape. Transitions are an ink wipe. The colours follow the active pack, and animation respects `prefers-reduced-motion`.

All hand-drawn packs share the same character tech:

- **Models.** The 16-joint pose drives a 28-joint skeleton: a curved three-segment spine, clavicles, a lagging head, wrists and hand tips with follow-through, thumbs, heels and rolling toes. Each cast's designs are skinned onto it with faces, hair and clothing. Hair, coat tails, sashes and robes run on physics chains. Other creatures get fleshed-out volumes over their rigs.
- **Ink pass.** Depth and normal edges from a G-buffer become outlines that re-trace a few times a second ("line boil").
- **Cel effects and sky.** Effects are flat painted shapes, and the sky is banded with painted clouds.
- **Impact frames and speed lines.** Two-tone impact frames fire on counters, takedowns and big kills, and speed lines appear during lunges.

`node tools/previz.mjs <id>` replays the same seeded scenes in one pack and saves stills, a model sheet and a combat clip. It needs Playwright.

Everything is generated in code. The project uses no downloaded models, textures, fonts or sounds.

## Architecture

```
src/
  core/   math (column-major mat4, TRS/segment writers), seeded RNG, noise, spatial hash, input (+gamepad), WebAudio synth
  gfx/    WebGL2 renderer (instanced primitive batches, terrain, quads/decals, sky, bloom, post), toon/ink shaders + style presets, meshes, particle pools
  game/   game loop/orchestrator, player controller, humanoid solver + clips, anatomy (expanded skeleton + skinned bodies), legged locomotion, rig + ragdolls,
          enemies, bosses, abilities, spawner, world generation, dimensions, weapons, upgrades table, meta skill tree
  ui/     DOM HUD + 2D overlay (damage numbers, markers, prompts), level-up cards, menus, skill tree
```

**Performance**
- All geometry is built from a handful of low-poly primitives (box, sphere, cylinder, cone, octahedron, orb) drawn as **instanced batches**, about 7 draw calls for every creature, weapon and prop.
- Static props are uploaded once. Destroyed props are hidden by zeroing their instance slot.
- Particles live in structure-of-arrays pools that don't allocate each frame.
- Neighbour queries go through a spatial hash.
- Headless Chromium on SwiftShader measured about 2–5 ms of JavaScript per frame with 40+ enemies on screen.
