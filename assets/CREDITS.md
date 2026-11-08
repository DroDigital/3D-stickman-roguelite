# Asset credits

Every sourced asset in this folder is free to use and redistribute. `tools/fetch-assets.mjs` downloads them from
the mirrors below and converts them (resizing, channel packing, re-encoding). Everything not listed here is
generated in code.

## Textures (`textures/`) — CC0 1.0

PBR sets, packed as `<id>_albedo.jpg`, `<id>_normal.jpg` (OpenGL convention) and `<id>_arm.jpg`
(R = ambient occlusion, G = roughness, B = metalness). Mirrored in
[Papyszoo/CC0-Public-Domain-Textures](https://github.com/Papyszoo/CC0-Public-Domain-Textures).

| Id | Source asset | Author |
| --- | --- | --- |
| ash_ground | burned_ground_01 | Poly Haven |
| ash_rock | dark_rock | Poly Haven |
| sea_ground | damp_sand | Poly Haven |
| sea_rock | seaside_rock | Poly Haven |
| void_ground | moon_dusted_02 | Poly Haven |
| void_rock | dark_rock_02 | Poly Haven |
| flesh_ground | red_mud_stones | Poly Haven |
| flesh_rock | cracked_red_ground | Poly Haven |
| bark | pine_bark | Poly Haven |
| ruin | castle_wall_slates | Poly Haven |
| steel | Metal061B | ambientCG |
| iron | Metal046B | ambientCG |
| cloth | rough_linen | Poly Haven |
| leather | brown_leather | Poly Haven |
| bone | Ivory001A | ambientCG |
| coral | coral_fort_wall_01 | Poly Haven |
| obsidian | Marble006 | ambientCG |
| flesh | leather_red_03 (albedo generated from its occlusion) | Poly Haven |

## HDR environments (`hdri/`) — CC0 1.0, Poly Haven

Stored as RGBE-in-PNG at 1024 × 512 (the 1k originals, at native size). Mirrored in the
[three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/textures/equirectangular).

| Id | Source |
| --- | --- |
| dusk | Venice Sunset (Greg Zaal) |
| overcast | Quarry 01 (Greg Zaal) |
| night | Moonless Golf (Greg Zaal) |
| blood | Blouberg Sunrise 2 (Greg Zaal) |

## Character model (`models/`) — CC0 1.0

The mannequin mesh and skin from the **Universal Animation Library (Standard)** by
[Quaternius](https://quaternius.com), mirrored in
[J-Ponzo/gltf-universal-animation-library](https://github.com/J-Ponzo/gltf-universal-animation-library).
The game drives its skeleton with its own procedural animation.

## Sound (`audio/`)

Converted to MP3 and loudness-normalised.

- **"Oculus Audio Pack 01" by Oculus VR, LLC**
  (https://developers.meta.com/vr/downloads/package/oculus-audio-pack-1/), licensed under
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Mirrored, renamed to the UCS naming convention, in
  [facebookincubator/Meta-open-sound](https://github.com/facebookincubator/Meta-open-sound). Used for swooshes,
  whooshes, gore, punches, swords, cloth, voices, creatures, chains, drones, creepy strings and organ, magic,
  footsteps, orchestral stingers, rain, wind, night and underwater ambiences.
- **sfx-kit** by Wyzowl ([wyzowl/sfx-kit](https://github.com/wyzowl/sfx-kit)), CC0 1.0. Used for thunder, booms,
  rumbles, sub drops, cinematic drums/metal/slams, impacts, risers, reverse whooshes, shimmers, coins, locks, UI
  taps and materialise effects.

## Fonts (`fonts/`) — SIL Open Font License 1.1

- **Cinzel** by Natanael Gama, from [google/fonts](https://github.com/google/fonts/tree/main/ofl/cinzel).
- **Cormorant Garamond** by Christian Thalmann, from [google/fonts](https://github.com/google/fonts/tree/main/ofl/cormorantgaramond).

Subset to Latin and the UI's symbols and converted to WOFF2. Licence text in `fonts/OFL.txt`.
