import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { CreatureManager } from '../../js/creatures.js';
import { World } from '../../js/world.js';
import { CameraRig } from '../../js/camera.js';

// "Vista humana" (js/main.js): possess a human and walk/run/jump instead of directing the world.
const disposable = [];
afterEach(() => { vi.restoreAllMocks(); while (disposable.length) disposable.pop().dispose(); });
function setup() {
  const scene = new THREE.Scene();
  const world = new World(scene, { size: 32 });
  world.generate({ mapType: 'island', seed: 17, mountainLevel: 0 });
  const creatures = new CreatureManager(scene, world, { laws: { hunger: false, aging: false, reproduction: false, disease: false } });
  disposable.push(world, creatures);
  const [x, z] = world.gridToWorld(16, 16);
  const human = creatures.spawn('human', x, z);
  expect(human).toBeTruthy();
  creatures.setPossessed(human, true);
  return { creatures, human };
}

describe('movimiento de una criatura poseída (caminar, correr, saltar)', () => {
  it('correr (Shift) recorre más distancia que caminar en el mismo tiempo', () => {
    const { creatures, human } = setup();
    creatures.setPossessedInput(0, 1, false);
    for (let i = 0; i < 30; i++) creatures.update(1 / 30);
    const walked = Math.hypot(human.x, human.z);

    const { creatures: creatures2, human: human2 } = setup();
    creatures2.setPossessedInput(0, 1, true);
    for (let i = 0; i < 30; i++) creatures2.update(1 / 30);
    const ran = Math.hypot(human2.x, human2.z);

    expect(ran).toBeGreaterThan(walked * 1.3);
  });

  it('saltar (triggerJump) sube y vuelve a bajar a jumpOffset 0 sin moverse en x/z', () => {
    const { creatures, human } = setup();
    const [x0, z0] = [human.x, human.z];
    creatures.setPossessedInput(0, 0, false); // quieto: aísla el arco del salto del desplazamiento
    creatures.triggerJump();
    expect(human.jumpVelocity).toBeGreaterThan(0);
    creatures.update(1 / 30);
    expect(human.jumpOffset).toBeGreaterThan(0); // subiendo
    let peaked = false, landed = false;
    for (let i = 0; i < 60 && !landed; i++) {
      creatures.update(1 / 30);
      if (human.jumpOffset > 0) peaked = true;
      if (peaked && human.jumpOffset === 0 && human.jumpVelocity === 0) landed = true;
    }
    expect(landed).toBe(true);
    expect(human.x).toBeCloseTo(x0, 5);
    expect(human.z).toBeCloseTo(z0, 5);
  });

  it('un segundo salto no hace nada mientras el primero sigue en el aire (solo saltos con los pies en el suelo)', () => {
    const { creatures, human } = setup();
    creatures.triggerJump();
    const v1 = human.jumpVelocity;
    creatures.update(1 / 30); // ya despegó (jumpOffset > 0.01)
    creatures.triggerJump(); // debe ser ignorado: no está en el suelo
    expect(human.jumpVelocity).toBeLessThan(v1); // solo bajó por gravedad, no se reinició a JUMP_SPEED
  });

  it('jumpOffset/jumpVelocity no persisten en el guardado (son puramente de animación)', () => {
    const { creatures, human } = setup();
    creatures.triggerJump();
    creatures.update(1 / 30);
    expect(human.jumpOffset).toBeGreaterThan(0);
    const saved = creatures.serialize().creatures.find(c => c.id === human.id);
    expect(saved.jumpOffset).toBeUndefined();
    expect(saved.jumpVelocity).toBeUndefined();
  });
});

describe('cámara de "Vista humana": tercera persona cercana y primera persona', () => {
  function makeRig() {
    vi.stubGlobal('window', { addEventListener() {} });
    const camera = new THREE.PerspectiveCamera(55, 1.6, 0.1, 1000);
    const rig = new CameraRig(camera, { addEventListener() {} }, new THREE.Vector3(5, 2, -3));
    return { camera, rig };
  }
  afterEach(() => vi.unstubAllGlobals());

  it('setCloseFollow acerca la cámara y restaura la distancia/polar previos al salir', () => {
    const { rig } = makeRig();
    rig.distance = 50; rig.polar = 0.3; rig.minDist = 8;
    rig.setCloseFollow(true);
    expect(rig.distance).toBeLessThan(8); // más cerca que el mínimo normal de la cámara RTS
    expect(rig.minDist).toBeLessThan(8);
    rig.setCloseFollow(false);
    expect(rig.distance).toBe(50);
    expect(rig.polar).toBe(0.3);
    expect(rig.minDist).toBe(8);
  });

  it('setFirstPerson solo tiene efecto mientras el close-follow está activo', () => {
    const { rig } = makeRig();
    rig.setFirstPerson(true);
    expect(rig.firstPerson).toBe(false); // sin closeFollow activo, no hay nada que poner en 1a persona
    rig.setCloseFollow(true);
    rig.setFirstPerson(true);
    expect(rig.firstPerson).toBe(true);
    rig.setCloseFollow(false); // salir de "Vista humana" también sale de primera persona
    expect(rig.firstPerson).toBe(false);
  });

  it('en primera persona la cámara se coloca junto al objetivo en vez de a `distance` de él', () => {
    const { camera, rig } = makeRig();
    rig.setCloseFollow(true);
    rig.target.set(10, 2, -4);
    rig.update(0);
    const thirdPersonDistance = camera.position.distanceTo(rig.target);
    expect(thirdPersonDistance).toBeCloseTo(rig.distance, 5);

    rig.setFirstPerson(true);
    rig.update(0);
    expect(camera.position.distanceTo(rig.target)).toBeLessThan(0.5); // pegada al objetivo, no a `distance`
  });
});
