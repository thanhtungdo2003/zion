export type Posture = 0 | 1 | 2; // standing, crouching, prone

/** Two reversible edges instead of six unrelated timers. Time always refers to the source
 * recording, so reversing an interrupted transition continues from exactly the current pose. */
export class PostureMotion {
  private settled: Posture = 0;
  private edge: { low: 0 | 1; time: number } | null = null;

  reset(posture: Posture): void { this.settled = posture; this.edge = null; }

  step(target: Posture, dt: number, duration: (clip: string) => number): { clip: string; time: number; rate: number } | null {
    let remaining = Math.max(0, dt);
    // At most two edges can be crossed, even after a long frame.
    for (let i = 0; i < 3; i++) {
      if (!this.edge) {
        if (target === this.settled) return null;
        const low = Math.min(this.settled, target > this.settled ? this.settled : this.settled - 1) as 0 | 1;
        const length = duration(low === 0 ? 'stand_to_crouch' : 'crouch_to_prone');
        if (!(length > 0)) { this.settled = target; return null; }
        this.edge = { low, time: target > this.settled ? 0 : length };
      }
      const { low } = this.edge;
      const clip = low === 0 ? 'stand_to_crouch' : 'crouch_to_prone';
      const length = duration(clip), rate = target > low ? 1 : -1;
      const available = rate > 0 ? length - this.edge.time : this.edge.time;
      if (remaining < available) {
        this.edge.time += remaining * rate;
        return { clip, time: this.edge.time, rate };
      }
      remaining -= available;
      this.settled = (rate > 0 ? low + 1 : low) as Posture;
      this.edge = null;
    }
    return null;
  }
}
