import type { VehicleArmsState } from './vehicle-arms';
import type { VehiclePart } from './vehicle-parts';
import { seatPosition } from './vehicle-seats';
export type VehicleKind = 'car' | 'jeep' | 'quad' | 'grizzly' | 't80u' | 't90a' | 't62a' | 'tank' | 'marauder' | 'mi17' | 'z10' | 'tiger';
export interface VehicleState {
  id: number; kind: VehicleKind; x: number; y: number; z: number; yaw: number;
  speed: number; health: number; driver: number | null; explodeAt: number; exploded: boolean;
  /** Passengers by seat (seat i + 1; 0 = empty). Only teammates of the occupants may board. */
  passengers?: number[];
  motion?: VehicleMotion;
  /** Authoritative controls and physical contact events, separate from bullet/blast damage. */
  braking?: boolean;
  /** Driver's forward/reverse control, independent of ground contact and chassis speed. */
  throttle?: number;
  impact?: { time: number; speed: number };
  /** Flat tyres, bit i = wheel i (0 front-left, 1 front-right, 2 rear-left, 3 rear-right). */
  flats?: number;
  /** Helicopters: rotor speed, 0 (stopped) … 1 (flight rpm). */
  rotor?: number;
  /** Armed vehicles: ammunition per weapon and countermeasures. */
  arms?: VehicleArmsState;
  /** Turned weapon mounts (see vehicle-mounts): [yaw, pitch] per seat, yaw relative to the hull. */
  aim?: number[];
  /** Damaged components, health 0…1 (see vehicle-parts; missing = intact). */
  parts?: Partial<Record<VehiclePart, number>>;
}
export interface VehicleMotion {
  pitch: number; roll: number; vy: number; pitchVelocity: number; rollVelocity: number;
  grounded: boolean; steer: number;
  /** Local sideways velocity (+X, metres/s) and yaw angular velocity (rad/s): tyre slip and spin. */
  lateral?: number; yawVelocity?: number;
  /** Actual spring lengths, front left/right then rear left/right. */
  suspension: [number, number, number, number];
  /** Helicopters: the collective lever, 0 (down) … 1 (full). */
  collective?: number;
}
export const VEHICLES = {
  // `scale` enlarges the prepared model; every physical dimension below is already scaled.
  // Seat heights are the rider's origin seated on the model's cushion (see seat-fit in the web app).
  // mass (kg) and grip (tyre friction coefficient) drive inertia, braking and slides.
  car: { asset: 2300, name: 'Lada 2109', maxSpeed: 34, acceleration: 7, turn: .65, health: 600, halfX: .96, halfZ: 2.58, seat: [-.42, .51, -.22], seats: [[-.42, .51, -.22], [.42, .51, -.22], [-.42, .51, .66], [.42, .51, .66]], quad: false, com: .62, height: 1.79, wheelX: .844, frontZ: -1.566, rearZ: 1.606, wheelRadius: .377, spring: .24, scale: 1.2, mass: 1050, grip: 1.05, step: .45 },
  jeep: { asset: 2301, name: 'Willys MB', maxSpeed: 30, acceleration: 8, turn: .75, health: 850, halfX: 1.2, halfZ: 2.52, seat: [-.45, .64, .33], seats: [[-.45, .64, .33], [.45, .64, .33], [-.45, .82, 1.58], [.45, .82, 1.58]], quad: false, com: .9, height: 2.39, wheelX: .915, frontZ: -1.725, rearZ: 1.335, wheelRadius: .525, spring: .3, scale: 1.5, mass: 1500, grip: 1.1, step: .6 },
  quad: { asset: 2302, name: 'Quad bike', maxSpeed: 27, acceleration: 9, turn: 1, health: 320, halfX: .75, halfZ: 1.15, seat: [0, .31, .16], seats: [[0, .31, .16], [0, .38, .6]], quad: true, com: .55, height: 1.3, wheelX: .577, frontZ: -.743, rearZ: .784, wheelRadius: .357, spring: .26, scale: 1, mass: 330, grip: 1, step: .4 },
  grizzly: { asset: 2303, name: 'Grizzly 700', maxSpeed: 29, acceleration: 9, turn: .95, health: 380, halfX: .8, halfZ: 1.2, seat: [0, .56, .12], seats: [[0, .56, .12], [0, .54, .56]], quad: true, com: .6, height: 1.51, wheelX: .626, frontZ: -.852, rearZ: .748, wheelRadius: .362, spring: .28, scale: 1, mass: 380, grip: 1, step: .42 },
  // Warfare armour: tracked hulls driven as heavy, wide, grippy chassis (wheels stand in for the
  // tracks); the main gun and machine guns are in VEHICLE_ROLES. Prepared at true scale (scale 1).
  t80u: { asset: 2304, name: 'T-80U', maxSpeed: 17, acceleration: 4.5, turn: .55, health: 3400, halfX: 1.84, halfZ: 3.5, seat: [-.4, .9, .2], seats: [[-.4, .9, .2], [.95, 1.2, .25]], quad: false, com: 1.0, height: 2.35, wheelX: 1.4, frontZ: -2.6, rearZ: 2.6, wheelRadius: .42, spring: .3, scale: 1, mass: 12000, grip: 1.45, step: .8 },
  t90a: { asset: 2305, name: 'T-90A', maxSpeed: 17, acceleration: 4.5, turn: .55, health: 3600, halfX: 1.84, halfZ: 3.3, seat: [-.4, .9, .3], seats: [[-.4, .9, .3], [.6, 1.3, .7]], quad: false, com: 1.0, height: 2.3, wheelX: 1.4, frontZ: -2.5, rearZ: 2.5, wheelRadius: .42, spring: .3, scale: 1, mass: 12000, grip: 1.45, step: .8 },
  t62a: { asset: 2306, name: 'T-62A', maxSpeed: 14, acceleration: 3.8, turn: .5, health: 2900, halfX: 1.66, halfZ: 3.3, seat: [-.4, .95, .3], seats: [[-.4, .95, .3], [.6, 1.45, .2]], quad: false, com: 1.1, height: 2.4, wheelX: 1.25, frontZ: -2.5, rearZ: 2.5, wheelRadius: .45, spring: .3, scale: 1, mass: 11000, grip: 1.4, step: .8 },
  tank: { asset: 2307, name: 'Xe tăng chủ lực', maxSpeed: 16, acceleration: 4.2, turn: .52, health: 3200, halfX: 2.0, halfZ: 3.7, seat: [-.45, .95, .5], seats: [[-.45, .95, .5], [.55, 1.35, .95]], quad: false, com: 1.05, height: 2.5, wheelX: 1.5, frontZ: -2.8, rearZ: 2.8, wheelRadius: .45, spring: .3, scale: 1, mass: 12000, grip: 1.45, step: .8 },
  marauder: { asset: 2308, name: 'Paramount Marauder', maxSpeed: 26, acceleration: 5, turn: .6, health: 2200, halfX: 1.6, halfZ: 4.0, seat: [-.6, .84, -1.6], seats: [[-.6, .84, -1.6], [0, 2.2, 1.45], [-.6, .84, -.4], [.6, .84, -.4], [-.6, .84, .5], [.6, .84, .5], [-.6, .84, 1.4], [.6, .84, 1.4], [-.6, .84, 2.3], [.6, .84, 2.3]], quad: false, com: 1.1, height: 3.2, wheelX: 1.25, frontZ: -2.6, rearZ: 2.6, wheelRadius: .62, spring: .35, scale: 1, mass: 14000, grip: 1.2, step: .8 },
  // Helicopters are rigid bodies flown by rotor forces (helicopter-flight, physics heli-flight).
  mi17: { asset: 2309, name: 'Mi-17', maxSpeed: 55, acceleration: 6, turn: .9, health: 2000, halfX: 1.4, halfZ: 7.5, seat: [-.5, .91, -3.5], seats: [[-.5, .91, -3.5], [-1.15, 1.3, -4.4], [1.15, 1.3, -4.4], [-.7, .9, -3.2], [.7, .9, -3.2], [-.7, .9, -2.2], [.7, .9, -2.2], [-.7, .9, -1.2], [.7, .9, -1.2], [-.7, .9, -.2], [.7, .9, -.2], [-.7, .9, .8], [.7, .9, .8], [-.7, .9, 1.8], [.7, .9, 1.8]], quad: false, com: 2.0, height: 4.4, wheelX: 1.4, frontZ: -4.3, rearZ: .9, wheelRadius: .4, spring: .3, scale: 1, mass: 11000, grip: 1, step: .8 },
  z10: { asset: 2310, name: 'Z-10', maxSpeed: 62, acceleration: 7, turn: 1.1, health: 1500, halfX: 1.0, halfZ: 5.5, seat: [0, .49, -2.1], seats: [[0, .49, -2.1], [0, .14, -3.5]], quad: false, com: 1.5, height: 3.0, wheelX: 1.2, frontZ: -2.6, rearZ: 4.8, wheelRadius: .3, spring: .25, scale: 1, mass: 6000, grip: 1, step: .6 },
  tiger: { asset: 2311, name: 'PAH-2 Tiger', maxSpeed: 60, acceleration: 7, turn: 1.1, health: 1500, halfX: 1.0, halfZ: 5.2, seat: [0, .91, -2.3], seats: [[0, .91, -2.3], [0, .55, -3.6]], quad: false, com: 1.5, height: 3.2, wheelX: 1.1, frontZ: -2.5, rearZ: 4.9, wheelRadius: .3, spring: .25, scale: 1, mass: 6000, grip: 1, step: .6 },
} as const;
export const VEHICLE_EXPLODE_DELAY = 2000;
/** Close enough to get in: within `margin` m of the hull's footprint (long vehicles count their length). */
export function vehicleInReach(v: VehicleState, x: number, z: number, margin = VEHICLE_REACH - 1.2): boolean {
  const d = VEHICLES[v.kind], dx = x - v.x, dz = z - v.z, c = Math.cos(v.yaw), s = Math.sin(v.yaw);
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  return Math.abs(lx) <= d.halfX + margin && Math.abs(lz) <= d.halfZ + margin;
}
export const VEHICLE_REACH = 3.6;
export const vehicleOwner = (id: number): number => 0xc0000000 + id;
/** World position of a seat (0 = driver, then the passenger seats). */
export function vehicleSeat(v: VehicleState, index = 0): { x: number; y: number; z: number } {
  const [x,y,z]=seatPosition(v.kind,index);
  return vehiclePoint(v,x,y,z);
}
/** Seat of a player in this vehicle: 0 driving, 1… a passenger seat, −1 not aboard. */
export function vehicleSeatOf(v: VehicleState, id: number): number {
  if (v.driver === id) return 0;
  const i = v.passengers?.indexOf(id) ?? -1;
  return i >= 0 ? i + 1 : -1;
}
/** Everyone aboard (driver first). */
export function vehicleOccupants(v: VehicleState): number[] {
  return [...(v.driver ? [v.driver] : []), ...(v.passengers ?? []).filter((id) => id)];
}
/** First empty seat (0 = driver's), or −1 when full. */
export function vehicleFreeSeat(v: VehicleState): number {
  if (!v.driver) return 0;
  const seats = VEHICLES[v.kind].seats.length;
  for (let i = 1; i < seats; i++) if (!v.passengers?.[i - 1]) return i;
  return -1;
}
/** Column-major YXZ frame, shared by suspension, collision, riders and graphics. */
export function vehicleBasis(v: VehicleState): readonly number[] {
  const cy=Math.cos(v.yaw),sy=Math.sin(v.yaw),cx=Math.cos(v.motion?.pitch??0),sx=Math.sin(v.motion?.pitch??0),cz=Math.cos(v.motion?.roll??0),sz=Math.sin(v.motion?.roll??0);
  return [cy*cz+sy*sx*sz,cx*sz,-sy*cz+cy*sx*sz,-cy*sz+sy*sx*cz,cx*cz,sy*sz+cy*sx*cz,sy*cx,-sx,cy*cx];
}
export function vehiclePoint(v: VehicleState, x: number, y: number, z: number): {x:number;y:number;z:number} {
  const b=vehicleBasis(v),com=VEHICLES[v.kind].com; y-=com;
  return {x:v.x+b[0]!*x+b[3]!*y+b[6]!*z,y:v.y+com+b[1]!*x+b[4]!*y+b[7]!*z,z:v.z+b[2]!*x+b[5]!*y+b[8]!*z};
}
export function vehicleLocalPoint(v: VehicleState, x: number, y: number, z: number): {x:number;y:number;z:number} {
  const b=vehicleBasis(v),com=VEHICLES[v.kind].com; x-=v.x;y-=v.y+com;z-=v.z;
  return {x:b[0]!*x+b[1]!*y+b[2]!*z,y:com+b[3]!*x+b[4]!*y+b[5]!*z,z:b[6]!*x+b[7]!*y+b[8]!*z};
}
export function createVehicleMotion(kind: VehicleKind): VehicleMotion {
  const length=VEHICLES[kind].spring;
  return {pitch:0,roll:0,vy:0,pitchVelocity:0,rollVelocity:0,grounded:false,steer:0,suspension:[length,length,length,length],lateral:0,yawVelocity:0};
}
/**
 * Vehicle snapshot. `ack`: to a driver, the last of their inputs the server has applied to the
 * vehicle (one per tick), so their client can replay the inputs after it (reconciliation).
 */
