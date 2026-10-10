'use client';
import { useEffect } from 'react';

/** Keep the game's right-click interactions without opening the browser context menu. */
export function BrowserControls() {
  useEffect(() => {
    const prevent = (event: MouseEvent) => event.preventDefault();
    document.addEventListener('contextmenu', prevent, true);
    return () => document.removeEventListener('contextmenu', prevent, true);
  }, []);
  return null;
}
