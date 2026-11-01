'use client';
import { useEffect, useRef, useState } from 'react';
import { useSettings } from '@/lib/settings';
import { usePwa } from './PwaProvider';
import { Icon } from './Icon';
import { launcherUpdate } from '@/lib/launcher';

/**
 * The game as a ZIP, served by this site itself: put the file at apps/web/public/downloads/zion.zip
 * and the player's browser downloads it directly. NEXT_PUBLIC_ZIP_DOWNLOAD_URL can point elsewhere
 * instead (e.g. a Google Drive link). While the file is missing the choice shows as coming soon.
 */
export const ZIP_DOWNLOAD_URL = process.env.NEXT_PUBLIC_ZIP_DOWNLOAD_URL || '/downloads/zion.zip';
const ZIP_LOCAL = ZIP_DOWNLOAD_URL.startsWith('/');

/** "Download" in the main menu: a panel with two large choices, the web app (top) and the ZIP (bottom). */
export function InstallAppButton() {
  const { installed, ready, ios, secure, install } = usePwa();
  const { t } = useSettings();
  const [open, setOpen] = useState(false), [help, setHelp] = useState(false), [busy, setBusy] = useState(false);
  /** Whether the ZIP is there to download (checked when the panel opens; links elsewhere are trusted). */
  const [zip, setZip] = useState<boolean>(!ZIP_LOCAL);
  useEffect(() => {
    if (!open || !ZIP_LOCAL) return;
    let live = true;
    void fetch(ZIP_DOWNLOAD_URL, { method: 'HEAD' }).then((r) => { if (live) setZip(r.ok); }).catch(() => { if (live) setZip(false); });
    return () => { live = false; };
  }, [open]);
  /** Playing in an out-of-date desktop launcher: the newer version (the game itself is always current). */
  const [update, setUpdate] = useState<string | null>(null);
  useEffect(() => { void launcherUpdate().then(setUpdate); }, []);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = dialog.current;
    panel?.showModal();
    return () => { panel?.close(); previous?.focus(); };
  }, [open]);
  const close = () => { setOpen(false); setHelp(false); };
  const webApp = async () => {
    setBusy(true);
    const outcome = await install();
    setBusy(false);
    // Installed: nothing more to show. Otherwise explain how to install from the browser.
    if (outcome === 'unavailable') setHelp(true); else close();
  };
  return <>
    <button type="button" className={`menu-account menu-install${update ? ' has-update' : ''}`} data-no-fullscreen title={t('pwa.download')} aria-label={t('pwa.download')} onClick={() => setOpen(true)}><Icon name="lucide:download" /><span>{update ? t('pwa.update', { version: update }) : t('pwa.download')}</span></button>
    {open && <dialog ref={dialog} className="pwa-dialog download-dialog" data-no-fullscreen aria-labelledby="pwa-title" onCancel={close} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } }}>
      <header className="set-head"><h2 id="pwa-title"><Icon name="lucide:download" />{t('pwa.download')}</h2><button type="button" className="btn" aria-label={t('pwa.close')} onClick={close}><Icon name="lucide:x" /></button></header>
      {help ? <>
        <p>{t(!secure ? 'pwa.https' : ios ? 'pwa.ios' : 'pwa.browser')}</p>
        <p className="pwa-note">{t('pwa.online')}</p>
        <footer>{ready && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void webApp()}>{t('pwa.install')}</button>}<button type="button" className="btn" onClick={() => setHelp(false)}>{t('pwa.back')}</button></footer>
      </> : <div className="download-choices">
        <button type="button" className="download-choice" disabled={busy || installed} onClick={() => void webApp()}>
          <Icon name="lucide:app-window" />
          <span><b>{t('pwa.web_app')}</b>{installed && <small><Icon name="lucide:check" /> {t('pwa.installed')}</small>}</span>
        </button>
        {zip
          ? <a className="download-choice" href={ZIP_DOWNLOAD_URL} {...(ZIP_LOCAL ? { download: 'ZION.zip' } : { target: '_blank', rel: 'noopener noreferrer' })} onClick={close}>
            <Icon name="lucide:file-archive" />
            <span><b>{t('pwa.zip')}</b></span>
          </a>
          : <button type="button" className="download-choice" disabled>
            <Icon name="lucide:file-archive" />
            <span><b>{t('pwa.zip')}</b><small>{t('pwa.zip_soon')}</small></span>
          </button>}
      </div>}
    </dialog>}
  </>;
}
