import { describe, expect, it, vi } from 'vitest';
import { CollisionWorld, Heightfield, damageVehicle, Layer, makeBox, makeRayHit, Mask, raycastRig, SEATED_RIG, stepVehicle, vehicleColliders, createCharacterState } from '@zion/physics';
import { VEHICLES, vehicleOwner, type VehicleState } from '@zion/shared';
import type { WorldGenerator } from '@zion/worldgen';
import { Vehicles } from './vehicles';
import { GameServer } from './game-server';
import type { ClientSession } from './session';
import type { Player } from './player';

function world(seaLevel=20,waterLevel=NaN) {
  const w = new CollisionWorld({worldSize:96,seaLevel});
  for(let x=0;x<3;x++)for(let z=0;z<3;z++)w.addChunk(x,z,new Heightfield(x*32,z*32,1,33,new Float32Array(1089).fill(30),new Float32Array(1089).fill(waterLevel)),[]);
  return w;
}
function vehicle():VehicleState{return {id:1,kind:'car',x:48,y:30,z:48,yaw:0,speed:0,health:600,driver:null,explodeAt:0,exploded:false};}
function player(id=1):Player{return {id,vehicleId:0,state:createCharacterState(48,30,51.2),yaw:0,inputs:[],history:{clear:vi.fn()},session:{sendJson:vi.fn()}} as unknown as Player;}
function system(w:CollisionWorld){return new Vehicles(w,{config:{mode:'survival'},roads:null} as unknown as WorldGenerator);}

