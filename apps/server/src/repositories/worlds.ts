import type { Db } from '../db/pool';

export interface WorldRecord {
  id: string;
  seed: number;
  config: { sizeChunks: number; seaLevel: number };
  generatorVersion: number;
  worldTimeMs: number;
}

interface Row {
  id: string;
  seed: string;
  config: { sizeChunks: number; seaLevel: number };
  generator_version: number;
  world_time_ms: string;
}

const map = (r: Row): WorldRecord => ({
  id: r.id,
  seed: Number(r.seed),
  config: r.config,
  generatorVersion: r.generator_version,
  worldTimeMs: Number(r.world_time_ms),
});

export class WorldRepository {
  constructor(private readonly db: Db) {}

  async find(id: string): Promise<WorldRecord | null> {
    const { rows } = await this.db.query<Row>(
      'SELECT id, seed, config, generator_version, world_time_ms FROM worlds WHERE id = $1',
      [id],
    );
    return rows[0] ? map(rows[0]) : null;
  }

  /** Inserts the world if absent; returns the persisted record either way. */
  async findOrCreate(rec: Omit<WorldRecord, 'worldTimeMs'> & { worldTimeMs: number }): Promise<WorldRecord> {
    await this.db.query(
      `INSERT INTO worlds (id, seed, config, generator_version, world_time_ms)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [rec.id, rec.seed, JSON.stringify(rec.config), rec.generatorVersion, rec.worldTimeMs],
    );
    const found = await this.find(rec.id);
    if (!found) throw new Error(`world ${rec.id} could not be created`);
    return found;
  }

  /** Player structures standing in this world (base building). */
  async loadStructures(id: string): Promise<import('@zion/shared').StructureState[]> {
    const { rows } = await this.db.query<{ structures: unknown }>('SELECT structures FROM worlds WHERE id = $1', [id]);
    return Array.isArray(rows[0]?.structures) ? rows[0]!.structures as import('@zion/shared').StructureState[] : [];
  }

  async saveStructures(id: string, list: readonly import('@zion/shared').StructureState[]): Promise<void> {
    await this.db.query('UPDATE worlds SET structures = $2::jsonb, updated_at = now() WHERE id = $1', [id, JSON.stringify(list)]);
  }

  async saveTime(id: string, worldTimeMs: number): Promise<void> {
    await this.db.query('UPDATE worlds SET world_time_ms = $2, updated_at = now() WHERE id = $1', [
      id,
      Math.floor(worldTimeMs),
    ]);
  }
}
