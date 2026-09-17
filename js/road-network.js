const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pointKey = p => `${p[0]},${p[1]}`;
export const roadEdgeKey = (a, b) => [pointKey(a), pointKey(b)].sort().join('|');

// Distance from p to the closest point on segment a-b (clamped, not the infinite line through it).
function pointToSegmentDistance(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 1e-9) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / lenSq));
  return distance(p, [a[0] + dx * t, a[1] + dz * t]);
}

// A trade relationship is an itinerary, not permission to build another road.
export function existingRoadPath(start, end, routes, canTravel) {
  const graph=new Map(), points=new Map();
  const add=p=>{const key=pointKey(p);points.set(key,p);if(!graph.has(key))graph.set(key,new Set());return key;};
  for(const route of routes)for(let i=1;i<route.nodes.length;i++){
    const a=route.nodes[i-1],b=route.nodes[i];
    if(!canTravel([a,b]))continue;
    const x=add(a),y=add(b);graph.get(x).add(y);graph.get(y).add(x);
  }
  const from=pointKey(start),to=pointKey(end),queue=[from],previous=new Map([[from,null]]);
  for(let i=0;i<queue.length;i++){
    const current=queue[i];
    if(current===to){const path=[];for(let p=to;p!==null;p=previous.get(p))path.push(points.get(p)||start);return path.reverse();}
    for(const next of graph.get(current)||[])if(!previous.has(next)){previous.set(next,current);queue.push(next);}
  }
  return null;
}

// Round new bends without moving established junctions or shared road sections.
export function softenRoad(nodes, canTravel, routes = []) {
  const fixed = new Set();
  for (const route of routes) for (const p of route.nodes) fixed.add(pointKey(p));
  const result = [nodes[0]];
  for (let i=1;i<nodes.length-1;i++) {
    const a=nodes[i-1], p=nodes[i], b=nodes[i+1];
    const before=distance(a,p), after=distance(p,b);
    if (fixed.has(pointKey(p)) || before<.01 || after<.01) { result.push(p); continue; }
    const cut=Math.min(2.4,before*.35,after*.35);
    const from=p.map((v,k)=>v+(a[k]-v)*cut/before);
    const to=p.map((v,k)=>v+(b[k]-v)*cut/after);
    const arc=Array.from({length:7},(_,k)=>{
      const t=k/6;return p.map((v,j)=>(1-t)*(1-t)*from[j]+2*(1-t)*t*v+t*t*to[j]);
    });
    if(canTravel([result.at(-1),...arc,b]))result.push(...arc);
    else result.push(p);
  }
  result.push(nodes.at(-1));
  return result;
}

// Existing road samples are junctions. Construction costs more than travelling
// an established road, so new towns build a branch to the shared trunk.
export function reuseRoadNetwork(direct, routes, canTravel) {
  const points = [], ids = new Map(), edges = [], existingEdges = new Set();
  const add = p => {
    const key = pointKey(p);
    if (!ids.has(key)) { ids.set(key, points.length); points.push(p); edges.push([]); }
    return ids.get(key);
  };
  const link = (a, b, cost) => { edges[a].push([b, cost]); edges[b].push([a, cost]); };
  for (const route of routes) for (let i = 1; i < route.nodes.length; i++) {
    const a = route.nodes[i - 1], b = route.nodes[i];
    if (canTravel([a, b])) {
      link(add(a), add(b), distance(a, b) * 0.12);
      existingEdges.add(roadEdgeKey(a, b));
    }
  }
  if (!points.length) return canTravel(direct) ? direct : null;
  const start = add(direct[0]), end = add(direct.at(-1));
  const directLength = direct.slice(1).reduce((n, p, i) => n + distance(direct[i], p), 0);
  const connected=new Set([start,end].filter(id=>edges[id].length));
  // A cheap detour is still an ugly one if it strays far off to the side before coming back — an
  // unrelated highway running perpendicular to this connection can look "cheaper" by total mileage
  // (existing road costs 0.12x) even though jumping out to reach it and back is a big sideways
  // spike (reported live, with a screenshot, as a road jutting out toward an unrelated city and
  // doubling back). Only a point genuinely near the direct line is a real shortcut, not a detour.
  const corridor = Math.max(6, directLength * 0.35);
  for (const endpoint of [start, end]) for (let i = 0; i < points.length; i++) {
    if(connected.has(endpoint))continue;
    if (i === endpoint) continue;
    const d = distance(points[endpoint], points[i]);
    if (d <= directLength && pointToSegmentDistance(points[i], direct[0], direct.at(-1)) <= corridor && canTravel([points[endpoint], points[i]])) link(endpoint, i, d);
  }
  const costs = points.map(() => Infinity), previous = [], visited = new Set();
  costs[start] = 0;
  while (visited.size < points.length) {
    let current = -1;
    for (let i = 0; i < points.length; i++) if (!visited.has(i) && (current < 0 || costs[i] < costs[current])) current = i;
    if (current < 0 || !Number.isFinite(costs[current]) || current === end) break;
    visited.add(current);
    for (const [next, cost] of edges[current]) if (costs[current] + cost < costs[next]) {
      costs[next] = costs[current] + cost; previous[next] = current;
    }
  }
  if (Number.isFinite(costs[end])) {
    const path = [];
    for (let i = end; i !== undefined; i = previous[i]) path.push(points[i]);
    path.reverse();
    const length = path.slice(1).reduce((n, p, i) => n + distance(path[i], p), 0);
    if (costs[end] < directLength * 0.95 && length <= directLength * 1.4) {
      const sampled = [path[0]];
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        const steps = existingEdges.has(roadEdgeKey(a, b)) ? 1 : Math.max(1, Math.ceil(distance(a, b) / 3));
        for (let k = 1; k < steps; k++) sampled.push([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps]);
        sampled.push(b);
      }
      return sampled;
    }
  }
  return canTravel(direct) ? direct : null;
}
