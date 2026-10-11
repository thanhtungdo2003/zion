'use client';
import { Icon } from '@/components/Icon';

import { Spinner } from '@/components/Spinner';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LoadingScreen } from '@/components/LoadingScreen';
import { preloadState } from '@/lib/preload';
import { SettingsModal } from '@/components/SettingsModal';
import Link from 'next/link';
import { ApiError, login, playAsGuest, refreshSession, register } from '@/lib/api';
import { useSettings } from '@/lib/settings';
import { getTeamLobby, teamAction } from '@/lib/api';
import { TeamLobby } from '@/components/TeamLobby';
import { CareerPanel } from '@/components/CareerPanel';
import type { TeamAction, TeamLobby as Lobby } from '@zion/shared';

// WebGL: client only.
const MenuStage = dynamic(() => import('@/components/MenuStage'), { ssr: false });

type AuthMode = 'login' | 'register';

const GAME_MODES = [{ id: 'survival', name: 'mode.survival', sub: 'mode.survival_sub' }] as const;

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
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [username, setUsername] = useState('');
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
    void refreshSession().then((ok) => {
      if (!alive) return;
      setSession(ok); setSessionReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

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
      router.push('/play');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('menu.server_error'));
      setBusy(false);
    }
  };

  // Returning players resume; first-time guests choose their name before account creation.
  const play = () => {
    if (session) void run(() => Promise.resolve());
    else { setEntryIntent('play'); setError(null); setNameError(null); setNameOpen(true); }
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
      else router.push('/play');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'username_taken') setNameError(t('menu.name_taken'));
      else if (err instanceof ApiError && err.code === 'invalid_request') setNameError(t('menu.name_rules'));
      else setNameError(err instanceof ApiError ? err.message : t('menu.server_error'));
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => (authMode === 'login' ? login(username, password) : register(username, password)));
  };

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
        if (!session) { setEntryIntent('team'); setNameError(null); setNameOpen(true); }
        else setTeamOpen(!teamOpen);
      }}><Icon name="lucide:users" /><span>{team ? `${team.members.length}/5 · ${team.name}` : 'Đội nhóm'}</span><Icon name={teamOpen ? 'lucide:x' : 'lucide:chevron-right'} /></button>

      {authOpen && (
        <form className="menu-auth" onSubmit={onSubmit}>
          <div className="tabs" role="tablist">
            <button type="button" className="tab" role="tab" aria-selected={authMode === 'login'} onClick={() => setAuthMode('login')}>
              {t('menu.signin')}
            </button>
            <button type="button" className="tab" role="tab" aria-selected={authMode === 'register'} onClick={() => setAuthMode('register')}>
              {t('menu.register')}
            </button>
          </div>
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
              autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
              minLength={10}
              maxLength={128}
              required
            />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? <Spinner /> : authMode === 'login' ? t('menu.signin_play') : t('menu.create_play')}
          </button>
        </form>
      )}

      {session && teamOpen && <TeamLobby lobby={lobby} busy={teamBusy} error={teamError} onAction={(action) => { void manageTeam(action); }} />}

      <div className="menu-launch">
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
          <h2 id="player-name-title">{t('menu.choose_name')}</h2>
          <p>{t('menu.name_intro')}</p>
          <label className="field">
            <span>{t('menu.player_name')}</span>
            <input autoFocus value={playerName} onChange={(e) => { setPlayerName(e.target.value); setNameError(null); }}
              maxLength={20} required disabled={busy} autoComplete="nickname" aria-describedby="player-name-rules" aria-invalid={!!nameError} />
          </label>
          <small id="player-name-rules">{t('menu.name_rules')}</small>
          {nameError && <p className="error" role="alert">{nameError}</p>}
          <div className="overlay-row">
            <button className="btn" type="button" disabled={busy} onClick={() => setNameOpen(false)}>{t('menu.name_cancel')}</button>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? <Spinner /> : t('menu.play')}</button>
          </div>
        </form>
      </div>}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {loading && <LoadingScreen onDone={doneLoading} />}
    </main>
  );
}
