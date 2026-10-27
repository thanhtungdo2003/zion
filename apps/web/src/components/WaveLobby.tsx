'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WAVE_BOARDS, WAVE_MAX_BOTS, WAVE_TEAM_LIMIT, type TeamAction, type TeamLobby, type WaveBoard, type WaveLeaderboard } from '@zion/shared';
import { getWaveLeaderboard, listWaveMaps, type BattleMapInfo } from '@/lib/api';
import { currentAccount } from '@/lib/api';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

const MAP_KEY = 'zion.waves.map', BOTS_KEY = 'zion.waves.bots', MODE_KEY = 'zion.waves.mode';
const FALLBACK_IMAGE = '/images/modes/infection-3.webp';
const BOT_NAMES = ['Hổ Mang', 'Sói Xám', 'Đại Bàng'];
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };

/**
 * Zombie Wave Survival lobby: the big party modal of the main menu. Mode switch (friends / bots)
 * → four team slots → map → PLAY. Friends mode is a real wave party on the server (create, invite
 * by code, ready, leader picks the map and launches); bot mode sets 0–3 bots for a solo room.
 */
export function WaveLobby({ lobby, busy, error, onAction, onPlay, onClose }: {
  lobby: TeamLobby | null; busy: boolean; error: string | null;
  onAction(action: TeamAction): Promise<TeamLobby | null>;
  onPlay(url: string): void;
  onClose(): void;
}) {
  const [mode, setMode] = useState<'friends' | 'bots'>(() => read(MODE_KEY) === 'friends' ? 'friends' : 'bots');
  const [bots, setBots] = useState(() => Math.min(WAVE_MAX_BOTS, Math.max(0, Number(read(BOTS_KEY) ?? 1) || 0)));
  const [maps, setMaps] = useState<BattleMapInfo[] | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(() => read(MAP_KEY));
  const [code, setCode] = useState('');
  const [starting, setStarting] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const me = currentAccount()?.id, team = lobby?.team ?? null, leader = !!team && team.leaderId === me;

  useEffect(() => {
    let alive = true;
    listWaveMaps().then((list) => { if (alive) setMaps(list); }).catch((err: unknown) => { if (alive) setMapError(err instanceof Error ? err.message : 'Không tải được danh sách bản đồ.'); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !boardOpen) onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose, boardOpen]);
  useEffect(() => { write(MODE_KEY, mode); }, [mode]);
  useEffect(() => { write(BOTS_KEY, String(bots)); }, [bots]);

  // The map: a party plays the leader's choice; alone, the remembered one (or the first offered).
  const valid = (id: string | null | undefined) => !!id && !!maps?.some((m) => m.id === id);
  const map = mode === 'friends' && team ? (valid(team.map) ? team.map! : null) : valid(picked) ? picked! : maps?.[0]?.id ?? null;
  const pickMap = (id: string) => {
    if (mode === 'friends' && team) { if (leader) void onAction({ op: 'map', map: id }); return; }
    setPicked(id); write(MAP_KEY, id);
  };
  // A new party starts on the map already chosen here.
  const created = useRef(false);
  useEffect(() => { if (mode === 'friends' && leader && team && !team.map && map === null && picked && valid(picked) && !created.current) { created.current = true; void onAction({ op: 'map', map: picked }); } });

  const others = team?.members.filter((m) => m.accountId !== team.leaderId) ?? [];
  const waiting = others.filter((m) => !m.ready || !m.online);
  const reason = !maps ? 'Đang tải bản đồ…' : !maps.length ? 'Chưa có bản đồ nào hỗ trợ chế độ này.' : !map ? (mode === 'friends' && team ? 'Đội trưởng cần chọn bản đồ.' : 'Chọn một bản đồ.')
    : mode === 'friends' && !team ? 'Tạo phòng hoặc nhập mã để vào phòng của bạn bè.'
      : mode === 'friends' && !leader ? null
        : mode === 'friends' && waiting.length ? `Chờ ${waiting.map((m) => m.name).join(', ')} sẵn sàng.` : null;

  const play = useCallback(async () => {
    if (starting || !map) return;
    setStarting(true);
    if (mode === 'bots') { onPlay(`/play?mode=waves&map=${encodeURIComponent(map)}&bots=${bots}`); return; }
    const next = await onAction({ op: 'launch' });
    if (next?.team?.launchId) onPlay(`/play?mode=waves&party=1&map=${encodeURIComponent(map)}`);
    else setStarting(false);
  }, [starting, map, mode, bots, onAction, onPlay]);

  const slots = Array.from({ length: WAVE_TEAM_LIMIT }, (_, i) => i);
  const self = currentAccount()?.username ?? 'Bạn';

  return (
    <div className="mode-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="mode-modal wave-lobby" role="dialog" aria-modal="true" aria-labelledby="wave-lobby-title">
        <header>
          <Icon name="game-icons:shambling-zombie" />
          <h2 id="wave-lobby-title">Sinh tồn theo đợt</h2>
          <span className="wave-lobby-sub">Cầm cự qua những đợt xác sống ngày càng đông</span>
          <button className="btn wave-lobby-board-btn" onClick={() => setBoardOpen(true)}><Icon name="lucide:trophy" /> Bảng xếp hạng</button>
          <button className="inv-close" aria-label="Đóng" onClick={onClose}><Icon name="lucide:x" /></button>
        </header>

        <div className="wave-switch" role="tablist" aria-label="Chế độ đội hình">
          {(['friends', 'bots'] as const).map((m) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} disabled={starting} onClick={() => setMode(m)}>
              <Icon name={m === 'friends' ? 'lucide:users' : 'lucide:bot'} />
              <b>{m === 'friends' ? 'Chơi cùng bạn bè' : 'Chơi cùng bot'}</b>
              <small>{m === 'friends' ? 'Tối đa 4 người chơi thật' : 'Một mình, thêm 0–3 bot'}</small>
            </button>
          ))}
          <i className={`wave-switch-thumb ${mode}`} aria-hidden />
        </div>

        <div className="wave-slots" aria-label="Đội hình">
          {slots.map((i) => {
            if (mode === 'bots') {
              if (i === 0) return <Slot key={i} kind="leader" name={self} status="Sẵn sàng" self />;
              if (i <= bots) return <Slot key={i} kind="bot" name={BOT_NAMES[i - 1]!} status="Bot · sẵn sàng" onRemove={i === bots ? () => setBots(bots - 1) : undefined} />;
              return <Slot key={i} kind="empty" name="Thêm bot" status={i === bots + 1 ? 'Bấm để thêm' : 'Trống'} onClick={i === bots + 1 ? () => setBots(bots + 1) : undefined} />;
            }
            const member = team ? [team.members.find((m) => m.accountId === team.leaderId)!, ...others][i] : i === 0 ? { accountId: me ?? '', name: self, ready: true, online: true } : undefined;
            if (member) {
              const isLeader = !team || member.accountId === team.leaderId;
              return <Slot key={i} kind={isLeader ? 'leader' : 'player'} name={member.name} self={member.accountId === me}
                status={!('online' in member) || member.online ? isLeader ? 'Chủ phòng' : member.ready ? 'Đã sẵn sàng' : 'Đang chờ' : 'Mất kết nối'}
                ready={isLeader || member.ready} offline={'online' in member && !member.online}
                onRemove={leader && !isLeader ? () => { void onAction({ op: 'kick', accountId: member.accountId }); } : undefined} />;
            }
            return <Slot key={i} kind="empty" name={team ? 'Mời bạn bè' : 'Trống'} status={team ? `Mã phòng ${team.code}` : 'Tạo phòng để mời'}
              onClick={team ? () => { void navigator.clipboard?.writeText(team.code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); } : undefined} />;
          })}
        </div>

        {mode === 'friends' && <div className="wave-party">
          {!team ? <>
            <button className="btn btn-primary" disabled={busy} onClick={() => { void onAction({ op: 'create', name: `Đội của ${self}`.slice(0, 24), public: false }); }}><Icon name="lucide:plus" /> Tạo phòng</button>
            <form onSubmit={(e) => { e.preventDefault(); if (/^[A-Fa-f0-9]{8}$/.test(code)) void onAction({ op: 'join', code }); }}>
              <input value={code} onChange={(e) => setCode(e.target.value.trim().toUpperCase())} maxLength={8} placeholder="Mã phòng (8 ký tự)" aria-label="Mã phòng" />
              <button className="btn" type="submit" disabled={busy || !/^[A-F0-9]{8}$/.test(code)}>Vào phòng</button>
            </form>
          </> : <>
            <span>Mã phòng <code>{team.code}</code> {copied && <em>đã chép</em>}</span>
            <small>Gửi mã cho bạn bè để họ vào phòng ở sảnh này.</small>
            <button className="btn" disabled={busy} onClick={() => { void onAction({ op: 'leave' }); }}><Icon name="lucide:log-out" /> Rời phòng</button>
          </>}
        </div>}

        <div className="wave-maps" aria-label="Bản đồ">
          <h3>Bản đồ {mode === 'friends' && team && !leader && <small>· do chủ phòng chọn</small>}</h3>
          {mapError ? <p className="error">{mapError}</p> : !maps ? <p className="wave-maps-empty"><Spinner /> Đang tải…</p> : !maps.length ? <p className="wave-maps-empty">Chưa có bản đồ nào được phát hành cho chế độ này.</p> : (
            <div className="wave-map-row">
              {maps.map((m) => (
                <button key={m.id} className={`wave-map${m.id === map ? ' on' : ''}`} aria-pressed={m.id === map} disabled={starting || (mode === 'friends' && !!team && !leader)} onClick={() => pickMap(m.id)}>
                  <span style={{ backgroundImage: `url(${m.thumbnail ?? FALLBACK_IMAGE})` }} />
                  <b>{m.name}</b>
                  <small>{m.players ? `${m.players} người đang chơi` : 'Thị trấn có tường bao'}</small>
                </button>
              ))}
            </div>
          )}
        </div>

        <footer className="wave-lobby-foot">
          {(error || reason) && <p className={error ? 'error' : 'wave-reason'} role={error ? 'alert' : 'status'}>{error ?? reason}</p>}
          {mode === 'friends' && team && !leader
            ? <button className="menu-play" disabled={busy} onClick={() => { void onAction({ op: 'ready', ready: !team.members.find((m) => m.accountId === me)?.ready }); }}>
              {team.members.find((m) => m.accountId === me)?.ready ? 'HỦY SẴN SÀNG' : 'SẴN SÀNG'}
            </button>
            : <button className="menu-play" disabled={starting || busy || !!reason} onClick={() => { void play(); }}>
              {starting ? <><Spinner /> Đang tạo trận…</> : 'PLAY'}
            </button>}
        </footer>
      </section>
      {boardOpen && <WaveBoards maps={maps ?? []} initialMap={map} onClose={() => setBoardOpen(false)} />}
    </div>
  );
}

