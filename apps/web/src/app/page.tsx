'use client';
import { Icon } from '@/components/Icon';

import { Spinner } from '@/components/Spinner';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LoadingScreen } from '@/components/LoadingScreen';
import { preloadState } from '@/lib/preload';
import { SettingsModal } from '@/components/SettingsModal';
import { ApiError, login, playAsGuest, refreshSession, authProviders, linkedProviders, startSocialAuth, currentAccount, logout, renameAccount, type SocialProvider } from '@/lib/api';
import { randomGuestName } from '@/lib/guest-name';
import { useSettings } from '@/lib/settings';
import { getTeamLobby, teamAction } from '@/lib/api';
import { TeamLobby } from '@/components/TeamLobby';
import { CareerPanel } from '@/components/CareerPanel';
import { LibraryNav } from '@/components/LibraryNav';
import { LeaderboardModal } from '@/components/LeaderboardModal';
import { InstallAppButton } from '@/components/InstallAppButton';
import type { TeamAction, TeamLobby as Lobby } from '@zion/shared';

// WebGL: client only.
const MenuStage = dynamic(() => import('@/components/MenuStage'), { ssr: false });

const GAME_MODES = [{ id: 'survival', name: 'mode.survival', sub: 'mode.survival_sub' }, { id: 'battle-royale', name: 'mode.battle', sub: 'mode.battle_sub' }] as const;

