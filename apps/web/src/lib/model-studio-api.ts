import type { ModelDoc, ValidationReport } from '@zion/assets/model-studio';
import { studioFetch, studioJson } from './api';

/** Model Studio server API (projects, files, agent, export, publishing). */
export interface ProjectSummary { id: string; name: string; kind: string; version: number; updatedAt: string; nodes: number; deleted?: boolean }
export interface ProjectFile { id: string; name: string; mime: string; size: number; createdAt?: string }
export interface Project extends ProjectSummary { doc: ModelDoc; files: ProjectFile[] }
export interface VersionInfo { version: number; note: string; author: string; createdAt: string; nodes: number }
export interface PublishedModel { asset: number; name: string; projectId: string | null; projectVersion: number; version: number; def: { category: string; bounds: { radius: number; height: number }; tags?: string[]; fit?: unknown }; report: { triangles?: number; materials?: number; bytes?: number; refs?: number; warnings?: string[] } }
export interface AgentStep { at: number; kind: 'plan' | 'thought' | 'tool' | 'error' | 'info' | 'done'; text: string; tool?: string; args?: unknown; ok?: boolean; result?: unknown }
export interface AgentJob {
  id: string; status: 'running' | 'done' | 'failed' | 'cancelled'; mode: 'ai' | 'offline'; model: string | null; prompt: string;
  steps: AgentStep[]; total: number; summary: string | null; issues: string[]; savedVersion: number | null; saveError: string | null;
  usage: { prompt: number; completion: number; total: number; turns: number };
  publishRequests: Array<{ id: string; lotClass: string | null; replaceAsset: number | null; note: string }>;
  revision: number;
  finished: boolean;
  doc?: ModelDoc;
}

export interface AiStatus { configured: boolean; source: 'studio' | 'env' | null; keyHint: string | null; baseUrl: string; model: string; imageModel: string }
export interface TextureHit { id: string; name: string; categories: string[]; tags: string[]; sizeM: number | null; description: string }
export interface TextureSet { maps: { albedo: string; normal?: string; orm?: string }; scale: number; source: { kind: 'polyhaven' | 'ai'; id: string; name: string; license?: string; url?: string }; files: ProjectFile[] }

const P = '/api/studio/models';
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });

