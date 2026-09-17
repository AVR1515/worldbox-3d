import { afterEach, describe, expect, it, vi } from 'vitest';
import { GamepadInput, readGamepadIntent } from '../../js/gamepad-input.js';

function pad({ axes = [0, 0, 0, 0], buttons = {}, mapping = 'standard' } = {}) {
  const list = [];
  for (let i = 0; i <= 15; i++) list[i] = { pressed: false, value: 0 };
  for (const [index, value] of Object.entries(buttons)) {
    list[index] = typeof value === 'number' ? { pressed: value > 0, value } : { pressed: Boolean(value), value: value ? 1 : 0 };
  }
  return { mapping, axes, buttons: list };
}

describe('readGamepadIntent()', () => {
  it('devuelve null sin mando o con un mapeo no estándar', () => {
    expect(readGamepadIntent(null)).toBeNull();
    expect(readGamepadIntent(pad({ mapping: 'xinput-ish' }))).toBeNull();
  });

  it('aplica zona muerta a los sticks: valores pequeños se anulan, los grandes se reescalan', () => {
    const small = readGamepadIntent(pad({ axes: [0.1, -0.1, 0, 0] }));
    expect(small.moveX).toBe(0);
    expect(small.moveY).toBe(0);
    const big = readGamepadIntent(pad({ axes: [1, 0, 0, 0] }));
    expect(big.moveX).toBeCloseTo(1); // (1 - 0.18) / (1 - 0.18) == 1
    const half = readGamepadIntent(pad({ axes: [0.59, 0, 0, 0] })); // (0.59-0.18)/0.82
    expect(half.moveX).toBeCloseTo(0.5, 2);
  });

  it('calcula el zoom como RT (acercar) menos LT (alejar)', () => {
    expect(readGamepadIntent(pad({ buttons: { 6: 0.8, 7: 0.2 } })).zoomDelta).toBeCloseTo(-0.6); // LT>RT: alejar
    expect(readGamepadIntent(pad({ buttons: { 6: 0, 7: 1 } })).zoomDelta).toBeCloseTo(1); // solo RT: acercar
  });

  it('detecta "recién pulsado" solo el frame en que cambia de suelto a pulsado', () => {
    const first = readGamepadIntent(pad({ buttons: { 9: true } })); // Start
    expect(first.startJustPressed).toBe(true);
    const second = readGamepadIntent(pad({ buttons: { 9: true } }), first.nowPressed); // sigue pulsado
    expect(second.startJustPressed).toBe(false);
    const third = readGamepadIntent(pad({ buttons: {} }), second.nowPressed); // se soltó
    expect(third.startJustPressed).toBe(false);
    const fourth = readGamepadIntent(pad({ buttons: { 9: true } }), third.nowPressed); // pulsado de nuevo
    expect(fourth.startJustPressed).toBe(true);
  });
});

