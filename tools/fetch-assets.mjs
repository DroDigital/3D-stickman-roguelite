#!/usr/bin/env node
// Downloads the game's sourced assets from their CC0 / CC BY mirrors on GitHub and converts them into the compact
// formats the runtime loads (see src/core/assets.js). The converted files are committed under assets/, so you only
// need this to refresh or extend them.
//
//   npm i --no-save three@0.170.0 jpeg-js pngjs     (dev-only helpers: Basis transcoder + image encoders)
//   node tools/fetch-assets.mjs                     (needs ffmpeg on PATH for the audio)
//
// Sources and licences are listed in assets/CREDITS.md.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets');
const CACHE = process.env.ASSET_CACHE || path.join(ROOT, 'node_modules', '.asset-cache');
const require = createRequire(path.join(process.env.ASSET_TOOL_MODULES || path.join(ROOT, 'node_modules'), 'x.js'));
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const RAW = 'https://raw.githubusercontent.com';
const PAPY = `${RAW}/Papyszoo/CC0-Public-Domain-Textures/HEAD/packs`;
const THREE = `${RAW}/mrdoob/three.js/dev/examples/textures/equirectangular`;
const OCULUS = `${RAW}/facebookincubator/Meta-open-sound/HEAD/corpora/oculus-audio-pack/ogg`;
const SFXKIT = `${RAW}/wyzowl/sfx-kit/HEAD/sounds`;
const UAL = `${RAW}/J-Ponzo/gltf-universal-animation-library/HEAD/glTF`;

// ---------------------------------------------------------------- what we fetch
// PBR material layers (order = texture-array layer index; keep in sync with MAT in src/gfx/materials.js)
export const MATERIALS = [
  ['ash_ground', 'ph', 'burned_ground_01'],
  ['ash_rock', 'ph', 'dark_rock'],
  ['sea_ground', 'ph', 'damp_sand'],
  ['sea_rock', 'ph', 'seaside_rock'],
  ['void_ground', 'ph', 'moon_dusted_02'],
  ['void_rock', 'ph', 'dark_rock_02'],
  ['flesh_ground', 'ph', 'red_mud_stones'],
  ['flesh_rock', 'ph', 'cracked_red_ground'],
  ['bark', 'ph', 'pine_bark'],
  ['ruin', 'ph', 'castle_wall_slates'],
  ['steel', 'acg', 'Metal061B'],
  ['iron', 'acg', 'Metal046B'],
  ['cloth', 'ph', 'rough_linen'],
  ['leather', 'ph', 'brown_leather'],
  ['bone', 'acg', 'Ivory001A'],
  ['coral', 'ph', 'coral_fort_wall_01'],
  ['obsidian', 'acg', 'Marble006'],
  ['flesh', 'ph', 'leather_red_03'],
];

const HDRIS = [
  ['dusk', 'venice_sunset_1k'],
  ['overcast', 'quarry_01_1k'],
  ['night', 'moonless_golf_1k'],
  ['blood', 'blouberg_sunrise_2_1k'],
];

