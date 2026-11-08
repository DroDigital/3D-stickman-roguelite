// "Abyssal Cinematic" pipeline shaders: linear HDR, GGX physically based shading with image-based lighting from a
// real HDRI (spherical-harmonic diffuse + prefiltered specular), soft directional shadows, triplanar PBR texture
// arrays (Poly Haven / ambientCG), wet and ash-dusted surfaces, translucent foliage, soft particles, the composite
// and screen passes (fog apply, bloom, depth of field, ACES tonemapping with per-realm grading, lens effects, FXAA).
// The voxel fog and horizon AO shaders live in volumetric.js.
import { MAX_LIGHTS } from './shaders.js';

const MAXL = MAX_LIGHTS;

// ------------------------------------------------------------------ shared GLSL
export const COMMON = `
const float PI = 3.14159265;
vec3 toLinear(vec3 c){ return pow(max(c, vec3(0.0)), vec3(2.2)); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash13(i), hash13(i+vec3(1,0,0)), f.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), f.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float vnoise2(vec2 x){ vec2 i = floor(x); vec2 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm2(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
`;

const LIGHT_UNIFORMS = `
uniform vec3 u_camPos;
uniform vec3 u_keyDir;
uniform vec3 u_keyCol;
uniform vec3 u_sh[9];
uniform float u_envInt;
uniform float u_envSpec;
uniform vec3 u_envTint;
uniform sampler2D u_env;
uniform float u_envMips;
uniform highp sampler2DShadow u_shadow;
uniform mat4 u_shadowVP;
uniform float u_shadowTexel;
uniform float u_shadowOn;
uniform vec4 u_lightPos[${MAXL}];
uniform vec4 u_lightCol[${MAXL}];
uniform int u_nLights;
uniform float u_time;
uniform float u_flash;
uniform float u_wet;
uniform float u_dust;
uniform vec3 u_dustCol;
uniform vec3 u_rimCol;
// screen-space history from the previous frame: horizon AO (r) with view depth (g), the depth buffer itself,
// and the matrix and camera planes that reproject into it
uniform highp sampler2D u_sao;
uniform highp sampler2D u_depthPrev;
uniform mat4 u_prevVP;
uniform vec2 u_nearFar;
uniform float u_histOn;
uniform float u_saoAmt;
uniform float u_contactOn;
uniform float u_microOn;
`;

const PBR = `
vec3 shIrr(vec3 n){
  return max(vec3(0.0), u_sh[0] + u_sh[1]*n.y + u_sh[2]*n.z + u_sh[3]*n.x + u_sh[4]*n.x*n.y + u_sh[5]*n.y*n.z
    + u_sh[6]*(3.0*n.z*n.z - 1.0) + u_sh[7]*n.x*n.z + u_sh[8]*(n.x*n.x - n.y*n.y));
}
vec2 equiUV(vec3 d){ return vec2(atan(d.x, -d.z) * (0.5 / PI) + 0.5, acos(clamp(d.y, -1.0, 1.0)) / PI); }
vec3 envSpec(vec3 r, float rough){ return textureLod(u_env, equiUV(r), rough * u_envMips).rgb; }
float D_GGX(float nh, float a){ float a2 = a*a; float d = nh*nh*(a2-1.0)+1.0; return a2 / (PI*d*d + 1e-6); }
float V_SG(float nv, float nl, float a){ float k = a*0.5; return 0.25 / ((nv*(1.0-k)+k) * (nl*(1.0-k)+k) + 1e-5); }
vec3 F_Schlick(vec3 f0, float vh){ return f0 + (1.0 - f0) * pow(1.0 - vh, 5.0); }
vec2 envBRDF(float nv, float rough){
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022); const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = rough * c0 + c1; float a004 = min(r.x*r.x, exp2(-9.28*nv)) * r.x + r.y;
  return vec2(-1.04, 1.04) * a004 + r.zw;
}
const vec2 POISSON[12] = vec2[12](vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621), vec2(0.962,-0.195), vec2(0.473,-0.480),
  vec2(0.519,0.767), vec2(0.185,-0.893), vec2(0.507,0.064), vec2(0.896,0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));
float shadowAt(vec3 wpos, vec3 n, float ndl){
  if (u_shadowOn < 0.5) return 1.0;
  vec3 p = wpos + n * (0.06 + 0.12 * (1.0 - ndl));
  vec4 s = u_shadowVP * vec4(p, 1.0);
  vec3 q = s.xyz / s.w * 0.5 + 0.5;
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) return 1.0;
  float a = ign(gl_FragCoord.xy) * 6.2831;
  mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
  float sum = 0.0;
  float r = u_shadowTexel * 2.2;
  for (int i = 0; i < 12; i++) sum += texture(u_shadow, vec3(q.xy + rot * POISSON[i] * r, q.z - 0.0022));
  float sh = sum / 12.0;
  // fade out toward the edge of the shadow cascade
  vec2 e = abs(q.xy - 0.5) * 2.0;
  return mix(sh, 1.0, smoothstep(0.82, 1.0, max(e.x, e.y)));
}
float linZ(float d){ float z = d * 2.0 - 1.0; return 2.0 * u_nearFar.x * u_nearFar.y / (u_nearFar.y + u_nearFar.x - z * (u_nearFar.y - u_nearFar.x)); }
// horizon AO of the previous frame, reprojected to this surface. It only dims the indirect light, so sunlit surfaces keep
// their colour and the occlusion sits in the crevices where the sky cannot reach.
float saoIndirect(vec3 P){
  if (u_histOn < 0.5 || u_saoAmt <= 0.0) return 1.0;
  vec4 c = u_prevVP * vec4(P, 1.0);
  if (c.w <= 0.0) return 1.0;
  vec2 uv = c.xy / c.w * 0.5 + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
  return mix(1.0, texture(u_sao, uv).r, u_saoAmt);
}
// contact shadow: a short screen-space march from the surface toward the sun against the previous depth buffer.
// It catches the small shadows where a foot, a prop or a blade meets the ground, which the shadow map is too coarse for.
float contactShadow(vec3 P, vec3 L){
  if (u_contactOn < 0.5 || u_histOn < 0.5) return 1.0;
  float occ = 0.0;
  for (int i = 0; i < 8; i++) {
    float t = 0.08 + float(i) * 0.06;
    vec4 c = u_prevVP * vec4(P + L * t, 1.0);
    if (c.w <= 0.0) break;
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) break;
    // how far behind the visible surface this sample lies, in metres
    float behind = c.w - linZ(texture(u_depthPrev, uv).r);
    occ += smoothstep(0.03, 0.1, behind) * (1.0 - smoothstep(0.4, 0.7, behind));
  }
  return 1.0 - 0.75 * clamp(occ / 3.0, 0.0, 1.0);
}
// full lighting for one surface point
vec3 shade(vec3 P, vec3 N, vec3 V, vec3 albedo, float rough, float metal, float ao, float trans, out float keyShadow){
  rough = clamp(rough, 0.045, 1.0);
  float a = rough * rough;
  vec3 f0 = mix(vec3(0.04), albedo, metal);
  vec3 diff = albedo * (1.0 - metal);
  float nv = max(dot(N, V), 1e-4);
  vec3 L = u_keyDir;
  float nl = dot(N, L);
  float sh = shadowAt(P, N, max(nl, 0.0));
  keyShadow = sh;
  vec3 col = vec3(0.0);
  vec3 kc = u_keyCol * (1.0 + u_flash * 2.5);
  if (nl > 0.0) {
    vec3 H = normalize(L + V);
    float nh = max(dot(N, H), 0.0), vh = max(dot(V, H), 0.0);
    vec3 F = F_Schlick(f0, vh);
    vec3 spec = D_GGX(nh, a) * V_SG(nv, nl, a) * F;
    col += (diff * (1.0 - F) / PI + spec) * kc * nl * sh * contactShadow(P, L);
  }
  // thin translucency (leaves, cloth, membranes): light bleeding through from behind
  if (trans > 0.0) col += diff * kc * trans * pow(clamp(dot(V, -L), 0.0, 1.0), 3.0) * (0.35 + 0.65 * sh) * 0.6;
  for (int i = 0; i < ${MAXL}; i++) {
    if (i >= u_nLights) break;
    vec3 Lv = u_lightPos[i].xyz - P;
    float d = length(Lv);
    float rad = u_lightPos[i].w;
    float att = clamp(1.0 - pow(d / rad, 4.0), 0.0, 1.0); att = att * att / (d * d * 0.35 + 1.0);
    if (att <= 0.0) continue;
    vec3 Ld = Lv / max(d, 1e-4);
    float pnl = dot(N, Ld);
    vec3 lc = u_lightCol[i].rgb * min(u_lightCol[i].a, 3.0) * att * 1.3;
    if (pnl > 0.0) {
      vec3 H = normalize(Ld + V);
      float nh = max(dot(N, H), 0.0), vh = max(dot(V, H), 0.0);
      vec3 F = F_Schlick(f0, vh);
      col += (diff * (1.0 - F) / PI + D_GGX(nh, a) * V_SG(nv, pnl, a) * F) * lc * pnl;
    }
    if (trans > 0.0) col += diff * lc * trans * 0.25 * max(-pnl, 0.0);
  }
  // image-based ambient: SH irradiance + prefiltered specular, darkened in occluded crevices
  vec3 irr = shIrr(N) * u_envTint * u_envInt * (1.0 + u_flash * 1.5);
  vec2 ab = envBRDF(nv, rough);
  vec3 R = reflect(-V, N);
  vec3 pref = envSpec(R, rough) * u_envTint * u_envInt * u_envSpec * (1.0 + u_flash * 1.5);
  float horizon = clamp(1.0 + dot(R, N), 0.0, 1.0);
  float specOcc = clamp(pow(nv + ao, exp2(-16.0 * a - 1.0)) - 1.0 + ao, 0.0, 1.0);
  // energy lost by the single-scatter split-sum BRDF on rough surfaces comes back as multi-scatter (Fdez-Agüera 2019)
  vec3 msc = 1.0 + f0 * (1.0 / max(ab.x + ab.y, 0.1) - 1.0);
  col += (diff * irr * ao + pref * (f0 * ab.x + ab.y) * msc * specOcc * horizon * horizon * mix(0.55, 1.0, sh)) * saoIndirect(P);
  // rim light: backlit silhouettes catch the realm's glow so bodies and edges read in the dark
  // (only where the surface faces away from the key light, so lit surfaces keep their colour)
  float backlit = clamp(dot(N, -u_keyDir) * 0.5 + 0.5, 0.0, 1.0);
  // the glow is a bounce from the realm's light, so it scales with the surface's own albedo
  col += (albedo * 0.8 + 0.04) * u_rimCol * pow(1.0 - nv, 5.0) * backlit * (1.0 - metal) * 0.9;
  return col;
}
`;

