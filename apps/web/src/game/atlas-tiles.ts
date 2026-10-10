import type { AtlasTile } from '@zion/shared';
import { getAtlasTile } from '@/lib/api';

/** Only queue the current viewport; cap concurrent downloads and retained detail tiles. */
export class AtlasTiles {
  readonly tiles = new Map<string, AtlasTile>();
  private wanted: string[] = [];
  private active = new Set<string>();
  private failed = new Map<string, number>();
  private disposed = false;
  constructor(private readonly worldId: string, private readonly changed: () => void) {}
  setVisible(keys: string[]): void {
    this.wanted = keys;
    for (const key of keys) {
      const tile = this.tiles.get(key);
      if (tile) { this.tiles.delete(key); this.tiles.set(key, tile); }
    }
    this.pump();
  }
  private pump(): void {
    if (this.disposed) return;
    for (const key of this.wanted) {
      if (this.active.size >= 2) break;
      if (this.tiles.has(key) || this.active.has(key) || (this.failed.get(key) ?? 0) > Date.now()) continue;
      const [x, z] = key.split(':').map(Number);
      this.active.add(key);
      void getAtlasTile(x, z).then((tile) => {
        if (this.disposed) return;
        if (tile.worldId !== this.worldId) throw new Error('Map world changed');
        this.tiles.set(key, tile);
        while (this.tiles.size > 96) this.tiles.delete(this.tiles.keys().next().value!);
        this.failed.delete(key);
        this.changed();
      }).catch(() => {
        // Keep the overview visible; avoid hammering a failing endpoint during gestures.
        this.failed.set(key, Date.now() + 30_000);
        while (this.failed.size > 96) this.failed.delete(this.failed.keys().next().value!);
      }).finally(() => { this.active.delete(key); this.pump(); });
    }
  }
  dispose(): void { this.disposed = true; this.wanted = []; this.tiles.clear(); }
}
