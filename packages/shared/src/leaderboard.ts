import type { RankTitle } from './ranks';

export interface LeaderboardView {
  individuals: Array<{ position: number; name: string; rank: RankTitle }>;
  teams: Array<{ position: number; name: string; members: number }>;
}
