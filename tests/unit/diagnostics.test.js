import { describe, expect, it, vi } from 'vitest';
import { RuntimeDiagnostics } from '../../js/diagnostics.js';

describe('RuntimeDiagnostics', () => {
  it('conserva cuadros largos y calcula percentiles sobre una ventana acotada', () => {
    const diagnostics = new RuntimeDiagnostics({ maxFrameSamples: 100 });
    diagnostics.sampleFrame(9);
    for (let i = 1; i <= 100; i++) diagnostics.sampleFrame(i / 50);
    expect(diagnostics.snapshot()).toMatchObject({ samples: 100, medianFrameMs: 1000, p95FrameMs: 1900, p99FrameMs: 1980, maxFrameMs: 2000 });
  });
  it('calcula FPS y conserva las métricas más recientes', () => {
    const diagnostics = new RuntimeDiagnostics({ maxFrameSamples: 3 });
    diagnostics.sampleFrame(1 / 60, { entities: 12, creatures: 9 }, {
      render: { calls: 7, triangles: 450 },
      memory: { geometries: 4, textures: 2 },
    });
    diagnostics.sampleFrame(1 / 60, { entities: 14, creatures: 10 }, {
      render: { calls: 8, triangles: 500 },
      memory: { geometries: 5, textures: 3 },
    });

    const result = diagnostics.snapshot();
    expect(result.fps).toBeCloseTo(60, 4);
    expect(result.frameMs).toBeCloseTo(1000 / 60, 4);
    expect(result.counts).toMatchObject({ entities: 14, creatures: 10 });
    expect(result.render).toEqual({ calls: 8, triangles: 500, geometries: 5, textures: 3 });
  });

  it('limita el historial de errores y escucha fallos globales', () => {
    const listeners = new Map();
    const target = {
      addEventListener: vi.fn((name, handler) => listeners.set(name, handler)),
      removeEventListener: vi.fn((name) => listeners.delete(name)),
    };
    const diagnostics = new RuntimeDiagnostics({ maxErrors: 2, now: () => 100 });
    const onError = vi.fn();
    const cleanup = diagnostics.installGlobalHandlers(target, onError);

    listeners.get('error')({ message: 'uno' });
    listeners.get('unhandledrejection')({ reason: new Error('dos') });
    listeners.get('error')({ message: 'tres' });

    expect(diagnostics.snapshot().errors.map(error => error.message)).toEqual(['dos', 'tres']);
    expect(onError).toHaveBeenCalledTimes(3);
    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledTimes(2);
  });
});
