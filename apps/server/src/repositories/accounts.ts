import { withTransaction, type Db } from '../db/pool';

export type SocialProvider = 'google' | 'facebook';

export interface Account {
  id: string;
  username: string;
  passwordHash: string | null;
  isGuest: boolean;
  role: 'player' | 'moderator' | 'admin';
  failedLogins: number;
  lockedUntil: Date | null;
  bannedUntil: Date | null;
  banReason: string | null;
}

interface AccountRow {
  id: string;
  username: string;
  password_hash: string | null;
  is_guest: boolean;
  role: Account['role'];
  failed_logins: number;
  locked_until: Date | null;
  banned_until: Date | null;
  ban_reason: string | null;
}

const COLUMNS = 'id, username, password_hash, is_guest, role, failed_logins, locked_until, banned_until, ban_reason';

function map(r: AccountRow): Account {
  return {
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    isGuest: r.is_guest,
    role: r.role,
    failedLogins: r.failed_logins,
    lockedUntil: r.locked_until,
    bannedUntil: r.banned_until,
    banReason: r.ban_reason,
  };
}

/** All queries are parameterised; no SQL is ever built from user input. */
export class AccountRepository {
  constructor(private readonly db: Db) {}

  async identities(id: string): Promise<SocialProvider[]> {
    const { rows } = await this.db.query<{ provider: SocialProvider }>('SELECT provider FROM account_identities WHERE account_id = $1 ORDER BY provider', [id]);
    return rows.map(r => r.provider);
  }

  /** Never match by name/email: linking requires an already authenticated account UUID. */
  async social(provider: SocialProvider, subject: string, username: string, accountId?: string): Promise<Account | null> {
    try {
      return await withTransaction(this.db, async client => {
        // Serialize first sign-ins of the same identity to avoid orphaned accounts.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${provider}:${subject}`]);
        const existing = await client.query<{ account_id: string }>('SELECT account_id FROM account_identities WHERE provider = $1 AND subject = $2', [provider, subject]);
        const owner = existing.rows[0]?.account_id;
        if (owner && accountId && owner !== accountId) return null;
        let id = owner ?? accountId;
        if (!id) {
          const created = await client.query<{ id: string }>('INSERT INTO accounts (username, is_guest) VALUES ($1, false) RETURNING id', [username]);
          id = created.rows[0]!.id;
        }
        if (!owner) await client.query('INSERT INTO account_identities (provider, subject, account_id) VALUES ($1, $2, $3)', [provider, subject, id]);
        const { rows } = await client.query<AccountRow>(`UPDATE accounts SET is_guest = false, last_login_at = now() WHERE id = $1 RETURNING ${COLUMNS}`, [id]);
        return rows[0] ? map(rows[0]) : null;
      });
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return null;
      throw err;
    }
  }

  async findByUsername(username: string): Promise<Account | null> {
    const { rows } = await this.db.query<AccountRow>(
      `SELECT ${COLUMNS} FROM accounts WHERE username_lower = lower($1)`,
      [username],
    );
    return rows[0] ? map(rows[0]) : null;
  }

  async findById(id: string): Promise<Account | null> {
    const { rows } = await this.db.query<AccountRow>(`SELECT ${COLUMNS} FROM accounts WHERE id = $1`, [id]);
    return rows[0] ? map(rows[0]) : null;
  }

  /** Returns null if the username is already taken. */
  async create(username: string, passwordHash: string | null, isGuest: boolean): Promise<Account | null> {
    const { rows } = await this.db.query<AccountRow>(
      `INSERT INTO accounts (username, password_hash, is_guest)
       VALUES ($1, $2, $3)
       ON CONFLICT (username_lower) DO NOTHING
       RETURNING ${COLUMNS}`,
      [username, passwordHash, isGuest],
    );
    return rows[0] ? map(rows[0]) : null;
  }

  async recordLoginSuccess(id: string): Promise<void> {
    await this.db.query(
      'UPDATE accounts SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [id],
    );
  }

  /** Increments the failure counter and locks the account once `threshold` is reached. */
  async recordLoginFailure(id: string, threshold: number, lockSeconds: number): Promise<{ locked: boolean }> {
    const { rows } = await this.db.query<{ failed_logins: number; locked_until: Date | null }>(
      `UPDATE accounts
          SET failed_logins = failed_logins + 1,
              locked_until = CASE WHEN failed_logins + 1 >= $2
                                  THEN now() + make_interval(secs => $3) ELSE locked_until END
        WHERE id = $1
        RETURNING failed_logins, locked_until`,
      [id, threshold, lockSeconds],
    );
    const r = rows[0];
    return { locked: !!r && r.failed_logins >= threshold };
  }
}
