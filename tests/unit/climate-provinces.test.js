import { it, expect } from 'vitest';
import * as THREE from 'three';
import { regionalClimateSample } from '../../js/world-generation.js';
import { World, CONFIG, SIZE_PRESETS } from '../../js/world.js';

it('creates repeated climate regions with smooth, seeded temperatures', () => {
  const n=80, labels=[], visited=new Set(), counts={};
  for(let z=0;z<n;z++) for(let x=0;x<n;x++) {
    const p=regionalClimateSample(x,z,n,123); labels.push(p.kind);
    expect(p).toEqual(regionalClimateSample(x,z,n,123));
    expect(Math.abs(p.temperature-regionalClimateSample(x+.1,z,n,123).temperature)).toBeLessThan(1);
  }
  for(let i=0;i<labels.length;i++) {
    if(visited.has(i))continue;
    const kind=labels[i]; counts[kind]=(counts[kind]||0)+1;
    const stack=[i];visited.add(i);
    while(stack.length) {
      const j=stack.pop();
      for(const k of [j%n?j-1:-1,j%n<n-1?j+1:-1,j-n,j+n]) {
        if(k>=0&&k<labels.length&&!visited.has(k)&&labels[k]===kind){visited.add(k);stack.push(k);}
      }
    }
  }
  expect(counts.artico).toBeGreaterThanOrEqual(2);
  expect(counts.arido).toBeGreaterThanOrEqual(3);
  expect(labels.some((kind,i)=>kind!==regionalClimateSample(i%n,Math.floor(i/n),n,42).kind)).toBe(true);
});

it('keeps warm summits rocky and limits snow to cold conditions', () => {
  const w=new World(new THREE.Scene(),{size:32});
  w.height.fill(CONFIG.MAX_H);w.moisture.fill(.4);w.jitter.fill(1);w.biome.fill(9);
  w.temperature[0]=25; const warm=w.colorAt(0).clone();
  w.temperature[0]=-12; const cold=w.colorAt(0).clone();
  expect(cold.r+ cold.g+cold.b).toBeGreaterThan(warm.r+warm.g+warm.b+.5);
  expect(SIZE_PRESETS.gigante).toBe(720);
  w.dispose();
});
