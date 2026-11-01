// Seeded 2D value/gradient noise + fBm for terrain generation.
import { RNG } from './rng.js';

export class Noise2D {
  constructor(seed) {
    const rng = new RNG(seed);
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    this.gx = new Float32Array(256);
    this.gy = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const a = rng.next() * Math.PI * 2;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }

  /** Gradient noise in roughly [-1, 1]. */
  noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const p = this.perm;
    const g00 = p[X + p[Y]], g10 = p[X + 1 + p[Y]], g01 = p[X + p[Y + 1]], g11 = p[X + 1 + p[Y + 1]];
    const d00 = this.gx[g00] * xf + this.gy[g00] * yf;
    const d10 = this.gx[g10] * (xf - 1) + this.gy[g10] * yf;
    const d01 = this.gx[g01] * xf + this.gy[g01] * (yf - 1);
    const d11 = this.gx[g11] * (xf - 1) + this.gy[g11] * (yf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = d00 + (d10 - d00) * u;
    const b = d01 + (d11 - d01) * u;
    return (a + (b - a) * v) * 1.414;
  }

  fbm(x, y, octaves = 5, lac = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise(x * freq, y * freq) * amp;
      norm += amp;
      amp *= gain;
      freq *= lac;
    }
    return sum / norm;
  }

  ridge(x, y, octaves = 4) {
    let amp = 0.5, freq = 1, sum = 0;
    for (let i = 0; i < octaves; i++) {
      const n = 1 - Math.abs(this.noise(x * freq, y * freq));
      sum += n * n * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  }
}
