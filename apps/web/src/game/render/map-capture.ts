/** The maps' look: near-grey with a hint of colour, shared by the minimap and the world map. */

/** Grey with a hint of colour, a little contrast, a cool shadow and a warm light. */
export function mapTone(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const k = Math.min(255, Math.max(0, (l - 128) * 1.12 + 132));
    const t = k / 255;
    data[i] = Math.min(255, k * 0.74 + r * 0.26 + (t - 0.5) * 6);
    data[i + 1] = Math.min(255, k * 0.74 + g * 0.26);
    data[i + 2] = Math.min(255, k * 0.74 + b * 0.26 - (t - 0.5) * 8);
  }
}
