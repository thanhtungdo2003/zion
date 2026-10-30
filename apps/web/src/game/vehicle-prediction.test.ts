import { beforeAll, describe, expect, it } from 'vitest';
import { TICK_DT, VEHICLES, createVehicleMotion, type VehicleState } from '@zion/shared';
import { CollisionWorld, Heightfield, JoltVehicles, Layer, loadJolt, makeBox } from '@zion/physics';
import { VehiclePredictor } from './vehicle-prediction';

beforeAll(() => loadJolt());

function world(): CollisionWorld {
  const w = new CollisionWorld({ worldSize: 192, seaLevel: 0 });
  for (let x = 0; x < 6; x++) for (let z = 0; z < 6; z++) w.addChunk(x, z, new Heightfield(x * 32, z * 32, 1, 33, new Float32Array(1089).fill(30), new Float32Array(1089).fill(NaN)), []);
  return w;
}
const car = (): VehicleState => ({ id: 1, kind: 'jeep', x: 96, y: 30, z: 170, yaw: 0, speed: 0, health: VEHICLES.jeep.health, driver: 1, explodeAt: 0, exploded: false, motion: createVehicleMotion('jeep') });
const copy = (v: VehicleState): VehicleState => structuredClone(v);

/**
 * A server and a client joined by a link `latency` ticks each way: the client sends one input per
 * tick, the server applies one per tick and sends back its state with the last input it applied.
 */
function link(w: CollisionWorld, latency: number, wall = false) {
  if (wall) w.setOwnerColliders(77, [{ shape: makeBox(96, 32, 120, 6, 4, .3), layer: Layer.Static }]);
  const serverCar = car(), server = new JoltVehicles(w), client = new VehiclePredictor(w);
  server.add(serverCar);
  const up: Array<{ at: number; seq: number; throttle: number }> = [], down: Array<{ at: number; state: VehicleState; ack: number }> = [];
  let tick = 0, ack = 0, held = 0;
  expect(client.follow(copy(serverCar))).toBe(true);
  const predicted: number[] = [], authoritative: number[] = [];
  return {
    client, serverCar, server, predicted, authoritative,
    run(ticks: number, throttle: number, poke?: (tick: number) => void) {
      for (let i = 0; i < ticks; i++, tick++) {
        const seq = tick + 1, now = tick * TICK_DT * 1000;
        client.step(seq, throttle, 0, now);
        up.push({ at: tick + latency, seq, throttle });
        // Server: one input per tick once it has arrived.
        const input = up[0] && up[0].at <= tick ? up.shift()! : null;
        // Like the server: the last control received stays applied until the next arrives.
        if (input) { ack = input.seq; held = input.throttle; }
        poke?.(tick);
        server.step([serverCar], () => ({ throttle: held, steer: 0 }), TICK_DT, now);
        down.push({ at: tick + latency, state: copy(serverCar), ack });
        while (down[0] && down[0].at <= tick) { const d = down.shift()!; client.reconcile(d.state, d.ack, now); }
        predicted.push(client.pose(1, TICK_DT)!.z); authoritative.push(serverCar.z);
      }
    },
    dispose() { client.stop(); server.dispose(); },
  };
}

describe('vehicle prediction', () => {
  it('drives at once and agrees with the server it trails, with almost no corrections', () => {
    const l = link(world(), 4);
    try {
      l.run(5, 1);
      // Five ticks in, the server has not seen a single input yet, but we are already rolling.
      expect(l.predicted.at(-1)!).toBeLessThan(l.authoritative.at(-1)! - .01);
      l.run(90, 1);
      expect(l.client.stats.error).toBeLessThan(.05);
      // The odd small correction (the server's wheels and engine are not sent), each eased out.
      expect(l.client.stats.reconciles).toBeLessThan(20);
    } finally { l.dispose(); }
  });

  it('hits a wall on this screen without waiting for the server, and the server agrees', () => {
    const l = link(world(), 5, true);
    try {
      let hitAt = -1;
      l.run(150, 1, () => { if (hitAt < 0 && l.predicted.length > 2 && l.predicted.at(-1)! - l.predicted.at(-2)! > -.05 && l.predicted.at(-1)! < 135) hitAt = l.predicted.length; });
      // The predicted car stopped at the wall (z 120.3 + half its length) and never went through.
      expect(Math.min(...l.predicted)).toBeGreaterThan(120);
      expect(Math.min(...l.authoritative)).toBeGreaterThan(120);
      // The client met the wall before the server did (the server runs `latency` ticks behind).
      const firstStop = (zs: number[]) => zs.findIndex((z, i) => i > 10 && zs[i - 1]! - z < .05 && z < 135);
      expect(firstStop(l.predicted)).toBeLessThan(firstStop(l.authoritative));
      // Our prediction runs `latency` ticks ahead of the server's; where they overlap they agree.
      expect(l.client.stats.error).toBeLessThan(.1);
    } finally { l.dispose(); }
  });

  it('converges smoothly when the server decides otherwise (a shove it alone knew of)', () => {
    const l = link(world(), 3);
    try {
      l.run(30, 1);
      // The server's car is thrown sideways (another vehicle, a blast): the prediction follows
      // in eased steps, never a snap on screen.
      l.run(60, 1, (t) => { if (t === 40) { l.serverCar.x += 1.5; } });
      const xs: number[] = [];
      l.run(1, 1);
      for (let i = 0; i < 20; i++) { l.run(1, 1); xs.push(l.client.pose(1, TICK_DT)!.x); }
      expect(Math.abs(xs.at(-1)! - l.serverCar.x)).toBeLessThan(.2);
      expect(l.client.stats.reconciles).toBeGreaterThan(0);
    } finally { l.dispose(); }
  });
});
