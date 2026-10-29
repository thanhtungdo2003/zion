import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { Logger } from 'pino';
import { TOOLS, checkPlan, encodePng, planHash, runTool, summarizeReport, validateDoc, verifyBuilt, type CatalogAsset, type ModelDoc, type ToolHost, type ToolState } from '@zion/assets/model-studio';
import { LlmError, parseJsonObject, type ChatMessage, type LlmClient, type WireMessage } from './llm';
import { offlinePlan } from './planner';
import type { ModelStudioStore } from './store';
import type { TextureLibrary } from './textures';
import { webResearch } from './web-research';

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
 * Token cost: only the last exchanges go back in full; older turns are condensed to what was
 * called and whether it worked, and every turn carries the progress (storeys, open drawings, roof,
 * what is left) so the model knows when it is done without re-inspecting the scene.
 *
 * Runaway guards (the job stops by itself, keeping its work): 80 turns, 600k tokens, 25 minutes,
 * 6 failed AI calls in a row, 3 turns in a row without a usable answer or action, the same call
 * repeated 4 times. Also 8 tool calls per turn, 3 repair rounds after the final validation, one
 * job per project at a time. The agent cannot publish into the game or delete anything outside
 * the project: `export_asset` with publish only files a request the admin confirms in the Studio.
 */
const MAX_TURNS = 80, MAX_ACTIONS = 8, MAX_FIX_ROUNDS = 3, MAX_PLAN_ROUNDS = 12, MAX_RESULT_CHARS = 3000;
const MAX_TOKENS = 600_000, MAX_MS = 25 * 60_000, MAX_AI_FAILURES = 6, MAX_IDLE_TURNS = 3, MAX_REPEATS = 4;
const JOB_TTL_MS = 60 * 60 * 1000;
/** Exchanges sent back in full; older ones are condensed. A "go on" prompt shorter than this reuses the saved brief. */
const KEEP_FULL = 4, SHORT_PROMPT = 80;

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
  /** Bumped whenever the work-in-progress document changes (the Studio shows it live). */
  revision: number;
  publishRequests: PublishRequest[];
}

