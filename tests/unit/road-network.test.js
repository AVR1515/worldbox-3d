import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { reuseRoadNetwork, roadEdgeKey, softenRoad } from '../../js/road-network.js';
import { SettlementManager } from '../../js/settlements.js';
import { World } from '../../js/world.js';
import { cityRoadBounds, cityRoadAccess, outsideCities } from '../../js/city-roads.js';

const trunk = Array.from({ length: 21 }, (_, i) => [i * 3, 0]);
const land = () => true;
describe('shared trade road network', () => {
  it('rounds new corners while retaining endpoints, obstacles and existing junctions',()=>{
    const nodes=[[0,0],[10,0],[10,10]];
    const rounded=softenRoad(nodes,()=>true);
    expect(rounded[0]).toEqual(nodes[0]);
    expect(rounded.at(-1)).toEqual(nodes.at(-1));
    expect(rounded).not.toContainEqual([10,0]);
    expect(rounded.some(p=>p[0]<10&&p[1]>0)).toBe(true);
    expect(softenRoad(nodes,()=>false)).toEqual(nodes);
    expect(softenRoad(nodes,()=>true,[{nodes:[[10,0],[20,0]]}])).toEqual(nodes);
  });
  it('builds three trading relationships as a shared physical network', () => {
    const world = new World(new THREE.Scene(), { size: 64 });
    world.height.fill(8);
    const manager = Object.create(SettlementManager.prototype);
    const cities = [[-18, 0], [18, 0], [0, 12]].map(([x, z], i) => ({ id: i + 1, empireId: i + 1, x, z }));
    const empires = cities.map(s => ({ id: s.id, capitalId: s.id, relations: new Map(cities.filter(b => b !== s).map(b => [b.id, { status: 'peace' }])) }));
    Object.assign(manager, { world, group: new THREE.Group(), pathMesh: { material: new THREE.MeshStandardMaterial() }, tradeRoutes: new Map(), settlements: cities, empires });
    manager._syncTradeRoutes();
    expect(manager.tradeRoutes.size).toBe(3);
    const routes = [...manager.tradeRoutes.values()];
    // Every city gets exactly one road entrance, forever, no matter how many trade partners it
    // has or in what directions — picking a *better-facing* gate per destination (this test used
    // to assert up to 2 per city) still produced several separate roads fanning out of one city,
    // reported live with screenshots as unwanted spaghetti. One shared entrance point per city
    // gives every route a common anchor to reuse instead of separate infrastructure.
    for(const city of cities){
      const entrances=routes.filter(r=>r.capA===city.id||r.capB===city.id).map(r=>r.capA===city.id?r.nodes[0]:r.nodes.at(-1));
      expect(new Set(entrances.map(p=>p.join(','))).size).toBe(1);
      for(const p of entrances)expect(Math.hypot(p[0]-city.x,p[1]-city.z)).toBeGreaterThan(3);
    }
    // Each individual physical edge (js/settlements.js's roadNetwork — the shared backbone,
    // independent of which two empires happen to be trading) stays clear of every city's
    // residential blocks. A *derived* multi-hop trade route (e.g. city1-city2 here, which shares
    // the backbone through city3) legitimately passes through an intermediate city's own gate —
    // that's the point of a shared trunk — so that invariant belongs on the edges, not the
    // derived path.
    for(const route of manager.roadNetwork.values())expect(outsideCities(route.nodes.slice(1,-1),cities.map(cityRoadBounds))).toBe(true);
    // The network shares physical road segments between routes (not every route pays for its own
    // private stretch of pavement end to end): three trade relationships sit on top of only two
    // physical edges (a minimum spanning tree over three cities).
    expect(manager.roadNetwork.size).toBe(2);
    expect(manager._sharedRoads.size).toBeLessThan(routes.reduce((n, r) => n + r.meshes.length, 0));
    manager._syncTradeRoutes();
    expect([...manager.tradeRoutes.values()]).toEqual(routes);
    empires[0].relations.get(empires[1].id).status='war';
    manager._syncTradeRoutes();
    expect([...manager.tradeRoutes.values()]).toEqual(routes);
    empires[0].relations.get(empires[1].id).status='alliance';
    cities.push({id:99,empireId:99,x:27,z:27,houses:[]});
    manager._syncTradeRoutes();
    expect([...manager.tradeRoutes.values()]).toEqual(routes);
    cities.pop();
    for(const route of routes)route.revealed=true;
    // A road is permanent physical infrastructure now — a house appearing near it later (city1
    // growing a new plot) is not grounds to rebuild it, matching the explicit "never build another
    // road just because something changed nearby" requirement this whole design exists for.
    cities[0].houses=[{x:cities[0].x+5.4,z:cities[0].z+1.8,gridPlot:true}];
    manager._syncTradeRoutes();
    expect([...manager.tradeRoutes.values()][0]).toBe(routes[0]);
    expect([...manager.tradeRoutes.values()].every(r=>r.revealed)).toBe(true);
    for (const route of manager.tradeRoutes.values()) manager._disposeRoute(route);
    manager.pathMesh.material.dispose(); world.dispose();
  });
  // Regression: cities scattered around a coastline connect, nearest-neighbour, into a tree that
  // traces the shore — a single road effectively wrapping the island with no interior shortcuts,
  // reported live as "que no sea solo un camino principal dandole la vuelta a la isla". Once every
  // city has its required connection, the network should keep evaluating and add a direct
  // alternate for a pair whose only route through the backbone is a real detour.
  it('grows an alternate road across the island instead of only ever wrapping the coastline', () => {
    // Object3D's constructor consumes Math.random() for its uuid, and this test's ring of cities
    // constructs many THREE objects (roads, groups, meshes) — enough to shift the shared
    // Math.random() sequence later, seeded-random tests in *other* files rely on in a full-suite
    // run (a known fragility in this codebase; see human-view.test.js's ice-mesh-normals fix for
    // the same issue). None of this test's own logic depends on Math.random's actual values, so
    // pin it for the duration instead of letting object creation drift the global sequence.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.42);
    try {
      const world = new World(new THREE.Scene(), { size: 96 });
      world.height.fill(8);
      const manager = Object.create(SettlementManager.prototype);
      const RADIUS = 60, COUNT = 8;
      const cities = Array.from({ length: COUNT }, (_, i) => {
        const a = (i / COUNT) * Math.PI * 2;
        return { id: i + 1, empireId: i + 1, x: Math.cos(a) * RADIUS, z: Math.sin(a) * RADIUS };
      });
      const empires = cities.map(s => ({ id: s.id, capitalId: s.id, relations: new Map(cities.filter(b => b !== s).map(b => [b.id, { status: 'peace' }])) }));
      Object.assign(manager, { world, group: new THREE.Group(), pathMesh: { material: new THREE.MeshStandardMaterial() }, tradeRoutes: new Map(), settlements: cities, empires });
      for (let i = 0; i < COUNT * 2; i++) manager._syncTradeRoutes();
      // A spanning tree over COUNT cities has exactly COUNT-1 edges; any more means an alternate
      // (a genuine cross-link, not a duplicate of an existing connection) got added.
      expect(manager.roadNetwork.size).toBeGreaterThan(COUNT - 1);
      // The two cities on opposite sides of the ring used to only reach each other the long way
      // around; the shortest path through the network (which now may include the alternate) should
      // no longer be far worse than a direct road would be.
      const across = cities[Math.floor(COUNT / 2)];
      const path = manager._networkPath(cities[0].id, across.id);
      const pathLength = path.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - path[i][0], p[1] - path[i][1]), 0);
      const direct = Math.hypot(cities[0].x - across.x, cities[0].z - across.z);
      expect(pathLength / direct).toBeLessThan(1.6);
      manager.pathMesh.material.dispose(); world.dispose();
    } finally {
      randomSpy.mockRestore();
    }
  });
  it('joins a nearby trunk in its interior and follows it to the destination', () => {
    const path = reuseRoadNetwork([[30, 12], [60, 0]], [{ nodes: trunk }], land);
    const junction = path.findIndex(p => p[1] === 0);
    expect(path[junction][0]).toBeGreaterThan(0);
    expect(path[junction][0]).toBeLessThan(45);
    expect(path.slice(junction)).toEqual(trunk.slice(trunk.findIndex(p => p[0] === path[junction][0])));
    expect(path[0]).toEqual([30, 12]);
  });
  it('reuses the full connection in reverse without creating another road', () => {
    expect(reuseRoadNetwork([[60, 0], [0, 0]], [{ nodes: trunk }], land)).toEqual([...trunk].reverse());
  });
  it('rejects an excessive detour and rejects blocked connectors', () => {
    const direct = [[0, 0], [20, 0]];
    expect(reuseRoadNetwork(direct, [{ nodes: [[0, 0], [0, 80], [20, 80], [20, 0]] }], land)).toEqual(direct);
    expect(reuseRoadNetwork(direct, [{ nodes: trunk }], () => false)).toBeNull();
  });
  it('renders shared stretches once, retains them after one route is removed, and resamples edits', () => {
    const world = new World(new THREE.Scene(), { size: 48 });
    world.height.fill(8);
    const manager = Object.create(SettlementManager.prototype);
    Object.assign(manager, { world, group: new THREE.Group(), pathMesh: { material: new THREE.MeshStandardMaterial() } });
    const make = nodes => ({ nodes, group: new THREE.Group(), revealed: true, revealElapsed: 1, revealDuration: 1 });
    const a = make([[-6, 0], [0, 0], [6, 0]]);
    const b = make([[0, 6], [0, 0], [6, 0]]);
    manager._layoutRoute(a); manager._layoutRoute(b);
    expect(manager._sharedRoads.size).toBe(3);
    expect(a.meshes[1]).toBe(b.meshes[1]);
    const shared = b.meshes[1];
    manager._disposeRoute(a);
    expect(manager._sharedRoads.get(roadEdgeKey([0, 0], [6, 0]))).toBe(shared);
    expect(shared.visible).toBe(true);
    b.revealed=false;b.revealElapsed=0;
    manager._applyRouteVisibility(b);
    expect(shared.visible).toBe(true);
    world.height.fill(10);
    manager._layoutRoute(b, true);
    expect(shared.geometry.attributes.position.getY(0)).toBeCloseTo(10.018, 3);
    manager._disposeRoute(b);
    expect(manager._sharedRoads.size).toBe(0);
    manager.pathMesh.material.dispose(); world.dispose();
  });
});
