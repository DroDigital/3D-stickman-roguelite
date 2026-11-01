// Uniform-grid spatial hash for fast neighbour queries on the XZ plane.

export class SpatialHash {
  constructor(cellSize = 4) {
    this.cell = cellSize;
    this.inv = 1 / cellSize;
    this.map = new Map();
    this.pool = [];
  }

  clear() {
    for (const arr of this.map.values()) {
      arr.length = 0;
      this.pool.push(arr);
    }
    this.map.clear();
  }

  key(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }

  insert(obj, x, z) {
    const k = this.key(Math.floor(x * this.inv), Math.floor(z * this.inv));
    let arr = this.map.get(k);
    if (!arr) {
      arr = this.pool.pop() || [];
      this.map.set(k, arr);
    }
    arr.push(obj);
  }

  /** Calls fn(obj) for every object in cells overlapping the circle. */
  query(x, z, r, fn) {
    const inv = this.inv;
    const x0 = Math.floor((x - r) * inv), x1 = Math.floor((x + r) * inv);
    const z0 = Math.floor((z - r) * inv), z1 = Math.floor((z + r) * inv);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const arr = this.map.get(this.key(cx, cz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) fn(arr[i]);
      }
    }
  }
}
