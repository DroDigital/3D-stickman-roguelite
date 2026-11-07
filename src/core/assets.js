// Runtime loader for the sourced assets in assets/ (see assets/CREDITS.md): PBR texture sets, HDR environments,
// the skinned mannequin and the sound banks. Everything degrades gracefully: if a file is missing or the browser
// can't decode it, the game keeps its procedural fallback for that piece.

const BASE = new URL('../../assets/', import.meta.url);

export const assets = {
  ready: false,
  manifest: null,
  textures: null, // { size, layers, albedo: [ImageData...], normal, arm, avg: Float32Array(layers*3) }
  hdri: {}, // id -> { w, h, data: Float32Array rgb, sh: Float32Array(27) }
  model: null, // { meta, bin: ArrayBuffer }
  audio: null, // id -> [ArrayBuffer]
  progress: 0,
  errors: [],
};

async function getJson(path) {
  const r = await fetch(new URL(path, BASE));
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
}

async function getBuf(path) {
  const r = await fetch(new URL(path, BASE));
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.arrayBuffer();
}

/** Decode an image file to RGBA pixels at `size`×`size` (or its own size). */
async function getPixels(path, size = 0) {
  const r = await fetch(new URL(path, BASE));
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  const blob = await r.blob();
  // colour-space conversion and premultiplication must stay off: normal/ARM/RGBE data is not colour
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const w = size || bmp.width, h = size || bmp.height;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const cx = cv.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  cx.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  return cx.getImageData(0, 0, w, h);
}

/** RGBE-in-PNG -> linear float RGB. */
export function decodeRGBE(px) {
  const n = px.width * px.height, d = px.data;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const e = d[i * 4 + 3];
    const f = e ? Math.pow(2, e - 136) : 0;
    out[i * 3] = d[i * 4] * f; out[i * 3 + 1] = d[i * 4 + 1] * f; out[i * 3 + 2] = d[i * 4 + 2] * f;
  }
  return out;
}

/** Order-2 spherical harmonics (9 RGB coefficients, already convolved for Lambert irradiance) of an equirect map. */
export function shFromEquirect(w, h, data) {
  const sh = new Float64Array(27);
  let wsum = 0;
  for (let y = 0; y < h; y++) {
    const th = ((y + 0.5) / h) * Math.PI;
    const st = Math.sin(th), ct = Math.cos(th);
    for (let x = 0; x < w; x++) {
      const ph = ((x + 0.5) / w) * 2 * Math.PI - Math.PI;
      // equirect convention used by the shaders: u = atan(d.x, -d.z)/2π + 0.5, v = acos(d.y)/π
      const dx = st * Math.sin(ph), dy = ct, dz = -st * Math.cos(ph);
      const wt = st;
      const b = [0.282095, 0.488603 * dy, 0.488603 * dz, 0.488603 * dx, 1.092548 * dx * dy, 1.092548 * dy * dz, 0.315392 * (3 * dz * dz - 1), 1.092548 * dx * dz, 0.546274 * (dx * dx - dy * dy)];
      const o = (y * w + x) * 3;
      for (let k = 0; k < 9; k++) {
        sh[k * 3] += data[o] * b[k] * wt; sh[k * 3 + 1] += data[o + 1] * b[k] * wt; sh[k * 3 + 2] += data[o + 2] * b[k] * wt;
      }
      wsum += wt;
    }
  }
  const norm = (4 * Math.PI) / wsum;
  const band = [Math.PI, 2.094395, 2.094395, 2.094395, 0.785398, 0.785398, 0.785398, 0.785398, 0.785398];
  const out = new Float32Array(27);
  for (let k = 0; k < 9; k++) for (let c = 0; c < 3; c++) out[k * 3 + c] = sh[k * 3 + c] * norm * band[k] / Math.PI;
  return out;
}

let loading = null;

/** Load everything (in parallel). `onProgress(0..1)`. Resolves even if some pieces fail. */
export function loadAssets(onProgress = () => {}, { textureSize = 512 } = {}) {
  if (loading) return loading;
  loading = (async () => {
    let manifest;
    try { manifest = await getJson('manifest.json'); } catch (e) { assets.errors.push(String(e)); assets.ready = true; return assets; }
    assets.manifest = manifest;
    const jobs = [];
    let done = 0;
    const track = (p) => p.then((v) => { done++; assets.progress = done / jobs.length; onProgress(assets.progress); return v; }, (e) => { done++; assets.errors.push(String(e)); assets.progress = done / jobs.length; onProgress(assets.progress); return null; });

    // textures: three maps per material layer
    const mats = manifest.materials || [];
    const tex = { size: textureSize, layers: mats.length, names: mats, albedo: [], normal: [], arm: [], avg: new Float32Array(mats.length * 3) };
    mats.forEach((id, i) => {
      for (const k of ['albedo', 'normal', 'arm']) {
        jobs.push(track(getPixels(`textures/${id}_${k}.jpg`, textureSize).then((px) => {
          tex[k][i] = px;
          if (k === 'albedo') {
            let r = 0, g = 0, b = 0;
            const d = px.data, n = d.length / 4;
            for (let j = 0; j < d.length; j += 16) { r += srgb(d[j]); g += srgb(d[j + 1]); b += srgb(d[j + 2]); }
            const m = n / 4;
            tex.avg[i * 3] = r / m; tex.avg[i * 3 + 1] = g / m; tex.avg[i * 3 + 2] = b / m;
          }
        })));
      }
    });
    for (const id of manifest.hdri || []) {
      jobs.push(track(getPixels(`hdri/${id}.rgbe.png`).then((px) => {
        const data = decodeRGBE(px);
        assets.hdri[id] = { w: px.width, h: px.height, data, sh: shFromEquirect(px.width, px.height, data) };
      })));
    }
    if (manifest.model) {
      jobs.push(track(Promise.all([getJson(`${manifest.model}.json`), getBuf(`${manifest.model}.bin`)]).then(([meta, bin]) => { assets.model = { meta, bin }; })));
    }
    const audio = {};
    for (const [id, files] of Object.entries(manifest.audio || {})) {
      audio[id] = [];
      files.forEach((f, i) => jobs.push(track(getBuf(`audio/${f}`).then((b) => { audio[id][i] = b; }))));
    }
    await Promise.all(jobs);
    for (const k of ['albedo', 'normal', 'arm']) if (tex[k].filter(Boolean).length !== mats.length) tex.incomplete = true;
    assets.textures = mats.length && !tex.incomplete ? tex : null;
    assets.audio = audio;
    assets.ready = true;
    return assets;
  })();
  return loading;
}

function srgb(v) { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
