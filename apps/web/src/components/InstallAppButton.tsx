'use client';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '@/lib/settings';
import { usePwa } from './PwaProvider';
import { Icon } from './Icon';

export function InstallAppButton() {
  const { installed, ready, ios, secure, install } = usePwa();
  const { t } = useSettings();
  const [help, setHelp] = useState(false), [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!help || installed) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = dialog.current;
    panel?.showModal();
    return () => { panel?.close(); previous?.focus(); };
  }, [help, installed]);
  if (installed) return null;
  const download = async () => {
    setBusy(true);
    const outcome = await install();
    setBusy(false);
    if (outcome === 'unavailable') setHelp(true);
  };
  return <>
    <button type="button" className="menu-account menu-install" data-no-fullscreen title={t('pwa.download')} aria-label={t('pwa.download')} disabled={busy} onClick={() => void download()}><Icon name="lucide:download" /><span>{t('pwa.download')}</span></button>
    {help && <dialog ref={dialog} className="pwa-dialog" data-no-fullscreen aria-labelledby="pwa-title" onCancel={() => setHelp(false)} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) setHelp(false); } }}>
      <header className="set-head"><h2 id="pwa-title"><Icon name="lucide:download" />{t('pwa.download')}</h2><button type="button" className="btn" aria-label={t('pwa.close')} onClick={() => setHelp(false)}><Icon name="lucide:x" /></button></header>
      <p>{t('pwa.intro')}</p>
      <p>{t(!secure ? 'pwa.https' : ios ? 'pwa.ios' : 'pwa.browser')}</p>
      <p className="pwa-note">{t('pwa.online')}</p>
      <footer>{ready && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void download()}>{t('pwa.install')}</button>}<button type="button" className="btn" onClick={() => setHelp(false)}>{t('pwa.close')}</button></footer>
    </dialog>}
  </>;
}
