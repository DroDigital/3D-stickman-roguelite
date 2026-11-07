// The "Abyssal Cinematic" frame: shadow map -> HDR scene (sky, PBR terrain/props/characters, foliage, decals) ->
// half-res volumetric fog + SSAO -> fog/AO apply -> soft particles and precipitation -> bloom -> depth of field ->
// ACES composite with grading and lens effects -> FXAA. Owned by the Renderer when a cinematic style is active.
import * as S from './shaders.js';
import * as C from './cinematic.js';
import { Mannequin } from './skinned.js';
import { mat4LookAt, mat4Ortho, mat4Mul, mat4Invert } from '../core/math.js';

const U_ALB = 0, U_NRM = 1, U_ARM = 2, U_SHADOW = 3, U_ENV = 4, U_BONES = 5, U_DEPTH = 6, U_MISC = 7;

function tex2D(gl, w, h, ifmt, fmt, type, filter, wrap = gl.CLAMP_TO_EDGE) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return t;
}

function fbo(gl, colors, depth) {
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  colors.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
  if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  if (colors.length) gl.drawBuffers(colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  else { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) throw new Error('Cinematic framebuffer incomplete');
  return f;
}

export class CinePipe {
  constructor(R) {
    this.R = R;
    const gl = (this.gl = R.gl);
    this.ok = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (!this.ok) return;
    const P = R.Program;
    this.lit = new P(gl, C.CINE_LIT_VS, C.CINE_LIT_FS);
    this.skin = new P(gl, C.SKIN_VS, C.CINE_LIT_FS);
    this.grass = new P(gl, C.CINE_GRASS_VS, C.CINE_GRASS_FS);
    this.shadowP = new P(gl, C.SHADOW_VS, C.SHADOW_FS);
    this.skinShadow = new P(gl, C.SKIN_SHADOW_VS, C.SHADOW_FS);
    this.sky = new P(gl, S.FS_TRI_VS, C.CINE_SKY_FS);
    this.quad = new P(gl, S.QUAD_VS, C.CINE_QUAD_FS);
    this.precipP = new P(gl, C.PRECIP_VS, C.PRECIP_FS);
    this.fogP = new P(gl, S.FS_TRI_VS, C.VOLFOG_FS);
    this.applyP = new P(gl, S.FS_TRI_VS, C.FOG_APPLY_FS);
    this.downP = new P(gl, S.FS_TRI_VS, C.BLOOM_DOWN_FS);
    this.upP = new P(gl, S.FS_TRI_VS, C.BLOOM_UP_FS);
    this.dofP = new P(gl, S.FS_TRI_VS, C.DOF_FS);
    this.compP = new P(gl, S.FS_TRI_VS, C.COMPOSITE_FS);
    this.fxaaP = new P(gl, S.FS_TRI_VS, C.FXAA_FS);
    this.ribbonP = new P(gl, C.RIBBON_VS, C.RIBBON_FS);
    // ribbon vertex stream: pos3, rgba4, side1
    this.ribbonData = new Float32Array(8 * 6000);
    this.ribbonN = 0;
    this.ribbonVao = gl.createVertexArray();
    gl.bindVertexArray(this.ribbonVao);
    this.ribbonBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.ribbonData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
    for (let i = 3; i < 9; i++) gl.disableVertexAttribArray(i);
    gl.bindVertexArray(null);
    this.quality = C.QUALITY.high;
    this.shadowVP = new Float32Array(16);
    this.lightView = new Float32Array(16);
    this.lightProj = new Float32Array(16);
    this.invVP = new Float32Array(16);
    this.keyDir = [0, 1, 0];
    this.keyCol = [1, 1, 1];
    this.envTex = {};
    this.sh = new Float32Array(27);
    this.matAvg = new Float32Array(24 * 3).fill(0.3);
    this.texOn = 0;
    this.mannequin = null;
    this.holes = new Float32Array(8 * 4);
    this.nHoles = 0;
    // weather state the game drives (see game/weather.js)
    this.precip = { kind: 'none', amount: 0, vel: [0, -12, 0], size: 0.012, streak: 0.045, color: [0.6, 0.65, 0.7], alpha: 0.35, round: 0, sway: 0, box: 26 };
    this.flash = 0;
    this.wet = 0;
    this.dust = 0;
    this.gust = 0;
    this.cloud = 0.6;
    this._dummyTextures();
    this._precipBuffers(12000);
    this.setQuality(R.gfx || 'high');
  }

  // ------------------------------------------------------------ resources
  _dummyTextures() {
    const gl = this.gl;
    const arr = (srgb) => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 255, 255]));
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      return t;
    };
    this.albedoArr = arr(true); this.normalArr = arr(false); this.armArr = arr(false);
    const e = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, e);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array([0.3, 0.3, 0.35, 1]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.envDummy = e;
    this.env = { tex: e, sh: (() => { const s = new Float32Array(27); s[0] = 0.35; s[1] = 0.35; s[2] = 0.4; return s; })(), mips: 0 };
  }

  /** Upload the sourced assets (texture arrays, HDR environments, mannequin). */
  attach(assets, texSize = 512) {
    if (!this.ok || !assets) return;
    const gl = this.gl;
    const T = assets.textures;
    if (T) {
      const size = Math.min(texSize, T.size);
      const levels = Math.floor(Math.log2(size)) + 1;
      const mk = (imgs, fmt) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, fmt, size, size, T.layers);
        imgs.forEach((im, i) => {
          let px = im;
          if (im.width !== size) px = downsample(im, size);
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, px.data);
        });
        gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
        if (this.aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        return t;
      };
      this.albedoArr = mk(T.albedo, gl.SRGB8_ALPHA8);
      this.normalArr = mk(T.normal, gl.RGBA8);
      this.armArr = mk(T.arm, gl.RGBA8);
      this.matAvg.set(T.avg.subarray(0, Math.min(T.avg.length, 72)));
      this.texOn = 1;
    }
    for (const [id, h] of Object.entries(assets.hdri || {})) this.envTex[id] = this._envTexture(h);
    if (assets.model) {
      try { this.mannequin = new Mannequin(gl, assets.model); } catch (e) { console.warn('mannequin unavailable', e); this.mannequin = null; }
    }
  }

  _envTexture(h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    let w = h.w, hh = h.h;
    let src = new Float32Array(w * hh * 4);
    // compress the sun and other hot spots: these worlds are lit by an eclipse, not a daylight sun, so glossy
    // surfaces should mirror the sky's mood without blowing out
    let avg = 0;
    for (let i = 0; i < w * hh; i++) avg += h.data[i * 3] * 0.2126 + h.data[i * 3 + 1] * 0.7152 + h.data[i * 3 + 2] * 0.0722;
    avg /= w * hh;
    const cap = avg * 5;
    for (let i = 0; i < w * hh; i++) {
      const r = h.data[i * 3], g = h.data[i * 3 + 1], b = h.data[i * 3 + 2];
      const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const k = l > cap ? (cap + Math.log(1 + (l - cap) / cap) * cap) / l : 1;
      src[i * 4] = r * k; src[i * 4 + 1] = g * k; src[i * 4 + 2] = b * k; src[i * 4 + 3] = 1;
    }
    let level = 0;
    // box-filtered mip chain (roughness picks a level); wide horizontal wrap keeps the seam clean
    for (;;) {
      gl.texImage2D(gl.TEXTURE_2D, level, gl.RGBA16F, w, hh, 0, gl.RGBA, gl.FLOAT, src);
      if (w === 1 && hh === 1) break;
      const nw = Math.max(1, w >> 1), nh = Math.max(1, hh >> 1);
      const dst = new Float32Array(nw * nh * 4);
      for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 4; c++) {
        let s = 0, n = 0;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(w - 1, x * 2 + dx), sy = Math.min(hh - 1, y * 2 + dy);
          s += src[(sy * w + sx) * 4 + c]; n++;
        }
        dst[(y * nw + x) * 4 + c] = s / n;
      }
      src = dst; w = nw; hh = nh; level++;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // normalise each HDRI to unit average irradiance so a realm's envInt means the same for every map
    const lum = h.sh[0] * 0.2126 + h.sh[1] * 0.7152 + h.sh[2] * 0.0722;
    const norm = 1 / Math.max(1e-4, lum);
    return { tex: t, sh: h.sh.map((v) => v * norm), mips: Math.min(level, 7), norm };
  }

  setQuality(q) {
    this.quality = C.QUALITY[q] || C.QUALITY.high;
    this.setShadowSize(this.quality.shadow);
    this.w = 0; // force target rebuild
  }

  setShadowSize(n) {
    const gl = this.gl;
    if (this.shadowSize === n) return;
    if (this.shadowTex) { gl.deleteTexture(this.shadowTex); gl.deleteFramebuffer(this.shadowFB); }
    this.shadowSize = n;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, n, n);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowTex = t;
    this.shadowFB = fbo(gl, [], t);
  }

  _precipBuffers(n) {
    const gl = this.gl;
    this.precipVao = gl.createVertexArray();
    gl.bindVertexArray(this.precipVao);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) seeds[i] = Math.random();
    // w doubles as the activation threshold, so sort-free intensity control picks a random subset
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    for (let i = 2; i < 9; i++) gl.disableVertexAttribArray(i);
    gl.bindVertexArray(null);
    this.precipN = n;
  }

  _targets(w, h) {
    if (this.w === w && this.h === h && this.sceneFB) return;
    const gl = this.gl;
    for (const t of this._owned || []) (gl.isTexture(t) ? gl.deleteTexture(t) : gl.deleteFramebuffer(t));
    const own = (this._owned = []);
    const T = (...a) => { const t = tex2D(gl, ...a); own.push(t); return t; };
    const F = (...a) => { const f = fbo(gl, ...a); own.push(f); return f; };
    this.w = w; this.h = h;
    this.sceneTex = T(w, h, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.depthTex = T(w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
    this.sceneFB = F([this.sceneTex], this.depthTex);
    this.depthCopy = T(w, h, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
    this.depthCopyFB = F([], this.depthCopy);
    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    this.hw = hw; this.hh = hh;
    this.fogTex = T(hw, hh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.auxTex = T(hw, hh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.NEAREST);
    this.fogFB = F([this.fogTex, this.auxTex]);
    this.bloom = [];
    let bw = hw, bh = hh;
    for (let i = 0; i < this.quality.bloomLevels && bw >= 4 && bh >= 4; i++) {
      const t = T(bw, bh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
      this.bloom.push({ tex: t, fb: F([t]), w: bw, h: bh });
      bw >>= 1; bh >>= 1;
    }
    this.dofTex = T(hw, hh, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    this.dofFB = F([this.dofTex]);
    this.ldrTex = T(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    this.ldrFB = F([this.ldrTex]);
  }

  // ------------------------------------------------------------ per-frame setup
  _setupLight(env, look) {
    const md = env.moonDir, sd = env.sunDir;
    const ml = Math.hypot(...md), sl = Math.hypot(...sd);
    const k = look.keyMix;
    let x = (md[0] / ml) * (1 - k) + (sd[0] / sl) * k, y = (md[1] / ml) * (1 - k) + (sd[1] / sl) * k, z = (md[2] / ml) * (1 - k) + (sd[2] / sl) * k;
    y = Math.max(y, 0.42);
    const l = Math.hypot(x, y, z);
    this.keyDir[0] = x / l; this.keyDir[1] = y / l; this.keyDir[2] = z / l;
    for (let i = 0; i < 3; i++) this.keyCol[i] = look.keyCol[i] * look.keyInt;
    const e = this.envTex[look.hdri] || this.env;
    this.curEnv = e;
    // shadow camera: an ortho box around the focus, snapped to whole texels so edges don't shimmer
    const R = this.R, f = R.focus;
    const ext = 34;
    const kd = this.keyDir;
    mat4LookAt(this.lightView, kd[0] * 100, kd[1] * 100, kd[2] * 100, 0, 0, 0, 0, 1, 0);
    const v = this.lightView;
    const texel = (ext * 2) / this.shadowSize;
    let cx = v[0] * f[0] + v[4] * f[1] + v[8] * f[2], cy = v[1] * f[0] + v[5] * f[1] + v[9] * f[2];
    cx = Math.floor(cx / texel) * texel; cy = Math.floor(cy / texel) * texel;
    v[12] -= cx; v[13] -= cy;
    mat4Ortho(this.lightProj, ext, ext, 100 - 120, 100 + 120);
    mat4Mul(this.shadowVP, this.lightProj, v);
    this.shadowTexel = 1 / this.shadowSize;
  }

  _common(p, light = true) {
    const gl = this.gl, R = this.R, e = this.curEnv, look = R.look;
    gl.uniformMatrix4fv(p.u.u_vp, false, R.vp);
    if (!light) return;
    gl.uniform3fv(p.u.u_camPos, R.camPos);
    gl.uniform3fv(p.u.u_keyDir, this.keyDir);
    gl.uniform3fv(p.u.u_keyCol, this.keyCol);
    gl.uniform3fv(p.u.u_sh, e.sh);
    gl.uniform1f(p.u.u_envInt, look.envInt * (e.normInt ?? 1));
    gl.uniform1f(p.u.u_envSpec, (e.norm || 1) * 0.6);
    gl.uniform3fv(p.u.u_envTint, look.envTint);
    gl.uniform1f(p.u.u_envMips, e.mips);
    gl.uniformMatrix4fv(p.u.u_shadowVP, false, this.shadowVP);
    gl.uniform1f(p.u.u_shadowTexel, this.shadowTexel);
    gl.uniform1f(p.u.u_shadowOn, 1);
    gl.uniform1i(p.u.u_nLights, this.nl);
    gl.uniform4fv(p.u.u_lightPos, R.lightPos);
    gl.uniform4fv(p.u.u_lightCol, R.lightCol);
    gl.uniform1f(p.u.u_time, R.time);
    gl.uniform1f(p.u.u_flash, this.flash);
    gl.uniform1f(p.u.u_wet, this.wet);
    gl.uniform1f(p.u.u_dust, this.dust);
    gl.uniform3fv(p.u.u_dustCol, look.dust);
    gl.uniform3fv(p.u.u_matAvg, this.matAvg);
    gl.uniform1f(p.u.u_texOn, this.texOn);
    gl.uniform1f(p.u.u_tintMix, look.tintMix);
    gl.uniform1i(p.u.u_albedo, U_ALB);
    gl.uniform1i(p.u.u_normal, U_NRM);
    gl.uniform1i(p.u.u_arm, U_ARM);
    gl.uniform1i(p.u.u_shadow, U_SHADOW);
    gl.uniform1i(p.u.u_env, U_ENV);
  }

  _bindTextures() {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + U_ALB); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.albedoArr);
    gl.activeTexture(gl.TEXTURE0 + U_NRM); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.normalArr);
    gl.activeTexture(gl.TEXTURE0 + U_ARM); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.armArr);
    gl.activeTexture(gl.TEXTURE0 + U_SHADOW); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.activeTexture(gl.TEXTURE0 + U_ENV); gl.bindTexture(gl.TEXTURE_2D, this.curEnv.tex);
    gl.activeTexture(gl.TEXTURE0 + U_DEPTH); gl.bindTexture(gl.TEXTURE_2D, this.depthCopy);
    gl.activeTexture(gl.TEXTURE0);
  }

  _drawTerrain(p, lit) {
    const gl = this.gl, R = this.R;
    const terrain = R.terrainSmooth || R.terrain;
    if (!terrain) return;
    if (lit) {
      const rm = R.look.terrainMats;
      gl.uniform1f(p.u.u_terrain, 1);
      gl.uniform2f(p.u.u_terrainMat, rm[0], rm[1]);
    }
    gl.bindVertexArray(terrain.vao);
    gl.vertexAttrib4f(3, 1, 0, 0, 0);
    gl.vertexAttrib4f(4, 0, 1, 0, 0);
    gl.vertexAttrib4f(5, 0, 0, 1, 0);
    gl.vertexAttrib4f(6, 0, 0, 0, 1);
    gl.vertexAttrib4f(7, 1, 1, 1, 0);
    gl.vertexAttrib4f(8, -2, -1, -1, 0);
    gl.drawArrays(gl.TRIANGLES, 0, terrain.count);
    if (lit) gl.uniform1f(p.u.u_terrain, 0);
  }

  _skinPart(p, look, part) {
    const gl = this.gl;
    const c = part.joints ? look.joint : look.main;
    gl.uniform3fv(p.u.u_tint, c);
    gl.uniform1f(p.u.u_emis, part.joints ? look.jointEmis || 0 : look.mainEmis || 0);
    const m = part.joints ? look.jointMat : look.mainMat;
    gl.uniform4f(p.u.u_matp, m ?? -1, part.joints ? (look.jointRough ?? -1) : (look.rough ?? -1), part.joints ? (look.jointMetal ?? -1) : (look.metal ?? -1), look.texScale || 2.2);
  }

  // ------------------------------------------------------------ the frame
  render(env, dt) {
    const gl = this.gl, R = this.R, look = R.look, q = this.quality;
    const cw = R.canvas.width, ch = R.canvas.height;
    const w = Math.max(160, Math.round(cw * q.scale)), h = Math.max(120, Math.round(ch * q.scale));
    this._targets(w, h);
    this.nl = R._packLights();
    this._setupLight(env, look);
    for (const b of R.dyn) b.upload();
    const mq = this.mannequin;
    if (mq) mq.upload();

    // ---- 1. shadow map
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 3);
    let p = this.shadowP.use();
    gl.uniformMatrix4fv(p.u.u_vp, false, this.shadowVP);
    this._drawTerrain(p, false);
    for (const b of R.stat) b.draw();
    for (const b of R.dyn) b.draw();
    if (mq && mq.queue.length) {
      p = this.skinShadow.use();
      gl.uniformMatrix4fv(p.u.u_vp, false, this.shadowVP);
      mq.draw(p, U_BONES, null);
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // ---- 2. HDR scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this._bindTextures();
    // sky
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const sk = this.sky.use();
    const th = Math.tan(R.fov / 2);
    gl.uniform3fv(sk.u.u_fwd, R.camFwd);
    gl.uniform3fv(sk.u.u_right, R.camRight);
    gl.uniform3fv(sk.u.u_up, R.camUp);
    gl.uniform2f(sk.u.u_tan, th * R.aspect, th);
    gl.uniform3fv(sk.u.u_top, env.skyTop);
    gl.uniform3fv(sk.u.u_horizon, env.fogCol);
    gl.uniform3fv(sk.u.u_neb, env.nebula);
    gl.uniform3fv(sk.u.u_moonDir, env.moonDir);
    gl.uniform3fv(sk.u.u_moonCol, env.moonCol);
    gl.uniform1f(sk.u.u_time, R.time);
    gl.uniform1f(sk.u.u_stars, env.stars ?? 1);
    gl.uniform1f(sk.u.u_flash, this.flash);
    gl.uniform1f(sk.u.u_cloud, this.cloud);
    gl.uniform2fv(sk.u.u_windDir, R.wind);
    gl.uniform1f(sk.u.u_skyInt, look.skyInt);
    gl.bindVertexArray(R.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    // terrain + props + dynamic primitives
    p = this.lit.use();
    this._common(p);
    gl.uniform3fv(p.u.u_accent, R.accent || [1, 0.3, 0.2]);
    gl.uniform1f(p.u.u_veinGlow, look.veinGlow);
    gl.uniform1f(p.u.u_terrain, 0);
    this._drawTerrain(p, true);
    for (const b of R.stat) b.draw();
    for (const b of R.dyn) b.draw();
    // skinned characters
    if (mq && mq.queue.length) {
      p = this.skin.use();
      this._common(p);
      gl.uniform1f(p.u.u_terrain, 0);
      mq.draw(p, U_BONES, (pp, lk, part) => this._skinPart(pp, lk, part));
    }
    // foliage
    const f = R.foliage;
    if (f && f.count) {
      p = this.grass.use();
      this._common(p);
      gl.uniform4fv(p.u.u_push, R.push);
      gl.uniform1i(p.u.u_nPush, R.nPush);
      gl.uniform2fv(p.u.u_wind, R.wind);
      gl.uniform1f(p.u.u_gust, this.gust);
      gl.uniform3fv(p.u.u_fade, R.foliageFade);
      gl.uniform3fv(p.u.u_groundTint, R.groundTint || [0.3, 0.25, 0.2]);
      gl.bindVertexArray(f.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, f.vertCount, f.count);
    }
    // ground decals (blood, telegraphs, shadows)
    const qp = this.quad.use();
    this._quadUniforms(qp, env, w, h);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -8);
    gl.uniform1i(qp.u.u_flat, 1);
    gl.uniform1f(qp.u.u_hdr, 0);
    R.decals.draw();
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    // ---- 3. depth copy for soft particles and the fog march
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneFB);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.depthCopyFB);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    // ---- 4. volumetric fog + SSAO at half resolution
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fogFB);
    gl.viewport(0, 0, this.hw, this.hh);
    mat4Invert(this.invVP, R.vp);
    p = this.fogP.use();
    gl.activeTexture(gl.TEXTURE0 + U_DEPTH); gl.bindTexture(gl.TEXTURE_2D, this.depthCopy);
    gl.uniform1i(p.u.u_depth, U_DEPTH);
    gl.uniform1i(p.u.u_shadow, U_SHADOW);
    gl.uniformMatrix4fv(p.u.u_shadowVP, false, this.shadowVP);
    gl.uniform1f(p.u.u_shadowOn, 1);
    gl.uniformMatrix4fv(p.u.u_invVP, false, this.invVP);
    gl.uniformMatrix4fv(p.u.u_vpMat, false, R.vp);
    gl.uniform3fv(p.u.u_camFwd, R.camFwd);
    gl.uniform3fv(p.u.u_camPos, R.camPos);
    gl.uniform2f(p.u.u_nearFar, R.near, R.far);
    gl.uniform2f(p.u.u_res, this.hw, this.hh);
    gl.uniform3fv(p.u.u_keyDir, this.keyDir);
    gl.uniform3fv(p.u.u_keyCol, this.keyCol);
    const fa = look.fogAmb;
    gl.uniform3f(p.u.u_fogCol, look.fogCol[0] * fa, look.fogCol[1] * fa, look.fogCol[2] * fa);
    gl.uniform3fv(p.u.u_scatCol, look.scatCol);
    gl.uniform1f(p.u.u_density, look.density * (R.fogMul ?? 1));
    gl.uniform1f(p.u.u_heightFall, look.heightFall);
    gl.uniform1f(p.u.u_baseH, look.baseH);
    gl.uniform1f(p.u.u_aniso, look.aniso);
    gl.uniform1f(p.u.u_time, R.time);
    gl.uniform2fv(p.u.u_wind, R.wind);
    gl.uniform4fv(p.u.u_holes, this.holes);
    gl.uniform1i(p.u.u_nHoles, this.nHoles);
    gl.uniform4fv(p.u.u_lightPos, R.lightPos);
    gl.uniform4fv(p.u.u_lightCol, R.lightCol);
    gl.uniform1i(p.u.u_nLights, q.fogLights ? Math.min(this.nl, 8) : 0);
    gl.uniform1i(p.u.u_steps, q.fogSteps);
    gl.uniform1f(p.u.u_maxDist, 70);
    gl.uniform1f(p.u.u_aoOn, q.ao ? 1 : 0);
    gl.uniform1f(p.u.u_aoRadius, 0.7);
    gl.uniform1f(p.u.u_flash, this.flash);
    gl.bindVertexArray(R.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- 5. apply fog + AO to the scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
    gl.viewport(0, 0, w, h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.SRC_ALPHA);
    p = this.applyP.use();
    gl.activeTexture(gl.TEXTURE0 + U_MISC); gl.bindTexture(gl.TEXTURE_2D, this.fogTex);
    gl.uniform1i(p.u.u_fog, U_MISC);
    gl.activeTexture(gl.TEXTURE0 + U_BONES); gl.bindTexture(gl.TEXTURE_2D, this.auxTex);
    gl.uniform1i(p.u.u_aux, U_BONES);
    gl.uniform1i(p.u.u_depth, U_DEPTH);
    gl.uniform2f(p.u.u_nearFar, R.near, R.far);
    gl.uniform2f(p.u.u_lowRes, this.hw, this.hh);
    gl.uniform1f(p.u.u_aoAmt, q.ao ? 0.85 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- 6. particles + precipitation (soft, depth-tested, no depth writes)
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const qp2 = this.quad.use();
    this._quadUniforms(qp2, env, w, h);
    gl.uniform1i(qp2.u.u_flat, 0);
    gl.uniform1f(qp2.u.u_hdr, 0);
    R.alphaQuads.draw();
    gl.uniform1f(qp2.u.u_hdr, 1);
    R.addQuads.draw();
    this._drawRibbons();
    this._drawPrecip();
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(R.emptyVao);

    // ---- 7. bloom
    const pp = R.post_;
    p = this.downP.use();
    gl.uniform1i(p.u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    let src = this.sceneTex, sw = w, shh = h;
    this.bloom.forEach((b, i) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb);
      gl.viewport(0, 0, b.w, b.h);
      gl.bindTexture(gl.TEXTURE_2D, src);
      gl.uniform2f(p.u.u_texel, 1 / sw, 1 / shh);
      gl.uniform1f(p.u.u_first, i === 0 ? 1 : 0);
      gl.uniform1f(p.u.u_threshold, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = b.tex; sw = b.w; shh = b.h;
    });
    p = this.upP.use();
    gl.uniform1i(p.u.u_tex, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const s = this.bloom[i], d = this.bloom[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb);
      gl.viewport(0, 0, d.w, d.h);
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.uniform2f(p.u.u_texel, 1 / s.w, 1 / s.h);
      gl.uniform1f(p.u.u_radius, 1);
      gl.uniform1f(p.u.u_weight, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    // ---- 8. depth of field (cinematic moments)
    const dofOn = q.dof && (pp.dof || 0) > 0.01;
    if (dofOn) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.dofFB);
      gl.viewport(0, 0, this.hw, this.hh);
      p = this.dofP.use();
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.uniform1i(p.u.u_scene, 0);
      gl.uniform1i(p.u.u_depth, U_DEPTH);
      gl.uniform2f(p.u.u_nearFar, R.near, R.far);
      gl.uniform2f(p.u.u_texel, 1 / this.hw, 1 / this.hh);
      gl.uniform1f(p.u.u_focus, pp.dofFocus || 6);
      gl.uniform1f(p.u.u_range, pp.dofRange || 8);
      gl.uniform1f(p.u.u_maxR, 7 * pp.dof);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- 9. composite (tonemap + grade + lens)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ldrFB);
    gl.viewport(0, 0, w, h);
    p = this.compP.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(p.u.u_scene, 0);
    gl.activeTexture(gl.TEXTURE0 + 1); gl.bindTexture(gl.TEXTURE_2D, this.bloom.length ? this.bloom[0].tex : this.sceneTex);
    gl.uniform1i(p.u.u_bloom, 1);
    gl.activeTexture(gl.TEXTURE0 + 2); gl.bindTexture(gl.TEXTURE_2D, this.dofTex);
    gl.uniform1i(p.u.u_dof, 2);
    gl.uniform1f(p.u.u_dofOn, dofOn ? 1 : 0);
    gl.uniform2f(p.u.u_res, w, h);
    gl.uniform1f(p.u.u_time, R.time);
    gl.uniform1f(p.u.u_exposure, look.exposure * (pp.exposure ?? 1) * (1 + this.flash * 0.25));
    gl.uniform1f(p.u.u_bloomAmt, look.bloom * (1 + (pp.bloomBoost || 0)));
    gl.uniform1f(p.u.u_dirt, look.dirt);
    gl.uniform1f(p.u.u_aberr, pp.aberr);
    gl.uniform1f(p.u.u_damage, pp.damage);
    gl.uniform1f(p.u.u_desat, pp.desat);
    gl.uniform1f(p.u.u_fade, pp.fade);
    gl.uniform3fv(p.u.u_tint, pp.tint);
    gl.uniform1f(p.u.u_warp, pp.warp);
    gl.uniform1f(p.u.u_impact, pp.impact);
    gl.uniform1f(p.u.u_speed, pp.speed);
    gl.uniform1f(p.u.u_letterbox, pp.letterbox || 0);
    gl.uniform1f(p.u.u_vignette, 0.42 + (pp.vignette || 0));
    gl.uniform1f(p.u.u_grain, 0.045);
    const gr = look.grade;
    gl.uniform3fv(p.u.u_lift, gr.lift);
    gl.uniform3fv(p.u.u_gamma, gr.gamma);
    gl.uniform3fv(p.u.u_gain, gr.gain);
    gl.uniform1f(p.u.u_sat, gr.sat);
    gl.uniform1f(p.u.u_contrast, gr.contrast);
    gl.uniform3fv(p.u.u_shadowTint, gr.shadow);
    gl.uniform3fv(p.u.u_highTint, gr.high);
    gl.uniform1f(p.u.u_lowHp, pp.lowHp || 0);
    gl.uniform2fv(p.u.u_blurCenter, pp.blurCenter || [0.5, 0.5]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ---- 10. FXAA to the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    p = this.fxaaP.use();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.ldrTex);
    gl.uniform1i(p.u.u_tex, 0);
    gl.uniform2f(p.u.u_texel, 1 / w, 1 / h);
    gl.uniform1f(p.u.u_on, q.fxaa ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  _quadUniforms(qp, env, w, h) {
    const gl = this.gl, R = this.R, look = R.look;
    gl.uniformMatrix4fv(qp.u.u_vp, false, R.vp);
    gl.uniform3fv(qp.u.u_camRight, R.camRight);
    gl.uniform3fv(qp.u.u_camUp, R.camUp);
    gl.uniform3fv(qp.u.u_camPos, R.camPos);
    gl.uniform1i(qp.u.u_depth, U_DEPTH);
    gl.uniform2f(qp.u.u_res, w, h);
    gl.uniform2f(qp.u.u_nearFar, R.near, R.far);
    gl.uniform3fv(qp.u.u_fogCol, env.fogCol);
    gl.uniform1f(qp.u.u_fogDen, look.density * 0.6);
    const fa = look.fogAmb * 0.8;
    gl.uniform3f(qp.u.u_ambient, look.fogCol[0] * fa + this.keyCol[0] * 0.04, look.fogCol[1] * fa + this.keyCol[1] * 0.04, look.fogCol[2] * fa + this.keyCol[2] * 0.04);
    gl.uniform1f(qp.u.u_time, R.time);
    gl.uniform3fv(qp.u.u_focus, R._focusPx({ w, h }));
  }

  /** Queue a ribbon: pts = [tipX,tipY,tipZ, baseX,baseY,baseZ, fade] * n (see game/trails.js). */
  ribbon(pts, color, width = 1, intensity = 1) {
    const d = this.ribbonData;
    const n = pts.length / 7;
    for (let i = 0; i < n - 1; i++) {
      if (this.ribbonN + 6 > d.length / 8) return;
      const a = i * 7, b = (i + 1) * 7;
      // base points pulled toward the tip so the ribbon is a blade-wide band, not the whole arm
      const v = (o, tip) => {
        const k = this.ribbonN++ * 8;
        const s = tip ? 1 : 0;
        const bx = pts[o + 3] + (pts[o] - pts[o + 3]) * (1 - width), by = pts[o + 4] + (pts[o + 1] - pts[o + 4]) * (1 - width), bz = pts[o + 5] + (pts[o + 2] - pts[o + 5]) * (1 - width);
        d[k] = tip ? pts[o] : bx; d[k + 1] = tip ? pts[o + 1] : by; d[k + 2] = tip ? pts[o + 2] : bz;
        d[k + 3] = color[0] * intensity; d[k + 4] = color[1] * intensity; d[k + 5] = color[2] * intensity; d[k + 6] = pts[o + 6]; d[k + 7] = s;
      };
      v(a, 0); v(a, 1); v(b, 1);
      v(a, 0); v(b, 1); v(b, 0);
    }
  }

  _drawRibbons() {
    if (!this.ribbonN) return;
    const gl = this.gl, R = this.R;
    const p = this.ribbonP.use();
    gl.uniformMatrix4fv(p.u.u_vp, false, R.vp);
    gl.uniform3fv(p.u.u_camPos, R.camPos);
    gl.uniform1f(p.u.u_fogDen, R.look.density * 0.6);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.ribbonData, 0, this.ribbonN * 8);
    gl.bindVertexArray(this.ribbonVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.ribbonN);
    this.ribbonN = 0;
  }

  _drawPrecip() {
    const pr = this.precip;
    if (!pr || pr.amount <= 0.01) return;
    const gl = this.gl, R = this.R;
    const p = this.precipP.use();
    gl.uniformMatrix4fv(p.u.u_vp, false, R.vp);
    gl.uniform3fv(p.u.u_camPos, R.camPos);
    gl.uniform1f(p.u.u_time, R.time);
    gl.uniform3fv(p.u.u_vel, pr.vel);
    gl.uniform1f(p.u.u_box, pr.box);
    gl.uniform1f(p.u.u_size, pr.size);
    gl.uniform1f(p.u.u_streak, pr.streak);
    gl.uniform1f(p.u.u_count, pr.amount);
    gl.uniform1f(p.u.u_sway, pr.sway);
    const k = 1 + this.flash * 4;
    gl.uniform3f(p.u.u_col, pr.color[0] * k, pr.color[1] * k, pr.color[2] * k);
    gl.uniform1f(p.u.u_alpha, pr.alpha);
    gl.uniform1f(p.u.u_round, pr.round);
    gl.bindVertexArray(this.precipVao);
    const n = Math.min(this.precipN, this.quality.precip);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
  }
}

function downsample(im, size) {
  const out = new Uint8ClampedArray(size * size * 4);
  const fx = im.width / size, fy = im.height / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.floor((x + 0.5) * fx), sy = Math.floor((y + 0.5) * fy);
    const o = (sy * im.width + sx) * 4, d = (y * size + x) * 4;
    out[d] = im.data[o]; out[d + 1] = im.data[o + 1]; out[d + 2] = im.data[o + 2]; out[d + 3] = im.data[o + 3];
  }
  return { width: size, height: size, data: out };
}
