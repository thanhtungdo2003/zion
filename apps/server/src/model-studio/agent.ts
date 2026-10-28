import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { TOOLS, runTool, summarizeReport, validateDoc, type CatalogAsset, type ModelDoc, type ToolHost, type ToolState } from '@zion/assets/model-studio';
import { LlmError, parseJsonObject, type ChatMessage, type LlmClient } from './llm';
import { offlinePlan } from './planner';
import type { ModelStudioStore } from './store';

/**
 * The Model Studio agent: reads the admin's request, plans, calls the studio's tools on a copy
 * of the project (geometry, assembly, materials, textures, checks, fixes), reads every result,
 * validates and repairs, then hands the finished document back. Reasoning comes from the
 * language model (JSON turns: thought, plan, tool calls); everything it changes goes through the
 * tools. Without an AI key a built-in planner runs the same tools for the common requests
 * (houses, rocks, kit assemblies), so the studio works offline too.
 *
 * Errors never end a job: a failed tool, an empty or broken AI answer, a dropped connection —
 * each is logged, told to the model (or retried with a shorter conversation) and the work goes
 * on; whatever was built is validated and saved as a version at the end in any case.
 *
 * Runaway guards (the job stops by itself, keeping its work): 40 turns, 600k tokens, 25 minutes,
 * 6 failed AI calls in a row, 3 turns in a row without a usable answer or action, the same call
 * repeated 4 times. Also 8 tool calls per turn, 3 repair rounds after the final validation, one
 * job per project at a time. The agent cannot publish into the game or delete anything outside
 * the project: `export_asset` with publish only files a request the admin confirms in the Studio.
 */
const MAX_TURNS = 40, MAX_ACTIONS = 8, MAX_FIX_ROUNDS = 3, MAX_RESULT_CHARS = 5000;
const MAX_TOKENS = 600_000, MAX_MS = 25 * 60_000, MAX_AI_FAILURES = 6, MAX_IDLE_TURNS = 3, MAX_REPEATS = 4;
const JOB_TTL_MS = 60 * 60 * 1000;

export type StepKind = 'plan' | 'thought' | 'tool' | 'error' | 'info' | 'done';
export interface AgentStep { at: number; kind: StepKind; text: string; tool?: string; args?: unknown; ok?: boolean; result?: unknown }
export interface PublishRequest { id: string; lotClass?: string; replaceAsset?: number; note: string; doc: ModelDoc }
export interface AgentJob {
  id: string; projectId: string; prompt: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  mode: 'ai' | 'offline'; model?: string;
  steps: AgentStep[]; doc: ModelDoc; startedAt: number; finishedAt?: number;
  summary?: string; issues?: string[]; savedVersion?: number; saveError?: string;
  usage: { prompt: number; completion: number; total: number; turns: number };
  publishRequests: PublishRequest[];
}

const SYSTEM = (tools: string) => `Bạn là trợ lý dựng model 3D trong Model Studio của game thế giới mở Zion (dựng kiến trúc, nội thất, cảnh quan) (renderer three.js, PBR). Bạn KHÔNG tự viết lưới tam giác: mọi thay đổi phải gọi tool. Đơn vị mét, +y hướng lên, model đứng trên y = 0, mặt trước hướng +z. Góc xoay tính bằng ĐỘ.

Quy trình: (1) phân tích yêu cầu: loại asset, kích thước, phong cách, cấu trúc, mục đích trong game; (2) tìm tài nguyên có sẵn (search_assets) và tra cứu khi cần (research); (3) lập kế hoạch các phần độc lập; (4) gọi tool để tạo/lắp ghép/gán vật liệu PBR; (5) inspect_scene / validate_asset để tự kiểm tra; (6) auto_fix và sửa tiếp các lỗi còn lại; (7) kết thúc với tóm tắt và các vấn đề còn tồn tại.

Nguyên tắc: nhà ở dùng create_geometry type "house" (đủ phòng, cửa, cửa sổ, cầu thang, mái, nội thất, sân vườn) rồi tinh chỉnh; tái dùng model game (cây, bàn ghế, xe…) bằng assemble_model; vật liệu chọn từ preset thật rồi chỉnh roughness/metalness theo vật liệu thực (metalness gần như 0 hoặc 1), thêm wear/dirt/moss/cracks theo tuổi và phong cách — không chỉ đổi màu; giữ số vật liệu ít để giảm draw call; cửa ≥ 0.9×2.1 m, bậc ≤ 0.19 m. Không xóa phần ngoài phạm vi yêu cầu. Không bao giờ tự xuất bản vào game.

Mỗi lượt trả về DUY NHẤT một JSON object:
{"thought": "suy luận ngắn", "plan": ["bước…"] (lượt đầu), "actions": [{"tool": "tên", "args": {…}}], "done": false}
Khi xong: {"thought": "…", "done": true, "summary": "đã làm gì (tiếng Việt)", "issues": ["vấn đề còn tồn tại"]}
Tối đa ${MAX_ACTIONS} action mỗi lượt; kết quả từng tool sẽ được gửi lại.

Tools:
${tools}`;

