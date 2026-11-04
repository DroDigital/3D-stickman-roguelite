// WebGL2 forward renderer: instanced primitive batches, terrain, particles/decals, sky and retro post-processing.
import * as S from './shaders.js';
import * as T from './toon.js';
import { boxMesh, icoSphereMesh, cylinderMesh, coneMesh, octaMesh } from './meshes.js';
import { mat4Perspective, mat4Ortho, mat4LookAt, mat4Mul, writeSegment, writeTRS } from '../core/math.js';

export const PRIM = { BOX: 0, SPHERE: 1, CYL: 2, CONE: 3, OCTA: 4, ORB: 5, BALL: 6 };
const INST_FLOATS = 20;
const QUAD_FLOATS = 12;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    throw new Error('Shader compile error: ' + log + '\n' + src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n'));
  }
  return sh;
}

class Program {
  constructor(gl, vs, fs) {
    this.gl = gl;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
    this.p = p;
    this.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      this.u[name] = gl.getUniformLocation(p, info.name);
    }
  }
  use() { this.gl.useProgram(this.p); return this; }
}

class InstanceBatch {
  constructor(gl, meshData, capacity, usage) {
    this.gl = gl;
    this.capacity = capacity;
    this.data = new Float32Array(capacity * INST_FLOATS);
    this.count = 0;
    this.vertCount = meshData.length / 9;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.meshBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.meshBuf);
    gl.bufferData(gl.ARRAY_BUFFER, meshData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    this.instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, usage);
    for (let i = 0; i < 5; i++) {
      gl.enableVertexAttribArray(3 + i);
      gl.vertexAttribPointer(3 + i, 4, gl.FLOAT, false, INST_FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(3 + i, 1);
    }
    gl.bindVertexArray(null);
  }

  grow() {
    const nd = new Float32Array(this.data.length * 2);
    nd.set(this.data);
    this.data = nd;
    this.capacity *= 2;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
  }

  /** Reserve one slot and return its float offset. */
  alloc() {
    if (this.count >= this.capacity) this.grow();
    return (this.count++) * INST_FLOATS;
  }

  upload(start = 0, count = this.count) {
    if (count <= 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, start * INST_FLOATS * 4, this.data, start * INST_FLOATS, count * INST_FLOATS);
  }

  draw() {
    if (this.count === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vertCount, this.count);
  }
}

export class QuadBatch {
  constructor(gl, capacity) {
    this.gl = gl;
    this.capacity = capacity;
    this.data = new Float32Array(capacity * QUAD_FLOATS);
    this.count = 0;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const cb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 3; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, QUAD_FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);
  }

  push(x, y, z, size, r, g, b, a, vx, vy, vz, shape) {
    if (this.count >= this.capacity) return;
    const d = this.data, o = this.count++ * QUAD_FLOATS;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a;
    d[o + 8] = vx; d[o + 9] = vy; d[o + 10] = vz; d[o + 11] = shape;
  }

  draw() {
    if (this.count === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * QUAD_FLOATS);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
  }
}

function makeTarget(gl, w, h, depth, linear) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let rb = null;
  if (depth) {
    rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb, rb, w, h };
}

/** Attach a second colour texture (G-buffer: packed normal + depth) to a target's framebuffer. */
function addGbuffer(gl, t) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, t.w, t.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  t.gbuf = tex;
}

