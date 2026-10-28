import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import type { AssetDefinitionInput, AssetRegistry } from '@zion/assets';
import { STUDIO_MODEL_ASSET_MAX, STUDIO_MODEL_ASSET_MIN, createDefaultRegistry, glbTriangles, uploadedMapHitMesh } from '@zion/assets';
import { emptyDoc, exportModel, parseDoc, studioModelAsset, validateDoc, type ModelDoc, type ValidationReport } from '@zion/assets/model-studio';
import type { Db } from '../db/pool';
import { withTransaction } from '../db/pool';
import { uploadedHitMeshes } from '../world/uploaded-hit-meshes';

/**
 * Model Studio persistence and the game side of published models:
 *  - projects (the editable document, saved in place by autosave; named versions kept apart and
 *    restorable), soft-deleted so a deleted project can be brought back;
 *  - imported files (GLB/GLTF models, PNG/JPEG textures);
 *  - published models: built from a project version (GLB + asset definition), registered into
 *    the game's registry at startup and on publish, their collision triangles loaded for every
 *    match. Publishing never overwrites a published model unless the admin names it to replace.
 */
export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_PROJECTS = 500;
const MAX_VERSIONS = 60;

export interface ProjectSummary { id: string; name: string; kind: string; version: number; updatedAt: string; nodes: number; deleted?: boolean }
export interface Project extends ProjectSummary { doc: ModelDoc }
export interface PublishedModel { asset: number; name: string; projectId: string | null; projectVersion: number; version: number; def: AssetDefinitionInput; report: unknown }

const here = path.dirname(fileURLToPath(import.meta.url));

/** The web app's built model files (to embed game models into exports), when present on this host. */
function webAssets(): { dir: string; files: Record<string, { url: string }> } | null {
  for (const dir of [path.resolve(here, '../../../web/public'), path.resolve(process.cwd(), 'apps/web/public'), path.resolve(process.cwd(), '../web/public')]) {
    const manifest = path.join(dir, 'assets/manifest.json');
    if (existsSync(manifest)) {
      try { return { dir, files: (JSON.parse(readFileSync(manifest, 'utf8')) as { files: Record<string, { url: string }> }).files }; } catch { /* unreadable */ }
    }
  }
  return null;
}

export class ModelStudioStore {
  private readonly published = new Map<number, PublishedModel>();
  private web: ReturnType<typeof webAssets> | undefined;

  constructor(private readonly db: Db, private readonly registry: AssetRegistry) {}

  /** Published models into the registry and the collision meshes (startup). */
  async load(onInvalid?: (asset: number, err: unknown) => void): Promise<void> {
    const { rows } = await this.db.query<{ asset: number; name: string; project_id: string | null; project_version: number; def: AssetDefinitionInput; report: unknown; updated_at: Date; glb: Buffer }>(
      'SELECT asset, name, project_id, project_version, def, report, updated_at, glb FROM model_assets ORDER BY asset');
    for (const r of rows) {
      try { this.register({ asset: r.asset, name: r.name, projectId: r.project_id, projectVersion: r.project_version, version: new Date(r.updated_at).getTime(), def: r.def, report: r.report }, r.glb); }
      catch (err) { onInvalid?.(r.asset, err); }
    }
  }

  private register(model: PublishedModel, glb: Buffer): void {
    this.registry.registerUploaded(model.def);
    uploadedHitMeshes.set(model.asset, uploadedMapHitMesh(new Uint8Array(glb.buffer, glb.byteOffset, glb.byteLength), [0, 0, 0]));
    this.published.set(model.asset, model);
  }

  /** Definitions of every published model (worlds pass them to their workers and clients). */
  definitions(): AssetDefinitionInput[] { return [...this.published.values()].map((m) => m.def); }
  publishedList(): PublishedModel[] { return [...this.published.values()].sort((a, b) => a.asset - b.asset); }
  publishedModel(asset: number): PublishedModel | undefined { return this.published.get(asset); }

  async publishedFile(asset: number): Promise<Buffer | null> {
    if (!this.published.has(asset)) return null;
    const { rows } = await this.db.query<{ glb: Buffer }>('SELECT glb FROM model_assets WHERE asset = $1', [asset]);
    return rows[0]?.glb ?? null;
  }