// id -> list of [source, file]. o = Oculus Audio Pack (CC BY 4.0), k = sfx-kit (CC0)
const SOUNDS = {
  swoosh: [['o', 'SWSH_Swoosh_OS_01'], ['o', 'SWSH_Swoosh_OS_02'], ['o', 'SWSH_Swoosh_OS_03'], ['o', 'SWSH_Swoosh_OS_04'], ['o', 'SWSH_Swoosh_OS_05'], ['o', 'SWSH_Swoosh_OS_06']],
  whooshSmall: [['o', 'WHSH_WhooshSmall_OS_01'], ['o', 'WHSH_WhooshSmall_OS_02'], ['o', 'WHSH_WhooshSmall_OS_03']],
  whooshHeavy: [['o', 'WHSH_WhooshMedium_OS_01'], ['o', 'WHSH_WhooshMedium_OS_02'], ['o', 'WHSH_WhooshMedium_OS_03'], ['k', 'whooshes/whoosh-slow-hard']],
  flesh: [['o', 'GORESqsh_BloodSquishSlimy_OS_01'], ['o', 'GORESqsh_BloodSquishSlimy_OS_02'], ['o', 'GORESqsh_BloodSquishSlimy_OS_03'], ['o', 'GORESqsh_BloodSquishSlimy_OS_04']],
  punch: [['o', 'FGHTImpt_PunchRegular_OS_01'], ['o', 'FGHTImpt_PunchRegular_OS_02'], ['o', 'FGHTImpt_PunchRegular_OS_03'], ['o', 'FGHTImpt_PunchRegular_OS_04'], ['o', 'FGHTImpt_PunchHarder_OS_01'], ['o', 'FGHTImpt_PunchHarder_OS_02']],
  punchHeavy: [['o', 'FGHTImpt_PunchHardest_OS_01'], ['o', 'FGHTImpt_Kick_OS_01'], ['o', 'FGHTImpt_Kick_OS_02']],
  bones: [['o', 'GOREBone_BonesBreaking_OS_01'], ['o', 'GOREBone_BonesBreaking_OS_02'], ['o', 'GOREBone_BonesBreaking_OS_03'], ['o', 'GOREBone_SkullCracking_OS_01']],
  sword: [['o', 'WEAPSwrd_Sword_OS_01'], ['o', 'WEAPSwrd_Sword_OS_02']],
  clash: [['o', 'WEAPSwrd_SwordClash_OS_01'], ['o', 'WEAPSwrd_SwordScrape_OS_01']],
  cloth: [['o', 'CLOTHMvmt_ClothingMovement_OS_01'], ['o', 'CLOTHMvmt_ClothingMovement_OS_02'], ['o', 'CLOTHMvmt_MovementWithGear_OS_01'], ['o', 'CLOTHMvmt_MovementWithGear_OS_02']],
  heroHurt: [['o', 'VOXMale_Male01Hurt_OS_01'], ['o', 'VOXMale_Male01Hurt_OS_02'], ['o', 'VOXMale_Male01Hurt_OS_03']],
  heroEffort: [['o', 'VOXEfrt_Male01Effort_OS_01'], ['o', 'VOXEfrt_Male02Effort_OS_01']],
  heroDeath: [['o', 'VOXMale_Male01DeathScream_OS_01']],
  creatureHurt: [['o', 'CREAHmn_TrollHurt_OS_01'], ['o', 'CREAHmn_TrollHurt_OS_02'], ['o', 'CREAHmn_OgreHurt_OS_01'], ['o', 'CREAHmn_OgreHurt_OS_02'], ['o', 'CREAHmn_GiantHurt_OS_01']],
  creatureDeath: [['o', 'CREAHmn_TrollDeath_OS_01'], ['o', 'CREAHmn_OgreDeath_OS_01'], ['o', 'CREAHmn_OgreDeath_OS_02'], ['o', 'CREAHmn_GiantDeath_OS_01']],
  creepy: [['o', 'CREAMnstr_CreatureCreepy_OS_01'], ['o', 'CREAMnstr_CreatureCreepy_OS_02'], ['o', 'CREAMnstr_CreatureCreepyReverb_OS_01'], ['o', 'CREAMnstr_CreatureCreepyReverb_OS_02']],
  roar: [['o', 'CREAHmn_GiantDeathScream_OS_01'], ['o', 'CREAHmn_GiantEffort_OS_01'], ['o', 'CREAMnstr_CreatureCreepyReverb_OS_03']],
  laugh: [['o', 'VOXLaff_EvilLaugh_OS_01'], ['o', 'VOXLaff_EvilLaugh_OS_02']],
  whispers: [['o', 'VOXWhsp_WhispersCreepyReverb_OS_01']],
  chains: [['o', 'CHAINMvmt_ChainsCreepy_OS_01'], ['o', 'CHAINMvmt_ChainsCreepy_OS_02']],
  scrape: [['o', 'METLFric_ScratchCreepyReverb_OS_01'], ['o', 'METLFric_ScratchCreepyReverb_OS_02']],
  creepyImpact: [['o', 'DSGNImpt_ImpactCreepyReverb_OS_01'], ['o', 'DSGNImpt_ImpactCreepyReverb_OS_02'], ['o', 'DSGNImpt_ImpactCreepyReverb_OS_03']],
  drone: [['o', 'DSGNDron_DroneCreepy_OS_01'], ['o', 'DSGNDron_DroneCreepy_OS_02']],
  strings: [['o', 'MUSCStr_StringsCreepy_OS_01'], ['o', 'MUSCStr_StringsCreepy_OS_02']],
  organ: [['o', 'MUSCKeyd_PipeOrganCreepy_OS_01']],
  magic: [['o', 'MAGSpel_MagicSpell_OS_01'], ['o', 'MAGSpel_MagicSpell_OS_02']],
  metal: [['o', 'METLImpt_MetalHitSurface_OS_01'], ['o', 'METLImpt_MetalHitSurface_OS_02'], ['o', 'METLImpt_HammerAnvil_OS_01']],
  stepDirt: [['o', 'FEETHmn_ShoeDirtRun_OS_01'], ['o', 'FEETHmn_ShoeDirtRun_OS_02'], ['o', 'FEETHmn_ShoeDirtRun_OS_03'], ['o', 'FEETHmn_ShoeDirtRun_OS_04'], ['o', 'FEETHmn_ShoeDirtRun_OS_05']],
  stepGrass: [['o', 'FEETHmn_ShoeGrassRun_OS_01'], ['o', 'FEETHmn_ShoeGrassRun_OS_02'], ['o', 'FEETHmn_ShoeGrassRun_OS_03'], ['o', 'FEETHmn_ShoeGrassRun_OS_04'], ['o', 'FEETHmn_ShoeGrassRun_OS_05']],
  stepSnow: [['o', 'FEETHmn_ShoeSnowRun_OS_01'], ['o', 'FEETHmn_ShoeSnowRun_OS_02'], ['o', 'FEETHmn_ShoeSnowRun_OS_03'], ['o', 'FEETHmn_ShoeSnowRun_OS_04']],
  land: [['o', 'FEETHmn_ShoeDirtLand_OS_01'], ['o', 'FEETHmn_ShoeDirtLand_OS_02']],
  levelup: [['o', 'MUSCStngr_LevelUpOrchestral_OS_01'], ['o', 'MUSCStngr_LevelUpOrchestral_OS_02']],
  victory: [['o', 'MUSCStngr_VictoryOrchestral_OS_01']],
  loss: [['o', 'MUSCStngr_LossOrchestral_OS_01']],
  // loops
  ambNight: [['o', 'AMBForst_Night_LOOP_01']],
  ambUnderwater: [['o', 'AMBUndwtr_Underwater_LOOP_01']],
  ambBubbles: [['o', 'WATRBubl_WaterBubbles_LOOP_01']],
  rain: [['o', 'RAINVege_ForestRain_LOOP_01']],
  wind: [['o', 'WINDVege_LightWindTreesBirds_LOOP_01']],
  // sfx-kit (CC0)
  thunder: [['k', 'cinematic-hits/cinematic-thunder-big'], ['k', 'cinematic-hits/cinematic-thunder-massive']],
  boom: [['k', 'booms-and-bass/boom-hit-strong'], ['k', 'booms-and-bass/boom-hit-medium'], ['k', 'booms-and-bass/boom-drop-strong']],
  rumble: [['k', 'booms-and-bass/bass-rumble-medium'], ['k', 'booms-and-bass/bass-rumble-long']],
  subDrop: [['k', 'booms-and-bass/bass-sub-drop-medium'], ['k', 'booms-and-bass/bass-sub-drop-long']],
  cineDrum: [['k', 'cinematic-hits/cinematic-drum-big'], ['k', 'cinematic-hits/cinematic-drum-massive']],
  cineMetal: [['k', 'cinematic-hits/cinematic-metal-big'], ['k', 'cinematic-hits/cinematic-metal-massive']],
  cineSlam: [['k', 'cinematic-hits/cinematic-slam-big'], ['k', 'cinematic-hits/cinematic-slam-massive']],
  impact: [['k', 'impacts/impact-heavy-hard'], ['k', 'impacts/impact-deep-hard'], ['k', 'impacts/impact-medium-hard']],
  riser: [['k', 'risers-and-fallers/riser-2s-strong'], ['k', 'risers-and-fallers/riser-1s-strong']],
  reverse: [['k', 'reverse-whooshes/reverse-whoosh-short-strong'], ['k', 'reverse-whooshes/reverse-whoosh-medium-strong'], ['k', 'reverse-whooshes/reverse-whoosh-long-strong']],
  shimmer: [['k', 'shimmers/shimmer-short-sparkle'], ['k', 'shimmers/shimmer-medium-bright'], ['k', 'shimmers/shimmer-long-sparkle']],
  coin: [['k', 'money/money-coin-drop'], ['k', 'money/money-coin-spin']],
  lock: [['k', 'mechanical/mechanical-lock-heavy'], ['k', 'mechanical/mechanical-latch-heavy']],
  uiTap: [['k', 'interface/click-tap-soft'], ['k', 'interface/click-snap-medium']],
  materialise: [['k', 'appear-and-vanish/appear-materialise'], ['k', 'appear-and-vanish/appear-burst'], ['k', 'appear-and-vanish/appear-dissolve']],
};
const LOOPS = new Set(['ambNight', 'ambUnderwater', 'ambBubbles', 'rain', 'wind', 'drone']);

