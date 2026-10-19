import { PointLight, type Scene } from 'three';
import { CAMP_ASSET, LIGHT_SOURCE_ASSET } from '@zion/assets';
import { propTransform, type ChunkData } from '@zion/shared';

/** Fixed light pool: streamed lamps never allocate an unbounded number of shader lights. */
export class CampLights {
  private readonly lights: PointLight[] = [];
  /** Light sources placed in the Studios (their own pool, so lamps never crowd them out). */
  private readonly sources: PointLight[] = [];
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
    for (let i = 0; i < 8; i++) {
      const light = new PointLight(0xffe4b8, 0, 20, 2);
      light.castShadow = false;
      scene.add(light);
      this.sources.push(light);
    }
  }
  update(chunks: Iterable<ChunkData>, x: number, z: number, night: number, now: number): void {
    if (now - this.lastScan < 250) return;
    this.lastScan = now;
    const lamps: Array<{ x: number; y: number; z: number; d: number }> = [];
    const sources: Array<{ x: number; y: number; z: number; d: number; power: number }> = [];
    for (const chunk of chunks) for (const prop of chunk.props) {
      if (prop.asset === LIGHT_SOURCE_ASSET) {
        const t = propTransform(chunk, prop), d = (t.x - x) ** 2 + (t.z - z) ** 2;
        if (d < 110 * 110) sources.push({ x: t.x, y: t.y + .5 * t.scale, z: t.z, d, power: t.scale });
        continue;
      }
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
    // Brightness = the source's scale: it glows by day too, most of all at night.
    sources.sort((a, b) => a.d - b.d);
    this.sources.forEach((light, i) => {
      const src = sources[i];
      light.intensity = src ? src.power * 70 * (.35 + .65 * night) : 0;
      if (src) { light.distance = Math.min(70, 12 + 9 * src.power); light.position.set(src.x, src.y, src.z); }
    });
  }
  dispose(): void {
    for (const light of this.sources) { this.scene.remove(light); light.dispose(); }
    for (const light of this.lights) { this.scene.remove(light); light.dispose(); }
  }
}
