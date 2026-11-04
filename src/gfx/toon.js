// Hand-drawn cel-shaded anime look: toon lighting with screentone, G-buffer ink outlines with line boil,
// flat-colour particles, banded sky and a paper/impact-frame composite. Selected via STYLES presets.
import { MAX_LIGHTS } from './shaders.js';

/**
 * Art-style presets. `retro` is the original look and stays the default; the others are previz candidates.
 * toon: use the cel pipeline; bands: 1 flat, 2 or 3 light bands; tone: 0 none, 1 halftone dots, 2 hatching;
 * ink: outline strength; inkW: outline width in low-res pixels; boil: hand-drawn line jitter (px);
 * boilFps: how often the drawn line "re-traces"; onTwos: held-pose animation rate (0 = every frame);
 * mono: manga desaturation (keeps reds); paper: paper grain; ortho: pseudo-3D orthographic camera.
 */
const INK = {
  toon: true, models: true, height: 540,
  bands: 2, tone: 0, ink: 1, inkW: 1, boil: 0.7, boilFps: 8, inkCol: [0.06, 0.03, 0.06], crease: 0.55,
  shade: [0.52, 0.42, 0.72], light: 1.05, rim: 0.9, spec: 1, fogBands: 4, sat: 1.18,
  paper: 0.55, mono: 0, bloom: 0.25, onTwos: 12, sky: 1, warm: [1.03, 1.0, 0.95], ortho: false,
};
const MANGA = {
  toon: true, models: true, height: 600,
  bands: 3, tone: 1, ink: 1, inkW: 1, boil: 0.9, boilFps: 8, inkCol: [0.04, 0.03, 0.03], crease: 0.8,
  shade: [0.62, 0.6, 0.62], light: 1.1, rim: 0.5, spec: 1, fogBands: 3, sat: 1,
  paper: 1, mono: 0.92, bloom: 0.0, onTwos: 12, sky: 2, warm: [1.0, 0.98, 0.92], ortho: false,
};
const STORYBOOK = {
  toon: true, models: true, height: 480,
  bands: 1, tone: 2, ink: 1, inkW: 2, boil: 1.2, boilFps: 6, inkCol: [0.12, 0.07, 0.05], crease: 0.3,
  shade: [0.68, 0.55, 0.62], light: 1.0, rim: 0.0, spec: 0, fogBands: 3, sat: 1.1,
  paper: 1, mono: 0, bloom: 0.15, onTwos: 8, sky: 1, warm: [1.07, 1.0, 0.86], ortho: true,
};
const NEON = {
  bands: 2, tone: 2, ink: 0.9, inkW: 1, boil: 0.35, boilFps: 12, inkCol: [0.1, 0.02, 0.16], crease: 0.4,
  shade: [0.35, 0.25, 0.7], light: 1.0, rim: 2.2, spec: 1, fogBands: 5, sat: 1.35, paper: 0.2, bloom: 1.1, warm: [1.0, 0.97, 1.05],
};

/**
 * Art packs: each bundles a render style, a cast of character designs (anatomy.js CASTS) and a sound set.
 * `retro` is the original look and stays the default. Ids with a "+" are mix-and-match combinations.
 * Render fields — bands: 1 flat, 2 or 3 light bands; tone: 0 none, 1 halftone, 2 hatching; ink: outline strength;
 * inkW: outline width (low-res px); boil: hand-drawn line jitter; onTwos: held-pose animation rate (0 = every frame);
 * mono: manga desaturation (keeps reds); paper: paper grain; ortho: pseudo-3D orthographic camera.
 */