// ---------------------------------------------------------------- helpers
async function fetchCached(url) {
  const f = path.join(CACHE, url.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_'));
  if (fs.existsSync(f)) return fs.readFileSync(f);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const b = Buffer.from(await r.arrayBuffer());
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(f, b);
      return b;
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
    }
  }
}

let basis = null;
async function transcoder() {
  if (basis) return basis;
  const dir = path.dirname(require.resolve('three/examples/jsm/libs/basis/basis_transcoder.js'));
  // the transcoder is a CommonJS/UMD script inside an ESM package, so evaluate it with a stand-in module object
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', '__filename', fs.readFileSync(path.join(dir, 'basis_transcoder.js'), 'utf8'))(mod, mod.exports, require, dir, path.join(dir, 'basis_transcoder.js'));
  const BASIS = mod.exports;
  const wasmBinary = fs.readFileSync(path.join(dir, 'basis_transcoder.wasm'));
  basis = await new Promise((resolve) => { const M = { wasmBinary, onRuntimeInitialized: () => resolve(M) }; BASIS(M); });
  basis.initializeBasis();
  return basis;
}

/** KTX2 (UASTC/ETC1S) -> { w, h, rgba } at mip 0. */
async function decodeKtx2(buf) {
  const B = await transcoder();
  const f = new B.KTX2File(new Uint8Array(buf));
  if (!f.isValid() || !f.startTranscoding()) throw new Error('bad ktx2');
  const w = f.getWidth(), h = f.getHeight();
  const n = f.getImageTranscodedSizeInBytes(0, 0, 0, 13);
  const rgba = new Uint8Array(n);
  if (!f.transcodeImage(rgba, 0, 0, 0, 13, 0, -1, -1)) throw new Error('transcode failed');
  f.close(); f.delete();
  return { w, h, rgba };
}

