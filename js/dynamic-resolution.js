// Bounded resolution control with a settling interval and separate up/down
// thresholds. It never changes simulation density or the CSS/DOM interface.
export class DynamicResolution {
  constructor() { this.reset(); }
  reset() { this.scale = 1; this.averageMs = null; this.elapsed = 0; this.settle = 3; }
  sample(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > .25) return null;
    if (this.settle > 0) { this.settle -= seconds; return null; }
    const ms = seconds * 1000;
    this.averageMs = this.averageMs == null ? ms : this.averageMs * .95 + ms * .05;
    this.elapsed += seconds;
    if (this.elapsed < 2) return null;
    this.elapsed = 0;
    let scale = this.scale;
    if (this.averageMs > 35) scale = Math.max(.5, scale - .1);
    else if (this.averageMs < 24) scale = Math.min(1, scale + .05);
    scale = Math.round(scale * 100) / 100;
    if (scale === this.scale) return null;
    this.scale = scale; this.settle = 1; this.averageMs = null;
    return scale;
  }
}