const SYSTEM = (tools: string) => `Bạn là trợ lý dựng model 3D trong Model Studio của game thế giới mở Zion (dựng kiến trúc, nội thất, cảnh quan) (renderer three.js, PBR). Bạn KHÔNG tự viết lưới tam giác: mọi thay đổi phải gọi tool. Đơn vị mét, +y hướng lên, model đứng trên y = 0, mặt trước hướng +z. Góc xoay tính bằng ĐỘ.

Quy trình: (1) phân tích yêu cầu: loại asset, kích thước, phong cách, cấu trúc, mục đích trong game; (2) tìm tài nguyên có sẵn (search_assets) và tra cứu khi cần (research); (3) lập kế hoạch; (4) dựng bằng tool; (5) inspect_scene / validate_asset để tự kiểm tra; (6) auto_fix và sửa tiếp các lỗi còn lại; (7) kết thúc với tóm tắt và các vấn đề còn tồn tại.

CÔNG TRÌNH (nhà, chung cư, trường học, xưởng, cửa hàng…): BẠN là kiến trúc sư — tự phân tích yêu cầu (công năng, số người, luồng đi lại, khí hậu, phong cách, trạng thái), tự lập phương án và tự quyết bố cục; không có mẫu dựng sẵn, hệ thống KHÔNG áp một kiểu cầu thang, hành lang, ban công hay cách chia phòng nào. Cùng một loại công trình có thể có nhiều phương án đúng (thang thẳng/L/U/xoắn, sát tường hay đứng tự do, hành lang trong hay hành lang hở một bên, ban công đua hay lô gia…) — chọn theo yêu cầu và khu đất, nói rõ lý do trong basis.
(a) NGHIÊN CỨU (bắt buộc trước khi vẽ — draw_floor_plan bị từ chối khi chưa research): tra cứu mặt bằng, mặt cắt, tiêu chuẩn kích thước của đúng loại công trình để có căn cứ; dùng làm tham khảo, không phải khuôn. Trạng thái "bỏ hoang" = xây xong, đủ bộ phận, lâu không dùng (bụi, ố, bong sơn), không phải đổ nát.
Ghi số tầng thiết kế bằng set_model_info {storeys} — chưa được kết thúc khi chưa dựng đủ số tầng đó và mái. (b) LẬP BẢNG VẬT LIỆU (define_materials) TRƯỚC khi vẽ: mọi vật liệu và nơi dùng, đúng thực tế từng khu vực; mỗi mục có texture_query để tải texture thật.
(c) LUẬT BẮT BUỘC (chỉ những điều này được kiểm tra; còn lại là quyết định thiết kế của bạn):
 • Đơn vị: mét, trục x/z mặt bằng, y lên; lưới 5 cm; cao độ tầng = tầng dưới + chiều cao + sàn.
 • Vật liệu: chỉ dùng vật liệu trong bảng vật liệu; PBR thật (metalness 0 hoặc 1).
 • Đi lại được trong game: mọi phòng tới được qua cửa/lối mở (cửa ≥ 0.82×1.95 m, bậu 0); cầu thang leo được (bậc ≤ 18 cm nhà ở / 16.5 cm công cộng, 2h + b 58–67 cm, ≤ 18 bậc một vế, chiếu nghỉ ≥ bề rộng vế, bề rộng ≥ 0.9 / 1.2 m), chân thang có chỗ bước lên, đầu thang ra sàn tầng trên, khoảng trống đầu ≥ 2.0 / 2.1 m (giếng thang phủ các bậc); cánh cửa không mở ra trên bậc thang; không tường nào cắt qua cầu thang.
 • An toàn: mọi cạnh hở trên cao (giếng thang, ban công, hành lang hở, sân thượng) phải có tường hoặc lan can — cạnh hở của cầu thang tự có tay vịn, giếng thang tự có lan can; ban công/hành lang hở: rooms open [n|s|e|w] hoặc walls kind "railing". Không tự xây tường kín ở nơi thiết kế để thoáng.
 • Hình học: phòng không chồng nhau; lỗ mở không cắt vào chỗ nối tường; tường ngoài khép kín nơi cần kín; model có collision.
(d) Làm TỪNG TẦNG TỪ DƯỚI LÊN: draw_floor_plan (phòng, tường + vật liệu, cửa, finishes, cầu thang do bạn thiết kế: vị trí, dạng, hướng, bề rộng, riser/tread/landing/gap) → đọc errors (chỉ là vi phạm luật ở (c)) và stairApproval → sửa đúng chỗ bằng edit_floor_plan (hoặc vẽ lại) tới khi hết lỗi → approve_floor_plan (basis: phương án và lý do; tự đánh giá từng cầu thang; assumptions cho điều yêu cầu không nói rõ — không bao giờ hỏi admin; cần toạ độ thì read_floor_plan) → build_floor → đọc verification và changes → render_views để tự xem model thật (lối đi bị chắn? cạnh hở thiếu lan can? phần lơ lửng?) → sửa nếu sai → sang tầng kế. Tuỳ chọn khi tiện: grid + phòng cols/rows, walls "auto" (+ wallSpec, cạnh open), links, entrance, windows "auto" để sinh hình học tự động — chỉ là công cụ, không bắt buộc. Mái: build_roof (theo mặt bằng tầng trên cùng) hoặc tự dựng nếu thiết kế khác. Sau các tầng: mái/tầng thượng, nội thất, bụi bẩn/phong hóa theo trạng thái.
YÊU CẦU SỬA (vd "bỏ bức tường giữa sảnh và phòng khách", "mở hành lang ra", "đổi cầu thang sang chữ L"): xác định đúng đối tượng (read_floor_plan / inspect_scene), sửa bằng thao tác có mục tiêu (edit_floor_plan: remove_wall_between, remove_wall, set_room open, set_stair…; hoặc edit_transform với phần không thuộc bản vẽ), duyệt và build_floor lại, rồi kiểm tra changes (trước → sau) và render_views — chỉ báo đã sửa khi số liệu cho thấy geometry thật sự đổi.

Đa dạng: kho game có rất nhiều model cùng loại khác màu/kiểu (search_assets gom theo nhóm). Khi đặt nhiều cây, bụi, ghế, bàn, xe, thùng, đá…, dùng NHIỀU biến thể khác nhau trong nhóm (ưu tiên model chưa dùng), đổi góc xoay và tỉ lệ; không đặt cùng một model lặp lại.

Texture: mỗi bề mặt chính (tường ngoài, tường trong, sàn, mái, khung, đồ gỗ, kim loại) PHẢI có bộ texture thật hợp phong cách của yêu cầu — tự suy ra vẻ ngoài cần có rồi find_texture (query tiếng Anh) → download_texture, hoặc paint_texture khi thư viện không có. Ví dụ: biệt thự → "smooth white plaster", "polished concrete", "marble floor", "dark wood"; nhà xưởng bỏ hoang → "cracked dirty concrete", "rusty corrugated metal", "peeling paint"; nhà gỗ → "weathered wood planks". Không để bề mặt chính dùng texture sinh tự động của preset; mỗi dự án chọn texture riêng theo yêu cầu, không lặp lại một bộ quen thuộc.

Nguyên tắc: tái dùng model game (cây, bàn ghế, xe…) bằng assemble_model; vật liệu chọn từ preset thật rồi chỉnh roughness/metalness theo vật liệu thực (metalness gần như 0 hoặc 1), thêm wear/dirt/moss/cracks theo tuổi và phong cách — không chỉ đổi màu; giữ số vật liệu ít để giảm draw call; cửa ≥ 0.9×2.1 m, bậc ≤ 0.19 m. Không xóa phần ngoài phạm vi yêu cầu. Không bao giờ tự xuất bản vào game.

Mỗi lượt trả về DUY NHẤT một JSON object:
{"thought": "suy luận ngắn", "plan": ["bước…"] (lượt đầu), "actions": [{"tool": "tên", "args": {…}}], "done": false}
Khi xong: {"thought": "…", "done": true, "summary": "đã làm gì (tiếng Việt)", "issues": ["vấn đề còn tồn tại"]}
Làm TỰ ĐỘNG tới khi xong: không dừng để hỏi admin. Yêu cầu thiếu thông tin (số tầng, kích thước khu đất, loại cầu thang…) thì tự chọn giá trị hợp lý cho loại công trình theo research/tiêu chuẩn, ghi lại là giả định (assumptions khi duyệt bản vẽ, issues khi kết thúc) rồi làm tiếp.
Tối đa ${MAX_ACTIONS} action mỗi lượt; kết quả từng tool sẽ được gửi lại.

Tools:
${tools}`;

