// Split instead of one combined list: the diagonal corner-cutting check below needs each
// orthogonal neighbor's cost anyway, so computing orthogonals first lets diagonals reuse those
// instead of calling traversalCost() again for the same cell (see findPathGrid).
const ORTHOGONAL_DIRECTIONS = Object.freeze([
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
]);
const DIAGONAL_DIRECTIONS = Object.freeze([
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
]);

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(node) {
    const items = this.items;
    items.push(node);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].score <= node.score) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = node;
  }
  pop() {
    const items = this.items;
    if (!items.length) return null;
    const root = items[0];
    const tail = items.pop();
    if (items.length) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1, right = left + 1;
        if (left >= items.length) break;
        let child = left;
        if (right < items.length && items[right].score < items[left].score) child = right;
        if (items[child].score >= tail.score) break;
        items[index] = items[child];
        index = child;
      }
      items[index] = tail;
    }
    return root;
  }
}

function heuristic(ax, az, bx, bz) {
  const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
}

export class NavigationGrid {
  constructor(world, { maxVisited = 5000 } = {}) {
    this.world = world;
    this.maxVisited = maxVisited;
    this._queue = [];
    // Lazily allocated by _ensureSearchBuffers() on first findPathGrid() call, once the grid
    // size is known.
    this._searchCosts = null;
    this._searchCameFrom = null;
    this._searchGenAt = null;
    this._searchGen = 0;
  }

  get queueLength() { return this._queue.length; }

  // Queues a findPathWorld() call instead of resolving it inline — see processQueue() for why
  // (Fase 11). `onResolved` is called with the same array-of-points findPathWorld() would have
  // returned directly, once its turn comes up.
  requestPath(from, to, options, onResolved) {
    this._queue.push({ from, to, options, onResolved });
  }

  // Drains queued requests up to a worst-case node-visit budget, so a moment where many callers
  // request a path at once can't spend more than `nodeBudget` nodes of A* work in one call —
  // instead the rest wait for the next processQueue() call (typically the next simulation tick).
  // The cost charged per request is its own maxVisited cap, not how many nodes it actually
  // visited (cheaper searches aren't tracked at that granularity) — conservative, but bounded.
  //
  // C-09 tried capping this in wall-clock time instead (a fixed node count is a poor proxy for
  // actual per-frame cost) and confirmed it cuts frame-time spikes, but at population 240 with
  // sustained repath demand it throttled real throughput enough to make war-journey.spec.js's
  // autonomous-march soldiers arrive too late (reverted after reproducing 2/4 failures with it
  // vs. 0/6 without — see HISTORIAL-PROGRESO.md). The actual fix needs to lower the per-node cost
  // itself (findPathGrid's Map-based costs/cameFrom, traversalCost's redundant diagonal calls),
  // not throttle throughput.
  processQueue(nodeBudget = Infinity) {
    let spent = 0;
    while (spent < nodeBudget && this._queue.length) {
      const { from, to, options, onResolved } = this._queue.shift();
      const remaining = Math.max(300, nodeBudget - spent);
      const cap = Math.min(options?.maxVisited ?? this.maxVisited, remaining);
      const path = this.findPathWorld(from, to, { ...options, maxVisited: cap });
      spent += cap;
      onResolved(path);
    }
  }

  traversalCost(vx, vz, fromX, fromZ, mode = 'land', isBlocked = null) {
    const world = this.world;
    if (!world.inBounds(vx, vz)) return Infinity;
    const index = world.idx(vx, vz);
    if (world.lava?.[index]) return mode === 'air' ? 8 : Infinity;
    const water = world.isWater(vx, vz);
    const frozen = world.ice?.[index] === 1;
    const [wx, wz] = world.gridToWorld(vx, vz);
    const bridgeY = world.bridgeHeightAtWorld?.(wx, wz);
    if (mode === 'water' && (!water || frozen)) return Infinity;
    if (mode === 'land' && water && !frozen && bridgeY == null) return Infinity;
    if (mode !== 'air' && isBlocked?.(vx, vz)) return Infinity;

    let cost = 1;
    if (mode === 'land') {
      const [fx, fz] = world.gridToWorld(fromX, fromZ);
      const fromHeight = world.bridgeHeightAtWorld?.(fx, fz) ?? world.height[world.idx(fromX, fromZ)];
      const slope = Math.abs((bridgeY ?? world.height[index]) - fromHeight);
      if (slope > 2.8) return Infinity;
      cost += slope * 1.7;
      const biome = world.biomeIdAt?.(vx, vz);
      if (biome === 'swamp') cost += 2.2;
      else if (biome === 'tundra' || biome === 'alpine') cost += 1.25;
      else if (biome === 'desert') cost += 0.35;
      if (frozen) cost += 0.8;
    }
    cost += Math.max(0, Number(world.danger?.[index]) || 0) * (mode === 'air' ? 0.025 : 0.06);
    return cost;
  }

  isLinePassable(from, to, mode = 'land', isBlocked = null) {
    const world = this.world;
    const [sx, sz] = world.worldToGrid(from.x, from.z);
    const [ex, ez] = world.worldToGrid(to.x, to.z);
    const steps = Math.max(1, Math.max(Math.abs(ex - sx), Math.abs(ez - sz)));
    let previousX = sx, previousZ = sz;
    for (let step = 1; step <= steps; step++) {
      const x = Math.round(sx + (ex - sx) * (step / steps));
      const z = Math.round(sz + (ez - sz) * (step / steps));
      if (!Number.isFinite(this.traversalCost(x, z, previousX, previousZ, mode, isBlocked))) return false;
      previousX = x; previousZ = z;
    }
    return true;
  }

