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
    const profile = npc === 'farmer' ? 'Bác nông dân giao việc về lương thực, mua bán nguyên liệu và giúp bạn bắt đầu trồng khoai.' : npc === 'chef' ? 'Đầu bếp giao nhiệm vụ về thực phẩm và trao đổi thức ăn. Mang nguyên liệu về, nấu chín để hồi phục tốt hơn.' : npc === 'colonel' ? 'Đại tá giao những chuyến tuần tra và nhiệm vụ chiến đấu. Chuẩn bị đạn, giáp và thuốc trước khi nhận việc xa căn cứ.' : 'Mỗi người trong căn cứ có công việc và phần thưởng riêng. Hãy đọc lời thoại để biết họ đang cần gì.';
    candidates.push({ id, context: 'npc', steps: [
      { title: hud.dialogue.name, text: profile, focus: '.q-head' },
      { title: 'Nhiệm vụ và đội nhóm', text: 'Nút Nhiệm vụ mở công việc cá nhân; tab Đội nhóm có nhiệm vụ khó hơn và tiến độ chung. Có nhiệm vụ hằng ngày và nhiệm vụ dài hạn. Chọn nhiệm vụ, đọc mục tiêu và phần thưởng rồi nhấn Nhận nhiệm vụ; xong việc thì quay lại nhận thưởng.', focus: '[data-guide="npc-quests"]' },
      { title: 'Nhận việc, trả nhiệm vụ', text: 'Các nút ở đây dùng để nhận, hủy hoặc nhận thưởng nhiệm vụ đang chọn. Theo dõi mục tiêu ở góc màn hình sau khi nhận. Nhiệm vụ bị khóa cần hoàn thành công việc trước đó.', focus: '[data-guide="quest-actions"]' },
      ...(hud.life?.config.trades.some((t) => t.npc === npc) ? [{ title: 'Mua bán với NPC', text: 'Nút Mua bán ở hàng tab mở danh sách hàng hóa. Nút Mua trừ Coin, nút Bán đổi vật phẩm bạn mang theo lấy Coin. Chú ý giá, số lượng đang có và hạn mức giao dịch của từng món.', focus: '[data-guide="npc-trade"]' }] : []),
    ] });
  }
  if (inv.open) {
    if (inv.station === 'chest' && inv.chest?.field) candidates.push({ id: 'chest', context: 'inventory', steps: [
      { title: 'Hòm chiến lợi phẩm', text: 'Bạn vừa tìm thấy hòm ngoài căn cứ! Hòm dùng chung cho mọi người, có thể chứa vật phẩm và cho phép cất đồ. Hãy quan sát xung quanh trước khi lục soát.', focus: '.shared-chest' },
      { title: 'Nhấn Search để tìm đồ', text: 'Nhấn Search và chờ lục soát xong. Vật phẩm sẽ được nhận diện lần lượt; nhấn Lấy để chuyển đồ vào túi. Mỗi ngày trong game trôi qua, các hòm ngoài căn cứ được làm mới và có thể Search lại.', focus: '.chest-search button' },
      { title: 'Nguồn kiếm tiền chính', text: 'Săn tìm vật phẩm trong hòm rồi mang về bán cho thương nhân là cách kiếm Coin chính. Giá ZC cạnh vật phẩm giúp bạn chọn đồ đáng mang theo. Nhớ chừa chỗ trong ba lô; đồ cấp miễn phí và đồ nhiệm vụ không bán được.', focus: '.chest-items' },
    ] });
    if (inv.station === 'shop') candidates.push({ id: 'merchant', context: 'inventory', steps: [
      { title: 'Thương nhân vũ khí', text: 'Đây là nơi mua súng, đạn và giáp. Chọn loại hàng, kiểm tra giá và loại đạn phù hợp trước khi mua.', focus: '.shop-modes button:first-child' },
      { title: 'Bán chiến lợi phẩm', text: 'Chuyển sang Bán để đổi đồ trong túi lấy Coin. Lục hòm bên ngoài rồi mang đồ về đây bán là nguồn thu nhập chính. Trang bị cấp miễn phí và vật phẩm nhiệm vụ không thể bán.', focus: '.shop-modes button:last-child' },
    ] });
    if (inv.station === 'nurse') candidates.push({ id: 'nurse', context: 'inventory', steps: [
      { title: 'Trạm y tế', text: 'Y tá có thể chữa trị và bán vật tư y tế. Nút chữa trị ghi giá Coin; kiểm tra ví trước khi dùng. Mang kit cứu thương khi rời căn cứ và nhấn H để tự chữa ngoài đường.', focus: '.nurse-cross' },
      { title: 'Chữa trị và tiếp tế', text: 'Các nút bên phải dùng để chữa trị hoặc mua vật tư. Chuẩn bị thuốc trước chuyến đi để tránh phải quay về khi máu thấp.', focus: '.inv-shop .shop-btn' },
    ] });
    if (inv.station === 'stash') candidates.push({ id: 'stash', context: 'inventory', steps: [
      { title: 'Kho riêng của bạn', text: 'Kho cá nhân có nhiều trang, chỉ mở tại căn cứ và chỉ bạn dùng được. Chuyển đồ giữa túi và kho để cất đồ quý, dọn ba lô trước khi đi tìm hòm.', focus: '.inv-stash' },
    ] });
  }
  if (hud.mapOpen) candidates.push({ id: 'map', context: 'map', steps: [
    { title: 'Bản đồ khám phá', text: 'Kéo để xem và cuộn hoặc chụm hai ngón để zoom. Bạn biết sẵn vùng bán kính 1 km quanh căn cứ; mỗi bước đi sẽ khám phá thêm một ô 50 × 50 m. Các cấu trúc căn cứ cũng có trên bản đồ.', focus: '.atlas-viewport' },
    { title: 'Đánh dấu chuyến đi', text: 'Nhấn vùng đã khám phá để đặt ghim, chọn biểu tượng và tên. Sổ tay lưu các vị trí; bật chỉ đường cho nơi muốn đến. Dấu xanh là đồng đội.', focus: '.atlas-sidebar' },
  ] });
  if (hud.plot) candidates.push({ id: 'plant', context: 'plot', steps: [
    { title: 'Trồng lương thực', text: 'Chọn khoai trong bảng để trồng, bạn cần có khoai sống trong túi. Đứng yên cho thanh tiến trình hoàn tất; khi cây chín, nhấn E để thu hoạch. Di chuyển hoặc rời game giữa chừng sẽ hủy thao tác.', focus: '.plant-panel' },
  ] });
  if (hud.life?.action?.kind === 'cook') candidates.push({ id: 'cooking', context: 'world', steps: [
    { title: 'Nấu thức ăn', text: 'Đứng cạnh bếp và nhấn E để nấu nguyên liệu đang mang theo. Chờ thanh tiến trình hoàn tất; di chuyển sẽ hủy. Đồ chín bổ sung năng lượng tốt hơn đồ sống.', focus: '.q-action' },
  ] });
  if (hud.pvpRemaining > 0 && !inv.open && !hud.dialogue && !hud.mapOpen) candidates.push({ id: 'pvp', context: 'pvp', steps: [
    { title: 'Đồ sát — hãy cân nhắc!', text: 'Tân binh, nút cạnh bản đồ nhỏ vừa xuất hiện vì cậu đã tấn công người chơi khác. Mặc định đòn đánh không gây sát thương. Bật đồ sát để gây sát thương cho người chơi khác đội; đồng đội luôn được bảo vệ. Tên cậu sẽ chuyển đỏ khi bật. Nút tồn tại 60 giây kể từ đòn đánh gần nhất, hết giờ sẽ tự tắt đồ sát.', focus: '[data-guide="pvp"]' },
  ] });
  if (hud.tutorial?.firstZombie) candidates.push({ id: 'zombie', context: 'world', steps: [
    { title: 'Zombie đầu tiên!', text: `Zombie đầu tiên bạn hạ được bảo đảm rơi Coin. Những zombie tiếp theo có ${Math.round(ZOMBIE_COIN_DROP_CHANCE * 100)}% cơ hội rơi, mỗi lần ${ZOMBIE_COIN_DROP_MIN}–${ZOMBIE_COIN_DROP_MAX} Coin. Lại gần đồng Coin trên đất để nhặt. Đây là thu nhập phụ; lục hòm và bán vật phẩm vẫn là nguồn kiếm tiền chính.`, focus: '.hud-coins' },
  ] });
  return candidates.find((lesson) => !seen.has(lesson.id)) ?? null;
}

export function lessonContextOpen(lesson: DiscoveryLesson, hud: HudState, inv: InventoryState): boolean {
  return (lesson.context === 'pvp' && hud.pvpRemaining > 0) || lesson.context === 'world' || (lesson.context === 'npc' && !!hud.dialogue && !inv.open)
    || (lesson.context === 'inventory' && inv.open) || (lesson.context === 'map' && hud.mapOpen)
    || (lesson.context === 'plot' && !!hud.plot);
}
