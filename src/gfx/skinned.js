// Skinned mannequin (Quaternius Universal Animation Library mesh, CC0) driven by the game's procedural skeleton.
// Each frame the expanded 28-joint skeleton (see game/anatomy.js) is retargeted onto the mannequin's 53 bones with
// aim constraints: every deforming bone points from its target head to its target tail, twists to match a
// reference axis (hinge axes for elbows and knees, the torso's left for the spine), and stretches along its length
// so hands and feet land exactly where gameplay put them. Fingers follow the hand, curled into a grip.

const MAX_CHARS = 96;

// ---- tiny column-major mat4 helpers (bind-time only; the per-frame path writes straight into the texture data)
function m4() { return new Float32Array(16); }
function mul(o, a, b) {
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function trs(t, q, s) {
  const [x, y, z, w] = q, o = m4();
  o[0] = (1 - 2 * (y * y + z * z)) * s[0]; o[1] = 2 * (x * y + z * w) * s[0]; o[2] = 2 * (x * z - y * w) * s[0];
  o[4] = 2 * (x * y - z * w) * s[1]; o[5] = (1 - 2 * (x * x + z * z)) * s[1]; o[6] = 2 * (y * z + x * w) * s[1];
  o[8] = 2 * (x * z + y * w) * s[2]; o[9] = 2 * (y * z - x * w) * s[2]; o[10] = (1 - 2 * (x * x + y * y)) * s[2];
  o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
  return o;
}
function rotX(a) { const o = m4(); const c = Math.cos(a), s = Math.sin(a); o[0] = 1; o[5] = c; o[6] = s; o[9] = -s; o[10] = c; o[15] = 1; return o; }
function rotZ(a) { const o = m4(); const c = Math.cos(a), s = Math.sin(a); o[0] = c; o[1] = s; o[4] = -s; o[5] = c; o[10] = 1; o[15] = 1; return o; }
function invRigid(o, m) {
  // inverse of rotation*scale+translation with orthogonal (possibly scaled) axes
  const sx = m[0] * m[0] + m[1] * m[1] + m[2] * m[2], sy = m[4] * m[4] + m[5] * m[5] + m[6] * m[6], sz = m[8] * m[8] + m[9] * m[9] + m[10] * m[10];
  o[0] = m[0] / sx; o[4] = m[1] / sx; o[8] = m[2] / sx;
  o[1] = m[4] / sy; o[5] = m[5] / sy; o[9] = m[6] / sy;
  o[2] = m[8] / sz; o[6] = m[9] / sz; o[10] = m[10] / sz;
  o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1;
  o[12] = -(o[0] * m[12] + o[4] * m[13] + o[8] * m[14]);
  o[13] = -(o[1] * m[12] + o[5] * m[13] + o[9] * m[14]);
  o[14] = -(o[2] * m[12] + o[6] * m[13] + o[10] * m[14]);
  return o;
}

// ---- vector helpers on plain arrays
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Point at fraction t (0..1) along a polyline by arc length. */
function along(pts, t) {
  let total = 0;
  const seg = [];
  for (let i = 1; i < pts.length; i++) { const l = len(sub(pts[i], pts[i - 1])); seg.push(l); total += l; }
  let d = t * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) return lerp(pts[i], pts[i + 1], Math.min(1, d / (seg[i] || 1)));
    d -= seg[i];
  }
  return pts[pts.length - 1];
}

