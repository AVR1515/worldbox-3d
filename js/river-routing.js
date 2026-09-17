// Search the unmodified terrain. The carried surface can only descend, and a
// route may cross a small saddle but may never excavate a mountain to sea level.
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export const RIVER_DEPTH = 0.25;
export const MAX_RIVER_CUT = 1.6;

class MinHeap {
  items = [];
  push(node) {
    let i = this.items.length;
    this.items.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[p].cost <= node.cost) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = node;
  }
  pop() {
    const root = this.items[0], tail = this.items.pop();
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let c = i * 2 + 1;
        if (c + 1 < this.items.length && this.items[c + 1].cost < this.items[c].cost) c++;
        if (this.items[c].cost >= tail.cost) break;
        this.items[i] = this.items[c];
        i = c;
      }
      this.items[i] = tail;
    }
    return root;
  }
}

export function traceRiver(world, startX, startZ, sourceSurface, seaLevel, lakeRadius = 0) {
  if (!world.inBounds(startX, startZ)) return [];
  const costs = new Float64Array(world.n).fill(Infinity);
  const queue = new MinHeap();
  const start = world.idx(startX, startZ);
  costs[start] = 0;
  queue.push({ x: startX, z: startZ, surface: sourceSurface, cost: 0, parent: null });
  while (queue.items.length) {
    const node = queue.pop();
    if (node.cost !== costs[world.idx(node.x, node.z)]) continue;
    if (world.height[world.idx(node.x, node.z)] <= seaLevel) {
      const trail = [];
      for (let p = node; p; p = p.parent) trail.push([p.x, p.z, p.surface]);
      return trail.reverse();
    }
    for (const [dx, dz] of DIRECTIONS) {
      const x = node.x + dx, z = node.z + dz;
      if (!world.inBounds(x, z)) continue;
      const i = world.idx(x, z), h = world.height[i];
      const inLake = Math.hypot(x - startX, z - startZ) <= lakeRadius;
      const existingSurface = world.riverMask[i] ? world.riverHeight[i] : null;
      if (existingSurface !== null && existingSurface > node.surface + 1e-5) continue;
      const surface = inLake ? Math.min(node.surface, sourceSurface)
        : Math.max(seaLevel, Math.min(node.surface, existingSurface ?? h - 0.08));
      const cut = Math.max(0, h - (surface - RIVER_DEPTH));
      if (cut > MAX_RIVER_CUT) continue;
      const cost = node.cost + Math.hypot(dx, dz) + cut * cut * 12;
      if (cost >= costs[i]) continue;
      costs[i] = cost;
      queue.push({ x, z, surface, cost, parent: node });
    }
  }
  // An enclosed basin stays a lake; an incomplete path must not become a sea inlet.
  return [];
}
