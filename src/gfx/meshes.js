// Procedural low-poly primitive geometry. Interleaved [pos3, nrm3, col3] non-indexed triangles.

function pushTri(out, a, b, c, flat = true, na, nb, nc, col = [1, 1, 1]) {
  let n0 = na, n1 = nb, n2 = nc;
  if (flat) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    n0 = n1 = n2 = [nx, ny, nz];
  }
  out.push(a[0], a[1], a[2], n0[0], n0[1], n0[2], col[0], col[1], col[2]);
  out.push(b[0], b[1], b[2], n1[0], n1[1], n1[2], col[0], col[1], col[2]);
  out.push(c[0], c[1], c[2], n2[0], n2[1], n2[2], col[0], col[1], col[2]);
}

/** Orders the triangle so its face normal points away from center (cx,cy,cz). */
function pushTriOut(out, a, b, c, center, flat = true) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const mx = (a[0] + b[0] + c[0]) / 3 - center[0];
  const my = (a[1] + b[1] + c[1]) / 3 - center[1];
  const mz = (a[2] + b[2] + c[2]) / 3 - center[2];
  if (nx * mx + ny * my + nz * mz < 0) pushTri(out, a, c, b, flat, a, c, b);
  else pushTri(out, a, b, c, flat, a, b, c);
}

export function boxMesh() {
  const o = [];
  const v = (x, y, z) => [x - 0.5, y - 0.5, z - 0.5];
  const quads = [
    [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(1, 0, 0), v(0, 0, 0), v(0, 1, 0), v(1, 1, 0)],
    [v(1, 0, 1), v(1, 0, 0), v(1, 1, 0), v(1, 1, 1)],
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)],
    [v(0, 1, 1), v(1, 1, 1), v(1, 1, 0), v(0, 1, 0)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)],
  ];
  for (const q of quads) {
    pushTri(o, q[0], q[1], q[2]);
    pushTri(o, q[0], q[2], q[3]);
  }
  return new Float32Array(o);
}

export function icoSphereMesh(subdiv = 1, flat = true) {
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => { const l = Math.hypot(...p); return p.map((c) => c / l); });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map();
    const mid = (a, b) => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (cache.has(k)) return cache.get(k);
      const p = verts[a].map((c, i) => (c + verts[b][i]) / 2);
      const l = Math.hypot(...p);
      verts.push(p.map((c) => c / l));
      cache.set(k, verts.length - 1);
      return verts.length - 1;
    };
    const nf = [];
    for (const [a, b, c] of faces) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nf;
  }
  const o = [];
  for (const [a, b, c] of faces) pushTriOut(o, verts[a], verts[b], verts[c], [0, 0, 0], flat);
  return new Float32Array(o);
}

/** Unit cylinder: radius 1 around Y, from y=0 to y=1. Smooth sides. */
export function cylinderMesh(sides = 8, caps = true) {
  const o = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    const p00 = [c0, 0, s0], p10 = [c1, 0, s1], p01 = [c0, 1, s0], p11 = [c1, 1, s1];
    const n0 = [c0, 0, s0], n1 = [c1, 0, s1];
    pushTri(o, p00, p01, p11, false, n0, n0, n1);
    pushTri(o, p00, p11, p10, false, n0, n1, n1);
    if (!caps) continue;
    pushTri(o, [0, 1, 0], p11, p01, false, [0, 1, 0], [0, 1, 0], [0, 1, 0]);
    pushTri(o, [0, 0, 0], p00, p10, false, [0, -1, 0], [0, -1, 0], [0, -1, 0]);
  }
  return new Float32Array(o);
}

/** Cone: base radius 1 at y=0, apex at y=1. */
export function coneMesh(sides = 7) {
  const o = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const p0 = [Math.cos(a0), 0, Math.sin(a0)], p1 = [Math.cos(a1), 0, Math.sin(a1)];
    pushTriOut(o, p0, [0, 1, 0], p1, [0, 0.33, 0]);
    pushTriOut(o, [0, 0, 0], p0, p1, [0, 0.33, 0]);
  }
  return new Float32Array(o);
}

/** Octahedron with unit extents: great for crystals, blades and gems. */
export function octaMesh() {
  const o = [];
  const P = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const F = [[2, 4, 0], [2, 1, 4], [2, 5, 1], [2, 0, 5], [3, 0, 4], [3, 4, 1], [3, 1, 5], [3, 5, 0]];
  for (const [a, b, c] of F) pushTriOut(o, P[a], P[b], P[c], [0, 0, 0]);
  return new Float32Array(o);
}

/**
 * Height-field terrain mesh. Default: flat shaded, one colour per triangle (retro facets).
 * `smooth`: shared per-vertex colours and normals, so colour washes blend across triangles (painted toon ground).
 */
/**
 * Terrain grid. `smooth` builds the painted mesh with per-vertex normals; `glowFn(x, z)` (optional, 0..1) is stored
 * as extra normal length on that mesh (shaders normalise normals, so only the cinematic look reads it back as the
 * strength of glowing veins).
 */