export const msApi = {
  status: () => studioJson<{ ai: boolean; model: string | null; published: number }>(`${P}/status`),
  ai: () => studioJson<AiStatus>(`${P}/ai`),
  setAi: (body: { apiKey?: string; baseUrl?: string; model?: string; imageModel?: string }) => studioJson<AiStatus>(`${P}/ai`, json(body, 'PUT')),
  textures: (q: string) => studioJson<{ results: TextureHit[]; canPaint: boolean }>(`${P}/textures?q=${encodeURIComponent(q)}&limit=24`),
  textureThumb: async (id: string): Promise<string> => URL.createObjectURL(await (await studioFetch(`${P}/textures/${id}/thumb`)).blob()),
  downloadTexture: (project: string, id: string, resolution: '1k' | '2k') => studioJson<TextureSet>(`${P}/textures/download`, json({ project, id, resolution })),
  paintTexture: (project: string, prompt: string, roughness?: number, metalness?: number) => studioJson<TextureSet>(`${P}/textures/paint`, json({ project, prompt, ...(roughness !== undefined ? { roughness } : {}), ...(metalness !== undefined ? { metalness } : {}) })),
  aiModels: () => studioJson<{ models: string[]; error: string | null }>(`${P}/ai/models`),
  list: (deleted = false) => studioJson<ProjectSummary[]>(`${P}/projects${deleted ? '?deleted=1' : ''}`),
  get: (id: string) => studioJson<Project>(`${P}/projects/${id}`),
  create: (name: string, doc?: ModelDoc) => studioJson<Project>(`${P}/projects`, json({ name, ...(doc ? { doc } : {}) })),
  save: (id: string, doc: ModelDoc, baseVersion: number, snapshot?: { note: string }) =>
    studioJson<{ version: number; updatedAt: string }>(`${P}/projects/${id}`, json({ doc, baseVersion, ...(snapshot ? { snapshot: true, note: snapshot.note } : {}) }, 'PUT')),
  rename: (id: string, name: string) => studioJson<{ ok: true }>(`${P}/projects/${id}/rename`, json({ name })),
  duplicate: (id: string) => studioJson<Project>(`${P}/projects/${id}/duplicate`, json({})),
  remove: (id: string) => studioJson<{ ok: true }>(`${P}/projects/${id}?confirm=1`, { method: 'DELETE' }),
  purge: (id: string) => studioJson<{ ok: true }>(`${P}/projects/${id}?confirm=1&permanent=1`, { method: 'DELETE' }),
  undelete: (id: string) => studioJson<{ ok: true }>(`${P}/projects/${id}/undelete`, json({})),
  versions: (id: string) => studioJson<VersionInfo[]>(`${P}/projects/${id}/versions`),
  restore: (id: string, version: number) => studioJson<{ version: number }>(`${P}/projects/${id}/versions/${version}/restore`, json({})),
  upload: async (project: string, file: File): Promise<ProjectFile> => {
    const res = await studioFetch(`${P}/files?project=${project}&name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': 'application/x-model-file' }, body: file });
    return res.json() as Promise<ProjectFile>;
  },
  validate: (doc: ModelDoc, project?: string) => studioJson<ValidationReport>(`${P}/validate`, json({ doc, ...(project ? { project } : {}) })),
  exportGlb: async (doc: ModelDoc, mode: 'game' | 'editable', embedAssets?: boolean): Promise<{ blob: Blob; warnings: string[]; triangles: number; refs: number }> => {
    const res = await studioFetch(`${P}/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc, mode, ...(embedAssets !== undefined ? { embedAssets } : {}) }) });
    let warnings: string[] = [];
    try { warnings = JSON.parse(decodeURIComponent(res.headers.get('x-export-warnings') ?? '[]')) as string[]; } catch { /* none */ }
    return { blob: await res.blob(), warnings, triangles: Number(res.headers.get('x-export-triangles') ?? 0), refs: Number(res.headers.get('x-export-refs') ?? 0) };
  },
  published: () => studioJson<PublishedModel[]>(`${P}/published`),
  publish: (id: string, body: { lotClass?: string; replaceAsset?: number; version?: number }) => studioJson<PublishedModel & { warnings: string[] }>(`${P}/projects/${id}/publish`, json({ confirm: true, ...body })),
  /** Where a published building may stand on maps, changed without publishing it again. */
  setFit: (asset: number, fit: unknown) => studioJson<PublishedModel>(`${P}/published/${asset}/fit`, json({ fit }, 'PUT')),
  unpublish: (asset: number) => studioJson<{ ok: true }>(`${P}/published/${asset}?confirm=1`, { method: 'DELETE' }),
  trial: () => studioJson<{ active: number[]; saved: number[] }>(`${P}/trial`),
  setTrial: (assets: number[]) => studioJson<{ active: number[]; saved: number[]; restartRequired: boolean }>(`${P}/trial`, json({ assets, confirm: true })),
  agentStart: (project: string, prompt: string, offline?: boolean) => studioJson<{ job: string; mode: string; model: string | null }>(`${P}/agent`, json({ project, prompt, ...(offline ? { offline: true } : {}) })),
  agentLatest: (project: string) => studioJson<{ job: { id: string; status: AgentJob['status']; prompt: string; finished: boolean } | null }>(`${P}/agent?project=${encodeURIComponent(project)}`),
  agentGet: (job: string, after: number, doc = false, rev?: number) => studioJson<AgentJob>(`${P}/agent/${job}?after=${after}${doc ? '&doc=1' : ''}${rev !== undefined ? `&rev=${rev}` : ''}`),
  agentCancel: (job: string) => studioJson<{ ok: boolean }>(`${P}/agent/${job}/cancel`, json({})),
  agentPublish: (job: string, request: string, confirm: boolean) => studioJson<unknown>(`${P}/agent/${job}/publish/${request}`, json({ confirm })),
};