const TRIPLANAR = `
uniform mediump sampler2DArray u_albedo;
uniform mediump sampler2DArray u_normal;
uniform mediump sampler2DArray u_arm;
uniform vec3 u_matAvg[24];
uniform float u_texOn;
struct Surf { vec3 albedo; vec3 n; float rough; float metal; float ao; };
// procedural micro relief at two finer scales, for the close-up detail the 512 px texture sets cannot carry
float microH(vec3 q){ return vnoise3(q * 9.0) * 0.65 + vnoise3(q * 27.0) * 0.35; }
vec3 microGrad(vec3 q){
  const float e = 0.035;
  float h = microH(q);
  return vec3(microH(q + vec3(e, 0.0, 0.0)) - h, microH(q + vec3(0.0, e, 0.0)) - h, microH(q + vec3(0.0, 0.0, e)) - h) / e;
}
// triplanar sample of one material layer at p (world or object units) with geometric normal n.
// Normals use Ben Golus' whiteout blend.
Surf triSample(float layer, vec3 p, vec3 n, float scale){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  vec2 ux = p.zy * scale, uy = p.xz * scale, uz = p.xy * scale;
  Surf s;
  vec3 a = vec3(0.0), m = vec3(0.0);
  vec3 tx = vec3(0.0), ty = vec3(0.0), tz = vec3(0.0);
  if (w.x > 0.01) { a += texture(u_albedo, vec3(ux, layer)).rgb * w.x; m += texture(u_arm, vec3(ux, layer)).rgb * w.x; tx = texture(u_normal, vec3(ux, layer)).xyz * 2.0 - 1.0; }
  if (w.y > 0.01) { a += texture(u_albedo, vec3(uy, layer)).rgb * w.y; m += texture(u_arm, vec3(uy, layer)).rgb * w.y; ty = texture(u_normal, vec3(uy, layer)).xyz * 2.0 - 1.0; }
  if (w.z > 0.01) { a += texture(u_albedo, vec3(uz, layer)).rgb * w.z; m += texture(u_arm, vec3(uz, layer)).rgb * w.z; tz = texture(u_normal, vec3(uz, layer)).xyz * 2.0 - 1.0; }
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  s.n = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
  // the detail fades out as its texels shrink below a pixel, so it never shimmers at a distance
  float footprint = length(fwidth(p));
  float fade = u_microOn * clamp(1.0 - footprint * 14.0, 0.0, 1.0);
  if (fade > 0.0) { vec3 g = microGrad(p); s.n = normalize(s.n - (g - dot(g, s.n) * s.n) * 0.04 * fade); }
  s.albedo = a; // the albedo array is sRGB, so the sampler already returns linear colour
  s.ao = m.r; s.rough = m.g; s.metal = m.b;
  return s;
}
`;

