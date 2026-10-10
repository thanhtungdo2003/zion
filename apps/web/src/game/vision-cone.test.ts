import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene } from 'three';
import type { CollisionWorld } from '@zion/physics';
import { VisionCone } from './vision-cone';

afterEach(() => vi.restoreAllMocks());
describe('vision overlay frame cost', () => {
  it('casts the visual ray fan at 20 Hz and skips it completely in first person', () => {
    let time = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => time);
    const raycast = vi.fn(() => false);
    const vision = new VisionCone(new Scene());
    const camera = new PerspectiveCamera();
    const update = () => vision.update(0, 1.6, 0, 0, 0, 0, camera, 0, { raycast } as unknown as CollisionWorld);
    update();
    const fanSize = raycast.mock.calls.length;
    expect(fanSize).toBeGreaterThan(0);
    for (time = 1; time < 50; time++) update();
    expect(raycast).toHaveBeenCalledTimes(fanSize);
    time = 50; update();
    expect(raycast).toHaveBeenCalledTimes(fanSize * 2);
    vision.setOverlay(false);
    time = 100; update();
    expect(raycast).toHaveBeenCalledTimes(fanSize * 2);
    // Gameplay visibility queries still perform their own current collision test.
    vision.canSee(0, 1.6, -5, { raycast } as unknown as CollisionWorld);
    expect(raycast).toHaveBeenCalledTimes(fanSize * 2 + 1);
    vision.dispose();
  });
});