export class Mannequin {
  /** @param {WebGL2RenderingContext} gl @param {{meta, bin}} model */
  constructor(gl, model) {
    this.gl = gl;
    const { meta, bin } = model;
    this.meta = meta;
    const nodes = meta.nodes;
    this.names = meta.joints.map((j) => nodes[j].name);
    this.nJ = meta.joints.length;
    const idx = (n) => this.names.indexOf(n);
    this.J = {};
    this.names.forEach((n, i) => { this.J[n.replace('DEF-', '')] = i; });

    // bind pose: world = inverse(IBM)
    const ibm = new Float32Array(bin, meta.ibm, this.nJ * 16);
    this.ibm = [];
    this.bind = [];
    for (let j = 0; j < this.nJ; j++) {
      const m = ibm.slice(j * 16, j * 16 + 16);
      this.ibm.push(m);
      this.bind.push(invRigid(m4(), m));
    }
    // character-space bind positions of key landmarks
    this.bindPos = (n) => { const m = this.bind[this.J[n]]; return [m[12], m[13], m[14]]; };
    const B = this.bindPos;
    const pel = B('hips'), neck = B('neck'), s1 = B('spine.001'), s2 = B('spine.002'), s3 = B('spine.003');
    const spineLen = len(sub(s1, pel)) + len(sub(s2, s1)) + len(sub(s3, s2)) + len(sub(neck, s3));
    this.spineFrac = [len(sub(s1, pel)) / spineLen, (len(sub(s1, pel)) + len(sub(s2, s1))) / spineLen, (len(sub(s1, pel)) + len(sub(s2, s1)) + len(sub(s3, s2))) / spineLen];
    this.boneLen = {};
    for (const [a, b] of [['upper_arm.L', 'forearm.L'], ['forearm.L', 'hand.L'], ['upper_arm.R', 'forearm.R'], ['forearm.R', 'hand.R'], ['thigh.L', 'shin.L'], ['shin.L', 'foot.L'], ['thigh.R', 'shin.R'], ['shin.R', 'foot.R'], ['hips', 'spine.001'], ['spine.001', 'spine.002'], ['spine.002', 'spine.003'], ['spine.003', 'neck'], ['neck', 'head'], ['shoulder.L', 'upper_arm.L'], ['shoulder.R', 'upper_arm.R'], ['foot.L', 'toe.L'], ['foot.R', 'toe.R']]) {
      this.boneLen[a] = len(sub(B(b), B(a)));
    }
    this.boneLen['hand.L'] = 0.09; this.boneLen['hand.R'] = 0.09; this.boneLen['head'] = 0.22;

    // rigid followers: fingers (curled into a grip) follow the hand; toes follow the foot; anything unmapped
    // follows the hips. offset = inverse(bind parent) * curled bind child
    const local = nodes.map((n) => trs(n.t, n.r, n.s));
    const parent = {};
    nodes.forEach((n, i) => n.children.forEach((c) => { parent[c] = i; }));
    const nodeOfJoint = meta.joints;
    const jointOfNode = {};
    nodeOfJoint.forEach((n, j) => { jointOfNode[n] = j; });
    this.followers = [];
    for (const grip of [0, 1]) {
      // world bind with finger curl (grip 1) via FK from the node rest pose
      const W = [];
      const world = (n) => {
        if (W[n]) return W[n];
        let l = local[n];
        const name = nodes[n].name;
        if (grip && /f_(index|middle|ring|pinky)/.test(name)) l = mul(m4(), l, rotX(/\.01\./.test(name) ? 1.1 : 0.95));
        if (grip && /thumb\.0[23]/.test(name)) l = mul(m4(), l, rotZ(name.endsWith('.L') ? -0.5 : 0.5));
        W[n] = parent[n] !== undefined ? mul(m4(), world(parent[n]), l) : l;
        return W[n];
      };
      const list = [];
      for (let j = 0; j < this.nJ; j++) {
        const name = this.names[j];
        let anchor = null;
        if (/f_|thumb/.test(name)) anchor = name.endsWith('.L') ? 'hand.L' : 'hand.R';
        else if (/toe/.test(name)) anchor = name.endsWith('.L') ? 'foot.L' : 'foot.R';
        if (!anchor) continue;
        // node-FK bind of the anchor and the (curled) child, mapped through the IBM-derived bind for safety
        const aJ = this.J[anchor];
        const aW = world(nodeOfJoint[aJ]);
        const cW = world(nodeOfJoint[j]);
        const off = mul(m4(), invRigid(m4(), aW), cW);
        list.push({ j, a: aJ, off });
      }
      this.followers.push(list);
    }
    this.rootJ = idx('DEF-hips');
    // bind X axis of each bone in the bind character frame (+X left, +Y up, +Z forward)
    this.bindX = this.bind.map((m) => nrm([m[0], m[1], m[2]]));
    // ankle height above the sole and the foot bone's downward pitch
    const footB = this.bind[this.J['foot.L']];
    this.ankleLift = Math.max(0, footB[13] - 0.05);
    const fyb = nrm([footB[4], footB[5], footB[6]]);
    this.footPitch = [Math.hypot(fyb[0], fyb[2]), -fyb[1]];
    // joints the retarget never sets directly (the armature root) ride along with the hips
    const mapped = new Set(['hips', 'spine.001', 'spine.002', 'spine.003', 'neck', 'head', 'shoulder.L', 'shoulder.R', 'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R', 'hand.L', 'hand.R', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R'].map((n) => this.J[n]));
    for (const f of this.followers[0]) mapped.add(f.j);
    this.unmapped = this.names.map((n, j) => (mapped.has(j) ? null : mul(m4(), invRigid(m4(), this.bind[this.rootJ]), this.bind[j])));

    // ---- GPU buffers
    this.parts = meta.parts.map((p) => {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const mk = (arr, loc, size, type, norm = false) => {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, type, norm, 0, 0);
        return b;
      };
      mk(new Float32Array(bin, p.pos, p.count * 3), 0, 3, gl.FLOAT);
      mk(new Float32Array(bin, p.nrm, p.count * 3), 1, 3, gl.FLOAT);
      mk(new Uint8Array(bin, p.jnt, p.count * 4), 2, 4, gl.UNSIGNED_BYTE);
      mk(new Float32Array(bin, p.wgt, p.count * 4), 3, 4, gl.FLOAT);
      for (let i = 4; i < 9; i++) gl.disableVertexAttribArray(i);
      const ib = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(bin, p.idx, p.indices), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, count: p.indices, joints: p.material === 'M_Joints' };
    });
    this.texW = this.nJ * 4;
    this.data = new Float32Array(this.texW * MAX_CHARS * 4);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.texW, MAX_CHARS, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.queue = [];
    this._W = Array.from({ length: this.nJ }, () => m4());
    this._tmp = m4();
  }

