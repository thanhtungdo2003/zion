import { CUSTOM_WEAPON_ID_MAX, CUSTOM_WEAPON_ID_MIN, WEAPON_BY_ITEM, customWeaponSchema, isBuiltinWeapon, registerCustomWeapon, unregisterCustomWeapon, type CustomWeapon } from '@zion/shared';
import type { Db } from '../db/pool';

interface Row { id: string; weapon_id: number; def: unknown; model_format: 'glb' | 'bbmodel'; updated_at: Date; has_model: boolean }

/** A saved weapon as listed to clients (the model is fetched separately; built-in overrides have none). */
export interface StoredWeapon { def: CustomWeapon; version: number; hasModel: boolean }

/** URL of a weapon's model for clients, or null for built-ins (they keep their bundled model). */
export function modelUrl(w: StoredWeapon): string | null {
  return w.hasModel ? `/api/weapons/${w.def.id}/model?v=${w.version}` : null;
}

/** Largest model file accepted from the Studio. */
export const MAX_MODEL_BYTES = 8 * 1024 * 1024;

/**
 * Studio weapons: persisted in Postgres (definition + model bytes) and registered into the shared
 * weapon / item / shop tables, so both game servers and the HTTP API see them immediately.
 */
export class CustomWeaponStore {
  private readonly weapons = new Map<string, StoredWeapon>();
  constructor(private readonly db: Db) {}

  /** Loads and registers every saved weapon (startup). Invalid rows are skipped and reported. */
  async load(onInvalid?: (id: string, err: unknown) => void): Promise<void> {
    const { rows } = await this.db.query<Row>('SELECT id, weapon_id, def, model_format, updated_at, model IS NOT NULL AS has_model FROM custom_weapons ORDER BY weapon_id');
    for (const row of rows) {
      const parsed = customWeaponSchema.safeParse({ ...(row.def as object), id: row.id, weaponId: row.weapon_id, format: row.model_format });
      if (!parsed.success) { onInvalid?.(row.id, parsed.error); continue; }
      registerCustomWeapon(parsed.data);
      this.weapons.set(row.id, { def: parsed.data, version: new Date(row.updated_at).getTime(), hasModel: row.has_model });
    }
  }

  list(): StoredWeapon[] { return [...this.weapons.values()].sort((a, b) => a.def.weaponId - b.def.weaponId); }
  get(id: string): StoredWeapon | undefined { return this.weapons.get(id); }

  /** A free wire id for a new weapon. */
  private nextWeaponId(): number {
    const used = new Set([...this.weapons.values()].map((w) => w.def.weaponId));
    for (let id = CUSTOM_WEAPON_ID_MIN; id <= CUSTOM_WEAPON_ID_MAX; id++) if (!used.has(id)) return id;
    throw new Error('Đã hết chỗ cho vũ khí mới (tối đa 151).');
  }

  /** Creates or updates a weapon; `model` is required for a new one. Returns the saved definition. */
  async save(raw: unknown, model: Buffer | null, actorId: string | null): Promise<StoredWeapon> {
    // Ignore listing-only fields a client may send back with the definition.
    const { modelUrl: _url, ...input } = raw as Partial<CustomWeapon> & { modelUrl?: unknown };
    const existing = typeof input.id === 'string' ? this.weapons.get(input.id) : undefined;
    // Built-ins keep their own id; their model may be swapped for an uploaded one (or kept).
    const builtin = typeof input.id === 'string' && isBuiltinWeapon(input.id);
    const def = customWeaponSchema.parse({ ...input, weaponId: builtin ? WEAPON_BY_ITEM[input.id!] : existing?.def.weaponId ?? this.nextWeaponId() });
    if (!existing && !model && !builtin) throw new Error('Cần tải lên file model.');
    if (model && model.length > MAX_MODEL_BYTES) throw new Error('File model quá lớn (tối đa 8 MB).');
    if (model) validateModel(model, def.format);
    // A built-in re-saved for a newer shipped model drops the model uploaded for the old one.
    const stale = builtin && !model && !!existing?.hasModel && existing.def.model.base !== def.model.base;
    if (stale) await this.db.query('UPDATE custom_weapons SET model = NULL WHERE id = $1', [def.id]);
    const { weaponId: _w, id: _i, format: _f, ...stored } = def;
    const params = [def.id, def.weaponId, JSON.stringify(stored), def.format, actorId];
    const { rows } = model || (builtin && !existing)
      ? await this.db.query<{ updated_at: Date }>(`INSERT INTO custom_weapons(id, weapon_id, def, model, model_format, updated_by) VALUES ($1, $2, $3::jsonb, $6, $4, $5)
          ON CONFLICT(id) DO UPDATE SET def = EXCLUDED.def, model = EXCLUDED.model, model_format = EXCLUDED.model_format, updated_at = now(), updated_by = EXCLUDED.updated_by RETURNING updated_at`, [...params, model])
      : await this.db.query<{ updated_at: Date }>(`UPDATE custom_weapons SET def = $3::jsonb, model_format = CASE WHEN model IS NULL THEN model_format ELSE $4 END, updated_at = now(), updated_by = $5 WHERE id = $1 AND weapon_id = $2 RETURNING updated_at`, params);
    if (!rows.length) throw new Error('Không tìm thấy vũ khí để cập nhật.');
    registerCustomWeapon(def);
    const saved = { def, version: new Date(rows[0]!.updated_at).getTime(), hasModel: !!model || (!stale && !!existing?.hasModel) };
    this.weapons.set(def.id, saved);
    return saved;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.weapons.has(id)) return false;
    await this.db.query('DELETE FROM custom_weapons WHERE id = $1', [id]);
    this.weapons.delete(id);
    unregisterCustomWeapon(id);
    return true;
  }

  async model(id: string): Promise<{ bytes: Buffer; format: 'glb' | 'bbmodel' } | null> {
    const { rows } = await this.db.query<{ model: Buffer | null; model_format: 'glb' | 'bbmodel' }>('SELECT model, model_format FROM custom_weapons WHERE id = $1', [id]);
    return rows[0]?.model ? { bytes: rows[0].model!, format: rows[0].model_format } : null;
  }
}

/** Rejects files that are not what they claim to be (GLB magic / Blockbench JSON with elements). */
export function validateModel(bytes: Buffer, format: 'glb' | 'bbmodel'): void {
  if (format === 'glb') {
    if (bytes.length < 20 || bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) throw new Error('File GLB không hợp lệ.');
    return;
  }
  let json: { elements?: unknown; outliner?: unknown; resolution?: unknown };
  try { json = JSON.parse(bytes.toString('utf8')) as typeof json; } catch { throw new Error('File bbmodel không phải JSON hợp lệ.'); }
  if (!Array.isArray(json.elements) || !Array.isArray(json.outliner) || !json.resolution) throw new Error('File bbmodel thiếu elements / outliner.');
}
