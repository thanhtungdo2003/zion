import { describe, expect, it } from 'vitest';
import { BoxGeometry, MeshStandardMaterial, Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GlassBreaker, prepareGlass } from './glass';
import type { AssetVisual } from './asset-library';

/** A wall model with two window panes (thin boxes) 3 m apart, and its placements. */
function scene() {
  const glass = new MeshStandardMaterial({ name: 'Glass', transparent: true, opacity: .3 });
  const wall = new MeshStandardMaterial({ name: 'wall_panel' });
  const panes = mergeGeometries([new BoxGeometry(1.2, 1.2, .02).translate(-1.5, 1.5, 0), new BoxGeometry(1.2, 1.2, .02).translate(1.5, 1.5, 0)])!;
  const visual = { def: { category: 'structure', tags: [] }, parts: [{ geometry: panes, material: glass }, { geometry: new BoxGeometry(6, 3, .3).translate(0, 1.5, 1), material: wall }] } as unknown as AssetVisual;
  prepareGlass(4242, visual);
  // One placement at (100, 0, 200), turned a quarter, scale 1.
  const m = new Float32Array(16), c = Math.cos(Math.PI / 2), s = Math.sin(Math.PI / 2);
  m.set([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 100, 0, 200, 1]);
  const breaker = new GlassBreaker(new Scene(), (visit) => visit(4242, m, 1), () => 0, () => {});
  return { visual, breaker, panes };
}

describe('window glass', () => {
  it('finds each pane of a model, and only its glass', () => {
    const { panes } = scene();
    expect(panes.getAttribute('aPane')).toBeTruthy();
  });

  it('a shot breaks the pane it goes through, once; a blast breaks the panes round it', () => {
    const { breaker } = scene();
    // Turned a quarter: the pane at local x = −1.5 stands at world z = 200 + 1.5, facing ±x.
    const hits = breaker.raycast(90, 1.5, 201.5, 1, 0, 0, 30);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.key).toBe('10000,150,20150');
    expect(breaker.shatter(hits[0]!, { x: 1, y: 0, z: 0, speed: 5 })).toBe(true);
    expect(breaker.raycast(90, 1.5, 201.5, 1, 0, 0, 30)).toHaveLength(0);
    // Short of the window: nothing.
    expect(breaker.raycast(90, 1.5, 198.5, 1, 0, 0, 5)).toHaveLength(0);
    expect(breaker.near(100, 1.5, 198.5, 2).map((h) => h.key)).toEqual(['10000,150,19850']);
    breaker.update(.1, 100, 200);
  });

  it('applies panes broken elsewhere, and puts them back on repair', () => {
    const { breaker } = scene();
    breaker.apply([10000, 150, 20150], true);
    expect(breaker.isBroken('10000,150,20150')).toBe(true);
    breaker.repair([10000, 150, 20150]);
    expect(breaker.isBroken('10000,150,20150')).toBe(false);
  });
});
