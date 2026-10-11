import type { QuestDef } from './content';

const missions = [
  ['medical', 'Thuốc men thất lạc', 'medkit', 'house_small', 2, 180],
  ['rations', 'Khẩu phần tiền tuyến', 'cooked_mutton', 'house_large', 3, 210],
  ['radio', 'Tín hiệu từ trại cũ', 'flashlight', 'ruined_camp', 2, 240],
  ['fuel', 'Nhiên liệu dự phòng', 'fuel_tank', 'factory', 3, 270],
  ['rifle_ammo', 'Tuyến tiếp đạn 7.62', 'ammo_762', 'town', 4, 300],
  ['power', 'Lõi điện giữa hoang tàn', 'nuclear_cell', 'power_plant', 2, 340],
  ['arsenal', 'Kho súng bị bỏ lại', 'ak47', 'ruined_camp', 2, 370],
  ['sniper', 'Hòm đạn của trinh sát', 'ammo_300wm', 'house_large', 4, 410],
  ['explosives', 'Thu hồi đạn phóng lựu', 'ammo_40mm', 'factory', 4, 450],
  ['blackout', 'Chiến dịch ánh sáng cuối', 'nuclear_cell', 'power_plant', 5, 500],
] as const;
/** A private assignment across the whole map, never selected by distance to the player. */
export const COLONEL_SEARCH_QUESTS: QuestDef[] = missions.map(([key, title, item, structure, count, rankPoints], i) => ({
  id: `col_search_${key}`, npc: 'colonel', title, kind: 'long', enabled: true, allowCancel: true,
  description: 'Đại tá chỉ định một công trình ngẫu nhiên bên ngoài căn cứ. Tìm đủ vật tư tại khu vực được đánh dấu và mang về giao tận tay.',
  prereq: i > 1 ? [`col_search_${missions[i - 2]![0]}`] : [],
  rankPoints,
  objectives: [{ type: 'retrieve', item, structure, count }, { type: 'deliver', item, count }],
  rewards: { coins: 200 + i * 100, items: [{ item: i < 5 ? 'medkit' : 'ammo_556', count: 1 + Math.floor(i / 4) }] },
  dialogue: {
    offer: `Nhiệm vụ ${title.toLowerCase()}. Ta đã chỉ định địa điểm trên bản đồ. Chỉ vật tư tìm được cho nhiệm vụ này mới được tính.`,
    accept: 'Điểm đến có thể ở rất xa. Chuẩn bị lương thực, đạn và đường rút trước khi xuất phát.',
    progress: 'Mang đủ vật tư đã đánh dấu về đây. Đừng đánh đổi mạng sống vì một chuyến đi vội.',
    complete: 'Nhiệm vụ hoàn thành. Thành tích này đã được ghi vào hồ sơ quân vụ của cậu.',
  },
}));
