import { Group, Mesh, type Scene } from 'three';
import { VEHICLES, VEHICLE_ROLES, vehicleInReach, tyreHandling, vehicleOwner, mountedPoint, mountedSeat, seatAim, seatMount, vehicleSeatOf, vehicleFreeSeat, vehiclePoint, type VehicleState, type VehiclesMessage } from '@zion/shared';
import { vehicleColliders, type CollisionWorld } from '@zion/physics';
import type { AssetLibrary } from './asset-library';
import { VehicleAudio } from '../vehicle-audio';
import { VehicleTimeline } from '../vehicle-timeline';
import { VehicleSmoke } from './vehicle-smoke';
import { buildMountRigs, poseMountRigs, splitMounts, type MountRig } from './vehicle-mounts';
import { fitSeats, type SeatFit } from './seat-fit';
import { cutWheels } from './vehicle-wheels';

// Vehicles are sent at 15 Hz. Rendering more than one packet interval in the past keeps
// playback interpolating between real states; extrapolating and then correcting backwards
// on every packet was what made fast vehicles visibly twitch rearwards.
const VEHICLE_RENDER_DELAY_MS = 105;
/** Delay for the vehicle we drive: two 30 Hz snapshot intervals. */
const OWN_RENDER_DELAY_MS = 70;

