const DEFAULT_COUNTS = Object.freeze({
  entities: 0,
  creatures: 0,
  settlements: 0,
  ships: 0,
  trees: 0,
  visibleCreatures: 0,
  culledCreatures: 0,
  detailedCreatures: 0,
  instancedCreatures: 0,
  simulationSteps: 0,
  droppedSimulationMs: 0,
});

function messageFromError(error) {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

export class RuntimeDiagnostics {
  constructor({ version = 'dev', maxFrameSamples = 90, maxErrors = 20, now = () => Date.now() } = {}) {
    this.version = version;
    this.maxFrameSamples = maxFrameSamples;
    this.maxErrors = maxErrors;
    this.now = now;
    this.frameSamples = [];
    this.errors = [];
    this.counts = { ...DEFAULT_COUNTS };
    this.render = { calls: 0, triangles: 0, geometries: 0, textures: 0 };
    this.performance = {};
    this.cleanupGlobalHandlers = null;
  }

  sampleFrame(deltaSeconds, counts = {}, rendererInfo = {}, performance = {}) {
    this.performance = { ...performance };
    if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) {
      this.frameSamples.push(deltaSeconds);
      if (this.frameSamples.length > this.maxFrameSamples) this.frameSamples.shift();
    }
    this.counts = { ...DEFAULT_COUNTS, ...counts };
    this.render = {
      calls: Number(rendererInfo.render?.calls) || 0,
      triangles: Number(rendererInfo.render?.triangles) || 0,
      geometries: Number(rendererInfo.memory?.geometries) || 0,
      textures: Number(rendererInfo.memory?.textures) || 0,
    };
    return this.snapshot();
  }

  recordError(error, source = 'runtime') {
    const entry = {
      time: this.now(),
      source,
      message: messageFromError(error),
      stack: error instanceof Error ? error.stack || '' : '',
    };
    this.errors.push(entry);
    if (this.errors.length > this.maxErrors) this.errors.shift();
    return entry;
  }

  installGlobalHandlers(target = globalThis, onError = null) {
    this.cleanupGlobalHandlers?.();
    const handleError = event => {
      const entry = this.recordError(event?.error || event?.message || 'Error desconocido', 'window.error');
      onError?.(entry);
    };
    const handleRejection = event => {
      const entry = this.recordError(event?.reason || 'Promesa rechazada', 'unhandledrejection');
      onError?.(entry);
    };
    target.addEventListener?.('error', handleError);
    target.addEventListener?.('unhandledrejection', handleRejection);
    this.cleanupGlobalHandlers = () => {
      target.removeEventListener?.('error', handleError);
      target.removeEventListener?.('unhandledrejection', handleRejection);
      this.cleanupGlobalHandlers = null;
    };
    return this.cleanupGlobalHandlers;
  }

  snapshot() {
    const total = this.frameSamples.reduce((sum, value) => sum + value, 0);
    const averageFrameSeconds = this.frameSamples.length ? total / this.frameSamples.length : 0;
    const sorted = [...this.frameSamples].sort((a, b) => a - b);
    const percentile = fraction => (sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0) * 1000;
    return {
      version: this.version,
      fps: averageFrameSeconds ? 1 / averageFrameSeconds : 0,
      frameMs: averageFrameSeconds * 1000,
      medianFrameMs: percentile(0.5),
      p95FrameMs: percentile(0.95),
      p99FrameMs: percentile(0.99),
      maxFrameMs: percentile(1),
      samples: this.frameSamples.length,
      counts: { ...this.counts },
      render: { ...this.render },
      performance: { ...this.performance },
      errors: this.errors.map(entry => ({ ...entry })),
    };
  }
}