// ------------------------------------------------------------------ geometry
// Instanced primitive batches (and the terrain, drawn with constant instance attributes).
export const CINE_LIT_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 a_col;
layout(location=3) in vec4 a_m0;
layout(location=4) in vec4 a_m1;
layout(location=5) in vec4 a_m2;
layout(location=6) in vec4 a_m3;
layout(location=7) in vec4 a_icol;
layout(location=8) in vec4 a_imat;
uniform mat4 u_vp;
out vec3 v_wpos;
out vec3 v_nrm;
out vec3 v_col;
out float v_emis;
out vec3 v_lpos;
out vec3 v_lnrm;
flat out vec4 v_mat;
out vec3 v_ax0;
out vec3 v_ax1;
out vec3 v_ax2;
void main(){
  mat4 m = mat4(a_m0, a_m1, a_m2, a_m3);
  vec4 wp = m * vec4(a_pos, 1.0);
  vec3 s = vec3(length(a_m0.xyz), length(a_m1.xyz), length(a_m2.xyz));
  v_nrm = mat3(m) * (a_nrm / max(s * s, vec3(1e-8)));
  v_wpos = wp.xyz;
  v_col = a_col * a_icol.rgb;
  v_emis = a_icol.a;
  v_mat = a_imat;
  // object-space position in metres (so textures don't swim on moving or scaled props) and the axes to rotate
  // object-space normals back to world space
  v_lpos = a_pos * s;
  v_lnrm = a_nrm;
  // inverse-transpose columns (axis / scale^2) so stretched cones and octahedra keep correct normals
  v_ax0 = a_m0.xyz / max(s.x * s.x, 1e-8); v_ax1 = a_m1.xyz / max(s.y * s.y, 1e-8); v_ax2 = a_m2.xyz / max(s.z * s.z, 1e-8);
  gl_Position = u_vp * wp;
}`;

export const CINE_LIT_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec3 v_wpos;
in vec3 v_nrm;
in vec3 v_col;
in float v_emis;
in vec3 v_lpos;
in vec3 v_lnrm;
flat in vec4 v_mat;
in vec3 v_ax0;
in vec3 v_ax1;
in vec3 v_ax2;
${LIGHT_UNIFORMS}
uniform float u_terrain;
uniform vec2 u_terrainMat;
uniform vec3 u_accent;
uniform float u_veinGlow;
uniform float u_tintMix;
out vec4 o_col;
${COMMON}
${PBR}
${TRIPLANAR}
void main(){
  vec3 Ng = normalize(v_nrm);
  if (!gl_FrontFacing && u_terrain < 0.5) Ng = -Ng;
  vec3 V = normalize(u_camPos - v_wpos);
  vec3 base = toLinear(v_col);
  vec3 albedo = base;
  vec3 N = Ng;
  float rough = 0.62, metal = 0.0, ao = 1.0, trans = 0.0;
  vec3 emis = vec3(0.0);
  float layer = floor(v_mat.x + 0.5);
  float porous = 1.0;
  if (u_terrain > 0.5) {
    // two-layer terrain: ground on flats, rock on slopes, broken up by noise. Only the layers a pixel blends are
    // sampled, so open ground costs one material instead of two.
    float slope = 1.0 - Ng.y;
    float nz = fbm2(v_wpos.xz * 0.08);
    float k = smoothstep(0.16, 0.34, slope + (nz - 0.5) * 0.22);
    Surf s;
    if (k <= 0.001) s = triSample(u_terrainMat.x, v_wpos, Ng, 0.24);
    else if (k >= 0.999) s = triSample(u_terrainMat.y, v_wpos, Ng, 0.14);
    else {
      Surf g = triSample(u_terrainMat.x, v_wpos, Ng, 0.24);
      Surf r = triSample(u_terrainMat.y, v_wpos, Ng, 0.14);
      s.albedo = mix(g.albedo, r.albedo, k); s.n = normalize(mix(g.n, r.n, k)); s.rough = mix(g.rough, r.rough, k); s.ao = mix(g.ao, r.ao, k); s.metal = 0.0;
    }
    float layerG = k < 0.5 ? u_terrainMat.x : u_terrainMat.y;
    vec3 avg = mix(u_matAvg[int(u_terrainMat.x + 0.5)], u_matAvg[int(u_terrainMat.y + 0.5)], k);
    // the realm palette (vertex colour) tints the photographed detail
    vec3 tinted = s.albedo / max(avg, vec3(0.02)) * base;
    // macro variation: the same material at a 32 m scale breaks up the repetition of the 4 m tile
    vec3 macro = texture(u_albedo, vec3(v_wpos.xz * 0.031 + 0.37, layerG)).rgb / max(u_matAvg[int(layerG + 0.5)], vec3(0.02));
    albedo = mix(s.albedo * mix(vec3(1.0), base / max(dot(base, vec3(0.333)), 0.02) * 0.33, 0.6), tinted, u_tintMix) * (0.8 + 0.4 * nz);
    albedo *= mix(vec3(1.0), clamp(macro, vec3(0.55), vec3(1.5)), 0.4);
    N = s.n; rough = s.rough; ao = s.ao;
    // glowing veins: their strength rides on the terrain normal's length (see meshes.terrainMesh glowFn)
    float acc = smoothstep(0.25, 1.0, length(v_nrm) - 1.0);
    if (acc > 0.001) {
      float pulse = 0.65 + 0.35 * sin(u_time * 1.7 + v_wpos.x * 0.15 + v_wpos.z * 0.11);
      emis += toLinear(u_accent) * acc * pulse * u_veinGlow * (0.35 + 0.65 * smoothstep(0.4, 0.7, fbm2(v_wpos.xz * 0.6 + u_time * 0.05)));
    }
    // rain puddles collect on the flats; the noise is only evaluated when it can matter
    float puddle = 0.0;
    if (u_wet > 0.01 && slope < 0.12) puddle = smoothstep(0.55, 0.7, fbm2(v_wpos.xz * 0.11 + 3.1)) * smoothstep(0.12, 0.02, slope) * u_wet;
    if (puddle > 0.01) {
      // concentric raindrop ripples
      vec2 cell = floor(v_wpos.xz * 1.6);
      vec2 f = fract(v_wpos.xz * 1.6) - 0.5;
      float ph = fract(u_time * 1.3 + hash12(cell));
      float rr = length(f - (vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5) * 0.5);
      float ring = sin((rr - ph * 0.5) * 60.0) * smoothstep(0.5 * ph + 0.05, 0.5 * ph, rr) * (1.0 - ph);
      N = normalize(mix(N, Ng, puddle) + vec3(ring * 0.08 * puddle, 0.0, ring * 0.08 * puddle));
      albedo *= 1.0 - 0.45 * puddle;
      rough = mix(rough, 0.02, puddle);
      ao = mix(ao, 1.0, puddle);
    }
  } else if (layer >= 0.0 && layer < 50.0 && u_texOn > 0.5) {
    vec3 lp = v_lpos;
    vec3 ln = normalize(v_lnrm);
    float scale = v_mat.w > 0.0 ? v_mat.w : 0.6;
    Surf s = triSample(layer, lp, ln, scale);
    // objects carry their own colour: the texture supplies the variation, the palette supplies the hue
    vec3 avg = u_matAvg[int(layer + 0.5)];
    albedo = s.albedo / max(avg, vec3(0.02)) * base;
    vec3 nObj = s.n;
    N = normalize(v_ax0 * nObj.x + v_ax1 * nObj.y + v_ax2 * nObj.z);
    if (!gl_FrontFacing) N = -N;
    rough = s.rough; metal = s.metal; ao = mix(1.0, s.ao, 0.8);
    if (v_mat.y >= 0.0) rough = mix(rough, v_mat.y, 0.6);
    if (v_mat.z >= 0.0) metal = v_mat.z;
    if (layer == 17.0 || layer == 12.0) trans = 0.6; // flesh membranes and cloth
    porous = metal > 0.5 ? 0.2 : 1.0;
  } else {
    if (v_mat.y >= 0.0) rough = v_mat.y;
    if (v_mat.z >= 0.0) metal = v_mat.z;
    if (layer == 100.0) { rough = 0.1; trans = 0.25; albedo *= 0.35; } // crystal: dark glass with an inner glow
    else if (layer == 101.0) { rough = 0.45; trans = 0.5; }         // skin / organic
    else if (layer == 102.0) { rough = 0.03; metal = 0.0; }          // glass / wet eye
  }
  // specular anti-aliasing: normal-mapped detail can't hold mirror highlights at a distance
  rough = max(rough, 0.12 + length(u_camPos - v_wpos) * 0.006);
  // ash fall dusts up-facing surfaces; rain darkens porous ones and makes everything glossy
  float up = clamp(N.y, 0.0, 1.0);
  float dust = u_dust * smoothstep(0.5, 0.9, up) * (0.6 + 0.4 * vnoise3(v_wpos * 2.0));
  albedo = mix(albedo, toLinear(u_dustCol), dust * 0.8);
  rough = mix(rough, 1.0, dust);
  float wet = u_wet * (0.4 + 0.6 * up);
  albedo *= 1.0 - 0.35 * wet * porous;
  rough = mix(rough, rough * 0.25, wet);
  float ks;
  vec3 c = shade(v_wpos, N, V, albedo, rough, metal, ao, trans, ks);
  if (v_emis > 0.0) emis += base * v_emis * (layer == 100.0 ? 0.9 : 2.2);
  if (layer == 100.0) emis += base * 0.5 * pow(1.0 - max(dot(N, V), 0.0), 2.0);
  o_col = vec4(c + emis, 1.0);
}`;

