import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, type WebGLRenderer } from 'three';
import type * as Three from 'three';
import { CharacterPreview } from './character-preview';

const renderers = vi.hoisted(() => [] as WebGLRenderer[]);
vi.mock('three', async (original) => {
  const actual = await original<typeof Three>();
  return { ...actual, WebGLRenderer: class {
    domElement = { addEventListener: vi.fn(), removeEventListener: vi.fn(), remove: vi.fn() };
    setPixelRatio = vi.fn(); setClearColor = vi.fn(); setSize = vi.fn();
    dispose = vi.fn(); forceContextLoss = vi.fn();
    constructor() { renderers.push(this as unknown as WebGLRenderer); }
  } };
});
vi.mock('./armor-models', () => ({ requestArmor: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); renderers.length = 0; });

describe('inventory preview contexts', () => {
  it('releases every WebGL context over repeated mounts, including engine disposal while open', () => {
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    let nextFrame = 0;
    const frames = new Set<number>();
    vi.stubGlobal('requestAnimationFrame', () => { frames.add(++nextFrame); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const host = { clientWidth: 200, clientHeight: 300, appendChild: vi.fn() } as unknown as HTMLElement;
    const preview = new CharacterPreview({ root: new Group(), boneNames: [], clips: new Map() });
    for (let i = 0; i < 100; i++) {
      const unmount = preview.mount(host);
      unmount(); unmount();
      expect(frames.size).toBe(0);
    }
    const unmount = preview.mount(host);
    preview.dispose(); unmount(); preview.dispose();
    expect(frames.size).toBe(0);
    for (const renderer of renderers) {
      expect(renderer.dispose).toHaveBeenCalledOnce();
      expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
    }
    preview.mount(host);
    expect(renderers).toHaveLength(101);
  });
});