function resize(img, size) {
  if (img.w === size && img.h === size) return img;
  // box-filter / nearest resample to a square power of two
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx0 = Math.floor((x * img.w) / size), sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * img.w) / size));
    const sy0 = Math.floor((y * img.h) / size), sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * img.h) / size));
    const acc = [0, 0, 0, 0]; let n = 0;
    for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) { const o = (yy * img.w + xx) * 4; for (let c = 0; c < 4; c++) acc[c] += img.rgba[o + c]; n++; }
    for (let c = 0; c < 4; c++) out[(y * size + x) * 4 + c] = acc[c] / n;
  }
  return { w: size, h: size, rgba: out };
}

function writeJpg(file, w, h, rgba, quality = 86) {
  fs.writeFileSync(file, jpeg.encode({ width: w, height: h, data: Buffer.from(rgba) }, quality).data);
}

// ---------------------------------------------------------------- textures
async function textures() {
  const dir = path.join(OUT, 'textures');
  fs.mkdirSync(dir, { recursive: true });
  const SIZE = 512;
  for (const [id, src, name] of MATERIALS) {
    const base = src === 'ph' ? `${PAPY}/polyhaven-textures/textures/${name}/${name}_` : `${PAPY}/ambientcg-textures/textures/${name}/${name}_1K-PNG_`;
    const key = src === 'ph'
      ? { albedo: 'albedo', normal: 'normal', rough: 'roughness', ao: 'ao', metal: null }
      : { albedo: 'Color', normal: 'NormalGL', rough: 'Roughness', ao: null, metal: 'Metalness' };
    const load = async (k) => (k ? resize(await decodeKtx2(await fetchCached(`${base}${k}.ktx2`)), SIZE) : null);
    let albedo = null;
    try { albedo = await load(key.albedo); } catch { albedo = null; }
    const normal = await load(key.normal);
    const rough = await load(key.rough);
    let ao = null, metal = null;
    try { ao = await load(key.ao); } catch { ao = null; }
    try { metal = await load(key.metal); } catch { metal = null; }
    if (!albedo) {
      // no colour map (leather_red_03): a neutral albedo shaped by the occlusion; the game tints it per use
      albedo = { w: SIZE, h: SIZE, rgba: new Uint8Array(SIZE * SIZE * 4) };
      for (let i = 0; i < SIZE * SIZE; i++) { const a = ao ? ao.rgba[i * 4] : 255; const v = 90 + a * 0.45; albedo.rgba.set([v * 1.25, v * 0.55, v * 0.55, 255], i * 4); }
    }
    writeJpg(path.join(dir, `${id}_albedo.jpg`), SIZE, SIZE, albedo.rgba, 86);
    writeJpg(path.join(dir, `${id}_normal.jpg`), SIZE, SIZE, normal.rgba, 92);
    const arm = new Uint8Array(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) {
      arm[i * 4] = ao ? ao.rgba[i * 4] : 255;
      arm[i * 4 + 1] = rough.rgba[i * 4];
      arm[i * 4 + 2] = metal ? metal.rgba[i * 4] : 0;
      arm[i * 4 + 3] = 255;
    }
    writeJpg(path.join(dir, `${id}_arm.jpg`), SIZE, SIZE, arm, 90);
    console.log('texture', id, '<-', src, name);
  }
}

