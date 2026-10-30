import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, MeshLambertMaterial, Scene, Vector3 } from 'three';
import { createVehicleMotion, VEHICLES, vehiclePoint, type VehicleState } from '@zion/shared';
import { CollisionWorld } from '@zion/physics';
import type { AssetLibrary } from './asset-library';
import { VehicleRenderer } from './vehicles';
import { SIT_HEIGHT } from './seat-fit';

vi.mock('../vehicle-audio',()=>({VehicleAudio:class {update=vi.fn();dispose=vi.fn();}}));
afterEach(()=>vi.restoreAllMocks());
describe('vehicle graphics and camera collision',()=>{
  it.each([1,-1])('spins stationary airborne wheels from local throttle %s and stops on release',async(throttle)=>{
    const scene=new Scene(),world=new CollisionWorld({worldSize:192,seaLevel:20});
    const geometry=new BoxGeometry(),material=new MeshLambertMaterial();
    const library={load:vi.fn(async()=>({parts:[{geometry,material,wheel:0,wheelCenter:[0,0,0]}]}))} as unknown as AssetLibrary;
    const renderer=new VehicleRenderer(scene,library,world);
    const v:VehicleState={id:1,kind:'car',x:50,y:100,z:80,yaw:0,speed:0,health:600,driver:1,explodeAt:0,exploded:false,motion:createVehicleMotion('car'),throttle:-throttle};
    try{
      renderer.sync({t:'vehicles',time:1000,vehicles:[v]});
      renderer.update(1/60,1000,1,50,100,80,false,1000,throttle);
      await Promise.resolve();
      renderer.update(1/60,1017,1,50,100,80,false,1017,throttle);
      const root=scene.children.find(o=>o instanceof Group)!;
      const spin=root.children[0]!.children[0]!.children[0]!;
      expect(Math.sign(spin.rotation.x)).toBe(-throttle);
      const angle=spin.rotation.x;
      renderer.update(1/60,1034,1,50,100,80,false,1034,0);
      expect(spin.rotation.x).toBe(angle);
      // A remote observer uses the server's control, even with zero road speed.
      renderer.update(1/60,1051,2,50,100,80,false,1051);
      expect(Math.sign(spin.rotation.x-angle)).toBe(throttle);
    }finally{renderer.dispose();geometry.dispose();material.dispose();}
  });
  it('keeps the body, driver and collision on one timeline while animating wheel suspension',async()=>{
    const scene=new Scene(),world=new CollisionWorld({worldSize:192,seaLevel:20});
    const install=vi.spyOn(world,'setOwnerColliders');
    const geometry=new BoxGeometry(),material=new MeshLambertMaterial();
    const library={load:vi.fn(async()=>({parts:[{geometry,material},{geometry,material,wheel:0,wheelCenter:[-.703,.314,-1.305]}]}))} as unknown as AssetLibrary;
    const renderer=new VehicleRenderer(scene,library,world);
    const a:VehicleState={id:1,kind:'car',x:50,y:30,z:80,yaw:0,speed:20,health:600,driver:1,explodeAt:0,exploded:false,motion:createVehicleMotion('car')};
    a.motion!.roll=.2;a.motion!.pitch=.1;a.motion!.suspension[0]=.1;
    const b={...a,z:78,motion:structuredClone(a.motion)};
    try {
      renderer.sync({t:'vehicles',time:1000,vehicles:[a]});renderer.sync({t:'vehicles',time:1100,vehicles:[b]});
      renderer.update(1/60,1170,1,50,30,80,false,1170);
      await Promise.resolve();
      renderer.update(1/60,1170,1,50,30,80,false,1170);
      const pose=renderer.rider(1)!;
      // Our own car (driver 1 = local player) plays 70 ms behind; the second frame adds dt.
      expect(pose.z).toBeCloseTo(80-2*(1170-70+1000/60-1000)/100);
      // The driver sits on the model's cushion: here the top of the unit box body (0.5 × scale 1.2).
      const [sx,,sz]=VEHICLES.car.seats[0]!;
      expect(renderer.seat(1)).toEqual(vehiclePoint(pose,sx,.5*VEHICLES.car.scale-SIT_HEIGHT,sz));
      const root=scene.children.find(o=>o instanceof Group)!;
      root.updateMatrixWorld(true);
      const body=root.children[0]!;
      const graphicsOrigin=body.getWorldPosition(new Vector3()),expected=vehiclePoint(pose,0,0,0);
      expect(graphicsOrigin.distanceTo(new Vector3(expected.x,expected.y,expected.z))).toBeLessThan(1e-8);
      const parts=install.mock.calls.at(-1)![1],chassis=vehiclePoint(pose,0,.48*VEHICLES.car.scale,0),shape=parts[0]!.shape;
      if(shape.type!=='box')throw Error('chassis');
      expect(shape.cz).toBeCloseTo(chassis.z);expect(shape.basis).toBeDefined();
      const wheel=body.children.find(o=>o instanceof Group)!;
      expect(wheel.position.y).toBeCloseTo(.314+(VEHICLES.car.spring-.1)/VEHICLES.car.scale);
      expect(wheel.children[0]!.rotation.x).not.toBe(0);
    }finally {renderer.dispose();geometry.dispose();material.dispose();}
  });
});