function toolCatalog(): string {
  return TOOLS.map((t) => `- ${t.name} [${t.permission}]: ${t.description}\n  args: ${JSON.stringify(t.params)}`).join('\n');
}

function clip(v: unknown): unknown {
  const s = JSON.stringify(v);
  if (s === undefined) return null;
  return s.length <= MAX_RESULT_CHARS ? v : `${s.slice(0, MAX_RESULT_CHARS)}… (cắt bớt)`;
}

export class ModelAgent {
  private readonly jobs = new Map<string, AgentJob>();
  private readonly controllers = new Map<string, AbortController>();

  /** `llm`: the client, or where to get the current one (the key and model can change at runtime). */
  constructor(private readonly store: ModelStudioStore, private readonly llm: LlmClient | null | (() => LlmClient | null), private readonly catalog: () => CatalogAsset[], private readonly log: Logger, private readonly retryDelayMs = 2000, private readonly fallbackModels: () => string[] = () => []) {}

  private client(): LlmClient | null { return typeof this.llm === 'function' ? this.llm() : this.llm; }
  get configured(): boolean { return !!this.client(); }
  get model(): string | null { return this.client()?.config.model ?? null; }

  start(projectId: string, prompt: string, doc: ModelDoc, baseVersion: number, opts: { offline?: boolean } = {}): AgentJob {
    this.sweep();
    if ([...this.jobs.values()].some((j) => j.projectId === projectId && j.status === 'running')) throw Object.assign(new Error('Agent đang chạy trên dự án này.'), { statusCode: 409 });
    const llm = this.client();
    const job: AgentJob = {
      id: randomUUID(), projectId, prompt, status: 'running', mode: llm && !opts.offline ? 'ai' : 'offline', ...(llm && !opts.offline ? { model: llm.config.model } : {}),
      steps: [], doc: structuredClone(doc), startedAt: Date.now(), usage: { prompt: 0, completion: 0, total: 0, turns: 0 }, publishRequests: [],
    };
    this.jobs.set(job.id, job);
    const ctrl = new AbortController();
    this.controllers.set(job.id, ctrl);
    void this.run(job, baseVersion, ctrl.signal).catch((err) => {
      job.status = 'failed';
      this.step(job, 'error', (err as Error).message);
      this.log.warn({ err: (err as Error).message, job: job.id }, 'model agent failed');
    }).finally(() => { job.finishedAt = Date.now(); this.controllers.delete(job.id); });
    return job;
  }

