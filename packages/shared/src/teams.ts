import type { RankTitle } from './ranks';
import type { QuestStateMessage } from './protocol/server';

export const TEAM_LIMIT = 5;
/** Battle royale squads: up to three players. */
export const SQUAD_LIMIT = 3;
export interface TeamMember { accountId: string; name: string; ready: boolean }
export interface TeamChatLine { id: string; from: string; text: string; at: number; rank?: RankTitle }
export interface TeamQuestRun {
  id: string; cycle: number; stage: number; progress: number;
  participants: string[]; claimed: string[];
  target: { x: number; z: number; radius: number };
  drops: Array<{ x: number; z: number }>;
}
export interface TeamRecord {
  id: string; code: string; name: string; leaderId: string; public: boolean;
  members: TeamMember[]; quests: Record<string, TeamQuestRun>; chat: TeamChatLine[];
  launchId: string | null; launchedAt: number;
}
export interface TeamView extends TeamRecord {
  members: Array<TeamMember & { online: boolean; inGame: boolean; entityId?: number; x?: number; y?: number; z?: number; health?: number; downed?: boolean; yaw?: number; rank?: RankTitle }>;
}
export interface TeamLobby { team: TeamView | null; available: Array<{ id: string; name: string; count: number; leader: string }> }
export type TeamAction =
  | { op: 'create'; name: string; public: boolean }
  | { op: 'join'; code: string }
  | { op: 'joinPublic'; id: string }
  | { op: 'leave' }
  | { op: 'ready'; ready: boolean }
  | { op: 'kick' | 'promote'; accountId: string }
  | { op: 'settings'; name: string; public: boolean }
  | { op: 'launch' }
  | { op: 'chat'; text: string };
export interface TeamStateMessage { t: 'teamState'; team: TeamView | null; quests: QuestStateMessage['entries'] }

export const TEAM_QUESTS = [
  { id: 'team_factory_daily', npc: 'colonel', kind: 'daily', title: 'Mũi nhọn: thu hồi năng lượng', structure: 'factory', item: 'nuclear_cell', count: 6, kills: 35, coins: 900,
    offer: 'Đội của các cậu nhận một nhà máy ngẫu nhiên. Tập kết ít nhất hai người, tìm đủ lõi năng lượng rồi dọn sạch khu vực. Đừng để ai đi một mình.' },
  { id: 'team_campaign', npc: 'colonel', kind: 'long', title: 'Chiến dịch: khởi động lại bình minh', structure: 'power_plant', item: 'nuclear_cell', count: 12, kills: 80, coins: 2800,
    offer: 'Ta cần một đội dám đi xa hơn mọi lần. Thu hồi mười hai lõi tại nhà máy điện, hạ tám mươi xác sống quanh đó rồi mang tin về. Đây là nhiệm vụ dài hạn của cả đội.' },
  { id: 'team_supplies_daily', npc: 'chef', kind: 'daily', title: 'Đường tiếp tế: đoàn người trở về', structure: 'ruined_camp', item: 'coal_carton', count: 8, kills: 25, coins: 750,
    offer: 'Bếp không thể nuôi cả căn cứ bằng lời hứa. Cùng đội ra khu trại được đánh dấu, thu hồi tám kiện tiếp tế và mở đường an toàn về đây.' },
  { id: 'team_supply_long', npc: 'chef', kind: 'long', title: 'Kho dự trữ cho mùa đông', structure: 'town', item: 'coal_carton', count: 16, kills: 60, coins: 2200,
    offer: 'Mùa đông sẽ không chờ chúng ta. Đưa cả đội đến thị trấn đã chỉ định, thu gom mười sáu kiện và đẩy lùi đám xác sống để giữ tuyến vận chuyển.' },
  { id: 'team_farmer_daily', npc: 'farmer', kind: 'daily', title: 'Tìm lại nguồn sống', structure: 'house_large', item: 'coal_carton', count: 6, kills: 25, coins: 700,
    offer: 'Bác đánh dấu một khu nhà ngẫu nhiên có vật tư canh tác. Hai người giữ nhau, cả đội gom đủ sáu kiện và dọn đường rồi quay về báo bác.' },
  { id: 'team_farmer_long', npc: 'farmer', kind: 'long', title: 'Tái thiết vùng đất chết', structure: 'ruined_camp', item: 'coal_carton', count: 14, kills: 70, coins: 2400,
    offer: 'Đội của các cháu có thể giúp bác dựng lại một vùng đất. Hãy thu hồi mười bốn kiện thiết bị ở trại bỏ hoang được chỉ định, dọn sạch khu vực và đưa mọi người về.' },
] as const;
