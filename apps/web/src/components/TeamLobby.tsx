'use client';
import { useState } from 'react';
import { SQUAD_LIMIT, TEAM_LIMIT, type TeamAction, type TeamLobby as Lobby } from '@zion/shared';
import { currentAccount } from '@/lib/api';
import { SpeakingIcon, VoiceControls } from './Voice';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import { RankBadge } from './RankBadge';

/** `battle`: the battle royale squad lobby (3 players) instead of the survival team (5). */
export function TeamLobby({ lobby, busy, error, onAction, battle = false }: { lobby: Lobby | null; busy: boolean; error: string | null; onAction: (action: TeamAction) => void; battle?: boolean }) {
  const limit = battle ? SQUAD_LIMIT : TEAM_LIMIT;
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [publicTeam, setPublicTeam] = useState(true);
  const [draft, setDraft] = useState('');
  const [settings, setSettings] = useState(false);
  const [copied, setCopied] = useState(false);
  const team = lobby?.team, me = currentAccount()?.id;
  const leader = team?.leaderId === me;
  return <section className="team-lobby" id="team-lobby-panel">
    <header className="team-lobby-head"><h2><Icon name="lucide:users" /> {team?.name ?? (battle ? 'Tiểu đội' : 'Đội')}</h2><small>{team ? <><Icon name="lucide:user" /> {team.members.length}/{limit} · <Icon name={team.public ? 'lucide:globe' : 'lucide:lock'} /> {team.public ? 'Công khai' : 'Mã mời'}</> : <><Icon name="lucide:user" /> {limit}</>}</small></header>
    {error && <p className="error" role="alert">{error}</p>}
    {!lobby ? <Spinner /> : !team ? <>
      <form className="team-form" onSubmit={(e) => { e.preventDefault(); onAction({ op: 'create', name: name.trim(), public: publicTeam }); }}>
        <label className="field"><span>Tạo đội mới</span><input required minLength={3} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên đội" /></label>
        <label className="team-check"><input type="checkbox" checked={publicTeam} onChange={(e) => setPublicTeam(e.target.checked)} /> Công khai</label>
        <button className="btn btn-primary" disabled={busy}>Tạo đội</button>
      </form>
      <form className="team-form" onSubmit={(e) => { e.preventDefault(); onAction({ op: 'join', code: code.trim().toUpperCase() }); }}>
        <label className="field"><span>Mã mời</span><input required pattern="[a-fA-F0-9]{8}" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXXXXX" /></label>
        <button className="btn" disabled={busy}>Tham gia</button>
      </form>
      <div className="team-public"><span className="q-label"><Icon name="lucide:globe" /> Đội công khai</span>{!lobby.available.length && <p className="team-muted"><Icon name="lucide:users" /> 0</p>}{lobby.available.map((t) => <button className="team-public-row" key={t.id} disabled={busy} onClick={() => onAction({ op: 'joinPublic', id: t.id })}><span><b>{t.name}</b><small><Icon name="lucide:crown" /> {t.leader}</small></span><em>{t.count}/{limit}</em><Icon name="lucide:arrow-right" /></button>)}</div>
    </> : <>
      <button className="team-code" title="Sao chép mã mời" onClick={() => { void navigator.clipboard?.writeText(team.code).then(() => setCopied(true)).catch(() => setCopied(false)); }}><span>MÃ MỜI</span><b>{team.code}</b><Icon name={copied ? 'lucide:check' : 'lucide:copy'} /></button>
      <div className="team-roster">{Array.from({ length: limit }, (_, i) => {
        const m = team.members[i];
        return m ? <div className="team-member" key={m.accountId}><span className="team-member-index">0{i + 1}</span><div><b><RankBadge rank={m.rank} /> {m.name} {m.accountId === team.leaderId && <Icon name="lucide:crown" />}<SpeakingIcon accountId={m.accountId} /></b><small>{m.inGame ? (battle ? 'Trong trận' : 'Đang sinh tồn') : !m.online ? 'Ngoại tuyến' : 'Trong sảnh'}{m.accountId === me ? ' · Bạn' : ''}</small></div>{leader && m.accountId !== me && <div className="team-member-tools"><button title="Trao quyền đội trưởng" disabled={busy} onClick={() => onAction({ op: 'promote', accountId: m.accountId })}><Icon name="lucide:crown" /></button><button title="Mời ra khỏi đội" disabled={busy} onClick={() => onAction({ op: 'kick', accountId: m.accountId })}><Icon name="lucide:user-minus" /></button></div>}</div> : <div className="team-member empty" key={i}><span className="team-member-index">0{i + 1}</span><Icon name="lucide:user-plus" /><small>Trống</small></div>;
      })}</div>
      <VoiceControls kind={battle ? 'battle-royale' : 'survival'} />
      <div className="team-lobby-actions"><button className="btn" disabled={busy} onClick={() => onAction({ op: 'leave' })}>Rời đội</button>{leader && <button className="btn" onClick={() => { setName(team.name); setPublicTeam(team.public); setSettings(!settings); }}>Quản lý</button>}</div>
      {settings && leader && <form className="team-form" onSubmit={(e) => { e.preventDefault(); onAction({ op: 'settings', name: name.trim(), public: publicTeam }); setSettings(false); }}><label className="field"><span>Tên đội</span><input required minLength={3} maxLength={32} value={name} onChange={(e) => setName(e.target.value)} /></label><label className="team-check"><input type="checkbox" checked={publicTeam} onChange={(e) => setPublicTeam(e.target.checked)} /> Công khai đội</label><button className="btn" disabled={busy}>Lưu thay đổi</button></form>}
      <div className="team-lobby-chat"><span className="q-label"><Icon name="lucide:messages-square" /> Chat đội</span><div className="team-chat-log">{team.chat.slice(-12).map((l) => <p key={l.id}><b><RankBadge rank={l.rank} /> {l.from}: </b>{l.text}</p>)}</div><form onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onAction({ op: 'chat', text: draft.trim() }); setDraft(''); } }}><input aria-label="Tin nhắn đội" placeholder="Nhắn cho đồng đội…" value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)} /><button className="btn" disabled={busy || !draft.trim()} title="Gửi"><Icon name="lucide:send" /></button></form></div>
    </>}
  </section>;
}
