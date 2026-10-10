import { baseLifeSchema, DEFAULT_BASE_LIFE } from './base-life';
import { z } from 'zod';
import { ITEMS } from './items';

/**
 * Data-driven game content edited in the Camp Studio: quest NPCs, their dialogue and every quest.
 * The server validates it (schema + cross-references) before use; nothing here is hardcoded in
 * game logic, so new quests need no code changes.
 */
export const STRUCTURE_KIND_IDS = ['house_small', 'house_large', 'ruined_camp', 'factory', 'power_plant', 'town'] as const;
export const NPC_MODELS = [
  '/models/npcs/farmer.bbmodel',
  '/models/npcs/military-chef-npc.bbmodel',
  '/models/npcs/special-forces-soldier.bbmodel',
  '/models/npcs/armored-soldier.bbmodel',
  '/models/npcs/weapon-merchant-npc.bbmodel',
  '/models/npcs/curvy-nurse.bbmodel',
] as const;

const id = z.string().regex(/^[a-z0-9_]{1,40}$/, 'use a-z, 0-9 and _');
const text = z.string().min(1).max(400);
const lines = z.array(z.string().min(1).max(200)).max(20);
const count = z.number().int().min(1).max(999);

/** One quest step. Steps run in order (a multi-stage quest has several). */
export const objectiveSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('plant'), target: id, count }).strict(),
  z.object({ type: z.literal('harvest'), target: id, count }).strict(),
  z.object({ type: z.literal('collect'), target: id, count }).strict(),
  z.object({ type: z.literal('cook'), target: id, count }).strict(),
  z.object({ type: z.literal('interact'), target: id, count }).strict(),
  /** Kill zombies anywhere. */
  z.object({ type: z.literal('kill'), target: z.enum(['zombie']), count }).strict(),
  /** Reach a randomly assigned structure of a kind (an abandoned camp, factory…). */
  z.object({ type: z.literal('visit'), structure: z.enum(STRUCTURE_KIND_IDS), location: id.optional() }).strict(),
  /**
   * A private item appears at a randomly assigned structure of a kind (only this player sees it); pick it
   * up. `count` copies are placed.
   */
  z.object({ type: z.literal('retrieve'), item: id, structure: z.enum(STRUCTURE_KIND_IDS), location: id.optional(), count }).strict(),
  /** Bring items to the quest giver (handed over when the quest is turned in). */
  z.object({ type: z.literal('deliver'), item: id, count }).strict(),
]);

export const questSchema = z
  .object({
    id,
    npc: id,
    title: z.string().min(1).max(80),
    description: text,
    /** Daily quests reset every day; long-term quests are done once. */
    kind: z.enum(['daily', 'long']),
    enabled: z.boolean(),
    allowCancel: z.boolean().optional(),
    availableFrom: z.number().int().min(0).optional(),
    availableUntil: z.number().int().min(0).optional(),
    /** Quests that must be completed first. */
    prereq: z.array(id).max(10),
    objectives: z.array(objectiveSchema).min(1).max(8),
    rewards: z.object({ coins: z.number().int().min(0).max(100_000), items: z.array(z.object({ item: id, count }).strict()).max(8) }).strict(),
    /** What the NPC says when offering, accepting, while in progress and on completion. */
    dialogue: z.object({ offer: text, accept: text, progress: text, complete: text }).strict(),
  })
  .strict();

