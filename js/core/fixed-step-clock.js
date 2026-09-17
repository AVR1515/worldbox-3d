export class FixedStepClock {
  constructor({ stepSeconds = 1 / 30, maxStepsPerFrame = 8, maxFrameSeconds = 0.1 } = {}) {
    if (!(stepSeconds > 0)) throw new RangeError('El paso fijo debe ser mayor que cero');
    this.stepSeconds = stepSeconds;
    this.maxStepsPerFrame = Math.max(1, Math.trunc(maxStepsPerFrame));
    this.maxFrameSeconds = Math.max(stepSeconds, Number(maxFrameSeconds) || 0.1);
    this.accumulator = 0;
    this.simulatedSeconds = 0;
    this.droppedSeconds = 0;
  }

  reset() {
    this.accumulator = 0;
    this.simulatedSeconds = 0;
    this.droppedSeconds = 0;
  }

  // Read-only preview of how many fixed steps advance() would run for the same arguments,
  // without consuming the accumulator — lets a caller (GameRuntime) know in advance how many
  // times per-step work (like creatures.js's pathfinding queue drain) is about to run this frame,
  // so it can divide a fixed per-frame budget across them instead of paying it once per step.
  predictSteps(realDeltaSeconds, speed) {
    const elapsed = Number.isFinite(realDeltaSeconds) ? Math.max(0, realDeltaSeconds) : 0;
    const realDelta = Math.min(this.maxFrameSeconds, elapsed);
    const scale = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    if (!realDelta || !scale) return 0;
    let remaining = this.accumulator + realDelta * scale, steps = 0;
    while (remaining + Number.EPSILON >= this.stepSeconds && steps < this.maxStepsPerFrame) {
      remaining -= this.stepSeconds;
      steps++;
    }
    return steps;
  }

  advance(realDeltaSeconds, speed, step) {
    const elapsed = Number.isFinite(realDeltaSeconds) ? Math.max(0, realDeltaSeconds) : 0;
    const realDelta = Math.min(this.maxFrameSeconds, elapsed);
    const scale = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    if (!realDelta || !scale) return this.snapshot(0);
    this.droppedSeconds += (elapsed - realDelta) * scale;

    this.accumulator += realDelta * scale;
    let steps = 0;
    while (this.accumulator + Number.EPSILON >= this.stepSeconds && steps < this.maxStepsPerFrame) {
      step(this.stepSeconds);
      this.accumulator -= this.stepSeconds;
      this.simulatedSeconds += this.stepSeconds;
      steps++;
    }

    // maxStepsPerFrame already bounds how much CPU a single frame can spend catching up (that's
    // what avoids the frame-rate spiral described above). This separate carry limit used to be
    // only 2 steps' worth, which meant any backlog beyond that was discarded permanently instead
    // of being paid back once load dropped — under sustained low FPS the accumulator hit this
    // ceiling every frame, simulated time froze indefinitely, and it never caught up even after
    // FPS recovered (confirmed live: droppedSeconds grew without bound while "Día" stayed at 1).
    // A much larger carry lets a real backlog (a rough patch, a big battle) get paid off gradually
    // over subsequent frames at up to maxStepsPerFrame extra steps each, instead of vanishing.
    const maxCarry = this.stepSeconds * 150;
    if (this.accumulator > maxCarry) {
      this.droppedSeconds += this.accumulator - maxCarry;
      this.accumulator = maxCarry;
    }
    return this.snapshot(steps);
  }

  snapshot(steps = 0) {
    return {
      steps,
      alpha: Math.max(0, Math.min(1, this.accumulator / this.stepSeconds)),
      simulatedSeconds: this.simulatedSeconds,
      droppedSeconds: this.droppedSeconds,
      backlogSeconds: this.accumulator,
      stepSeconds: this.stepSeconds,
    };
  }
}
