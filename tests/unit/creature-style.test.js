import {it,expect} from 'vitest';
import * as THREE from 'three';
import {buildCreatureModel,attachWeapon,detachWeapon,creatureAssetReady} from '../../js/models.js';

it('keeps every creature lightweight, faceted and independent of imported assets',()=>{
  for(const type of ['human','orc','elf','dwarf','mage','fairy','zombie','skeleton','demon','ghost','alien','dragon','herbivore','carnivore','boar','bear','fish']){
    const model=buildCreatureModel(type);let triangles=0;
    model.root.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;expect(o.material.flatShading).toBe(true);expect(o.material.map).toBeNull();}});
    expect(triangles).toBeLessThan(2000);
    expect(new THREE.Box3().setFromObject(model.root).isEmpty()).toBe(false);
    expect(creatureAssetReady(type)).toBe(false);
    const other=buildCreatureModel(type);
    expect(other.tintTargets[0].material).not.toBe(model.tintTargets[0].material);
  }
});

it('retains racial features and unscaled weapon pivots through walking poses',()=>{
  for(const [type,feature] of [['orc','tusk'],['elf','pointed-ear'],['dwarf','beard'],['mage','wizard-hat'],['fairy','wing'],['demon','horn'],['dragon','wing']])expect(buildCreatureModel(type).root.getObjectByName(feature)).toBeTruthy();
  const human=buildCreatureModel('human');const weapon=attachWeapon(human,'sword');
  expect(weapon.parent).toBe(human.armR);expect(human.armR.scale.toArray()).toEqual([1,1,1]);
  human.legL.rotation.x=.5;human.armR.rotation.x=-.3;human.root.updateMatrixWorld(true);
  expect(human.legL.getObjectByName('boot')).toBeTruthy();
  detachWeapon(human);expect(human.weapon).toBeNull();
});