export const npcSchema = z
  .object({
    id,
    name: z.string().min(1).max(60),
    model: z.enum(NPC_MODELS),
    /** Weapon shown in hand (WeaponId, 0 = none). */
    weapon: z.number().int().min(0).max(255),
    /** > 0: walks around its spot like the gate guards (metres). */
    patrolRadius: z.number().min(0).max(15).optional(),
    combat: z.object({ enabled: z.boolean(), range: z.number().min(1).max(100), fireIntervalMs: z.number().int().min(100).max(60_000) }).strict().optional(),
    /** Camp-local position (metres from the camp centre). */
    x: z.number().finite().min(-70).max(70),
    z: z.number().finite().min(-70).max(70),
    /** E opens the dialogue within this distance; greetings trigger within `greetRange`. */
    interactRange: z.number().min(1).max(10),
    greetRange: z.number().min(2).max(30),
    greetings: lines,
    ambient: lines,
    /** Ambient lines are shown to everyone nearby (otherwise only to the player being greeted). */
    ambientPublic: z.boolean(),
    /** Minimum time between lines said to the same player, and how long a bubble stays. */
    cooldownMs: z.number().int().min(1000).max(600_000),
    bubbleMs: z.number().int().min(1000).max(30_000),
  })
  .strict();

export const contentSchema = z
  .object({
    version: z.literal(1),
    baseLife: baseLifeSchema.optional(),
    /** Daily quests reset at this hour (UTC). */
    dailyResetHourUtc: z.number().int().min(0).max(23),
    npcs: z.array(npcSchema).max(20),
    quests: z.array(questSchema).max(500),
  })
  .strict();

export type QuestObjective = z.infer<typeof objectiveSchema>;
export type QuestDef = z.infer<typeof questSchema>;
export type NpcDef = z.infer<typeof npcSchema>;
export type GameContent = z.infer<typeof contentSchema>;

/** Schema check plus the cross-references a schema can't see; returns readable errors. */
export function validateContent(raw: unknown): { ok: true; content: GameContent } | { ok: false; errors: string[] } {
  const parsed = contentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.slice(0, 30).map((i) => `${i.path.join('.')}: ${i.message}`) };
  const c = parsed.data;
  const errors: string[] = [];
  const npcIds = new Set<string>();
  for (const n of c.npcs) {
    if (npcIds.has(n.id)) errors.push(`npc ${n.id}: duplicate id`);
    npcIds.add(n.id);
  }
  if (c.baseLife) {
    const life = c.baseLife;
    const checkItem = (item: string, at: string) => { if (!ITEMS[item]) errors.push(`${at}: unknown item ${item}`); };
    const unique = (list: { id: string }[], at: string) => { if (new Set(list.map((x) => x.id)).size !== list.length) errors.push(`${at}: duplicate IDs`); };
    unique(life.locations ?? [], 'locations');
    for (const item of Object.keys(life.itemModels ?? {})) checkItem(item, 'item model');
    for (const food of life.foods ?? []) checkItem(food.item, 'food');
    unique(life.animals ?? [], 'animals');
    for (const animal of life.animals ?? []) { checkItem(animal.lootItem, `animal ${animal.id}`); if (animal.lootMin > animal.lootMax) errors.push(`animal ${animal.id}: minimum loot exceeds maximum`); }
    unique(life.crops, 'crops'); unique(life.plots, 'plots'); unique(life.stations, 'stations'); unique(life.recipes, 'recipes'); unique(life.trades, 'trades');
    for (const crop of life.crops) { checkItem(crop.item, `crop ${crop.id}`); checkItem(crop.yieldItem, `crop ${crop.id}`); }
    for (const recipe of life.recipes) { checkItem(recipe.input, `recipe ${recipe.id}`); checkItem(recipe.output, `recipe ${recipe.id}`); }
    for (const trade of life.trades) { checkItem(trade.item, `trade ${trade.id}`); if (!npcIds.has(trade.npc)) errors.push(`trade ${trade.id}: unknown NPC`); }
    if (life.stamina.minimumCapacity > life.stamina.maximum) errors.push('stamina: minimum capacity exceeds maximum');
  }
  const questIds = new Set(c.quests.map((q) => q.id));
  const seen = new Set<string>();
  for (const q of c.quests) {
    const at = `quest ${q.id}`;
    if (seen.has(q.id)) errors.push(`${at}: duplicate id`);
    seen.add(q.id);
    if (!npcIds.has(q.npc)) errors.push(`${at}: unknown npc "${q.npc}"`);
    for (const p of q.prereq) {
      if (p === q.id) errors.push(`${at}: cannot require itself`);
      else if (!questIds.has(p)) errors.push(`${at}: unknown prerequisite "${p}"`);
    }
    if (q.availableFrom !== undefined && q.availableUntil !== undefined && q.availableFrom >= q.availableUntil) errors.push(`${at}: availability end must follow start`);
    if (q.kind === 'daily' && q.prereq.some((p) => c.quests.find((o) => o.id === p)?.kind === 'daily')) errors.push(`${at}: a daily quest cannot require another daily quest`);
    q.objectives.forEach((o, i) => {
      if ((o.type === 'visit' || o.type === 'retrieve') && o.location && !c.baseLife?.locations?.some((l) => l.id === o.location)) errors.push(`${at} step ${i + 1}: missing location ${o.location}`);
      if (['plant', 'harvest', 'collect', 'cook'].includes(o.type) && 'target' in o && !ITEMS[o.target]) errors.push(`${at} step ${i + 1}: unknown target item ${o.target}`);
      if ((o.type === 'retrieve' || o.type === 'deliver') && !ITEMS[o.item]) errors.push(`${at} step ${i + 1}: unknown item "${o.item}"`);
    });
    for (const r of q.rewards.items) if (!ITEMS[r.item]) errors.push(`${at}: unknown reward item "${r.item}"`);
    if (q.rewards.coins === 0 && q.rewards.items.length === 0) errors.push(`${at}: has no reward`);
  }
  for (const npc of ['farmer', 'chef', 'colonel']) {
    const pool = c.quests.filter((q) => q.npc === npc);
    if (pool.length !== 10 || pool.filter((q) => q.kind === 'daily').length !== 3 || pool.filter((q) => q.kind === 'long').length !== 7) errors.push(`npc ${npc}: requires exactly 10 quests, 3 daily and 7 long-term`);
    if (pool.filter((q) => q.objectives.some((o) => o.type === 'visit' || o.type === 'retrieve' || o.type === 'kill')).length < 5) errors.push(`npc ${npc}: requires at least 5 external missions`);
  }
  // Prerequisite cycles make quests unreachable.
  const byId = new Map(c.quests.map((q) => [q.id, q]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const cyclic = (qid: string): boolean => {
    if (done.has(qid)) return false;
    if (visiting.has(qid)) return true;
    visiting.add(qid);
    const bad = (byId.get(qid)?.prereq ?? []).some(cyclic);
    visiting.delete(qid);
    done.add(qid);
    return bad;
  };
  for (const q of c.quests) if (cyclic(q.id)) errors.push(`quest ${q.id}: prerequisite cycle`);
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, content: c };
}

