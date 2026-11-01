import { ZOMBIE_COIN_DROP_CHANCE, ZOMBIE_COIN_DROP_MIN, ZOMBIE_COIN_DROP_MAX, type TutorialId } from '@zion/shared';
import type { HudState } from './hud-store';
import type { InventoryState } from './inventory/inventory';

export interface GuideStep { title: string; text: string; focus?: string }
export interface DiscoveryLesson { id: TutorialId; steps: GuideStep[]; context: 'pvp' | 'npc' | 'inventory' | 'map' | 'plot' | 'world' }

/** Ordered by currently open UI, so a combat tip never interrupts a panel's own explanation. */
export function discoveryLesson(hud: HudState, inv: InventoryState, seen: ReadonlySet<TutorialId>): DiscoveryLesson | null {
  const candidates: DiscoveryLesson[] = [];
  if (hud.dialogue && !inv.open) {
    const npc = hud.dialogue.npc;
    const id = (`npc_${npc}` === 'npc_farmer' || `npc_${npc}` === 'npc_chef' || `npc_${npc}` === 'npc_colonel' ? `npc_${npc}` : 'npc_other') as TutorialId;
    const profile = npc === 'farmer' ? 'Lương thực · nguyên liệu · trồng khoai.' : npc === 'chef' ? 'Thực phẩm · đổi thức ăn · nấu chín hồi nhiều hơn.' : npc === 'colonel' ? 'Tuần tra · chiến đấu · mang đạn, giáp, thuốc.' : 'Mỗi NPC có việc và phần thưởng riêng.';
    candidates.push({ id, context: 'npc', steps: [
      { title: hud.dialogue.name, text: profile, focus: '.q-head' },
      { title: 'Nhiệm vụ', text: 'Cá nhân · Đội nhóm (khó hơn, tiến độ chung) · hằng ngày · dài hạn.', focus: '[data-guide="npc-quests"]' },
      { title: 'Nhận · trả', text: 'Nhận · hủy · nhận thưởng. Nhiệm vụ khóa cần xong việc trước.', focus: '[data-guide="quest-actions"]' },
      ...(hud.life?.config.trades.some((t) => t.npc === npc) ? [{ title: 'Mua bán', text: 'Mua: trừ Coin · Bán: đổi đồ lấy Coin · có hạn mức.', focus: '[data-guide="npc-trade"]' }] : []),
    ] });
  }
  if (inv.open) {
    if (inv.station === 'chest' && inv.chest?.field) candidates.push({ id: 'chest', context: 'inventory', steps: [
      { title: 'Hòm chiến lợi phẩm', text: 'Hòm dùng chung: lấy và cất đồ. Coi chừng xung quanh.', focus: '.shared-chest' },
      { title: 'Search', text: 'Search · chờ · Lấy. Hòm làm mới mỗi ngày trong game.', focus: '.chest-search button' },
      { title: 'Kiếm Coin', text: 'Lục hòm → bán cho thương nhân = Coin. Giá ZC cạnh mỗi món.', focus: '.chest-items' },
    ] });
    if (inv.station === 'shop') candidates.push({ id: 'merchant', context: 'inventory', steps: [
      { title: 'Thương nhân vũ khí', text: 'Súng · đạn · giáp. Xem đúng loại đạn.', focus: '.shop-modes button:first-child' },
      { title: 'Bán chiến lợi phẩm', text: 'Bán đồ lấy Coin. Đồ miễn phí, đồ nhiệm vụ: không bán được.', focus: '.shop-modes button:last-child' },
    ] });
    if (inv.station === 'nurse') candidates.push({ id: 'nurse', context: 'inventory', steps: [
      { title: 'Trạm y tế', text: 'Chữa trị · vật tư y tế. H: dùng kit cứu thương.', focus: '.nurse-cross' },
      { title: 'Chữa trị và tiếp tế', text: 'Chữa trị hoặc mua thuốc trước khi đi.', focus: '.inv-shop .shop-btn' },
    ] });
    if (inv.station === 'stash') candidates.push({ id: 'stash', context: 'inventory', steps: [
      { title: 'Kho riêng của bạn', text: 'Kho riêng, nhiều trang, chỉ ở căn cứ.', focus: '.inv-stash' },
    ] });
  }
  if (hud.mapOpen) candidates.push({ id: 'map', context: 'map', steps: [
    { title: 'Bản đồ', text: 'Kéo · cuộn/chụm để zoom. Đi tới đâu mở bản đồ tới đó (ô 50 × 50 m).', focus: '.atlas-viewport' },
    { title: 'Ghim', text: 'Nhấn để ghim · bật chỉ đường. Dấu xanh: đồng đội.', focus: '.atlas-sidebar' },
  ] });
  if (hud.plot) candidates.push({ id: 'plant', context: 'plot', steps: [
    { title: 'Trồng lương thực', text: 'Cần khoai sống · đứng yên · chín thì E thu hoạch.', focus: '.plant-panel' },
  ] });
  if (hud.life?.action?.kind === 'cook') candidates.push({ id: 'cooking', context: 'world', steps: [
    { title: 'Nấu thức ăn', text: 'E cạnh bếp · đứng yên. Đồ chín hồi nhiều hơn.', focus: '.q-action' },
  ] });
  if (hud.pvpRemaining > 0 && !inv.open && !hud.dialogue && !hud.mapOpen) candidates.push({ id: 'pvp', context: 'pvp', steps: [
    { title: 'Đồ sát', text: 'Bật để gây sát thương người chơi khác đội (tên chuyển đỏ). Tự tắt sau 60 giây không đánh.', focus: '[data-guide="pvp"]' },
  ] });
  if (hud.tutorial?.firstZombie) candidates.push({ id: 'zombie', context: 'world', steps: [
    { title: 'Zombie đầu tiên', text: `Zombie đầu tiên chắc chắn rơi Coin; sau đó ${Math.round(ZOMBIE_COIN_DROP_CHANCE * 100)}% · ${ZOMBIE_COIN_DROP_MIN}–${ZOMBIE_COIN_DROP_MAX} Coin.`, focus: '.hud-coins' },
  ] });
  return candidates.find((lesson) => !seen.has(lesson.id)) ?? null;
}

export function lessonContextOpen(lesson: DiscoveryLesson, hud: HudState, inv: InventoryState): boolean {
  return (lesson.context === 'pvp' && hud.pvpRemaining > 0) || lesson.context === 'world' || (lesson.context === 'npc' && !!hud.dialogue && !inv.open)
    || (lesson.context === 'inventory' && inv.open) || (lesson.context === 'map' && hud.mapOpen)
    || (lesson.context === 'plot' && !!hud.plot);
}
