// GLSL ES 3.0 sources.

export const MAX_LIGHTS = 16;

export const LIT_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 a_col;
layout(location=3) in vec4 a_m0;
layout(location=4) in vec4 a_m1;
layout(location=5) in vec4 a_m2;
layout(location=6) in vec4 a_m3;
layout(location=7) in vec4 a_icol;
uniform mat4 u_vp;
uniform vec2 u_snap;
uniform float u_time;
uniform float u_wobble;
out vec3 v_wpos;
out vec3 v_nrm;
out vec3 v_col;
out float v_emis;
void main(){
  mat4 m = mat4(a_m0, a_m1, a_m2, a_m3);
  vec4 wp = m * vec4(a_pos, 1.0);
  // world-space wobble (eldritch breathing) for vertices flagged by emissive<0
  vec3 s = vec3(dot(a_m0.xyz,a_m0.xyz), dot(a_m1.xyz,a_m1.xyz), dot(a_m2.xyz,a_m2.xyz));
  v_nrm = mat3(m) * (a_nrm / max(s, vec3(1e-8)));
  v_wpos = wp.xyz;
  v_col = a_col * a_icol.rgb;
  v_emis = a_icol.a;
  vec4 cp = u_vp * wp;
  if (u_snap.x > 0.0) {
    vec2 ndc = cp.xy / cp.w;
    ndc = floor(ndc * u_snap + 0.5) / u_snap;
    cp.xy = ndc * cp.w;
  }
  gl_Position = cp;
}`;

// Foliage: one instance per tuft. Blades sway in the wind and bend away from bodies passing through them
// (u_push: xz position, radius, strength; negative strength pulls inward). Recovery comes from the caller fading
// trail and blast entries, so trampled grass springs back over a second or so.
export const GRASS_VS = `#version 300 es
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
uniform vec3 u_fade;
uniform float u_baseMul;
out vec3 v_wpos;
out vec3 v_nrm;
out vec3 v_col;
out float v_emis;
void main(){
  float t = a_col.x;
  float h = a_i0.w;
  float cy = cos(a_i1.x), sy = sin(a_i1.x);
  vec3 lp = vec3(a_pos.x * a_i1.y, a_pos.y * h, a_pos.z * h);
  vec3 p = vec3(lp.x * cy + lp.z * sy, lp.y, -lp.x * sy + lp.z * cy);
  vec2 root = a_i0.xz;
  float w = sin(u_time * 1.6 + a_i1.z + root.x * 0.13 + root.y * 0.09) * 0.6 + sin(u_time * 3.3 + a_i1.z * 2.0) * 0.25;
  vec2 bend = u_wind * (w + 0.5) * 0.22;
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
  // shrink toward the root near the streaming edge so tufts never pop
  float fade = clamp((u_fade.z - length(root - u_fade.xy)) / 7.0, 0.0, 1.0);
  p *= fade;
  vec3 wp = vec3(root.x, a_i0.y, root.y) + p;
  v_wpos = wp;
  v_nrm = normalize(vec3(bend.x * 0.6, 1.0, bend.y * 0.6));
  v_col = mix(a_i2.rgb * u_baseMul, a_i2.rgb, smoothstep(0.0, 0.85, t));
  v_emis = a_i2.a * t * t;
  gl_Position = u_vp * vec4(wp, 1.0);
}`;

export const LIT_FS = `#version 300 es
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
uniform vec3 u_fog; // near, far, heightFalloff
uniform vec4 u_lightPos[${MAX_LIGHTS}];
uniform vec4 u_lightCol[${MAX_LIGHTS}];
uniform int u_nLights;
uniform float u_time;
out vec4 o_col;
void main(){
  vec3 n = normalize(v_nrm);
  vec3 base = v_col;
  float hemi = n.y * 0.5 + 0.5;
  vec3 lig = mix(u_gndCol, u_skyCol, hemi);
  float ndl = dot(n, u_sunDir);
  lig += u_sunCol * max(ndl * 0.8 + 0.2, 0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= u_nLights) break;
    vec3 L = u_lightPos[i].xyz - v_wpos;
    float d = length(L);
    float att = clamp(1.0 - d / u_lightPos[i].w, 0.0, 1.0);
    att *= att;
    lig += u_lightCol[i].rgb * u_lightCol[i].a * att * (max(dot(n, L / max(d, 1e-4)), 0.0) * 0.75 + 0.25);
  }
  vec3 V = normalize(u_camPos - v_wpos);
  float rim = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
  vec3 c = base * lig + base * max(v_emis, 0.0) * 1.6 + u_rimCol * rim * 0.55;
  float dist = length(v_wpos - u_camPos);
  float fog = smoothstep(u_fog.x, u_fog.y, dist);
  float hfog = clamp(exp(-(v_wpos.y + 2.0) * u_fog.z) * 0.6, 0.0, 0.6) * smoothstep(5.0, 40.0, dist);
  fog = clamp(max(fog, hfog), 0.0, 1.0);
  o_col = vec4(mix(c, u_fogCol, fog), 1.0);
}`;

export const QUAD_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_ps;
layout(location=2) in vec4 a_col;
layout(location=3) in vec4 a_vs;
uniform mat4 u_vp;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camPos;
uniform int u_flat;
out vec2 v_uv;
out vec4 v_col;
out float v_shape;
out float v_dist;
void main(){
  vec3 p = a_ps.xyz;
  float s = a_ps.w;
  vec3 wp;
  float shape = a_vs.w;
  if (u_flat == 1) {
    // ground decal: optionally rotated by vel.x (angle)
    float a = a_vs.x;
    vec2 c = vec2(cos(a)*a_corner.x - sin(a)*a_corner.y, sin(a)*a_corner.x + cos(a)*a_corner.y);
    // elongation factor in vel.y (for line telegraphs)
    float stretch = max(a_vs.y, 1.0);
    vec2 lc = a_corner; lc.y *= stretch;
    c = vec2(cos(a)*lc.x - sin(a)*lc.y, sin(a)*lc.x + cos(a)*lc.y);
    wp = p + vec3(c.x * s, 0.0, c.y * s);
  } else if (shape > 1.5 && shape < 2.5 && dot(a_vs.xyz, a_vs.xyz) > 1e-4) {
    vec3 dir = a_vs.xyz;
    vec3 toCam = normalize(u_camPos - p);
    vec3 side = normalize(cross(dir, toCam)) * s;
    wp = p + side * a_corner.x + dir * (a_corner.y * 0.5);
  } else {
    wp = p + (u_camRight * a_corner.x + u_camUp * a_corner.y) * s;
  }
  v_uv = a_corner;
  v_col = a_col;
  v_shape = shape;
  v_dist = length(wp - u_camPos);
  gl_Position = u_vp * vec4(wp, 1.0);
}`;

