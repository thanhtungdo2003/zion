/** The maps' look, shared by the minimap and the world map. */

/**
 * Tactical-map tone: a dark slate grey with a cool teal cast, keeping only a hint of each
 * thing's own colour (woods a touch greener, sand a touch warmer), relief left in the lightness.
 */
export function mapTone(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const k = Math.min(255, Math.max(0, (l - 128) * 1.05 + 86));
    data[i] = Math.min(255, k * 0.8 + r * 0.14 - 4);
    data[i + 1] = Math.min(255, k * 0.8 + g * 0.14 + 3);
    data[i + 2] = Math.min(255, k * 0.8 + b * 0.14 + 7);
  }
}
