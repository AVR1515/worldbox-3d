import { EventBus } from './core/event-bus.js';
import { FixedStepClock } from './core/fixed-step-clock.js';

export class GameRuntime {
  constructor({ world, creatures, settlements, ships, civilization = null, statuses = null, cataclysms = null, events = new EventBus(), onStep = null } = {}) {
    this.world = world;
    this.creatures = creatures;
    this.settlements = settlements;
    this.ships = ships;
    this.civilization = civilization;
    this.statuses = statuses;
    this.cataclysms = cataclysms;
    this.events = events;
    this.onStep = onStep;
    // Capped at 4 (was 10): once a frame runs long — many entities, fast-forward speed — the
    // clock tries to "catch up" by running extra fixed steps in that same frame, which makes
    // the frame take even longer, which demands even more catch-up steps next frame. That
    // spiral is what dropped FPS to ~10 under load. A lower cap means the simulation can fall
    // slightly behind real time in the worst case instead of compounding into a frame-rate
    // collapse.
    this.clock = new FixedStepClock({ stepSeconds: 1 / 30, maxStepsPerFrame: 4, maxFrameSeconds: 0.1 });
    this.lastFrame = this.clock.snapshot();
    // Opt-in per-subsystem timing (C-08): off by default so normal play and every existing
    // benchmark/test keeps zero extra performance.now() overhead. The benchmark harness flips
    // this on to find which subsystem dominates simulationMs before picking an optimization.
    this.profileSystems = false;
    this.lastSystemTimings = null;
  }

  update(realDeltaSeconds, speed = 1) {
    const timings = this.profileSystems
      ? { world: 0, creatures: 0, settlements: 0, civilization: 0, statuses: 0, cataclysms: 0, ships: 0 }
      : null;
    // Fast-forward (or the clock's own catch-up after a slow frame) can run up to
    // maxStepsPerFrame simulation steps inside one rendered frame. creatures.js's pathfinding
    // queue drain is the dominant simulation cost under real (non-flat) terrain (see C-13,
    // HISTORIAL-PROGRESO.md) and used to spend its full per-step budget every one of those steps,
    // multiplying straight into the frame's total cost — exactly what made higher game speeds
    // drop FPS far more than the extra simulated time alone would. Telling it in advance how many
    // steps are coming lets it divide its fixed per-frame budget across them instead.
    const stepsThisFrame = Math.max(1, this.clock.predictSteps(realDeltaSeconds, speed));
    this.lastFrame = this.clock.advance(realDeltaSeconds, speed, dt => {
      if (timings) {
        let t = performance.now();
        this.world?.update(dt); timings.world += performance.now() - t; t = performance.now();
        this.creatures?.update(dt, stepsThisFrame); timings.creatures += performance.now() - t; t = performance.now();
        this.settlements?.update(dt); timings.settlements += performance.now() - t; t = performance.now();
        this.civilization?.update(dt); timings.civilization += performance.now() - t; t = performance.now();
        this.statuses?.update(dt); timings.statuses += performance.now() - t; t = performance.now();
        this.cataclysms?.update(dt); timings.cataclysms += performance.now() - t; t = performance.now();
        this.ships?.update(dt); timings.ships += performance.now() - t;
      } else {
        this.world?.update(dt);
        this.creatures?.update(dt, stepsThisFrame);
        this.settlements?.update(dt);
        this.civilization?.update(dt);
        this.statuses?.update(dt);
        this.cataclysms?.update(dt);
        this.ships?.update(dt);
      }
      this.onStep?.(dt);
      this.events.emit('simulation:step', { dt });
    });
    if (timings) this.lastSystemTimings = timings;
    return this.lastFrame;
  }

  updateVisuals(realDeltaSeconds, camera = null) {
    this.world?.updateVisuals(realDeltaSeconds, camera);
    this.settlements?.updateVisuals?.(realDeltaSeconds);
    this.creatures?.updateVisuals?.(camera, realDeltaSeconds);
  }

  resetClock() {
    this.clock.reset();
    this.lastFrame = this.clock.snapshot();
  }

  dispose() {
    this.events.clear();
  }

  snapshot() {
    return { ...this.lastFrame };
  }
}