// Shadow casters: instanced primitives, terrain and skinned meshes write depth only.
export const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=3) in vec4 a_m0;
layout(location=4) in vec4 a_m1;
layout(location=5) in vec4 a_m2;
layout(location=6) in vec4 a_m3;
layout(location=7) in vec4 a_icol;
uniform mat4 u_vp;
void main(){
  mat4 m = mat4(a_m0, a_m1, a_m2, a_m3);
  gl_Position = u_vp * m * vec4(a_pos, 1.0);
}`;

export const SHADOW_FS = `#version 300 es
precision mediump float;
out vec4 o_col;
void main(){ o_col = vec4(1.0); }`;

// Skinned mannequin: 4 bone influences, bone matrices from a float texture (one row of 4 texels per bone, one
// texture row per character).
const SKIN_HEAD = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec4 a_joints;
layout(location=3) in vec4 a_weights;
// per character, instanced: bone-texture row, colour + emissive, material (layer, roughness, metalness, scale)
layout(location=4) in float a_row;
layout(location=5) in vec4 a_tint;
layout(location=6) in vec4 a_matp;
uniform mat4 u_vp;
uniform highp sampler2D u_bones;
mat4 bone(float j){
  int x = int(j) * 4, y = int(a_row);
  return mat4(texelFetch(u_bones, ivec2(x, y), 0), texelFetch(u_bones, ivec2(x + 1, y), 0), texelFetch(u_bones, ivec2(x + 2, y), 0), texelFetch(u_bones, ivec2(x + 3, y), 0));
}
mat4 skinMat(){
  return bone(a_joints.x) * a_weights.x + bone(a_joints.y) * a_weights.y + bone(a_joints.z) * a_weights.z + bone(a_joints.w) * a_weights.w;
}
`;

export const SKIN_VS = `${SKIN_HEAD}
out vec3 v_wpos;
out vec3 v_nrm;
out vec3 v_col;
out float v_emis;
out vec3 v_lpos;
out vec3 v_lnrm;
flat out vec4 v_mat;
out vec3 v_ax0;
out vec3 v_ax1;
out vec3 v_ax2;
void main(){
  mat4 sk = skinMat();
  vec4 wp = sk * vec4(a_pos, 1.0);
  // stretched bones: transform normals by the inverse transpose (columns / squared length)
  vec3 c0 = sk[0].xyz / max(dot(sk[0].xyz, sk[0].xyz), 1e-8), c1 = sk[1].xyz / max(dot(sk[1].xyz, sk[1].xyz), 1e-8), c2 = sk[2].xyz / max(dot(sk[2].xyz, sk[2].xyz), 1e-8);
  vec3 n = c0 * a_nrm.x + c1 * a_nrm.y + c2 * a_nrm.z;
  v_wpos = wp.xyz;
  v_nrm = n;
  v_col = a_tint.rgb;
  v_emis = a_tint.a;
  v_mat = a_matp;
  // bind-pose position as the texture space, so cloth/leather detail sticks to the body
  v_lpos = a_pos;
  v_lnrm = a_nrm;
  v_ax0 = c0; v_ax1 = c1; v_ax2 = c2;
  gl_Position = u_vp * wp;
}`;

export const SKIN_SHADOW_VS = `${SKIN_HEAD}
void main(){ gl_Position = u_vp * (skinMat() * vec4(a_pos, 1.0)); }`;

