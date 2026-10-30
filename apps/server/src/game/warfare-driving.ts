/**
 * How a bot drives (Warfare): steer for the next point, ease off for sharp turns and on arrival,
 * look ahead for obstacles and turn towards the side with more room, and back out when stuck.
 * Pure: the game server feeds it the vehicle and a probe of the world, it answers with the same
 * throttle / steer a player's keys give (+1 throttle forward, +1 steer right).
 */

export interface DriveMemory {
  /** Last place progress was seen, and when. */
  x: number;
  z: number;
  at: number;
  /** Backing out until then, steering this way. */
  reverseUntil: number;
  reverseSteer: number;
  /** Times it had to back out on this trip (too many: give up and walk). */
  reversals: number;
  /** A way round an obstacle it committed to (driven to before the target again). */
  detour: { x: number; z: number; until: number } | null;
}

export const newDriveMemory = (x: number, z: number, now: number): DriveMemory => ({ x, z, at: now, reverseUntil: 0, reverseSteer: 0, reversals: 0, detour: null });

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * One control step. `probe(angle, length)` answers how far the way is clear (m) along the vehicle's
 * heading turned by `angle` (radians, + = right).
 */
export function driveTowards(
  v: { x: number; z: number; yaw: number; speed: number },
  target: { x: number; z: number },
  now: number,
  mem: DriveMemory,
  probe: (angle: number, length: number) => number,
  arriveRadius = 8,
  /** Cruising speed on a clear straight (m/s). */
  maxSpeed = 20,
): { throttle: number; steer: number; arrived: boolean; stuck: boolean } {
  const dx = target.x - v.x, dz = target.z - v.z, d = Math.hypot(dx, dz);
  if (d < arriveRadius) return { throttle: v.speed > 1.5 ? -1 : 0, steer: 0, arrived: true, stuck: false };
  // Progress check: hardly moved for 3 s while trying → back out for a moment.
  // Rolling (a slow heavy vehicle swinging round counts) is progress; only standing still is stuck.
  if (Math.hypot(v.x - mem.x, v.z - mem.z) > 2.5 || Math.abs(v.speed) > 1.2) { mem.x = v.x; mem.z = v.z; mem.at = now; }
  else if (now - mem.at > 3000 && now > mem.reverseUntil) {
    mem.reverseUntil = now + 1800; mem.reversals++; mem.at = now;
    mem.reverseSteer = probe(-.6, 10) > probe(.6, 10) ? 1 : -1;
  }
  if (now < mem.reverseUntil) return { throttle: -1, steer: mem.reverseSteer, arrived: false, stuck: mem.reversals > 4 };
  const look = Math.min(18, 7 + Math.abs(v.speed) * 1.2);
  // Blocked ahead (or just backed out): commit to a way round, on the clearer side, for a while.
  const commit = (side: number) => {
    const yaw = v.yaw - side * 1.05, reach = 18;
    mem.detour = { x: v.x - Math.sin(yaw) * reach, z: v.z - Math.cos(yaw) * reach, until: now + 5000 };
  };
  if (mem.detour && (now > mem.detour.until || Math.hypot(mem.detour.x - v.x, mem.detour.z - v.z) < 4)) mem.detour = null;
  const ahead = probe(0, look);
  if (!mem.detour && (ahead < look * .8 || mem.reverseUntil > now - 300)) commit(probe(.9, 25) >= probe(-.9, 25) ? 1 : -1);
  const goal = mem.detour ?? target;
  // Heading error: the vehicle faces (−sin yaw, −cos yaw); a negative error is a right turn.
  const want = Math.atan2(-(goal.x - v.x), -(goal.z - v.z)), err = wrap(want - v.yaw);
  const steer = Math.max(-1, Math.min(1, -err * 1.6));
  // Speed it wants: slow for a turn, for something close ahead and for the stop at the end (each
  // a speed it can still brake from in time); the pedal then closes the gap to that speed.
  const e = Math.abs(err);
  const turn = e > 1.4 ? 4 : e > .8 ? 7 : e > .35 ? 12 : e > .15 ? 18 : maxSpeed;
  const room = Math.sqrt(2 * 6 * Math.max(0, ahead - 4)) + 2;
  const stop = Math.sqrt(2 * 4 * Math.max(0, d - arriveRadius)) + 2;
  const wantSpeed = Math.min(maxSpeed, turn, room, stop);
  const gap = wantSpeed - v.speed;
  const throttle = gap > 0 ? Math.max(.3, Math.min(1, gap / 4)) : Math.max(-1, gap / 3);
  return { throttle, steer, arrived: false, stuck: mem.reversals > 4 };
}
