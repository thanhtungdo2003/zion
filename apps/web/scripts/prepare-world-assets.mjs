// Offline preparation only. Runtime never parses a whole building showroom.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Matrix4, Matrix3, Quaternion, Vector3, Box3 } from 'three';
const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve('next/package.json'))('sharp');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outDir = path.join(root, 'models/prepared');
const sourceOut = path.join(root, 'packages/assets/src/imported-assets.ts');
const cacheFile = path.join(outDir, 'source-hash.txt');
const jobs = [
  ['vehicles/lada_2109_base_template_free.glb', null, 'drive_car', 2300, 4.3],
  ['vehicles/military_jeep__jeep_pixel_style.glb', null, 'drive_jeep', 2301, 4.2],
  ['vehicles/quad_bike.glb', null, 'drive_quad', 2302, 2.3],
  ['vehicles/grizzly_quad_bike_700.glb', null, 'drive_grizzly', 2303, 2.4],
  // The low-poly pack's houses are closed shells (doors and windows are painted on): they collide
  // as solid blocks shaped like their footprint and roof, so nothing walks, drives or shoots through.
  ...['barn01','barn03','house01','house02','house03','barrack01','barrack02','barrack04','container02','trailer01','generator01','watertank01','bench01','fence01'].map((n,i) => ['buildings/lowpoly_buildings.glb', n, n, 2400+i, n.startsWith('barrack') ? 1.3 : 1, i < 10 ? { collider: 'solid' } : {}]),
  ['buildings/favela_house.glb', null, 'favela', 2420, 1.2],
  ['buildings/pubg_building__low_poly_building.glb', null, 'apartment', 2421, 13],
  ['buildings/modular_slums.glb', 'E5_10', 'slum_room', 2422, 1.6],
  ['buildings/modular_slums.glb', 'C5_20', 'slum_corner', 2423, 1.6],
  // Military island kit (battle royale). Options: height (target metres), rotateX (radians),
  // collider ('faces' | 'trunk' | 'box' | 'footing' | 'none'), category, layer, tags.
  ['buildings/electric_tower.glb', null, 'pylon_tower', 2430, 1, { height: 30, collider: 'legs', footing: 6, tags: ['power-grid'] }],
  ['buildings/tower_crane.glb', null, 'tower_crane', 2432, 1, { collider: 'footing', footing: 40, tags: ['port'] }],
  ...[
    ['Tree_Small_a_LOD0_12', 'tree_small_a'], ['Tree_Small_b_LOD0_15', 'tree_small_b'], ['Tree_Small_c_LOD0_5', 'tree_small_c'],
    ['Tree_Small_d_LOD0_4', 'tree_small_d'], ['Tree_Small_e_LOD0]_21', 'tree_small_e'],
    ['Tree_Big_a_LOD0_17', 'tree_big_a'], ['Tree_Big_b_LOD0_13', 'tree_big_b'], ['Tree_Big_c_LOD0_16', 'tree_big_c'],
    ['Pine_Small_LOD0_9', 'pine_small'], ['Pine_Medium_LOD0_6', 'pine_medium'], ['Pine_Big_LOD0_7', 'pine_big'], ['Conifer_LOD0_8', 'conifer'],
    ['Dead_Pine_LOD0_18', 'dead_pine'], ['Dead_Tree_LOD0_19', 'dead_tree'],
  ].map(([node, name], i) => ['nationals/nature_vegetation_pack.glb', node, name, 2440 + i, 1, { collider: 'trunk', category: 'tree', tags: ['island-flora', 'tree'] }]),
  ...[['Bush_a_20', 'bush_a'], ['Bush_b_10', 'bush_b'], ['Bush_c_11', 'bush_c']]
    .map(([node, name], i) => ['nationals/nature_vegetation_pack.glb', node, name, 2460 + i, 1, { collider: 'none', category: 'vegetation', tags: ['island-flora', 'bush'] }]),
  ...[['Stone_Small_a_LOD0_24', 'stone_small_a'], ['Stone_Small_b_LOD0_22', 'stone_small_b'], ['Rock_Medium_a_LOD0_25', 'rock_medium_a'], ['Rock_Medium_b_LOD0_26', 'rock_medium_b'],
    ['Rock_Medium_c_LOD0_27', 'rock_medium_c'], ['Rock_Big_a_LOD0_32', 'rock_big_a'], ['Rock_Big_b_LOD0_33', 'rock_big_b'], ['Rock_Big_c_LOD0_30', 'rock_big_c'], ['Cliff_a_LOD0_35', 'cliff_a'], ['Cliff_b_LOD0_36', 'cliff_b']]
    .map(([node, name], i) => ['nationals/nature_vegetation_pack.glb', node, name, 2463 + i, 1, { collider: 'box', category: 'rock', tags: ['island-flora', 'rock'] }]),
  ['nationals/banana_tree_low_poly.glb', null, 'banana_tree', 2473, 1, { height: 4.5, collider: 'trunk', category: 'tree', tags: ['island-flora', 'tree'] }],
  // Low-poly forest pack (authored ~2× real size): broadleaf crowns, oaks built from a trunk and
  // its separate branch mesh, undergrowth and small rocks (scaled up to boulders).
  ...['', '.001', '.002', '.003', '.004', '.005', '.006', '.007']
    .map((suffix, i) => ['nationals/low_poly_forest_tree_pack.glb', `Background_Tree_Atlas${suffix}`, `forest_tree_${i}`, 2600 + i, .5, { collider: 'trunk', category: 'tree', tags: ['island-flora', 'tree'] }]),
  ...[['Tree_Trunk_01.001', 'Tree_Branches_01'], ['Tree_Trunk_01', 'Tree_Branches_01.001'], ['Tree_Trunk_01.002', 'Tree_Branches_01.002'], ['Tree_Trunk_02', 'Tree_Branches_02']]
    .map((nodes, i) => ['nationals/low_poly_forest_tree_pack.glb', nodes, `forest_oak_${i}`, 2608 + i, .5, { collider: 'trunk', category: 'tree', tags: ['island-flora', 'tree'] }]),
  ...['.008', '.009', '.010', '.011', '.012']
    .map((suffix, i) => ['nationals/low_poly_forest_tree_pack.glb', `Background_Tree_Atlas${suffix}`, `forest_shrub_${i}`, 2612 + i, .5, { collider: 'none', category: 'vegetation', tags: ['island-flora', 'bush'] }]),
  ...['', '.001', '.002', '.003', '.004', '.005', '.006', '.007', '.008']
    .map((suffix, i) => ['nationals/low_poly_forest_tree_pack.glb', `Rocks${suffix}`, `forest_rock_${i}`, 2617 + i, 1.8, { collider: 'box', category: 'rock', tags: ['island-flora', 'rock'] }]),
  // Stylized pine pack (14 m tall pines, 8 m young pines, a sapling).
  ...['stylized_pine_var1', 'stylized_pine_var2', 'stylized_pine_var3', 'stylized_pine_var4', 'stylized_pine_var5', 'small_stylized_pine_var1', 'small_stylized_pine_var2', 'small_stylized_pine_var3', 'small_stylized_pine_var4']
    .map((node, i) => ['nationals/stylized_pine_tree_pack.glb', node, node.replace('stylized_', ''), 2626 + i, .85, { collider: 'trunk', category: 'tree', tags: ['island-flora', 'tree'] }]),
  ['nationals/stylized_pine_tree_pack.glb', 'sapling_stylized_pine', 'pine_sapling', 2635, .85, { collider: 'none', category: 'vegetation', tags: ['island-flora', 'bush'] }],
];
const sources = new Map();
const hash = createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url)));
for (const [file] of jobs) if (!sources.has(file)) { const b = await fs.readFile(path.join(root,'models',file)); sources.set(file,b); hash.update(b); }
const signature = hash.digest('hex');
try { if ((await fs.readFile(cacheFile,'utf8')) === signature && (await fs.stat(sourceOut)).isFile()) { console.log('Prepared world assets are current'); process.exit(0); } } catch {}
await fs.mkdir(outDir,{recursive:true});
const definitions = [];
const r = n => Math.round(n * 10000) / 10000;
/** Downward ray against one triangle: hit height, or -Infinity. */
function downHit(x,z,[a,b,c]){
  const d=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(d)<1e-9)return -Infinity;
  const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/d,v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/d,w=1-u-v;
  return u<0||v<0||w<0?-Infinity:u*a[1]+v*b[1]+w*c[1];
}
/**
 * Solid collision for a closed shell: a 0.5 m grid over the footprint, each cell a column up to the
 * highest surface above it (roof), merged into as few boxes as possible.
 */