export const STYLES = {
  retro: { id: 'retro', name: 'Current — Retro Low-Poly', toon: false, height: 432, cast: null, sfx: 'retro' },
  requiem: { ...INK, id: 'requiem', name: 'Pack 1 · Ink Requiem', cast: 'requiem', sfx: 'anime' },
  sutra: { ...MANGA, id: 'sutra', name: 'Pack 2 · Black Sutra', cast: 'sutra', sfx: 'taiko' },
  lantern: { ...STORYBOOK, id: 'lantern', name: 'Pack 3 · Paper Lantern', cast: 'lantern', sfx: 'folk' },
  // fitting combinations
  'requiem+neon': { ...INK, ...NEON, onTwos: 0, id: 'requiem+neon', name: 'Ink Requiem + Neon lighting', cast: 'requiem', sfx: 'anime' },
  'sutra+colour': { ...MANGA, mono: 0, sat: 1.1, id: 'sutra+colour', name: 'Black Sutra in colour', cast: 'sutra', sfx: 'taiko' },
  'requiem+diorama': { ...INK, ortho: true, inkW: 1.5, onTwos: 8, id: 'requiem+diorama', name: 'Ink Requiem on the Lantern diorama camera', cast: 'requiem', sfx: 'anime' },
  'lantern+perspective': { ...STORYBOOK, ortho: false, inkW: 1.5, id: 'lantern+perspective', name: 'Paper Lantern cast in true 3D', cast: 'lantern', sfx: 'folk' },
};
// earlier previz ids still resolve
STYLES.ink = STYLES.requiem;
STYLES.manga = STYLES.sutra;
STYLES.cutout = STYLES.lantern;
STYLES.neon = STYLES['requiem+neon'];

export const STYLE_IDS = ['retro', 'requiem', 'sutra', 'lantern', 'requiem+neon', 'sutra+colour', 'requiem+diorama', 'lantern+perspective'];

