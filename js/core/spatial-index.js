export class SpatialIndex {
  constructor(cellSize = 8) {
    this.cellSize = Math.max(0.25, Number(cellSize) || 8);
    this.buckets = new Map();
    this.size = 0;
    // Reused by nearest() so a plain proximity check doesn't allocate a fresh array every
    // call — with hundreds of creatures each polling for mates/prey/threats several times a
    // second, that was thousands of throwaway arrays per second and real GC pressure.
    this._nearestScratch = [];
  }

  _cell(value) {
    return Math.floor(value / this.cellSize);
  }

  clear() {
    this.buckets.clear();
    this.size = 0;
  }

  insert(item) {
    if (!item || !Number.isFinite(item.x) || !Number.isFinite(item.z)) return false;
    const cx = this._cell(item.x), cz = this._cell(item.z);
    let column = this.buckets.get(cx);
    if (!column) {
      column = new Map();
      this.buckets.set(cx, column);
    }
    let bucket = column.get(cz);
    if (!bucket) {
      bucket = [];
      column.set(cz, bucket);
    }
    bucket.push(item);
    this.size++;
    return true;
  }

  rebuild(items, predicate = null) {
    this.clear();
    for (const item of items || []) {
      if (!predicate || predicate(item)) this.insert(item);
    }
    return this;
  }

  queryRadius(x, z, radius, predicate = null, out = []) {
    out.length = 0;
    const r = Math.max(0, Number(radius) || 0);
    const radiusSq = r * r;
    // An infinite (or otherwise non-finite) radius used to compute an infinite cell range below —
    // Math.floor((x - Infinity) / cellSize) is -Infinity, and `for (let cx = -Infinity; cx <=
    // Infinity; cx++)` never terminates. A caller searching "anywhere on the map" (e.g. finding the
    // nearest human of any distance) is exactly the case that hit this live: it hung the whole tab.
    // Walking only the buckets that actually exist covers the same "search everywhere" intent
    // without ever computing an unbounded range.
    if (!Number.isFinite(r)) {
      for (const column of this.buckets.values()) for (const bucket of column.values()) {
        for (const item of bucket) {
          if (predicate && !predicate(item)) continue;
          out.push(item);
        }
      }
      return out;
    }
    const minX = this._cell(x - r), maxX = this._cell(x + r);
    const minZ = this._cell(z - r), maxZ = this._cell(z + r);
    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const bucket = this.buckets.get(cx)?.get(cz);
        if (!bucket) continue;
        for (const item of bucket) {
          if (predicate && !predicate(item)) continue;
          const dx = item.x - x, dz = item.z - z;
          if (dx * dx + dz * dz <= radiusSq) out.push(item);
        }
      }
    }
    return out;
  }

  nearest(x, z, radius, predicate = null) {
    const candidates = this.queryRadius(x, z, radius, predicate, this._nearestScratch);
    let best = null;
    let bestDistanceSq = radius * radius;
    for (const item of candidates) {
      const dx = item.x - x, dz = item.z - z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestDistanceSq) {
        best = item;
        bestDistanceSq = distanceSq;
      }
    }
    return best;
  }
}
