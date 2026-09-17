import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../js/core/event-bus.js';
import { FixedStepClock } from '../../js/core/fixed-step-clock.js';
import { SpatialIndex } from '../../js/core/spatial-index.js';
import { GameRuntime } from '../../js/game-runtime.js';
import { generateBaseTerrain } from '../../js/world-generation.js';

describe('infraestructura de simulación de la fase 2', () => {
  it('contabiliza todo el tiempo perdido por el límite de cuadro', () => {
    const clock = new FixedStepClock();
    const result = clock.advance(0.5, 2, () => {});
    expect(result.droppedSeconds).toBeCloseTo(0.8);
    expect(result.simulatedSeconds + result.backlogSeconds + result.droppedSeconds).toBeCloseTo(1);
  });

  it('la pausa no consume retraso y resetClock actualiza la instantánea', () => {
    const runtime = new GameRuntime();
    runtime.update(0.1, 5);
    const before = runtime.snapshot();
    runtime.update(60, 0);
    expect(runtime.snapshot()).toEqual({ ...before, steps: 0 });
    runtime.resetClock();
    expect(runtime.snapshot()).toMatchObject({ steps: 0, simulatedSeconds: 0, droppedSeconds: 0, backlogSeconds: 0 });
  });
  it('avanza con pasos fijos sin depender del framerate', () => {
    const clock = new FixedStepClock({ stepSeconds: 0.1, maxStepsPerFrame: 5, maxFrameSeconds: 1 });
    const steps = [];
    clock.advance(0.16, 1, dt => steps.push(dt));
    clock.advance(0.04, 1, dt => steps.push(dt));
    expect(steps).toEqual([0.1, 0.1]);
    expect(clock.snapshot().simulatedSeconds).toBeCloseTo(0.2);
  });

  it('limita el trabajo de un solo fotograma pero conserva el retraso recuperable en vez de descartarlo', () => {
    // Antes, cualquier retraso por encima de maxStepsPerFrame se descartaba de inmediato: bajo FPS
    // sostenido bajo, el tiempo simulado quedaba congelado para siempre aunque el framerate luego
    // se recuperara (confirmado jugando en vivo: droppedSimulationMs crecía sin parar y "Día" no
    // avanzaba). Ahora maxStepsPerFrame sigue acotando el trabajo de ESTE fotograma, pero el resto
    // del retraso se conserva y se recupera en fotogramas siguientes.
    const clock = new FixedStepClock({ stepSeconds: 0.1, maxStepsPerFrame: 2, maxFrameSeconds: 1 });
    const step = vi.fn();
    const first = clock.advance(1, 1, step);
    expect(first.steps).toBe(2);
    expect(first.droppedSeconds).toBe(0);
    for (let i = 0; i < 10; i++) clock.advance(0.001, 1, step);
    const final = clock.snapshot();
    expect(final.simulatedSeconds).toBeGreaterThan(0.99);
    expect(final.droppedSeconds).toBe(0);
  });

  it('sigue descartando tiempo cuando el retraso supera el margen amplio de recuperación', () => {
    const clock = new FixedStepClock({ stepSeconds: 0.1, maxStepsPerFrame: 2, maxFrameSeconds: 20 });
    const step = vi.fn();
    const result = clock.advance(20, 1, step);
    expect(result.droppedSeconds).toBeGreaterThan(0);
  });

  it('consulta solamente entidades vecinas mediante partición espacial', () => {
    const index = new SpatialIndex(5).rebuild([
      { id: 1, x: 0, z: 0, type: 'human' },
      { id: 2, x: 3, z: 4, type: 'orc' },
      { id: 3, x: 50, z: 50, type: 'human' },
    ]);
    expect(index.queryRadius(0, 0, 5).map(item => item.id).sort()).toEqual([1, 2]);
    expect(index.nearest(0, 0, 10, item => item.type === 'orc')?.id).toBe(2);
  });

  it('desacopla publicaciones y suscripciones de eventos', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const off = bus.on('world:changed', listener);
    bus.emit('world:changed', { x: 2 });
    off();
    bus.emit('world:changed', { x: 3 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('coordina todos los sistemas desde un runtime único', () => {
    const calls = [];
    const system = name => ({ update: dt => calls.push([name, dt]) });
    const runtime = new GameRuntime({
      world: system('world'), creatures: system('creatures'), settlements: system('settlements'), ships: system('ships'),
    });
    runtime.update(1 / 30, 1);
    expect(calls.map(([name]) => name)).toEqual(['world', 'creatures', 'settlements', 'ships']);
  });

  it('no mide tiempos por subsistema salvo que se active profileSystems (C-08)', () => {
    const system = () => ({ update: () => {} });
    const runtime = new GameRuntime({ world: system(), creatures: system() });
    runtime.update(1 / 30, 1);
    expect(runtime.lastSystemTimings).toBeNull();

    runtime.profileSystems = true;
    runtime.update(1 / 30, 1);
    expect(runtime.lastSystemTimings).toMatchObject({
      world: expect.any(Number), creatures: expect.any(Number), settlements: expect.any(Number),
      civilization: expect.any(Number), statuses: expect.any(Number), cataclysms: expect.any(Number), ships: expect.any(Number),
    });
  });

  it('genera los mismos datos base para una misma semilla', () => {
    const options = { size: 24, seed: 4872, mapType: 'continents', mountainLevel: 1 };
    const first = generateBaseTerrain(options);
    const second = generateBaseTerrain(options);
    expect([...first.height]).toEqual([...second.height]);
    expect([...first.moisture]).toEqual([...second.moisture]);
    expect(first.rngState).toBe(second.rngState);
  });
});
