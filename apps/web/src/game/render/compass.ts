/**
 * Compass strip across the top of the screen (as in PUBG): a thin tick every 5°, a number every
 * 15° and the cardinal letters every 45°, the exact heading under the centre, and the map's
 * marked places as small marks above the ticks at their bearing (clamped to the ends with an
 * arrow when out of the strip). Transparent: only lines and text with a soft shadow.
 */

/** Degrees either side of the centre the strip shows. */
const SPAN = 50;
const CARDINALS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

export interface CompassMark { x: number; z: number; color: string; label?: string }

/** Heading in degrees clockwise from north (−Z) for a camera yaw (0 faces −Z, positive turns left). */
export function compassHeading(yaw: number): number {
  return (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
}

/** Bearing (degrees clockwise from north) from one point to another. */
export function compassBearing(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return ((Math.atan2(toX - fromX, -(toZ - fromZ)) * 180) / Math.PI + 360) % 360;
}

export class Compass {
  private readonly ctx: CanvasRenderingContext2D;
  private last = '';
  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  draw(yaw: number, px: number, pz: number, marks: readonly CompassMark[]): void {
    const heading = compassHeading(yaw);
    const key = `${heading.toFixed(1)}|${Math.round(px)}|${Math.round(pz)}|${marks.length}`;
    if (key === this.last) return;
    this.last = key;
    const dpr = Math.min(2, window.devicePixelRatio || 1), cw = this.canvas.clientWidth || 380, ch = this.canvas.clientHeight || 56;
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) { this.canvas.width = Math.round(cw * dpr); this.canvas.height = Math.round(ch * dpr); }
    const ctx = this.ctx, W = cw, H = ch, perDeg = W / (SPAN * 2), base = 24;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.shadowColor = 'rgba(0,0,0,.85)'; ctx.shadowBlur = 3;
    ctx.lineWidth = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    // Ticks and numbers, faded towards the ends.
    for (let d = Math.ceil((heading - SPAN) / 5) * 5; d <= heading + SPAN; d += 5) {
      const x = W / 2 + (d - heading) * perDeg, deg = ((d % 360) + 360) % 360;
      const fade = 1 - Math.abs(d - heading) / SPAN;
      ctx.globalAlpha = .25 + .75 * fade;
      const cardinal = CARDINALS[deg], major = deg % 15 === 0;
      const len = cardinal ? 10 : major ? 7 : 4;
      ctx.strokeStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, base); ctx.lineTo(Math.round(x) + .5, base + len); ctx.stroke();
      if (cardinal || major) {
        ctx.fillStyle = cardinal ? (deg === 0 ? '#ffcf4a' : '#ffffff') : 'rgba(255,255,255,.8)';
        ctx.font = cardinal ? '700 12px "Roboto Mono", monospace' : '500 10px "Roboto Mono", monospace';
        ctx.fillText(cardinal ?? String(deg), x, base + len + 2);
      }
    }
    ctx.globalAlpha = 1;
    // Marked places above the ticks.
    for (const m of marks) {
      let delta = compassBearing(px, pz, m.x, m.z) - heading;
      delta = ((delta + 540) % 360) - 180;
      const off = Math.abs(delta) > SPAN - 2;
      const x = W / 2 + Math.max(-SPAN + 2, Math.min(SPAN - 2, delta)) * perDeg;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      if (off) { const s = Math.sign(delta); ctx.moveTo(x + s * 5, 15); ctx.lineTo(x - s * 3, 11); ctx.lineTo(x - s * 3, 19); }
      else { ctx.moveTo(x, 20); ctx.lineTo(x - 4, 14); ctx.lineTo(x, 8); ctx.lineTo(x + 4, 14); }
      ctx.closePath(); ctx.fill();
      if (m.label && !off) { ctx.font = '500 9px "Roboto Mono", monospace'; ctx.textBaseline = 'bottom'; ctx.fillText(m.label, x, 8); ctx.textBaseline = 'top'; }
    }
    // The heading itself under a small caret at the centre.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.moveTo(W / 2, base - 1); ctx.lineTo(W / 2 - 4, base - 6); ctx.lineTo(W / 2 + 4, base - 6); ctx.closePath(); ctx.fill();
    ctx.font = '700 12px "Roboto Mono", monospace'; ctx.textBaseline = 'bottom';
    ctx.fillText(String(Math.round(heading) % 360).padStart(3, '0'), W / 2, H);
    ctx.shadowBlur = 0;
  }
}
