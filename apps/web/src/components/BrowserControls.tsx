'use client';
import { useEffect, useState } from 'react';
import { useSettings } from '@/lib/settings';
import { Icon } from './Icon';
import { bindMobileFullscreen } from '@/lib/mobile-fullscreen';

/** Keep the game's right-click interactions without opening the browser context menu. */
export function BrowserControls() {
  const [rotationDismissed, setRotationDismissed] = useState(false);
  const { t } = useSettings();
  useEffect(() => bindMobileFullscreen(), []);
  useEffect(() => {
    const prevent = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('contextmenu', prevent, true);
    return () => document.removeEventListener('contextmenu', prevent, true);
  }, []);
  if (rotationDismissed) return null;
  return <section className="phone-rotate-overlay" aria-labelledby="phone-rotate-title">
    <div className="phone-rotate-card">
      <button type="button" className="phone-rotate-close" onClick={() => setRotationDismissed(true)} aria-label={t('touch.rotate_close')}><Icon name="lucide:x" /></button>
      <Icon name="lucide:rotate-cw" className="phone-rotate-icon" />
      <h2 id="phone-rotate-title">{t('touch.rotate_title')}</h2>
      <p>{t('touch.rotate_hint')}</p>
    </div>
  </section>;
}