const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise2(vec2 x){ vec2 i = floor(x); vec2 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
`;

// Toon lit pass: writes colour to location 0 and a G-buffer (octahedral normal + 16-bit depth) to location 1.
export const TOON_LIT_FS = `#version 300 es
precision highp float;
in vec3 v_wpos;
in vec3 v_nrm;
in vec3 v_col;
in float v_emis;
uniform vec3 u_sunDir;
uniform vec3 u_sunCol;
uniform vec3 u_skyCol;
uniform vec3 u_gndCol;
uniform vec3 u_fogCol;
uniform vec3 u_rimCol;
uniform vec3 u_camPos;
uniform vec3 u_fog;
uniform vec4 u_lightPos[${MAX_LIGHTS}];
uniform vec4 u_lightCol[${MAX_LIGHTS}];
uniform int u_nLights;
uniform float u_time;
uniform float u_bands;
uniform float u_tone;
uniform vec3 u_shade;
uniform float u_light;
uniform float u_rim;
uniform float u_spec;
uniform float u_fogBands;
uniform float u_fogOffset;
uniform float u_toneScale;
uniform float u_ground;
layout(location=0) out vec4 o_col;
layout(location=1) out vec4 o_gbuf;
${NOISE}
vec2 octEncode(vec3 n){
  n /= (abs(n.x) + abs(n.y) + abs(n.z));
  vec2 e = n.y >= 0.0 ? n.xz : (1.0 - abs(n.zx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.z >= 0.0 ? 1.0 : -1.0);
  return e * 0.5 + 0.5;
}
float band(float x){
  if (u_bands < 1.5) return step(0.38, x);
  if (u_bands < 2.5) return step(0.5, x);
  return x < 0.36 ? 0.0 : (x < 0.68 ? 0.5 : 1.0);
}
void main(){
  vec3 n = normalize(v_nrm);
  vec3 base = v_col;
  vec3 V = normalize(u_camPos - v_wpos);
  // key light: half-lambert, quantised into hard cel bands
  float lit = dot(n, u_sunDir) * 0.5 + 0.5;
  // painted ground: flatten per-facet lighting so terrain triangles don't checkerboard between bands,
  // keeping only broad slope shading (steep cliffs still fall into shadow)
  if (u_ground > 0.5) lit = mix(0.7, lit, 0.25) - step(n.y, 0.55) * 0.3;
  float b = band(lit);
  // point lights add their own hard-edged pools
  vec3 pl = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= u_nLights) break;
    vec3 L = u_lightPos[i].xyz - v_wpos;
    float d = length(L);
    float att = clamp(1.0 - d / u_lightPos[i].w, 0.0, 1.0);
    float k = att * att * (max(dot(n, L / max(d, 1e-4)), 0.0) * 0.7 + 0.3) * u_lightCol[i].a;
    pl += u_lightCol[i].rgb * step(0.18, k) * min(k * 1.5, 1.0);
  }
  float plb = clamp(max(pl.r, max(pl.g, pl.b)), 0.0, 1.0);
  b = max(b, step(0.35, plb) * 0.5 * (u_bands > 2.5 ? 1.0 : 2.0));
  b = clamp(b, 0.0, 1.0);
  vec3 amb = mix(u_gndCol, u_skyCol, n.y * 0.5 + 0.5);
  vec3 shadowCol = base * u_shade * (0.55 + amb * 0.6);
  vec3 lightCol = base * u_light * (0.78 + u_sunCol * 0.45) + base * pl * 0.35;
  vec3 c = mix(shadowCol, lightCol, b);
  // screentone in the shadows: halftone dots or diagonal hatching locked to the screen
  float shadowAmt = 1.0 - b;
  if (u_tone > 0.5 && shadowAmt > 0.01) {
    vec2 fc = gl_FragCoord.xy / u_toneScale;
    float pat;
    if (u_tone < 1.5) {
      vec2 r = mat2(0.7071, -0.7071, 0.7071, 0.7071) * fc;
      vec2 cell = fract(r / 4.0) - 0.5;
      pat = step(length(cell), 0.18 + 0.2 * shadowAmt);
    } else {
      pat = step(0.62, fract((fc.x + fc.y) / 4.0));
      if (shadowAmt > 0.75) pat = max(pat, step(0.62, fract((fc.x - fc.y) / 4.0)));
    }
    c = mix(c, c * 0.45, pat * shadowAmt * 0.85);
  }
  // hard anime rim + specular glint
  float rim = step(0.72, 1.0 - clamp(dot(n, V), 0.0, 1.0)) * step(0.3, lit);
  c += u_rimCol * rim * 0.35 * u_rim;
  vec3 H = normalize(u_sunDir + V);
  c += vec3(1.0) * step(0.985, dot(n, H)) * 0.55 * u_spec;
  // emissive parts read as flat glowing paint
  c = mix(c, base * 1.25 + 0.15, clamp(v_emis, 0.0, 1.0));
  c += base * max(v_emis - 1.0, 0.0) * 0.6;
  // banded aerial perspective
  float dist = length(v_wpos - u_camPos) - u_fogOffset;
  float fog = smoothstep(u_fog.x, u_fog.y, dist);
  fog = floor(fog * u_fogBands + 0.5) / u_fogBands;
  o_col = vec4(mix(c, u_fogCol, fog), 1.0);
  float dep = clamp(dist / 220.0, 0.0, 0.9999);
  float hi = floor(dep * 255.0) / 255.0;
  o_gbuf = vec4(octEncode(n), hi, fract(dep * 255.0));
}`;

// Flat anime VFX: hard-edged shapes with an inked rim instead of soft gradients.
export const TOON_QUAD_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
in vec4 v_col;
in float v_shape;
in float v_dist;
uniform vec3 u_fog;
uniform int u_flat;
uniform float u_fogOffset;
uniform vec3 u_inkCol;
layout(location=0) out vec4 o_col;
void main(){
  vec2 uv = v_uv;
  float r = length(uv);
  int sh = int(v_shape + 0.5);
  float a = 0.0;
  float core = 0.0;
  if (sh == 0) { a = step(r, 0.62); core = step(r, 0.32); }
  else if (sh == 1) { a = step(0.78, r) * step(r, 0.95); }
  else if (sh == 2) { float d = abs(uv.x) + abs(uv.y) * 0.35; a = step(d, 0.55); core = step(d, 0.25); }
  else if (sh == 3) { a = step(max(abs(uv.x), abs(uv.y)), 0.7); }
  else if (sh == 4) { float s = min(abs(uv.x), abs(uv.y)); a = step(s, 0.12 * (1.0 - r)) * step(r, 1.0) + step(r, 0.25); core = step(r, 0.18); }
  else if (sh == 5) {
    float ang = atan(uv.y, uv.x);
    float puff = 0.62 + 0.12 * sin(ang * 5.0);
    a = step(r, puff); core = step(r, puff - 0.14);
  }
  else if (sh == 6) { a = step(r, 1.0) * (step(0.84, r) + 0.28); }
  else if (sh == 7) { float e = max(abs(uv.x), abs(uv.y)); a = step(e, 1.0) * (0.3 + 0.7 * step(0.82, abs(uv.x))); }
  else { a = step(r, 0.6); }
  a = clamp(a, 0.0, 1.0);
  if (a * v_col.a <= 0.02) discard;
  vec3 c = v_col.rgb;
  // bright core + inked rim for opaque shapes (smoke, blood, chunks)
  c = mix(c, mix(c, vec3(1.0), 0.65), core * step(0.5, v_col.a));
  if (u_flat == 0 && (sh == 5 || sh == 3) && core < 0.5) c = mix(c, u_inkCol, 0.55);
  float fog = smoothstep(u_fog.x, u_fog.y * 1.1, v_dist - u_fogOffset);
  float alpha = v_col.a > 0.5 ? a : a * step(0.12, v_col.a) * 0.9;
  o_col = vec4(c, alpha * (1.0 - fog));
}`;

