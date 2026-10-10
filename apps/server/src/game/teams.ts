import { randomBytes, randomUUID } from 'node:crypto';
import { TEAM_LIMIT, TEAM_QUESTS, type TeamAction, type TeamLobby, type TeamRecord, type TeamView, type TeamQuestRun, type QuestStateMessage } from '@zion/shared';
import type { PlayerStateRecord } from '../repositories/player-states';

export class TeamError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export interface TeamPresence { entityId: number; x: number; y: number; z: number; health: number; downed: boolean }
type Persistence = (id: string, team: TeamRecord | null, player?: PlayerStateRecord) => Promise<void>;
export const teamCycle = (now: number) => Math.floor(now / 86_400_000);

/** One serialized authority for lobby membership, shared objectives and atomic reward claims. */
export class TeamService {
  private readonly teams = new Map<string, TeamRecord>();
  private readonly membership = new Map<string, string>();
  private readonly seen = new Map<string, number>();
  private readonly positions = new Map<string, TeamPresence>();
  private writing: Promise<unknown> = Promise.resolve();

  constructor(records: TeamRecord[], private readonly persist: Persistence) {
    for (const record of records) {
      const team = structuredClone(record);
      team.members.forEach((m) => { m.ready = false; this.membership.set(m.accountId, team.id); });
      team.launchId = null; team.launchedAt = 0;
      this.teams.set(team.id, team);
    }
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writing.then(fn);
    this.writing = next.catch(() => undefined);
    return next;
  }

  forAccount(accountId: string): TeamRecord | undefined { return this.teams.get(this.membership.get(accountId) ?? ''); }
  allied(a: string, b: string): boolean { return a !== b && !!this.membership.get(a) && this.membership.get(a) === this.membership.get(b); }
  heartbeat(accountId: string): void { this.seen.set(accountId, Date.now()); }
  position(accountId: string, position: TeamPresence | null): void {
    if (position) { this.positions.set(accountId, position); this.heartbeat(accountId); }
    else this.positions.delete(accountId);
  }
  view(accountId: string): TeamView | null {
    const t = this.forAccount(accountId);
    if (!t) return null;
    return { ...structuredClone(t), members: t.members.map((m) => ({ ...m, online: Date.now() - (this.seen.get(m.accountId) ?? 0) < 15_000, inGame: this.positions.has(m.accountId), ...this.positions.get(m.accountId) })) };
  }
  lobby(accountId: string): TeamLobby {
    this.heartbeat(accountId);
    return { team: this.view(accountId), available: [...this.teams.values()].filter((t) => t.public && t.members.length < TEAM_LIMIT && t.members.some((m) => Date.now() - (this.seen.get(m.accountId) ?? 0) < 15_000)).slice(0, 50).map((t) => ({ id: t.id, name: t.name, count: t.members.length, leader: t.members.find((m) => m.accountId === t.leaderId)?.name ?? '' })) };
  }

  private async save(team: TeamRecord, player?: PlayerStateRecord): Promise<void> {
    await this.persist(team.id, team.members.length ? team : null, player);
    const old = this.teams.get(team.id);
    old?.members.forEach((m) => this.membership.delete(m.accountId));
    if (team.members.length) {
      this.teams.set(team.id, team);
      team.members.forEach((m) => this.membership.set(m.accountId, team.id));
    } else this.teams.delete(team.id);
  }