export interface VehiclesMessage {
  t: 'vehicles'; time: number; ack?: number;
  /** Every vehicle in the recipient's interest; `vehicles` holds only those whose state changed. */
  ids?: number[];
  vehicles: VehicleState[];
}

/** Wheel centre in vehicle-local metres (+X right, −Z forward). */
export function wheelCentre(kind: VehicleKind, i: number): { x: number; y: number; z: number } {
  const d = VEHICLES[kind];
  return { x: i % 2 === 0 ? -d.wheelX : d.wheelX, y: d.wheelRadius, z: i < 2 ? d.frontZ : d.rearZ };
}
/** The wheel a hit at world (x, y, z) lands on, or −1. */
export function wheelAt(v: VehicleState, x: number, y: number, z: number): number {
  const p = vehicleLocalPoint(v, x, y, z), r = VEHICLES[v.kind].wheelRadius + .14;
  for (let i = 0; i < 4; i++) { const c = wheelCentre(v.kind, i); if (Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z) < r) return i; }
  return -1;
}
/**
 * How flat tyres change the handling: less steering (front ones most), less power and top
 * speed, the body sitting low on the flat side and dragged towards it. All four: barely drivable.
 */
export function tyreHandling(v: VehicleState): { count: number; steer: number; power: number; top: number; lean: number; pitch: number; drop: number } {
  const f = v.flats ?? 0, bit = (i: number) => (f >> i) & 1;
  const front = bit(0) + bit(1), rear = bit(2) + bit(3), left = bit(0) + bit(2), right = bit(1) + bit(3), count = front + rear;
  return {
    count,
    steer: Math.max(.18, 1 - .3 * front - .12 * rear - (count === 4 ? .2 : 0)),
    power: 1 - .15 * count,
    top: 1 - .14 * count,
    // Roll (+ = right side down) and pitch (+ = nose down), radians; how far the body sinks.
    lean: (right - left) * .045,
    pitch: (front - rear) * .03,
    drop: count * .035 * VEHICLES[v.kind].wheelRadius / .4,
  };
}
