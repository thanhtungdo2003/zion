import type { WorldAtlas, WorldInfo } from '@zion/shared';
import { currentAccount, getWorldAtlas } from '@/lib/api';
import type { MapCamera } from './map-camera';

function savedCamera(value: unknown): MapCamera | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as MapCamera;
  return Number.isFinite(c.x) && Number.isFinite(c.z) && Number.isFinite(c.scale) && c.scale > 0
    ? { x: c.x, z: c.z, scale: Math.max(0.025, Math.min(8, c.scale)) } : null;
}

export const MAP_ICONS = [
  { id: 'lucide:flag', name: 'Cờ' }, { id: 'lucide:house', name: 'Nhà' },
  { id: 'lucide:boxes', name: 'Vật phẩm' }, { id: 'lucide:skull', name: 'Nguy hiểm' },
  { id: 'lucide:crosshair', name: 'Mục tiêu' }, { id: 'lucide:heart-pulse', name: 'Y tế' },
  { id: 'lucide:shield', name: 'An toàn' }, { id: 'lucide:tent', name: 'Trại' },
  { id: 'lucide:wheat', name: 'Nông trại' }, { id: 'lucide:utensils', name: 'Bếp' },
] as const;
const ROLE_NAMES: Record<string, string> = { farmer: 'Nông dân', chef: 'Đầu bếp', colonel: 'Đại tá', merchant: 'Thương nhân', nurse: 'Y tá', storage: 'Kho căn cứ', target: 'Trường bắn' };
const ROLE_ICONS: Record<string, string> = { farmer: 'lucide:wheat', chef: 'lucide:utensils', colonel: 'lucide:shield', merchant: 'lucide:boxes', nurse: 'lucide:heart-pulse', storage: 'lucide:boxes', target: 'lucide:crosshair' };
export interface MapLocation { id: string; name: string; icon: string; x: number; z: number; fixed: boolean; guide: boolean; role?: string; quest?: boolean }
type Span = [number, number];
export type ExploredRows = Array<[number, Span[]]>;

/** Union of player-centred 50 m squares at metre resolution; merged rows keep long journeys compact. */
export class Exploration {
  readonly rows = new Map<number, Span[]>();
  constructor(saved: ExploredRows = []) {
    for (const [z, spans] of saved) if (Number.isInteger(z) && spans.every(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && a < b)) this.rows.set(z, spans.map(([a, b]) => [a, b]));
  }
  reveal(x: number, z: number, size: number): boolean {
    const left = Math.max(0, Math.round(x) - 25), right = Math.min(size, Math.round(x) + 25);
    const top = Math.max(0, Math.round(z) - 25), bottom = Math.min(size, Math.round(z) + 25);
    if (left >= right || top >= bottom) return false;
    let changed = false;
    for (let row = top; row < bottom; row++) {
      const spans = this.rows.get(row) ?? [];
      if (spans.some(([a, b]) => a <= left && b >= right)) continue;
      const merged: Span[] = []; let a = left, b = right;
      for (const [c, d] of spans) {
        if (d < a) merged.push([c, d]);
        else if (c > b) { merged.push([a, b]); a = c; b = d; }
        else { a = Math.min(a, c); b = Math.max(b, d); }
      }
      merged.push([a, b]); this.rows.set(row, merged); changed = true;
    }
    return changed;
  }
  has(x: number, z: number): boolean { return this.rows.get(Math.floor(z))?.some(([a, b]) => x >= a && x < b) ?? false; }
  serialize(): ExploredRows { return [...this.rows]; }
}
export interface MapState {
  world: WorldInfo | null; atlas: WorldAtlas | null; error: string | null;
  locations: MapLocation[]; arrows: boolean; revision: number;
  camera: MapCamera | null;
}

