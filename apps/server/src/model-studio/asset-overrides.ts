import type { AssetRegistry } from '@zion/assets';
import type { Db } from '../db/pool';

/**
 * Changes to the game's own models made from the Model Studio ("Tài nguyên game"):
 * - replace: the model is drawn from another file (fitted to the original's size; its
 *   collision stays the original's),
 * - variant: another file mixed in among the model's instances (a share of them by weight),
 * - hide: the model is taken out of the game (neither drawn nor colliding).
 * Clients read the list and the files (public); the server leaves hidden models out of collision.
 */
export interface AssetOverride { id: number; base: number; kind: 'replace' | 'variant' | 'hide'; name: string; weight: number; version: number; bytes: number }

/** Models taken out of the game: read by every world's collision (physics-manager.ts). */
export const HIDDEN_ASSETS = new Set<number>();

const MAX_PER_BASE = 8;

export class AssetOverrideStore {
  private list: AssetOverride[] = [];
  constructor(private readonly db: Db, private readonly registry: AssetRegistry) {}

  async load(): Promise<void> {
    const { rows } = await this.db.query<{ id: number; base: number; kind: AssetOverride['kind']; name: string; weight: number; updated_at: Date; bytes: number | null }>(
      'SELECT id, base, kind, name, weight, updated_at, octet_length(glb) AS bytes FROM asset_overrides ORDER BY id');
    this.list = rows.map((r) => ({ id: r.id, base: r.base, kind: r.kind, name: r.name, weight: r.weight, version: new Date(r.updated_at).getTime(), bytes: r.bytes ?? 0 }));
    HIDDEN_ASSETS.clear();
    for (const o of this.list) if (o.kind === 'hide') HIDDEN_ASSETS.add(o.base);
  }

  all(): AssetOverride[] { return this.list; }

  async file(id: number): Promise<Buffer | null> {
    const { rows } = await this.db.query<{ glb: Buffer | null }>('SELECT glb FROM asset_overrides WHERE id = $1', [id]);
    return rows[0]?.glb ?? null;
  }

  async add(base: number, kind: AssetOverride['kind'], name: string, glb: Buffer | null, weight = 1): Promise<AssetOverride> {
    if (!this.registry.byNumericId(base)) throw Object.assign(new Error('Model không tồn tại.'), { statusCode: 404 });
    if (kind !== 'hide' && (!glb || glb.length < 20 || glb.toString('ascii', 0, 4) !== 'glTF')) throw Object.assign(new Error('Cần một file .glb hợp lệ.'), { statusCode: 400 });
    if (this.list.filter((o) => o.base === base).length >= MAX_PER_BASE) throw Object.assign(new Error(`Tối đa ${MAX_PER_BASE} thay đổi cho một model.`), { statusCode: 400 });
    // One replacement and one "hidden" per model: a new one takes the old one's place.
    if (kind !== 'variant') await this.db.query('DELETE FROM asset_overrides WHERE base = $1 AND kind = $2', [base, kind]);
    await this.db.query('INSERT INTO asset_overrides (base, kind, name, weight, glb) VALUES ($1, $2, $3, $4, $5)', [base, kind, name.slice(0, 80), Math.max(.05, Math.min(10, weight)), kind === 'hide' ? null : glb]);
    await this.load();
    return this.list.filter((o) => o.base === base && o.kind === kind).at(-1)!;
  }

  async update(id: number, patch: { name?: string; weight?: number }): Promise<void> {
    await this.db.query('UPDATE asset_overrides SET name = COALESCE($2, name), weight = COALESCE($3, weight), updated_at = now() WHERE id = $1',
      [id, patch.name?.slice(0, 80) ?? null, patch.weight === undefined ? null : Math.max(.05, Math.min(10, patch.weight))]);
    await this.load();
  }

  async remove(id: number): Promise<void> {
    await this.db.query('DELETE FROM asset_overrides WHERE id = $1', [id]);
    await this.load();
  }
}