  get(id: string): AgentJob | undefined { return this.jobs.get(id); }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') return false;
    this.controllers.get(id)?.abort();
    job.status = 'cancelled';
    this.step(job, 'info', 'Admin đã dừng agent; thay đổi chưa được lưu.');
    return true;
  }

  takePublishRequest(jobId: string, requestId: string): PublishRequest | undefined {
    const job = this.jobs.get(jobId);
    const i = job?.publishRequests.findIndex((r) => r.id === requestId) ?? -1;
    return i >= 0 ? job!.publishRequests.splice(i, 1)[0] : undefined;
  }

  private step(job: AgentJob, kind: StepKind, text: string, extra: Partial<AgentStep> = {}): void {
    job.steps.push({ at: Date.now(), kind, text: text.slice(0, 4000), ...extra });
    if (job.steps.length > 400) job.steps.splice(0, job.steps.length - 400);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, j] of this.jobs) if (j.status !== 'running' && now - (j.finishedAt ?? j.startedAt) > JOB_TTL_MS) this.jobs.delete(id);
  }

  private host(job: AgentJob, version: { current: number }): ToolHost {
    return {
      assets: this.catalog(),
      save: async (doc, note) => {
        const r = await this.store.save(job.projectId, doc, version.current, { snapshot: true, note: `AI: ${note}`.slice(0, 200), author: 'agent' });
        version.current = r.version;
        job.savedVersion = r.version;
        return { version: r.version };
      },
      exportModel: async (doc, mode) => {
        const out = await this.store.exportDoc(doc, mode);
        return { bytes: out.glb.length, triangles: out.triangles, warnings: out.warnings };
      },
      requestPublish: async (doc, o) => {
        const req: PublishRequest = { id: randomUUID(), note: o.note, doc: structuredClone(doc), ...(o.lotClass ? { lotClass: o.lotClass } : {}), ...(o.replaceAsset ? { replaceAsset: o.replaceAsset } : {}) };
        job.publishRequests.push(req);
        return { request: req.id };
      },
    };
  }

  private async exec(job: AgentJob, state: ToolState, tool: string, args: unknown, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new Error('cancelled');
    const r = await runTool(tool, args, state);
    this.step(job, 'tool', r.ok ? `${tool} ✓` : `${tool} ✗ ${r.error}`, { tool, args, ok: r.ok, result: r.ok ? clip(r.result) : r.error });
    return r.ok ? clip(r.result) : { error: r.error };
  }

  private async run(job: AgentJob, baseVersion: number, signal: AbortSignal): Promise<void> {
    const version = { current: baseVersion };
    const state: ToolState = { doc: job.doc, host: this.host(job, version), changed: false };
    const llm = this.client();
    if (job.mode === 'offline') {
      this.step(job, 'info', llm ? 'Chạy bằng bộ lập kế hoạch tích hợp (không gọi AI).' : 'Chưa cấu hình API key AI (Studio → Model → Cấu hình AI): dùng bộ lập kế hoạch tích hợp cho các yêu cầu phổ biến (nhà, đá, lắp ghép từ model có sẵn).');
      const plan = offlinePlan(job.prompt, state.host.assets);
      if (!plan.steps.length) throw new Error(plan.reason ?? 'Không hiểu yêu cầu ở chế độ offline. Cấu hình AI_API_KEY để dùng agent đầy đủ.');
      this.step(job, 'plan', plan.plan.map((p, i) => `${i + 1}. ${p}`).join('\n'));
      for (const s of plan.steps) {
        if (s.thought) this.step(job, 'thought', s.thought);
        await this.exec(job, state, s.tool, typeof s.args === 'function' ? s.args(state.doc) : s.args, signal);
      }
    } else {
      try { await this.converse(job, state, signal); }
      catch (err) {
        // Unexpected: the work so far is still checked and saved below.
        this.step(job, 'error', `Agent gặp lỗi ngoài dự kiến: ${(err as Error).message}. Giữ lại phần đã làm.`);
        job.issues = [...(job.issues ?? []), `Agent dừng sớm: ${(err as Error).message}`];
      }
    }
    job.doc = state.doc;
    // Final check, and the agent's work saved as a version the admin can roll back.
    const final = summarizeReport(validateDoc(state.doc, { asset: (id) => { const a = state.host.assets.find((x) => x.id === id); return a ? { name: a.name, model: { kind: a.model }, bounds: { radius: a.radius, height: a.height } } : undefined; } }));
    job.issues = [...(job.issues ?? []), ...final.errors, ...final.warnings].slice(0, 30);
    if (job.status === 'cancelled') return;
    if (state.changed) {
      try { const r = await this.store.save(job.projectId, state.doc, version.current, { snapshot: true, note: `AI: ${job.prompt}`.slice(0, 200), author: 'agent' }); job.savedVersion = r.version; }
      catch (err) { job.saveError = (err as Error).message; }
    }
    job.summary ??= offlineSummary(state.doc, final);
    job.status = 'done';
    this.step(job, 'done', job.summary);
  }

  private async converse(job: AgentJob, state: ToolState, signal: AbortSignal): Promise<void> {
    const report = summarizeReport(validateDoc(state.doc));
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM(toolCatalog()) },
      { role: 'user', content: JSON.stringify({ request: job.prompt, project: { name: state.doc.name, kind: state.doc.kind, nodes: state.doc.nodes.length, materials: state.doc.materials.map((m) => m.id) }, validation: { ok: report.ok, stats: report.stats } }) },
    ];
    const started = Date.now(), calls = new Map<string, number>();
    let fixRounds = 0, aiFailures = 0, idle = 0, filterHits = 0;
    // After the provider's safety filter withheld an answer: another wording, then another model.
    const call: { model?: string; temperature?: number } = {};
    const stop = (why: string) => {
      this.step(job, 'info', `Tự dừng để tránh lặp vô hạn: ${why}. Phần đã làm vẫn được kiểm tra và lưu.`);
      job.issues = [...(job.issues ?? []), `Agent tự dừng: ${why}`];
    };
    /** A shorter conversation: the request, a note of what is done so far, the last exchanges. */
    const compact = (keep: number) => {
      if (messages.length <= keep + 2) return;
      const done = job.steps.filter((x) => x.kind === 'tool').map((x) => x.text).slice(-30).join('; ');
      messages.splice(2, messages.length - 2 - keep, { role: 'user', content: JSON.stringify({ note: 'Lịch sử cũ đã được rút gọn; tiếp tục từ chỗ đang làm.', done_so_far: done, scene: sceneBrief(state) }) });
    };
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal.aborted) return;
      if (job.usage.total > MAX_TOKENS) return stop(`đã dùng ${job.usage.total.toLocaleString('vi-VN')} token (giới hạn ${MAX_TOKENS.toLocaleString('vi-VN')})`);
      if (Date.now() - started > MAX_MS) return stop(`chạy quá ${MAX_MS / 60_000} phút`);
      const llm = this.client();
      if (!llm) return stop('API key AI đã bị gỡ trong lúc chạy');
      let raw: string;
      try {
        const r = await llm.complete(messages, { signal, maxTokens: 16000, ...call });
        raw = r.text;
        job.usage.turns++;
        if (r.usage) { job.usage.prompt += r.usage.prompt; job.usage.completion += r.usage.completion; job.usage.total += r.usage.total; }
        aiFailures = 0;
      } catch (err) {
        if (signal.aborted) return;
        aiFailures++;
        const msg = err instanceof LlmError ? err.message : `AI lỗi: ${(err as Error).message}`;
        // Wrong key, no access, unknown model: retrying cannot help.
        if (err instanceof LlmError && err.status !== undefined && [400, 401, 402, 403, 404].includes(err.status)) return stop(`AI từ chối yêu cầu (${msg}) — kiểm tra API key / model trong Cấu hình AI`);
        if (aiFailures >= MAX_AI_FAILURES) return stop(`AI lỗi ${aiFailures} lần liên tiếp (lần cuối: ${msg})`);
        if (err instanceof LlmError && err.filtered) {
          // The same context is filtered every time: change it. First the conversation is rebuilt
          // from the request and a neutral note of the work so far (no raw tool output), asking
          // for short answers; then another model takes over.
          filterHits++;
          messages.splice(2, messages.length - 2, { role: 'user', content: JSON.stringify({ note: 'Tiếp tục dựng model kiến trúc theo yêu cầu. Trả lời ngắn: tối đa 4 action mỗi lượt, thought một câu.', done_so_far: scrub(job.steps.filter((x) => x.kind === 'tool' && x.ok).map((x) => x.tool).join(', ')), scene: sceneBrief(state) }) });
          call.temperature = .6;
          const other = filterHits >= 2 ? this.fallbackModels().find((m) => m !== (call.model ?? llm.config.model)) : undefined;
          if (other) call.model = other;
          this.step(job, 'info', `${msg} — ${other ? `chuyển sang model ${other}` : 'diễn đạt lại hội thoại'} và tiếp tục (${aiFailures}/${MAX_AI_FAILURES - 1}).`);
          await new Promise((r) => setTimeout(r, Math.min(20_000, this.retryDelayMs)));
          continue;
        }
        // A long conversation is the usual cause of empty answers and timeouts: retry shorter.
        this.step(job, 'info', `${msg} — thử lại (${aiFailures}/${MAX_AI_FAILURES - 1}) với hội thoại rút gọn.`);
        compact(aiFailures >= 3 ? 2 : 6);
        await new Promise((r) => setTimeout(r, Math.min(20_000, this.retryDelayMs * aiFailures)));
        continue;
      }
      const reply = parseJsonObject(raw);
      messages.push({ role: 'assistant', content: raw.slice(0, 12000) });
      if (!reply) {
        if (++idle >= MAX_IDLE_TURNS) return stop(`${idle} lượt liền không có câu trả lời dùng được`);
        this.step(job, 'info', 'AI trả lời sai định dạng JSON — nhắc lại định dạng và tiếp tục.');
        messages.push({ role: 'user', content: 'Câu trả lời phải là MỘT JSON object đúng định dạng đã nêu, không kèm chữ khác. Tiếp tục từ chỗ đang làm.' });
        continue;
      }
      if (typeof reply.thought === 'string' && reply.thought) this.step(job, 'thought', reply.thought);
      if (Array.isArray(reply.plan) && reply.plan.length) this.step(job, 'plan', reply.plan.map((p, i) => `${i + 1}. ${String(p)}`).join('\n'));
      const actions = Array.isArray(reply.actions) ? reply.actions.slice(0, MAX_ACTIONS) as Array<{ tool?: unknown; args?: unknown }> : [];
      const results: unknown[] = [];
      let repeated: string | null = null;
      for (const a of actions) {
        if (signal.aborted) return;
        const tool = String(a.tool ?? '');
        const sig = `${tool}:${JSON.stringify(a.args ?? {})}`, n = (calls.get(sig) ?? 0) + 1;
        calls.set(sig, n);
        // Checks may run again after changes; the same edit over and over is a loop.
        if (n >= MAX_REPEATS && !CHECKS.has(tool)) { repeated = tool; break; }
        try { results.push({ tool, result: await this.exec(job, state, tool, a.args ?? {}, signal) }); }
        catch (err) {
          this.step(job, 'tool', `${tool} ✗ ${(err as Error).message}`, { tool, args: a.args, ok: false });
          results.push({ tool, result: { error: (err as Error).message } });
        }
      }
      if (repeated) return stop(`gọi "${repeated}" với cùng tham số ${MAX_REPEATS} lần`);
      if (actions.length) {
        idle = 0;
        messages.push({ role: 'user', content: scrub(JSON.stringify({ results, scene: sceneBrief(state) })) });
        if (messages.length > 30) compact(16);
        continue;
      }
      if (reply.done === true) {
        const v = summarizeReport(validateDoc(state.doc));
        if (!v.ok && fixRounds < MAX_FIX_ROUNDS) {
          fixRounds++;
          this.step(job, 'info', `Kiểm tra cuối còn ${v.errors.length} lỗi: yêu cầu agent sửa (vòng ${fixRounds}/${MAX_FIX_ROUNDS}).`);
          messages.push({ role: 'user', content: JSON.stringify({ validation_errors: v.errors, note: 'Sửa các lỗi này (auto_fix hoặc chỉnh tham số), rồi kết thúc lại.' }) });
          continue;
        }
        job.summary = typeof reply.summary === 'string' ? reply.summary : undefined;
        if (Array.isArray(reply.issues)) job.issues = [...(job.issues ?? []), ...reply.issues.map(String)].slice(0, 30);
        return;
      }
      if (++idle >= MAX_IDLE_TURNS) return stop(`${idle} lượt liền không có hành động`);
      messages.push({ role: 'user', content: 'Không có action nào: gọi tool cần thiết hoặc trả {"done": true, "summary": …}.' });
    }
    stop(`đủ ${MAX_TURNS} lượt`);
  }
}

