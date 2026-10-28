import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/pool';
import { LlmClient, redact } from './llm';

/**
 * The Model Studio agent's AI connection, set from the Studio (API key, endpoint, model) or the
 * server environment. The key is stored encrypted (AES-256-GCM, keyed from the server secret)
 * in `server_settings`, never sent back to a browser — only its last four characters — and never
 * logged. A key set in the Studio wins over AI_API_KEY from the environment.
 */
export interface AiEnv { apiKey?: string; baseUrl: string; model: string; timeoutMs: number; retries: number }
export interface AiStatus { configured: boolean; source: 'studio' | 'env' | null; keyHint: string | null; baseUrl: string; model: string }

const KEY = 'model_studio_ai';
/** The gateway's models as model-generator configures them (shown when the list can't be fetched). */
export const DEFAULT_MODELS = ['cx/gpt-5.6-sol', 'cx/gpt-6-astra'];

interface Stored { key?: string; baseUrl?: string; model?: string }

export class AiSettings {
  private stored: Stored = {};
  private apiKey: string | null = null;
  private cached: { client: LlmClient; sig: string } | null = null;
  private models: { at: number; sig: string; list: string[] } | null = null;
  private readonly cipherKey: Buffer;

  constructor(private readonly db: Db, secret: string, private readonly env: AiEnv) {
    this.cipherKey = createHash('sha256').update(`model-studio-ai:${secret}`).digest();
  }

  async load(): Promise<void> {
    const { rows } = await this.db.query<{ value: Stored }>('SELECT value FROM server_settings WHERE key = $1', [KEY]);
    this.stored = rows[0]?.value ?? {};
    this.apiKey = this.stored.key ? this.decrypt(this.stored.key) : null;
  }

  private encrypt(text: string): string {
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', this.cipherKey, iv);
    const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
  }

  private decrypt(blob: string): string | null {
    try {
      const [iv, tag, body] = blob.split('.').map((p) => Buffer.from(p, 'base64'));
      const d = createDecipheriv('aes-256-gcm', this.cipherKey, iv!);
      d.setAuthTag(tag!);
      return Buffer.concat([d.update(body!), d.final()]).toString('utf8');
    } catch { return null; }
  }

  private key(): { key: string; source: 'studio' | 'env' } | null {
    if (this.apiKey) return { key: this.apiKey, source: 'studio' };
    return this.env.apiKey ? { key: this.env.apiKey, source: 'env' } : null;
  }

  status(): AiStatus {
    const k = this.key();
    return { configured: !!k, source: k?.source ?? null, keyHint: k ? `…${k.key.slice(-4)}` : null, baseUrl: this.stored.baseUrl ?? this.env.baseUrl, model: this.stored.model ?? this.env.model };
  }

  /** Changes the connection; `apiKey: ''` removes the Studio key (the environment's applies again). */
  async update(input: { apiKey?: string; baseUrl?: string; model?: string }): Promise<AiStatus> {
    const next: Stored = { ...this.stored };
    if (input.apiKey !== undefined) {
      if (input.apiKey === '') { delete next.key; this.apiKey = null; }
      else { next.key = this.encrypt(input.apiKey); this.apiKey = input.apiKey; }
    }
    if (input.baseUrl !== undefined) { if (input.baseUrl) next.baseUrl = input.baseUrl.replace(/\/$/, ''); else delete next.baseUrl; }
    if (input.model !== undefined) { if (input.model) next.model = input.model; else delete next.model; }
    await this.db.query(`INSERT INTO server_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [KEY, JSON.stringify(next)]);
    this.stored = next;
    this.cached = null; this.models = null;
    return this.status();
  }

  /** The client for the current settings (null without a key). */
  client(): LlmClient | null {
    const k = this.key();
    if (!k) return null;
    const s = this.status(), sig = `${k.key}|${s.baseUrl}|${s.model}`;
    if (this.cached?.sig !== sig) this.cached = { sig, client: new LlmClient({ apiKey: k.key, baseUrl: s.baseUrl, model: s.model, timeoutMs: this.env.timeoutMs, retries: this.env.retries, temperature: .3 }) };
    return this.cached.client;
  }

  /** Models to switch to when the current one keeps failing (listed by the endpoint, else known). */
  fallbackModels(): string[] {
    const current = this.status().model;
    const known = this.models?.list ?? [];
    return [...new Set([...DEFAULT_MODELS.filter((m) => known.length === 0 || known.includes(m)), ...known.filter((m) => /gpt|claude|sonnet|opus|gemini/i.test(m))])].filter((m) => m !== current);
  }

  /**
   * The models the endpoint offers (OpenAI-compatible `GET /models`), cached five minutes; the
   * known defaults when it cannot be listed. `error` says why it could not.
   */
  async listModels(fetchImpl: typeof fetch = fetch): Promise<{ models: string[]; error: string | null }> {
    const k = this.key(), s = this.status(), sig = `${k?.key ?? ''}|${s.baseUrl}`;
    if (this.models && this.models.sig === sig && Date.now() - this.models.at < 5 * 60_000) return { models: this.models.list, error: null };
    const fallback = [...new Set([s.model, ...DEFAULT_MODELS])];
    if (!k) return { models: fallback, error: 'Chưa có API key.' };
    try {
      const res = await fetchImpl(`${s.baseUrl}/models`, { headers: { authorization: `Bearer ${k.key}` }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return { models: fallback, error: redact(`Máy chủ AI trả ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`, k.key) };
      const body = await res.json() as { data?: Array<{ id?: string }> };
      const list = [...new Set((body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0))].sort();
      if (!list.length) return { models: fallback, error: 'Máy chủ AI không trả danh sách model.' };
      this.models = { at: Date.now(), sig, list };
      return { models: list, error: null };
    } catch (err) {
      return { models: fallback, error: redact(`Không kết nối được máy chủ AI: ${(err as Error).message}`, k.key) };
    }
  }
}
