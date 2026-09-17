import { expect, it } from 'vitest';
import { cityRoadBounds, cityRoadAccess, exteriorRoad, outsideCities } from '../../js/city-roads.js';
import { cityBoundary, cityStreets } from '../../js/city-layout.js';

it('connects all four avenues to directional entrances and outward approaches',()=>{
  const city={x:10,z:15,houses:[{x:11.8,z:16.8,gridPlot:true}],farms:[]};
  const gates=cityBoundary(city).gates, streets=cityStreets(city);
  expect(new Set(gates.map(g=>g.direction)).size).toBe(4);
  for(const gate of gates){
    const target={x:city.x,z:city.z};
    target[gate.axis===0?'x':'z']+=gate.side*40;
    const access=cityRoadAccess(city,target);
    expect(access.direction).toBe(gate.direction);
    expect(access.entrance).toEqual([gate.x,gate.z]);
    expect(access.junction[gate.axis]-access.entrance[gate.axis]).toBeCloseTo(gate.side*3);
    expect(streets.some(path=>path.at(-1)[0]===gate.x&&path.at(-1)[1]===gate.z)).toBe(true);
    expect(outsideCities([access.junction,[target.x,target.z]],[cityRoadBounds(city)])).toBe(true);
  }
});

it('routes around a third city rather than cutting through its residential blocks',()=>{
  const city={x:0,z:0,houses:[{x:1.8,z:1.8}],farms:[]};
  const bounds=[cityRoadBounds(city)];
  expect(outsideCities([[-12,0],[12,0]],bounds)).toBe(false);
  const path=exteriorRoad([-12,0],[12,0],bounds,()=>true);
  expect(path.length).toBeGreaterThan(2);
  expect(outsideCities(path,bounds)).toBe(true);
  expect(path[0]).toEqual([-12,0]);expect(path.at(-1)).toEqual([12,0]);
});

it('selects an exterior gate with a shared approach outside the city',()=>{
  const city={x:0,z:0,houses:[],farms:[]};
  const {entrance,junction}=cityRoadAccess(city,{x:20,z:0});
  expect(entrance[0]).toBeGreaterThan(3.6);
  expect(junction[0]-entrance[0]).toBe(3);
  expect(exteriorRoad(junction,[20,0],[cityRoadBounds(city)],()=>false)).toBeNull();
});

// Regression: two earlier versions of "stick to an already-used gate" were tried and both
// reported live, with screenshots, as producing several separate roads fanning out of one city —
// no stickiness let partners a few degrees apart splinter onto separate gates, and a
// direction-tolerance version still let a partner far enough off-angle claim a second gate. The
// player wants exactly one main entrance a city ever uses, full stop, so preferredDirection is now
// honored unconditionally whenever that gate exists, no matter which way the new target lies.
it('preferredDirection always sticks, even for a target on the opposite side of the city',()=>{
  const city={x:0,z:0,houses:[],farms:[]};
  const nearby=cityRoadAccess(city,{x:60,z:16},null,'east');
  expect(nearby.direction).toBe('east');
  const opposite=cityRoadAccess(city,{x:-60,z:0},null,'east');
  expect(opposite.direction).toBe('east');
  // Due "south" (+z, per cityBoundary()'s own axis/side convention) — a clearly different
  // quadrant (90 degrees off) — still the same, one, permanent gate.
  const perpendicular=cityRoadAccess(city,{x:0,z:60},null,'east');
  expect(perpendicular.direction).toBe('east');
});