function freeTarget(gl, t) {
  if (!t) return;
  if (t.gbuf) gl.deleteTexture(t.gbuf);
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fb);
  if (t.rb) gl.deleteRenderbuffer(t.rb);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not supported by this browser.');
    this.gl = gl;
    this.lit = new Program(gl, S.LIT_VS, S.LIT_FS);
    this.quad = new Program(gl, S.QUAD_VS, S.QUAD_FS);
    this.sky = new Program(gl, S.FS_TRI_VS, S.SKY_FS);
    this.bright = new Program(gl, S.FS_TRI_VS, S.BRIGHT_FS);
    this.blur = new Program(gl, S.FS_TRI_VS, S.BLUR_FS);
    this.post = new Program(gl, S.FS_TRI_VS, S.POST_FS);
    // cel-shaded anime pipeline (previz styles)
    this.toonLit = new Program(gl, S.LIT_VS, T.TOON_LIT_FS);
    this.toonQuad = new Program(gl, S.QUAD_VS, T.TOON_QUAD_FS);
    this.toonSky = new Program(gl, S.FS_TRI_VS, T.TOON_SKY_FS);
    this.ink = new Program(gl, S.FS_TRI_VS, T.INK_FS);
    this.toonPost = new Program(gl, S.FS_TRI_VS, T.TOON_POST_FS);
    this.style = T.STYLES.retro;
    this.ortho = false;
    this.orthoSize = 11;
    this.emptyVao = gl.createVertexArray();

    // low vertex counts keep the instanced batches cheap even on integrated GPUs
    const meshes = [boxMesh(), icoSphereMesh(1, true), cylinderMesh(6, false), coneMesh(6), octaMesh(), icoSphereMesh(1, false), icoSphereMesh(0, false)];
    this.dyn = meshes.map((m) => new InstanceBatch(gl, m, 2048, gl.DYNAMIC_DRAW));
    this.stat = meshes.map((m) => new InstanceBatch(gl, m, 512, gl.DYNAMIC_DRAW));

    this.alphaQuads = new QuadBatch(gl, 12000);
    this.addQuads = new QuadBatch(gl, 16000);
    this.decals = new QuadBatch(gl, 3000);

    this.terrain = null;
    this.view = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.vp = new Float32Array(16);
    this.camPos = [0, 0, 0];
    this.camRight = [1, 0, 0];
    this.camUp = [0, 1, 0];
    this.camFwd = [0, 0, -1];
    this.fov = 1.0;
    this.lights = [];
    this.lightPos = new Float32Array(S.MAX_LIGHTS * 4);
    this.lightCol = new Float32Array(S.MAX_LIGHTS * 4);

    this.targetHeight = 432; // internal resolution height (retro)
    this.levels = 28;
    this.snap = true;
    this.post_ = { aberr: 0.2, damage: 0, desat: 0, fade: 1, bloom: 0.9, tint: [1, 1, 1], warp: 0.15, impact: 0, speed: 0 };
    this.time = 0;
    this.env = null;
    this.resize();
  }

  /** Switch art style preset (see gfx/toon.js). Returns the active preset. */
  setStyle(id) {
    const st = T.STYLES[id] || T.STYLES.retro;
    this.style = st;
    this.snap = !st.toon;
    this.levels = st.toon ? 0 : 28;
    this.ortho = !!st.ortho;
    this.targetHeight = st.height;
    this.resize(true);
    return st;
  }

  setQuality(targetHeight) {
    this.targetHeight = targetHeight;
    this.resize(true);
  }

  resize(force = false) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (!force && w === this.canvas.width && h === this.canvas.height && this.scene) return;
    this.canvas.width = w;
    this.canvas.height = h;
    const th = this.targetHeight > 0 ? Math.min(this.targetHeight, h) : h;
    const lh = Math.max(120, th);
    const lw = Math.max(160, Math.round(lh * (w / h)));
    const gl = this.gl;
    freeTarget(gl, this.scene);
    freeTarget(gl, this.bloomA);
    freeTarget(gl, this.bloomB);
    freeTarget(gl, this.inked);
    this.inked = null;
    this.scene = makeTarget(gl, lw, lh, true, false);
    if (this.style && this.style.toon) {
      addGbuffer(gl, this.scene);
      this.inked = makeTarget(gl, lw, lh, false, false);
    }
    this.bloomA = makeTarget(gl, Math.max(1, lw >> 1), Math.max(1, lh >> 1), false, true);
    this.bloomB = makeTarget(gl, Math.max(1, lw >> 1), Math.max(1, lh >> 1), false, true);
    this.aspect = w / h;
  }

  get lowW() { return this.scene.w; }
  get lowH() { return this.scene.h; }

  setCamera(px, py, pz, tx, ty, tz, fov, near = 0.1, far = 600) {
    this.fov = fov;
    this.camPos[0] = px; this.camPos[1] = py; this.camPos[2] = pz;
    mat4LookAt(this.view, px, py, pz, tx, ty, tz);
    if (this.ortho) {
      const hh = this.orthoSize;
      mat4Ortho(this.proj, hh * this.aspect, hh, near, far);
    } else {
      mat4Perspective(this.proj, fov, this.aspect, near, far);
    }
    mat4Mul(this.vp, this.proj, this.view);
    const v = this.view;
    this.camRight[0] = v[0]; this.camRight[1] = v[4]; this.camRight[2] = v[8];
    this.camUp[0] = v[1]; this.camUp[1] = v[5]; this.camUp[2] = v[9];
    this.camFwd[0] = -v[2]; this.camFwd[1] = -v[6]; this.camFwd[2] = -v[10];
  }

  // ---------------------------------------------------------------- terrain / static
  /** Terrain meshes: `meshData` is the faceted retro mesh, `smoothData` (optional) the painted mesh the toon styles draw. */
  setTerrain(meshData, smoothData) {
    for (const t of [this.terrain, this.terrainSmooth]) this._freeMesh(t);
    this.terrain = this._uploadMesh(meshData);
    this.terrainSmooth = smoothData ? this._uploadMesh(smoothData) : null;
  }

  _freeMesh(t) {
    if (!t) return;
    this.gl.deleteBuffer(t.buf);
    this.gl.deleteVertexArray(t.vao);
  }

  _uploadMesh(meshData) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, meshData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    for (let i = 3; i < 8; i++) gl.disableVertexAttribArray(i);
    gl.bindVertexArray(null);
    return { vao, buf, count: meshData.length / 9 };
  }

  clearStatic() { for (const b of this.stat) b.count = 0; }

  /** Adds a static instance, returns {kind, index} handle for later hiding. */
  staticTRS(kind, x, y, z, yaw, pitch, roll, sx, sy, sz, c, e = 0) {
    const b = this.stat[kind];
    const o = b.alloc();
    writeTRS(b.data, o, x, y, z, yaw, pitch, roll, sx, sy, sz);
    b.data[o + 16] = c[0]; b.data[o + 17] = c[1]; b.data[o + 18] = c[2]; b.data[o + 19] = e;
    return { kind, index: o / INST_FLOATS };
  }

  staticSeg(ax, ay, az, bx, by, bz, r, c, e = 0) {
    const b = this.stat[PRIM.CYL];
    const o = b.alloc();
    writeSegment(b.data, o, ax, ay, az, bx, by, bz, r);
    b.data[o + 16] = c[0]; b.data[o + 17] = c[1]; b.data[o + 18] = c[2]; b.data[o + 19] = e;
    return { kind: PRIM.CYL, index: o / INST_FLOATS };
  }

  uploadStatic() { for (const b of this.stat) b.upload(); }

  hideStatic(handles) {
    for (const h of handles) {
      const b = this.stat[h.kind];
      const o = h.index * INST_FLOATS;
      for (let i = 0; i < 16; i++) b.data[o + i] = 0;
      b.upload(h.index, 1);
    }
  }

  // ---------------------------------------------------------------- dynamic primitives
  trs(kind, x, y, z, yaw, pitch, roll, sx, sy, sz, c, e = 0) {
    const b = this.dyn[kind];
    const o = b.alloc();
    writeTRS(b.data, o, x, y, z, yaw, pitch, roll, sx, sy, sz);
    b.data[o + 16] = c[0]; b.data[o + 17] = c[1]; b.data[o + 18] = c[2]; b.data[o + 19] = e;
  }

  seg(ax, ay, az, bx, by, bz, r, c, e = 0) {
    const b = this.dyn[PRIM.CYL];
    const o = b.alloc();
    writeSegment(b.data, o, ax, ay, az, bx, by, bz, r);
    b.data[o + 16] = c[0]; b.data[o + 17] = c[1]; b.data[o + 18] = c[2]; b.data[o + 19] = e;
  }

  /** Oriented primitive along a segment (e.g. a cone or blade from a to b). */
  segPrim(kind, ax, ay, az, bx, by, bz, r, c, e = 0, flat = 1) {
    const b = this.dyn[kind];
    const o = b.alloc();
    writeSegment(b.data, o, ax, ay, az, bx, by, bz, r);
    if (flat !== 1) { b.data[o + 8] *= flat; b.data[o + 9] *= flat; b.data[o + 10] *= flat; }
    if (kind === PRIM.OCTA || kind === PRIM.SPHERE || kind === PRIM.ORB || kind === PRIM.BALL || kind === PRIM.BOX) {
      // these meshes are centered: shift origin to the midpoint and halve the axis
      const d = b.data;
      d[o + 4] *= 0.5; d[o + 5] *= 0.5; d[o + 6] *= 0.5;
      d[o + 12] += d[o + 4]; d[o + 13] += d[o + 5]; d[o + 14] += d[o + 6];
      if (kind === PRIM.BOX) { d[o + 4] *= 2; d[o + 5] *= 2; d[o + 6] *= 2; d[o + 0] *= 2; d[o + 1] *= 2; d[o + 2] *= 2; d[o + 8] *= 2; d[o + 9] *= 2; d[o + 10] *= 2; }
    }
    b.data[o + 16] = c[0]; b.data[o + 17] = c[1]; b.data[o + 18] = c[2]; b.data[o + 19] = e;
  }

  /** Primitive centred at (cx,cy,cz) with explicit (already scaled) local X/Y/Z axes — for oriented body volumes. */
  basis(kind, cx, cy, cz, X, Y, Z, c, e = 0) {
    const b = this.dyn[kind];
    const o = b.alloc();
    const d = b.data;
    d[o] = X[0]; d[o + 1] = X[1]; d[o + 2] = X[2]; d[o + 3] = 0;
    d[o + 4] = Y[0]; d[o + 5] = Y[1]; d[o + 6] = Y[2]; d[o + 7] = 0;
    d[o + 8] = Z[0]; d[o + 9] = Z[1]; d[o + 10] = Z[2]; d[o + 11] = 0;
    d[o + 12] = cx; d[o + 13] = cy; d[o + 14] = cz; d[o + 15] = 1;
    d[o + 16] = c[0]; d[o + 17] = c[1]; d[o + 18] = c[2]; d[o + 19] = e;
  }

  ball(x, y, z, r, c, e = 0, smooth = false) {
    this.trs(smooth ? PRIM.ORB : PRIM.SPHERE, x, y, z, 0, 0, 0, r, r, r, c, e);
  }

  light(x, y, z, radius, r, g, b, intensity) {
    this.lights.push(x, y, z, radius, r, g, b, intensity);
  }

  decal(x, y, z, size, r, g, b, a, shape = 0, angle = 0, stretch = 1) {
    this.decals.push(x, y, z, size, r, g, b, a, angle, stretch, 0, shape);
  }

  glow(x, y, z, size, r, g, b, a, shape = 0) {
    this.addQuads.push(x, y, z, size, r, g, b, a, 0, 0, 0, shape);
  }

  beginFrame() {
    for (const b of this.dyn) b.count = 0;
    this.alphaQuads.count = 0;
    this.addQuads.count = 0;
    this.decals.count = 0;
    this.lights.length = 0;
  }

  _packLights() {
    const L = this.lights, n = L.length / 8;
    const cx = this.camPos[0], cy = this.camPos[1], cz = this.camPos[2];
    let idx = [];
    for (let i = 0; i < n; i++) {
      const dx = L[i * 8] - cx, dy = L[i * 8 + 1] - cy, dz = L[i * 8 + 2] - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const score = (L[i * 8 + 7] * L[i * 8 + 3]) / (1 + Math.max(0, d - L[i * 8 + 3]));
      idx.push([score, i]);
    }
    if (n > S.MAX_LIGHTS) idx.sort((a, b) => b[0] - a[0]);
    const m = Math.min(n, S.MAX_LIGHTS);
    for (let k = 0; k < m; k++) {
      const i = idx[k][1];
      for (let j = 0; j < 4; j++) {
        this.lightPos[k * 4 + j] = L[i * 8 + j];
        this.lightCol[k * 4 + j] = L[i * 8 + 4 + j];
      }
    }
    return m;
  }

  render(env, dt) {
    const gl = this.gl;
    this.time += dt;
    const env_ = env;
    const sc = this.scene;
    const st = this.style;
    const toon = !!st.toon;
    // in pseudo-3D (orthographic) mode the camera sits far back, so fog is measured from the focus instead
    const fogOffset = this.ortho ? this.orthoDist || 0 : 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, sc.fb);
    gl.viewport(0, 0, sc.w, sc.h);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    if (toon) {
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      gl.clearBufferfv(gl.COLOR, 0, [env_.fogCol[0], env_.fogCol[1], env_.fogCol[2], 1]);
      gl.clearBufferfv(gl.COLOR, 1, [0.5, 0.5, 0.9999, 0]);
      gl.clear(gl.DEPTH_BUFFER_BIT);
    } else {
      gl.clearColor(env_.fogCol[0], env_.fogCol[1], env_.fogCol[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    // sky
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const sk = (toon ? this.toonSky : this.sky).use();
    const th = Math.tan(this.fov / 2);
    gl.uniform3fv(sk.u.u_fwd, this.camFwd);
    gl.uniform3fv(sk.u.u_right, this.camRight);
    gl.uniform3fv(sk.u.u_up, this.camUp);
    gl.uniform2f(sk.u.u_tan, th * this.aspect, th);
    gl.uniform3fv(sk.u.u_top, env_.skyTop);
    gl.uniform3fv(sk.u.u_horizon, env_.fogCol);
    gl.uniform3fv(sk.u.u_neb, env_.nebula);
    gl.uniform3fv(sk.u.u_moonDir, env_.moonDir);
    gl.uniform3fv(sk.u.u_moonCol, env_.moonCol);
    gl.uniform1f(sk.u.u_time, this.time);
    gl.uniform1f(sk.u.u_stars, env_.stars ?? 1);
    if (toon) gl.uniform1f(sk.u.u_skyMode, st.sky);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // lit geometry
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    const p = (toon ? this.toonLit : this.lit).use();
    gl.uniformMatrix4fv(p.u.u_vp, false, this.vp);
    gl.uniform2f(p.u.u_snap, this.snap ? sc.w * 0.5 : 0, this.snap ? sc.h * 0.5 : 0);
    gl.uniform1f(p.u.u_time, this.time);
    gl.uniform3fv(p.u.u_sunDir, env_.sunDir);
    gl.uniform3fv(p.u.u_sunCol, env_.sunCol);
    gl.uniform3fv(p.u.u_skyCol, env_.skyCol);
    gl.uniform3fv(p.u.u_gndCol, env_.gndCol);
    gl.uniform3fv(p.u.u_fogCol, env_.fogCol);
    gl.uniform3fv(p.u.u_rimCol, env_.rimCol);
    gl.uniform3fv(p.u.u_camPos, this.camPos);
    gl.uniform3f(p.u.u_fog, env_.fogNear, env_.fogFar, env_.fogHeight ?? 0.08);
    if (toon) {
      gl.uniform1f(p.u.u_bands, st.bands);
      gl.uniform1f(p.u.u_tone, st.tone);
      gl.uniform3fv(p.u.u_shade, st.shade);
      gl.uniform1f(p.u.u_light, st.light);
      gl.uniform1f(p.u.u_rim, st.rim);
      gl.uniform1f(p.u.u_spec, st.spec);
      gl.uniform1f(p.u.u_fogBands, st.fogBands);
      gl.uniform1f(p.u.u_fogOffset, fogOffset);
      gl.uniform1f(p.u.u_toneScale, Math.max(1, this.canvas.height / sc.h));
    }
    const nl = this._packLights();
    gl.uniform1i(p.u.u_nLights, nl);
    gl.uniform4fv(p.u.u_lightPos, this.lightPos);
    gl.uniform4fv(p.u.u_lightCol, this.lightCol);

    const terrain = (toon && this.terrainSmooth) || this.terrain;
    if (terrain) {
      if (toon) gl.uniform1f(p.u.u_ground, 1);
      gl.bindVertexArray(terrain.vao);
      gl.vertexAttrib4f(3, 1, 0, 0, 0);
      gl.vertexAttrib4f(4, 0, 1, 0, 0);
      gl.vertexAttrib4f(5, 0, 0, 1, 0);
      gl.vertexAttrib4f(6, 0, 0, 0, 1);
      gl.vertexAttrib4f(7, 1, 1, 1, 0);
      gl.drawArrays(gl.TRIANGLES, 0, terrain.count);
      if (toon) gl.uniform1f(p.u.u_ground, 0);
    }
    for (const b of this.stat) b.draw();
    for (const b of this.dyn) { b.upload(); b.draw(); }

    // decals, particles (never written into the G-buffer, so VFX stay un-inked flat shapes)
    if (toon) gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    const q = (toon ? this.toonQuad : this.quad).use();
    gl.uniformMatrix4fv(q.u.u_vp, false, this.vp);
    gl.uniform3fv(q.u.u_camRight, this.camRight);
    gl.uniform3fv(q.u.u_camUp, this.camUp);
    gl.uniform3fv(q.u.u_camPos, this.camPos);
    gl.uniform3f(q.u.u_fog, env_.fogNear, env_.fogFar, 0);
    if (toon) {
      gl.uniform1f(q.u.u_fogOffset, fogOffset);
      gl.uniform3fv(q.u.u_inkCol, st.inkCol);
    }
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -8);
    gl.uniform1i(q.u.u_flat, 1);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.decals.draw();
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.uniform1i(q.u.u_flat, 0);
    this.alphaQuads.draw();
    // anime VFX are painted, not light: draw "additive" particles as opaque flat colour in toon styles
    if (toon) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    else gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this.addQuads.draw();
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.emptyVao);

    // ink outlines (toon only): reads colour + G-buffer, writes the inked frame
    let src = sc;
    if (toon) {
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      const ik = this.inked;
      gl.bindFramebuffer(gl.FRAMEBUFFER, ik.fb);
      gl.viewport(0, 0, ik.w, ik.h);
      const ip = this.ink.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sc.tex);
      gl.uniform1i(ip.u.u_color, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sc.gbuf);
      gl.uniform1i(ip.u.u_gbuf, 1);
      gl.uniform2f(ip.u.u_res, sc.w, sc.h);
      gl.uniform1f(ip.u.u_time, this.time);
      gl.uniform1f(ip.u.u_ink, st.ink);
      gl.uniform1f(ip.u.u_inkW, st.inkW);
      gl.uniform1f(ip.u.u_boil, st.boil);
      gl.uniform1f(ip.u.u_boilFps, st.boilFps);
      gl.uniform3fv(ip.u.u_inkCol, st.inkCol);
      gl.uniform1f(ip.u.u_crease, st.crease);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
      src = ik;
    }

    // bloom
    const bA = this.bloomA, bB = this.bloomB;
    gl.bindFramebuffer(gl.FRAMEBUFFER, bA.fb);
    gl.viewport(0, 0, bA.w, bA.h);
    const br = this.bright.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(br.u.u_tex, 0);
    gl.uniform1f(br.u.u_threshold, toon ? 0.82 : 0.7);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const bl = this.blur.use();
    gl.uniform1i(bl.u.u_tex, 0);
    for (let pass = 0; pass < 2; pass++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, bB.fb);
      gl.bindTexture(gl.TEXTURE_2D, bA.tex);
      gl.uniform2f(bl.u.u_dir, (1 + pass) / bA.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bA.fb);
      gl.bindTexture(gl.TEXTURE_2D, bB.tex);
      gl.uniform2f(bl.u.u_dir, 0, (1 + pass) / bA.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const pp = this.post_;
    const po = (toon ? this.toonPost : this.post).use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(po.u.u_scene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bA.tex);
    gl.uniform1i(po.u.u_bloom, 1);
    gl.uniform2f(po.u.u_res, sc.w, sc.h);
    gl.uniform1f(po.u.u_time, this.time);
    gl.uniform1f(po.u.u_damage, pp.damage);
    gl.uniform1f(po.u.u_desat, pp.desat);
    gl.uniform1f(po.u.u_fade, pp.fade);
    gl.uniform3fv(po.u.u_tint, pp.tint);
    if (toon) {
      gl.uniform1f(po.u.u_bloomAmt, st.bloom);
      gl.uniform1f(po.u.u_paper, st.paper);
      gl.uniform1f(po.u.u_mono, st.mono);
      gl.uniform1f(po.u.u_sat, st.sat);
      gl.uniform3fv(po.u.u_warm, st.warm);
      gl.uniform1f(po.u.u_impact, pp.impact);
      gl.uniform1f(po.u.u_speed, pp.speed);
      gl.uniform3fv(po.u.u_inkCol, st.inkCol);
    } else {
      gl.uniform1f(po.u.u_aberr, pp.aberr);
      gl.uniform1f(po.u.u_levels, this.levels);
      gl.uniform1f(po.u.u_bloomAmt, pp.bloom);
      gl.uniform1f(po.u.u_warp, pp.warp);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