describe('authoritative vehicles',()=>{
  it('replicates forward/reverse input in the air and clears it when controls expire',()=>{
    const w=world(),s=system(w),v=vehicle(),a=player();
    s.states.set(v.id,v);s.toggle(a,v.id,1000);
    v.y=100;
    const players=new Map([[a.id,a]]);
    try{
      for(const throttle of [1,-1]){
        s.control(a,throttle,0,1100);
        s.step(1100,1/30,players,vi.fn(),vi.fn());
        expect(v.motion!.grounded).toBe(false);
        expect(v.throttle).toBe(throttle);
      }
      s.step(1400,1/30,players,vi.fn(),vi.fn());
      expect(v.throttle).toBe(0);
    }finally{s.dispose();}
  });
  it('damages the actual chassis only for strong bullets, and still takes blast damage',()=>{
    const s=system(world()),v=vehicle();s.states.set(v.id,v);
    s.hitAt(v.x,v.y+.4,v.z,12,1000,50001);expect(v.health).toBe(600);
    s.hitAt(v.x,v.y+.4,v.z,60,1000,0);expect(v.health).toBe(600);
    s.hitAt(v.x,v.y+.4,v.z,60,1000,50001);expect(v.health).toBe(564);
    s.blast(v.x,v.y+.6,v.z,5,100,2000);expect(v.health).toBe(464);
  });
  it.each([false, true])('routes /vehicle in both chat channels with Battle Royale=%s', battle => {
    const spawn = vi.fn(() => 'spawned'), send = vi.fn();
    const game = Object.assign(Object.create(GameServer.prototype), {
      battle: battle ? { phase: 'running' } : null,
      vehicles: { spawn, send },
    }) as GameServer;
    Object.defineProperty(game, 'serverTime', { value: 4000 });
    const p = player();
    Object.assign(p.session, { player: p, chatBucket: { take: () => true } });
    for (const channel of ['world', 'team'] as const)
      game.handleMessage(p.session as ClientSession, { t: 'chat', text: '/vehicle jeep', channel });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledWith(p, 'jeep', 4000);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('rejects unknown vehicle types without treating object properties as types', () => {
    const s = system(world());
    expect(s.spawn(player(), 'constructor', 0)).toBe('/vehicle <car|jeep|quad|grizzly>');
    expect(s.states.size).toBe(0);
  });
  it('accelerates and sweeps into a wall instead of tunnelling through at speed',()=>{
    const w=world(),v=vehicle();
    for(let i=0;i<80;i++)stepVehicle(v,1,0,w,1/30,i*1000/30);
    expect(v.speed).toBeGreaterThan(10);expect(v.z).toBeLessThan(35);
    v.z=48;v.speed=30;
    w.setOwnerColliders(99,[{shape:makeBox(48,31,44,4,2,.2),layer:Layer.Static}]);
    for(let i=0;i<10;i++)stepVehicle(v,1,0,w,1/30,3000+i*1000/30);
    expect(v.z).toBeGreaterThan(46);expect(v.health).toBeLessThan(600);expect(v.health).toBeGreaterThan(0);
    const health=v.health;
    for(let i=0;i<30;i++)stepVehicle(v,0,0,w,1/30,4000+i*1000/30);
    expect(v.health).toBe(health);
  });
  it('spawns all four types, checks reach and prevents two drivers claiming a seat',()=>{
    const w=world(),s=system(w),a=player(),b=player(2);
    for(const [i,type]of ['car','jeep','quad','grizzly'].entries()){
      a.state.x=16+i*19;a.state.z=75;
      expect(s.spawn(a,type,i*4000)).toContain('F');
    }
    expect([...s.states.values()].map(v=>v.kind)).toEqual(['car','jeep','quad','grizzly']);
    const v=[...s.states.values()][0]!;
    s.toggle(a,v.id,17000);expect(a.vehicleId).toBe(0);
    Object.assign(a.state,{x:v.x,y:v.y,z:v.z+3});Object.assign(b.state,a.state);
    s.toggle(a,v.id,18000);s.toggle(b,v.id,18000);
    expect(a.vehicleId).toBe(v.id);expect(b.vehicleId).toBe(0);
    expect(s.exit(a)).toBe(true);expect(v.driver).toBeNull();
    expect(Math.hypot(a.state.x-v.x,a.state.z-v.z)).toBeGreaterThan(VEHICLES.car.halfX+.5);
  });
  it('seats teammates as passengers (only teammates), up to the vehicle seats, and lets them out',()=>{
    const w=world(),s=system(w),a=player(),b=player(2),c=player(3),d=player(4),e=player(5);
    a.state.x=48;a.state.z=75;expect(s.spawn(a,'car',0)).toContain('F');
    const v=[...s.states.values()][0]!;
    for(const p of [a,b,c,d,e])Object.assign(p.state,{x:v.x,y:v.y,z:v.z+3});
    const team=new Set([1,2,3,4,5]);
    s.toggle(a,v.id,1000,id=>team.has(id));
    expect(v.driver).toBe(1);expect(a.vehicleSeat).toBe(0);
    // A stranger cannot climb into a teammate's car.
    s.toggle(b,v.id,1000,()=>false);expect(b.vehicleId).toBe(0);
    for(const p of [b,c,d])s.toggle(p,v.id,2000,id=>team.has(id));
    expect([b,c,d].map(p=>p.vehicleSeat)).toEqual([1,2,3]);expect(v.passengers).toEqual([2,3,4]);
    // Four seats in a Lada: the fifth stays outside.
    s.toggle(e,v.id,2000,id=>team.has(id));expect(e.vehicleId).toBe(0);
    s.step(1100,1/30,new Map([a,b,c,d].map(p=>[p.id,p])),vi.fn(),vi.fn());
    const seat=b.state;expect(Math.hypot(seat.x-a.state.x,seat.z-a.state.z)).toBeGreaterThan(.6);
    expect(s.exit(c)).toBe(true);expect(v.passengers).toEqual([2,0,4]);expect(v.driver).toBe(1);
    s.control(b,1,0,1200);s.control(a,1,0,1200);
    s.dispose();
  });
  it('allows exiting a destroyed vehicle during the two-second fuse and detonates exactly once',()=>{
    const w=world(),s=system(w),v=vehicle(),a=player();
    s.states.set(1,v);w.setOwnerColliders(vehicleOwner(1),vehicleColliders(v));
    s.toggle(a,1,0);expect(a.vehicleId).toBe(1);
    damageVehicle(v,1000,1000);const explode=vi.fn();
    s.step(2999,1/30,new Map([[a.id,a]]),explode,vi.fn());expect(explode).not.toHaveBeenCalled();
    s.toggle(a,1,2000);expect(a.vehicleId).toBe(0);
    s.step(3000,1/30,new Map([[a.id,a]]),explode,vi.fn());
    s.step(3100,1/30,new Map([[a.id,a]]),explode,vi.fn());
    expect(explode).toHaveBeenCalledTimes(1);expect(explode.mock.calls[0]![1]).toEqual([]);
  });
  it.each([{sea:40,inland:NaN,y:35},{sea:40,inland:NaN,y:39.95},{sea:20,inland:40,y:35}])('allows F exit from ocean/inland water at vehicle height $y',({sea,inland,y})=>{
    const w=world(sea,inland),s=system(w),v=vehicle(),a=player();
    s.states.set(1,v); w.setOwnerColliders(vehicleOwner(1),vehicleColliders(v));
    s.toggle(a,1,0); expect(a.vehicleId).toBe(1);
    v.y=y;Object.assign(a.state,{y});
    s.toggle(a,1,1000); expect(a.vehicleId).toBe(0); expect(a.state.swimming).toBe(true);
    expect(a.state.y).toBeLessThan(w.waterLevel(a.state.x,a.state.z));
    expect(a.state.y).toBeLessThanOrEqual(y+.16);expect(v.driver).toBeNull();
  });
  it('exits underwater below a bridge instead of teleporting through its deck to the surface',()=>{
    const w=world(45),s=system(w),v=vehicle(),a=player();
    s.states.set(1,v);w.setOwnerColliders(vehicleOwner(1),vehicleColliders(v));s.toggle(a,1,0);
    v.y=32;a.state.y=32;
    w.setOwnerColliders(88,[{shape:makeBox(48,38,48,10,.2,10),layer:Layer.Static}]);
    s.toggle(a,1,1000);
    expect(a.vehicleId).toBe(0);expect(a.state.swimming).toBe(true);expect(a.state.y).toBeLessThan(33);
    expect(w.overlapsCapsule(a.state.x,a.state.y+.4,a.state.z,a.state.x,a.state.y+1.4,a.state.z,.35,Mask.CharacterMovement,.04)).toBe(false);
  });
  it('exposes a seated head through the window but blocks shots at the chassis',()=>{
    const w=world(),v=vehicle(),hit=makeRayHit();w.setOwnerColliders(vehicleOwner(1),vehicleColliders(v));
    const seatX=48+VEHICLES.car.seat[0],seatY=30+VEHICLES.car.seat[1],seatZ=48+VEHICLES.car.seat[2];
    const head=raycastRig(SEATED_RIG,seatX,seatY,seatZ,0,40,seatY+1.37,seatZ,1,0,0,15);
    expect(head?.zone).toBe('head');
    expect(w.raycast(40,seatY+1.37,seatZ,1,0,0,head!.t,Mask.LineOfSight,hit)).toBe(false);
    expect(w.raycast(40,30.5,48,1,0,0,15,Mask.LineOfSight,hit)).toBe(true);
  });
  it('runs over a body standing in front of a moving vehicle, harder the faster it goes',()=>{
    const hits:number[]=[];
    for(const speed of [6,18]){
      const s=system(world()),v={...vehicle(),speed};s.states.set(v.id,v);
      // Body just ahead of the bonnet (yaw 0 drives towards -Z).
      const body={state:createCharacterState(48,30,48-VEHICLES.car.halfZ-.2)};
      s.strike(1000,()=>[body],(b)=>b.state,80,(_t,_v,damage)=>hits.push(damage));
    }
    expect(hits.length).toBe(2);expect(hits[1]).toBeGreaterThan(hits[0]!*3);
  });
});

