import { hash3, smoothstep } from '@zion/shared';

/** World-aligned bedrock relief, evaluated before roads, water and building pads are applied.
 * These are heightfield vertices, shared by collision and every terrain LOD, never loose props.
 * Cell sizes stay above the 4 m far-LOD spacing; the 1 m near mesh resolves the clefts and ledges.
 */
export class BedrockRelief {
  constructor(private readonly seed: number) {}

  displacement(x: number, z: number, height: number, exposure: number, aridity = 0): number {
    const mask = smoothstep(.12, .65, exposure);
    if (mask === 0) return 0;
    const cell = 17, gx = Math.floor(x / cell), gz = Math.floor(z / cell);
    let first = Infinity, second = Infinity, plate = 0;
    for (let j = gz - 1; j <= gz + 1; j++) for (let i = gx - 1; i <= gx + 1; i++) {
      const h = hash3(this.seed, i, j, 0xbed0), k = hash3(this.seed, i, j, 0x57a7);
      const sx = (i + .2 + (h & 65535) / 65535 * .6) * cell;
      const sz = (j + .2 + (h >>> 16) / 65535 * .6) * cell;
      // An anisotropic metric produces angular jointed slabs rather than round boulders.
      const dx = x - sx, dz = z - sz;
      const distance = Math.max(Math.abs(dx * .86 + dz * .5), Math.abs(dz * .86 - dx * .5)) + Math.hypot(dx, dz) * .18;
      if (distance < first) { second = first; first = distance; plate = k / 0xffffffff; }
      else if (distance < second) second = distance;
    }
    const joint = second - first;
    const cleft = (1 - smoothstep(.15, 1.7, joint)) * (1.4 + plate * 1.3);
    const block = Math.max(0, 1 - first / 12) * (3.5 + plate * 4.5);
    // Bedding planes follow elevation with a shallow tilt. Narrow ramps are real rock faces.
    const bed = height + x * .055 + z * .028, thickness = 3.2 + aridity * 1.8;
    const phase = ((bed % thickness) + thickness) % thickness / thickness;
    const ledge = (smoothstep(.72, .97, phase) - phase) * thickness;
    return mask * (block - cleft + ledge * (.7 + aridity * .5));
  }
}
