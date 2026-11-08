# Graphics overhaul: voxel fog, horizon AO and sharper environments

Status: design, written alongside the implementation. Sections 5 and 5b–5c record what was built. Each section lists what changes, what does not, and how it is checked.

## 1. Request and reading

The request: replace the game's assets (models, animations, effects, shaders and so on) with better ones, and add graphic upgrades such as ambient occlusion and voxel fog.

Reading used here:

- "Assets" means the visual ones: HDR environments, PBR textures, the character mesh, shaders and particle effects. Audio is out of scope for this pass.
- "Better" must be sourced under CC0 or CC BY, and reachable from this environment. The sandbox proxy currently allows GitHub raw files, the npm registry and a few other hosts. It blocks polyhaven.com, ambientcg.com, quaternius.com, kenney.nl, jsDelivr, unpkg and cdnjs.
- The project already has an asset pipeline (`tools/fetch-assets.mjs`) and a licence file (`assets/CREDITS.md`). New assets go through the same route.

What the reachable sources allow:

| Asset | Current | Best reachable | Decision |
| --- | --- | --- | --- |
| HDR environments | 512 × 256 RGBE PNG | 1024 × 512 Poly Haven 1k originals (three.js mirror) | Upgrade the four realm maps |
| PBR texture sets | 512 × 512 KTX2 | Mirror is capped at 512 px by design; higher masters are on blocked hosts | Keep; add detail in the shader |
| Character mesh and skeleton | Quaternius UAL mannequin, 53 bones, retargeted from a 28-joint rig | CC0 low-poly characters on npm (`@netforge/asset-library-files`) use other rigs and a different style | Keep; a swap would need a new rig mapping (out of scope) |
| Animation | Procedural clips and IK | Mocap clips exist for the UAL skeleton but are not in the repo | Keep; needs a retarget step (out of scope) |
| Fog | Per-pixel ray march, 12–36 steps, jittered | Newer technique, not an asset | Replace with a voxel grid (section 2) |
| Ambient occlusion | 10-tap world-space hemisphere, jittered, no temporal filter | Newer technique, not an asset | Replace with horizon AO plus temporal filter (section 3) |

## 2. Voxel (froxel) volumetric fog

### Current state

`VOLFOG_FS` in `src/gfx/cinematic.js` marches every half-resolution pixel through the fog: 12–36 steps, a value-noise density with wind drift, eight point lights and a shadow-map lookup per step. Each pixel pays for all of that, and the jitter shows as noise in motion.

### Design

Replace the per-pixel density and lighting work with a view-aligned grid of voxels ("froxels"):

1. **Grid.** A `RGBA16F` 3D texture of `GX × GY × GZ` cells. `GY` and `GZ` come from the quality preset, and `GX = round(GY × aspect)`. Slices are spaced exponentially in view depth, from `near` to `gridFar` (110 m).
2. **Inject (once per froxel per frame).** For each slice, a fullscreen draw into that layer computes the world position of the froxel centre (with a per-frame jitter in depth) and evaluates the realm's density (same height falloff, noise, wind and hole terms as today). It also evaluates the scattering: ambient, the key light times the shadow-map term times the phase function, and the point lights when the preset allows. The output is `rgb = scatter × density` and `a = density`.
3. **Temporal reuse.** Each froxel reprojects into the previous frame's grid with the previous view-projection matrix and blends `mix(history, new, 0.1)`. The first frame, a camera cut or a grid resize uses the new value only.
4. **March (half resolution).** Each pixel marches up to the scene depth through the grid, stepping uniformly in slice space, and accumulates radiance and transmittance: `L += T × rgb × dt`, `T *= exp(-a × dt)`. Beyond `gridFar` it keeps the existing analytic height-fog tail.
5. **Apply.** The existing bilateral upsample and `FOG_APPLY_FS` stay as they are.

The grid's cost depends on the preset, not on the render scale, so the adaptive resolution scaler does not reallocate it.

### Limits

- Lightning uses the same flash uniform as before. The history blend adds about 10 frames of latency to a flash, which is acceptable.
- The phase term uses each froxel's centre direction, not the exact per-pixel direction. Phase varies slowly, so this is invisible in practice.

## 3. Horizon ambient occlusion with temporal filter

### Current state

`VOLFOG_FS` also computes a 10-sample world-space hemisphere AO at half resolution, with a per-pixel rotation and no filtering over time. Its normal comes from one cross product of neighbouring depths, so it is noisy at silhouettes.

### Design

1. **Normals.** Best-of-two neighbour reconstruction: for each axis, use the neighbour with the smaller depth step. This removes most silhouette artefacts.
2. **Horizon AO (GTAO formulation).** Per pixel, `slices` directions (2 / 3 / 4 by preset). Each direction marches `steps` samples on each side, out to a world radius of 0.7 m projected to pixels. The horizon cosines are combined with the cosine-weighted visibility integral from Jiménez et al. (2016). Per-pixel rotation and a per-frame offset decorrelate the noise over time.
3. **Temporal filter.** A second half-resolution pass reprojects the previous accumulated AO (`RG16F`: AO and linear depth) with the previous view-projection. It rejects history when the depth differs by more than 5%, and blends `mix(history, raw, 0.15)` otherwise.
4. **Apply.** The bilateral upsample in `FOG_APPLY_FS` reads the accumulated AO instead of the raw AO. The strength stays at 0.85 with the same curve.

