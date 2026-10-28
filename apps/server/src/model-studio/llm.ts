/**
 * Chat client for an OpenAI-compatible endpoint, after model-generator's `src/llm/client.ts`
 * (D:\AEMINE_PROJECT\model-generator, MIT): JSON-object responses streamed (long reasoning keeps
 * the connection alive instead of idling into a gateway timeout), whole-request retries with
 * exponential backoff and jitter on 408/409/429/5xx and network resets, a hard timeout, the key
 * only in the Authorization header and redacted from every error. The key, base URL and model
 * come from the server's environment (AI_API_KEY, AI_BASE_URL, AI_MODEL) — never the browser.
 */
export interface LlmConfig { apiKey: string; baseUrl: string; model: string; timeoutMs: number; retries: number; temperature: number }
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatResult { text: string; model: string; usage?: { prompt: number; completion: number; total: number } }

export class LlmError extends Error {
  /** `filtered`: the provider's safety filter withheld the answer (with the categories it named). */
  constructor(message: string, readonly status?: number, readonly retryable = false, readonly filtered?: string) { super(message); this.name = 'LlmError'; }
}

const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

export function redact(text: string, secret: string): string {
  return secret && secret.length > 6 ? text.split(secret).join('***') : text;
}

/** Claude models on the gateway think with a medium budget (keeps the stream from idling out). */
function reasoningEffort(model: string): string | undefined { return /claude/i.test(model) ? 'medium' : undefined; }