// Painted anime sky: banded gradient, flat nebula shapes, cross-shaped stars and a hard-ringed eclipse.
export const TOON_SKY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec3 u_fwd;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec2 u_tan;
uniform vec3 u_top;
uniform vec3 u_horizon;
uniform vec3 u_neb;
uniform vec3 u_moonDir;
uniform vec3 u_moonCol;
uniform float u_time;
uniform float u_stars;
uniform float u_skyMode;
layout(location=0) out vec4 o_col;
layout(location=1) out vec4 o_gbuf;
${NOISE}
void main(){
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec3 dir = normalize(u_fwd + u_right * ndc.x * u_tan.x + u_up * ndc.y * u_tan.y);
  float h = smoothstep(-0.05, 0.6, dir.y);
  h = floor(h * 5.0) / 5.0;
  vec3 col = mix(u_horizon, u_top, h);
  // flat painted nebula / cloud shapes
  vec2 sp = vec2(atan(dir.x, dir.z) * 1.6, dir.y * 3.0) + vec2(u_time * 0.004, 0.0);
  float n = vnoise2(sp * 2.0) * 0.6 + vnoise2(sp * 5.0) * 0.4;
  float cloud = step(0.62, n) * smoothstep(-0.1, 0.3, dir.y);
  col = mix(col, mix(col, u_neb * 1.4 + 0.05, 0.75), cloud);
  col = mix(col, col * 0.7, step(0.66, n) * step(n, 0.69) * smoothstep(-0.1, 0.3, dir.y));
  // cross stars
  vec2 sg = sp * 18.0;
  vec2 cell = floor(sg);
  float s = hash12(cell);
  if (s > 1.0 - 0.03 * u_stars && dir.y > 0.02) {
    vec2 f = fract(sg) - 0.5;
    float tw = step(0.5, fract(u_time * (0.5 + s) + s * 9.0));
    float cr = step(min(abs(f.x), abs(f.y)), 0.05) * step(length(f), 0.28 + 0.12 * tw);
    col = mix(col, vec3(1.0, 0.97, 0.9), cr);
  }
  // eclipse with hard corona rings and a slit iris
  float md = dot(dir, normalize(u_moonDir));
  float ang = acos(clamp(md, -1.0, 1.0));
  float ring1 = step(ang, 0.16) * step(0.135, ang);
  float ring2 = step(ang, 0.23) * step(0.215, ang);
  col = mix(col, u_moonCol, ring1 * 0.9 + ring2 * 0.5);
  vec3 mz = normalize(u_moonDir);
  vec3 mx = normalize(cross(vec3(0,1,0), mz));
  vec3 my = cross(mz, mx);
  vec2 lp = vec2(dot(dir, mx), dot(dir, my)) / 0.12;
  float disk = step(ang, 0.12);
  float iris = step(length(lp * vec2(1.0, 0.55)), 0.62);
  float pupil = step(abs(lp.x), 0.12) * step(length(lp), 0.6);
  vec3 dc = mix(vec3(0.03, 0.0, 0.04), u_moonCol, iris);
  dc = mix(dc, vec3(0.0), pupil);
  col = mix(col, dc, disk);
  if (u_skyMode > 1.5) {
    // manga: sky becomes paper with speed-line clouds
    float l = dot(col, vec3(0.3, 0.59, 0.11));
    col = mix(vec3(0.94, 0.92, 0.86), vec3(0.15), step(0.75, 1.0 - l) * 0.0 + disk * (1.0 - iris) + pupil);
    col = mix(col, vec3(0.2), cloud * step(0.5, fract(sp.y * 14.0)) * 0.35);
    col = mix(col, u_moonCol, iris * disk * 0.85 + ring1 * 0.8);
  }
  o_col = vec4(col, 1.0);
  o_gbuf = vec4(0.5, 0.5, 0.9999, 0.0);
}`;

// Ink pass at the internal resolution: depth + normal discontinuities become brush lines that "boil".
export const INK_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_color;
uniform sampler2D u_gbuf;
uniform vec2 u_res;
uniform float u_time;
uniform float u_ink;
uniform float u_inkW;
uniform float u_boil;
uniform float u_boilFps;
uniform vec3 u_inkCol;
uniform float u_crease;
out vec4 o_col;
${NOISE}
vec3 nrm(vec2 e){ e = e * 2.0 - 1.0; vec3 n = vec3(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
  if (n.y < 0.0) n.xz = (1.0 - abs(n.zx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.z >= 0.0 ? 1.0 : -1.0); return normalize(n); }
float dep(vec4 g){ return g.b + g.a / 255.0; }
void main(){
  vec2 px = 1.0 / u_res;
  // line boil: the whole drawing re-traces a few times per second, like hand-inked cels
  float frame = floor(u_time * u_boilFps);
  vec2 cellUv = floor(v_uv * u_res / 5.0);
  vec2 jit = (vec2(hash12(cellUv + frame), hash12(cellUv + frame + 17.0)) - 0.5) * u_boil;
  // brush pressure: line width wobbles along the stroke
  float pressure = 0.75 + 0.5 * vnoise2(v_uv * u_res / 9.0 + frame * 3.1);
  vec2 uv = v_uv + jit * px;
  vec4 g0 = texture(u_gbuf, uv);
  float d0 = dep(g0);
  vec3 n0 = nrm(g0.rg);
  float w = u_inkW * pressure;
  float edge = 0.0, crease = 0.0;
  vec2 offs[4] = vec2[4](vec2(1,0), vec2(-1,0), vec2(0,1), vec2(0,-1));
  for (int i = 0; i < 4; i++) {
    vec4 g = texture(u_gbuf, uv + offs[i] * px * w);
    float d = dep(g);
    // silhouette: relative depth jump (scaled so distant lines thin out instead of filling in)
    float rel = abs(d - d0) / max(min(d, d0), 0.004);
    edge = max(edge, step(0.06 + d0 * 0.6, rel) * step(d0, 0.9) + step(d0, 0.9) * step(0.9, d) + step(d, 0.9) * step(0.9, d0));
    crease = max(crease, step(dot(n0, nrm(g.rg)), 0.62) * step(d0, 0.9));
  }
  vec3 c = texture(u_color, v_uv).rgb;
  // far lines fade into the atmosphere like loose background linework
  float fade = 1.0 - smoothstep(0.35, 0.8, d0);
  vec3 creaseCol = mix(c * 0.32, u_inkCol, 0.4);
  c = mix(c, creaseCol, clamp(crease * u_crease * fade * u_ink, 0.0, 1.0));
  c = mix(c, u_inkCol, clamp(edge, 0.0, 1.0) * u_ink * mix(0.35, 1.0, fade));
  o_col = vec4(c, 1.0);
}`;