  action(accountId: string, name: string, action: TeamAction): Promise<TeamLobby> {
    return this.serial(async () => {
      const current = this.forAccount(accountId);
      if (action.op === 'create') {
        if (current) throw new TeamError(409, 'Bạn đang ở trong một đội.');
        let code: string;
        do { code = randomBytes(4).toString('hex').toUpperCase(); } while ([...this.teams.values()].some((t) => t.code === code));
        await this.save({ id: randomUUID(), code, name: action.name, leaderId: accountId, public: action.public, members: [{ accountId, name, ready: false }], quests: {}, chat: [], launchId: null, launchedAt: 0 });
      } else if (action.op === 'join' || action.op === 'joinPublic') {
        if (current) throw new TeamError(409, 'Hãy rời đội hiện tại trước khi tham gia đội khác.');
        const existing = action.op === 'join' ? [...this.teams.values()].find((t) => t.code === action.code.toUpperCase()) : this.teams.get(action.id);
        if (!existing || (action.op === 'joinPublic' && !existing.public)) throw new TeamError(404, 'Không tìm thấy đội.');
        if (existing.members.length >= TEAM_LIMIT) throw new TeamError(409, 'Đội đã đủ 5 người.');
        const team = structuredClone(existing);
        team.members.push({ accountId, name, ready: false });
        team.members.forEach((m) => { m.ready = false; });
        team.launchId = null;
        await this.save(team);
      } else {
        if (!current) throw new TeamError(404, 'Bạn chưa tham gia đội.');
        const team = structuredClone(current);
        const member = team.members.find((m) => m.accountId === accountId)!;
        const leader = team.leaderId === accountId;
        if (['kick', 'promote', 'settings', 'launch'].includes(action.op) && !leader) throw new TeamError(403, 'Chỉ đội trưởng có thể thực hiện thao tác này.');
        if (action.op === 'leave' || action.op === 'kick') {
          const target = action.op === 'leave' ? accountId : action.accountId;
          if (action.op === 'kick' && target === accountId) throw new TeamError(400, 'Dùng nút rời đội để rời đội.');
          if (!team.members.some((m) => m.accountId === target)) throw new TeamError(404, 'Thành viên không còn trong đội.');
          team.members = team.members.filter((m) => m.accountId !== target);
          if (team.leaderId === target) team.leaderId = team.members[0]?.accountId ?? '';
          team.members.forEach((m) => { m.ready = false; }); team.launchId = null;
        } else if (action.op === 'promote') {
          if (!team.members.some((m) => m.accountId === action.accountId)) throw new TeamError(404, 'Thành viên không còn trong đội.');
          team.leaderId = action.accountId;
        } else if (action.op === 'settings') { team.name = action.name; team.public = action.public; }
        else if (action.op === 'ready') member.ready = action.ready;
        else if (action.op === 'launch') {
          if (team.members.some((m) => !m.ready || (Date.now() - (this.seen.get(m.accountId) ?? 0) > 15_000 && !this.positions.has(m.accountId)))) throw new TeamError(409, 'Mọi thành viên cần trực tuyến và sẵn sàng.');
          team.launchId = randomUUID(); team.launchedAt = Date.now();
          team.members.forEach((m) => { m.ready = false; });
        } else if (action.op === 'chat') {
          const last = team.chat.filter((m) => m.from === member.name).at(-1);
          if (last && Date.now() - last.at < 700) throw new TeamError(429, 'Hãy chờ một chút trước khi gửi tiếp.');
          team.chat.push({ id: randomUUID(), from: member.name, text: action.text, at: Date.now() });
          team.chat = team.chat.slice(-40);
        }
        await this.save(team);
      }
      return this.lobby(accountId);
    });
  }

  questViews(accountId: string, now = Date.now()): QuestStateMessage['entries'] {
    const team = this.forAccount(accountId);
    if (!team) return [];
    return TEAM_QUESTS.map((def) => {
      const saved = team.quests[def.id];
      const r = saved && (def.kind === 'long' || saved.cycle === teamCycle(now)) ? saved : undefined;
      const participant = !r || r.participants.includes(accountId);
      const stage = r?.stage ?? 0;
      const objectives = ['Tập kết ít nhất 2 thành viên tại công trình được đánh dấu', `Tìm ${def.count} kiện vật phẩm nhiệm vụ chung (không chiếm túi)`, `Hạ ${def.kills} zombie trong khu vực mục tiêu`, 'Cùng trở về NPC; mỗi người nhận phần thưởng riêng'];
      return { team: true, id: def.id, npc: def.npc, title: def.title, description: `${def.offer} Phần thưởng: ${def.coins} ZCoin cho mỗi thành viên tham gia từ lúc nhận. Vị trí chọn ngẫu nhiên, giữ nguyên đến khi hoàn thành.`, kind: def.kind,
        dialogue: { offer: def.offer, accept: 'Cả đội đã nhận lệnh. Giữ liên lạc, tập kết và bảo vệ nhau!', progress: 'Ta cần kết quả của cả đội. Xem mục tiêu chung và đưa đồng đội trở về.', complete: 'Một đội tốt luôn trở về cùng nhau. Mỗi người hãy nhận phần thưởng xứng đáng.' },
        rewards: { coins: def.coins, items: [] }, allowCancel: team.leaderId === accountId && !!r && stage < 3, locked: !participant || (!r && (team.members.length < 2 || team.leaderId !== accountId)), stage: Math.min(3, stage), stages: 4,
        goal: stage === 0 ? 2 : stage === 1 ? def.count : stage === 2 ? def.kills : 1,
        objective: !participant ? 'Bạn tham gia sau khi nhận nhiệm vụ; hãy chờ nhiệm vụ tiếp theo.' : objectives[Math.min(stage, 3)]!,
        status: r?.claimed.includes(accountId) ? 'claimed' : stage >= 3 && r ? 'ready' : r ? 'active' : 'available', progress: r?.progress ?? 0,
        ...(r && participant && stage < 3 ? { target: r.target } : {}), ...(r && participant && stage === 1 ? { drops: r.drops, retrievalItem: def.item, retrievalModel: def.item === 'nuclear_cell' ? '/models/materias/nuclear-power-cell.bbmodel' : '/models/materias/coal-in-old-carton.bbmodel' } : {}) };
    });
  }

