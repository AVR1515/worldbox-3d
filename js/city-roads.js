import { cityBoundary } from './city-layout.js';

export function cityRoadBounds(city) {
  const { polygon } = cityBoundary({ ...city, houses: city.houses || [] });
  return { minX: Math.min(...polygon.map(p=>p[0])), maxX: Math.max(...polygon.map(p=>p[0])),
    minZ: Math.min(...polygon.map(p=>p[1])), maxZ: Math.max(...polygon.map(p=>p[1])) };
}

export function cityRoadAccess(city, target, world, preferredDirection) {
  const gates = cityBoundary({ ...city, houses: city.houses || [] }).gates;
  const passable = g => !world || world.heightAtWorld(g.x, g.z) > 5;
  // A city gets exactly one entrance, period — chosen once (whichever gate is nearest to
  // whatever target first needed a road) and then kept for every road the city will ever have,
  // trade partner after trade partner. Earlier attempts let each destination pick its own
  // best-facing gate (or shared one only when "close enough" in distance, then in angle) — both
  // produced a real road network, just not the one the player wants: several separate roads
  // fanning out of one city, sometimes duplicating a stretch a slightly different way, instead of
  // a single main road every trade route branches off from (reported live, twice, with
  // screenshots). One entrance forces every route through the same point, so the network-reuse
  // pathfinding below (existingRoadPath/reuseRoadNetwork in js/road-network.js) always has a
  // shared trunk to extend instead of a fresh point to build fresh infrastructure from.
  const usable = gates.filter(passable);
  const pool = usable.length ? usable : gates;
  const preferred = pool.find(g => g.direction === preferredDirection);
  const gate = preferred || [...pool].sort((a, b) => Math.hypot(a.x - target.x, a.z - target.z) - Math.hypot(b.x - target.x, b.z - target.z))[0];
  const junction = [gate.x, gate.z];
  junction[gate.axis] += gate.side * 3;
  return { entrance: [gate.x, gate.z], junction, side: gate.side, direction: gate.direction };
}

// Exterior roads cannot cut across houses or use another city's plaza as a shortcut.
export function outsideCities(nodes, bounds) {
  for(let i=1;i<nodes.length;i++) {
    const a=nodes[i-1], b=nodes[i];
    for(const r of bounds) {
      let lo=0,hi=1;
      for(const [v,d,min,max] of [[a[0],b[0]-a[0],r.minX-.45,r.maxX+.45],[a[1],b[1]-a[1],r.minZ-.45,r.maxZ+.45]]) {
        if(Math.abs(d)<1e-9){if(v<=min || v>=max){lo=2;break;}}
        else {lo=Math.max(lo,Math.min((min-v)/d,(max-v)/d));hi=Math.min(hi,Math.max((min-v)/d,(max-v)/d));}
      }
      if(lo<hi && hi>0 && lo<1)return false;
    }
  }
  return true;
}

export function exteriorRoad(start,end,bounds,canTravel) {
  const allowed=nodes=>outsideCities(nodes,bounds)&&canTravel(nodes);
  if(allowed([start,end]))return [start,end];
  const points=[start,end];
  for(const r of bounds)for(const x of [r.minX-.8,r.maxX+.8])for(const z of [r.minZ-.8,r.maxZ+.8])points.push([x,z]);
  const costs=points.map(()=>Infinity),previous=[],visited=new Set();costs[0]=0;
  while(visited.size<points.length){
    let current=-1;
    for(let i=0;i<points.length;i++)if(!visited.has(i)&&(current<0||costs[i]<costs[current]))current=i;
    if(current<0||!Number.isFinite(costs[current])||current===1)break;
    visited.add(current);
    for(let next=0;next<points.length;next++){
      if(visited.has(next)||next===current)continue;
      const cost=costs[current]+Math.hypot(points[current][0]-points[next][0],points[current][1]-points[next][1]);
      if(cost>=costs[next]||!allowed([points[current],points[next]]))continue;
      costs[next]=cost;previous[next]=current;
    }
  }
  if(!Number.isFinite(costs[1]))return null;
  const result=[];for(let i=1;i!==undefined;i=previous[i])result.push(points[i]);
  return result.reverse();
}
