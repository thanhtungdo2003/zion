import type { CampNpcLayout, CampPart } from '@zion/worldgen';
import type { Db } from '../db/pool';

/** Camp Studio edits: one saved layout per world (absent = the generated default). */
export class CampLayoutRepository {
  constructor(
    private readonly db: Db,
    private readonly worldId: string,
  ) {}

  async load(): Promise<{ parts: CampPart[]; npcs: CampNpcLayout | null; updatedAt: string } | null> {
    const { rows } = await this.db.query<{ layout: CampPart[] | { parts: CampPart[]; npcs?: CampNpcLayout | null }; updated_at: Date }>(
      'SELECT layout, updated_at FROM camp_layouts WHERE world_id = $1',
      [this.worldId],
    );
    const r = rows[0];
    if (!r) return null;
    const l = Array.isArray(r.layout) ? { parts: r.layout, npcs: null } : { parts: r.layout.parts, npcs: r.layout.npcs ?? null };
    return { ...l, updatedAt: r.updated_at.toISOString() };
  }

  async save(parts: readonly CampPart[], npcs: CampNpcLayout | null, accountId: string | null): Promise<void> {
    await this.db.query(
      `INSERT INTO camp_layouts (world_id, layout, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (world_id) DO UPDATE SET layout = EXCLUDED.layout, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [this.worldId, JSON.stringify({ parts, npcs }), accountId],
    );
  }

  async clear(): Promise<void> {
    await this.db.query('DELETE FROM camp_layouts WHERE world_id = $1', [this.worldId]);
  }
}
