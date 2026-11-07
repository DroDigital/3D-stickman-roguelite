// Small, allocation-light math helpers. Matrices are column-major Float32Array(16).

export const PI = Math.PI;
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeIn = (t) => t * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);

export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > PI) d -= TAU;
  if (d < -PI) d += TAU;
  return d;
}

export function dampAngle(a, b, lambda, dt) {
  return a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));
}

export function len2(x, z) { return Math.sqrt(x * x + z * z); }
export function len3(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }

export function mat4Ortho(out, halfW, halfH, near, far) {
  out.fill(0);
  out[0] = 1 / halfW;
  out[5] = 1 / halfH;
  out[10] = -2 / (far - near);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}

export function mat4Perspective(out, fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function mat4LookAt(out, ex, ey, ez, cx, cy, cz, ux = 0, uy = 1, uz = 0) {
  let zx = ex - cx, zy = ey - cy, zz = ez - cz;
  let l = 1 / (Math.hypot(zx, zy, zz) || 1);
  zx *= l; zy *= l; zz *= l;
  let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
  l = 1 / (Math.hypot(xx, xy, xz) || 1);
  xx *= l; xy *= l; xz *= l;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
  out[15] = 1;
  return out;
}

export function mat4Mul(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

/** Project world point with a view-projection matrix. Returns false if behind camera. */
export function project(vp, x, y, z, w, h, out) {
  const cx = vp[0] * x + vp[4] * y + vp[8] * z + vp[12];
  const cy = vp[1] * x + vp[5] * y + vp[9] * z + vp[13];
  const cw = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
  if (cw <= 0.01) return false;
  out[0] = (cx / cw * 0.5 + 0.5) * w;
  out[1] = (1 - (cy / cw * 0.5 + 0.5)) * h;
  out[2] = cw;
  return true;
}

/** Rotate vector (x,y,z) by yaw(Y) * pitch(X) * roll(Z). Writes into out[o..o+2]. */
export function rotYXZ(out, o, x, y, z, yaw, pitch, roll) {
  // roll about Z
  let c = Math.cos(roll), s = Math.sin(roll);
  let x1 = x * c - y * s, y1 = x * s + y * c, z1 = z;
  // pitch about X
  c = Math.cos(pitch); s = Math.sin(pitch);
  const y2 = y1 * c - z1 * s, z2 = y1 * s + z1 * c;
  // yaw about Y
  c = Math.cos(yaw); s = Math.sin(yaw);
  out[o] = x1 * c + z2 * s;
  out[o + 1] = y2;
  out[o + 2] = -x1 * s + z2 * c;
}

/** Writes a TRS matrix (yaw/pitch/roll as above) into out at offset o. */
export function writeTRS(out, o, px, py, pz, yaw, pitch, roll, sx, sy, sz) {
  const cy = Math.cos(yaw), sy_ = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  // R = Ry * Rx * Rz ; columns are R*e_i
  // Rz*e_x = (cr, sr, 0) ; Rx -> (cr, sr*cp, sr*sp) ; Ry -> (cr*cy + sr*sp*sy, sr*cp, -cr*sy + sr*sp*cy)
  out[o] = (cr * cy + sr * sp * sy_) * sx;
  out[o + 1] = sr * cp * sx;
  out[o + 2] = (-cr * sy_ + sr * sp * cy) * sx;
  out[o + 3] = 0;
  // Rz*e_y = (-sr, cr, 0) ; Rx -> (-sr, cr*cp, cr*sp) ; Ry -> (-sr*cy + cr*sp*sy, cr*cp, sr*sy + cr*sp*cy)
  out[o + 4] = (-sr * cy + cr * sp * sy_) * sy;
  out[o + 5] = cr * cp * sy;
  out[o + 6] = (sr * sy_ + cr * sp * cy) * sy;
  out[o + 7] = 0;
  // e_z -> Rx -> (0, -sp, cp) ; Ry -> (cp*sy, -sp, cp*cy)
  out[o + 8] = cp * sy_ * sz;
  out[o + 9] = -sp * sz;
  out[o + 10] = cp * cy * sz;
  out[o + 11] = 0;
  out[o + 12] = px; out[o + 13] = py; out[o + 14] = pz; out[o + 15] = 1;
}

/**
 * Writes a matrix mapping the unit cylinder (radius 1, y in [0,1]) onto the segment a->b with radius r.
 */
export function writeSegment(out, o, ax, ay, az, bx, by, bz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
  const nx = dx / L, ny = dy / L, nz = dz / L;
  // pick a helper axis not parallel to n
  let hx = 0, hy = 1, hz = 0;
  if (Math.abs(ny) > 0.9) { hx = 1; hy = 0; }
  // X = normalize(cross(h, n))
  let xx = hy * nz - hz * ny, xy = hz * nx - hx * nz, xz = hx * ny - hy * nx;
  const xl = 1 / Math.sqrt(xx * xx + xy * xy + xz * xz);
  xx *= xl; xy *= xl; xz *= xl;
  // Z = cross(n, X)
  const zx = ny * xz - nz * xy, zy = nz * xx - nx * xz, zz = nx * xy - ny * xx;
  out[o] = xx * r; out[o + 1] = xy * r; out[o + 2] = xz * r; out[o + 3] = 0;
  out[o + 4] = dx; out[o + 5] = dy; out[o + 6] = dz; out[o + 7] = 0;
  out[o + 8] = zx * r; out[o + 9] = zy * r; out[o + 10] = zz * r; out[o + 11] = 0;
  out[o + 12] = ax; out[o + 13] = ay; out[o + 14] = az; out[o + 15] = 1;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function mixRgb(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/** General 4x4 inverse (column-major). Returns null if singular. */
export function mat4Invert(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}
