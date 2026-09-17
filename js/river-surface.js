const NEIGHBORS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];

export function riverVertex(world, x, z) {
  const i = world.idx(x,z), ground = world.height[i];
  let y = world.riverHeight[i];
  if (!world.riverMask[i]) {
    let sum = 0, weight = 0;
    for (const [dx,dz] of NEIGHBORS) {
      if (!world.inBounds(x+dx,z+dz)) continue;
      const j = world.idx(x+dx,z+dz);
      if (!world.riverMask[j]) continue;
      const w = 1/Math.hypot(dx,dz);
      sum += world.riverHeight[j]*w; weight += w;
    }
    // A dry bank may never become an elevated water vertex. This also prevents
    // old saved rivers from drawing suspended skirts over an edited hillside.
    y = ground <= 5 ? 5 : Math.min(ground, weight ? sum/weight : ground);
  }
  return [x-world.half, y, z-world.half, y-ground];
}

// Same triangles and shoreline clipping as the visible river surface.
export function riverSurfaceAt(world, wx, wz) {
  const gx = wx+world.half, gz = wz+world.half, x = Math.floor(gx), z = Math.floor(gz);
  if (x<0 || z<0 || x>=world.size || z>=world.size) return null;
  const fx = gx-x, fz = gz-z;
  const coords = fx+fz<=1 ? [[x,z,1-fx-fz],[x+1,z,fx],[x,z+1,fz]] : [[x+1,z,1-fz],[x,z+1,1-fx],[x+1,z+1,fx+fz-1]];
  if (!coords.some(([vx,vz]) => world.riverMask[world.idx(vx,vz)])) return null;
  let height = 0, depth = 0;
  for (const [vx,vz,w] of coords) { const v = riverVertex(world,vx,vz); height += v[1]*w; depth += v[3]*w; }
  return depth > .002 && height > 5 ? height : null;
}
