'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { SettingsModal } from '@/components/SettingsModal';
import Link from 'next/link';
import { ApiError, login, playAsGuest, refreshSession, register } from '@/lib/api';
import { useSettings } from '@/lib/settings';

// WebGL: client only.
const MenuStage = dynamic(() => import('@/components/MenuStage'), { ssr: false });

type AuthMode = 'login' | 'register';

const GAME_MODES = [{ id: 'survival', name: 'mode.survival', sub: 'mode.survival_sub' }] as const;

export default function MainMenu() {
  const router = useRouter();
  const { t } = useSettings();
  const [session, setSession] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modeOpen, setModeOpen] = useState(false);
  const [gameMode, setGameMode] = useState<(typeof GAME_MODES)[number]['id']>('survival');
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    let alive = true;
    void refreshSession().then((ok) => alive && setSession(ok));
    return () => {
      alive = false;
    };
  }, []);

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

  // One click: resume the session if there is one, otherwise jump in as a guest.
  const play = () => void run(() => (session ? Promise.resolve() : playAsGuest()));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(() => (authMode === 'login' ? login(username, password) : register(username, password)));
  };

  return (
    <main className="menu">
      <div className="menu-bigword" aria-hidden>
        ZION
      </div>
      <MenuStage />

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
            {authMode === 'login' ? t('menu.signin_play') : t('menu.create_play')}
          </button>
        </form>
      )}

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
          <span className="menu-mode-caret">{modeOpen ? '▾' : '▴'}</span>
        </button>
        <button className="menu-play" disabled={busy} onClick={play}>
          {busy ? t('menu.deploying') : t('menu.play')}
        </button>
        {error && <p className="error">{error}</p>}
        <Link className="menu-studio" href="/studio">
          {t('menu.studio')}
        </Link>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </main>
  );
}
