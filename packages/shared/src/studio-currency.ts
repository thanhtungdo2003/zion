import { z } from 'zod';

export const STUDIO_MAX_COIN_GRANT = 1_000_000;
export const studioCurrencyGrantSchema = z.object({
  requestId: z.string().uuid(),
  accountId: z.string().uuid(),
  amount: z.number().int().min(1).max(STUDIO_MAX_COIN_GRANT),
  reason: z.string().trim().max(200).default(''),
}).strict();
export type StudioCurrencyGrant = z.infer<typeof studioCurrencyGrantSchema>;
export interface StudioCurrencyPlayer { id: string; username: string; coins: number; pendingCoins: number; online: boolean }
export interface StudioCurrencyResult { requestId: string; delivered: boolean }
