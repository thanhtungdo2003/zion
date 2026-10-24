import { DEFAULT_GEAR_FIT, gearFitSchema, type GearFit } from '@zion/shared';
import type { Db } from '../db/pool';

/** The Studio's gear fitting (one row), kept in memory for the public endpoint. */
export class GearFitStore {
  /** The shipped fitting until the Studio saves one. */
  private fit: GearFit = DEFAULT_GEAR_FIT;
  private version = 0;
  constructor(private readonly db: Db) {}

  async load(): Promise<void> {
    const { rows } = await this.db.query<{ data: unknown; updated_at: Date }>('SELECT data, updated_at FROM gear_fit WHERE id = 1');
    const parsed = rows[0] ? gearFitSchema.safeParse(rows[0].data) : null;
    if (parsed?.success) { this.fit = parsed.data; this.version = rows[0]!.updated_at.getTime(); }
  }

  get(): { fit: GearFit; version: number } { return { fit: this.fit, version: this.version }; }

  async save(raw: unknown, accountId: string | null): Promise<{ fit: GearFit; version: number }> {
    const fit = gearFitSchema.parse(raw);
    const { rows } = await this.db.query<{ updated_at: Date }>(
      `INSERT INTO gear_fit (id, data, updated_by, updated_at) VALUES (1, $1::jsonb, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING updated_at`,
      [JSON.stringify(fit), accountId],
    );
    this.fit = fit; this.version = rows[0]!.updated_at.getTime();
    return this.get();
  }
}
