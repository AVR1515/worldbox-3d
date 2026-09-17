import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RenderSystem } from '../../js/render-system.js';

describe('matrices de escena durante las pasadas de render', () => {
  it('actualiza una vez y reutiliza las matrices en color y oclusión', () => {
    const scene = new THREE.Scene();
    const update = vi.spyOn(scene, 'updateMatrixWorld');
    const camera = new THREE.PerspectiveCamera(); camera.position.set(2, 3, 4);
    const sky = new THREE.Object3D(), stars = new THREE.Object3D(); scene.add(sky, stars);
    const renderPass = () => {
      if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
      expect(sky.matrixWorld.elements.slice(12, 15)).toEqual([2, 3, 4]);
    };
    const state = { scene, camera, sky, stars, postFXEnabled: true,
      renderer: { info: { reset: vi.fn() }, shadowMap: { enabled: true }, render: renderPass },
      composer: { render() { renderPass(); renderPass(); } } };
    RenderSystem.prototype.render.call(state);
    expect(update).toHaveBeenCalledTimes(1);
    expect(scene.matrixWorldAutoUpdate).toBe(true);
    camera.position.x = 8;
    state.composer.render = () => { throw new Error('render interrumpido'); };
    expect(() => RenderSystem.prototype.render.call(state)).toThrow('render interrumpido');
    expect(scene.matrixWorldAutoUpdate).toBe(true);
    expect(sky.matrixWorld.elements[12]).toBe(8);
  });

  it('respeta una escena con actualización manual y el render sin postproceso', () => {
    const scene = new THREE.Scene(); scene.matrixWorldAutoUpdate = false;
    const update = vi.spyOn(scene, 'updateMatrixWorld');
    const render = vi.fn();
    RenderSystem.prototype.render.call({ scene, camera: new THREE.PerspectiveCamera(), sky: new THREE.Object3D(), stars: new THREE.Object3D(),
      postFXEnabled: false, renderer: { info: { reset: vi.fn() }, shadowMap: {}, render } });
    expect(render).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    expect(scene.matrixWorldAutoUpdate).toBe(false);
  });
});