// Foliage: same bending as GRASS_VS, plus the blade height for translucent tips and ground-matched roots.
export const CINE_GRASS_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 a_col;
layout(location=3) in vec4 a_i0;
layout(location=4) in vec4 a_i1;
layout(location=5) in vec4 a_i2;
uniform mat4 u_vp;
uniform float u_time;
uniform vec4 u_push[16];
uniform int u_nPush;
uniform vec2 u_wind;
uniform float u_gust;
uniform vec3 u_fade;
out vec3 v_wpos;
out vec3 v_nrm;
out vec3 v_col;
out float v_emis;
out float v_t;
void main(){
  float t = a_col.x;
  float h = a_i0.w;
  float cy = cos(a_i1.x), sy = sin(a_i1.x);
  vec3 lp = vec3(a_pos.x * a_i1.y, a_pos.y * h, a_pos.z * h);
  vec3 p = vec3(lp.x * cy + lp.z * sy, lp.y, -lp.x * sy + lp.z * cy);
  vec2 root = a_i0.xz;
  // rolling wind waves travel across the field; gusts flatten it
  float wave = sin(dot(root, normalize(u_wind + 1e-4)) * 0.18 - u_time * (1.7 + u_gust)) * 0.5 + 0.5;
  float w = sin(u_time * 1.6 + a_i1.z + root.x * 0.13 + root.y * 0.09) * 0.5 + sin(u_time * 3.3 + a_i1.z * 2.0) * 0.2 + wave * (0.6 + u_gust * 1.2);
  vec2 bend = u_wind * (w + 0.3) * 0.26;
  for (int i = 0; i < 16; i++) {
    if (i >= u_nPush) break;
    vec4 q = u_push[i];
    vec2 d = root - q.xy;
    float l = length(d);
    float k = clamp(1.0 - l / q.z, 0.0, 1.0);
    bend += (d / (l + 0.05)) * k * k * q.w * 1.5;
  }
  bend /= a_i1.w;
  float bl = length(bend);
  if (bl > 1.25) bend *= 1.25 / bl;
  float tt = t * t;
  p.xz += bend * h * tt;
  p.y *= 1.0 - min(0.75, dot(bend, bend) * 0.45 * tt);
  float fade = clamp((u_fade.z - length(root - u_fade.xy)) / 7.0, 0.0, 1.0);
  p *= fade;
  vec3 wp = vec3(root.x, a_i0.y, root.y) + p;
  v_wpos = wp;
  v_nrm = normalize(vec3(bend.x * 0.6 + (cy * a_pos.z) * 0.3, 1.0, bend.y * 0.6 - (sy * a_pos.z) * 0.3));
  v_col = a_i2.rgb;
  v_emis = a_i2.a * t * t;
  v_t = t;
  gl_Position = u_vp * vec4(wp, 1.0);
}`;

export const CINE_GRASS_FS = `#version 300 es
precision highp float;
in vec3 v_wpos;
in vec3 v_nrm;
in vec3 v_col;
in float v_emis;
in float v_t;
${LIGHT_UNIFORMS}
uniform vec3 u_groundTint;
out vec4 o_col;
${COMMON}
${PBR}
void main(){
  vec3 N = normalize(v_nrm);
  vec3 V = normalize(u_camPos - v_wpos);
  // roots fade into the ground colour; tips catch the light
  vec3 tip = toLinear(v_col);
  vec3 albedo = mix(toLinear(u_groundTint) * 0.6, tip, smoothstep(0.0, 0.7, v_t)) * (0.85 + 0.3 * vnoise3(v_wpos * 0.7));
  float ao = mix(0.35, 1.0, v_t);
  float ks;
  vec3 c = shade(v_wpos, N, V, albedo, mix(0.75, 0.35, u_wet), 0.0, ao, 0.9 * v_t, ks);
  c += tip * v_emis * 2.5;
  o_col = vec4(c, 1.0);
}`;

// ------------------------------------------------------------------ sky
export const CINE_SKY_FS = `#version 300 es
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
uniform float u_flash;
uniform float u_cloud;
uniform vec2 u_windDir;
uniform float u_skyInt;
out vec4 o_col;
${COMMON}
void main(){
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec3 dir = normalize(u_fwd + u_right * ndc.x * u_tan.x + u_up * ndc.y * u_tan.y);
  float h = dir.y;
  vec3 top = toLinear(u_top), hor = toLinear(u_horizon), neb = toLinear(u_neb), mc = toLinear(u_moonCol);
  vec3 col = mix(hor * 1.6, top, pow(smoothstep(-0.05, 0.7, h), 0.6));
  // layered nebula with dark dust lanes
  vec3 q = dir * 2.6 + vec3(u_time * 0.003, 0.0, 0.0);
  float n = vnoise3(q) * 0.5 + vnoise3(q * 2.2) * 0.28 + vnoise3(q * 4.7) * 0.14 + vnoise3(q * 9.1) * 0.08;
  float lane = smoothstep(0.42, 0.62, vnoise3(q * 1.7 + 9.0));
  col += neb * pow(smoothstep(0.4, 0.95, n), 1.6) * smoothstep(-0.1, 0.5, h) * 2.2 * (1.0 - lane * 0.7);
  // stars, twinkling, thinned by the nebula glow
  vec3 sd = dir * 220.0;
  vec3 cell = floor(sd);
  float s = hash13(cell);
  if (s > 1.0 - 0.01 * u_stars) {
    vec3 sp = cell + 0.5 + (vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 4.1)) - 0.5) * 0.6;
    float d = length(sd - sp);
    float tw = 0.55 + 0.45 * sin(u_time * (2.0 + s * 9.0) + s * 40.0);
    vec3 sc = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), hash13(cell + 9.0));
    col += sc * smoothstep(0.55, 0.0, d) * tw * smoothstep(-0.02, 0.25, h) * 3.0;
  }
  // the watcher: an eclipsed eye with a burning corona
  vec3 mz = normalize(u_moonDir);
  float md = dot(dir, mz);
  float ang = acos(clamp(md, -1.0, 1.0));
  float disk = smoothstep(0.095, 0.09, ang);
  float corona = exp(-ang * 11.0) * 6.0 + exp(-ang * 3.5) * 0.8 + exp(-ang * 1.2) * 0.12;
  vec3 mx = normalize(cross(vec3(0,1,0), mz));
  vec3 my = cross(mz, mx);
  vec2 lp = vec2(dot(dir, mx), dot(dir, my)) / 0.09;
  // corona streamers
  float th = atan(lp.y, lp.x);
  corona *= 0.75 + 0.5 * vnoise2(vec2(th * 6.0, u_time * 0.2)) * smoothstep(0.08, 0.3, ang);
  float iris = smoothstep(0.78, 0.6, length(lp * vec2(1.0, 0.55)));
  float pupil = smoothstep(0.16, 0.1, abs(lp.x)) * step(length(lp), 0.72);
  vec3 diskCol = mix(vec3(0.004, 0.0, 0.004), mc * 3.0, iris * (0.6 + 0.4 * sin(u_time * 0.5)));
  diskCol = mix(diskCol, vec3(0.0), pupil);
  col += mc * corona;
  // cloud deck lit from behind by the watcher, drifting with the wind
  if (h > -0.02 && u_cloud > 0.0) {
    vec2 cp = dir.xz / (h + 0.12) * 1.6 + u_windDir * u_time * 0.02;
    float c1 = fbm2(cp * 0.7);
    float c2 = fbm2(cp * 1.9 + 4.0);
    float dens = smoothstep(0.42, 0.85, c1 * 0.75 + c2 * 0.35) * u_cloud * smoothstep(-0.02, 0.15, h);
    float silver = pow(max(md, 0.0), 6.0);
    vec3 cc = mix(hor * 0.5, top * 0.6, 0.5) + mc * (silver * 3.0 + 0.08) + vec3(0.9, 0.95, 1.0) * u_flash * 3.0 * c1;
    col = mix(col, cc, dens * 0.9);
    disk *= 1.0 - dens * 0.8;
  }
  col = mix(col, diskCol, disk);
  col += vec3(0.6, 0.7, 1.0) * u_flash * 0.6 * smoothstep(-0.2, 0.5, h);
  o_col = vec4(col * u_skyInt, 1.0);
}`;

// ------------------------------------------------------------------ particles / decals
export const CINE_QUAD_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
in vec4 v_col;
in float v_shape;
in float v_dist;
uniform int u_flat;
uniform highp sampler2D u_depth;
uniform vec2 u_res;
uniform vec2 u_nearFar;
uniform float u_hdr;
uniform vec3 u_fogCol;
uniform float u_fogDen;
uniform vec3 u_ambient;
uniform float u_time;
uniform vec3 u_focus;
out vec4 o_col;
${COMMON}
float linDepth(float d){ float z = d * 2.0 - 1.0; return 2.0 * u_nearFar.x * u_nearFar.y / (u_nearFar.y + u_nearFar.x - z * (u_nearFar.y - u_nearFar.x)); }
void main(){
  vec2 uv = v_uv;
  float r = length(uv);
  float a = 0.0;
  int sh = int(v_shape + 0.5);
  if (sh == 0) { a = clamp(1.0 - r, 0.0, 1.0); a = a * a * (0.6 + 0.4 * a); }
  else if (sh == 1) { a = smoothstep(0.72, 0.88, r) * (1.0 - smoothstep(0.9, 1.0, r)); a += clamp(1.0 - r, 0.0, 1.0) * 0.1; }
  else if (sh == 2) { a = (1.0 - abs(uv.x)) * (1.0 - abs(uv.y)); a = a * a; }
  else if (sh == 3) { a = 1.0 - smoothstep(0.6, 0.85, r); }
  else if (sh == 4) { float c = max(1.0 - abs(uv.x) * 7.0, 0.0) + max(1.0 - abs(uv.y) * 7.0, 0.0); a = clamp(c * (1.0 - r), 0.0, 1.0) + pow(clamp(1.0 - r * 2.2, 0.0, 1.0), 2.0); }
  else if (sh == 5) {
    // volumetric-looking smoke puff: rotating noise, soft edges, self-shadowed core
    float ang = hash12(floor(v_col.rg * 64.0) + v_shape) * 6.28 + u_time * 0.15;
    mat2 R = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
    vec2 p = R * uv;
    float n = fbm2(p * 1.6 + v_dist * 0.05 + u_time * 0.08);
    a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.9) * (0.5 + 0.7 * n);
  }
  else if (sh == 6) { a = step(r, 1.0) * (0.18 + 0.82 * smoothstep(0.86, 1.0, r)); }
  else if (sh == 7) { float e = max(abs(uv.x), abs(uv.y)); a = step(e, 1.0) * (0.25 + 0.75 * smoothstep(0.8, 1.0, abs(uv.x))); }
  else { a = clamp(1.0 - r, 0.0, 1.0); }
  if (a <= 0.003) discard;
  vec3 col = toLinear(v_col.rgb);
  float alpha = v_col.a * a;
  // soft particles: fade where they intersect opaque geometry
  if (u_flat == 0) {
    float scene = linDepth(texelFetch(u_depth, ivec2(gl_FragCoord.xy), 0).r);
    float me = linDepth(gl_FragCoord.z);
    alpha *= clamp((scene - me) / (sh == 5 ? 1.2 : 0.25), 0.0, 1.0);
  }
  float fog = 1.0 - exp(-v_dist * u_fogDen);
  if (u_hdr > 0.5) {
    // additive light: HDR so it blooms; fogged by extinction
    o_col = vec4(col * 3.2 * alpha * (1.0 - fog), 0.0);
    return;
  }
  if (sh == 5) {
    // lit smoke: ambient + a hint of whatever colour it was given
    col = mix(col, col * 0.4 + u_ambient * 1.2, 0.5) * (0.6 + 0.3 * a);
    alpha *= 0.75;
    // keep fighters readable through it
    float fd = length(gl_FragCoord.xy - u_focus.xy) / max(u_focus.z, 1.0);
    alpha *= mix(0.4, 1.0, smoothstep(0.25, 1.0, fd));
  }
  col = mix(col, toLinear(u_fogCol), fog * 0.85);
  o_col = vec4(col * alpha, alpha);
}`;

