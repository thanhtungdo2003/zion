import { PointLight, type Scene } from 'three';
import { CAMP_ASSET } from '@zion/assets';
import { propTransform, type ChunkData } from '@zion/shared';

/** Fixed light pool: streamed lamps never allocate an unbounded number of shader lights. */
export class CampLights {
  private readonly lights: PointLight[] = [];
  private lastScan = -Infinity;
  /** Lamp posts near the player (world positions), for "is this spot lit?" checks. */
  lamps: ReadonlyArray<{ x: number; y: number; z: number }> = [];
  constructor(private readonly scene: Scene) {
    for (let i = 0; i < 8; i++) {
      const light = new PointLight(0xffd49a, 0, 23, 2);
      light.castShadow = false;
      scene.add(light);
      this.lights.push(light);
    }
  }
  update(chunks: Iterable<ChunkData>, x: number, z: number, night: number, now: number): void {
    if (now - this.lastScan < 250) return;
    this.lastScan = now;
    const lamps: Array<{ x: number; y: number; z: number; d: number }> = [];
    for (const chunk of chunks) for (const prop of chunk.props) {
      const tall = prop.asset === CAMP_ASSET['military-lamp-post'];
      if (!tall && prop.asset !== CAMP_ASSET['straight-lamp-post']) continue;
      const t = propTransform(chunk, prop);
      const d = (t.x - x) ** 2 + (t.z - z) ** 2;
      if (d < 65 * 65) lamps.push({ x: t.x, y: t.y + (tall ? 3.45 : 3.5) * t.scale, z: t.z, d });
    }
    lamps.sort((a, b) => a.d - b.d);
    this.lamps = lamps;
    this.lights.forEach((light, i) => {
      const lamp = lamps[i];
      light.intensity = lamp ? night * 100 : 0;
      if (lamp) light.position.set(lamp.x, lamp.y, lamp.z);
    });
  }
  dispose(): void {
    for (const light of this.lights) { this.scene.remove(light); light.dispose(); }
  }
}
