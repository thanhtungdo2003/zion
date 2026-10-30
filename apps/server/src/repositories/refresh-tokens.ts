import type { Db } from '../db/pool';
import { withTransaction } from '../db/pool';

export interface RefreshTokenRecord {
  id: string;
  accountId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}

interface Row {
  id: string;
  account_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
}

const map = (r: Row): RefreshTokenRecord => ({
  id: r.id,
  accountId: r.account_id,
  familyId: r.family_id,
  expiresAt: r.expires_at,
  revokedAt: r.revoked_at,
  replacedBy: r.replaced_by,
});

export type RotateResult =
  | { status: 'ok'; accountId: string; familyId: string; newId: string }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'reused'; accountId: string; familyId: string };

/** How long after rotation the previous token is still accepted (a crashed or lagging client retrying). */
const ROTATION_GRACE_MS = 5 * 60_000;

/**
 * Refresh tokens are stored only as SHA-256 hashes. Rotation is atomic (row lock); presenting an
 * already-rotated token revokes the whole family, which defeats stolen-token replay — except
 * within a short grace after its rotation (see ROTATION_GRACE_MS).
 */
export class RefreshTokenRepository {
  constructor(private readonly db: Db) {}

  async create(params: {
    accountId: string;
    familyId: string;
    tokenHash: Buffer;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  }): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO refresh_tokens (account_id, family_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [params.accountId, params.familyId, params.tokenHash, params.expiresAt, params.userAgent, params.ip],
    );
    return rows[0]!.id;
  }

  async rotate(params: {
    tokenHash: Buffer;
    newTokenHash: Buffer;
    expiresAt: Date;
    userAgent: string | null;
    ip: string | null;
  }): Promise<RotateResult> {
    return withTransaction(this.db, async (c) => {
      const { rows } = await c.query<Row>(
        `SELECT id, account_id, family_id, expires_at, revoked_at, replaced_by
           FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [params.tokenHash],
      );
      const row = rows[0];
      if (!row) return { status: 'invalid' } as const;
      const rec = map(row);
      // Rotated moments ago but the new cookie never reached the browser (it crashed or lost the
      // response mid-load, or two tabs refreshed together): a benign retry while the family is still
      // live, not a replay. It gets a fresh token in the same family instead of revoking the session.
      if (rec.replacedBy && rec.revokedAt && Date.now() - rec.revokedAt.getTime() < ROTATION_GRACE_MS) {
        const live = await c.query('SELECT 1 FROM refresh_tokens WHERE family_id = $1 AND revoked_at IS NULL AND expires_at > now() LIMIT 1', [rec.familyId]);
        if (live.rows.length) {
          const ins = await c.query<{ id: string }>(
            `INSERT INTO refresh_tokens (account_id, family_id, token_hash, expires_at, user_agent, ip)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
            [rec.accountId, rec.familyId, params.newTokenHash, params.expiresAt, params.userAgent, params.ip],
          );
          return { status: 'ok', accountId: rec.accountId, familyId: rec.familyId, newId: ins.rows[0]!.id } as const;
        }
      }
      if (rec.revokedAt || rec.replacedBy) {
        await c.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [
          rec.familyId,
        ]);
        return { status: 'reused', accountId: rec.accountId, familyId: rec.familyId } as const;
      }
      if (rec.expiresAt.getTime() <= Date.now()) return { status: 'expired' } as const;
      const ins = await c.query<{ id: string }>(
        `INSERT INTO refresh_tokens (account_id, family_id, token_hash, expires_at, user_agent, ip)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [rec.accountId, rec.familyId, params.newTokenHash, params.expiresAt, params.userAgent, params.ip],
      );
      const newId = ins.rows[0]!.id;
      await c.query('UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE id = $1', [rec.id, newId]);
      return { status: 'ok', accountId: rec.accountId, familyId: rec.familyId, newId } as const;
    });
  }

  async revokeByHash(tokenHash: Buffer): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked_at = now()
        WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL`,
      [tokenHash],
    );
  }

  async revokeAllForAccount(accountId: string): Promise<void> {
    await this.db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL', [
      accountId,
    ]);
  }

  async purgeExpired(): Promise<number> {
    const res = await this.db.query(`DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'`);
    return res.rowCount ?? 0;
  }
}