// ------------------------------------------------------------------ weather: instanced rain / ash / snow
export const PRECIP_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_seed;
uniform mat4 u_vp;
uniform vec3 u_camPos;
uniform float u_time;
uniform vec3 u_vel;     // fall velocity (m/s) incl. wind
uniform float u_box;    // cube size around the camera
uniform float u_size;   // drop width
uniform float u_streak; // streak length factor (rain), 0 for flakes
uniform float u_count;  // fraction of instances that are active (intensity)
uniform float u_sway;
out vec2 v_uv;
out float v_a;
void main(){
  if (a_seed.w > u_count) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); v_a = 0.0; v_uv = vec2(0.0); return; }
  vec3 off = a_seed.xyz * u_box + u_vel * u_time * (0.8 + a_seed.w * 0.4);
  vec3 base = u_camPos - vec3(u_box * 0.5);
  vec3 p = base + mod(off - base, vec3(u_box));
  p.x += sin(u_time * 1.3 + a_seed.x * 40.0) * u_sway;
  p.z += cos(u_time * 1.1 + a_seed.z * 40.0) * u_sway;
  vec3 dir = normalize(u_vel);
  vec3 toCam = normalize(u_camPos - p);
  vec3 side = normalize(cross(dir, toCam));
  vec3 up = u_streak > 0.0 ? dir * length(u_vel) * u_streak : normalize(cross(toCam, side)) * u_size;
  vec3 wp = p + side * a_corner.x * u_size + up * a_corner.y;
  v_uv = a_corner;
  float d = length(p - u_camPos);
  v_a = smoothstep(u_box * 0.5, u_box * 0.3, d) * smoothstep(0.3, 1.2, d);
  gl_Position = u_vp * vec4(wp, 1.0);
}`;

export const PRECIP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in float v_a;
uniform vec3 u_col;
uniform float u_alpha;
uniform float u_round;
out vec4 o_col;
void main(){
  float a = u_round > 0.5 ? clamp(1.0 - length(v_uv), 0.0, 1.0) : (1.0 - abs(v_uv.x)) * smoothstep(1.0, 0.2, abs(v_uv.y));
  a *= v_a * u_alpha;
  if (a < 0.002) discard;
  o_col = vec4(u_col * a, a);
}`;

// ------------------------------------------------------------------ screen passes
// Full-res: depth-aware upsample of fog + AO onto the HDR scene (blend ONE, SRC_ALPHA).
export const FOG_APPLY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform highp sampler2D u_fog;
uniform highp sampler2D u_aux;
uniform highp sampler2D u_depth;
uniform vec2 u_nearFar;
uniform vec2 u_lowRes;
uniform float u_aoAmt;
out vec4 o_col;
float linDepth(float d){ float z = d * 2.0 - 1.0; return 2.0 * u_nearFar.x * u_nearFar.y / (u_nearFar.y + u_nearFar.x - z * (u_nearFar.y - u_nearFar.x)); }
void main(){
  float d = texture(u_depth, v_uv).r;
  float lin = linDepth(d);
  vec2 base = v_uv * u_lowRes - 0.5;
  vec2 i0 = floor(base);
  vec4 best = vec4(0.0); float bw = 0.0;
  vec4 fsum = vec4(0.0); float aosum = 0.0;
  for (int y = 0; y < 2; y++) for (int x = 0; x < 2; x++) {
    ivec2 q = ivec2(clamp(i0 + vec2(x, y), vec2(0.0), u_lowRes - 1.0));
    vec4 aux = texelFetch(u_aux, q, 0);
    vec2 f = 1.0 - abs(base - (i0 + vec2(x, y)));
    float w = f.x * f.y * (1.0 / (abs(aux.y - lin) / max(lin, 0.1) * 40.0 + 0.05));
    fsum += texelFetch(u_fog, q, 0) * w;
    aosum += aux.x * w;
    bw += w;
  }
  vec4 fog = fsum / bw;
  float ao = mix(1.0, aosum / bw, u_aoAmt);
  if (d > 0.99999) ao = 1.0;
  o_col = vec4(fog.rgb, fog.a * ao);
}`;

// Bloom: 13-tap downsample (first pass thresholded with a soft knee and Karis average), 9-tap tent upsample.
export const BLOOM_DOWN_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_first;
uniform float u_threshold;
out vec4 o_col;
vec3 t(vec2 o){ return texture(u_tex, v_uv + o * u_texel).rgb; }
float karis(vec3 c){ return 1.0 / (1.0 + max(c.r, max(c.g, c.b))); }
void main(){
  vec3 a = t(vec2(-2,2)), b = t(vec2(0,2)), c = t(vec2(2,2));
  vec3 d = t(vec2(-2,0)), e = t(vec2(0,0)), f = t(vec2(2,0));
  vec3 g = t(vec2(-2,-2)), h = t(vec2(0,-2)), i = t(vec2(2,-2));
  vec3 j = t(vec2(-1,1)), k = t(vec2(1,1)), l = t(vec2(-1,-1)), m = t(vec2(1,-1));
  vec3 col;
  if (u_first > 0.5) {
    vec3 g0 = (a+b+d+e) * 0.25, g1 = (b+c+e+f) * 0.25, g2 = (d+e+g+h) * 0.25, g3 = (e+f+h+i) * 0.25, g4 = (j+k+l+m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    col = (g0*w0*0.125 + g1*w1*0.125 + g2*w2*0.125 + g3*w3*0.125 + g4*w4*0.5) / (w0*0.125 + w1*0.125 + w2*0.125 + w3*0.125 + w4*0.5);
    if (u_threshold > 0.0) {
      float br = max(col.r, max(col.g, col.b));
      float knee = u_threshold * 0.6;
      float soft = clamp(br - u_threshold + knee, 0.0, 2.0 * knee); soft = soft * soft / (4.0 * knee + 1e-4);
      col *= max(soft, br - u_threshold) / max(br, 1e-4);
    }
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  o_col = vec4(max(col, vec3(0.0)), 1.0);
}`;