// Composite: paper grain, manga mono, saturation, impact frames and speed lines.
export const TOON_POST_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform vec2 u_res;
uniform float u_time;
uniform float u_damage;
uniform float u_desat;
uniform float u_fade;
uniform float u_bloomAmt;
uniform vec3 u_tint;
uniform float u_paper;
uniform float u_mono;
uniform float u_sat;
uniform vec3 u_warm;
uniform float u_impact;
uniform float u_speed;
uniform vec3 u_inkCol;
out vec4 o_col;
${NOISE}
void main(){
  vec2 uv = v_uv;
  vec2 cc = uv - 0.5;
  vec3 c = texture(u_scene, uv).rgb;
  c += texture(u_bloom, uv).rgb * u_bloomAmt;
  c *= u_tint;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, u_sat);
  // manga: monochrome ink & paper, but blood and eldritch glows keep their colour
  float keep = smoothstep(0.25, 0.45, c.r - max(c.g, c.b)) + smoothstep(0.35, 0.6, max(c.g, c.b) - c.r) * 0.6;
  vec3 mono = mix(vec3(0.07, 0.06, 0.06), vec3(0.95, 0.93, 0.87), smoothstep(0.08, 0.6, l));
  c = mix(c, mix(mono, c, clamp(keep, 0.0, 1.0)), u_mono);
  c = mix(c, vec3(l), u_desat);
  c *= u_warm;
  // paper: fibres + tooth, multiplied like ink on a cel backing sheet
  vec2 pp = uv * u_res;
  float fib = vnoise2(pp * vec2(0.08, 0.9)) * 0.5 + vnoise2(pp * 0.35) * 0.5;
  float tooth = hash12(floor(pp * 1.5));
  c *= 1.0 - u_paper * (0.06 * fib + 0.035 * tooth);
  // gentle painted vignette
  c *= mix(0.72, 1.0, smoothstep(0.95, 0.3, length(cc * vec2(1.0, 0.85))));
  // speed lines during lunges
  if (u_speed > 0.01) {
    float ang = atan(cc.y, cc.x);
    float ln = step(0.86, hash12(vec2(floor(ang * 70.0), floor(u_time * 24.0))));
    float rr = length(cc);
    c = mix(c, vec3(1.0), ln * smoothstep(0.25, 0.7, rr) * u_speed * 0.8);
  }
  // impact frame: the screen snaps to two-tone ink for a couple of frames
  if (u_impact > 0.01) {
    float il = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 two = mix(u_inkCol, vec3(1.0, 0.96, 0.9), step(0.32, il));
    two = mix(two, vec3(0.9, 0.08, 0.12), step(0.25, c.r - max(c.g, c.b)) * step(0.32, il));
    float ang = atan(cc.y, cc.x);
    float burst = step(0.7, hash12(vec2(floor(ang * 40.0), 3.0))) * smoothstep(0.15, 0.6, length(cc));
    two = mix(two, vec3(1.0, 0.96, 0.9) - two * 0.0, burst * 0.6);
    c = mix(c, two, u_impact);
  }
  c = mix(c, vec3(0.75, 0.05, 0.08), u_damage * smoothstep(0.35, 0.75, length(cc)) * 0.7);
  c *= u_fade;
  o_col = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
