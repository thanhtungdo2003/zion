import { DEFAULT_HAND_STUDIO, handStudioSchema, type HandStudio } from '@zion/shared';
import type { Db } from '../db/pool';

/** The Studio's hand poses and animations (one row), kept in memory for the public endpoint. */
export class HandStudioStore {
  /** The built-in poses until the Studio saves its own. */
  private data: HandStudio = DEFAULT_HAND_STUDIO;
  private version = 0;
  constructor(private readonly db: Db) {}

  async load(): Promise<void> {
    const { rows } = await this.db.query<{ data: unknown; updated_at: Date }>('SELECT data, updated_at FROM hand_studio WHERE id = 1');
    const parsed = rows[0] ? handStudioSchema.safeParse(rows[0].data) : null;
    if (parsed?.success) { this.data = parsed.data; this.version = rows[0]!.updated_at.getTime(); }
  }

  get(): { studio: HandStudio; version: number } { return { studio: this.data, version: this.version }; }

  async save(raw: unknown, accountId: string | null): Promise<{ studio: HandStudio; version: number }> {
    const data = handStudioSchema.parse(raw);
    const { rows } = await this.db.query<{ updated_at: Date }>(
      `INSERT INTO hand_studio (id, data, updated_by, updated_at) VALUES (1, $1::jsonb, $2, now())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING updated_at`,
      [JSON.stringify(data), accountId],
    );
    this.data = data; this.version = rows[0]!.updated_at.getTime();
    return this.get();
  }
}
