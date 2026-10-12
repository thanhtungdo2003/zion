import { z } from 'zod';
import { hashString } from '@zion/shared';

/**
 * Bump whenever generation output changes for the same seed. Persisted worlds record the version
 * they were created with so an upgrade never silently reshapes a live map.
 */
export const GENERATOR_VERSION = 4;

export const worldConfigSchema = z
  .object({
    seed: z.number().int().min(0).max(0xffffffff),
    /** World edge length in chunks (32 m each). 128 → 4.096 km. */
    sizeChunks: z.number().int().min(16).max(512),
    seaLevel: z.number().min(0).max(100).default(20),
    generatorVersion: z.number().int().default(GENERATOR_VERSION),
  })
  .strict();

export type WorldConfig = z.infer<typeof worldConfigSchema>;
export type WorldConfigInput = z.input<typeof worldConfigSchema>;

export function parseWorldConfig(input: WorldConfigInput): WorldConfig {
  const cfg = worldConfigSchema.parse(input);
  if (![1, 2, 3, GENERATOR_VERSION].includes(cfg.generatorVersion)) {
    throw new Error(
      `world was created with generator v${cfg.generatorVersion}, this build is v${GENERATOR_VERSION}; ` +
        'migrate the world or run a matching server build',
    );
  }
  return cfg;
}

/** Accepts numeric or textual seeds ("zion-alpha") and returns a u32. */
export function normalizeSeed(seed: string | number): number {
  if (typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff) return seed;
  const s = String(seed).trim();
  if (/^\d+$/.test(s) && Number(s) <= 0xffffffff) return Number(s);
  return hashString(s);
}