/** Human text for an objective (the HUD tracker and the dialogue panel). */
export function objectiveText(o: QuestObjective): string {
  const name = (item: string) => ITEMS[item]?.name ?? item;
  const PLACE: Record<string, string> = { house_small: 'nhà nhỏ', house_large: 'nhà lớn', ruined_camp: 'trại bỏ hoang', factory: 'công xưởng', power_plant: 'nhà máy điện', town: 'thị trấn' };
  const place = (s: string) => PLACE[s] ?? s.replace('_', ' ');
  const VERB = { plant: 'Trồng', harvest: 'Thu hoạch', collect: 'Thu thập', cook: 'Nấu', interact: 'Dùng' } as const;
  switch (o.type) {
    case 'plant': case 'harvest': case 'collect': case 'cook': case 'interact':
      return `${VERB[o.type]} ${o.count} × ${name(o.target)}`;
    case 'kill':
      return `Hạ ${o.count} xác sống`;
    case 'visit':
      return `Tới ${place(o.structure)} gần nhất`;
    case 'retrieve':
      return `Tìm ${o.count > 1 ? `${o.count} × ` : ''}${name(o.item)} ở ${place(o.structure)} gần nhất`;
    case 'deliver':
      return `Mang ${o.count} × ${name(o.item)} về`;
  }
}

/* ------------------------------------------------------------------------- default content */

