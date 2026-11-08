// Voxel (froxel) volumetric fog and horizon ambient occlusion for the cinematic frame.
//
// Fog: a view-aligned grid (GX x GY x GZ, slices spaced exponentially in view depth) is filled once per frame.
// Each froxel evaluates the realm's density, sun shadow, phase and point lights, then blends with the previous
// frame's grid at its reprojected position, so the result is stable without per-pixel jitter. A half-resolution
// pass then marches each pixel through the grid and accumulates in-scatter and transmittance.
//
// AO: a horizon-based estimate with cosine-weighted visibility (GTAO, Jimenez et al. 2016) at half resolution,
// with per-pixel and per-frame rotation, then a temporal filter that reprojects the previous accumulated value.
import { COMMON } from './cinematic.js';
import { MAX_LIGHTS } from './shaders.js';

const MAXL = MAX_LIGHTS;

/** Depth range of the fog grid, in metres of view depth. Beyond it the fog uses an analytic height tail. */
export const FROXEL_NEAR = 0.25;
export const FROXEL_FAR = 110;

/** View depth of slice coordinate u in [0, 1] (exponential spacing). */
export function sliceDepth(u, near = FROXEL_NEAR, far = FROXEL_FAR) {
  return near * Math.pow(far / near, u);
}

/** Slice coordinate in [0, 1] of view depth z (inverse of sliceDepth). */
export function sliceCoord(z, near = FROXEL_NEAR, far = FROXEL_FAR) {
  return Math.log(Math.max(z, near) / near) / Math.log(far / near);
}

/** Grid width from its height and the canvas aspect ratio (cells stay square on screen). */
export function gridWidth(gy, aspect) {
  return Math.max(8, Math.round(gy * aspect));
}

/** Per-frame jitter in [0, 1): decorrelates the grid samples over time. */
export function frameJitter(frame) {
  return (frame * 0.618034) % 1;
}

// Slice coordinate of a view depth, as GLSL. Needs the u_near and u_far uniforms in scope.
const SLICE_GLSL = `float sliceCoord(float z){ return log(max(z, u_near) / u_near) / log(u_far / u_near); }`;

