import { describe, expect, it, vi } from 'vitest';
import { EntityFlags, EntityKind } from '@zion/shared';
import { GameEngine } from './engine';
import { settingsStore, type CameraMode } from '@/lib/settings';
import { PerspectiveCamera } from 'three';

describe('footsteps while driving', () => {
  it('stops local and remote footsteps on boarding and resumes walking after exit', () => {
    const sounds = { loopAt: vi.fn(), stopLoop: vi.fn() };
    const localKey = {}, remoteKey = { x: 0, z: 0, speed: 4 };
    const local = { riding: false, dead: false, lastButtons: 0, state: { x: 0, y: 0, z: 0, vx: 4, vz: 0, grounded: true } };
    const remote = { entity: { kind: EntityKind.Player, pose: { flags: EntityFlags.Grounded } }, avatar: { root: { position: { x: 1, y: 0, z: 0 } } } };
    let remoteRiding = false;
    const engine = Object.assign(Object.create(GameEngine.prototype), {
      sounds, local, localStepKey: localKey,
      remotes: new Map([[2, remote]]), stepKeys: new Map([[2, remoteKey]]),
      vehicles: { rider: () => remoteRiding ? {} : undefined },
    }) as { updateFootsteps(dt: number): void };
    engine.updateFootsteps(.1);
    expect(sounds.loopAt).toHaveBeenCalledTimes(2);
    local.riding = remoteRiding = true;
    sounds.loopAt.mockClear(); sounds.stopLoop.mockClear();
    local.state.vx = 30; remote.avatar.root.position.x = 10;
    engine.updateFootsteps(.1);
    expect(sounds.loopAt).not.toHaveBeenCalled();
    expect(sounds.stopLoop).toHaveBeenCalledWith(localKey);
    expect(sounds.stopLoop).toHaveBeenCalledWith(remoteKey);
    expect(remoteKey.speed).toBe(0);
    local.riding = remoteRiding = false;
    local.state.vx = 4; remote.avatar.root.position.x += .4;
    engine.updateFootsteps(.1);
    expect(sounds.loopAt).toHaveBeenCalledTimes(2);
  });
});

describe('camera mode while driving', () => {
  it.each(['first-person', 'third-person', 'top-down'] as CameraMode[])('restores %s after leaving a vehicle without overwriting the preference', mode => {
    const saved = { ...settingsStore.get(), cameraMode: mode };
    const get = vi.spyOn(settingsStore, 'get').mockReturnValue(saved);
    const set = vi.spyOn(settingsStore, 'set');
    try {
      const local = { riding: true, dead: false };
      const engine = Object.assign(Object.create(GameEngine.prototype), {
        local, cameraMode: mode, camera: new PerspectiveCamera(), viewModel: {},
        input: { yaw: 0, pitch: 0, setTouchEnabled: vi.fn(), setMouseLook: vi.fn() },
        renderer: {}, hud: { get: () => ({ downed: null }) },
        targetVisibility: { clear: vi.fn() }, recoil: { reset: vi.fn() },
        thirdPersonCamera: { reset: vi.fn() },
      }) as { applyViewMode(): void; cameraMode: CameraMode };
      engine.applyViewMode(); expect(engine.cameraMode).toBe('third-person');
      local.riding = false;
      engine.applyViewMode(); expect(engine.cameraMode).toBe(mode);
      expect(saved.cameraMode).toBe(mode); expect(set).not.toHaveBeenCalled();
    } finally { get.mockRestore(); set.mockRestore(); }
  });
});