export class LlmClient {
  constructor(readonly config: LlmConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async complete(messages: ChatMessage[], opts: CallOptions = {}): Promise<ChatResult> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < Math.max(1, this.config.retries); attempt++) {
      if (opts.signal?.aborted) throw new LlmError('Đã hủy.');
      try { return await this.once(messages, opts); }
      catch (err) {
        lastErr = err;
        const retry = err instanceof LlmError ? err.retryable : true;
        if (!retry || attempt + 1 >= this.config.retries || opts.signal?.aborted) break;
        const wait = Math.min(15000, 1000 * 2 ** attempt) * (.75 + Math.random() * .5);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr instanceof LlmError ? lastErr : new LlmError(redact(String((lastErr as Error)?.message ?? lastErr), this.config.apiKey), undefined, false);
  }

  private async once(messages: ChatMessage[], opts: CallOptions): Promise<ChatResult> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const modelId = opts.model ?? this.config.model, effort = reasoningEffort(modelId);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.apiKey}`, accept: 'text/event-stream' },
        body: JSON.stringify({
          model: modelId, messages, temperature: opts.temperature ?? this.config.temperature,
          response_format: { type: 'json_object' }, stream: true, stream_options: { include_usage: true },
          ...(opts.maxTokens ? { max_completion_tokens: opts.maxTokens } : {}), ...(effort ? { reasoning_effort: effort } : {}),
        }),
      });
    } catch (err) {
      const e = err as Error;
      throw new LlmError(redact(timeout.aborted ? `Hết thời gian chờ AI (${Math.round(this.config.timeoutMs / 1000)} s).` : `Không kết nối được AI: ${e.message}`, this.config.apiKey), undefined, !opts.signal?.aborted);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new LlmError(redact(`AI trả lỗi ${res.status}: ${body.slice(0, 300)}`, this.config.apiKey), res.status, RETRYABLE.has(res.status));
    }
    const type = res.headers.get('content-type') ?? '';
    // A gateway may ignore `stream` and answer with one JSON body.
    if (!type.includes('event-stream')) {
      const json = await res.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string; content_filter_results?: unknown }>; prompt_filter_results?: unknown; model?: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
      const text = json.choices?.[0]?.message?.content ?? '';
      if (json.choices?.[0]?.finish_reason === 'content_filter') throw filterError(filterCategories(json.choices[0].content_filter_results, json.prompt_filter_results));
      if (!text) throw new LlmError('AI trả về rỗng.', undefined, true);
      return { text, model: json.model ?? this.config.model, ...(json.usage ? { usage: { prompt: json.usage.prompt_tokens, completion: json.usage.completion_tokens, total: json.usage.total_tokens } } : {}) };
    }
    const reader = res.body!.getReader(), decoder = new TextDecoder();
    let buf = '', text = '', reasoning = '', model = modelId, usage: ChatResult['usage'], seen = 0, finish = '', filters: unknown = null, promptFilters: unknown = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const chunk = JSON.parse(data) as { model?: string; choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; finish_reason?: string | null; content_filter_results?: unknown }>; prompt_filter_results?: unknown; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
          if (chunk.choices?.[0]?.content_filter_results) filters = chunk.choices[0].content_filter_results;
          if (chunk.prompt_filter_results) promptFilters = chunk.prompt_filter_results;
          if (chunk.model) model = chunk.model;
          const d = chunk.choices?.[0]?.delta;
          if (d?.content) text += d.content;
          if (d?.reasoning_content && reasoning.length < 200_000) reasoning += d.reasoning_content;
          if (chunk.choices?.[0]?.finish_reason) finish = chunk.choices[0].finish_reason;
          seen += (d?.content?.length ?? 0) + (d?.reasoning_content?.length ?? 0);
          if (chunk.usage) usage = { prompt: chunk.usage.prompt_tokens, completion: chunk.usage.completion_tokens, total: chunk.usage.total_tokens };
        } catch { /* keep-alive or partial line */ }
      }
      opts.onProgress?.(seen);
    }
    // Some gateways leave the answer in the reasoning stream: use it when it holds the JSON.
    if (!text.trim() && reasoning.includes('{')) text = reasoning.slice(reasoning.indexOf('{'));
    if (finish === 'content_filter') throw filterError(filterCategories(filters, promptFilters));
    if (!text.trim()) throw new LlmError(`AI trả về rỗng${finish === 'length' ? ' (hết giới hạn token khi đang suy nghĩ)' : finish ? ` (${finish})` : ''}.`, undefined, true);
    return { text, model, ...(usage ? { usage } : {}) };
  }
}

export interface CallOptions { signal?: AbortSignal; maxTokens?: number; onProgress?: (chars: number) => void; model?: string; temperature?: number }

/** Which safety categories were flagged (Azure-style filter results on the answer or the prompt). */
export function filterCategories(answer: unknown, prompt: unknown): string {
  const out = new Set<string>();
  const scan = (v: unknown, where: string) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const x of v) scan((x as { content_filter_results?: unknown }).content_filter_results ?? x, where); return; }
    for (const [k, r] of Object.entries(v as Record<string, { filtered?: boolean; detected?: boolean; severity?: string }>)) {
      if (r && typeof r === 'object' && (r.filtered || r.detected || (r.severity && r.severity !== 'safe'))) out.add(`${where}${k}${r.severity && r.severity !== 'safe' ? `:${r.severity}` : ''}`);
    }
  };
  scan(answer, '');
  scan(prompt, 'prompt/');
  return [...out].join(', ');
}

function filterError(categories: string): LlmError {
  return new LlmError(`Bộ lọc an toàn của nhà cung cấp AI chặn câu trả lời${categories ? ` (${categories})` : ''}.`, undefined, false, categories || 'unspecified');
}

/**
 * The JSON object in a model's answer: as is, from a fenced block, or the outermost balanced
 * braces, with trailing commas forgiven (after model-generator's `parser.ts`).
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const tryParse = (s: string) => { try { const v = JSON.parse(s) as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null; } catch { return null; } };
  const direct = tryParse(raw.trim());
  if (direct) return direct;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  if (fence) { const f = tryParse(fence[1]!.trim()); if (f) return f; }
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      const body = raw.slice(start, i + 1);
      return tryParse(body) ?? tryParse(body.replace(/,\s*([}\]])/g, '$1'));
    }
  }
  return null;
}
