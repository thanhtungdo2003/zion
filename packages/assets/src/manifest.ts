import { z } from 'zod';

/** Output of the asset pipeline (`pnpm assets:build`), served to clients as /assets/manifest.json. */
export const assetManifestSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.string(),
    files: z.record(
      z.string(),
      z
        .object({
          url: z.string().regex(/^\/assets\/models\/[a-z0-9_\-/.]+$/),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          bytes: z.number().int().nonnegative(),
          kind: z.enum(['glb', 'bbmodel']),
        })
        .strict(),
    ),
  })
  .strict();

export type AssetManifest = z.infer<typeof assetManifestSchema>;

export const ASSET_MANIFEST_URL = '/assets/manifest.json';
// Authored building packs can contain embedded textures and several structures.
// This is a build-time validation ceiling, not a preload budget: clients load on demand.
export const MAX_GLB_BYTES = 64 * 1024 * 1024;
export const MAX_BBMODEL_BYTES = 8 * 1024 * 1024;