// ---------------------------------------------------------------- HDRIs
function parseRGBE(buf) {
  let p = 0;
  const line = () => { let s = ''; while (buf[p] !== 10) s += String.fromCharCode(buf[p++]); p++; return s; };
  let l; do { l = line(); } while (l !== '');
  const dims = line().split(' ');
  const h = +dims[1], w = +dims[3];
  const data = new Float32Array(w * h * 3);
  const scan = new Uint8Array(w * 4);
  for (let y = 0; y < h; y++) {
    if (buf[p] === 2 && buf[p + 1] === 2 && ((buf[p + 2] << 8) | buf[p + 3]) === w) {
      p += 4;
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < w) {
          let n = buf[p++];
          if (n > 128) { n -= 128; const v = buf[p++]; while (n--) scan[(x++) * 4 + c] = v; } else { while (n--) scan[(x++) * 4 + c] = buf[p++]; }
        }
      }
    } else {
      for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) scan[x * 4 + c] = buf[p++];
    }
    for (let x = 0; x < w; x++) {
      const e = scan[x * 4 + 3];
      const f = e ? Math.pow(2, e - 136) : 0;
      const o = (y * w + x) * 3;
      data[o] = scan[x * 4] * f; data[o + 1] = scan[x * 4 + 1] * f; data[o + 2] = scan[x * 4 + 2] * f;
    }
  }
  return { w, h, data };
}

function toRGBE(r, g, b, out, o) {
  const m = Math.max(r, g, b);
  if (m < 1e-32) { out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0; return; }
  const e = Math.ceil(Math.log2(m));
  const f = 256 / Math.pow(2, e);
  out[o] = Math.min(255, r * f); out[o + 1] = Math.min(255, g * f); out[o + 2] = Math.min(255, b * f); out[o + 3] = e + 128;
}

async function hdris() {
  const dir = path.join(OUT, 'hdri');
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, name] of HDRIS) {
    const src = parseRGBE(await fetchCached(`${THREE}/${name}.hdr`));
    // keep the 1k originals (1024 x 512) at native size: sharper reflections than the old 512 x 256 downsample
    const W = src.w, Hh = src.h;
    const png = new PNG({ width: W, height: Hh });
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      const sx0 = Math.floor((x * src.w) / W), sx1 = Math.floor(((x + 1) * src.w) / W);
      const sy0 = Math.floor((y * src.h) / Hh), sy1 = Math.floor(((y + 1) * src.h) / Hh);
      for (let yy = sy0; yy < sy1; yy++) for (let xx = sx0; xx < sx1; xx++) { const o = (yy * src.w + xx) * 3; r += src.data[o]; g += src.data[o + 1]; b += src.data[o + 2]; n++; }
      toRGBE(r / n, g / n, b / n, png.data, (y * W + x) * 4);
    }
    fs.writeFileSync(path.join(dir, `${id}.rgbe.png`), PNG.sync.write(png));
    console.log('hdri', id, '<-', name, `${src.w}x${src.h}`);
  }
}