export const BLOOM_UP_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_radius;
uniform float u_weight;
out vec4 o_col;
void main(){
  vec2 r = u_texel * u_radius;
  vec3 c = texture(u_tex, v_uv).rgb * 4.0;
  c += (texture(u_tex, v_uv + vec2(-r.x, 0)).rgb + texture(u_tex, v_uv + vec2(r.x, 0)).rgb + texture(u_tex, v_uv + vec2(0, -r.y)).rgb + texture(u_tex, v_uv + vec2(0, r.y)).rgb) * 2.0;
  c += texture(u_tex, v_uv + vec2(-r.x, -r.y)).rgb + texture(u_tex, v_uv + vec2(r.x, -r.y)).rgb + texture(u_tex, v_uv + vec2(-r.x, r.y)).rgb + texture(u_tex, v_uv + vec2(r.x, r.y)).rgb;
  o_col = vec4(c / 16.0 * u_weight, 1.0);
}`;

// Half-res depth of field gather (circle of confusion from the depth buffer).
export const DOF_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform highp sampler2D u_depth;
uniform vec2 u_nearFar;
uniform vec2 u_texel;
uniform float u_focus;
uniform float u_range;
uniform float u_maxR;
out vec4 o_col;
float linDepth(float d){ float z = d * 2.0 - 1.0; return 2.0 * u_nearFar.x * u_nearFar.y / (u_nearFar.y + u_nearFar.x - z * (u_nearFar.y - u_nearFar.x)); }
float coc(vec2 uv){ float z = linDepth(texture(u_depth, uv).r); return clamp(abs(z - u_focus) / u_range, 0.0, 1.0) * sign(z - u_focus); }
void main(){
  float c0 = coc(v_uv);
  vec3 acc = texture(u_scene, v_uv).rgb; float wsum = 1.0;
  for (int i = 0; i < 24; i++) {
    float fi = float(i) + 0.5;
    float a = fi * 2.39996;
    float r = sqrt(fi / 24.0);
    vec2 o = vec2(cos(a), sin(a)) * r * u_maxR;
    vec2 uv = v_uv + o * u_texel;
    float c = coc(uv);
    // a sample contributes if its own blur reaches this pixel (foreground bleeds over, background doesn't)
    float w = smoothstep(r - 0.1, r, max(abs(c), c0 > 0.0 ? min(abs(c), c0) : 0.0));
    vec3 s = texture(u_scene, uv).rgb;
    w *= 1.0 + dot(s, vec3(0.3)) * 0.5; // bokeh highlights
    acc += s * w; wsum += w;
  }
  o_col = vec4(acc / wsum, abs(c0));
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform sampler2D u_dof;
uniform float u_dofOn;
uniform vec2 u_res;
uniform float u_time;
uniform float u_exposure;
uniform float u_bloomAmt;
uniform float u_streak;
uniform float u_dirt;
uniform float u_aberr;
uniform float u_damage;
uniform float u_desat;
uniform float u_fade;
uniform vec3 u_tint;
uniform float u_warp;
uniform float u_impact;
uniform float u_speed;
uniform float u_letterbox;
uniform float u_vignette;
uniform float u_grain;
uniform vec3 u_lift;
uniform vec3 u_gamma;
uniform vec3 u_gain;
uniform float u_sat;
uniform float u_contrast;
uniform vec3 u_shadowTint;
uniform vec3 u_highTint;
uniform float u_lowHp;
uniform vec2 u_blurCenter;
out vec4 o_col;
${COMMON}
// ACES fitted (Stephen Hill)
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 I = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 O = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(O * RRTAndODTFit(I * c), 0.0, 1.0);
}
vec3 sceneAt(vec2 uv){
  vec3 c = texture(u_scene, uv).rgb;
  if (u_dofOn > 0.5) { vec4 d = texture(u_dof, uv); c = mix(c, d.rgb, smoothstep(0.05, 0.5, d.a)); }
  return c;
}
void main(){
  vec2 uv = v_uv;
  vec2 cc = uv - 0.5;
  // reality warp ripple and radial speed blur
  uv += cc * dot(cc, cc) * u_warp * 0.6;
  uv += vec2(sin(uv.y * 40.0 + u_time * 3.0), cos(uv.x * 30.0 + u_time * 2.0)) * 0.0012 * u_warp;
  float ab = u_aberr * (0.25 + length(cc)) * 0.006;
  vec3 c;
  c.r = sceneAt(uv + cc * ab).r;
  c.g = sceneAt(uv).g;
  c.b = sceneAt(uv - cc * ab).b;
  if (u_speed > 0.01) {
    vec2 dir = uv - u_blurCenter;
    vec3 acc = c;
    for (int i = 1; i < 8; i++) acc += sceneAt(uv - dir * float(i) * 0.012 * u_speed);
    c = mix(c, acc / 8.0, smoothstep(0.08, 0.45, length(dir)));
  }
  vec3 bl = texture(u_bloom, uv).rgb;
  c += bl * u_bloomAmt;
  // anamorphic streaks: a horizontal smear of the highlights (lightning, the eclipse corona, emissive crystals)
  vec3 sk = vec3(0.0); float sw = 0.0;
  for (int i = -4; i <= 4; i++) { float fi = float(i); float w = exp(-fi * fi * 0.18); sk += texture(u_bloom, uv + vec2(fi * 0.0065, 0.0)).rgb * w; sw += w; }
  c += sk / sw * u_streak;
  // lens dirt lights up under strong bloom
  float dirt = fbm2(uv * vec2(9.0, 6.0) + 3.0) * smoothstep(0.55, 0.9, vnoise2(uv * 22.0)) + smoothstep(0.8, 1.0, vnoise2(uv * 70.0)) * 0.5;
  c += max(bl - vec3(0.45), vec3(0.0)) * dirt * u_dirt * 2.0;
  c *= u_exposure * u_tint;
  // filmic tonemap, then grade in display space
  c = aces(c);
  c = pow(c, vec3(1.0 / 2.2));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c *= mix(u_shadowTint, u_highTint, smoothstep(0.1, 0.75, l));
  c = pow(max(vec3(0.0), c * u_gain + u_lift * (1.0 - c)), 1.0 / u_gamma);
  c = (c - 0.5) * u_contrast + 0.5;
  l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, u_sat * (1.0 - u_desat) * (1.0 - u_lowHp * 0.45));
  // vignette, low-health pulse, damage flash
  float vig = smoothstep(1.05, 0.25, length(cc * vec2(1.0, 0.82)));
  c *= mix(1.0 - u_vignette, 1.0, vig);
  float pulse = u_lowHp * (0.5 + 0.5 * sin(u_time * 7.0));
  c = mix(c, vec3(0.45, 0.0, 0.02), (u_damage * 0.75 + pulse * 0.35) * (1.0 - vig));
  // impact frame: a two-frame inverted flash on decisive hits
  if (u_impact > 0.5) c = mix(c, vec3(1.0) - c.bgr * vec3(1.0, 0.9, 0.9), 0.55);
  // film grain (luma-weighted)
  float g = hash12(uv * u_res + fract(u_time) * 431.0) - 0.5;
  c += g * u_grain * (1.0 - l * 0.6);
  // cinematic letterbox
  float lb = u_letterbox * 0.12;
  if (v_uv.y < lb || v_uv.y > 1.0 - lb) c = vec3(0.0);
  c *= u_fade;
  o_col = vec4(clamp(c, 0.0, 1.0), dot(clamp(c, 0.0, 1.0), vec3(0.299, 0.587, 0.114)));
}`;

