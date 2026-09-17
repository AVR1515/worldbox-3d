import {it,expect} from 'vitest';
import * as THREE from 'three';
import {World} from '../../js/world.js';
import {lowestSupport} from '../../js/ground-support.js';
it('anchors tree footprints on slopes and excludes cliff grass',()=>{
 const w=new World(new THREE.Scene(),{size:32});
 w.height.fill(8);w.moisture.fill(.6);w.biome.fill(3);w.jitter.fill(1);
 for(let z=0;z<=32;z++)for(let x=0;x<=32;x++) w.height[w.idx(x,z)]=8+(x>16?3:0);
 w.buildTreeMeshes();w.plantTree(16,16,true);
 const rec=w.treeSlots.get(w.idx(16,16)), m=new THREE.Matrix4();w.treeMeshes[rec.kind].trunk.getMatrixAt(rec.slot,m);
 expect(m.elements[13]).toBeLessThanOrEqual(w.heightAtWorld(0,0));
 expect(lowestSupport(w,.05,0,.2)).toBeLessThan(w.heightAtWorld(.05,0));
 w.buildGrassMesh();w.scatterGrass();
 const matrices=w._grassMatrices;
 for(let i=0;i<w.grassCount;i++) {
   const gx=Math.round(matrices[i*16+12]+w.half);
   expect([16,17]).not.toContain(gx);
 }
 w.dispose();
});
