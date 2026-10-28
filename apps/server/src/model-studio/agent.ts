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
 * Limits: 24 turns, 8 tool calls per turn, 2 repair rounds after the final validation, one job
 * per project at a time. The agent cannot publish into the game or delete anything outside the
 * project: `export_asset` with publish only files a request the admin confirms in the Studio.
 */
const MAX_TURNS = 24, MAX_ACTIONS = 8, MAX_FIX_ROUNDS = 2, MAX_RESULT_CHARS = 5000;
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

const SYSTEM = (tools: string) => `Bạn là trợ lý dựng model 3D trong Model Studio của game sinh tồn/battle royale Zion (renderer three.js, PBR). Bạn KHÔNG tự viết lưới tam giác: mọi thay đổi phải gọi tool. Đơn vị mét, +y hướng lên, model đứng trên y = 0, mặt trước hướng +z. Góc xoay tính bằng ĐỘ.

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

  constructor(private readonly store: ModelStudioStore, private readonly llm: LlmClient | null, private readonly catalog: () => CatalogAsset[], private readonly log: Logger) {}

  get configured(): boolean { return !!this.llm; }
  get model(): string | null { return this.llm?.config.model ?? null; }

  start(projectId: string, prompt: string, doc: ModelDoc, baseVersion: number, opts: { offline?: boolean } = {}): AgentJob {
    this.sweep();
    if ([...this.jobs.values()].some((j) => j.projectId === projectId && j.status === 'running')) throw Object.assign(new Error('Agent đang chạy trên dự án này.'), { statusCode: 409 });
    const job: AgentJob = {
      id: randomUUID(), projectId, prompt, status: 'running', mode: this.llm && !opts.offline ? 'ai' : 'offline', ...(this.llm && !opts.offline ? { model: this.llm.config.model } : {}),
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
    if (job.mode === 'offline') {
      this.step(job, 'info', this.llm ? 'Chạy bằng bộ lập kế hoạch tích hợp (không gọi AI).' : 'Chưa cấu hình AI_API_KEY trên server: dùng bộ lập kế hoạch tích hợp cho các yêu cầu phổ biến (nhà, đá, lắp ghép từ model có sẵn).');
      const plan = offlinePlan(job.prompt, state.host.assets);
      if (!plan.steps.length) throw new Error(plan.reason ?? 'Không hiểu yêu cầu ở chế độ offline. Cấu hình AI_API_KEY để dùng agent đầy đủ.');
      this.step(job, 'plan', plan.plan.map((p, i) => `${i + 1}. ${p}`).join('\n'));
      for (const s of plan.steps) {
        if (s.thought) this.step(job, 'thought', s.thought);
        await this.exec(job, state, s.tool, typeof s.args === 'function' ? s.args(state.doc) : s.args, signal);
      }
    } else {
      await this.converse(job, state, signal);
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
    const llm = this.llm!;
    const report = summarizeReport(validateDoc(state.doc));
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM(toolCatalog()) },
      { role: 'user', content: JSON.stringify({ request: job.prompt, project: { name: state.doc.name, kind: state.doc.kind, nodes: state.doc.nodes.length, materials: state.doc.materials.map((m) => m.id) }, validation: { ok: report.ok, stats: report.stats } }) },
    ];
    let fixRounds = 0, badJson = 0;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal.aborted) return;
      let reply: Record<string, unknown> | null;
      let raw: string;
      try {
        const r = await llm.complete(messages, { signal, maxTokens: 6000 });
        raw = r.text;
        job.usage.turns++;
        if (r.usage) { job.usage.prompt += r.usage.prompt; job.usage.completion += r.usage.completion; job.usage.total += r.usage.total; }
        reply = parseJsonObject(raw);
      } catch (err) {
        if (signal.aborted) return;
        throw new Error(err instanceof LlmError ? err.message : `AI lỗi: ${(err as Error).message}`);
      }
      messages.push({ role: 'assistant', content: raw.slice(0, 12000) });
      if (!reply) {
        if (++badJson > 2) throw new Error('AI không trả JSON hợp lệ sau 3 lần.');
        messages.push({ role: 'user', content: 'Câu trả lời phải là MỘT JSON object đúng định dạng đã nêu, không kèm chữ khác.' });
        continue;
      }
      if (typeof reply.thought === 'string' && reply.thought) this.step(job, 'thought', reply.thought);
      if (Array.isArray(reply.plan) && reply.plan.length) this.step(job, 'plan', reply.plan.map((p, i) => `${i + 1}. ${String(p)}`).join('\n'));
      const actions = Array.isArray(reply.actions) ? reply.actions.slice(0, MAX_ACTIONS) as Array<{ tool?: unknown; args?: unknown }> : [];
      const results: unknown[] = [];
      for (const a of actions) {
        if (signal.aborted) return;
        const tool = String(a.tool ?? '');
        results.push({ tool, result: await this.exec(job, state, tool, a.args ?? {}, signal) });
      }
      if (actions.length) {
        const v = summarizeReport(validateDoc(state.doc));
        messages.push({ role: 'user', content: JSON.stringify({ results, scene: { nodes: state.doc.nodes.length, materials: state.doc.materials.length, triangles: v.stats.triangles, size: v.stats.size, errors: v.errors.slice(0, 6) } }) });
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
        if (Array.isArray(reply.issues)) job.issues = reply.issues.map(String).slice(0, 20);
        return;
      }
      messages.push({ role: 'user', content: 'Không có action nào: gọi tool cần thiết hoặc trả {"done": true, "summary": …}.' });
      // Keep the conversation within reach: drop old tool results, keep the system and request.
      if (messages.length > 40) messages.splice(2, messages.length - 30);
    }
    this.step(job, 'info', `Dừng sau ${MAX_TURNS} lượt.`);
  }
}

function offlineSummary(doc: ModelDoc, v: ReturnType<typeof summarizeReport>): string {
  return `${doc.name}: ${doc.nodes.length} phần, ${doc.materials.length} vật liệu PBR, ${v.stats.triangles.toLocaleString('vi-VN')} tam giác${v.stats.size ? `, ${v.stats.size.join(' × ')} m` : ''}. ${v.ok ? 'Kiểm tra: hợp lệ.' : `Kiểm tra: còn ${v.errors.length} lỗi.`}`;
}
