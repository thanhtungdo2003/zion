import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry } from '@zion/assets';
import { GENERATOR_VERSION } from '@zion/worldgen';
import { ChunkPriority, WorldService } from './world-service';
import type { Logger } from '../logger';

const log = { info() {}, warn() {}, error() {}, debug() {}, child() { return log; } } as unknown as Logger;
const config = { seed: 77, sizeChunks: 16, seaLevel: 20, mode: 'battle-royale' as const, generatorVersion: GENERATOR_VERSION };

describe('baked fixed-map chunks', () => {
  it('generates a chunk once: kept on disk, read back by a later server instead of generated', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'zion-bake-'));
    try {
      const a = new WorldService(config, createDefaultRegistry(), 0, 64, log);
      a.bakeTo(dir);
      const first = await a.getChunk(5, 6, 0, ChunkPriority.Lod0);
      expect(a.stats.generated).toBe(1);
      await new Promise((r) => setTimeout(r, 200));
      const b = new WorldService(config, createDefaultRegistry(), 0, 64, log);
      b.bakeTo(dir);
      const again = await b.getChunk(5, 6, 0, ChunkPriority.Lod0);
      expect(b.stats.generated).toBe(0);
      expect(b.stats.baked).toBe(1);
      expect(Array.from(again.data.heights)).toEqual(Array.from(first.data.heights));
      expect(again.data.props).toEqual(first.data.props);
      // The background bake fills the rest of the map (every LOD).
      await b.bake();
      const files = (await readdir(dir, { recursive: true })).filter((f) => f.endsWith('.bin'));
      expect(files.length).toBeGreaterThanOrEqual(16 * 16 * 3 * .5);
      await a.close(); await b.close();
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 300_000);
});