  quest(accountId: string, id: string, op: 'accept' | 'cancel' | 'retrieve' | 'turnin', opts: { target?: TeamQuestRunTarget; index?: number; x: number; z: number; reward?: () => PlayerStateRecord }): Promise<boolean> {
    return this.serial(async () => {
      const current = this.forAccount(accountId), def = TEAM_QUESTS.find((q) => q.id === id);
      if (!current || !def) throw new TeamError(404, 'Không tìm thấy nhiệm vụ đội.');
      const team = structuredClone(current), now = Date.now();
      let run: TeamQuestRun | undefined = team.quests[id];
      if (def.kind === 'daily' && run?.cycle !== teamCycle(now)) { delete team.quests[id]; run = undefined; }
      let reward: PlayerStateRecord | undefined;
      if (op === 'accept') {
        if (team.leaderId !== accountId) throw new TeamError(403, 'Đội trưởng nhận nhiệm vụ cho cả đội.');
        if (run || team.members.length < 2) throw new TeamError(409, 'Nhiệm vụ đã nhận hoặc đội chưa đủ 2 người.');
        if (!opts.target) throw new TeamError(404, 'Không có công trình phù hợp trong thế giới này.');
        const target = opts.target;
        const drops = Array.from({ length: def.count }, (_, i) => {
          const angle = i / def.count * Math.PI * 2;
          return { x: target.x + Math.cos(angle) * (target.radius + 4), z: target.z + Math.sin(angle) * (target.radius + 4) };
        });
        team.quests[id] = { id: randomUUID(), cycle: teamCycle(now), participants: team.members.map((m) => m.accountId), claimed: [], stage: 0, progress: 0, target: { ...target, radius: target.radius + 22 }, drops };
      } else if (op === 'cancel') {
        if (team.leaderId !== accountId || !run || run.stage >= 3) throw new TeamError(403, 'Chỉ đội trưởng có thể hủy nhiệm vụ đang thực hiện.');
        delete team.quests[id];
      } else {
        if (!run || !run.participants.includes(accountId)) throw new TeamError(403, 'Bạn không thuộc danh sách tham gia nhiệm vụ này.');
        if (op === 'retrieve') {
          const drop = run.drops[opts.index ?? -1];
          if (run.stage !== 1 || !drop || Math.hypot(opts.x - drop.x, opts.z - drop.z) > 3) return false;
          run.drops.splice(opts.index!, 1); run.progress++;
          if (run.progress >= def.count) { run.stage = 2; run.progress = 0; }
        } else {
          if (run.stage < 3 || run.claimed.includes(accountId) || !opts.reward) return false;
          reward = opts.reward();
          if (!Number.isSafeInteger((reward.coins ?? 0) + def.coins) || (reward.coins ?? 0) + def.coins > 2_147_483_647) throw new TeamError(409, 'Ví đã đạt giới hạn.');
          reward.coins = (reward.coins ?? 0) + def.coins;
          run.claimed.push(accountId); run.stage = 4;
        }
      }
      await this.save(team, reward);
      return true;
    });
  }

  progress(accountId: string, killedZombie?: { x: number; z: number }): Promise<void> {
    return this.serial(async () => {
      const current = this.forAccount(accountId);
      if (!current) return;
      const team = structuredClone(current); let changed = false;
      for (const def of TEAM_QUESTS) {
        const r = team.quests[def.id];
        if (!r || !r.participants.includes(accountId) || r.stage >= 3 || (def.kind === 'daily' && r.cycle !== teamCycle(Date.now()))) continue;
        const near = (id: string) => { const p = this.positions.get(id); return p && p.health > 0 && !p.downed && Math.hypot(p.x - r.target.x, p.z - r.target.z) <= r.target.radius; };
        if (r.stage === 0) {
          const count = r.participants.filter((id) => team.members.some((m) => m.accountId === id) && near(id)).length;
          if (count !== r.progress) { r.progress = count; changed = true; }
          if (count >= 2) { r.stage = 1; r.progress = 0; changed = true; }
        } else if (r.stage === 2 && killedZombie && near(accountId) && Math.hypot(killedZombie.x - r.target.x, killedZombie.z - r.target.z) <= r.target.radius) {
          r.progress++; changed = true;
          if (r.progress >= def.kills) { r.stage = 3; r.progress = 0; }
        }
      }
      if (changed) await this.save(team);
    });
  }
}
type TeamQuestRunTarget = { x: number; z: number; radius: number };