// Shared fog density, the same as the former per-pixel march, so the realm looks carry over unchanged.
const FOG_DENSITY = `
uniform highp sampler2DShadow u_shadow;
uniform mat4 u_shadowVP;
uniform float u_shadowOn;
uniform vec3 u_keyDir;
uniform vec3 u_keyCol;
uniform vec3 u_fogCol;
uniform vec3 u_scatCol;
uniform float u_density;
uniform float u_heightFall;
uniform float u_baseH;
uniform float u_aniso;
uniform float u_time;
uniform vec2 u_wind;
uniform vec4 u_holes[8];
uniform int u_nHoles;
uniform vec4 u_lightPos[${MAXL}];
uniform vec4 u_lightCol[${MAXL}];
uniform int u_nLights;
uniform float u_flash;
// dense mist: pockets around the physical push sources (player, footsteps, blasts, enemies), and the meadow's ground layer
uniform vec4 u_dense[16];
uniform float u_denseY[16];
uniform int u_nDense;
uniform float u_denseK;
uniform highp sampler2D u_meadow;
uniform vec2 u_meadowC;
uniform float u_meadowH;
uniform float u_mistK;
// extinction from the pockets: thickest at the source and at ground level, fading out with distance and height
float denseAdd(vec3 p){
  float acc = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= u_nDense) break;
    vec4 s = u_dense[i];
    float R = s.z * 2.4 + 1.2;
    float dh = length(p.xz - s.xy);
    if (dh >= R) continue;
    float fh = 1.0 - smoothstep(0.25 * R, R, dh);
    float fv = exp(-max(p.y - u_denseY[i] - 0.2, 0.0) / 1.0);
    acc += s.w * fh * fv;
  }
  return acc * u_denseK;
}
// extinction from the meadow map: lies over the grass and settles into the terrain, with drifting patches
float meadowMist(vec3 p){
  if (u_meadowH <= 0.0) return 0.0;
  vec2 uv = (p.xz - u_meadowC) / (2.0 * u_meadowH) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  vec2 g = texture(u_meadow, uv).rg;
  float edge = smoothstep(0.0, 0.1, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  float rel = max(p.y - g.y - 0.1, 0.0);
  float mottle = 0.45 + 0.9 * vnoise3(vec3(p.xz * 0.12 + u_wind * u_time * 0.03, p.y * 0.25));
  return u_mistK * g.x * edge * mottle * exp(-rel / 0.8);
}
float fogDensity(vec3 p){
  float h = exp(-max(p.y - u_baseH, -4.0) * u_heightFall);
  vec3 q = p * 0.045 + vec3(u_wind.x, 0.0, u_wind.y) * u_time * 0.04;
  float n = vnoise3(q) * 0.65 + vnoise3(q * 2.7 + 7.0) * 0.35;
  // the mist is added before the holes, so the hero and fresh blasts still clear the view around them
  float d = u_density * h * (0.45 + 0.9 * n) + denseAdd(p) + meadowMist(p);
  for (int i = 0; i < 8; i++) {
    if (i >= u_nHoles) break;
    float k = length(p - u_holes[i].xyz) / u_holes[i].w;
    d *= mix(1.0, smoothstep(0.35, 1.0, k), 0.85);
  }
  return d;
}
float fogPhase(float c){ float g = u_aniso; return (1.0 - g*g) / (4.0 * PI * pow(1.0 + g*g - 2.0*g*c, 1.5)); }
float fogShadow(vec3 p){
  if (u_shadowOn < 0.5) return 1.0;
  vec4 s = u_shadowVP * vec4(p, 1.0); vec3 q = s.xyz / s.w * 0.5 + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
  return texture(u_shadow, vec3(q.xy, q.z - 0.002));
}
`;

/** Fills one slice (layer) of the grid. rgb = in-scatter x density, a = density. */
export const FROXEL_INJECT_FS = `#version 300 es
precision highp float;
out vec4 o_val;
uniform vec3 u_gridDims;
uniform float u_slice;
uniform float u_near;
uniform float u_far;
uniform mat4 u_invVP;
uniform vec3 u_camPos;
uniform vec3 u_camFwd;
uniform float u_jit;
uniform mat4 u_prevVP;
uniform vec3 u_prevCamPos;
uniform vec3 u_prevCamFwd;
uniform highp sampler3D u_hist;
uniform float u_histOn;
uniform float u_blend;
${COMMON}
${FOG_DENSITY}
${SLICE_GLSL}
void main(){
  vec2 ndc = (gl_FragCoord.xy / u_gridDims.xy) * 2.0 - 1.0;
  vec4 a = u_invVP * vec4(ndc, -1.0, 1.0);
  vec4 b = u_invVP * vec4(ndc, 1.0, 1.0);
  vec3 dir = normalize(b.xyz / b.w - a.xyz / a.w);
  // the slice's depth, jittered inside the slice so the average over frames is its centre
  float zt = (u_slice + u_jit) / u_gridDims.z;
  float viewZ = u_near * pow(u_far / u_near, zt);
  vec3 p = u_camPos + dir * (viewZ / dot(dir, u_camFwd));
  float den = fogDensity(p);
  vec3 keyC = u_keyCol * (1.0 + u_flash * 2.0);
  vec3 amb = u_fogCol * (1.0 + u_flash * 1.2);
  vec3 inS = amb + keyC * u_scatCol * fogPhase(dot(dir, u_keyDir)) * 1.3 * fogShadow(p);
  for (int j = 0; j < ${MAXL}; j++) {
    if (j >= u_nLights) break;
    vec3 lv = u_lightPos[j].xyz - p;
    float ld2 = dot(lv, lv);
    float r2 = u_lightPos[j].w * u_lightPos[j].w;
    if (ld2 > r2) continue;
    inS += u_lightCol[j].rgb * min(u_lightCol[j].a, 3.0) * (1.0 - ld2 / r2) / (ld2 * 0.6 + 1.0) * 0.25;
  }
  vec4 cur = vec4(inS * den, den);
  if (u_histOn > 0.5) {
    vec4 pc = u_prevVP * vec4(p, 1.0);
    float pz = dot(p - u_prevCamPos, u_prevCamFwd);
    vec3 uvw = vec3(pc.xy / pc.w * 0.5 + 0.5, sliceCoord(pz));
    if (pc.w > 0.0 && all(greaterThanEqual(uvw, vec3(0.0))) && all(lessThanEqual(uvw, vec3(1.0)))) {
      cur = mix(texture(u_hist, uvw), cur, u_blend);
    }
  }
  o_val = cur;
}`;