export const QUAD_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
in vec4 v_col;
in float v_shape;
in float v_dist;
uniform vec3 u_fog;
uniform int u_flat;
uniform vec3 u_focus;
uniform float u_smoke;
out vec4 o_col;
float bayer4(vec2 p){
  ivec2 q = ivec2(mod(floor(p), 4.0));
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[q.x + q.y * 4] + 0.5) / 16.0;
}
// Smoke is a dithered cutout: an ordered 4x4 screen-door instead of a translucent blend, thinned further around
// the combat focus (the player on screen) so fighters always read through it.
float smokeCover(float a){
  float fd = length(gl_FragCoord.xy - u_focus.xy) / max(u_focus.z, 1.0);
  return a * u_smoke * mix(0.35, 1.0, smoothstep(0.3, 1.0, fd));
}
void main(){
  vec2 uv = v_uv;
  float r = length(uv);
  float a = 0.0;
  int sh = int(v_shape + 0.5);
  if (sh == 0) { a = clamp(1.0 - r, 0.0, 1.0); a = a * a; }                 // soft glow
  else if (sh == 1) { a = smoothstep(0.78, 0.9, r) * (1.0 - smoothstep(0.92, 1.0, r)); a += clamp(1.0 - r, 0.0, 1.0) * 0.12; } // ring
  else if (sh == 2) { a = (1.0 - abs(uv.x)) * (1.0 - abs(uv.y)); a = a * a; } // spark
  else if (sh == 3) { a = step(r, 0.85); }                                    // hard pixel / chunk
  else if (sh == 4) { float c = max(1.0 - abs(uv.x) * 6.0, 0.0) + max(1.0 - abs(uv.y) * 6.0, 0.0); a = clamp(c * (1.0 - r), 0.0, 1.0) + clamp(1.0 - r * 2.5, 0.0, 1.0); } // star
  else if (sh == 5) { float n = fract(sin(dot(floor(uv * 4.0), vec2(12.9898, 78.233))) * 43758.5453); a = clamp(1.0 - r, 0.0, 1.0) * (0.55 + 0.45 * n); } // smoke puff
  else if (sh == 6) { // filled telegraph disc with bright edge
    a = step(r, 1.0) * (0.25 + 0.75 * smoothstep(0.85, 1.0, r));
  }
  else if (sh == 7) { // rectangle telegraph (for beams)
    float e = max(abs(uv.x), abs(uv.y));
    a = step(e, 1.0) * (0.3 + 0.7 * smoothstep(0.8, 1.0, abs(uv.x)));
  }
  else { a = clamp(1.0 - r, 0.0, 1.0); }
  if (a <= 0.004) discard;
  float fog = smoothstep(u_fog.x, u_fog.y * 1.1, v_dist);
  if (sh == 5 && u_flat == 0) {
    if (smokeCover(v_col.a * a * 1.6) * (1.0 - fog) < bayer4(gl_FragCoord.xy)) discard;
    o_col = vec4(v_col.rgb * (0.75 + 0.25 * a), 1.0);
    return;
  }
  o_col = vec4(v_col.rgb, v_col.a * a * (1.0 - fog));
}`;

export const FS_TRI_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
out vec2 v_uv;
void main(){
  vec2 p = P[gl_VertexID];
  v_uv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const SKY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec3 u_fwd;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec2 u_tan; // tan(fov/2)*aspect, tan(fov/2)
uniform vec3 u_top;
uniform vec3 u_horizon;
uniform vec3 u_neb;
uniform vec3 u_moonDir;
uniform vec3 u_moonCol;
uniform float u_time;
uniform float u_stars;
out vec4 o_col;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
void main(){
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec3 dir = normalize(u_fwd + u_right * ndc.x * u_tan.x + u_up * ndc.y * u_tan.y);
  float h = dir.y;
  vec3 col = mix(u_horizon, u_top, smoothstep(-0.05, 0.6, h));
  // nebula
  vec3 q = dir * 3.0 + vec3(u_time * 0.004, 0.0, 0.0);
  float n = vnoise(q) * 0.5 + vnoise(q * 2.1) * 0.3 + vnoise(q * 4.3) * 0.2;
  n = smoothstep(0.45, 0.85, n);
  col += u_neb * n * smoothstep(-0.1, 0.4, h) * 0.8;
  // stars
  vec3 sd = dir * 160.0;
  vec3 cell = floor(sd);
  float s = hash(cell);
  if (s > 1.0 - 0.012 * u_stars) {
    vec3 sp = cell + 0.5 + (vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) - 0.5) * 0.6;
    float d = length(sd - sp);
    float tw = 0.6 + 0.4 * sin(u_time * (2.0 + s * 9.0) + s * 40.0);
    col += vec3(1.0, 0.95, 0.9) * smoothstep(0.5, 0.0, d) * tw * smoothstep(-0.05, 0.2, h);
  }
  // the watcher: eclipsed celestial body with corona and iris
  float md = dot(dir, normalize(u_moonDir));
  float ang = acos(clamp(md, -1.0, 1.0));
  float disk = smoothstep(0.105, 0.1, ang);
  float corona = exp(-ang * 9.0) * 1.2 + exp(-ang * 3.0) * 0.25;
  vec3 mcol = u_moonCol * corona;
  // iris slit inside disk
  vec3 mz = normalize(u_moonDir);
  vec3 mx = normalize(cross(vec3(0,1,0), mz));
  vec3 my = cross(mz, mx);
  vec2 lp = vec2(dot(dir, mx), dot(dir, my)) / 0.1;
  float iris = smoothstep(0.75, 0.6, length(lp * vec2(1.0, 0.55)));
  float pupil = smoothstep(0.16, 0.1, abs(lp.x)) * step(length(lp), 0.7);
  vec3 diskCol = mix(vec3(0.02, 0.0, 0.02), u_moonCol * 1.4, iris * (0.6 + 0.4 * sin(u_time * 0.5)));
  diskCol = mix(diskCol, vec3(0.0), pupil);
  col = mix(col + mcol, diskCol, disk);
  o_col = vec4(col, 1.0);
}`;