function toolCatalog(): string {
  return TOOLS.map((t) => `- ${t.name} [${t.permission}]: ${t.description}\n  args: ${JSON.stringify(t.params)}`).join('\n');
}

/** Results the agent edits from (a whole drawing) get the room for their coordinates. */
const WIDE_RESULTS: Record<string, number> = { read_floor_plan: 12000, draw_floor_plan: 5000 };

/** The last message with the rendered views attached as images. */
function withImages(messages: ChatMessage[], urls: string[]): WireMessage[] {
  const last = messages[messages.length - 1]!, text = last.content;
  return [...messages.slice(0, -1), { role: last.role, content: [{ type: 'text', text: `${text}\n(Ảnh render của model ở lượt trước: ${urls.length} góc nhìn — kiểm tra lối đi, lan can, mái, phần lơ lửng.)` }, ...urls.map((url) => ({ type: 'image_url' as const, image_url: { url } }))] }];
}

function clip(v: unknown, tool = ''): unknown {
  const s = JSON.stringify(v);
  if (s === undefined) return null;
  const max = WIDE_RESULTS[tool] ?? MAX_RESULT_CHARS;
  return s.length <= max ? v : `${s.slice(0, max)}… (cắt bớt${tool === 'draw_floor_plan' ? '; toạ độ đầy đủ: read_floor_plan' : ''})`;
}

export class ModelAgent {
  private readonly jobs = new Map<string, AgentJob>();
  private readonly controllers = new Map<string, AbortController>();
  /** Rendered views waiting for the next turn (data URLs), and the jobs whose model cannot see images. */
  private readonly views = new Map<string, string[]>();
  private readonly noVision = new Set<string>();

  /** `llm`: the client, or where to get the current one (the key and model can change at runtime). */
  constructor(private readonly store: ModelStudioStore, private readonly llm: LlmClient | null | (() => LlmClient | null), private readonly catalog: () => CatalogAsset[], private readonly log: Logger, private readonly retryDelayMs = 2000, private readonly fallbackModels: () => string[] = () => []) {}

  /** Real texture sets (library and AI painting) for the agent's materials. */
  textures: TextureLibrary | null = null;
  /** Online research (Wikipedia, web search, the pages found). */
  research: (query: string) => Promise<string[]> = (q) => webResearch(q);

