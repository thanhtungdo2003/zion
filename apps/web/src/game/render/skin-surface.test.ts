import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { bindGarment, SkinSurface } from './skin-surface';

function triangle(y = 0) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-.2, y, -.2, .2, y, -.2, 0, y, .2], 3));
  geometry.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute([1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0], 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  geometry.setIndex([0, 1, 2]); return geometry;
}

describe('garment skin binding', () => {
  it('finds a cloth surface inside a large triangle even when every vertex is far away', () => {
    const surface = new SkinSurface(triangle());
    const hit = surface.nearest(new Vector3(0, .01, 0), .035, new Vector3(0, 1, 0));
    expect(hit).not.toBeNull();
    expect(hit!.point.y).toBeCloseTo(0);
    hit!.weights.toArray().forEach((weight, i) => expect(weight).toBeCloseTo([.25, .25, .5][i]!));
    expect(surface.nearest(new Vector3(0, .01, 0), .035, new Vector3(0, -1, 0))).toBeNull();
  });

  it('transfers body weights by surface coordinates while preserving cloth shape and clearance', () => {
    const body = triangle(), cloth = triangle(.015);
    cloth.setAttribute('position', new Float32BufferAttribute([0, .015, 0], 3));
    cloth.setAttribute('normal', new Float32BufferAttribute([0, 1, 0], 3));
    cloth.setAttribute('skinIndex', new Uint16BufferAttribute([99, 0, 0, 0], 4));
    cloth.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0], 4));
    const before = Array.from(cloth.getAttribute('position').array);
    bindGarment(body, cloth);
    const joints = cloth.getAttribute('skinIndex'), weights = cloth.getAttribute('skinWeight');
    const result = new Map([0, 1, 2, 3].map(k => [joints.getComponent(0, k), weights.getComponent(0, k)]));
    expect(result.get(1)).toBeCloseTo(.25); expect(result.get(2)).toBeCloseTo(.25); expect(result.get(3)).toBeCloseTo(.5);
    expect(Array.from(cloth.getAttribute('position').array)).toEqual(before);
  });
});