export const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_threshold;
out vec4 o_col;
void main(){
  vec3 c = texture(u_tex, v_uv).rgb;
  float l = max(c.r, max(c.g, c.b));
  o_col = vec4(c * smoothstep(u_threshold, 1.0, l), 1.0);
}`;

export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;
out vec4 o_col;
void main(){
  vec3 c = texture(u_tex, v_uv).rgb * 0.227;
  c += texture(u_tex, v_uv + u_dir * 1.385).rgb * 0.316;
  c += texture(u_tex, v_uv - u_dir * 1.385).rgb * 0.316;
  c += texture(u_tex, v_uv + u_dir * 3.231).rgb * 0.070;
  c += texture(u_tex, v_uv - u_dir * 3.231).rgb * 0.070;
  o_col = vec4(c, 1.0);
}`;

export const POST_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform vec2 u_res;
uniform float u_time;
uniform float u_aberr;
uniform float u_damage;
uniform float u_desat;
uniform float u_fade;
uniform float u_levels;
uniform float u_bloomAmt;
uniform vec3 u_tint;
uniform float u_warp;
out vec4 o_col;
float bayer(vec2 p){
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return float(m[idx]) / 16.0 - 0.5;
}
void main(){
  vec2 uv = v_uv;
  vec2 cc = uv - 0.5;
  // subtle reality warp
  uv += cc * dot(cc, cc) * u_warp;
  uv += vec2(sin(uv.y * 40.0 + u_time * 3.0), cos(uv.x * 30.0 + u_time * 2.0)) * 0.0015 * u_warp;
  float ab = u_aberr * (0.4 + length(cc));
  vec3 c;
  c.r = texture(u_scene, uv + cc * ab * 0.012).r;
  c.g = texture(u_scene, uv).g;
  c.b = texture(u_scene, uv - cc * ab * 0.012).b;
  c += texture(u_bloom, uv).rgb * u_bloomAmt;
  c *= u_tint;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), u_desat);
  // vignette
  float vig = smoothstep(0.95, 0.25, length(cc * vec2(1.0, 0.85)));
  c *= mix(0.35, 1.0, vig);
  // damage pulse at edges
  c = mix(c, vec3(0.7, 0.02, 0.05), u_damage * (1.0 - vig) * 0.85);
  // grain
  float g = fract(sin(dot(uv * u_res + u_time * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - 0.5) * 0.035;
  // ordered dither + quantize (retro)
  if (u_levels > 0.0) {
    vec2 px = floor(uv * u_res);
    c = floor(c * u_levels + 0.5 + bayer(px) ) / u_levels;
  }
  c *= u_fade;
  o_col = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
