import { CHEST_CAPACITY, CHEST_SEARCH_MS, InventoryModel, generateChestLoot, isStash, type ChestData, type ChestStateMessage, type InventoryData, type InvMessage } from '@zion/shared';
import type { Player } from './player';

type ChestRequest = Extract<InvMessage, { op: 'chestOpen' | 'chestClose' | 'chestSearch' | 'chestPut' | 'chestTake' }>;
interface LiveChest { id: string; field: boolean; data: ChestData; busy: boolean; search: { player: Player; until: number } | null }
export interface ChestHooks {
  near(player: Player, id: string): { field: boolean } | null;
  load(id: string): Promise<ChestData | null>;
  commit(id: string, data: ChestData, player?: Player, inventory?: InventoryData): Promise<void>;
  sync(player: Player): void;
  finish(player: Player): void;
  error(error: unknown): void;
}

/** One authoritative inventory and one search for every world prop, shared by all its viewers. */
export class SharedChests {
  private readonly chests = new Map<string, LiveChest>();
  private readonly loading = new Map<string, Promise<LiveChest>>();
  private readonly viewers = new Map<Player, string>();
  constructor(private readonly hooks: ChestHooks, private readonly clock: () => number, private readonly day: () => number = () => 0) {}

  /** Field crates are emptied and become searchable again at the start of every world day. */
  private refresh(c: LiveChest): boolean {
    const today = this.day();
    if (!c.field || c.busy || c.search || c.data.day === today) return false;
    if (c.data.day === undefined) { c.data.day = today; return false; }
    c.data = { items: [], searched: false, revision: c.data.revision + 1, day: today };
    return true;
  }

  private async load(id: string, field: boolean): Promise<LiveChest> {
    const current = this.chests.get(id); if (current) return current;
    const pending = this.loading.get(id); if (pending) return pending;
    const promise = this.hooks.load(id).then((data) => {
      const chest: LiveChest = { id, field, data: data ?? { items: [], searched: false, revision: 0 }, busy: false, search: null };
      this.chests.set(id, chest); return chest;
    }).finally(() => this.loading.delete(id));
    this.loading.set(id, promise); return promise;
  }

  private send(p: Player, c: LiveChest, error?: string, closed = false): void {
    const message: ChestStateMessage = { t: 'chest', id: c.id, field: c.field, ...c.data, capacity: CHEST_CAPACITY, searchRemainingMs: c.search ? Math.max(0, c.search.until - this.clock()) : 0, busy: c.busy, error, closed };
    p.session.sendJson(message);
  }
  private notify(c: LiveChest): void { for (const [p, id] of this.viewers) if (id === c.id) this.send(p, c); }
  close(p: Player): void {
    const id = this.viewers.get(p); this.viewers.delete(p);
    const c = id ? this.chests.get(id) : undefined;
    if (!c) return;
    if (c.search?.player === p && !c.busy) { c.search = null; this.notify(c); }
    this.send(p, c, undefined, true);
  }

  async handle(p: Player, msg: ChestRequest): Promise<void> {
    if (msg.op === 'chestClose') { this.close(p); return; }
    const location = this.hooks.near(p, msg.id);
    if (!location || p.questBusy) return;
    p.questBusy = true;
    try {
      const c = await this.load(msg.id, location.field);
      if (this.refresh(c)) this.notify(c);
      if (!p.session.open || !this.hooks.near(p, msg.id)) { this.send(p, c, undefined, true); return; }
      if (msg.op === 'chestOpen') {
        if (this.viewers.get(p) !== c.id) this.close(p);
        this.viewers.set(p, c.id); this.send(p, c); return;
      }
      if (this.viewers.get(p) !== c.id) return;
      if (c.busy || c.search) { this.send(p, c, 'Hòm đang được tìm kiếm hoặc cập nhật.'); return; }
      if (msg.op === 'chestSearch') {
        if (!c.field || c.data.searched) { this.send(p, c); return; }
        if (c.data.items.length === CHEST_CAPACITY) { this.send(p, c, 'Hòm đầy: hãy lấy bớt đồ trước khi Search.'); return; }
        c.search = { player: p, until: this.clock() + CHEST_SEARCH_MS }; this.notify(c); return;
      }
      if (msg.revision !== c.data.revision) { this.send(p, c, 'Nội dung vừa thay đổi; hãy thử lại.'); return; }
      const inv = new InventoryModel(p.inv.toJSON());
      const next = structuredClone(c.data);
      if (msg.op === 'chestPut') {
        const item = inv.get(msg.uid);
        if (!item || isStash(item.container) || next.items.length >= CHEST_CAPACITY) { this.send(p, c, 'Không thể cất vật phẩm hoặc hòm đã đầy.'); return; }
        inv.remove(item.uid);
        next.items.push({ ...item, uid: Math.max(0, ...next.items.map((i) => i.uid)) + 1, container: 'backpack', x: 0, y: 0 });
      } else {
        const item = next.items.find((i) => i.uid === msg.uid);
        if (!item) { this.send(p, c); return; }
        const added = inv.add(item.itemId, item.count, item.issued);
        if (!added) { this.send(p, c, 'Túi đồ không đủ chỗ.'); return; }
        if (item.mag !== undefined) added.mag = item.mag;
        if (item.quest) added.quest = item.quest;
        next.items = next.items.filter((i) => i.uid !== msg.uid);
      }
      next.revision++;
      c.busy = true; this.notify(c);
      try {
        await this.hooks.commit(c.id, next, p, inv.toJSON());
        c.data = next; p.inv.load(inv.toJSON()); this.hooks.sync(p);
      } finally { c.busy = false; this.notify(c); }
    } catch (err) {
      this.hooks.error(err);
      const c = this.chests.get(msg.id); if (c) this.send(p, c, 'Không thể lưu hòm. Vật phẩm chưa được chuyển; hãy thử lại.');
      else p.session.sendJson({ t: 'error', code: 'invalid_message', message: 'Không thể mở hòm. Hãy thử lại.', fatal: false });
    } finally { this.hooks.finish(p); }
  }

  step(): void {
    for (const [p, id] of this.viewers) if (!p.session.open || !this.hooks.near(p, id)) this.close(p);
    for (const c of this.chests.values()) {
      if (!c.busy && c.search && this.clock() >= c.search.until) {
        if (c.search.player.questBusy) continue;
        c.search = null; c.busy = true; this.notify(c);
        void this.completeSearch(c);
      }
    }
  }
  private async completeSearch(c: LiveChest): Promise<void> {
    let failed = false;
    try {
      const next: ChestData = { items: generateChestLoot(c.data.items), searched: true, revision: c.data.revision + 1, day: c.data.day ?? this.day() };
      await this.hooks.commit(c.id, next); c.data = next;
    } catch (err) {
      failed = true;
      this.hooks.error(err);
    } finally {
      c.busy = false;
      for (const [p, id] of this.viewers) if (id === c.id) this.send(p, c, failed ? 'Không thể lưu kết quả Search; hãy thử lại.' : undefined);
    }
  }
}