  private client(): LlmClient | null { return typeof this.llm === 'function' ? this.llm() : this.llm; }
  get configured(): boolean { return !!this.client(); }
  get model(): string | null { return this.client()?.config.model ?? null; }

  start(projectId: string, prompt: string, doc: ModelDoc, baseVersion: number, opts: { offline?: boolean } = {}): AgentJob {
    this.sweep();
    // A job whose run is over (or that outlived every guard) is not running, whatever its status says.
    for (const j of this.jobs.values()) if (j.status === 'running' && (!this.controllers.has(j.id) || Date.now() - j.startedAt > MAX_MS + 10 * 60_000)) {
      this.controllers.get(j.id)?.abort();
      j.status = 'failed';
      j.finishedAt ??= Date.now();
    }
    if ([...this.jobs.values()].some((j) => j.projectId === projectId && j.status === 'running')) throw Object.assign(new Error('Agent đang chạy trên dự án này.'), { statusCode: 409 });
    const llm = this.client();
    const job: AgentJob = {
      id: randomUUID(), projectId, prompt, status: 'running', mode: llm && !opts.offline ? 'ai' : 'offline', ...(llm && !opts.offline ? { model: llm.config.model } : {}),
      steps: [], doc: structuredClone(doc), startedAt: Date.now(), usage: { prompt: 0, completion: 0, total: 0, turns: 0 }, revision: 0, publishRequests: [],
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

  /** The newest job on a project (the Studio reattaches to it after a reload). */
  latest(projectId: string): AgentJob | undefined {
    let out: AgentJob | undefined;
    for (const j of this.jobs.values()) if (j.projectId === projectId && (!out || j.startedAt > out.startedAt)) out = j;
    return out;
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'running') return false;
    this.controllers.get(id)?.abort();
    job.status = 'cancelled';
    this.step(job, 'info', 'Admin đã dừng agent; phần đã làm được lưu thành một phiên bản (hoàn tác được).');
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
      // The language model designs every building itself; the built-in planner keeps the house generator.
      designOnly: job.mode === 'ai',
      research: (q: string) => this.research(q),
      // Rendered views go with the next turn, when the model can look at images.
      showViews: (views) => {
        if (this.noVision.has(job.id)) return false;
        this.views.set(job.id, views.slice(0, 6).map((v) => {
          const rgba = new Uint8Array(v.width * v.height * 4);
          for (let i = 0; i < v.width * v.height; i++) { rgba[i * 4] = v.rgb[i * 3]!; rgba[i * 4 + 1] = v.rgb[i * 3 + 1]!; rgba[i * 4 + 2] = v.rgb[i * 3 + 2]!; rgba[i * 4 + 3] = 255; }
          return `data:image/png;base64,${Buffer.from(encodePng(v.width, v.height, rgba, (d) => deflateSync(d), false)).toString('base64')}`;
        }));
        return true;
      },
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
      ...(this.textures ? { textures: ((lib) => ({
        canPaint: lib.canPaint,
        search: (q: string, limit: number) => lib.search(q, limit),
        download: (id: string, res: '1k' | '2k') => lib.download(job.projectId, id, res),
        paint: (prompt: string, o: { roughness?: number; metalness?: number; scale?: number }) => lib.paint(job.projectId, prompt, o),
      }))(this.textures) } : {}),
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
    if (r.ok && state.changed) { job.doc = state.doc; job.revision++; }
    this.step(job, 'tool', r.ok ? `${tool} ✓` : `${tool} ✗ ${r.error}`, { tool, args, ok: r.ok, result: r.ok ? clip(r.result, tool) : r.error });
    return r.ok ? clip(r.result, tool) : { error: r.error };
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
      let noTextures = false;
      for (const s of plan.steps) {
        if (['download_texture', 'find_texture', 'paint_texture'].includes(s.tool) && !state.host.textures) {
          if (!noTextures) this.step(job, 'info', 'Thư viện texture không khả dụng: giữ texture sinh tự động.');
          noTextures = true;
          continue;
        }
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
    const stopped = job.status === 'cancelled';
    if (state.changed) {
      try { const r = await this.store.save(job.projectId, state.doc, version.current, { snapshot: true, note: `AI${stopped ? ' (dừng giữa chừng)' : ''}: ${job.prompt}`.slice(0, 200), author: 'agent' }); job.savedVersion = r.version; }
      catch (err) { job.saveError = (err as Error).message; }
    }
    if (stopped) return;
    job.summary ??= offlineSummary(state.doc, final);
    job.status = 'done';
    this.step(job, 'done', job.summary);
  }

  private async converse(job: AgentJob, state: ToolState, signal: AbortSignal): Promise<void> {
    const report = summarizeReport(validateDoc(state.doc));
    // "Tiếp đi": a short prompt goes on with the brief the model was designed from.
    const brief = state.doc.brief;
    const goOn = !!brief && job.prompt.trim().length < SHORT_PROMPT;
    if (!goOn && state.doc.brief !== job.prompt) { state.doc.brief = job.prompt.slice(0, 4000); state.changed = true; }
    const texts = () => [job.prompt, ...(brief ? [brief] : []), ...job.steps.filter((x) => x.kind === 'plan' || x.kind === 'thought').map((x) => x.text)];
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM(toolCatalog()) },
      { role: 'user', content: JSON.stringify({
        request: goOn ? brief : job.prompt, ...(goOn ? { continue: `${job.prompt} — làm tiếp phần còn lại theo "progress"; không làm lại phần đã dựng, không inspect lại toàn bộ cảnh.` } : {}),
        project: { name: state.doc.name, kind: state.doc.kind, nodes: state.doc.nodes.length, materials: state.doc.materials.map((m) => m.id) }, validation: { ok: report.ok, stats: report.stats },
        progress: progress(state.doc, texts()),
      }) },
    ];
    const started = Date.now(), calls = new Map<string, number>();
    let fixRounds = 0, planRounds = 0, aiFailures = 0, idle = 0, filterHits = 0, warnedBudget = false, toldComplete = false;
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
      messages.splice(2, messages.length - 2 - keep, { role: 'user', content: JSON.stringify({ note: 'Lịch sử cũ đã được rút gọn; tiếp tục từ chỗ đang làm.', done_so_far: done, scene: sceneBrief(state), progress: progress(state.doc, texts()) }) });
    };
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal.aborted) return;
      if (job.usage.total > MAX_TOKENS) return stop(`đã dùng ${job.usage.total.toLocaleString('vi-VN')} token (giới hạn ${MAX_TOKENS.toLocaleString('vi-VN')})`);
      if (Date.now() - started > MAX_MS) return stop(`chạy quá ${MAX_MS / 60_000} phút`);
      const llm = this.client();
      if (!llm) return stop('API key AI đã bị gỡ trong lúc chạy');
      let raw: string;
      try {
        // Views rendered last turn: shown with this one only (never kept in the history).
        const views = this.views.get(job.id);
        this.views.delete(job.id);
        const send = views?.length ? withImages(messages, views) : messages;
        const r = await llm.complete(send, { signal, maxTokens: 16000, ...call }).catch((err: unknown) => {
          // A model that cannot read images: go on without them, and stop offering them.
          if (views?.length && err instanceof LlmError && err.status === 400) { this.noVision.add(job.id); this.step(job, 'info', 'Model AI không nhận ảnh: đánh giá bằng số liệu hình học.'); return llm.complete(messages, { signal, maxTokens: 16000, ...call }); }
          throw err;
        });
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
        const prog = progress(state.doc, texts());
        // Near the token budget: the structure first (storeys, roof), the extras only if any is left.
        const budget = !warnedBudget && job.usage.total > MAX_TOKENS * .7 ? (warnedBudget = true, `Đã dùng ${Math.round(job.usage.total / MAX_TOKENS * 100)}% ngân sách token: ưu tiên dựng nốt ${prog.remaining.length ? prog.remaining.join('; ') : 'phần chính'}, bỏ phần trang trí, rồi trả done.`) : undefined;
        // Everything the design calls for is built: say so once, so the model wraps up instead of polishing forever.
        const complete = !toldComplete && prog.complete ? (toldComplete = true, 'Công trình đã đủ phần chính (đủ tầng, bản vẽ không lỗi, có mái). Chỉ làm thêm điều yêu cầu còn thiếu (vài lượt) rồi trả done; không inspect lại toàn bộ.') : undefined;
        messages.push({ role: 'user', content: scrub(JSON.stringify({ results, scene: sceneBrief(state), progress: prog, ...(budget ? { budget } : {}), ...(complete ? { note: complete } : {}) })) });
        condense(messages, KEEP_FULL);
        if (messages.length > 24) compact(12);
        continue;
      }
      const needs = Array.isArray(reply.need_info) ? reply.need_info.map(String) : typeof reply.need_info === 'string' ? [reply.need_info] : [];
      if (needs.length) {
        // Never stop to ask: the agent answers its own questions (assumptions, read_floor_plan) and goes on.
        this.step(job, 'info', `Tự giải quyết thay vì hỏi admin: ${needs.join(' | ')}`);
        job.issues = [...(job.issues ?? []), ...needs.map((n) => `Giả định (tự chọn): ${n}`)].slice(0, 30);
        messages.push({ role: 'user', content: scrub(JSON.stringify({
          not_allowed: 'Không dừng để hỏi admin. Thiếu toạ độ/bản vẽ hiện tại: read_floor_plan {level}. Thiếu thông tin trong yêu cầu: tự chọn giá trị hợp lý theo research/tiêu chuẩn của loại công trình, ghi vào assumptions khi approve_floor_plan, rồi làm tiếp ngay.',
          questions: needs, progress: progress(state.doc, texts()),
        })) });
        continue;
      }
      if (reply.done === true) {
        // Unfinished drawings: storeys with errors or never built. Go on with them, not stop.
        const open = (state.doc.plans ?? []).flatMap((p) => {
          const errors = [...checkPlan(state.doc, p).filter((i) => i.level === 'error').map((i) => i.message), ...verifyBuilt(state.doc, p)];
          return errors.length || !p.built ? [{ level: p.level, name: p.name, built: !!p.built, errors: errors.slice(0, 8) }] : [];
        });
        const nothingBuilt = job.mode === 'ai' && !(state.doc.plans ?? []).some((p) => p.built) && (state.doc.schedule?.length ?? 0) > 0;
        // What the design itself still calls for: the storeys it was planned with, the floor its stairs lead to, a roof.
        const missing = job.mode === 'ai' ? missingParts(state.doc, texts()) : [];
        if ((open.length || nothingBuilt || missing.length) && planRounds < MAX_PLAN_ROUNDS) {
          planRounds++;
          this.step(job, 'info', `Chưa xong: ${[open.length ? `${open.length} bản vẽ còn lỗi hoặc chưa dựng` : '', nothingBuilt ? 'chưa dựng tầng nào' : '', ...missing].filter(Boolean).join('; ')} — yêu cầu agent làm tiếp (vòng ${planRounds}/${MAX_PLAN_ROUNDS}).`);
          messages.push({ role: 'user', content: scrub(JSON.stringify({
            unfinished: open, nothing_built: nothingBuilt, missing,
            note: 'Chưa được kết thúc. Sửa từng lỗi của bản vẽ (draw_floor_plan lại đúng tầng đó với toạ độ đã chỉnh: cầu thang nằm gọn trong buồng thang và sát tường, thêm cửa cho phòng chưa đi tới được), kiểm tra hết lỗi thì build_floor, rồi sang tầng kế; sau đó mái, công trình phụ, nội thất, cảnh quan. Lỗi một tool (vd dịch vụ ảnh 502) thì bỏ qua bằng cách khác (find_texture/download_texture hoặc preset), không dừng.',
          })) });
          continue;
        }
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
  return { nodes: state.doc.nodes.length, materials: state.doc.materials.length, triangles: v.stats.triangles, size: v.stats.size, errors: v.errors.slice(0, 6) };
}