export function terrainMesh(n, size, heightFn, colorFn, smooth = false, glowFn = null) {
  const step = size / n;
  const half = size / 2;
  const H = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) H[j * (n + 1) + i] = heightFn(i * step - half, j * step - half);
  }
  const data = new Float32Array(n * n * 6 * 9);
  let k = 0;
  if (smooth) {
    const w = n + 1;
    const N = new Float32Array(w * w * 3), C = new Float32Array(w * w * 3);
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const hx = H[j * w + Math.min(i + 1, n)] - H[j * w + Math.max(i - 1, 0)];
        const hz = H[Math.min(j + 1, n) * w + i] - H[Math.max(j - 1, 0) * w + i];
        const sx = (Math.min(i + 1, n) - Math.max(i - 1, 0)) * step, sz = (Math.min(j + 1, n) - Math.max(j - 1, 0)) * step;
        let nx = -hx / sx, ny = 1, nz = -hz / sz;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        const v = (j * w + i) * 3;
        const gk = glowFn ? 1 + glowFn(i * step - half, j * step - half) : 1;
        N[v] = nx * gk; N[v + 1] = ny * gk; N[v + 2] = nz * gk;
        const c = colorFn(i * step - half, H[j * w + i], j * step - half, ny);
        C[v] = c[0]; C[v + 1] = c[1]; C[v + 2] = c[2];
      }
    }
    const vert = (i, j) => {
      const v = (j * w + i) * 3;
      data[k++] = i * step - half; data[k++] = H[j * w + i]; data[k++] = j * step - half;
      data[k++] = N[v]; data[k++] = N[v + 1]; data[k++] = N[v + 2];
      data[k++] = C[v]; data[k++] = C[v + 1]; data[k++] = C[v + 2];
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        vert(i, j); vert(i, j + 1); vert(i + 1, j + 1);
        vert(i, j); vert(i + 1, j + 1); vert(i + 1, j);
      }
    }
    return { data, heights: H, n, size, step };
  }
  const put = (x, y, z, nx, ny, nz, c) => {
    data[k++] = x; data[k++] = y; data[k++] = z;
    data[k++] = nx; data[k++] = ny; data[k++] = nz;
    data[k++] = c[0]; data[k++] = c[1]; data[k++] = c[2];
  };
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const c = colorFn((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3, ny);
    put(ax, ay, az, nx, ny, nz, c);
    put(bx, by, bz, nx, ny, nz, c);
    put(cx, cy, cz, nx, ny, nz, c);
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = i * step - half, z0 = j * step - half, x1 = x0 + step, z1 = z0 + step;
      const h00 = H[j * (n + 1) + i], h10 = H[j * (n + 1) + i + 1];
      const h01 = H[(j + 1) * (n + 1) + i], h11 = H[(j + 1) * (n + 1) + i + 1];
      // counter-clockwise when viewed from above (+Y)
      tri(x0, h00, z0, x0, h01, z1, x1, h11, z1);
      tri(x0, h00, z0, x1, h11, z1, x1, h10, z0);
    }
  }
  return { data, heights: H, n, size, step };
}

/**
 * Foliage tuft meshes in unit space: y runs 0..1 up the blade, col.r carries that 0..1 parameter so the shader
 * can taper colour and bend only the upper part. Kinds: grass, kelp, crystal, cilia.
 */
export function foliageMesh(kind) {
  const out = [];
  const v = (x, y, z, t) => out.push(x, y, z, 0, 1, 0, t, 0, 0);
  const blade = (yaw, w, segs, lean, wave = 0, tipW = 0) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (t, side) => {
      const ww = (w * (1 - t) + tipW * t) * side;
      const off = lean * t * t + Math.sin(t * 6) * wave * t;
      return [ww * c + off * s, t, -ww * s + off * c];
    };
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const a = P(t0, -1), b = P(t0, 1), d = P(t1, -1), e = P(t1, 1);
      v(...a, t0); v(...b, t0); v(...e, t1);
      if (i < segs - 1 || tipW > 0) { v(...a, t0); v(...e, t1); v(...d, t1); }
    }
  };
  if (kind === 'kelp') {
    blade(0.3, 0.12, 6, 0.15, 0.06, 0.03);
    blade(2.2, 0.1, 5, -0.2, 0.05, 0.02);
  } else if (kind === 'crystal') {
    for (let i = 0; i < 3; i++) { blade(i * 2.1, 0.09, 2, 0.12 * (i - 1), 0, 0); blade(i * 2.1 + 1.57, 0.09, 2, 0.12 * (i - 1), 0, 0); }
  } else if (kind === 'cilia') {
    for (let i = 0; i < 4; i++) blade(i * 1.6, 0.045, 4, 0.35 * Math.sin(i * 2), 0.02, 0.02);
  } else {
    for (let i = 0; i < 4; i++) blade(i * 1.57 + 0.3, 0.055, 3, 0.28 * (i % 2 ? 1 : -0.7));
  }
  return new Float32Array(out);
}