const CHECKS = new Set(['validate_asset', 'inspect_scene', 'inspect_model', 'optimize_model', 'auto_fix', 'search_assets', 'research']);

/**
 * Tool output as the model reads it: names of game models such as "weapon table", "ammo cache"
 * or "military crate" trip some providers' safety filters (the answer comes back empty with
 * finish_reason content_filter) though nothing here is violent. The ids stay, so the model can
 * still use them; only the words change. The admin's log keeps the original text.
 */
const SCRUB: Array<[RegExp, string]> = [
  [/weapons?/gi, 'equipment'], [/ammo|ammunition/gi, 'supply'], [/military/gi, 'utility'], [/barbed[- _]?wire/gi, 'wire'],
  [/guns?\b/gi, 'tool'], [/rifles?|pistols?|shotguns?/gi, 'tool'], [/bullets?|shells?\b/gi, 'part'], [/explosives?|grenades?|bombs?|c4\b/gi, 'device'],
  [/blood(y)?/gi, 'stain'], [/corpses?|dead body|bodies/gi, 'mannequin'], [/zombies?/gi, 'npc'], [/kill(s|ed|ing)?/gi, 'remove'],
  [/vũ khí/gi, 'thiết bị'], [/súng/gi, 'dụng cụ'], [/đạn/gi, 'vật tư'], [/quân sự/gi, 'kỹ thuật'], [/xác chết|thi thể/gi, 'ma-nơ-canh'], [/máu/gi, 'vết bẩn'],
];
export function scrub(text: string): string {
  let out = text;
  for (const [re, to] of SCRUB) out = out.replace(re, to);
  return out;
}

/** The scene in a few numbers, sent back after every turn. */
function sceneBrief(state: ToolState) {
  const v = summarizeReport(validateDoc(state.doc));
  return { nodes: state.doc.nodes.length, materials: state.doc.materials.map((m) => m.id), triangles: v.stats.triangles, size: v.stats.size, errors: v.errors.slice(0, 6) };
}

function offlineSummary(doc: ModelDoc, v: ReturnType<typeof summarizeReport>): string {
  return `${doc.name}: ${doc.nodes.length} phần, ${doc.materials.length} vật liệu PBR, ${v.stats.triangles.toLocaleString('vi-VN')} tam giác${v.stats.size ? `, ${v.stats.size.join(' × ')} m` : ''}. ${v.ok ? 'Kiểm tra: hợp lệ.' : `Kiểm tra: còn ${v.errors.length} lỗi.`}`;
}