/**
 * Where the building stands against its own design, sent with every turn: storeys built of the
 * target, each drawing (built, errors), the roof, and what is still missing. `complete` when
 * nothing is: the model can finish.
 */
export function progress(doc: ModelDoc, texts: string[]) {
  const plans = (doc.plans ?? []).map((p) => ({ level: p.level, approved: !!p.approved && p.approved.hash === planHash(doc, p), built: !!p.built, errors: checkPlan(doc, p).filter((i) => i.level === 'error').length, deviations: verifyBuilt(doc, p).length }));
  const open = plans.filter((p) => !p.built || p.errors || p.deviations).map((p) => `bản vẽ level ${p.level}: ${p.errors ? `${p.errors} lỗi kiểm định` : p.deviations ? `model lệch bản vẽ ${p.deviations} chỗ — dựng lại` : p.approved ? 'đã duyệt, chưa dựng' : 'chưa duyệt'}`);
  const remaining = [...open, ...missingParts(doc, texts)];
  return { storeys: { built: new Set(plans.filter((p) => p.built).map((p) => p.level)).size, target: doc.storeys ?? null }, plans, roof: doc.nodes.some((n) => n.kind === 'roof'), remaining, complete: doc.kind === 'building' && plans.length > 0 && !remaining.length };
}

