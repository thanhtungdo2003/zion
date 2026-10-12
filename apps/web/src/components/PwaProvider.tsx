'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface PwaState {
  installed: boolean;
  ready: boolean;
  ios: boolean;
  secure: boolean;
  install(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
}
const PwaContext = createContext<PwaState>({ installed: false, ready: false, ios: false, secure: true, install: () => Promise.resolve('unavailable') });
export const usePwa = () => useContext(PwaContext);

export function PwaProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [secure, setSecure] = useState(true);
  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    const sync = () => setInstalled(display.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone);
    sync(); setSecure(window.isSecureContext);
    setIos(/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const beforeInstall = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    display.addEventListener('change', sync);
    // Keep the development server free of service workers and hot-reload interference.
    if (process.env.NODE_ENV === 'production' && window.isSecureContext && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall); window.removeEventListener('appinstalled', onInstalled);
      display.removeEventListener('change', sync);
    };
  }, []);
  const install: PwaState['install'] = async () => {
    if (!prompt) return 'unavailable';
    setPrompt(null);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') setInstalled(true);
      return outcome;
    } catch { return 'unavailable'; }
  };
  return <PwaContext.Provider value={{ installed, ready: !!prompt, ios, secure, install }}>{children}</PwaContext.Provider>;
}