type Q = Omit<QuestDef, 'enabled' | 'prereq'> & { prereq?: string[] };
const q = (d: Q): QuestDef => ({ enabled: true, prereq: [], ...d });
const say = (offer: string, accept: string, progress: string, complete: string) => ({ offer, accept, progress, complete });

/** The three base NPCs and their ten quests each (3 daily + 7 long-term, at least 5 away from base). */
export const DEFAULT_CONTENT: GameContent = {
  version: 1,
  baseLife: DEFAULT_BASE_LIFE,
  dailyResetHourUtc: 0,
  npcs: [
    {
      id: 'farmer', name: 'Bác Ba Nông Dân', model: '/models/npcs/farmer.bbmodel', weapon: 0, x: -31, z: -14,
      interactRange: 3.5, greetRange: 8,
      greetings: ['Chào cháu! Đất vườn hôm nay ẩm lắm.', 'Ồ, có người tới thăm vườn rồi.', 'Cẩn thận dẫm vào luống khoai của bác nhé!'],
      ambient: ['Khoai năm nay chắc được mùa…', 'Phải có nước tưới mới được.', 'Lũ zombie lại phá hàng rào rồi.'],
      ambientPublic: false, cooldownMs: 25_000, bubbleMs: 5000,
    },
    {
      id: 'chef', name: 'Trung sĩ Bếp Tư', model: '/models/npcs/military-chef-npc.bbmodel', weapon: 0, x: -20, z: 30,
      interactRange: 3.5, greetRange: 8,
      greetings: ['Đói không? Bếp còn nóng đây.', 'Người ta đánh nhau bằng cái bụng đấy, nhớ chưa!', 'Vào đây, có việc cho cậu.'],
      ambient: ['Thịt hết rồi, khổ thật.', 'Thêm chút muối nữa là ngon.', 'Ai lấy cái nồi của tôi?'],
      ambientPublic: false, cooldownMs: 25_000, bubbleMs: 5000,
    },
    {
      id: 'colonel', name: 'Đại tá Lâm', model: '/models/npcs/special-forces-soldier.bbmodel', weapon: 13, patrolRadius: 4, x: 0, z: 44.5, combat: { enabled: true, range: 40, fireIntervalMs: 4000 },
      interactRange: 4, greetRange: 10,
      greetings: ['Đứng nghiêm! … Đùa thôi. Có nhiệm vụ đây.', 'Cổng trại do tôi giữ. Cậu đi đâu?', 'Người sống sót à? Tốt, ta cần người.'],
      ambient: ['Giữ vững vị trí!', 'Bên ngoài hàng rào là địa ngục.', 'Ai có tin từ nhà máy điện không?'],
      ambientPublic: false, cooldownMs: 30_000, bubbleMs: 5000,
    },
  ],
  quests: [
    // ---------------------------------------------------------------- farmer
    q({ id: 'farm_d_potatoes', npc: 'farmer', kind: 'daily', title: 'Khoai cho bữa trưa', description: 'Bác Ba cần 6 củ khoai tây để nấu cho cả trại.',
      objectives: [{ type: 'deliver', item: 'potato', count: 6 }], rewards: { coins: 60, items: [] },
      dialogue: say('Cháu kiếm giúp bác 6 củ khoai nhé?', 'Tốt lắm, bác đợi.', 'Khoai đâu rồi cháu?', 'Cảm ơn cháu, cả trại có bữa no rồi!') }),
    q({ id: 'farm_d_pests', npc: 'farmer', kind: 'daily', title: 'Dọn sâu bệnh', description: 'Lũ xác sống quanh trại làm hỏng mùa màng. Hạ 10 con.',
      objectives: [{ type: 'kill', target: 'zombie', count: 10 }], rewards: { coins: 80, items: [{ item: 'potato', count: 4 }] },
      dialogue: say('Bọn chúng giẫm nát vườn của bác. Cháu xử lý giúp?', 'Cẩn thận nhé!', 'Còn nhiều lắm cháu ạ.', 'Vườn yên ổn rồi. Cầm ít khoai đi.') }),
    q({ id: 'farm_d_scout', npc: 'farmer', kind: 'daily', title: 'Tìm hạt giống', description: 'Ghé căn nhà nhỏ bỏ hoang gần nhất xem còn hạt giống không.',
      objectives: [{ type: 'visit', structure: 'house_small' }], rewards: { coins: 70, items: [] },
      dialogue: say('Mấy căn nhà quanh đây có khi còn hạt giống.', 'Đi sớm về sớm nhé.', 'Đã tới nơi chưa cháu?', 'Ừ, để mai bác thử gieo.') }),
    q({ id: 'farm_l_coal', npc: 'farmer', kind: 'long', title: 'Than sưởi kho', description: 'Kho khoai cần giữ ấm. Tìm một thùng than ở công xưởng bỏ hoang.',
      objectives: [{ type: 'retrieve', item: 'coal_carton', structure: 'factory', count: 1 }, { type: 'deliver', item: 'coal_carton', count: 1 }], rewards: { coins: 200, items: [] },
      dialogue: say('Kho lạnh quá, khoai sẽ hỏng. Công xưởng cũ chắc còn than.', 'Bác đánh dấu chỗ rồi đấy.', 'Thùng than đâu cháu?', 'Ấm áp rồi! Cháu giỏi lắm.') }),
    q({ id: 'farm_l_camp', npc: 'farmer', kind: 'long', title: 'Người thân thất lạc', description: 'Con gái bác từng ở một trại tị nạn. Hãy tới trại bỏ hoang gần nhất.',
      objectives: [{ type: 'visit', structure: 'ruined_camp' }], rewards: { coins: 250, items: [{ item: 'medkit', count: 1 }] },
      dialogue: say('Bác có đứa con gái… ở trại tị nạn phía xa.', 'Cảm ơn cháu.', 'Có tin gì không cháu?', 'Không có ai sao… Dù sao cũng cảm ơn cháu.') }),
    q({ id: 'farm_l_pork', npc: 'farmer', kind: 'long', title: 'Thịt cho mùa đông', description: 'Mang về 4 miếng thịt heo rừng sống.',
      objectives: [{ type: 'deliver', item: 'raw_porkchop', count: 4 }], rewards: { coins: 220, items: [] },
      dialogue: say('Mùa đông tới rồi, cần dự trữ thịt.', 'Heo rừng hung lắm, coi chừng.', 'Chưa đủ thịt đâu.', 'Đủ cho cả tháng rồi!') }),
    q({ id: 'farm_l_cell', npc: 'farmer', kind: 'long', title: 'Máy bơm tưới', description: 'Máy bơm nước cần pin năng lượng từ nhà máy điện bỏ hoang.',
      prereq: ['farm_l_coal'],
      objectives: [{ type: 'retrieve', item: 'nuclear_cell', structure: 'power_plant', count: 1 }, { type: 'deliver', item: 'nuclear_cell', count: 1 }], rewards: { coins: 400, items: [] },
      dialogue: say('Có pin là bác chạy được máy bơm tưới cả vườn.', 'Nhà máy điện nguy hiểm, cẩn thận.', 'Pin đâu rồi cháu?', 'Nước chảy rồi! Vườn sống lại rồi!') }),
    q({ id: 'farm_l_town', npc: 'farmer', kind: 'long', title: 'Chợ phiên cũ', description: 'Tới thị trấn bỏ hoang gần nhất tìm dụng cụ làm vườn.',
      objectives: [{ type: 'visit', structure: 'town' }], rewards: { coins: 300, items: [] },
      dialogue: say('Ngày xưa có chợ phiên ở thị trấn, chắc còn cuốc xẻng.', 'Đi cẩn thận.', 'Tới thị trấn chưa?', 'Tốt, lần sau bác đi cùng.') }),
    q({ id: 'farm_l_purge', npc: 'farmer', kind: 'long', title: 'Bảo vệ cánh đồng', description: 'Hạ 40 xác sống để cánh đồng được yên.',
      objectives: [{ type: 'kill', target: 'zombie', count: 40 }], rewards: { coins: 450, items: [{ item: 'ammo_762', count: 2 }] },
      dialogue: say('Bọn chúng kéo tới ngày càng đông.', 'Bác tin cháu.', 'Vẫn còn nhiều lắm.', 'Cánh đồng an toàn rồi. Cầm ít đạn này.') }),
    q({ id: 'farm_l_feast', npc: 'farmer', kind: 'long', title: 'Bữa tiệc mùa gặt', description: 'Mang tới 10 củ khoai nướng cho tiệc mùa gặt.',
      prereq: ['farm_l_cell'],
      objectives: [{ type: 'deliver', item: 'potato_cooked', count: 10 }], rewards: { coins: 600, items: [] },
      dialogue: say('Mùa gặt xong rồi, mở tiệc thôi!', 'Nướng cho thơm nhé.', 'Chưa đủ khoai nướng.', 'Tuyệt vời! Cả trại sẽ nhớ cháu.') }),

    // ---------------------------------------------------------------- chef
    q({ id: 'chef_d_mutton', npc: 'chef', kind: 'daily', title: 'Thịt cừu cho bếp', description: 'Bếp cần 3 miếng thịt cừu sống.',
      objectives: [{ type: 'deliver', item: 'raw_mutton', count: 3 }], rewards: { coins: 70, items: [] },
      dialogue: say('Hết thịt cừu rồi. Cậu kiếm giúp 3 miếng?', 'Nhanh lên, nồi đang sôi.', 'Thịt đâu?', 'Tốt! Tối nay có súp.') }),
    q({ id: 'chef_d_potato', npc: 'chef', kind: 'daily', title: 'Khoai cho nồi súp', description: 'Mang 4 củ khoai tây tới bếp.',
      objectives: [{ type: 'deliver', item: 'potato', count: 4 }], rewards: { coins: 50, items: [{ item: 'potato_cooked', count: 1 }] },
      dialogue: say('Súp mà không có khoai thì còn gì!', 'Chờ cậu.', 'Khoai đâu?', 'Đây, phần của cậu một củ nướng.') }),
    q({ id: 'chef_d_guard', npc: 'chef', kind: 'daily', title: 'Giữ an toàn cho bếp', description: 'Hạ 8 xác sống đang lảng vảng.',
      objectives: [{ type: 'kill', target: 'zombie', count: 8 }], rewards: { coins: 60, items: [] },
      dialogue: say('Mùi thức ăn kéo bọn chúng tới.', 'Đi đi, tôi giữ bếp.', 'Còn tiếng rên ngoài kia.', 'Yên rồi. Ăn gì không?') }),
    q({ id: 'chef_l_spice', npc: 'chef', kind: 'long', title: 'Gia vị thất lạc', description: 'Thị trấn bỏ hoang có thể còn gia vị. Hãy tới đó.',
      objectives: [{ type: 'visit', structure: 'town' }], rewards: { coins: 250, items: [] },
      dialogue: say('Không có gia vị, món nào cũng nhạt.', 'Tìm kỹ trong các căn nhà.', 'Tìm được chưa?', 'Hay lắm! Món ăn sẽ ngon hơn.') }),
    q({ id: 'chef_l_fuel', npc: 'chef', kind: 'long', title: 'Nhiên liệu cho bếp', description: 'Bếp cần than. Tìm 2 thùng than ở công xưởng bỏ hoang.',
      objectives: [{ type: 'retrieve', item: 'coal_carton', structure: 'factory', count: 2 }, { type: 'deliver', item: 'coal_carton', count: 2 }], rewards: { coins: 320, items: [] },
      dialogue: say('Củi ướt hết rồi, phải có than.', 'Hai thùng là đủ dùng cả tuần.', 'Than đâu?', 'Lửa cháy rồi!') }),
    q({ id: 'chef_l_pork', npc: 'chef', kind: 'long', title: 'Sườn nướng', description: 'Mang tới 3 miếng sườn heo đã nướng.',
      objectives: [{ type: 'deliver', item: 'cooked_porkchop', count: 3 }], rewards: { coins: 260, items: [] },
      dialogue: say('Lính tráng thèm sườn nướng lắm rồi.', 'Nướng vàng đều nhé.', 'Chưa có sườn à?', 'Thơm quá!') }),
    q({ id: 'chef_l_house', npc: 'chef', kind: 'long', title: 'Dụng cụ bếp', description: 'Tìm tới căn nhà lớn bỏ hoang gần nhất, có thể còn nồi niêu.',
      objectives: [{ type: 'visit', structure: 'house_large' }], rewards: { coins: 220, items: [] },
      dialogue: say('Nồi của tôi thủng rồi.', 'Nhà lớn thường có bếp to.', 'Thấy gì chưa?', 'Tốt, để tôi sửa lại.') }),
    q({ id: 'chef_l_mutton', npc: 'chef', kind: 'long', title: 'Tiệc thịt cừu', description: 'Mang tới 5 miếng thịt cừu đã nấu.',
      prereq: ['chef_l_fuel'],
      objectives: [{ type: 'deliver', item: 'cooked_mutton', count: 5 }], rewards: { coins: 400, items: [{ item: 'medkit', count: 1 }] },
      dialogue: say('Đại tá muốn đãi tiệc. Cần thịt cừu nấu sẵn.', 'Nhanh tay lên.', 'Chưa đủ.', 'Tiệc thành công!') }),
    q({ id: 'chef_l_hunt', npc: 'chef', kind: 'long', title: 'Dẹp đường đi chợ', description: 'Hạ 25 xác sống để đường đi lấy hàng an toàn.',
      objectives: [{ type: 'kill', target: 'zombie', count: 25 }], rewards: { coins: 300, items: [] },
      dialogue: say('Đường đi lấy hàng đầy xác sống.', 'Đi đi.', 'Vẫn chưa an toàn.', 'Giờ đi lại dễ rồi.') }),
    q({ id: 'chef_l_camp', npc: 'chef', kind: 'long', title: 'Kho lương bỏ hoang', description: 'Một trại bỏ hoang có thể còn kho lương. Hãy tới đó.',
      prereq: ['chef_l_spice'],
      objectives: [{ type: 'visit', structure: 'ruined_camp' }], rewards: { coins: 350, items: [] },
      dialogue: say('Nghe nói trại tị nạn cũ còn kho lương.', 'Mang tin về cho tôi.', 'Sao rồi?', 'Ít nhất ta biết chỗ đó.') }),

    // ---------------------------------------------------------------- colonel
    q({ id: 'col_d_patrol', npc: 'colonel', kind: 'daily', title: 'Tuần tra vòng ngoài', description: 'Hạ 15 xác sống quanh trại.',
      objectives: [{ type: 'kill', target: 'zombie', count: 15 }], rewards: { coins: 100, items: [{ item: 'ammo_762', count: 1 }] },
      dialogue: say('Tuần tra vòng ngoài. 15 mục tiêu.', 'Rõ. Đi đi.', 'Báo cáo tiến độ!', 'Làm tốt lắm, lính.') }),
    q({ id: 'col_d_factory', npc: 'colonel', kind: 'daily', title: 'Trinh sát công xưởng', description: 'Trinh sát công xưởng bỏ hoang gần nhất.',
      objectives: [{ type: 'visit', structure: 'factory' }], rewards: { coins: 90, items: [] },
      dialogue: say('Có động tĩnh ở công xưởng. Trinh sát đi.', 'Giữ liên lạc.', 'Đã tới chưa?', 'Ghi nhận.') }),
    q({ id: 'col_d_camp', npc: 'colonel', kind: 'daily', title: 'Kiểm tra trại cũ', description: 'Kiểm tra trại bỏ hoang gần nhất.',
      objectives: [{ type: 'visit', structure: 'ruined_camp' }], rewards: { coins: 90, items: [] },
      dialogue: say('Kiểm tra trại cũ, có thể còn người sống.', 'Đi.', 'Báo cáo!', 'Hiểu rồi.') }),
    q({ id: 'col_l_cell', npc: 'colonel', kind: 'long', title: 'Nguồn năng lượng', description: 'Thu hồi một pin năng lượng tại nhà máy điện bỏ hoang.',
      objectives: [{ type: 'retrieve', item: 'nuclear_cell', structure: 'power_plant', count: 1 }, { type: 'deliver', item: 'nuclear_cell', count: 1 }], rewards: { coins: 500, items: [{ item: 'ammo_40mm', count: 1 }] },
      dialogue: say('Đèn trại cần năng lượng. Nhà máy điện có pin.', 'Rõ, xuất phát.', 'Pin đâu?', 'Xuất sắc. Đây là đạn phóng lựu.') }),
    q({ id: 'col_l_plant', npc: 'colonel', kind: 'long', title: 'Đánh giá nhà máy điện', description: 'Tới nhà máy điện bỏ hoang gần nhất.',
      objectives: [{ type: 'visit', structure: 'power_plant' }], rewards: { coins: 300, items: [] },
      dialogue: say('Ta cần biết tình trạng nhà máy điện.', 'Đi đi.', 'Đã tới chưa?', 'Tốt.') }),
    q({ id: 'col_l_purge', npc: 'colonel', kind: 'long', title: 'Chiến dịch càn quét', description: 'Hạ 60 xác sống.',
      prereq: ['col_l_plant'],
      objectives: [{ type: 'kill', target: 'zombie', count: 60 }], rewards: { coins: 700, items: [{ item: 'grenade', count: 2 }] },
      dialogue: say('Mở chiến dịch càn quét. 60 mục tiêu.', 'Rõ!', 'Chưa xong!', 'Huân chương cho cậu. Cầm lựu đạn.') }),
    q({ id: 'col_l_town', npc: 'colonel', kind: 'long', title: 'Giải phóng thị trấn', description: 'Trinh sát thị trấn bỏ hoang gần nhất.',
      objectives: [{ type: 'visit', structure: 'town' }], rewards: { coins: 350, items: [] },
      dialogue: say('Thị trấn có thể làm tiền đồn mới.', 'Xuất phát.', 'Báo cáo!', 'Ghi nhận.') }),
    q({ id: 'col_l_cells', npc: 'colonel', kind: 'long', title: 'Máy phát điện dự phòng', description: 'Thu hồi 2 pin năng lượng từ công xưởng bỏ hoang.',
      prereq: ['col_l_cell'],
      objectives: [{ type: 'retrieve', item: 'nuclear_cell', structure: 'factory', count: 2 }, { type: 'deliver', item: 'nuclear_cell', count: 2 }], rewards: { coins: 800, items: [] },
      dialogue: say('Cần thêm 2 pin cho máy phát dự phòng.', 'Rõ.', 'Pin đâu?', 'Trại có điện rồi!') }),
    q({ id: 'col_l_house', npc: 'colonel', kind: 'long', title: 'Điểm quan sát', description: 'Tới căn nhà lớn bỏ hoang gần nhất để lập điểm quan sát.',
      objectives: [{ type: 'visit', structure: 'house_large' }], rewards: { coins: 250, items: [] },
      dialogue: say('Ta cần một điểm quan sát.', 'Đi.', 'Đã tới chưa?', 'Tốt.') }),
    q({ id: 'col_l_supply', npc: 'colonel', kind: 'long', title: 'Tiếp tế lựu đạn', description: 'Nộp 3 quả lựu đạn cho kho vũ khí.',
      objectives: [{ type: 'deliver', item: 'grenade', count: 3 }], rewards: { coins: 260, items: [] },
      dialogue: say('Kho vũ khí thiếu lựu đạn.', 'Mang tới đây.', 'Chưa đủ.', 'Kho đã đầy.') }),
  ],
};
