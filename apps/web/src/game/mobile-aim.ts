/** Rank targets in a 60-degree forward cone; Infinity means outside acquisition. */
export function mobileAimScore(dx: number, dz: number, heading: number, range: number): number {
  const distance = Math.hypot(dx, dz);
  if (distance < 0.5 || distance > range) return Infinity;
  const alignment = (-Math.sin(heading) * dx - Math.cos(heading) * dz) / distance;
  if (alignment < Math.cos(Math.PI / 6)) return Infinity;
  return (1 - alignment) * 4 + distance / range;
}