  // C-09: costs/cameFrom used to be Map<index, ...>, but the index is already a bounded integer
  // (world.idx()) — plain typed arrays reused across calls (tagged with a generation counter
  // instead of cleared each time) avoid Map's per-entry overhead, which mattered here since this
  // runs on every A* node visited and processQueue() budgets thousands of those per simulation
  // tick. Grown lazily and only reallocated if the grid size actually changes.
  _ensureSearchBuffers(cellCount) {
    if (this._searchCosts && this._searchCosts.length === cellCount) return;
    this._searchCosts = new Float64Array(cellCount);
    this._searchCameFrom = new Int32Array(cellCount);
    this._searchGenAt = new Int32Array(cellCount);
    this._searchGen = 0;
  }

  findPathGrid(startX, startZ, endX, endZ, { mode = 'land', isBlocked = null, maxVisited = this.maxVisited } = {}) {
    const world = this.world;
    if (!world.inBounds(startX, startZ) || !world.inBounds(endX, endZ)) return [];
    const start = world.idx(startX, startZ), goal = world.idx(endX, endZ);
    if (start === goal) return [[startX, startZ]];
    this._ensureSearchBuffers(world.verts * world.verts);
    const costs = this._searchCosts, cameFrom = this._searchCameFrom, genAt = this._searchGenAt;
    const gen = ++this._searchGen;
    const open = new MinHeap();
    costs[start] = 0;
    genAt[start] = gen;
    cameFrom[start] = -1; // sentinel: no predecessor (start's cost of 0 can never be beaten, so this is never overwritten)
    open.push({ x: startX, z: startZ, index: start, score: heuristic(startX, startZ, endX, endZ) });
    let visited = 0;

    while (open.size && visited++ < maxVisited) {
      const current = open.pop();
      if (current.index === goal) {
        const path = [];
        let cursor = goal;
        while (cursor !== -1) {
          path.push([cursor % world.verts, Math.floor(cursor / world.verts)]);
          if (cursor === start) break;
          cursor = cameFrom[cursor];
        }
        return path.reverse();
      }
      const baseCost = costs[current.index];
      // Orthogonal neighbors first, caching each cost — the diagonal pass below reuses them for
      // its corner-cutting check instead of calling traversalCost() again for the same cell
      // (traversalCost is pure/deterministic within one search, nothing mutates mid-call).
      let costEast = Infinity, costWest = Infinity, costNorth = Infinity, costSouth = Infinity;
      for (const [dx, dz, distance] of ORTHOGONAL_DIRECTIONS) {
        const x = current.x + dx, z = current.z + dz;
        const cellCost = this.traversalCost(x, z, current.x, current.z, mode, isBlocked);
        if (dx === 1) costEast = cellCost;
        else if (dx === -1) costWest = cellCost;
        else if (dz === 1) costNorth = cellCost;
        else costSouth = cellCost;
        if (!Number.isFinite(cellCost)) continue;
        const index = world.idx(x, z);
        const nextCost = baseCost + cellCost * distance;
        if (nextCost >= (genAt[index] === gen ? costs[index] : Infinity)) continue;
        costs[index] = nextCost;
        cameFrom[index] = current.index;
        genAt[index] = gen;
        open.push({ x, z, index, score: nextCost + heuristic(x, z, endX, endZ) });
      }
      for (const [dx, dz, distance] of DIAGONAL_DIRECTIONS) {
        const x = current.x + dx, z = current.z + dz;
        const cellCost = this.traversalCost(x, z, current.x, current.z, mode, isBlocked);
        if (!Number.isFinite(cellCost)) continue;
        const cornerA = dx === 1 ? costEast : costWest;
        const cornerB = dz === 1 ? costNorth : costSouth;
        if (!Number.isFinite(cornerA) || !Number.isFinite(cornerB)) continue;
        const index = world.idx(x, z);
        const nextCost = baseCost + cellCost * distance;
        if (nextCost >= (genAt[index] === gen ? costs[index] : Infinity)) continue;
        costs[index] = nextCost;
        cameFrom[index] = current.index;
        genAt[index] = gen;
        open.push({ x, z, index, score: nextCost + heuristic(x, z, endX, endZ) });
      }
    }
    return [];
  }

  findPathWorld(from, to, options = {}) {
    if (this.isLinePassable(from, to, options.mode, options.isBlocked)) return [to];
    const [sx, sz] = this.world.worldToGrid(from.x, from.z);
    const [ex, ez] = this.world.worldToGrid(to.x, to.z);
    const cells = this.findPathGrid(sx, sz, ex, ez, options);
    if (!cells.length) return [];
    const path = [];
    for (let index = 1; index < cells.length; index++) {
      const [x, z] = cells[index];
      const previous = path[path.length - 2];
      const current = path[path.length - 1];
      if (previous && current) {
        const dx1 = current.x - previous.x, dz1 = current.z - previous.z;
        const [wx, wz] = this.world.gridToWorld(x, z);
        const dx2 = wx - current.x, dz2 = wz - current.z;
        if (dx1 * dz2 === dz1 * dx2) {
          current.x = wx; current.z = wz;
          continue;
        }
      }
      const [wx, wz] = this.world.gridToWorld(x, z);
      path.push({ x: wx, z: wz });
    }
    if (path.length) path[path.length - 1] = { x: to.x, z: to.z };
    return path;
  }
}