function solidColumns(tris){
  const step=.5,box=new Box3();for(const t of tris)for(const p of t)box.expandByPoint(new Vector3(...p));
  const nx=Math.ceil((box.max.x-box.min.x)/step),nz=Math.ceil((box.max.z-box.min.z)/step),height=new Float32Array(nx*nz);
  for(let i=0;i<nx;i++)for(let k=0;k<nz;k++){const x=box.min.x+(i+.5)*step,z=box.min.z+(k+.5)*step;let top=-Infinity;for(const t of tris)top=Math.max(top,downHit(x,z,t));
    height[i*nz+k]=top>box.min.y+.6?Math.floor((top-box.min.y)/.25)*.25:0;}
  // Runs along z with one height, then identical runs merged along x.
  const runs=[];for(let i=0;i<nx;i++){let k=0;while(k<nz){const h=height[i*nz+k];if(!h){k++;continue;}let e=k;while(e+1<nz&&height[i*nz+e+1]===h)e++;runs.push({i0:i,i1:i,k0:k,k1:e,h});k=e+1;}}
  const merged=[];for(const run of runs){const prev=merged.find(m=>m.i1===run.i0-1&&m.k0===run.k0&&m.k1===run.k1&&m.h===run.h);if(prev)prev.i1=run.i1;else merged.push(run);}
  return merged.map(m=>({type:'box',center:[r(box.min.x+(m.i0+m.i1+1)/2*step),r(box.min.y+m.h/2),r(box.min.z+(m.k0+m.k1+1)/2*step)],halfExtents:[r((m.i1-m.i0+1)*step/2),r(m.h/2),r((m.k1-m.k0+1)*step/2)]}));
}
for (const [file, object, name, numericId, factor, opts = {}] of jobs) {
  const buf = sources.get(file), jsonLength = buf.readUInt32LE(12);
  const src = JSON.parse(buf.subarray(20,20+jsonLength));
  const bin = buf.subarray(28+jsonLength);
  const worlds = [], parents=[];
  function visit(i,parent) {
    const n=src.nodes[i];
    const local=n.matrix ? new Matrix4().fromArray(n.matrix) : new Matrix4().compose(new Vector3(...(n.translation??[0,0,0])),new Quaternion(...(n.rotation??[0,0,0,1])),new Vector3(...(n.scale??[1,1,1])));
    worlds[i]=parent.clone().multiply(local);
    for(const j of n.children??[]) {parents[j]=i;visit(j,worlds[i]);}
  }
  for(const i of src.scenes[src.scene??0].nodes) visit(i,new Matrix4());
  // One node (with its subtree), several nodes making one model (a trunk and its branches), or the scene.
  const selected = (Array.isArray(object) ? object : [object]).map(o => o ? src.nodes.findIndex(n=>n.name===o) : src.scenes[src.scene??0].nodes[0]);
  if(selected.some(i=>i<0)) throw Error('Missing object '+object);
  const nodes=[];
  function collect(i) { if(src.nodes[i].mesh!==undefined) nodes.push(i); for(const j of src.nodes[i].children??[])collect(j); }
  for(const i of selected) collect(i);
  function accessor(index) {
    const a=src.accessors[index],v=src.bufferViews[a.bufferView];
    const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
    const bytes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4}[a.componentType];
    const read={5120:'readInt8',5121:'readUInt8',5122:'readInt16LE',5123:'readUInt16LE',5125:'readUInt32LE',5126:'readFloatLE'}[a.componentType];
    const values=[];for(let i=0;i<a.count;i++)for(let j=0;j<components;j++)values.push(bin[read]((v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??components*bytes)+j*bytes));
    return {a,values,components};
  }
  const box=new Box3();
  for(const i of nodes)for(const p of src.meshes[src.nodes[i].mesh].primitives) {
    const {values}=accessor(p.attributes.POSITION);
    for(let k=0;k<values.length;k+=3)box.expandByPoint(new Vector3(...values.slice(k,k+3)).applyMatrix4(worlds[i]));
  }
  const size=box.getSize(new Vector3()), center=box.getCenter(new Vector3());
  const lift=new Matrix4().makeRotationX(opts.rotateX ?? 0);
  if(opts.rotateX){box.applyMatrix4(lift);box.getSize(size);box.getCenter(center);}
  const scale=opts.height ? opts.height/size.y : numericId<2400 ? factor/size.z : name==='apartment' ? factor/size.y : factor;
  // These two models have deep foundations below their entrance slab.
  // Align the entrance to terrain so the first step is within character step height.
  const foundation = name==='favela' ? 1.574 : name==='apartment' ? .55 : 0;
  // The Lada and Jeep sources face +Z while the authoritative driving frame faces -Z.
  // The quads and Grizzly already use the shared -Z forward axis.
  const base=new Matrix4().makeRotationY(numericId===2300||numericId===2301?Math.PI:0).multiply(new Matrix4().makeTranslation(0,-foundation,0)).multiply(new Matrix4().makeScale(scale,scale,scale)).multiply(new Matrix4().makeTranslation(-center.x,-box.min.y,-center.z)).multiply(lift);
  const dst={asset:{version:'2.0',generator:'ZION world asset preparation'},scene:0,scenes:[{nodes:[]}],nodes:[],meshes:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}],materials:[],textures:[],images:[],samplers:src.samplers??[]};
  const chunks=[];let length=0;
  function addView(data) { const padding=(4-length%4)%4;if(padding){chunks.push(Buffer.alloc(padding));length+=padding;}const id=dst.bufferViews.length;dst.bufferViews.push({buffer:0,byteOffset:length,byteLength:data.length});chunks.push(data);length+=data.length;return id; }
  function addAccessor(values,a,components) {
    const bytes=a.componentType===5126||a.componentType===5125?4:a.componentType===5123?2:1;
    const data=Buffer.alloc(values.length*bytes),write={5121:'writeUInt8',5123:'writeUInt16LE',5125:'writeUInt32LE',5126:'writeFloatLE'}[a.componentType];
    if(!write)throw Error('Unsupported component');values.forEach((v,i)=>data[write](v,i*bytes));
    const item={bufferView:addView(data),componentType:a.componentType,count:values.length/components,type:a.type};
    if(a.normalized)item.normalized=true;
    if(a.type==='VEC3'&&a.componentType===5126){item.min=[Infinity,Infinity,Infinity];item.max=[-Infinity,-Infinity,-Infinity];values.forEach((v,i)=>{item.min[i%3]=Math.min(item.min[i%3],v);item.max[i%3]=Math.max(item.max[i%3],v);});}
    dst.accessors.push(item);return dst.accessors.length-1;
  }
  const imageMap=new Map(),textureMap=new Map(),materialMap=new Map();
  async function texture(index) {
    if(textureMap.has(index))return textureMap.get(index);
    const t=src.textures[index],im=src.images[t.source];let imageId=imageMap.get(t.source);
    if(imageId===undefined){const view=src.bufferViews[im.bufferView];const raw=bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);const data=await sharp(raw).resize({width:512,height:512,fit:'inside',withoutEnlargement:true}).png({palette:true,quality:80}).toBuffer();imageId=dst.images.length;dst.images.push({mimeType:'image/png',bufferView:addView(data)});imageMap.set(t.source,imageId);}
    const id=dst.textures.length;dst.textures.push({...t,source:imageId});textureMap.set(index,id);return id;
  }
  async function material(index) {
    if(materialMap.has(index))return materialMap.get(index);
    const mat=structuredClone(src.materials[index]);
    async function remap(o){for(const [k,v]of Object.entries(o))if(v&&typeof v==='object'){if(k.endsWith('Texture')&&typeof v.index==='number')v.index=await texture(v.index);else await remap(v);}}
    await remap(mat);const id=dst.materials.length;dst.materials.push(mat);materialMap.set(index,id);return id;
  }
  const colliders=new Map(), allPoints=[], allTris=[];
  for(const i of nodes) {
    const transform=base.clone().multiply(worlds[i]),normal=new Matrix3().getNormalMatrix(transform);
    const primitives=[],meshBounds=new Box3();
    for(const primitive of src.meshes[src.nodes[i].mesh].primitives) {
      const p={attributes:{}};let positions;
      for(const [key,index]of Object.entries(primitive.attributes)) {
        const {a,values,components}=accessor(index);
        if(key==='POSITION'||key==='NORMAL')for(let j=0;j<values.length;j+=3){const v=new Vector3(...values.slice(j,j+3));if(key==='POSITION')v.applyMatrix4(transform);else v.applyMatrix3(normal).normalize();values.splice(j,3,...v.toArray());}
        if(key==='POSITION'){positions=values;for(let k=0;k<values.length;k+=3)allPoints.push(values.slice(k,k+3));for(let k=0;k<values.length;k+=3)meshBounds.expandByPoint(new Vector3(...values.slice(k,k+3)));}
        p.attributes[key]=addAccessor(values,a,components);
      }
      let indices=Array.from({length:positions.length/3},(_,j)=>j);
      if(primitive.indices!==undefined){const a=accessor(primitive.indices);indices=a.values;p.indices=addAccessor(a.values,a.a,1);}
      for(let j=0;j+2<indices.length;j+=3)allTris.push(indices.slice(j,j+3).map(k=>positions.slice(k*3,k*3+3)));
      if(primitive.material!==undefined)p.material=await material(primitive.material);
      primitives.push(p);
      // Axis-aligned architectural faces become thin boxes, preserving actual openings,
      // stair treads and upper floors instead of a solid bounding box around the house.
      if(numericId>=2400&&(opts.collider??'faces')==='faces')for(let j=0;j<indices.length;j+=3){
        const verts=indices.slice(j,j+3).map(k=>new Vector3(...positions.slice(k*3,k*3+3)));
        const a=verts[1].clone().sub(verts[0]),b=verts[2].clone().sub(verts[0]),area=a.clone().cross(b).length()/2;
        if(area<.025)continue;
        const bounds=new Box3().setFromPoints(verts),dim=bounds.getSize(new Vector3()).toArray();
        const axis=dim.indexOf(Math.min(...dim));
        if(dim[axis]>.025){
          const n=a.clone().cross(b).normalize();
          // Sloping stair meshes get narrow, walkable treads sampled on their real plane.
          // This keeps the shared yaw-box collision system and avoids a huge solid ramp AABB.
          if(Math.abs(n.y)>.55 && dim[1]>.08 && area>.05){
            const step=.15, [u,v,w]=verts;
            const denominator=(v.z-w.z)*(u.x-w.x)+(w.x-v.x)*(u.z-w.z);
            if(Math.abs(denominator)>1e-7)for(let gx=Math.floor(bounds.min.x/step);gx<Math.ceil(bounds.max.x/step);gx++)for(let gz=Math.floor(bounds.min.z/step);gz<Math.ceil(bounds.max.z/step);gz++){
              const x=(gx+.5)*step,z=(gz+.5)*step;
              const alpha=((v.z-w.z)*(x-w.x)+(w.x-v.x)*(z-w.z))/denominator;
              const beta=((w.z-u.z)*(x-w.x)+(u.x-w.x)*(z-w.z))/denominator;
              const gamma=1-alpha-beta;
              if(alpha<-.001||beta<-.001||gamma<-.001)continue;
              const y=alpha*u.y+beta*v.y+gamma*w.y;
              const center=[r(x),r(y),r(z)],halfExtents=[step/2,.025,step/2];
              colliders.set([...center,...halfExtents].join(','),{type:'box',center,halfExtents});
            }
          }
          continue;
        }
        const c=bounds.getCenter(new Vector3()).toArray().map(r),h=dim.map(v=>r(Math.max(.025,v/2)));
        const key=[...c,...h].join(',');colliders.set(key,{type:'box',center:c,halfExtents:h});
      }
    }
    const bakedNode={name:src.nodes[i].name,mesh:dst.meshes.length};
    if(numericId<2400){
      const wheelData={2300:[.703,.314,-1.305,1.338],2301:[1.11,.542,-1.27,1.27],2302:[.577,.357,-.743,.784],2303:[.626,.362,-.852,.748]}[numericId];
      const c=meshBounds.getCenter(new Vector3()),d=meshBounds.getSize(new Vector3());
      let named=false;
      for(let ancestor=i;ancestor!==undefined;ancestor=parents[ancestor]){
        const n=src.nodes[ancestor].name??'';
        if(/wheel/i.test(n)&&!/steering/i.test(n))named=true;
        if(numericId===2303&&[5,11,14,19].includes(ancestor))named=true;
      }
      const [wx,radius,front,rear]=wheelData;
      const nearAxle=Math.min(Math.abs(c.z-front),Math.abs(c.z-rear))<radius+.08;
      const spatial=Math.abs(Math.abs(c.x)-wx)<.25&&Math.abs(c.y-radius)<radius*.6&&d.y<=radius*2.2&&d.z<=radius*2.2&&d.x<.65;
      if((named||spatial)&&nearAxle){
        const wheel=(c.z<0?0:2)+(c.x<0?0:1);
        bakedNode.extras={vehicleWheel:wheel,wheelCenter:[c.x<0?-wx:wx,radius,c.z<0?front:rear]};
      }
    }
    dst.scenes[0].nodes.push(dst.nodes.length);dst.nodes.push(bakedNode);dst.meshes.push({primitives});
  }
  const pad=(4-length%4)%4;if(pad){chunks.push(Buffer.alloc(pad));length+=pad;}dst.buffers[0].byteLength=length;
  let json=Buffer.from(JSON.stringify(dst));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const binaryHeader=Buffer.alloc(8);binaryHeader.writeUInt32LE(length);binaryHeader.writeUInt32LE(0x004e4942,4);
  const result=Buffer.concat([header,json,binaryHeader,...chunks]);await fs.writeFile(path.join(outDir,name+'.glb'),result);
  let faces=[...colliders.values()];
  // Simple collider shapes for vegetation, rocks and lattice structures.
  if(opts.collider&&opts.collider!=='faces'){
    const all=new Box3();for(const p of allPoints)all.expandByPoint(new Vector3(...p));
    const low=new Box3();for(const p of allPoints)if(p[1]<all.min.y+Math.min(2,(all.max.y-all.min.y)*.15))low.expandByPoint(new Vector3(...p));
    const lc=low.getCenter(new Vector3()),ls=low.getSize(new Vector3()),ac=all.getCenter(new Vector3()),as=all.getSize(new Vector3());
    if(opts.collider==='trunk')faces=[{type:'capsule',a:[r(lc.x),0,r(lc.z)],b:[r(lc.x),r(Math.max(1.2,as.y*.45)),r(lc.z)],radius:r(Math.min(.6,Math.max(.15,Math.min(ls.x,ls.z)*.35)))}];
    else if(opts.collider==='box')faces=[{type:'box',center:[r(ac.x),r(ac.y),r(ac.z)],halfExtents:[r(Math.max(.05,as.x*.42)),r(Math.max(.05,as.y/2)),r(Math.max(.05,as.z*.42))]}];
    else if(opts.collider==='solid')faces=solidColumns(allTris);
    else if(opts.collider==='legs'){
      // Lattice tower: one box per corner leg (its lowest 2 m), open between the legs.
      const h=Math.min(as.y,opts.footing??4);faces=[];
      // Leg feet: low vertices clustered by proximity (legs may stand on the diagonals or the axes).
      const feet=[];for(const p of allPoints)if(p[1]<all.min.y+.4){const f=feet.find(f=>Math.hypot(f.seed[0]-p[0],f.seed[2]-p[2])<1.5);if(f)f.box.expandByPoint(new Vector3(...p));else feet.push({seed:p,box:new Box3().setFromPoints([new Vector3(...p)])});}
      for(const {box:b}of feet){const c=b.getCenter(new Vector3()),s=b.getSize(new Vector3());faces.push({type:'box',center:[r(c.x),r(h/2),r(c.z)],halfExtents:[r(Math.max(.25,s.x/2)),r(h/2),r(Math.max(.25,s.z/2))]});}
    }
    else if(opts.collider==='footing'){const h=Math.min(as.y,opts.footing??4);faces=[{type:'box',center:[r(lc.x),r(h/2),r(lc.z)],halfExtents:[r(Math.max(.1,ls.x/2)),r(h/2),r(Math.max(.1,ls.z/2))]}];}
    else faces=[];
  }
  // Merge adjoining rectangles only when their two other dimensions match.
  // Doorways and stairwell holes are never filled by merging disconnected faces.
  if((opts.collider??"faces")==="faces")for(let pass=0;pass<2;pass++)for(let axis=0;axis<3;axis++){
    const groups=new Map();
    for(const f of faces){const key=[0,1,2].filter(i=>i!==axis).flatMap(i=>[f.center[i],f.halfExtents[i]]).map(v=>Math.round(v*200)).join(',');const list=groups.get(key)??[];list.push(f);groups.set(key,list);}
    faces=[];
    for(const group of groups.values()){
      group.sort((a,b)=>a.center[axis]-a.halfExtents[axis]-(b.center[axis]-b.halfExtents[axis]));
      let current;
      for(const f of group){if(current&&f.center[axis]-f.halfExtents[axis]<=current.center[axis]+current.halfExtents[axis]+.001){const low=current.center[axis]-current.halfExtents[axis],high=Math.max(current.center[axis]+current.halfExtents[axis],f.center[axis]+f.halfExtents[axis]);current.center[axis]=r((low+high)/2);current.halfExtents[axis]=r((high-low)/2);}else{current=structuredClone(f);faces.push(current);}}
    }
  }
  definitions.push({id:'imported.'+name,numericId,name,category:opts.category??'structure',model:{kind:'glb',path:'prepared/'+name+'.glb'},colliders:faces,collisionLayer:numericId<2400||opts.collider==='none'?'none':'static',bounds:{radius:r(Math.hypot(size.x,size.z)*scale/2),height:r(size.y*scale-foundation)},render:{maxDistance:numericId<2400?350:opts.category==='vegetation'?200:opts.category==='tree'?900:opts.category?700:opts.tags?.includes('power-grid')||name==='tower_crane'?1400:1000,...(opts.category==='tree'||opts.category==='vegetation'?{sway:.1}:{})},tags:opts.tags??[numericId<2400?'drivable':'imported-building']});
  console.log(name,Math.round(result.length/1024)+' KB',colliders.size+' collision faces',size.clone().multiplyScalar(scale).toArray().map(r));
}
await fs.writeFile(sourceOut.replace(/\.ts$/,'.json'),JSON.stringify(definitions));
await fs.writeFile(sourceOut,`// Generated by apps/web/scripts/prepare-world-assets.mjs; do not edit by hand.\nimport type { AssetDefinitionInput } from './schema';\nimport definitions from './imported-assets.json';\nexport const IMPORTED_ASSETS = definitions as unknown as readonly AssetDefinitionInput[];\n`);
await fs.writeFile(cacheFile,signature);