function Slot({ kind, name, status, self, ready, offline, onClick, onRemove }: {
  kind: 'leader' | 'player' | 'bot' | 'empty'; name: string; status: string; self?: boolean; ready?: boolean; offline?: boolean;
  onClick?(): void; onRemove?(): void;
}) {
  const body = <>
    <span className="wave-slot-avatar"><Icon name={kind === 'bot' ? 'lucide:bot' : kind === 'empty' ? 'lucide:plus' : 'lucide:user-round'} /></span>
    {kind === 'leader' && <Icon name="lucide:crown" className="wave-slot-crown" />}
    <b>{name}</b>
    <small>{status}</small>
    {kind === 'bot' && <i>BOT</i>}
    {self && <i className="you">BẠN</i>}
  </>;
  const cls = `wave-slot ${kind}${ready ? ' ready' : ''}${offline ? ' offline' : ''}${onClick ? ' clickable' : ''}`;
  return (
    <div className={cls}>
      {onClick ? <button className="wave-slot-hit" onClick={onClick}>{body}</button> : body}
      {onRemove && <button className="wave-slot-remove" aria-label={`Bỏ ${name}`} onClick={onRemove}><Icon name="lucide:x" /></button>}
    </div>
  );
}

/** The eight boards of one map: bot team sizes, then real-player party sizes. */
export function WaveBoards({ maps, initialMap, onClose }: { maps: BattleMapInfo[]; initialMap: string | null; onClose(): void }) {
  const [map, setMap] = useState(initialMap ?? maps[0]?.id ?? '');
  const [board, setBoard] = useState<WaveBoard>('solo');
  const [data, setData] = useState<WaveLeaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!map) return;
    let alive = true;
    setData(null); setError(null);
    getWaveLeaderboard(map, board).then((d) => { if (alive) setData(d); }).catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : 'Không tải được bảng xếp hạng.'); });
    return () => { alive = false; };
  }, [map, board]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  const time = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  return (
    <div className="mode-backdrop wave-boards-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="mode-modal wave-boards" role="dialog" aria-modal="true" aria-labelledby="wave-boards-title">
        <header>
          <Icon name="lucide:trophy" />
          <h2 id="wave-boards-title">Bảng xếp hạng sinh tồn</h2>
          <select value={map} onChange={(e) => setMap(e.target.value)} aria-label="Bản đồ">
            {maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button className="inv-close" aria-label="Đóng" onClick={onClose}><Icon name="lucide:x" /></button>
        </header>
        <div className="wave-board-tabs">
          {(['bots', 'friends'] as const).map((group) => (
            <div key={group} role="tablist" aria-label={group === 'bots' ? 'Chơi cùng bot' : 'Chơi cùng bạn bè'}>
              <small>{group === 'bots' ? 'Chơi cùng bot' : 'Chơi cùng bạn bè'}</small>
              {WAVE_BOARDS.filter((b) => b.playMode === group).map((b) => (
                <button key={b.id} role="tab" aria-selected={board === b.id} className={board === b.id ? 'on' : ''} onClick={() => setBoard(b.id)}>{b.name}</button>
              ))}
            </div>
          ))}
        </div>
        <div className="wave-board-table" role="table" aria-label="Kết quả">
          <div className="br-row br-row-head" role="row"><span>Hạng</span><span>Đội</span><span>Đợt</span><span>Thời gian</span></div>
          {!map ? <p className="wave-maps-empty">Chưa có bản đồ.</p> : error ? <p className="error">{error}</p> : !data ? <p className="wave-maps-empty"><Spinner /> Đang tải…</p>
            : !data.rows.length ? <p className="wave-maps-empty">Chưa có thành tích nào trên bảng này. Hãy là người đầu tiên!</p>
              : data.rows.map((r) => (
                <div key={r.position} role="row" className={`br-row${r.position <= 3 ? ' top' : ''}`}>
                  <span className="br-place">#{r.position}</span>
                  <span className="br-name"><b>{r.members.join(', ')}</b></span>
                  <span className="br-kills">{r.cleared}</span>
                  <span className="br-state" title={`Sống sót ${time(r.survivedMs)} · ${new Date(r.at).toLocaleDateString('vi-VN')}`}>{time(r.clearMs)}</span>
                </div>
              ))}
        </div>
      </section>
    </div>
  );
}