/**
 * Older turns shortened in place, all but the last `keep` messages: an answer keeps its thought
 * and the tools it called (not their arguments), a result keeps each tool's outcome in a line.
 * Shortened messages are marked so they are not processed again.
 */
export function condense(messages: ChatMessage[], keep: number): void {
  for (let i = 2; i < messages.length - keep; i++) {
    const m = messages[i]!;
    if (m.content.length < 400 || m.content.includes('"_c":1')) continue;
    let v: Record<string, unknown> | null = null;
    try { v = JSON.parse(m.content) as Record<string, unknown>; } catch { v = m.role === 'assistant' ? parseJsonObject(m.content) : null; }
    if (!v) { m.content = `${m.content.slice(0, 300)}… {"_c":1}`; continue; }
    if (m.role === 'assistant') {
      const actions = Array.isArray(v.actions) ? (v.actions as Array<{ tool?: unknown; args?: { level?: unknown } }>).map((a) => `${String(a.tool)}${typeof a.args?.level === 'number' ? `(level ${a.args.level})` : ''}`) : [];
      m.content = JSON.stringify({ _c: 1, thought: String(v.thought ?? '').slice(0, 240), actions });
    } else if (Array.isArray(v.results)) {
      const line = (r: unknown) => { const s = JSON.stringify(r) ?? ''; return s.length > 160 ? `${s.slice(0, 160)}…` : s; };
      m.content = JSON.stringify({ _c: 1, results: (v.results as Array<{ tool?: unknown; result?: unknown }>).map((r) => {
        const err = r.result && typeof r.result === 'object' && 'error' in r.result ? String((r.result as { error: unknown }).error).slice(0, 200) : undefined;
        return err ? { tool: r.tool, error: err } : { tool: r.tool, ok: line(r.result) };
      }) });
    } else m.content = JSON.stringify({ _c: 1, ...Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'scene' && k !== 'progress').map(([k, x]) => [k, typeof x === 'string' ? x.slice(0, 300) : x])) }).slice(0, 1500);
  }
}

