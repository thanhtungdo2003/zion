import { ARMOR_BY_ITEM } from './armor';
import { DEFAULT_CONTENT, type GameContent } from './content';
import { ITEMS } from './items';
import { GUARD_MODEL_URL, GUARD_NAMES, MERCHANT_MODEL_URL, MERCHANT_NAME, NURSE_MODEL_URL, NURSE_NAME } from './npcs';
import { WEAPON_BY_ITEM, WEAPON_SPECS, type WeaponId } from './weapons';
import { zombieMaxHealth, type ZombieVariant } from './zombies';

export const HANDBOOK_CATEGORIES = {
  monsters: { label: 'Quái vật', icon: 'lucide:skull', intro: 'Biết kẻ địch trước khi bước ra khỏi cổng.' },
  weapons: { label: 'Vũ khí', icon: 'lucide:crosshair', intro: 'Chọn hỏa lực phù hợp với khoảng cách và tình huống.' },
  equipment: { label: 'Trang bị', icon: 'lucide:backpack', intro: 'Một chuyến đi an toàn bắt đầu từ chiếc ba lô.' },
  modes: { label: 'Chế độ', icon: 'lucide:compass', intro: 'Tìm hiểu luật chơi và hành trình sinh tồn.' },
  npcs: { label: 'NPC', icon: 'lucide:users', intro: 'Những người giữ ngọn đèn cuối cùng của ZION.' },
} as const;
export type HandbookCategory = keyof typeof HANDBOOK_CATEGORIES;
export interface HandbookEntry {
  id: string; category: HandbookCategory; title: string; subtitle: string;
  description: string; tips: string[]; stats: Array<{ label: string; value: string }>;
  model: { item: string } | { url: string };
  itemId?: string;
}
const RARITY: Record<string, string> = { common: 'Thường', uncommon: 'Khá', rare: 'Hiếm', epic: 'Sử thi', legendary: 'Huyền thoại' };
const ITEM_CATEGORY: Record<string, string> = { rifle: 'Súng trường', shotgun: 'Súng săn', pistol: 'Súng lục', smg: 'Tiểu liên', heavy: 'Hạng nặng', grenade: 'Lựu đạn', melee: 'Cận chiến', ammo: 'Đạn dược', medical: 'Y tế', food: 'Thức ăn', resource: 'Tài nguyên', tool: 'Công cụ', armor_head: 'Mũ giáp', armor_chest: 'Áo giáp', armor_face: 'Mặt nạ', armor_ears: 'Tai nghe', armor_legs: 'Quần', armor_feet: 'Ủng', backpack: 'Ba lô' };