// ---------------------------------------------------------------- mannequin (Quaternius UAL, skin only)
async function mannequin() {
  const dir = path.join(OUT, 'models');
  fs.mkdirSync(dir, { recursive: true });
  const g = JSON.parse((await fetchCached(`${UAL}/AnimationLibrary_Godot_Standard.gltf`)).toString());
  const bin = await fetchCached(`${UAL}/AnimationLibrary_Godot_Standard.bin`);
  const acc = (i) => {
    const a = g.accessors[i], v = g.bufferViews[a.bufferView];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
    const T = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[a.componentType];
    const stride = v.byteStride || comps * T.BYTES_PER_ELEMENT;
    const out = new T(a.count * comps);
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const get = { 5126: (o) => dv.getFloat32(o, true), 5123: (o) => dv.getUint16(o, true), 5125: (o) => dv.getUint32(o, true), 5121: (o) => dv.getUint8(o) }[a.componentType];
    for (let k = 0; k < a.count; k++) {
      const o = (v.byteOffset || 0) + (a.byteOffset || 0) + k * stride;
      for (let c = 0; c < comps; c++) out[k * comps + c] = get(o + c * T.BYTES_PER_ELEMENT);
    }
    return out;
  };
  const skin = g.skins[0];
  const parts = [];
  const chunks = [];
  let off = 0;
  const put = (arr) => { const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); const o = off; chunks.push(b); off += b.length; while (off % 4) { chunks.push(Buffer.alloc(1)); off++; } return o; };
  for (const p of g.meshes[0].primitives) {
    const pos = acc(p.attributes.POSITION), nrm = acc(p.attributes.NORMAL);
    const jnt = Uint8Array.from(acc(p.attributes.JOINTS_0)), wgt = acc(p.attributes.WEIGHTS_0);
    const idx = Uint16Array.from(acc(p.indices));
    parts.push({ material: g.materials[p.material].name, count: pos.length / 3, indices: idx.length, pos: put(pos), nrm: put(nrm), jnt: put(jnt), wgt: put(wgt), idx: put(idx) });
  }
  const ibm = acc(skin.inverseBindMatrices);
  const nodes = g.nodes.map((n) => ({ name: n.name, children: n.children || [], t: n.translation || [0, 0, 0], r: n.rotation || [0, 0, 0, 1], s: n.scale || [1, 1, 1] }));
  const meta = { source: 'Quaternius Universal Animation Library (Standard), CC0', parts, joints: skin.joints, ibm: put(ibm), nodes, skeleton: skin.skeleton ?? null, bytes: off };
  fs.writeFileSync(path.join(dir, 'mannequin.bin'), Buffer.concat(chunks));
  fs.writeFileSync(path.join(dir, 'mannequin.json'), JSON.stringify(meta));
  console.log('mannequin', parts.map((p) => `${p.material}:${p.count}v`).join(' '), `${(off / 1024) | 0} KB`);
}

// ---------------------------------------------------------------- audio
async function sounds() {
  const dir = path.join(OUT, 'audio');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(CACHE, 'tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const bank = {};
  for (const [id, list] of Object.entries(SOUNDS)) {
    bank[id] = [];
    for (let i = 0; i < list.length; i++) {
      const [src, name] = list[i];
      const url = src === 'o' ? `${OCULUS}/${name}.ogg` : `${SFXKIT}/${name}.wav`;
      const inFile = path.join(tmp, `${id}_${i}${src === 'o' ? '.ogg' : '.wav'}`);
      fs.writeFileSync(inFile, await fetchCached(url));
      const out = `${id}_${i}.mp3`;
      const loop = LOOPS.has(id);
      // one-shots: mono, trimmed of leading silence, loudness-normalised; loops: stereo, untouched timing
      const af = loop ? 'loudnorm=I=-20:TP=-2' : 'silenceremove=start_periods=1:start_threshold=-50dB,loudnorm=I=-16:TP=-1.5';
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', inFile, '-af', af, '-ac', loop ? '2' : '1', '-ar', '44100', '-b:a', loop ? '112k' : '80k', path.join(dir, out)]);
      bank[id].push(out);
    }
    console.log('audio', id, bank[id].length);
  }
  return bank;
}

// ---------------------------------------------------------------- main
const only = process.argv[2];
if (!only || only === 'textures') await textures();
if (!only || only === 'hdri') await hdris();
if (!only || only === 'models') await mannequin();
let bank = null;
if (!only || only === 'audio') bank = await sounds();
const manifestFile = path.join(OUT, 'manifest.json');
const prev = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile)) : {};
const manifest = {
  version: 1,
  materials: MATERIALS.map((m) => m[0]),
  hdri: HDRIS.map((h) => h[0]),
  model: 'models/mannequin',
  audio: bank || prev.audio || {},
  loops: [...LOOPS],
};
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
console.log('wrote', manifestFile);
