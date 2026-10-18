/** Reserved high uint32 ids for permanent, friendly camp guards. */
export const NPC_ID_BASE = 0xf0000000;
export const GUARD_MODEL_URL = '/models/npcs/armored-soldier.bbmodel';

/** Vietnamese names for gate and patrol guards, indexed by `id - NPC_ID_BASE`. */
export const GUARD_NAMES = ['Trung sĩ Hùng', 'Hạ sĩ Dũng', 'Binh nhất Tuấn', 'Binh nhì Nam', 'Thượng sĩ Bảo', 'Hạ sĩ Minh', 'Binh nhất Hải'] as const;

export function guardName(id: number): string {
  return GUARD_NAMES[(id - NPC_ID_BASE) % GUARD_NAMES.length] ?? 'Lính canh';
}

export const MERCHANT_MODEL_URL = '/models/npcs/weapon-merchant-npc.bbmodel';
/** The camp's weapon merchant (one per world), right after the guard id range. */
export const MERCHANT_ID = NPC_ID_BASE + 0x100;
export const MERCHANT_NAME = 'Lão Tám · Thương nhân vũ khí';

export const NURSE_MODEL_URL = '/models/npcs/curvy-nurse.bbmodel';
/** The camp's field medic: heals for ZCoin and sells first aid kits. */
export const NURSE_ID = NPC_ID_BASE + 0x101;
export const NURSE_NAME = 'Y tá Hoa · Quân y';

export const ARCHITECT_MODEL_URL = '/models/npcs/scrap-dealer-npc.bbmodel';
/** The camp's architect: trades blueprints for building materials. */
export const ARCHITECT_ID = NPC_ID_BASE + 0x102;
export const ARCHITECT_NAME = 'Kỹ sư Tư · Bản vẽ công trình';