/** Personal map notebook, saved per account and world in this browser. */
export class WorldMapStore {
  private state: MapState = { world: null, atlas: null, error: null, locations: [], arrows: true, revision: 0, camera: null };
  exploration = new Exploration();
  private key = '';
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private fixedGuides: Record<string, boolean> = {};
  private lastPosition = '';
  get = (): MapState => this.state;
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private emit(patch: Partial<MapState> = {}): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    for (const fn of this.listeners) fn();
  }
  initialize(world: WorldInfo): void {
    this.flush();
    this.key = `zion.map.v1:${currentAccount()?.id ?? 'guest'}:${world.worldId}:${world.cosmeticSeed}:${world.generatorVersion}:${world.sizeChunks}`;
    this.exploration = new Exploration(); this.fixedGuides = {}; this.lastPosition = '';
    let locations: MapLocation[] = [], arrows = true, camera: MapCamera | null = null;
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) ?? 'null');
      if (saved) {
        this.exploration = new Exploration(saved.rows ?? []);
        locations = (saved.locations ?? []).filter((m: MapLocation) => !m.fixed && typeof m.id === 'string' && typeof m.name === 'string' && Number.isFinite(m.x) && Number.isFinite(m.z) && MAP_ICONS.some((i) => i.id === m.icon)).slice(0, 100);
        this.fixedGuides = saved.fixedGuides ?? {}; arrows = saved.arrows !== false;
        camera = savedCamera(saved.camera);
      }
    } catch { /* Empty or unavailable browser storage. */ }
    this.emit({ world, atlas: null, error: null, locations, arrows, camera });
    this.updateFixed([]);
    void this.loadAtlas();
  }
  async loadAtlas(): Promise<void> {
    const generation = ++this.generation;
    this.emit({ error: null });
    try {
      const atlas = await getWorldAtlas();
      if (generation === this.generation && atlas.worldId === this.state.world?.worldId) this.emit({ atlas });
    } catch { if (generation === this.generation) this.emit({ error: 'Không tải được địa hình. Thử tải lại bản đồ.' }); }
  }
  updateFixed(npcs: ReadonlyArray<{ role: string; x: number; z: number; quest?: boolean }>): void {
    const camp = this.state.world?.camp;
    const fixed: MapLocation[] = camp ? [{ id: 'base:home', name: 'Căn cứ', icon: 'lucide:house', x: camp.x, z: camp.z, fixed: true, guide: this.fixedGuides['base:home'] ?? false }] : [];
    const counts: Record<string, number> = {};
    npcs.filter((n) => n.role !== 'sos' && n.role !== 'target').forEach((n) => {
      const index = counts[n.role] ?? 0; counts[n.role] = index + 1;
      const id = `base:${n.role}:${index}`;
      fixed.push({ id, name: ROLE_NAMES[n.role] ?? n.role, icon: ROLE_ICONS[n.role] ?? 'lucide:flag', x: n.x, z: n.z, fixed: true, guide: this.fixedGuides[id] ?? true, role: n.role, quest: n.quest });
    });
    const locations = [...fixed, ...this.state.locations.filter((m) => !m.fixed)];
    if (JSON.stringify(locations) !== JSON.stringify(this.state.locations)) this.emit({ locations });
  }
  explore(x: number, z: number): void {
    if (!this.state.world) return;
    const position = `${Math.round(x)},${Math.round(z)}`;
    if (position === this.lastPosition) return;
    this.lastPosition = position;
    const camp = this.state.world.camp;
    if (camp && Math.hypot(Math.abs(x - camp.x) + 25, Math.abs(z - camp.z) + 25) <= 1000) return;
    if (this.exploration.reveal(x, z, this.state.world.sizeChunks * this.state.world.chunkSize)) { this.emit(); this.saveSoon(); }
  }
  known(x: number, z: number): boolean {
    const world = this.state.world;
    if (!world || x < 0 || z < 0 || x >= world.sizeChunks * world.chunkSize || z >= world.sizeChunks * world.chunkSize) return false;
    const camp = this.state.world?.camp;
    return (!!camp && Math.hypot(x - camp.x, z - camp.z) <= 1000) || this.exploration.has(x, z);
  }
  add(x: number, z: number, name: string, icon: string): string | null {
    if (this.state.locations.filter((m) => !m.fixed).length >= 100 || !name.trim() || !this.known(x, z) || !MAP_ICONS.some((i) => i.id === icon)) return null;
    const id = crypto.randomUUID();
    this.emit({ locations: [...this.state.locations, { id, name: name.trim().slice(0, 40), icon, x, z, fixed: false, guide: false }] }); this.saveSoon(); return id;
  }
  edit(id: string, patch: Partial<Pick<MapLocation, 'name' | 'icon' | 'guide'>>): void {
    const location = this.state.locations.find((m) => m.id === id);
    if (!location) return;
    if (location.fixed) { patch = { guide: patch.guide ?? location.guide }; this.fixedGuides[id] = patch.guide!; }
    if (patch.name !== undefined) { patch.name = patch.name.trim().slice(0, 40); if (!patch.name) return; }
    this.emit({ locations: this.state.locations.map((m) => m.id === id ? { ...m, ...patch } : m) }); this.saveSoon();
  }
  remove(id: string): void { this.emit({ locations: this.state.locations.filter((m) => m.fixed || m.id !== id) }); this.saveSoon(); }
  setArrows(arrows: boolean): void { this.emit({ arrows }); this.saveSoon(); }
  setCamera(value: MapCamera): void {
    const camera = savedCamera(value);
    if (!camera || (camera.x === this.state.camera?.x && camera.z === this.state.camera?.z && camera.scale === this.state.camera?.scale)) return;
    this.emit({ camera }); this.saveSoon();
  }
  private saveSoon(): void { if (!this.timer) this.timer = setTimeout(() => this.flush(), 3000); }
  flush(): void {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (!this.key) return;
    try { localStorage.setItem(this.key, JSON.stringify({ rows: this.exploration.serialize(), locations: this.state.locations.filter((m) => !m.fixed), fixedGuides: this.fixedGuides, arrows: this.state.arrows, camera: this.state.camera })); } catch { /* Keep playing if browser storage is full. */ }
  }
  dispose(): void { this.flush(); this.generation++; }
}
