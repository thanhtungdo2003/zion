import { Group, Mesh, type Scene } from 'three';
import { loadBBModel } from './bbmodel-loader';
import { cachedFetch } from '@/lib/preload';

export interface LifeVisual { id: string; model: string; x: number; y: number; z: number }
/** Shared Blockbench loader; server packets alone determine the visible crop stages. */
export class BaseLifeRenderer {
  private cache = new Map<string, Promise<Group>>();
  private objects = new Map<string, { model: string; group: Group }>();
  private revision = 0;
  private disposed = false;
  constructor(private scene: Scene) {}
  private template(path: string): Promise<Group> {
    let pending = this.cache.get(path);
    if (!pending) {
      pending = (async () => {
        const response = await cachedFetch(path);
        if (!response.ok) throw new Error(`Missing model: ${path}`);
        const parts = await loadBBModel(await response.json(), 16, [0, 0, 0]);
        const root = new Group();
        for (const part of parts) root.add(new Mesh(part.geometry, part.material));
        return root;
      })();
      this.cache.set(path, pending);
    }
    return pending;
  }
  async update(visuals: LifeVisual[]): Promise<void> {
    const revision = ++this.revision;
    const ids = new Set(visuals.map((v) => v.id));
    for (const [id, entry] of this.objects) if (!ids.has(id)) { this.scene.remove(entry.group); this.objects.delete(id); }
    await Promise.all(visuals.map(async (v) => {
      let entry = this.objects.get(v.id);
      if (!entry || entry.model !== v.model) {
        const template = await this.template(v.model);
        if (this.disposed || revision !== this.revision) return;
        if (entry) this.scene.remove(entry.group);
        entry = { model: v.model, group: template.clone(true) };
        this.objects.set(v.id, entry);
        this.scene.add(entry.group);
      }
      entry.group.position.set(v.x, v.y, v.z);
    }));
  }
  dispose(): void {
    this.disposed = true;
    for (const entry of this.objects.values()) this.scene.remove(entry.group);
    for (const pending of this.cache.values()) void pending.then((group) => group.traverse((o) => {
      if (o instanceof Mesh) { o.geometry.dispose(); const materials = Array.isArray(o.material) ? o.material : [o.material]; for (const mat of materials) { if ('map' in mat) (mat.map as { dispose(): void } | null)?.dispose(); mat.dispose(); } }
    })).catch(() => undefined);
    this.cache.clear(); this.objects.clear();
  }
}