  beginFrame() { this.queue.length = 0; }

  /**
   * Queue a mannequin posed on the expanded skeleton `sk` (world space, from anatomy.expandSkeleton + feet).
   * look: { main, joint: rgb, mainEmis, jointEmis, mainMat, jointMat, rough, metal, girth, grip }
   */
  add(sk, look) {
    if (this.queue.length >= MAX_CHARS) return false;
    const row = this.queue.length;
    this._pose(sk, look, row);
    this.queue.push({ row, look });
    return true;
  }

  _setBone(j, head, yAxis, ref, stretch, girth) {
    const W = this._W[j];
    const Y = nrm(yAxis);
    let X = sub(ref, scl(Y, dot(ref, Y)));
    const xl = len(X);
    X = xl > 1e-5 ? scl(X, 1 / xl) : nrm(crs(Y, [0, 0, 1]));
    const Z = crs(X, Y);
    // target world = [X*g | Y*stretch | Z*g | head] ; bone rotation relative to bind is folded in by the IBM
    const bind = this.bind[j];
    // bind axes (unit) of this bone
    const bx = nrm([bind[0], bind[1], bind[2]]), by = nrm([bind[4], bind[5], bind[6]]), bz = nrm([bind[8], bind[9], bind[10]]);
    // rotation R maps bind axes -> target axes; world = R * bind, with stretch along the bone's own Y
    // W columns = target axes scaled, translation = head
    W[0] = X[0] * girth; W[1] = X[1] * girth; W[2] = X[2] * girth; W[3] = 0;
    W[4] = Y[0] * stretch; W[5] = Y[1] * stretch; W[6] = Y[2] * stretch; W[7] = 0;
    W[8] = Z[0] * girth; W[9] = Z[1] * girth; W[10] = Z[2] * girth; W[11] = 0;
    W[12] = head[0]; W[13] = head[1]; W[14] = head[2]; W[15] = 1;
    // W must express the bone frame in world; bind frame columns are (bx, by, bz). Since the skin matrix is
    // W * IBM and IBM already removes the bind frame, W is exactly the bone's new world frame.
    void bx; void by; void bz;
  }