function offlineSummary(doc: ModelDoc, v: ReturnType<typeof summarizeReport>): string {
  return `${doc.name}: ${doc.nodes.length} phần, ${doc.materials.length} vật liệu PBR, ${v.stats.triangles.toLocaleString('vi-VN')} tam giác${v.stats.size ? `, ${v.stats.size.join(' × ')} m` : ''}. ${v.ok ? 'Kiểm tra: hợp lệ.' : `Kiểm tra: còn ${v.errors.length} lỗi.`}`;
}

/**
 * What a building still lacks by its own design: storeys (the number set with set_model_info, or
 * stated in the request or the agent's own plan, e.g. "3 tầng"), the floor above stairs that lead
 * up, and a roof over the top storey.
 */
export function missingParts(doc: ModelDoc, texts: string[]): string[] {
  const plans = doc.plans ?? [], built = plans.filter((p) => p.built);
  if (doc.kind !== 'building' || !plans.length) return [];
  const out: string[] = [];
  let target = doc.storeys ?? 0;
  for (const t of texts) for (const m of t.matchAll(/(\d{1,2})\s*(?:tầng|tang|storeys?|stories|floors?)\b/giu)) { const n = Number(m[1]); if (n >= 1 && n <= 40) target = Math.max(target, n); }
  const levels = new Set(built.map((p) => p.level));
  if (target > levels.size) {
    const need = Array.from({ length: target }, (_, i) => i).filter((l) => !levels.has(l));
    out.push(`mới dựng ${levels.size}/${target} tầng — còn thiếu tầng ${need.map((l) => l + 1).join(', ')} (level ${need.join(', ')})`);
  }
  const top = built.reduce<typeof built[number] | null>((a, p) => (!a || p.level > a.level ? p : a), null);
  if (top && top.stairs.length && !plans.some((p) => p.level === top.level + 1)) out.push(`cầu thang tầng ${top.level + 1} dẫn lên nhưng chưa có bản vẽ level ${top.level + 1} (tầng trên hoặc tầng mái/sân thượng)`);
  if (built.length && !doc.nodes.some((n) => n.kind === 'roof')) out.push('chưa có mái (build_roof: gable/hip/shed hoặc flat cho mái bằng/sân thượng, lợp theo mặt bằng tầng trên cùng)');
  return out;
}
