import { describe, expect, it } from 'vitest';
import { DEFAULT_HAND_STUDIO, handEase, handKeysAt, handStudioSchema, type HandTrack } from '@zion/shared';
import { sampleClip, sampleHandPoint, samplePos, samplePose, sampleRot, sampleScale } from './hand-animation';
import { Vector3 } from 'three';

const track = (keys: HandTrack['keys'], kind: HandTrack['kind'] = 'handR'): HandTrack => ({ id: 't', kind, keys });

describe('hand studio animation sampling', () => {
  it('blends positions, sizes and clip progress between keys, holding before the first and after the last', () => {
    const tr = track([{ t: .2, ease: 'linear', pos: [0, 0, 0], scale: 1, clip: 0 }, { t: .6, ease: 'linear', pos: [1, 2, 0], scale: 2, clip: 1 }], 'gun');
    expect(samplePos(tr, 0)!.toArray()).toEqual([0, 0, 0]);
    samplePos(tr, .4)!.toArray().forEach((v, i) => expect(v).toBeCloseTo([.5, 1, 0][i]!));
    expect(samplePos(tr, 1)!.toArray()).toEqual([1, 2, 0]);
    expect(sampleScale(tr, .4)).toBeCloseTo(1.5);
    expect(sampleClip(tr, .3)).toBeCloseTo(.25);
  });

  it('opens a fist gradually: the second pose’s share grows with the eased time', () => {
    const tr = track([{ t: 0, ease: 'inOut', pose: 'fist' }, { t: 1, ease: 'inOut', pose: 'open' }]);
    const early = samplePose(tr, .2)!, mid = samplePose(tr, .5)!, late = samplePose(tr, .9)!;
    expect(early.a).toBe('fist'); expect(early.b).toBe('open');
    expect(early.u).toBeGreaterThan(0); expect(early.u).toBeLessThan(mid.u); expect(mid.u).toBeCloseTo(.5); expect(late.u).toBeGreaterThan(.9);
  });

  it('turns along the shortest arc and eases each segment by the key it arrives at', () => {
    const tr = track([{ t: 0, ease: 'linear', rot: [0, 0, 0] }, { t: 1, ease: 'linear', rot: [0, 90, 0] }]);
    const q = sampleRot(tr, .5)!;
    expect(2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI).toBeCloseTo(45, 3);
    expect(handEase('step', .99)).toBe(0); expect(handEase('in', .5)).toBeLessThan(.5); expect(handEase('out', .5)).toBeGreaterThan(.5);
  });

  it('places each key on its own part and blends the two places (a hand riding the charging handle)', () => {
    const parts: Record<string, Vector3> = { bolt: new Vector3(10, 0, 0) };
    const tr = track([{ t: 0, ease: 'linear', pos: [0, 0, 0] }, { t: 1, ease: 'linear', pos: [0, 1, 0], part: 'bolt' }]);
    const at = sampleHandPoint(tr, .5, (k) => (k.pos ? new Vector3(...k.pos).add(k.part ? parts[k.part]! : new Vector3()) : null))!;
    expect(at.toArray()).toEqual([5, .5, 0]);
  });

  it('keys out of order are sampled in time order; the default studio is valid', () => {
    expect(handKeysAt([{ t: .8, ease: 'linear' }, { t: .1, ease: 'linear' }], .5)!.a.t).toBe(.1);
    expect(handStudioSchema.safeParse(DEFAULT_HAND_STUDIO).success).toBe(true);
    expect(DEFAULT_HAND_STUDIO.poses.map((p) => p.id)).toEqual(['open', 'relaxed', 'ready', 'fist', 'pinch']);
  });
});
