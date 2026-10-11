import type { ZombieVariant } from './zombies';
import { z } from 'zod';
import { ITEMS } from './items';

export const RANKS = [
  { id: 'recruit', name: 'Tân Binh', english: 'Recruit', model: '/models/materias/tanbinh-badge.bbmodel', icon: 'Ⅰ', color: '#b8b2a2' },
  { id: 'private', name: 'Binh Nhì', english: 'Private', model: '/models/materias/binhnhi-badge.bbmodel', icon: 'Ⅱ', color: '#72b48c' },
  { id: 'corporal', name: 'Hạ Sĩ', english: 'Corporal', model: '/models/materias/corporal-badge.bbmodel', icon: 'Ⅲ', color: '#69a7dc' },
  { id: 'sergeant', name: 'Trung Sĩ', english: 'Sergeant', model: '/models/materias/sergeant-badge.bbmodel', icon: 'Ⅳ', color: '#bd8ce5' },
  { id: 'elite', name: 'Tinh Nhuệ', english: 'Elite', model: '/models/materias/elite-badge.bbmodel', icon: 'Ⅴ', color: '#ffb000' },
] as const;
export const ROMAN_STARS = ['I', 'II', 'III', 'IV', 'V'] as const;
export interface RankTitle { step: number; tier: number; stars: number; title: string }
/** No score, threshold or progress fraction is sent to a player. */
export function rankTitle(step: number): RankTitle {
  step = Math.max(0, Math.min(24, Math.trunc(step)));
  const tier = Math.floor(step / 5), stars = step % 5 + 1;
  return { step, tier, stars, title: `${RANKS[tier]!.name} ${ROMAN_STARS[stars - 1]}` };
}

export const requisitionRewardSchema = z.object({
  kind: z.enum(['coins', 'item', 'weapon_skin', 'outfit', 'appearance', 'character']),
  id: z.string().regex(/^[a-z0-9_]{1,60}$/),
  name: z.string().min(1).max(80),
  mode: z.enum(['survival', 'global', 'future']),
  quantity: z.number().int().min(1).max(100_000),
}).strict().superRefine((r, ctx) => {
  if (r.kind === 'item' && !ITEMS[r.id]) ctx.addIssue({ code: 'custom', message: 'Unknown inventory item' });
  if (r.kind === 'coins' && (r.id !== 'zcoin' || r.mode !== 'survival')) ctx.addIssue({ code: 'custom', message: 'ZCoin belongs to Survival' });
  if (r.kind === 'item' && r.mode !== 'survival') ctx.addIssue({ code: 'custom', message: 'Inventory items currently belong to Survival' });
});
export type RequisitionReward = z.infer<typeof requisitionRewardSchema>;
export const rankConfigSchema = z.object({
  thresholds: z.array(z.number().int().min(0).max(10_000_000)).length(25),
  dailyPoints: z.number().int().min(1).max(2000),
  longPoints: z.number().int().min(1).max(5000),
  externalBonus: z.number().int().min(0).max(2000),
  teamPoints: z.number().int().min(1).max(5000),
  deathBase: z.number().int().min(0).max(5000),
  deathPerStep: z.number().int().min(0).max(500),
  rewards: z.array(z.array(requisitionRewardSchema).max(12)).length(25),
}).strict().superRefine((c, ctx) => {
  if (c.thresholds[0] !== 0 || c.thresholds.some((n, i) => i > 0 && n <= c.thresholds[i - 1]!)) ctx.addIssue({ code: 'custom', path: ['thresholds'], message: 'Start at zero and strictly increase all 25 thresholds' });
});
export type RankConfig = z.infer<typeof rankConfigSchema>;
export const DEFAULT_RANK_CONFIG: RankConfig = {
  thresholds: [0, 120, 280, 480, 720, 1000, 1350, 1750, 2200, 2700, 3300, 4000, 4800, 5700, 6700, 8000, 9500, 11200, 13100, 15200, 18000, 21200, 24800, 28800, 33400],
  dailyPoints: 35, longPoints: 90, externalBonus: 30, teamPoints: 100,
  deathBase: 40, deathPerStep: 8,
  rewards: Array.from({ length: 25 }, (_, step): RequisitionReward[] => {
    if (step === 0) return [];
    const tier = Math.floor(step / 5);
    const result: RequisitionReward[] = [{ kind: 'coins', id: 'zcoin', name: 'ZCoin', mode: 'survival', quantity: 150 + tier * 250 + step % 5 * 50 }];
    const item = (id: string, quantity = 1): RequisitionReward => ({ kind: 'item', id, name: ITEMS[id]!.name, mode: 'survival', quantity });
    result.push(item(['ammo_9mm', 'ammo_762', 'ammo_556', 'ammo_762x54', 'ammo_300wm'][tier]!, 1 + tier));
    if (step % 5 === 0) result.push(item(['gl18', 'ak47', 'm4a1', 'svd', 'awm'][tier]!));
    if (step % 5 === 4) result.push(item(['medkit', 'medkit', 'medkit', 'grenade', 'grenade'][tier]!, 2 + tier));
    const armor = Object.values(ITEMS).filter((i) => i.armor);
    if (step % 5 === 2 && armor.length) result.push(item(armor[Math.min(armor.length - 1, tier * 4)]!.id));
    return result;
  }),
};
export function rankStep(score: number, config: RankConfig): number {
  let step = 0;
  for (let i = 1; i < 25 && score >= config.thresholds[i]!; i++) step = i;
  return step;
}
export interface RequisitionEntry extends RequisitionReward { key: string; source: string; receivedAt: string }
export interface CareerView {
  rank: RankTitle;
  milestones: Array<{ rank: RankTitle; awarded: boolean; rewards: RequisitionReward[] }>;
  armory: RequisitionEntry[];
  pendingSurvival: number;
}
export interface RankUpdate { t: 'rank'; rank: RankTitle; promoted?: boolean; introduction?: string }

export interface SuspendedZombie { x: number; y: number; z: number; health: number; limbs: number; variant: ZombieVariant }