describe('GamepadInput', () => {
  // Node has its own read-only global `navigator` (no getGamepads), so this can't be reassigned
  // or deleted directly — vi.stubGlobal swaps it out and vi.unstubAllGlobals() restores the real
  // one afterwards, instead of permanently destroying the binding for later tests in this file.
  afterEach(() => { vi.unstubAllGlobals(); });

  function withPad(gamepadState) {
    vi.stubGlobal('navigator', { getGamepads: () => [gamepadState] });
  }

  function makeRig() {
    return { keys: {}, aerial: false, azimuth: 0, polar: 0.3, distance: 40, minDist: 8, maxDist: 240 };
  }

  it('mueve la cámara con el stick izquierdo igual que WASD, sin pisar teclas que ya sostiene el teclado', () => {
    const rig = makeRig();
    rig.keys.KeyD = true; // el teclado ya sostiene "derecha" por su cuenta
    withPad(pad({ axes: [-1, -1, 0, 0] })); // stick izquierdo arriba-izquierda
    const input = new GamepadInput({ rig });

    input.update(1 / 60);
    expect(rig.keys.KeyW).toBe(true);
    expect(rig.keys.KeyA).toBe(true);
    expect(rig.keys.KeyD).toBe(true); // intacta: el mando nunca la tocó

    withPad(pad({ axes: [0, 0, 0, 0] })); // suelta el stick
    input.update(1 / 60);
    expect(rig.keys.KeyW).toBe(false); // el propio mando la liberó
    expect(rig.keys.KeyA).toBe(false);
    expect(rig.keys.KeyD).toBe(true); // el teclado la sigue sosteniendo: el mando jamás la libera
  });

  it('un mando conectado pero con el stick centrado no mueve la cámara del teclado', () => {
    const rig = makeRig();
    rig.keys.KeyW = true; // el teclado sostiene "adelante"
    withPad(pad({ axes: [0, 0, 0, 0] }));
    const input = new GamepadInput({ rig });

    input.update(1 / 60);
    expect(rig.keys.KeyW).toBe(true); // sigue como lo dejó el teclado
  });

  it('el stick derecho orbita la cámara, salvo en vista aérea', () => {
    const rig = makeRig();
    withPad(pad({ axes: [0, 0, 1, -1] }));
    const input = new GamepadInput({ rig });

    input.update(1);
    expect(rig.azimuth).toBeLessThan(0);
    expect(rig.polar).toBeLessThan(0.3);

    rig.aerial = true;
    const azimuthBefore = rig.azimuth;
    input.update(1);
    expect(rig.azimuth).toBe(azimuthBefore); // no gira en vista aérea
  });

  it('los gatillos hacen zoom dentro de los límites de distancia del rig', () => {
    const rig = makeRig();
    withPad(pad({ buttons: { 7: 1 } })); // RT a fondo: acercar
    const input = new GamepadInput({ rig });
    input.update(1);
    expect(rig.distance).toBeLessThan(40);
    expect(rig.distance).toBeGreaterThanOrEqual(rig.minDist);
  });

  it('allowCamera:false congela el movimiento propio del mando sin tocar el del teclado', () => {
    const rig = makeRig();
    rig.keys.KeyS = true; // teclado
    withPad(pad({ axes: [1, 0, 0, 0] })); // mando pide "derecha" (KeyD)
    const input = new GamepadInput({ rig });
    input.update(1 / 60, { allowCamera: false });
    expect(rig.keys.KeyD).toBeUndefined(); // el mando no llegó a pulsarla porque la cámara está bloqueada
    expect(rig.keys.KeyS).toBe(true); // el teclado no se ve afectado
  });

  it('Start dispara onStart una sola vez por pulsación física, no en cada frame que sigue pulsado', () => {
    const rig = makeRig();
    const starts = [];
    const input = new GamepadInput({ rig, onStart: () => starts.push(1) });
    withPad(pad({ buttons: { 9: true } }));
    input.update(1 / 60);
    input.update(1 / 60);
    expect(starts).toHaveLength(1);
    withPad(pad({ buttons: {} }));
    input.update(1 / 60);
    withPad(pad({ buttons: { 9: true } }));
    input.update(1 / 60);
    expect(starts).toHaveLength(2);
  });

  it('el D-pad izquierda/derecha llama a onSpeedChange(-1)/(+1)', () => {
    const rig = makeRig();
    const changes = [];
    const input = new GamepadInput({ rig, onSpeedChange: direction => changes.push(direction) });
    withPad(pad({ buttons: { 15: true } })); // derecha
    input.update(1 / 60);
    withPad(pad({ buttons: { 14: true } })); // izquierda
    input.update(1 / 60);
    expect(changes).toEqual([1, -1]);
  });

  it('sin ningún mando conectado, no hace nada (ni lanza error)', () => {
    const rig = makeRig();
    const input = new GamepadInput({ rig });
    expect(() => input.update(1 / 60)).not.toThrow();
    expect(rig.keys.KeyW).toBeUndefined();
  });
});
