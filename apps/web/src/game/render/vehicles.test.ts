import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, MeshLambertMaterial, Scene, Vector3 } from 'three';
import { createVehicleMotion, VEHICLES, vehiclePoint, vehicleSeat, type VehicleState } from '@zion/shared';
import { CollisionWorld } from '@zion/physics';
import type { AssetLibrary } from './asset-library';
import { VehicleRenderer } from './vehicles';

vi.mock('../vehicle-audio',()=>({VehicleAudio:class {update=vi.fn();dispose=vi.fn();}}));
afterEach(()=>vi.restoreAllMocks());
describe('vehicle graphics and camera collision',()=>{
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
      // 105 ms delay interpolates between real packets; the second frame advances playback by dt.
      expect(pose.z).toBeCloseTo(80-2*(1170-105+1000/60-1000)/100);
      expect(renderer.seat(1)).toEqual(vehicleSeat(pose));
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
