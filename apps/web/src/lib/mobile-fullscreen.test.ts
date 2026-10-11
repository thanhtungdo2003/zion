import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindMobileFullscreen } from './mobile-fullscreen';

afterEach(() => vi.unstubAllGlobals());

function setup(coarse = true) {
  const request = vi.fn().mockResolvedValue(undefined);
  const page = Object.assign(new EventTarget(), { documentElement: { requestFullscreen: request }, fullscreenElement: null });
  vi.stubGlobal('document', page);
  vi.stubGlobal('window', { matchMedia: () => ({ matches: coarse }) });
  vi.stubGlobal('Element', class {});
  const release = (pointerType = 'touch') => page.dispatchEvent(Object.assign(new Event('pointerup'), { pointerType }));
  return { request, page, release };
}

describe('mobile fullscreen', () => {
  it('waits for a touch and enters fullscreen once without forcing re-entry', async () => {
    const { request, page, release } = setup();
    const unbind = bindMobileFullscreen();
    expect(request).not.toHaveBeenCalled();
    release(); release();
    expect(request).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    page.dispatchEvent(new Event('fullscreenchange'));
    release();
    expect(request).toHaveBeenCalledTimes(1);
    unbind();
  });

  it.each([true, false])('ignores mouse interactions and fine pointers, coarse=%s', coarse => {
    const { request, release } = setup(coarse);
    const unbind = bindMobileFullscreen();
    release('mouse');
    if (!coarse) release();
    expect(request).not.toHaveBeenCalled();
    unbind();
  });

  it('retries a denied request and removes listeners on unmount', async () => {
    const { request, release } = setup();
    request.mockRejectedValueOnce(new Error('denied'));
    const unbind = bindMobileFullscreen();
    release();
    await new Promise(resolve => setTimeout(resolve, 0));
    release();
    expect(request).toHaveBeenCalledTimes(2);
    unbind();
    release();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('supports browsers with the prefixed fullscreen API', () => {
    const { request, page, release } = setup();
    Object.assign(page.documentElement, { requestFullscreen: undefined, webkitRequestFullscreen: request });
    const unbind = bindMobileFullscreen();
    release();
    expect(request).toHaveBeenCalledTimes(1);
    unbind();
  });
});
