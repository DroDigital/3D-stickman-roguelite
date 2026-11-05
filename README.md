# Abyssal Stride

A third-person hand-drawn anime 3D roguelite set in a cosmic-horror / dark-fantasy abyss. Four-slot arsenal combat with evolving weapons, magic and superpowers, escalating waves, procedural worlds, bosses and a persistent skill tree. Everything is plain JavaScript and WebGL2. There is no engine, no framework, no build step, no assets and no runtime dependencies.

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

## Languages

The game ships in **English**, **Deutsch** and **Español**. Pick one in **Settings → Language**. The first time you play, it follows your browser's language when that is one of the three, and otherwise English. The choice is saved with your settings.

Everything the player reads is translated: menus, the HUD, announcements, item, upgrade, skill, enemy, boss and dimension names and descriptions, and the level-up and skill-tree text.

Translations live in `src/core/locales/`. The English text is the key, so `L("+{v} damage", { v: 12 })` returns the active language's text, or the English text when a translation is missing. Placeholders such as `{v}` must appear in every translation. `tests/i18n.test.js` fails if any shown string has no German or Spanish translation, or if a translation drops a placeholder. To add a language, create a locale file, add it to `DICT` and `LANGS` in `src/core/i18n.js`, and fill in every string the test lists.

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
- **Impact frames and speed lines.** Two-tone impact frames fire on evolutions, stopped time, guardian deaths and big hits, and speed lines appear while sprinting.

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
