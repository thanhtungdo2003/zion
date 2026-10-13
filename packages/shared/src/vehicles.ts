export type VehicleKind = 'car' | 'jeep' | 'quad' | 'grizzly';
export interface VehicleState {
  id: number; kind: VehicleKind; x: number; y: number; z: number; yaw: number;
  speed: number; health: number; driver: number | null; explodeAt: number; exploded: boolean;
  motion?: VehicleMotion;
  /** Authoritative controls and physical contact events, separate from bullet/blast damage. */
  braking?: boolean;
  impact?: { time: number; speed: number };
}
export interface VehicleMotion {
  pitch: number; roll: number; vy: number; pitchVelocity: number; rollVelocity: number;
  grounded: boolean; steer: number;
  /** Local sideways velocity (+X, metres/s) and yaw angular velocity (rad/s): tyre slip and spin. */
  lateral?: number; yawVelocity?: number;
  /** Actual spring lengths, front left/right then rear left/right. */
  suspension: [number, number, number, number];
}
export const VEHICLES = {
  // `scale` enlarges the prepared model; every physical dimension below is already scaled.
  // mass (kg) and grip (tyre friction coefficient) drive inertia, braking and slides.
  car: { asset: 2300, name: 'Lada 2109', maxSpeed: 34, acceleration: 7, turn: .65, health: 600, halfX: .96, halfZ: 2.58, seat: [-.42, -.04, -.22], quad: false, com: .62, height: 1.79, wheelX: .844, frontZ: -1.566, rearZ: 1.606, wheelRadius: .377, spring: .24, scale: 1.2, mass: 1050, grip: 1.05, step: .45 },
  jeep: { asset: 2301, name: 'Jeep', maxSpeed: 30, acceleration: 8, turn: .75, health: 850, halfX: 1.4, halfZ: 2.1, seat: [-.44, .59, .37], quad: false, com: .8, height: 2.35, wheelX: 1.11, frontZ: -1.27, rearZ: 1.27, wheelRadius: .542, spring: .3, scale: 1, mass: 1600, grip: 1.1, step: .6 },
  quad: { asset: 2302, name: 'Quad bike', maxSpeed: 27, acceleration: 9, turn: 1, health: 320, halfX: .75, halfZ: 1.15, seat: [0, .14, .16], quad: true, com: .55, height: 1.3, wheelX: .577, frontZ: -.743, rearZ: .784, wheelRadius: .357, spring: .26, scale: 1, mass: 330, grip: 1, step: .4 },
  grizzly: { asset: 2303, name: 'Grizzly 700', maxSpeed: 29, acceleration: 9, turn: .95, health: 380, halfX: .8, halfZ: 1.2, seat: [0, .28, .12], quad: true, com: .6, height: 1.51, wheelX: .626, frontZ: -.852, rearZ: .748, wheelRadius: .362, spring: .28, scale: 1, mass: 380, grip: 1, step: .42 },
} as const;
export const VEHICLE_EXPLODE_DELAY = 2000;
export const VEHICLE_REACH = 3.6;
export const vehicleOwner = (id: number): number => 0xc0000000 + id;
export function vehicleSeat(v: VehicleState): { x: number; y: number; z: number } {
  const [x,y,z]=VEHICLES[v.kind].seat;
  return vehiclePoint(v,x,y,z);
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
export interface VehiclesMessage { t: 'vehicles'; time: number; vehicles: VehicleState[] }
