import { wrapAngle } from '@zion/shared';
import type { CharacterState } from '@zion/physics';
import { CAMP_HALF_SIZE, type CampSite } from '@zion/worldgen';
import { NavigationState, type ZombieNavigation, type NavPoint } from './navigation';
import type { MobIntent } from './mob-ai';

/** Random destinations across the camp, reached using collision-aware walking paths. */
export class CampPatrol {
  readonly navigation = new NavigationState();
  private goal: NavPoint | null = null;
  private chooseAt = 0;
  private expiresAt = 0;

  constructor(private readonly camp: CampSite, private readonly random: () => number = Math.random) {}

  think(state: CharacterState, yaw: number, now: number, dt: number, paths: ZombieNavigation): MobIntent {
    const idle = { mx: 0, mz: 0, yaw, aimed: false };
    if (this.goal && (Math.hypot(state.x - this.goal.x, state.z - this.goal.z) < .6 || now >= this.expiresAt)) {
      this.goal = null;
      paths.clear(this.navigation);
      this.chooseAt = now + 1000 + this.random() * 3000;
    }
    if (!this.goal && now >= this.chooseAt) {
      const radius = CAMP_HALF_SIZE - 3;
      for (let attempt = 0; attempt < 12; attempt++) {
        const x = this.camp.x + (this.random() * 2 - 1) * radius;
        const z = this.camp.z + (this.random() * 2 - 1) * radius;
        const goal = paths.map.trace({ x, y: this.camp.y + .02, z }, x, z);
        if (!goal) continue;
        this.goal = goal;
        this.expiresAt = now + 60_000;
        break;
      }
      this.chooseAt = now + 2000;
    }
    if (!this.goal) return idle;
    const next = paths.steer(this.navigation, state, this.goal, now);
    if (!next) {
      if (!this.navigation.search && !this.navigation.path.length) this.expiresAt = Math.min(this.expiresAt, now + 2000);
      return idle;
    }
    const dx = next.x - state.x, dz = next.z - state.z;
    const distance = Math.hypot(dx, dz);
    const face = Math.atan2(-dx, -dz);
    yaw = wrapAngle(yaw + Math.max(-3.9 * dt, Math.min(3.9 * dt, wrapAngle(face - yaw))));
    if (distance < .01 || Math.abs(wrapAngle(face - yaw)) > .6) return { ...idle, yaw };
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return { mx: (c * dx - s * dz) / distance, mz: (-s * dx - c * dz) / distance, yaw, aimed: false };
  }
}