/** Marches each pixel through the grid up to its scene depth, then adds the analytic tail beyond the grid. */
export const FROXEL_MARCH_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_fog;
uniform highp sampler2D u_depth;
uniform highp sampler3D u_grid;
uniform mat4 u_invVP;
uniform vec3 u_camPos;
uniform vec3 u_camFwd;
uniform float u_near;
uniform float u_far;
uniform float u_jit;
uniform int u_steps;
uniform vec3 u_keyDir;
uniform vec3 u_keyCol;
uniform vec3 u_fogCol;
uniform vec3 u_scatCol;
uniform float u_density;
uniform float u_heightFall;
uniform float u_baseH;
uniform float u_aniso;
uniform float u_flash;
${COMMON}
${SLICE_GLSL}
vec3 worldAt(vec2 uv, float d){ vec4 p = u_invVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
float fogPhase(float c){ float g = u_aniso; return (1.0 - g*g) / (4.0 * PI * pow(1.0 + g*g - 2.0*g*c, 1.5)); }
void main(){
  vec2 uv = v_uv;
  float d = texture(u_depth, uv).r;
  float sky = step(0.99999, d);
  vec3 wp = worldAt(uv, sky > 0.5 ? 0.9999 : d);
  vec3 rd = wp - u_camPos;
  float dist = length(rd);
  rd /= dist;
  float cosV = max(dot(rd, u_camFwd), 1e-3);
  float zSurf = sky > 0.5 ? 1e4 : dist * cosV;
  float zCap = clamp(zSurf, u_near, u_far);
  float wMax = sliceCoord(zCap);
  float lnR = log(u_far / u_near);
  float T = 1.0;
  vec3 L = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= u_steps) break;
    float w0 = wMax * float(i) / float(u_steps);
    float w1 = wMax * float(i + 1) / float(u_steps);
    float t0 = u_near * exp(w0 * lnR) / cosV;
    float t1 = u_near * exp(w1 * lnR) / cosV;
    float dt = t1 - t0;
    vec4 g = texture(u_grid, vec3(uv, mix(w0, w1, fract(u_jit + ign(gl_FragCoord.xy)))));
    L += T * g.rgb * dt;
    T *= exp(-g.a * dt);
    if (T < 0.01) break;
  }
  // analytic height-fog tail beyond the grid (the former march did the same past its distance)
  float tEnd = u_far / cosV;
  float tSurf = sky > 0.5 ? 600.0 : dist;
  if (tSurf > tEnd && T > 0.01) {
    float rest = tSurf - tEnd;
    vec3 p0 = u_camPos + rd * tEnd;
    float k = u_heightFall;
    float hd = rd.y * k;
    float f0 = exp(-max(p0.y - u_baseH, -4.0) * k);
    float od = u_density * 0.75 * f0 * (abs(hd) > 1e-4 ? (1.0 - exp(-hd * rest)) / hd : rest);
    float tr = exp(-od);
    vec3 keyC = u_keyCol * (1.0 + u_flash * 2.0);
    vec3 amb = u_fogCol * (1.0 + u_flash * 1.2);
    L += T * (amb + keyC * u_scatCol * fogPhase(dot(rd, u_keyDir)) * 0.6) * (1.0 - tr);
    T *= tr;
  }
  o_fog = vec4(L, T);
}`;

const DEPTH_HELPERS = `
float linDepth(float d){ float z = d * 2.0 - 1.0; return 2.0 * u_nearFar.x * u_nearFar.y / (u_nearFar.y + u_nearFar.x - z * (u_nearFar.y - u_nearFar.x)); }
vec3 worldAt(vec2 uv, float d){ vec4 p = u_invVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
vec3 viewAt(vec2 uv, float d){ vec3 w = worldAt(uv, d) - u_camPos; return vec3(dot(w, u_camRight), dot(w, u_camUp), dot(w, u_camFwd)); }
`;

/** Raw horizon AO: r = visibility, g = view depth. Half resolution. */
export const GTAO_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_ao;
uniform highp sampler2D u_depth;
uniform mat4 u_invVP;
uniform vec3 u_camPos;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camFwd;
uniform vec2 u_nearFar;
uniform vec2 u_full;
uniform vec2 u_res;
uniform float u_focalPx;
uniform float u_radius;
uniform int u_slices;
uniform int u_steps;
uniform float u_frame;
${COMMON}
${DEPTH_HELPERS}
void main(){
  vec2 uv = v_uv;
  float d0 = texture(u_depth, uv).r;
  if (d0 > 0.99999) { o_ao = vec4(1.0, u_nearFar.y, 0.0, 1.0); return; }
  vec3 P = viewAt(uv, d0);
  float lin = P.z;
  vec3 V = normalize(-P);
  // normal from the depth buffer, taking the neighbour with the smaller depth step on each axis
  vec2 px = 2.0 / u_full;
  vec3 PL = viewAt(uv - vec2(px.x, 0.0), texture(u_depth, uv - vec2(px.x, 0.0)).r);
  vec3 PR = viewAt(uv + vec2(px.x, 0.0), texture(u_depth, uv + vec2(px.x, 0.0)).r);
  vec3 PD = viewAt(uv - vec2(0.0, px.y), texture(u_depth, uv - vec2(0.0, px.y)).r);
  vec3 PU = viewAt(uv + vec2(0.0, px.y), texture(u_depth, uv + vec2(0.0, px.y)).r);
  vec3 ddx = abs(PR.z - lin) < abs(PL.z - lin) ? PR - P : P - PL;
  vec3 ddy = abs(PU.z - lin) < abs(PD.z - lin) ? PU - P : P - PD;
  vec3 N = normalize(cross(ddy, ddx));
  if (dot(N, V) < 0.0) N = -N;

  float rot = ign(gl_FragCoord.xy + vec2(u_frame * 37.0, u_frame * 11.0));
  float stepJ = ign(gl_FragCoord.yx * 1.37 + vec2(u_frame * 5.0));
  float rpx = u_radius * u_focalPx / max(lin, 0.05);
  // falloff so that occluders near the radius fade out instead of popping
  float falloffRange = 0.615 * u_radius;
  float falloffFrom = u_radius * (1.0 - 0.615);
  float falloffMul = -1.0 / falloffRange;
  float falloffAdd = falloffFrom / falloffRange + 1.0;
  float vis = 0.0;
  for (int s = 0; s < 6; s++) {
    if (s >= u_slices) break;
    float phi = (float(s) + rot) * PI / float(u_slices);
    vec2 dirP = vec2(cos(phi), sin(phi));
    vec3 dirV = vec3(dirP, 0.0);
    vec3 ortho = dirV - dot(dirV, V) * V;
    vec3 axis = normalize(cross(ortho, V));
    vec3 projN = N - axis * dot(N, axis);
    float lenN = length(projN);
    if (lenN < 1e-4) continue;
    float sgn = sign(dot(ortho, projN));
    float cosN = clamp(dot(projN, V) / lenN, 0.0, 1.0);
    float n = sgn * acos(cosN);
    float lowC0 = cos(n + PI * 0.5);
    float lowC1 = cos(n - PI * 0.5);
    float hc0 = lowC0, hc1 = lowC1;
    for (int j = 0; j < 6; j++) {
      if (j >= u_steps) break;
      float fj = (float(j) + stepJ) / float(u_steps);
      float off = max(1.0, rpx * fj * fj);
      vec2 o = dirP * off / u_res;
      vec2 uvp = uv + o;
      float dp = texture(u_depth, uvp).r;
      if (dp < 0.99999) {
        vec3 dl = viewAt(uvp, dp) - P;
        float dist = length(dl);
        float shc = dot(dl / max(dist, 1e-4), V);
        shc = mix(lowC0, shc, clamp(dist * falloffMul + falloffAdd, 0.0, 1.0));
        hc0 = max(hc0, shc);
      }
      vec2 uvm = uv - o;
      float dm = texture(u_depth, uvm).r;
      if (dm < 0.99999) {
        vec3 dl = viewAt(uvm, dm) - P;
        float dist = length(dl);
        float shc = dot(dl / max(dist, 1e-4), V);
        shc = mix(lowC1, shc, clamp(dist * falloffMul + falloffAdd, 0.0, 1.0));
        hc1 = max(hc1, shc);
      }
    }
    float h0 = -acos(clamp(hc1, -1.0, 1.0));
    float h1 = acos(clamp(hc0, -1.0, 1.0));
    h0 = n + clamp(h0 - n, -PI * 0.5, PI * 0.5);
    h1 = n + clamp(h1 - n, -PI * 0.5, PI * 0.5);
    float iarc0 = (cosN + 2.0 * h0 * sin(n) - cos(2.0 * h0 - n)) * 0.25;
    float iarc1 = (cosN + 2.0 * h1 * sin(n) - cos(2.0 * h1 - n)) * 0.25;
    vis += lenN * (iarc0 + iarc1);
  }
  float ao = u_slices > 0 ? clamp(vis / float(u_slices), 0.0, 1.0) : 1.0;
  o_ao = vec4(ao, lin, 0.0, 1.0);
}`;

/** Temporal filter for the raw AO: reprojects the previous accumulated value and rejects it on depth change. */
export const AO_TEMPORAL_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_ao;
uniform highp sampler2D u_raw;
uniform highp sampler2D u_hist;
uniform highp sampler2D u_depth;
uniform mat4 u_invVP;
uniform mat4 u_prevVP;
uniform vec3 u_prevCamPos;
uniform vec3 u_prevCamFwd;
uniform float u_histOn;
uniform float u_blend;
${COMMON}
vec3 worldAt(vec2 uv, float d){ vec4 p = u_invVP * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
void main(){
  vec4 cur = texture(u_raw, v_uv);
  float d = texture(u_depth, v_uv).r;
  if (u_histOn < 0.5 || d > 0.99999) { o_ao = cur; return; }
  vec3 wp = worldAt(v_uv, d);
  vec4 pc = u_prevVP * vec4(wp, 1.0);
  if (pc.w <= 0.0) { o_ao = cur; return; }
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0)))) { o_ao = cur; return; }
  vec4 h = texture(u_hist, puv);
  float prevZ = dot(wp - u_prevCamPos, u_prevCamFwd);
  if (abs(h.g - prevZ) > 0.05 * max(prevZ, 1e-3)) { o_ao = cur; return; }
  o_ao = vec4(mix(h.r, cur.r, u_blend), cur.g, 0.0, 1.0);
}`;