interface View { target: VehicleState; pose: VehicleState; root: Group; body:Group; timeline:VehicleTimeline; loaded: boolean; wheels:Array<{index:number;mount:Group;spin:Group;center:readonly [number,number,number]}>; travel:number; rotors:Array<{group:Group;axis:'main'|'tail'}>; spin:number; rigs:MountRig[]; fit:SeatFit[]; placed?:[number,number,number,number,number,number]; colliders?:ReturnType<typeof vehicleColliders> }
export class VehicleRenderer {
  private readonly views = new Map<number, View>();
  private readonly audio = new VehicleAudio();
  private readonly smoke: VehicleSmoke;
  /** Monotonic playback clock; server clock re-syncs are slewed in instead of jumping. */
  private playback: number | undefined;
  private ownPlayback: number | undefined;
  private disposed = false;
  /** Poses drawn instead of the snapshot playback: the vehicle we drive, as predicted. */
  private readonly overrides = new Map<number, VehicleState>();
  override(id:number,pose:VehicleState|null):void{if(pose)this.overrides.set(id,pose);else this.overrides.delete(id);}
  /** The latest snapshot of a player's vehicle (not interpolated). */
  target(id:number):VehicleState|undefined{return this.viewOf(id)?.target;}
  constructor(private readonly scene:Scene,private readonly library:AssetLibrary,private readonly world:CollisionWorld){this.smoke=new VehicleSmoke(scene);}
  sync(message:VehiclesMessage):void{
    // Delta snapshots: `ids` lists everything still in view, `vehicles` only what changed.
    const keep=new Set(message.ids??message.vehicles.map(v=>v.id));
    for(const [id,view]of this.views)if(!keep.has(id)){this.scene.remove(view.root);this.world.removeOwnerColliders(vehicleOwner(id));this.views.delete(id);this.smoke.forget(id);}
    for(const v of message.vehicles){
      const existing=this.views.get(v.id);
      if(existing){existing.target={...v};existing.timeline.push(message.time,v);}
      else{const root=new Group(),body=new Group(),timeline=new VehicleTimeline();body.position.y=-VEHICLES[v.kind].com;body.scale.setScalar(VEHICLES[v.kind].scale);root.add(body);timeline.push(message.time,v);this.scene.add(root);this.views.set(v.id,{target:{...v},pose:{...v},root,body,timeline,loaded:false,wheels:[],travel:0,rotors:[],spin:0,rigs:[],fit:[]});}
    }
  }
  /** The vehicle a player is aboard (any seat), interpolated. */
  /** Displayed (interpolated) pose of every vehicle (collision debug view). */
  *poses():Iterable<VehicleState>{for(const v of this.views.values())yield v.pose;}
  rider(id:number):VehicleState|undefined{return [...this.views.values()].find(v=>vehicleSeatOf(v.target,id)>=0)?.pose;}
  /** Seat of a player aboard: 0 driving, 1… passenger, −1 on foot. */
  seatIndex(id:number):number{const v=[...this.views.values()].find(v=>vehicleSeatOf(v.target,id)>=0);return v?vehicleSeatOf(v.target,id):-1;}
  nearest(x:number,y:number,z:number):VehicleState|undefined{
    return [...this.views.values()].map(v=>v.target).filter(v=>vehicleFreeSeat(v)>=0&&v.health>0&&!v.exploded&&Math.abs(v.y-y)<2.5&&vehicleInReach(v,x,z)).sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];
  }
  update(dt:number,now:number,localId:number,x:number,y:number,z:number,enabled:boolean,serverTime=now,localThrottle?:number):void{
    const target=serverTime-VEHICLE_RENDER_DELAY_MS;
    if(this.playback===undefined||Math.abs(target-this.playback)>400)this.playback=target;
    else this.playback+=dt*1000+(target-this.playback)*Math.min(1,dt*1.5);
    // Our own car arrives every server tick (30 Hz), so it can be shown closer to the present.
    const ownTarget=serverTime-OWN_RENDER_DELAY_MS;
    if(this.ownPlayback===undefined||Math.abs(ownTarget-this.ownPlayback)>400)this.ownPlayback=ownTarget;
    else this.ownPlayback+=dt*1000+(ownTarget-this.ownPlayback)*Math.min(1,dt*1.5);
    for(const view of this.views.values()){
      const v=view.target,p=view.pose=this.overrides.get(v.id)??view.timeline.play(vehicleSeatOf(v,localId)>=0?this.ownPlayback:this.playback),def=VEHICLES[v.kind];
      // Camera/LOS colliders follow the same interpolated pose as the mesh. Installing the
      // newest packet here caused the chase camera to alternate between two positions.
      // (Only when it moved or turned: an armoured hull is up to 64 boxes, and a parked vehicle's never change.)
      const placed=view.placed,m=p.motion;
      if(!placed||Math.abs(placed[0]-p.x)+Math.abs(placed[1]-p.y)+Math.abs(placed[2]-p.z)>.01||Math.abs(placed[3]-p.yaw)+Math.abs(placed[4]-(m?.pitch??0))+Math.abs(placed[5]-(m?.roll??0))>.002){
        view.colliders=vehicleColliders(p);this.world.setOwnerColliders(vehicleOwner(v.id),view.colliders);view.placed=[p.x,p.y,p.z,p.yaw,m?.pitch??0,m?.roll??0];
      }
      const origin=vehiclePoint(p,0,def.com,0);
      // Flat tyres: the body sits low on that corner (latest state, not the interpolated pose).
      const tyres=tyreHandling(v);
      view.root.position.set(origin.x,origin.y-tyres.drop,origin.z);view.root.rotation.set((p.motion?.pitch??0)-tyres.pitch,p.yaw,(p.motion?.roll??0)-tyres.lean,'YXZ');
      const throttle=v.health>0&&!v.exploded&&v.driver!==null
        ? (v.driver===localId&&localThrottle!==undefined?localThrottle:(v.throttle??0)) : 0;
      // Spin under power even while stuck or airborne; rolling without input follows road speed.
      const wheelSpeed=Math.abs(throttle)>.01?Math.sign(throttle)*Math.max(Math.abs(p.speed),4*Math.abs(throttle)):p.speed;
      view.travel+=wheelSpeed*dt;
      for(const wheel of view.wheels){
        wheel.mount.position.set(...wheel.center);
        wheel.mount.position.y+=(def.spring-(p.motion?.suspension[wheel.index]??def.spring))/def.scale;
        wheel.mount.rotation.y=wheel.index<2?-(p.motion?.steer??0)*.42:0;
        wheel.spin.rotation.x=-view.travel/def.wheelRadius;
      }
      poseMountRigs(view.rigs,v,dt);
      // Helicopter rotors: spinning with the rotor speed (main ~5 turns/s, tail faster).
      view.spin+=(v.rotor??0)*dt*32;
      for(const r of view.rotors){if(r.axis==='main')r.group.rotation.y=view.spin;else r.group.rotation.x=view.spin*2.6;}
      view.root.visible=Math.hypot(p.x-x,p.z-z)<(VEHICLE_ROLES[v.kind].cls==='heli'?900:350);
      if(!view.loaded&&view.root.visible){
        view.loaded=true;
        void this.library.load(VEHICLES[v.kind].asset)?.then(visual=>{
          if(this.disposed||!this.views.has(v.id))return;
          // Turrets and roof guns are cut out of the hull and turn on their own groups.
          // One-mesh models (the APC) get their wheels cut out to spin.
          const {hull,pieces}=splitMounts(v.kind,cutWheels(v.kind,visual.parts));
          const meshOf=(part:{geometry:Mesh['geometry'];material:Mesh['material']})=>{const m=new Mesh(part.geometry,part.material);m.castShadow=true;m.receiveShadow=true;return m;};
          view.rigs=buildMountRigs(v.kind,view.body,pieces,meshOf);
          view.fit=fitSeats(v.kind,hull);
          for(const part of hull){
            const mesh=meshOf(part);
            if(part.rotor&&part.rotorCenter){const group=new Group();group.position.set(...part.rotorCenter);group.add(mesh);view.body.add(group);view.rotors.push({group,axis:part.rotor});}
            else if(part.wheel!==undefined&&part.wheelCenter){
              let wheel=view.wheels.find(w=>w.index===part.wheel);
              if(!wheel){const mount=new Group(),spin=new Group();mount.add(spin);view.body.add(mount);wheel={index:part.wheel,mount,spin,center:part.wheelCenter};view.wheels.push(wheel);}
              wheel.spin.add(mesh);
            }else view.body.add(mesh);
          }
        });
      }
      if(v.health<def.health*.6&&Math.hypot(p.x-x,p.z-z)<200){
        // Smoke pours out of the engine bay (the quads' engine sits under the seat).
        const severity=v.health<=0?1:Math.min(.95,(1-v.health/def.health-.4)/.6+.1);
        const e=vehiclePoint(p,0,def.height*(def.quad?.5:.62),def.quad?0:def.frontZ*.95);
        this.smoke.emit(v.id,dt,e.x,e.y,e.z,-Math.sin(p.yaw)*p.speed,-Math.cos(p.yaw)*p.speed,severity);
      }
    }
    this.smoke.update(dt);
    this.audio.update([...this.views.values()].map(v=>v.pose),localId,x,y,z,dt,now,enabled);
  }
  /** Runs fn with this vehicle's own collision removed, e.g. so the chase camera ignores its roof. */
  withoutOwnColliders<T>(v:VehicleState,fn:()=>T):T{
    this.world.removeOwnerColliders(vehicleOwner(v.id));
    // Put back as they were placed (not rebuilt: an armoured hull is up to 64 boxes).
    try{return fn();}finally{this.world.setOwnerColliders(vehicleOwner(v.id),this.views.get(v.id)?.colliders??vehicleColliders(v));}
  }
  /** Where a rider is drawn: on the seat's cushion as measured on the model, carried by any mount. */
  seat(id:number):{x:number;y:number;z:number}|undefined{
    const view=this.viewOf(id);if(!view)return undefined;
    const seat=Math.max(0,vehicleSeatOf(view.target,id)),v={...view.pose,aim:this.shownAim(id)},fit=view.fit[seat];
    if(fit?.y==null)return mountedSeat(v,seat);
    const [x,,z]=VEHICLES[v.kind].seats[seat]??VEHICLES[v.kind].seat;
    return vehiclePoint(v,x,fit.y,z);
  }
  /** World height of the floor under a seated rider's feet (null: nothing to keep them off). */
  seatFloor(id:number):number|null{
    const view=this.viewOf(id);if(!view)return null;
    const seat=Math.max(0,vehicleSeatOf(view.target,id)),fit=view.fit[seat];
    if(fit?.floor==null)return null;
    const [x,,z]=VEHICLES[view.pose.kind].seats[seat]??VEHICLES[view.pose.kind].seat;
    return vehiclePoint(view.pose,x,fit.floor,z-.5).y;
  }
  /**
   * The gunner's sight of a turret seat: beside the gun on the turret (where it is drawn now), and
   * the world direction the barrel points. Undefined for a seat without a turning mount.
   */
  sight(id:number):{x:number;y:number;z:number;yaw:number;pitch:number}|undefined{
    const view=this.viewOf(id);if(!view)return undefined;
    const seat=Math.max(0,vehicleSeatOf(view.target,id)),m=seatMount(view.pose.kind,seat);if(!m)return undefined;
    const v={...view.pose,aim:this.shownAim(id)},[px,py,pz]=m.pitchAt;
    const at=mountedPoint(v,seat,px-.55,py+.65,pz+.3,false),p=vehiclePoint(v,at.x,at.y,at.z),[yaw,pitch]=seatAim(v,seat);
    return {...p,yaw:v.yaw+yaw,pitch};
  }
  private viewOf(id:number):View|undefined{return [...this.views.values()].find(v=>vehicleSeatOf(v.target,id)>=0);}
  /** The mounts' aim as drawn (eased), so a gunner stands exactly at the gun on screen. */
  private shownAim(id:number):number[]|undefined{const view=this.viewOf(id);if(!view?.rigs.length)return view?.target.aim;const out:number[]=[];for(const r of view.rigs){out[r.seat*2]=r.shownYaw;out[r.seat*2+1]=r.shownPitch;}for(let i=0;i<out.length;i++)out[i]??=0;return out;}
  dispose():void{this.disposed=true;for(const[id,v]of this.views){this.scene.remove(v.root);this.world.removeOwnerColliders(vehicleOwner(id));}this.views.clear();this.audio.dispose();this.smoke.dispose();}
}
