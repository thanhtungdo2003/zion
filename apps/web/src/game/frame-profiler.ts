/**
 * Where a frame's time goes (F3 debug panel): CPU time of the game update, CPU time spent
 * submitting the render, and — where the browser exposes EXT_disjoint_timer_query_webgl2 — the
 * GPU's own time for the frame. Averaged over the HUD interval.
 *
 * Reading it: GPU ms close to the frame time means the graphics card is the limit; update ms
 * large means game logic (characters, physics, network) is; render ms large with low GPU ms
 * means draw-call overhead in the browser.
 */
interface TimerExt { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }

export class FrameProfiler {
  private updateMs = 0; private renderMs = 0; private gpuMs = 0; private frames = 0; private gpuFrames = 0;
  private mark = 0;
  private readonly ext: TimerExt | null;
  private readonly pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;

  constructor(private readonly gl: WebGL2RenderingContext | null) {
    this.ext = gl ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null) : null;
  }

  /** The frame starts (game update begins). */
  begin(): void { this.mark = performance.now(); }

  /** The update is done; the render begins. */
  startRender(): void {
    const now = performance.now();
    this.updateMs += now - this.mark;
    this.mark = now;
    if (this.ext && this.gl && !this.active && this.pending.length < 4) {
      const q = this.gl.createQuery();
      if (q) { this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q); this.active = q; }
    }
  }

  /** The render was submitted. */
  end(): void {
    this.renderMs += performance.now() - this.mark;
    this.frames++;
    const gl = this.gl, ext = this.ext;
    if (!gl || !ext) return;
    if (this.active) { gl.endQuery(ext.TIME_ELAPSED_EXT); this.pending.push(this.active); this.active = null; }
    // Results arrive a few frames later.
    while (this.pending.length && gl.getQueryParameter(this.pending[0]!, gl.QUERY_RESULT_AVAILABLE)) {
      const q = this.pending.shift()!;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { this.gpuMs += Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6; this.gpuFrames++; }
      gl.deleteQuery(q);
    }
  }

  /** Averages since the last call (ms per frame); gpu is null where it cannot be measured. */
  take(): { update: number; render: number; gpu: number | null } {
    const n = Math.max(1, this.frames), out = { update: +(this.updateMs / n).toFixed(1), render: +(this.renderMs / n).toFixed(1), gpu: this.gpuFrames ? +(this.gpuMs / this.gpuFrames).toFixed(1) : null };
    this.updateMs = this.renderMs = this.gpuMs = 0; this.frames = this.gpuFrames = 0;
    return out;
  }
}
