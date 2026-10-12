/** Fullscreen needs a user gesture; keep the request inside the touch event. */
export function bindMobileFullscreen(): () => void {
  const root = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
  const page = document as Document & { webkitFullscreenElement?: Element | null };
  let entered = !!(page.fullscreenElement || page.webkitFullscreenElement);
  let pending = false;
  let disposed = false;
  const changed = () => {
    // Respect the player's choice to leave fullscreen later in this page session.
    if (page.fullscreenElement || page.webkitFullscreenElement) entered = true;
  };
  const enter = (event: PointerEvent) => {
    if (disposed || entered || pending || event.pointerType !== 'touch' || !window.matchMedia('(pointer: coarse)').matches) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"], [data-no-fullscreen]')) return;
    const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
    if (!request) return;
    pending = true;
    try {
      void Promise.resolve(request.call(root)).then(() => { entered = true; }, () => {
        // A denied request may be retried on a later touch.
      }).finally(() => { pending = false; });
    } catch {
      pending = false;
    }
  };
  document.addEventListener('pointerup', enter, true);
  document.addEventListener('fullscreenchange', changed);
  document.addEventListener('webkitfullscreenchange', changed);
  return () => {
    disposed = true;
    document.removeEventListener('pointerup', enter, true);
    document.removeEventListener('fullscreenchange', changed);
    document.removeEventListener('webkitfullscreenchange', changed);
  };
}
