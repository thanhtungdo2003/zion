/** Preserve apparent target size: magnification scales the lens focal length, not FOV degrees. */
export function scopeFov(baseFov: number, magnification: number): number {
  return 2 * Math.atan(Math.tan(baseFov * Math.PI / 360) / Math.max(1, magnification)) * 180 / Math.PI;
}