### Applied to indirect light only

The lit shaders (terrain, props, characters and foliage) sample last frame's accumulated AO at the surface's reprojected position and dim only the ambient and indirect specular terms. Sunlit surfaces keep their colour, and the occlusion sits in the crevices, roots and under props. The fog apply no longer multiplies the whole frame by AO.

The cost is one frame of latency. The reprojection hides it while the camera moves, and the depth test rejects history where the view has changed.

## 4. Environment maps at 1024 × 512

The four realm HDRIs (`dusk`, `overcast`, `night`, `blood`) come from the Poly Haven 1k originals in the three.js examples mirror. They are decoded with three's `RGBELoader` and re-encoded as RGBE-in-PNG at 1024 × 512, the same format the loader already reads. The loader takes its size from the image, so nothing else changes. The spherical-harmonic fit and the unit-irradiance normalisation are unchanged, and the prefiltered reflections become sharper.

`tools/fetch-assets.mjs` gets the new HDRI size and the conversion. `assets/CREDITS.md` keeps the same CC0 credit.

## 5. Shader polish

Implemented, gated by the quality flags (Medium and above):

- **Multi-scatter energy compensation** on the indirect specular term (Fdez-Agüera 2019): `1 + F0 × (1/E − 1)` with `E` from the existing split-sum table.
- **Micro relief** in the triplanar terrain and prop shader: a procedural gradient at two finer scales perturbs the normal. Its strength fades with the texel footprint from `fwidth`, so it disappears before it can shimmer at a distance, and the 512 px tiling stops showing at close range.
- **Contact shadows** (section 5b).

## 5b. Contact shadows

The sun term of every lit surface is multiplied by a short screen-space march: eight samples from the surface toward the key light, out to about 0.5 m. Each sample is reprojected with last frame's matrix and compared with last frame's depth buffer, in metres. A sample that sits behind the visible surface by 3–10 cm, and no more than 0.4–0.7 m, counts as occluded. The result is a crisp shadow where a foot, a hilt or a blade meets the ground. The shadow map is too coarse to show it.

Last frame's depth is used because the depth copy is only written after the HDR pass. The cost is one frame of latency, and the same history reset rules as the AO apply.

## 5c. Dense meadows and interaction mist

Two things change the density of the air where the world reacts:

- **Denser grass.** The tuft count per 4 m cell is multiplied by the quality preset (Low 1.5×, Medium 2.5×, High 4×, Ultra 5×). The meadow threshold is widened so most of the streamed ground grows grass. The instance budget rises from 16384 to 65536 tufts. Tall growths (kelp and cilia) keep a per-kind factor (0.45 and 0.7), so they never hide the hero from the camera. The grass shader and its bending are unchanged.
- **Mist where the world reacts.** The meadow map (48 × 48 cells of 2 m, centred on the player and rebuilt every 6 m of movement) carries each cell's grass density and ground height. The fog grid adds extinction in the ground layer over every grass cell, with a height fall-off of about 0.8 m, drifting patches, and a feathered edge. Every push source (the hero, the footstep trail, blasts and nearby enemies, the same list that bends the grass) adds a pocket of extinction around it, thickest at ground level and fading with distance and height. Pockets follow each source's strength, so blasts burst and then fade. The hero and blasts still clear the view around themselves, because the holes are applied after the mist.

The limits are the same as in section 2: the grid is temporally blended, so the mist lags a moving source by about ten frames, which reads as a trail.

## 6. Quality presets

| Preset | Fog grid (GY × GZ) | Fog march steps | AO | AO slices × steps |
| --- | --- | --- | --- | --- |
| Low | 45 × 24 | 16 | off | — |
| Medium | 68 × 36 | 20 | on | 2 × 3 |
| High (default) | 90 × 48 | 24 | on | 3 × 4 |
| Ultra | 135 × 64 | 32 | on | 4 × 5 |

Point lights in the grid stay on for High and Ultra, as they are now.

## 7. Verification

- `npm test` stays green. New pure helpers (slice mapping, depth-to-slice and back, reprojection bounds) get unit tests.
- Headless captures in all four realms at High, before and after, reviewed by eye. Captures are in the scratchpad, not the repo.
- Console and WebGL errors checked on every capture run.
- Frame cost cannot be measured on SwiftShader, so no speed claim is made from it. The grid and AO costs are bounded by the preset values above.

## 8. Risks

- 3D textures and framebuffer layers are WebGL2 features. They are already required for float render targets, so the fallback path does not change.
- Temporal reuse can ghost in fast motion. The history blend is kept low and the reset rules are explicit.
- The AO temporal filter and the grid share one reprojection matrix. A bug in one shows in the other, so they are checked together.

## 9. Out of scope

- Replacing the character mesh, its rig or its animation set.
- Replacing the procedural creature geometry.
- Higher-resolution PBR textures, until a source reachable from the sandbox exists.
- Audio.