export default function MainMenu() {
  const router = useRouter();
  const { t } = useSettings();
  const [session, setSession] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const nameDialog = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  // First visit: download every model and sound behind a loading screen (once per page load).
  const [loading, setLoading] = useState(() => { const st = preloadState(); return st.total === 0 || st.done < st.total; });
  const doneLoading = useCallback(() => setLoading(false), []);
  const [error, setError] = useState<string | null>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const [gameMode, setGameMode] = useState<(typeof GAME_MODES)[number]['id']>('survival');
  const [authOpen, setAuthOpen] = useState(false);
  const [legacyLogin, setLegacyLogin] = useState(false);
  const [providers, setProviders] = useState<Record<SocialProvider, boolean>>({ google: false, facebook: false });
  const [guestAllowed, setGuestAllowed] = useState(false);
  const [linked, setLinked] = useState<SocialProvider[]>([]);
  const [linkedReady, setLinkedReady] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [nameNotice, setNameNotice] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [teamOpen, setTeamOpen] = useState(false);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [entryIntent, setEntryIntent] = useState<'play' | 'team'>('play');
  const teamVersion = useRef(0);
  const teamWorking = useRef(false);
  const team = lobby?.team;

  const applyLobby = useCallback((next: Lobby) => {
    setLobby(next);
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const version = teamVersion.current;
      try {
        if (!teamWorking.current) {
          const next = await getTeamLobby();
          if (active && version === teamVersion.current) { applyLobby(next); setTeamError(null); }
        }
      } catch (err) { if (active) setTeamError(err instanceof Error ? err.message : 'Không kết nối được sảnh đội.'); }
      if (active) timer = setTimeout(() => { void poll(); }, 2000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [session, applyLobby]);

  const manageTeam = async (action: TeamAction) => {
    if (teamWorking.current) return;
    teamWorking.current = true; teamVersion.current++; setTeamBusy(true); setTeamError(null);
    try { applyLobby(await teamAction(action)); }
    catch (err) { setTeamError(err instanceof Error ? err.message : 'Không cập nhật được đội.'); }
    finally { teamWorking.current = false; setTeamBusy(false); }
  };

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams(window.location.search);
    const returned = query.get('auth') === 'success';
    const authError = query.get('auth_error');
    if (returned || authError) {
      window.history.replaceState(null, '', window.location.pathname);
      setAuthOpen(true);
      if (authError) setError(authError === 'identity_taken' ? 'Tài khoản mạng xã hội này đã liên kết với nhân vật khác hoặc bạn đã liên kết nhà cung cấp này.' : 'Đăng nhập chưa hoàn tất. Vui lòng thử lại.');
      else setAccountNotice('Đăng nhập thành công. Nhân vật của bạn đã sẵn sàng.');
    }
    void authProviders().then(info => { if (alive) { setProviders(info.providers); setGuestAllowed(info.guest); } }).catch(() => { if (alive) setError('Không tải được các phương thức đăng nhập. Vui lòng tải lại trang.'); });
    void refreshSession(returned).then((ok) => {
      if (!alive) return;
      setSession(ok); setSessionReady(true);
      if (ok && currentAccount()?.guest) setAuthOpen(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!session) { setLinked([]); setLinkedReady(false); return; }
    let alive = true;
    void linkedProviders().then(value => { if (alive) { setLinked(value); setLinkedReady(true); } }).catch(() => { if (alive) setError('Không tải được liên kết tài khoản. Vui lòng thử lại.'); });
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    if (!nameOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!busy) setNameOpen(false); }
      if (e.key !== 'Tab') return;
      const fields = nameDialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)');
      if (!fields?.length) { e.preventDefault(); return; }
      const first = fields[0]!, last = fields[fields.length - 1]!;
      if (!nameDialog.current?.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nameOpen, busy]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.push(gameMode === 'battle-royale' ? '/play?mode=battle-royale' : '/play');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('menu.server_error'));
      setBusy(false);
    }
  };

  // Returning players resume; first-time guests choose their name before account creation.
  const play = () => {
    if (session) void run(() => Promise.resolve());
    else { setEntryIntent('play'); setError(null); setAuthOpen(true); }
  };

  const submitName = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const name = playerName.trim().normalize('NFC');
    if (name.length < 3 || name.length > 20 || !/^[\p{L}\p{N}_ -]+$/u.test(name)) {
      setNameError(t('menu.name_rules')); return;
    }
    setBusy(true); setNameError(null);
    try {
      await playAsGuest(name);
      setSession(true);
      if (entryIntent === 'team') { setNameOpen(false); setTeamOpen(true); setBusy(false); }
      else router.push(gameMode === 'battle-royale' ? '/play?mode=battle-royale' : '/play');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'username_taken') setNameError(t('menu.name_taken'));
      else if (err instanceof ApiError && err.code === 'invalid_request') setNameError(t('menu.name_rules'));
      else setNameError(err instanceof ApiError ? err.message : t('menu.server_error'));
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    void login(username, password).then(() => { setSession(true); setLegacyLogin(false); setPassword(''); setAccountNotice('Đã đăng nhập tài khoản cũ. Bạn có thể liên kết Google/Facebook để giữ tiến độ.'); }).catch(err => { setError(err instanceof Error ? err.message : t('menu.server_error')); }).finally(() => setBusy(false));
  };

  const social = async (provider: SocialProvider) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await startSocialAuth(provider, session); }
    catch (err) { setError(err instanceof Error ? err.message : t('menu.server_error')); setBusy(false); }
  };

  const guest = () => { setPlayerName(randomGuestName()); setNameError(null); setNameOpen(true); setAuthOpen(false); };

  return (
    <main className={`menu${team ? ' has-team' : ''}${teamOpen ? ' team-panel-open' : ''}`}>
      <div className="menu-bigword" aria-hidden>
        ZION
      </div>
      <MenuStage members={team?.members.map((m) => ({ name: m.name, rank: m.rank }))} />
      <CareerPanel session={session} />

      <header className="menu-top">
        <div className="menu-brand">
          ZI<span>O</span>N<small>The Last Light</small>
        </div>
        <div className="menu-top-actions">
          <InstallAppButton />
          <LibraryNav />
          <button className="menu-account menu-leaderboard" aria-label="Bảng xếp hạng" title="Bảng xếp hạng" onClick={() => setLeaderboardOpen(true)}><Icon name="lucide:trophy" /><span>Bảng xếp hạng</span></button>
          <button className="menu-account icon" onClick={() => setSettingsOpen(true)} aria-label={t('menu.settings')} title={t('menu.settings')}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden focusable="false">
              <path
                fill="currentColor"
                d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
              />
            </svg>
          </button>
          <button className="menu-account" onClick={() => setAuthOpen((v) => !v)}>
            {session ? t('menu.account_in') : t('menu.signin')}
          </button>
        </div>
      </header>

      <button className="menu-team-toggle" aria-expanded={teamOpen} aria-controls="team-lobby-panel" disabled={!sessionReady || busy} onClick={() => {
        if (!session) { setEntryIntent('team'); setAuthOpen(true); }
        else setTeamOpen(!teamOpen);
      }}><Icon name="lucide:users" /><span>{team ? `${team.members.length}/5 · ${team.name}` : 'Đội nhóm'}</span><Icon name={teamOpen ? 'lucide:x' : 'lucide:chevron-right'} /></button>

      {authOpen && (
        <section className="menu-auth" aria-label={session ? 'Liên kết tài khoản' : 'Đăng nhập và đăng ký'}>
          {session && nameDraft === null && <div className="menu-profile-name">
            <h2>{currentAccount()?.username}</h2>
            <button type="button" className="menu-account icon" aria-label="Đổi tên" title="Đổi tên" disabled={busy} onClick={() => { setNameDraft(currentAccount()?.username ?? ''); setNameNotice(null); }}><Icon name="lucide:pencil" /></button>
          </div>}
          {session && nameDraft !== null && <form className="menu-profile-form" onSubmit={(e) => {
            e.preventDefault();
            setBusy(true); setNameNotice(null);
            void renameAccount(nameDraft.trim()).then(() => { setNameDraft(null); setNameNotice('Đã đổi tên. Tên mới áp dụng từ trận tiếp theo.'); })
              .catch(err => setNameNotice(err instanceof ApiError && err.code === 'username_taken' ? t('menu.name_taken') : err instanceof ApiError && err.status === 400 ? 'Tên cần 3–20 ký tự: chữ, số, khoảng trắng, _ hoặc -.' : err instanceof Error ? err.message : t('menu.server_error')))
              .finally(() => setBusy(false));
          }}>
            <label className="field">
              <span>Tên hiển thị</span>
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} minLength={3} maxLength={20} autoFocus required />
            </label>
            <div className="menu-profile-actions">
              <button className="btn btn-primary" type="submit" disabled={busy || nameDraft.trim() === currentAccount()?.username}>Lưu</button>
              <button className="btn" type="button" disabled={busy} onClick={() => { setNameDraft(null); setNameNotice(null); }}>Huỷ</button>
            </div>
          </form>}
          {session && nameNotice && <p className="menu-auth-notice" role="status">{nameNotice}</p>}
          {!session && <h2>Đăng nhập / Đăng ký</h2>}
          <p>{session ? linked.length ? 'Tiến độ đã gắn với tài khoản của bạn. Bạn có thể liên kết thêm một phương thức đăng nhập.' : 'Liên kết Google hoặc Facebook để giữ nhân vật, đồ đạc và tiến độ khi đổi thiết bị hoặc mất phiên trình duyệt.' : 'Dùng Google hoặc Facebook để tạo tài khoản mới và lưu tiến độ.'}</p>
          {accountNotice && <p className="menu-auth-notice" role="status">{accountNotice}</p>}
          <div className="menu-social-buttons">
            {(['google', 'facebook'] as const).map(provider => <button type="button" className={`btn menu-social ${provider}`} key={provider} disabled={busy || !providers[provider] || (session && (!linkedReady || linked.includes(provider)))} onClick={() => { void social(provider); }}>
              <span aria-hidden>{provider === 'google' ? 'G' : 'f'}</span>
              {linked.includes(provider) ? 'Đã liên kết' : session ? 'Liên kết' : 'Tiếp tục với'} {provider === 'google' ? 'Google' : 'Facebook'}
            </button>)}
          </div>
          {(!providers.google || !providers.facebook) && <small>Phương thức bị mờ hiện chưa khả dụng.</small>}
          {!session && <>
            <button className="btn" type="button" disabled={busy || !guestAllowed} onClick={guest}><Icon name="lucide:user" /> Tham gia bằng tài khoản khách</button>
            <button className="menu-auth-legacy" type="button" disabled={busy} aria-expanded={legacyLogin} onClick={() => setLegacyLogin(v => !v)}>Đăng nhập tài khoản cũ bằng mật khẩu</button>
          </>}
          {session && <button className="menu-auth-legacy" type="button" disabled={busy || !linkedReady} onClick={() => { setBusy(true); void logout().then(() => { setSession(false); setAccountNotice(null); setLobby(null); setTeamOpen(false); }).catch(err => { setSession(false); setError(err instanceof Error ? err.message : t('menu.server_error')); }).finally(() => setBusy(false)); }}>Đăng xuất</button>}
          {!session && legacyLogin && <form onSubmit={onSubmit}>
          <label className="field">
            <span>{t('menu.username')}</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" required />
          </label>
          <label className="field">
            <span>{t('menu.password')}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              minLength={10}
              maxLength={128}
              required
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? <Spinner /> : 'Đăng nhập tài khoản cũ'}
          </button>
          </form>}
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      )}

      {session && teamOpen && <TeamLobby lobby={lobby} busy={teamBusy} error={teamError} onAction={(action) => { void manageTeam(action); }} />}

      <div className="menu-launch">
        <a
          className="menu-zalo"
          href="https://zalo.me/g/csvws2f2cekoikrjadir"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Tham gia nhóm Zalo Zion"
        >
          <Image
            src="/zalo-group-qr.jpg"
            alt="Mã QR tham gia nhóm Zalo Zion. Quét mã bằng Zalo để tham gia."
            width={840}
            height={1280}
            priority
            unoptimized
          />
        </a>
        {modeOpen && (
          <ul className="menu-modes" role="listbox">
            {GAME_MODES.map((m) => (
              <li key={m.id}>
                <button
                  role="option"
                  aria-selected={m.id === gameMode}
                  onClick={() => {
                    setGameMode(m.id);
                    setModeOpen(false);
                  }}
                >
                  <b>{t(m.name)}</b>
                  <small>{t(m.sub)}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="menu-mode" onClick={() => setModeOpen((v) => !v)} aria-expanded={modeOpen}>
          <small>{t('menu.mode')}</small>
          <b>{t(GAME_MODES.find((m) => m.id === gameMode)!.name)}</b>
          <span className="menu-mode-caret"><Icon name={modeOpen ? 'lucide:chevron-down' : 'lucide:chevron-up'} /></span>
        </button>
        <button className="menu-play" disabled={busy || !sessionReady} onClick={play}>
          {busy ? <><Spinner /> {t('menu.deploying')}</> : t('menu.play')}
        </button>
        {teamError && !teamOpen && <p className="error">{teamError}</p>}
        {error && <p className="error">{error}</p>}
      </div>

      {nameOpen && <div className="overlay menu-name-overlay" role="dialog" aria-modal="true" aria-labelledby="player-name-title">
        <form ref={nameDialog} className="overlay-card menu-name-card" onSubmit={(e) => { void submitName(e); }}>
          <h2 id="player-name-title">Tham gia bằng tài khoản khách</h2>
          <p>Chọn tên để vào chơi. Bạn có thể liên kết Google hoặc Facebook sau để giữ tiến độ khi đổi thiết bị.</p>
          <label className="field">
            <span>{t('menu.player_name')}</span>
            <input autoFocus value={playerName} onChange={(e) => { setPlayerName(e.target.value); setNameError(null); }}
              maxLength={20} required disabled={busy} autoComplete="nickname" aria-describedby="player-name-rules" aria-invalid={!!nameError} />
          </label>
          <button className="btn" type="button" disabled={busy} onClick={() => { setPlayerName(randomGuestName()); setNameError(null); }}><Icon name="lucide:shuffle" /> Chọn tên ngẫu nhiên khác</button>
          <small id="player-name-rules">{t('menu.name_rules')}</small>
          {nameError && <p className="error" role="alert">{nameError}</p>}
          <div className="overlay-row">
            <button className="btn" type="button" disabled={busy} onClick={() => setNameOpen(false)}>{t('menu.name_cancel')}</button>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? <Spinner /> : t('menu.play')}</button>
          </div>
        </form>
      </div>}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {leaderboardOpen && <LeaderboardModal onClose={() => setLeaderboardOpen(false)} />}
      {loading && <LoadingScreen onDone={doneLoading} />}
    </main>
  );
}
