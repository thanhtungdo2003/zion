import { describe, expect, it } from 'vitest';
import { structureOwner, vehicleOwner, type StructureState } from '@zion/shared';
import { CollisionWorld } from './world';
import { Heightfield } from './heightfield';
import { CharacterController, createCharacterState } from './character';
import { piecesOf, structureColliders } from './structures';

function flat(): CollisionWorld {
  const w = new CollisionWorld({ worldSize: 96, seaLevel: -50 });
  for (let cx = 0; cx < 3; cx++) for (let cz = 0; cz < 3; cz++) w.addChunk(cx, cz, new Heightfield(cx * 32, cz * 32, 1, 33, new Float32Array(33 * 33), new Float32Array(33 * 33).fill(NaN)), []);
  return w;
}

describe('structure walls', () => {
  it('keep their colliders apart from vehicles (a vehicle moving must not replace them)', () => {
    for (let id = 1; id < 200; id++) for (let v = 1; v < 200; v++) expect(structureOwner(id)).not.toBe(vehicleOwner(v));
  });

  it.each(['wood_outpost', 'stone_bunker', 'metal_fortress'])('%s: nobody walks through a wall from any side', (blueprint) => {
    for (const yaw of [0, .7, Math.PI / 2]) {
      const w = flat(), s: StructureState = { id: 1, blueprint, owner: 'a', ownerName: 'a', x: 48, y: 0, z: 48, yaw, hp: piecesOf(blueprint).map((p) => p.hp), open: [] } as unknown as StructureState;
      w.setOwnerColliders(structureOwner(s.id), structureColliders(s));
      const ctrl = new CharacterController(w);
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2, st = createCharacterState(48 + Math.sin(a) * 12, 0, 48 + Math.cos(a) * 12);
        // Walk straight at the centre for 6 s.
        for (let i = 0; i < 360; i++) ctrl.step(st, { mx: 0, mz: 1, yaw: a, jump: false, sprint: true }, 1 / 60);
        const d = Math.hypot(st.x - 48, st.z - 48);
        expect.soft(d, `${blueprint} yaw ${yaw} from ${k}`).toBeGreaterThan(3.2);
      }
    }
  });
});
