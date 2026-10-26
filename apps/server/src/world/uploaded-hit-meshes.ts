import type { HitMeshData } from '@zion/assets';

/**
 * Triangles of the uploaded map models in use (filled when a map on one is built): every match's
 * collision world adds them, so players walk and shoot through the model's real gaps.
 */
export const uploadedHitMeshes = new Map<number, HitMeshData>();
