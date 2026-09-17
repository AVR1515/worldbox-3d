import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { World } from '../../js/world.js';
import { CreatureManager } from '../../js/creatures.js';

const disposable = [];
afterEach(() => { while (disposable.length) disposable.pop().dispose(); });
describe('visibilidad y LOD de criaturas', () => {
  it('representa toda la fauna permitida en un mapa grande y vuelve al modelo cercano', () => {
    const scene = new THREE.Scene(), world = new World(scene, { size: 240 });
    world.height.fill(8);
    const creatures = new CreatureManager(scene, world);
    disposable.push(world, creatures);
    for (let i = 0; i < 220; i++) expect(creatures.spawn('herbivore', 0, 0)).toBeTruthy();
    const before = creatures.serialize();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 100, 100); camera.lookAt(0, 8, 0);
    expect(creatures.updateVisuals(camera, 1)).toEqual({ detailed: 0, instanced: 220, culled: 0 });
    expect(creatures.farLodMeshes.get('herbivore').count).toBe(220);
    camera.position.set(0, 12, 15); camera.lookAt(0, 8, 0);
    expect(creatures.updateVisuals(camera, 1)).toEqual({ detailed: 220, instanced: 0, culled: 0 });
    expect(creatures.serialize()).toEqual(before);
    camera.lookAt(0, 12, 100);
    expect(creatures.updateVisuals(camera, 1).culled).toBe(220);
  });

  it('no mide tiempos por fase salvo que se active profileDetail (C-09)', () => {
    const scene = new THREE.Scene(), world = new World(scene, { size: 64 });
    world.height.fill(8);
    const creatures = new CreatureManager(scene, world);
    disposable.push(world, creatures);
    creatures.spawn('herbivore', 0, 0);
    creatures.update(1 / 30);
    expect(creatures.lastDetailTimings).toBeNull();

    creatures.profileDetail = true;
    creatures.update(1 / 30);
    expect(creatures.lastDetailTimings).toMatchObject({
      navQueue: expect.any(Number), navQueueLength: expect.any(Number), settlementIndex: expect.any(Number),
      spatialRebuild: expect.any(Number), decide: expect.any(Number), mainLoop: expect.any(Number),
      cleanup: expect.any(Number), projectiles: expect.any(Number),
    });
  });
});
