// Optional, asynchronous WebGL2 timings. Never waits for the GPU or calls finish().
export class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.extension = typeof gl.createQuery === 'function' ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null;
    this.pending = [];
    this.active = null;
    this.lastMs = null;
  }

  begin() {
    const gl = this.gl, ext = this.extension;
    if (!ext || this.active) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) { this.clear(); return; }
    while (this.pending.length && gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = this.pending.shift();
      this.lastMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(query);
    }
    if (this.pending.length >= 4) return;
    this.active = gl.createQuery();
    if (this.active) gl.beginQuery(ext.TIME_ELAPSED_EXT, this.active);
  }

  end() {
    if (!this.active) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active); this.active = null;
  }

  clear() {
    this.end();
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending.length = 0; this.lastMs = null;
  }
}
