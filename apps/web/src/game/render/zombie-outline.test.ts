import { describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, type WebGLRenderer } from 'three';
import { ZombieOutline } from './zombie-outline';

function setup(fail = false) {
  const scene = new Scene(), camera = new PerspectiveCamera(), zombie = new Group();
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial()); zombie.add(mesh); scene.add(zombie);
  scene.background = new Color(0x456789); camera.layers.enable(2);
  let target: unknown = null;
  const render = vi.fn((_scene: Scene) => {
    if (_scene === scene && camera.layers.mask === 1 << 30) {
      expect(mesh.layers.isEnabled(30)).toBe(true);
      if (fail) throw new Error('context lost');
    }
  });
  const renderer = {
    autoClear: false, shadowMap: { autoUpdate: true }, render,
    getDrawingBufferSize: (size: { set(x: number, y: number): void }) => size.set(800, 600),
    getPixelRatio: () => 1.75,
    getRenderTarget: () => target, setRenderTarget: (next: unknown) => { target = next; },
    getClearColor: (color: Color) => color.set(0x123456), getClearAlpha: () => .4, setClearColor: vi.fn(),
  };
  return { scene, camera, zombie, mesh, renderer, pass: new ZombieOutline() };
}

describe('occluded zombie outline rendering', () => {
  it('renders directly when no discovered living zombie is selected', () => {
    const { pass, renderer, scene, camera, mesh } = setup();
    pass.render(renderer as unknown as WebGLRenderer, scene, camera, []);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(mesh.layers.isEnabled(30)).toBe(false);
    pass.dispose(); mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose();
  });
  it.each([false, true])('restores camera, mesh, target, shadow and scene state after rendering (failure=%s)', fail => {
    const { pass, renderer, scene, camera, zombie, mesh } = setup(fail);
    const background = scene.background, layers = camera.layers.mask;
    const draw = () => pass.render(renderer as unknown as WebGLRenderer, scene, camera, [zombie]);
    if (fail) expect(draw).toThrow('context lost'); else { draw(); expect(renderer.render).toHaveBeenCalledTimes(3); }
    expect(scene.background).toBe(background); expect(scene.overrideMaterial).toBeNull();
    expect(camera.layers.mask).toBe(layers); expect(mesh.layers.isEnabled(30)).toBe(false);
    expect(renderer.getRenderTarget()).toBeNull(); expect(renderer.autoClear).toBe(false);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    pass.dispose(); mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose();
  });
});