/** Public reference data uses actual balance tables and the active Studio NPC configuration. */
export function buildHandbook(content: GameContent = DEFAULT_CONTENT): HandbookEntry[] {
  const entries: HandbookEntry[] = [
    { id: 'rotting', title: 'Xác sống mục rữa', subtitle: 'Mối đe dọa thường gặp', description: 'Lang thang ngoài khu trú ẩn và truy đuổi khi phát hiện người sống. Đừng để tiếng súng kéo cả đám tới gần.', tips: ['Giữ khoảng cách, quan sát xung quanh trước khi nổ súng.', 'Chân bị gãy khiến xác sống phải bò, nhưng chúng vẫn nguy hiểm.'], file: 'hunched-rotting-zombie', variant: 0 },
    { id: 'gaunt', title: 'Xác sống gầy guộc', subtitle: 'Bóng dáng nơi hoang phế', description: 'Một biến thể xác sống với thân hình gầy gò. Có thể xuất hiện cùng những nhóm xác sống khác ngoài căn cứ.', tips: ['Tránh bị bao vây khi lục soát công trình.', 'Ngắm vào đầu và luôn giữ đường rút lui.'], file: 'gaunt-zombie', variant: 1 },
    { id: 'brute', title: 'Xác sống khổng lồ', subtitle: 'Sức chịu đựng vượt trội', description: 'To lớn, nhiều máu và trở nên hung hãn khi bị thương nặng. Đòn bắn vào đầu không thể hạ nó ngay như những biến thể khác.', tips: ['Chuẩn bị đủ đạn trước khi giao chiến.', 'Giữ khoảng cách; đừng để bị dồn vào góc.'], file: 'brute-zombie', variant: 2 },
    { id: 'crimson', title: 'Xác sống mắt đỏ', subtitle: 'Kẻ săn đêm', description: 'Chạy nhanh hơn vào ban đêm hoặc khi nổi giận. Có thể nhảy vồ mục tiêu từ xa.', tips: ['Chú ý động tác chuẩn bị nhảy và lộn tránh kịp thời.', 'Giữ thể lực dự phòng khi di chuyển ban đêm.'], file: 'crimson-eyed-zombie', variant: 3 },
  ].map(m => ({ id: `monster.${m.id}`, category: 'monsters', title: m.title, subtitle: m.subtitle, description: m.description, tips: m.tips, stats: [{ label: 'Máu tối đa', value: String(zombieMaxHealth(m.variant as ZombieVariant)) }], model: { url: `/models/mobs/${m.file}.bbmodel` } }));

  for (const item of Object.values(ITEMS)) {
    const weaponId = WEAPON_BY_ITEM[item.id];
    const spec = weaponId ? WEAPON_SPECS[weaponId as Exclude<WeaponId, 0>] : undefined;
    const armor = ARMOR_BY_ITEM.get(item.id);
    const stats: HandbookEntry['stats'] = [{ label: 'Ô túi đồ', value: `${item.w} × ${item.h}` }];
    const tips: string[] = [];
    if (spec) {
      stats.push({ label: 'Trọng lượng khi cầm', value: `${spec.weight} kg` });
      tips.push('Vũ khí đang cầm làm giảm tốc độ và tăng hao thể lực; cất vũ khí nặng khi cần chạy nhanh.');
      if (spec.kind === 'melee' && spec.decapitationChance) stats.push({ label: 'Chặt đầu zombie chết ngay', value: `${Math.round(spec.decapitationChance * 100)}% mỗi đòn trúng` });
      stats.push({ label: 'Sát thương', value: spec.kind === 'gun' && spec.pellets > 1 ? `${spec.damage} × ${spec.pellets}` : String(spec.damage) });
      if (spec.kind === 'gun') {
        stats.push({ label: 'Tầm bắn', value: `${spec.range} m` }, { label: 'Băng đạn', value: `${spec.magazine} viên` }, { label: 'Nạp đạn', value: `${spec.reloadMs / 1000} giây` }, { label: 'Tốc độ bắn', value: `${Math.round(60_000 / spec.fireMs)} phát/phút` }, { label: 'Chế độ bắn', value: spec.auto ? 'Tự động' : 'Từng phát' });
        const ammo = Object.values(ITEMS).find(a => a.ammo?.guns.includes(item.id));
        if (ammo) stats.push({ label: 'Đạn sử dụng', value: ammo.name });
        tips.push('Nhấn R để nạp đạn. Kiểm tra đạn dự trữ trước khi rời căn cứ.');
        if (spec.scope) tips.push(`Nhấn chuột phải để dùng ống ngắm ${spec.scope}×.`);
        if (spec.projectile?.blast) tips.push('Đạn nổ gây sát thương theo vùng. Giữ khoảng cách an toàn.');
      } else if (spec.kind === 'melee') {
        stats.push({ label: 'Tầm đánh', value: `${spec.range} m` }, { label: 'Nhịp đánh', value: `${Math.round(60_000 / spec.cooldownMs)} lần/phút` });
        tips.push('Đòn cận chiến tiêu hao thể lực. Chừa sức để rút lui.');
      } else {
        stats.push({ label: 'Bán kính nổ', value: `${spec.radius} m` }, { label: 'Kíp nổ', value: spec.remote ? 'Điều khiển từ xa' : `${spec.fuseMs / 1000} giây` }, { label: 'Tầm ném', value: `${spec.maxRange} m` });
        if (spec.remote) tips.push('Đặt vào ô lựu đạn. Chuột phải ném C4; bom bám địa hình và mob, không bám người chơi. Cầm đúng bộ kích nổ rồi nhấn chuột trái để kích nổ.');
        tips.push('Ném ra xa vị trí của bạn và đồng đội.');
      }
    } else if (armor) {
      stats.push({ label: 'Độ hiếm', value: RARITY[armor.rarity]! }, { label: 'Giảm sát thương', value: `${Math.round(armor.protection * 100)}%` }, { label: 'Độ bền', value: String(armor.durability) }, { label: 'Trọng lượng', value: `${armor.weight} kg` });
      tips.push('Giáp hết độ bền sẽ mất tác dụng bảo vệ.', 'Giáp nặng ảnh hưởng tốc độ di chuyển.');
    } else if (item.ammo) {
      stats.push({ label: 'Số viên', value: String(item.ammo.capacity) }, { label: 'Dùng cho', value: item.ammo.guns.map(id => ITEMS[id]?.name ?? id).join(', ') });
      tips.push('Mang loại đạn tương thích với vũ khí đang dùng.');
    } else if (item.category === 'food') {
      tips.push('Nhấn chuột phải vào thức ăn trong túi đồ để ăn.', 'Nấu đồ sống ở lửa trại để bổ sung nhiều năng lượng hơn.');
    } else if (item.id === 'medkit') tips.push('Nhấn H để băng bó. Di chuyển hoặc nhận sát thương sẽ ngắt quá trình.');
    else if (item.id === 'flashlight') tips.push('Trang bị ở ô Tay phụ. Đèn tự bật trong bóng tối.');
    else if (item.id === 'military_backpack') tips.push('Đeo vào ô Ba lô: mở thêm ngăn chứa 8×4 và một chỗ súng trường. Vứt ba lô thì đồ bên trong đi theo.');
    else tips.push('Kiểm tra nhiệm vụ trước khi bán tài nguyên cho thương nhân.');
    const customModel = content.baseLife?.itemModels?.[item.id];
    entries.push({ id: `item.${item.id}`, itemId: item.id, category: spec ? 'weapons' : 'equipment', title: item.name, subtitle: ITEM_CATEGORY[item.category] ?? 'Trang bị', description: '', tips, stats, model: customModel ? { url: customModel } : { item: item.id } });
  }

  entries.push({ id: 'mode.survival', category: 'modes', title: 'Sinh tồn', subtitle: 'Thế giới nhiều người chơi', description: 'Bắt đầu với một người sống sót giữa thế giới hậu tận thế. Tìm về căn cứ, nhận nhiệm vụ, kiếm ZCoin và chuẩn bị cho những chuyến thám hiểm ngoài vùng an toàn.', tips: ['Nhấn E để tương tác, nhặt đồ hoặc mở túi đồ.', 'Nhấn M để xem bản đồ và đánh dấu những nơi cần quay lại.', 'Tạo đội ở sảnh để phối hợp chiến đấu, cấp cứu và làm nhiệm vụ chung.', 'Trồng trọt, săn thú và nấu ăn để duy trì thể lực.'], stats: [{ label: 'Quy mô đội', value: 'Tối đa 5 người' }, { label: 'Thế giới', value: 'Ngày / đêm' }, { label: 'Tiến trình', value: 'Được lưu lại' }], model: { url: '/models/characters/teen-wasteland-survivor.bbmodel' } });
  const npcs = [
    { id: 'merchant', name: MERCHANT_NAME, model: MERCHANT_MODEL_URL, role: 'Thương nhân', description: 'Mua vũ khí, đạn dược và trang bị bằng ZCoin; bán những món đồ nhặt được để chuẩn bị cho chuyến đi tiếp theo.' },
    { id: 'nurse', name: NURSE_NAME, model: NURSE_MODEL_URL, role: 'Quân y', description: 'Chữa trị và bán hộp cứu thương. Ghé quân y trước khi ra ngoài nếu bạn đang bị thương.' },
    ...GUARD_NAMES.map((name, i) => ({ id: `guard.${i}`, name, model: GUARD_MODEL_URL, role: 'Lính gác', description: 'Bảo vệ khu trú ẩn và chống lại xác sống quanh cổng căn cứ.' })),
    ...content.npcs.map(n => ({ id: n.id, name: n.name, model: n.model, role: 'Người giao nhiệm vụ', description: n.greetings[0] ?? 'Một người sống sót tại căn cứ. Lại gần và nhấn E để nói chuyện.' })),
  ];
  for (const n of npcs) {
    const quests = content.quests.filter(q => q.enabled && q.npc === n.id);
    entries.push({ id: `npc.${n.id}`, category: 'npcs', title: n.name, subtitle: n.role, description: n.description, tips: ['Lại gần và nhấn E để tương tác.', 'Không tấn công người trong căn cứ.'], stats: [{ label: 'Vai trò', value: n.role }, ...(quests.length ? [{ label: 'Nhiệm vụ', value: String(quests.length) }] : [])], model: { url: n.model } });
  }
  return entries;
}
