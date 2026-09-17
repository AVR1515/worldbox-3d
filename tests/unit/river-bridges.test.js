import { afterEach, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../../js/world.js';
import { CreatureManager } from '../../js/creatures.js';
import { NavigationGrid } from '../../js/navigation.js';
import { planRiverBridges, buildBridgeGeometry } from '../../js/river-bridges.js';
import { riverVertex } from '../../js/river-surface.js';
import { SettlementManager } from '../../js/settlements.js';

const disposable=[];
afterEach(()=>{while(disposable.length)disposable.pop().dispose();});
function creek() {
  const world=new World(new THREE.Scene(),{size:32});disposable.push(world);
  world.height.fill(8);world.moisture.fill(.5);world.temperature.fill(18);
  for(let z=0;z<=world.size;z++)for(let x=15;x<=17;x++){
    const i=world.idx(x,z);world.height[i]=7.4;world.riverMask[i]=1;world.riverHeight[i]=7.8;
  }
  world.buildTerrainMesh();world.buildRiverMesh();return world;
}

it('anchors dry river edges to lowered banks instead of leaving floating water',()=>{
  const world=creek();world.height[world.idx(18,16)]=6;
  const vertex=riverVertex(world,18,16);
  expect(vertex[1]).toBe(6);expect(vertex[3]).toBe(0);
  world.buildRiverMesh();
  const p=world.riverMesh.geometry.attributes.position;
  for(let i=0;i<p.count;i++)if(p.getX(i)===2&&p.getZ(i)===0)expect(p.getY(i)).toBe(6);
});

it('builds a continuous bank-to-bank crossing above the whole water surface',()=>{
  const world=creek(), plans=planRiverBridges(world,[[-10,0],[10,0]],.9);
  expect(plans).toHaveLength(1);world.setBridges(plans);
  for(let x=-1.8;x<=1.8;x+=.1){
    expect(world.bridgeHeightAtWorld(x,0)).toBeGreaterThan(world.riverSurfaceAtWorld(x,0)+.25);
  }
  const points=plans[0].points;
  for(const p of [points[0],points.at(-1)])expect(p.y-world.heightAtWorld(p.x,p.z)).toBeCloseTo(.04);
  const g=buildBridgeGeometry(world,plans);disposable.push(g);
  expect(g.attributes.position.count).toBeGreaterThan(1000);
  expect([...g.attributes.position.array].every(Number.isFinite)).toBe(true);
  expect(world.bridgeHeightAtWorld(0,3)).toBeNull();
});

it('land paths cross the deck while fish can live underneath, and removing it blocks the crossing',()=>{
  const world=creek(), navigation=new NavigationGrid(world);
  expect(navigation.findPathWorld({x:-6,z:0},{x:6,z:0})).toEqual([]);
  world.setBridges(planRiverBridges(world,[[-10,0],[10,0]]));
  const path=navigation.findPathWorld({x:-6,z:0},{x:6,z:0});
  expect(path?.length).toBeGreaterThan(0);
  expect(path.at(-1)).toMatchObject({ x: 6, z: 0 });
  const creatures=new CreatureManager(new THREE.Scene(),world,{laws:{aging:false,hunger:false,reproduction:false,disease:false}});disposable.push(creatures);
  const human=creatures.spawn('human',0,0),fish=creatures.spawn('fish',0,0);
  expect(human).toBeTruthy();expect(fish).toBeTruthy();
  expect(human.y).toBeCloseTo(world.bridgeHeightAtWorld(0,0));
  expect(creatures._isLiquidWaterWorld(0,0)).toBe(false);
  expect(creatures._isLiquidWaterWorld(0,0,true)).toBe(true);
  world.setBridges([]);
  expect(navigation.findPathWorld({x:-6,z:0},{x:6,z:0})).toEqual([]);
});

it('does not build bridges over the ocean or routes ending in water',()=>{
  const world=creek();
  expect(planRiverBridges(world,[[-6,0],[0,0]])).toEqual([]);
  world.height.fill(3);world.riverMask.fill(0);
  expect(planRiverBridges(world,[[-6,0],[6,0]])).toEqual([]);
});

it('shares a full crossing across short road segments and removes it after the river is filled',()=>{
  const world=creek(), scene=new THREE.Scene();
  const creatures=new CreatureManager(scene,world);disposable.push(creatures);
  const manager=new SettlementManager(scene,world,creatures);disposable.push(manager);
  const route={nodes:Array.from({length:21},(_,i)=>[i-10,0]),group:new THREE.Group(),revealed:true};
  manager.tradeRoutes.set('test',route);manager._layoutRoute(route);manager._flushHousePaths();
  expect(world._bridges).toHaveLength(1);expect(world.bridgeHeightAtWorld(0,0)).toBeGreaterThan(8);
  world.height.fill(8);world.riverMask.fill(0);world.riverHeight.fill(0);
  manager.onTerrainChanged({minX:0,minZ:0,maxX:32,maxZ:32});
  expect(world._bridges).toEqual([]);expect(world.bridgeHeightAtWorld(0,0)).toBeNull();
});