  /* ------------------------------------------------------------------ projects */

  async list(includeDeleted = false): Promise<ProjectSummary[]> {
    const { rows } = await this.db.query<{ id: string; name: string; version: number; updated_at: Date; kind: string; nodes: number; deleted_at: Date | null }>(
      `SELECT id, name, version, updated_at, doc->>'kind' AS kind, jsonb_array_length(doc->'nodes') AS nodes, deleted_at FROM model_projects ${includeDeleted ? '' : 'WHERE deleted_at IS NULL'} ORDER BY updated_at DESC LIMIT ${MAX_PROJECTS}`);
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, version: r.version, updatedAt: new Date(r.updated_at).toISOString(), nodes: r.nodes, ...(r.deleted_at ? { deleted: true } : {}) }));
  }

  async get(id: string): Promise<Project | null> {
    const { rows } = await this.db.query<{ id: string; name: string; doc: unknown; version: number; updated_at: Date }>('SELECT id, name, doc, version, updated_at FROM model_projects WHERE id = $1 AND deleted_at IS NULL', [id]);
    const r = rows[0];
    if (!r) return null;
    const doc = parseDoc(r.doc);
    return { id: r.id, name: r.name, kind: doc.kind, version: r.version, updatedAt: new Date(r.updated_at).toISOString(), nodes: doc.nodes.length, doc };
  }

  async create(name: string, doc?: unknown): Promise<Project> {
    const { rows } = await this.db.query<{ n: string }>('SELECT count(*) AS n FROM model_projects WHERE deleted_at IS NULL');
    if (Number(rows[0]!.n) >= MAX_PROJECTS) throw new Error(`Tối đa ${MAX_PROJECTS} dự án.`);
    const d = doc ? parseDoc(doc) : emptyDoc(name);
    d.name = name;
    const id = randomUUID();
    await withTransaction(this.db, async (c) => {
      await c.query('INSERT INTO model_projects (id, name, doc) VALUES ($1, $2, $3::jsonb)', [id, name, JSON.stringify(d)]);
      await c.query('INSERT INTO model_project_versions (project_id, version, doc, note) VALUES ($1, 1, $2::jsonb, $3)', [id, JSON.stringify(d), 'Tạo dự án']);
    });
    return (await this.get(id))!;
  }

  /**
   * Saves the document. `baseVersion` must be the version the editor started from (another tab
   * or the agent may have saved since: a conflict, not a silent overwrite). `snapshot` keeps a
   * restorable version; autosaves just update the working copy.
   */
  async save(id: string, input: unknown, baseVersion: number, opts: { snapshot?: boolean; note?: string; author?: string } = {}): Promise<{ version: number; updatedAt: string }> {
    const doc = parseDoc(input);
    return withTransaction(this.db, async (c) => {
      const { rows } = await c.query<{ version: number }>('SELECT version FROM model_projects WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [id]);
      const cur = rows[0];
      if (!cur) throw Object.assign(new Error('Dự án không tồn tại.'), { statusCode: 404 });
      if (cur.version !== baseVersion) throw Object.assign(new Error(`Dự án đã được lưu ở nơi khác (phiên bản ${cur.version}, bạn đang sửa ${baseVersion}). Tải lại để tiếp tục.`), { statusCode: 409, current: cur.version });
      const version = cur.version + 1;
      const { rows: up } = await c.query<{ updated_at: Date }>('UPDATE model_projects SET doc = $2::jsonb, name = $3, version = $4, updated_at = now() WHERE id = $1 RETURNING updated_at', [id, JSON.stringify(doc), doc.name, version]);
      if (opts.snapshot) {
        await c.query('INSERT INTO model_project_versions (project_id, version, doc, note, author) VALUES ($1, $2, $3::jsonb, $4, $5)', [id, version, JSON.stringify(doc), (opts.note ?? '').slice(0, 200), (opts.author ?? 'admin').slice(0, 40)]);
        // Old snapshots beyond the limit go (the newest are kept).
        await c.query('DELETE FROM model_project_versions WHERE project_id = $1 AND version NOT IN (SELECT version FROM model_project_versions WHERE project_id = $1 ORDER BY version DESC LIMIT $2)', [id, MAX_VERSIONS]);
      }
      return { version, updatedAt: new Date(up[0]!.updated_at).toISOString() };
    });
  }

  async rename(id: string, name: string): Promise<void> {
    const p = await this.get(id);
    if (!p) throw Object.assign(new Error('Dự án không tồn tại.'), { statusCode: 404 });
    p.doc.name = name;
    await this.db.query('UPDATE model_projects SET name = $2, doc = $3::jsonb, version = version + 1, updated_at = now() WHERE id = $1', [id, name, JSON.stringify(p.doc)]);
  }

  async duplicate(id: string): Promise<Project> {
    const p = await this.get(id);
    if (!p) throw Object.assign(new Error('Dự án không tồn tại.'), { statusCode: 404 });
    return this.create(`${p.name} (bản sao)`.slice(0, 80), { ...p.doc, name: `${p.name} (bản sao)`.slice(0, 80) });
  }

  /** Soft delete (restorable). */
  async remove(id: string): Promise<void> { await this.db.query('UPDATE model_projects SET deleted_at = now() WHERE id = $1', [id]); }
  async restoreDeleted(id: string): Promise<void> { await this.db.query('UPDATE model_projects SET deleted_at = NULL, updated_at = now() WHERE id = $1', [id]); }

  async versions(id: string): Promise<Array<{ version: number; note: string; author: string; createdAt: string; nodes: number }>> {
    const { rows } = await this.db.query<{ version: number; note: string; author: string; created_at: Date; nodes: number }>(
      "SELECT version, note, author, created_at, jsonb_array_length(doc->'nodes') AS nodes FROM model_project_versions WHERE project_id = $1 ORDER BY version DESC", [id]);
    return rows.map((r) => ({ version: r.version, note: r.note, author: r.author, createdAt: new Date(r.created_at).toISOString(), nodes: r.nodes }));
  }

  async versionDoc(id: string, version: number): Promise<ModelDoc | null> {
    const { rows } = await this.db.query<{ doc: unknown }>('SELECT doc FROM model_project_versions WHERE project_id = $1 AND version = $2', [id, version]);
    return rows[0] ? parseDoc(rows[0].doc) : null;
  }

  /** Brings an old version back as the newest one (nothing is lost: the current one stays a version too). */
  async restoreVersion(id: string, version: number): Promise<{ version: number }> {
    const doc = await this.versionDoc(id, version);
    const cur = await this.get(id);
    if (!doc || !cur) throw Object.assign(new Error('Không có phiên bản này.'), { statusCode: 404 });
    await this.save(id, cur.doc, cur.version, { snapshot: true, note: `Trước khi khôi phục bản ${version}` });
    const after = await this.get(id);
    return this.save(id, doc, after!.version, { snapshot: true, note: `Khôi phục bản ${version}` });
  }

  /* ------------------------------------------------------------------- files */

  async addFile(projectId: string | null, name: string, bytes: Buffer): Promise<{ id: string; name: string; mime: string; size: number }> {
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`File quá lớn (tối đa ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
    const mime = sniff(bytes, name);
    if (!mime) throw new Error('Định dạng chưa hỗ trợ: dùng .glb, .gltf (nhúng dữ liệu), .png hoặc .jpg.');
    const id = randomUUID();
    await this.db.query('INSERT INTO model_files (id, project_id, name, mime, bytes, size) VALUES ($1, $2, $3, $4, $5, $6)', [id, projectId, name.slice(0, 200), mime, bytes, bytes.length]);
    return { id, name, mime, size: bytes.length };
  }

  /**
   * A library file (a downloaded texture map) in a project: the project's own copy, or a copy of
   * one another project already has (no second download), or null when nobody has it yet.
   */
  async reuseFile(projectId: string | null, name: string): Promise<{ id: string; name: string; mime: string; size: number } | null> {
    const own = await this.db.query<{ id: string; mime: string; size: number }>('SELECT id, mime, size FROM model_files WHERE name = $1 AND project_id IS NOT DISTINCT FROM $2 LIMIT 1', [name, projectId]);
    if (own.rows[0]) return { ...own.rows[0], name };
    const id = randomUUID();
    const { rows } = await this.db.query<{ mime: string; size: number }>('INSERT INTO model_files (id, project_id, name, mime, bytes, size) SELECT $1, $2, name, mime, bytes, size FROM model_files WHERE name = $3 LIMIT 1 RETURNING mime, size', [id, projectId, name]);
    return rows[0] ? { id, name, ...rows[0] } : null;
  }

  async files(projectId: string): Promise<Array<{ id: string; name: string; mime: string; size: number; createdAt: string }>> {
    const { rows } = await this.db.query<{ id: string; name: string; mime: string; size: number; created_at: Date }>('SELECT id, name, mime, size, created_at FROM model_files WHERE project_id = $1 ORDER BY created_at', [projectId]);
    return rows.map((r) => ({ id: r.id, name: r.name, mime: r.mime, size: r.size, createdAt: new Date(r.created_at).toISOString() }));
  }

  async file(id: string): Promise<{ name: string; mime: string; bytes: Buffer } | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const { rows } = await this.db.query<{ name: string; mime: string; bytes: Buffer }>('SELECT name, mime, bytes FROM model_files WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  /* ----------------------------------------------------------- export, publish */

  /** Every file a document refers to (imports, colour maps), loaded for an export. */
  private async docFiles(doc: ModelDoc): Promise<Map<string, { mime: string; bytes: Uint8Array }>> {
    const ids = new Set<string>();
    for (const n of doc.nodes) if (n.kind === 'import') ids.add(n.file);
    for (const m of doc.materials) { if (m.albedoFile) ids.add(m.albedoFile); for (const id of Object.values(m.maps ?? {})) if (id) ids.add(id); }
    const out = new Map<string, { mime: string; bytes: Uint8Array }>();
    for (const id of ids) { const f = await this.file(id); if (f) out.set(id, { mime: f.mime, bytes: new Uint8Array(f.bytes.buffer, f.bytes.byteOffset, f.bytes.byteLength) }); }
    return out;
  }

  /** A game model's GLB file from the web build (for embedding), if available and a GLB. */
  private assetFile(asset: number): Uint8Array | undefined {
    const def = this.registry.byNumericId(asset);
    if (!def || def.model.kind !== 'glb') return undefined;
    this.web ??= webAssets();
    const entry = this.web?.files[def.model.path];
    if (!entry) return undefined;
    const file = path.join(this.web!.dir, entry.url.replace(/^\//, ''));
    return existsSync(file) ? new Uint8Array(readFileSync(file)) : undefined;
  }

  async exportDoc(doc: ModelDoc, mode: 'game' | 'editable', embedAssets = false) {
    const files = await this.docFiles(doc);
    return exportModel(doc, {
      mode, deflate: (b) => new Uint8Array(deflateSync(b, { level: 6 })),
      importFile: (id) => files.get(id)?.bytes,
      imageFile: (id) => { const f = files.get(id); return f && f.mime.startsWith('image/') ? f : undefined; },
      assetFile: (a) => this.assetFile(a), embedAssets,
    });
  }

  validate(doc: unknown, fileIds?: Set<string>): ValidationReport {
    return validateDoc(doc, { asset: (id) => this.registry.byNumericId(id), ...(fileIds ? { files: fileIds } : {}) });
  }

  /**
   * Publishes a project version into the game. A new id unless `replaceAsset` names one of the
   * project's own published models (the admin confirmed replacing it). Refused when the model
   * does not validate.
   */
  async publish(projectId: string, opts: { replaceAsset?: number; lotClass?: string; version?: number }): Promise<PublishedModel & { warnings: string[] }> {
    const project = await this.get(projectId);
    if (!project) throw Object.assign(new Error('Dự án không tồn tại.'), { statusCode: 404 });
    const doc = opts.version ? await this.versionDoc(projectId, opts.version) : project.doc;
    if (!doc) throw Object.assign(new Error('Không có phiên bản này.'), { statusCode: 404 });
    const fileIds = new Set((await this.files(projectId)).map((f) => f.id));
    const report = this.validate(doc, fileIds);
    if (!report.ok) throw Object.assign(new Error(`Model chưa hợp lệ: ${report.issues.filter((i) => i.level === 'error').map((i) => i.message).slice(0, 4).join(' ')}`), { statusCode: 422 });
    let asset = opts.replaceAsset;
    if (asset !== undefined) {
      const old = this.published.get(asset);
      if (!old) throw Object.assign(new Error(`Model #${asset} chưa xuất bản.`), { statusCode: 404 });
      if (old.projectId !== projectId) throw Object.assign(new Error(`Model #${asset} thuộc dự án khác: không ghi đè.`), { statusCode: 409 });
    } else {
      asset = STUDIO_MODEL_ASSET_MIN;
      while (this.published.has(asset)) if (++asset > STUDIO_MODEL_ASSET_MAX) throw new Error('Đã hết chỗ cho model mới (tối đa 1000).');
    }
    const out = await this.exportDoc(doc, 'game');
    if (out.glb.length > MAX_FILE_BYTES) throw new Error(`Model xuất ra ${(out.glb.length / 1024 / 1024).toFixed(1)} MB — quá lớn (tối đa 40 MB): giảm độ phân giải texture.`);
    // Bounds of the model and its placed game models (so a map reserves room for its yard too).
    const tris = glbTriangles(out.glb, false);
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const t of tris) for (const p of t) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c]!, p[c]!); max[c] = Math.max(max[c]!, p[c]!); }
    for (const r of out.refs) {
      const b = this.registry.byNumericId(r.asset)?.bounds ?? { radius: .5, height: 1 };
      min[0] = Math.min(min[0], r.x - b.radius * r.scale); max[0] = Math.max(max[0], r.x + b.radius * r.scale);
      min[2] = Math.min(min[2], r.z - b.radius * r.scale); max[2] = Math.max(max[2], r.z + b.radius * r.scale);
      max[1] = Math.max(max[1], r.y + b.height * r.scale); min[1] = Math.min(min[1], r.y);
    }
    if (!Number.isFinite(min[0])) throw new Error('Model không có hình học.');
    const def = studioModelAsset({ asset, name: doc.name, kind: doc.kind, solid: tris.length > 0, ...(opts.lotClass ?? doc.lotClass ? { lotClass: opts.lotClass ?? doc.lotClass } : {}), min, max, refs: out.refs });
    // Checked the way every server and client will register it.
    createDefaultRegistry().registerUploaded(def);
    const summary = { triangles: out.triangles, materials: out.materials, bytes: out.glb.length, refs: out.refs.length, warnings: out.warnings, stats: report.stats };
    const glb = Buffer.from(out.glb.buffer, out.glb.byteOffset, out.glb.byteLength);
    const { rows } = await this.db.query<{ updated_at: Date }>(
      `INSERT INTO model_assets (asset, project_id, project_version, name, glb, def, report) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       ON CONFLICT (asset) DO UPDATE SET project_id = EXCLUDED.project_id, project_version = EXCLUDED.project_version, name = EXCLUDED.name, glb = EXCLUDED.glb, def = EXCLUDED.def, report = EXCLUDED.report, updated_at = now()
       RETURNING updated_at`,
      [asset, projectId, opts.version ?? project.version, doc.name, glb, JSON.stringify(def), JSON.stringify(summary)]);
    const model: PublishedModel = { asset, name: doc.name, projectId, projectVersion: opts.version ?? project.version, version: new Date(rows[0]!.updated_at).getTime(), def, report: summary };
    this.register(model, glb);
    return { ...model, warnings: out.warnings };
  }

  /** Takes a published model out of the game (maps that place it lose it at their next build). */
  async unpublish(asset: number): Promise<void> {
    await this.db.query('DELETE FROM model_assets WHERE asset = $1', [asset]);
    this.published.delete(asset);
    uploadedHitMeshes.delete(asset);
  }
}

function sniff(b: Buffer, name: string): string | null {
  if (b.length >= 4 && b.readUInt32LE(0) === 0x46546c67) return 'model/gltf-binary';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (/\.gltf$/i.test(name) && b.subarray(0, 200).toString('utf8').trimStart().startsWith('{')) return 'model/gltf+json';
  return null;
}