  _pose(sk, look, row) {
    const g = look.girth || 1;
    const P = (k) => sk[k];
    const left = nrm(sub(P('LHIP'), P('RHIP')));
    const leftS = nrm(sub(P('LSH'), P('RSH')));
    const J = this.J;
    // ---- spine: PELVIS -> LUMBAR -> THORAX -> CHEST -> NECK resampled at the mannequin's own proportions
    const chain = [P('PELVIS'), P('LUMBAR'), P('THORAX'), P('CHEST'), P('NECK')];
    const sp = [chain[0], along(chain, this.spineFrac[0]), along(chain, this.spineFrac[1]), along(chain, this.spineFrac[2]), chain[4]];
    const names = ['hips', 'spine.001', 'spine.002', 'spine.003'];
    for (let i = 0; i < 4; i++) {
      const ref = nrm(lerp(left, leftS, i / 3));
      const L = len(sub(sp[i + 1], sp[i]));
      this._setBone(J[names[i]], sp[i], sub(sp[i + 1], sp[i]), ref, L / this.boneLen[names[i]], g * (i === 0 ? 1.0 : 1));
    }
    // neck + head
    const headUp = sk.hUp, headLeft = scl(sk.hR, -1);
    const nk = P('NECK');
    const nTail = lerp(nk, P('HEAD'), 0.32);
    this._setBone(J.neck, nk, sub(nTail, nk), headLeft, len(sub(nTail, nk)) / this.boneLen.neck, g);
    this._setBone(J.head, nTail, headUp, headLeft, (look.headScale || 1), (look.headScale || 1) * g);
    // ---- arms
    for (const S of ['L', 'R']) {
      const sh = P(S + 'SH'), el = P(S + 'EL'), wr = P(S + 'WRIST'), tip = P(S + 'TIP');
      const cl = P(S + 'CLAV');
      const ua = sub(el, sh), fa = sub(wr, el);
      let hinge = crs(ua, fa);
      const hl = len(hinge);
      // straight arm: assume the elbow would bend forward
      const fb = nrm(crs(ua, sk.Ft));
      hinge = hl > 0.004 ? nrm(lerp(scl(hinge, 1 / hl), fb, Math.max(0, 1 - hl / (len(ua) * len(fa) * 0.25)))) : fb;
      const sfx = '.' + S;
      const bx = this.bindX[J['shoulder' + sfx]];
      const sref = add(add(scl(leftS, bx[0]), scl(sk.T, bx[1])), scl(sk.Ft, bx[2]));
      this._setBone(J['shoulder' + sfx], cl, sub(sh, cl), sref, len(sub(sh, cl)) / this.boneLen['shoulder' + sfx], g);
      this._setBone(J['upper_arm' + sfx], sh, ua, hinge, len(ua) / this.boneLen['upper_arm' + sfx], g);
      this._setBone(J['forearm' + sfx], el, fa, hinge, len(fa) / this.boneLen['forearm' + sfx], g);
      this._setBone(J['hand' + sfx], wr, sub(tip, wr), hinge, 1, g);
    }
    // ---- legs
    for (const S of ['L', 'R']) {
      const hip = P(S + 'HIP'), kn = P(S + 'KN'), toe = P(S + 'TOE');
      // the mannequin's ankle sits higher above its sole than the procedural one
      const an = add(P(S + 'ANKLE'), [0, this.ankleLift * g, 0]);
      const th = sub(kn, hip), sh = sub(an, kn);
      let hinge = crs(th, sh);
      const hl = len(hinge);
      // straight leg: assume the knee would bend forward (shin back)
      const fb = nrm(crs(th, scl(sk.Fh, -1)));
      hinge = hl > 0.004 ? nrm(lerp(scl(hinge, 1 / hl), fb, Math.max(0, 1 - hl / (len(th) * len(sh) * 0.25)))) : fb;
      const sfx = '.' + S;
      this._setBone(J['thigh' + sfx], hip, th, hinge, len(th) / this.boneLen['thigh' + sfx], g);
      this._setBone(J['shin' + sfx], kn, sh, hinge, len(sh) / this.boneLen['shin' + sfx], g);
      // the foot bone runs ankle -> ball, pitched down like the bind pose
      const fd = nrm(sub(toe, P(S + 'ANKLE')));
      const fy = nrm([fd[0] * this.footPitch[0], fd[1] * this.footPitch[0] - this.footPitch[1], fd[2] * this.footPitch[0]]);
      this._setBone(J['foot' + sfx], an, fy, left, 1, g);
    }
    // ---- followers (fingers, toes)
    for (const f of this.followers[look.grip === 0 ? 0 : 1]) mul(this._W[f.j], this._W[f.a], f.off);
    // ---- write skin matrices (W * IBM) into this character's texture row
    const base = row * this.texW * 4;
    const d = this.data, t = this._tmp;
    for (let j = 0; j < this.nJ; j++) {
      const W = this._W[j];
      if (this.unmapped[j]) mul(W, this._W[this.rootJ], this.unmapped[j]);
      mul(t, W, this.ibm[j]);
      d.set(t, base + j * 16);
    }
  }

  upload() {
    const n = this.queue.length;
    if (!n) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.texW, n, gl.RGBA, gl.FLOAT, this.data, 0);
  }

  /** Draw every queued character with program `p` (lit or shadow). `perPart(p, look, part)` sets material uniforms. */
  draw(p, unit, perPart) {
    const gl = this.gl;
    if (!this.queue.length) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(p.u.u_bones, unit);
    for (const q of this.queue) {
      gl.uniform1f(p.u.u_row, q.row);
      for (const part of this.parts) {
        if (perPart) perPart(p, q.look, part);
        gl.bindVertexArray(part.vao);
        gl.drawElements(gl.TRIANGLES, part.count, gl.UNSIGNED_SHORT, 0);
      }
    }
    gl.bindVertexArray(null);
  }
}