// FXAA 3.11 (quality preset ~12), luma in alpha.
export const FXAA_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_on;
out vec4 o_col;
void main(){
  vec4 c = texture(u_tex, v_uv);
  if (u_on < 0.5) { o_col = vec4(c.rgb, 1.0); return; }
  float lM = c.a;
  float lN = textureOffset(u_tex, v_uv, ivec2(0, 1)).a, lS = textureOffset(u_tex, v_uv, ivec2(0, -1)).a;
  float lE = textureOffset(u_tex, v_uv, ivec2(1, 0)).a, lW = textureOffset(u_tex, v_uv, ivec2(-1, 0)).a;
  float mx = max(lM, max(max(lN, lS), max(lE, lW))), mn = min(lM, min(min(lN, lS), min(lE, lW)));
  float range = mx - mn;
  if (range < max(0.0312, mx * 0.125)) { o_col = vec4(c.rgb, 1.0); return; }
  float lNW = textureOffset(u_tex, v_uv, ivec2(-1, 1)).a, lNE = textureOffset(u_tex, v_uv, ivec2(1, 1)).a;
  float lSW = textureOffset(u_tex, v_uv, ivec2(-1, -1)).a, lSE = textureOffset(u_tex, v_uv, ivec2(1, -1)).a;
  float sub = clamp(abs((2.0 * (lN + lS + lE + lW) + lNW + lNE + lSW + lSE) / 12.0 - lM) / range, 0.0, 1.0);
  sub = smoothstep(0.0, 1.0, sub); sub *= sub * 0.75;
  float eh = abs(lNW + lNE - 2.0 * lN) + 2.0 * abs(lW + lE - 2.0 * lM) + abs(lSW + lSE - 2.0 * lS);
  float ev = abs(lNW + lSW - 2.0 * lW) + 2.0 * abs(lN + lS - 2.0 * lM) + abs(lNE + lSE - 2.0 * lE);
  bool hor = eh >= ev;
  float l1 = hor ? lS : lW, l2 = hor ? lN : lE;
  float g1 = abs(l1 - lM), g2 = abs(l2 - lM);
  float step = hor ? u_texel.y : u_texel.x;
  float gs; float le;
  if (g1 >= g2) { step = -step; gs = g1; le = (l1 + lM) * 0.5; } else { gs = g2; le = (l2 + lM) * 0.5; }
  vec2 uv = v_uv; if (hor) uv.y += step * 0.5; else uv.x += step * 0.5;
  vec2 off = hor ? vec2(u_texel.x, 0.0) : vec2(0.0, u_texel.y);
  vec2 u1 = uv - off, u2 = uv + off;
  float e1 = texture(u_tex, u1).a - le, e2 = texture(u_tex, u2).a - le;
  bool d1 = abs(e1) >= gs * 0.25, d2 = abs(e2) >= gs * 0.25;
  for (int i = 0; i < 10; i++) {
    if (d1 && d2) break;
    float q = i < 3 ? 1.0 : (i < 6 ? 2.0 : 4.0);
    if (!d1) { u1 -= off * q; e1 = texture(u_tex, u1).a - le; d1 = abs(e1) >= gs * 0.25; }
    if (!d2) { u2 += off * q; e2 = texture(u_tex, u2).a - le; d2 = abs(e2) >= gs * 0.25; }
  }
  float dist1 = hor ? v_uv.x - u1.x : v_uv.y - u1.y, dist2 = hor ? u2.x - v_uv.x : u2.y - v_uv.y;
  bool near1 = dist1 < dist2; float dmin = min(dist1, dist2);
  float span = dist1 + dist2;
  bool good = ((near1 ? e1 : e2) < 0.0) != (lM - le < 0.0);
  float px = good ? 0.5 - dmin / span : 0.0;
  float fin = max(px, sub);
  vec2 fuv = v_uv; if (hor) fuv.y += fin * step; else fuv.x += fin * step;
  o_col = vec4(texture(u_tex, fuv).rgb, 1.0);
}`;

/** Per-realm cinematic look (lighting, fog, grade, weather). Keyed by dimension id. */
export const LOOKS = {
  ashen: {
    hdri: 'dusk', envTint: [0.9, 0.75, 0.7], envInt: 0.2, keyCol: [1.0, 0.62, 0.4], keyInt: 2.2, keyMix: 0.35,
    fogCol: [0.3, 0.25, 0.25], fogAmb: 0.3, scatCol: [1.0, 0.62, 0.42], density: 0.015, heightFall: 0.09, baseH: -1, aniso: 0.5,
    veinGlow: 1.4, tintMix: 0.45, exposure: 1.1, bloom: 0.18, dirt: 0.5, skyInt: 1.2, cloud: 0.8,
    grade: { lift: [0.0, 0.0, 0.01], gamma: [1.0, 0.98, 0.97], gain: [1.03, 0.99, 0.95], sat: 0.92, contrast: 1.12, shadow: [0.88, 0.95, 1.1], high: [1.08, 1.0, 0.9] },
    weather: ['ashfall', 'embers', 'dry_storm', 'clear'], dust: [0.42, 0.4, 0.4],
  },
  drowned: {
    hdri: 'overcast', envTint: [0.35, 0.8, 0.85], envInt: 0.2, keyCol: [0.45, 1.0, 0.9], keyInt: 1.7, keyMix: 0.2,
    fogCol: [0.05, 0.18, 0.21], fogAmb: 0.36, scatCol: [0.4, 1.0, 0.9], density: 0.02, heightFall: 0.06, baseH: 0, aniso: 0.6,
    veinGlow: 1.4, tintMix: 0.5, exposure: 1.15, bloom: 0.18, dirt: 0.35, skyInt: 1.0, cloud: 0.6,
    grade: { lift: [0.0, 0.01, 0.02], gamma: [1.0, 1.0, 1.02], gain: [0.95, 1.02, 1.05], sat: 0.85, contrast: 1.1, shadow: [0.85, 1.0, 1.12], high: [1.0, 1.04, 1.0] },
    weather: ['rain', 'storm', 'mist', 'rain'], dust: [0.5, 0.6, 0.6],
  },
  starless: {
    hdri: 'night', envTint: [0.75, 0.6, 1.0], envInt: 0.22, keyCol: [0.75, 0.55, 1.0], keyInt: 2.0, keyMix: 0.5,
    fogCol: [0.13, 0.09, 0.22], fogAmb: 0.3, scatCol: [0.8, 0.6, 1.0], density: 0.011, heightFall: 0.07, baseH: -2, aniso: 0.6,
    veinGlow: 1.1, tintMix: 0.55, exposure: 1.2, bloom: 0.18, dirt: 0.6, skyInt: 1.3, cloud: 0.3,
    grade: { lift: [0.01, 0.0, 0.03], gamma: [1.0, 1.0, 1.0], gain: [1.0, 0.97, 1.06], sat: 0.9, contrast: 1.12, shadow: [0.95, 0.9, 1.15], high: [1.04, 1.0, 1.04] },
    weather: ['voidsnow', 'starfall', 'clear', 'voidsnow'], dust: [0.55, 0.5, 0.7],
  },
  flesh: {
    hdri: 'blood', envTint: [1.0, 0.45, 0.42], envInt: 0.2, keyCol: [1.0, 0.7, 0.35], keyInt: 2.2, keyMix: 0.3,
    fogCol: [0.3, 0.1, 0.1], fogAmb: 0.32, scatCol: [1.0, 0.55, 0.4], density: 0.017, heightFall: 0.08, baseH: -1, aniso: 0.6,
    veinGlow: 0.9, tintMix: 0.5, exposure: 1.05, bloom: 0.18, dirt: 0.5, skyInt: 1.15, cloud: 0.7,
    grade: { lift: [0.01, 0.0, 0.0], gamma: [1.0, 0.98, 0.98], gain: [1.02, 0.97, 0.95], sat: 0.85, contrast: 1.12, shadow: [0.92, 0.95, 1.08], high: [1.05, 1.0, 0.94] },
    weather: ['bloodrain', 'spores', 'storm', 'spores'], dust: [0.5, 0.25, 0.25],
  },
};

/**
 * Graphics quality presets for the cinematic pack.
 * grid: voxel fog grid height and depth slices (the width follows the screen aspect), fogSteps: march steps per pixel,
 * aoSlices x aoSteps: horizon directions and samples per side for ambient occlusion.
 * foliage: tuft density multiplier for the grass and the other realm growths (1 is the original density).
 */
export const QUALITY = {
  low: { scale: 0.6, shadow: 1024, grid: [45, 24], fogSteps: 16, ao: false, aoSlices: 0, aoSteps: 0, fogLights: false, bloomLevels: 4, fxaa: true, foliage: 1.5, precip: 2500, dof: false, texSize: 256 },
  medium: { scale: 0.75, shadow: 2048, grid: [68, 36], fogSteps: 20, ao: true, aoSlices: 2, aoSteps: 3, fogLights: false, bloomLevels: 5, fxaa: true, foliage: 2.5, precip: 5000, dof: true, texSize: 512 },
  high: { scale: 1, shadow: 2048, grid: [90, 48], fogSteps: 24, ao: true, aoSlices: 3, aoSteps: 4, fogLights: true, bloomLevels: 6, fxaa: true, foliage: 4, precip: 8000, dof: true, texSize: 512 },
  ultra: { scale: 1, shadow: 4096, grid: [135, 64], fogSteps: 32, ao: true, aoSlices: 4, aoSteps: 5, fogLights: true, bloomLevels: 6, fxaa: true, foliage: 5, precip: 12000, dof: true, texSize: 512 },
};

// Weapon ribbon trails: a camera-independent strip between blade tip and base, brightest at the edge.
export const RIBBON_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec4 a_col;   // rgb + age fade
layout(location=2) in float a_side; // 0 base .. 1 tip
uniform mat4 u_vp;
uniform vec3 u_camPos;
out vec4 v_col;
out float v_side;
out float v_dist;
void main(){
  v_col = a_col; v_side = a_side; v_dist = length(a_pos - u_camPos);
  gl_Position = u_vp * vec4(a_pos, 1.0);
}`;

export const RIBBON_FS = `#version 300 es
precision highp float;
in vec4 v_col;
in float v_side;
in float v_dist;
uniform float u_fogDen;
out vec4 o_col;
void main(){
  float edge = pow(v_side, 3.0) * 1.6 + smoothstep(0.0, 0.4, v_side) * 0.25;
  float a = v_col.a * v_col.a * edge;
  vec3 c = pow(v_col.rgb, vec3(2.2)) * (4.0 + 10.0 * pow(v_side, 8.0) * v_col.a) * a * exp(-v_dist * u_fogDen);
  o_col = vec4(c, 0.0);
}`;
