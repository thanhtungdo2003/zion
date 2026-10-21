'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createDefaultRegistry } from '@zion/assets';
import { BATTLE_MAP } from '@zion/shared';
import { WorldGenerator, authoredWorld, checkpoint, currentIsland, normalizeSeed, openIsland, readIslandDocument, rollback, rollbackPass, terrainPass, townParcels, townRoadPass, ruralSettlementPass, type AuthoredMap, type IslandDocument } from '@zion/worldgen';

const registry = createDefaultRegistry();
const storageKey = 'zion-island-editor-v1';
const createGenerator = (battleIsland: AuthoredMap) => new WorldGenerator({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, mode: 'battle-royale', battleIsland }, registry);

function IslandView({ gen, onSculpt }: { gen: WorldGenerator; onSculpt?: (x: number, z: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const size = 384, step = gen.worldSize / size, world = authoredWorld(gen);
    const heights = new Float32Array(size * size);
    for (let j=0;j<size;j++) for (let i=0;i<size;i++) heights[j*size+i] = gen.heightAt((i+.5)*step,(j+.5)*step);
    const pixels = ctx.createImageData(size,size);
    for (let j=0;j<size;j++) for (let i=0;i<size;i++) {
      const index=j*size+i, h=heights[index]!, dx=heights[j*size+Math.min(i+1,size-1)]!-h;
      const dz=heights[Math.min(j+1,size-1)*size+i]!-h, shade=Math.max(.5, Math.min(1.4,1-(dx+dz)/step*.4));
      const colour=h<gen.seaLevel ? [25,75,110] : h>100 ? [115,116,95] : [90,128,68];
      for (let k=0;k<3;k++) pixels.data[index*4+k]=colour[k]!*shade;
      pixels.data[index*4+3]=255;
    }
    ctx.putImageData(pixels,0,0);
    for (const road of world.map.roads) {
      ctx.strokeStyle=road.paved?'#c5bca9':'#967149'; ctx.lineWidth=Math.max(1,2*road.width/step); ctx.beginPath();
      road.points.forEach(([x,z],i) => i ? ctx.lineTo(x/step,z/step) : ctx.moveTo(x/step,z/step)); ctx.stroke();
    }
    ctx.strokeStyle='#66ffff'; ctx.lineWidth=.6;
    for (const p of [...townParcels(world.map), ...(world.map.extraBuildings ?? []).flatMap(b=>b.lot?[b.lot]:[])]) { ctx.beginPath(); p.polygon.forEach(([x,z],i)=>i?ctx.lineTo(x/step,z/step):ctx.moveTo(x/step,z/step));ctx.closePath();ctx.stroke(); }
    ctx.fillStyle='#f8c888';
    for (const s of world.structures()) if (s.parts.length && s.radius>2) ctx.fillRect((s.x-s.radius*.5)/step,(s.z-s.radius*.5)/step,Math.max(1,s.radius/step),Math.max(1,s.radius/step));
    ctx.font='8px sans-serif';ctx.fillStyle='white';
    for(const area of world.areas()) ctx.fillText(area.id,area.x/step,area.z/step);
  },[gen]);
  return <canvas ref={ref} width={384} height={384} aria-label="Địa hình, đường và công trình thực tế của Đảo Hắc Sơn" style={{width:'100%',maxWidth:650,cursor:onSculpt?'crosshair':'default',imageRendering:'auto'}} onClick={e=>{const r=e.currentTarget.getBoundingClientRect();onSculpt?.((e.clientX-r.left)/r.width*gen.worldSize,(e.clientY-r.top)/r.height*gen.worldSize);}}/>;
}

export default function WorldEditor() {
  const [doc,setDoc]=useState<IslandDocument>(()=>openIsland());
  const [radius,setRadius]=useState(160),[delta,setDelta]=useState(4),[sculpt,setSculpt]=useState(false);
  const [message,setMessage]=useState('Mở dữ liệu Đảo Hắc Sơn gốc. Chọn công cụ hoặc mở một phiên bản JSON.');
  const [ready,setReady]=useState(false);
  const baseline=useMemo(()=>createGenerator(currentIsland(openIsland())),[]);
  const gen=useMemo(()=>createGenerator(currentIsland(doc)),[doc]);
  const world=authoredWorld(gen),parcels=townParcels(world.map);
  useEffect(()=>{
    try { const saved=localStorage.getItem(storageKey); if(saved) setDoc(readIslandDocument(saved)); }
    catch(e) { setMessage(`Không đọc được bản lưu: ${e instanceof Error?e.message:String(e)}`); }
    setReady(true);
  },[]);
  useEffect(()=>{if(ready)try {localStorage.setItem(storageKey,JSON.stringify(doc));}catch{setMessage('Không đủ bộ nhớ trình duyệt. Hãy xuất JSON để lưu phiên bản.');}},[doc,ready]);
  const run=(action:()=>void)=>{try{action();}catch(e){setMessage(e instanceof Error?e.message:String(e));}};
  const exportFile=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='hac-son-editor.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <main style={{minHeight:'100vh',background:'#131a20',color:'#edf1e8',padding:24,fontFamily:'sans-serif'}}>
    <Link href="/studio">← Studio</Link><h1>World Editor · Đảo Hắc Sơn</h1>
    <p>Bản gốc bên trái · Phiên bản chỉnh sửa bên phải · Đơn vị: mét · Hạt giống: {BATTLE_MAP.seed}</p>
    <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}>
      <button onClick={()=>run(()=>{setDoc(checkpoint(doc,'terrain',terrainPass(currentIsland(doc))));setMessage('Đã áp dụng ba vùng sculpt có bảo vệ bờ biển, POI, đường và công trình.');})}>Terrain Pass</button>
      <button onClick={()=>run(()=>{const result=townRoadPass(currentIsland(doc),world.structures(),(x,z)=>gen.heightAt(x,z));setDoc(checkpoint(doc,'roads',result.map));setMessage(`Road Pass: ${result.map.roads.length-currentIsland(doc).roads.length} đường thêm. Bỏ qua: ${result.rejected.join('; ')||'không'}`);})}>Road Pass · Thạch Lâm</button>
      <button onClick={()=>run(()=>{setDoc(checkpoint(doc,'settlement',currentIsland(doc)));setMessage(`${parcels.length} lô trong các ô phố đã khép kín. Chưa tự di chuyển công trình có gameplay.`);})}>Phân tích ô phố / lô đất</button>
      <button onClick={()=>run(()=>{const result=ruralSettlementPass(currentIsland(doc),world.structures(),registry,(x,z)=>gen.heightAt(x,z),(x,z)=>world.coastDistance(x,z));setDoc(checkpoint(doc,'settlement',result.map));setMessage(`Đã thêm ${result.parcels.length} nhà trong lô mặt đường tại các làng / nông trại. Cần kiểm tra lối vào trong game.`);})}>Settlement Pass · Nông thôn</button>
      <button onClick={()=>run(()=>{setDoc(checkpoint(doc,'environment',{...currentIsland(doc),dressExtraBuildings:true}));setMessage('Đã thêm hàng rào và bụi cây vào sân các nhà mới; mặt hướng đường để mở.');})}>Environment Pass</button>
      <button onClick={exportFile}>Xuất JSON</button>
      <label>Mở JSON <input type="file" accept="application/json,.json" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>4_000_000)throw new Error('Tệp quá lớn');setDoc(readIslandDocument(await file.text()));setMessage('Đã tải lại phiên bản và lịch sử rollback.');}catch(error){setMessage(String(error));}e.target.value='';}}/></label>
    </div>
    <div style={{display:'flex',gap:16,flexWrap:'wrap'}}><label><input type="checkbox" checked={sculpt} onChange={e=>setSculpt(e.target.checked)}/> Sculpt trên bản bên phải</label>
      <label>Bán kính <input type="number" min={16} max={600} value={radius} onChange={e=>setRadius(Number(e.target.value))}/></label>
      <label>Độ cao Δ <input type="number" min={-12} max={12} value={delta} onChange={e=>setDelta(Number(e.target.value))}/></label>
    </div>
    <p role="status">{message}</p>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))',gap:20}}>
      <section><h2>Baseline · khôi phục được</h2><IslandView gen={baseline}/></section>
      <section><h2>Revision {doc.revisions.length-1}</h2><IslandView gen={gen} onSculpt={sculpt?(x,z)=>run(()=>{const map=structuredClone(currentIsland(doc));map.terrainEdits=[...(map.terrainEdits??[]),{x,z,radius,delta}];setDoc(checkpoint(doc,'terrain',map));setMessage('Đã lưu stroke. Vùng được bảo vệ tự loại trừ khỏi chỉnh sửa.');}):undefined}/></section>
    </div>
    <p>{world.areas().length} POI · {world.structures().length} site · {world.map.roads.length} tuyến đường · {parcels.length+(world.map.extraBuildings?.length??0)} lô. Màu vàng: phạm vi công trình; cyan: lô quy hoạch.</p>
    <p>Bản chỉnh sửa lưu trong trình duyệt và tệp JSON. Chưa kích hoạt trên máy chủ trận đấu. Góc nhìn này là bản đồ phân tích; cần kiểm tra mô hình, cửa và di chuyển trong game trước khi nghiệm thu.</p>
    <h2>Lịch sử / rollback</h2>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{(['terrain','roads','settlement','environment'] as const).map(pass=><button key={pass} onClick={()=>run(()=>{setDoc(rollbackPass(doc,pass));setMessage(`Đã hoàn tác lượt ${pass} gần nhất, giữ các pass khác. Cần kiểm chứng lại revision sau rollback.`);})}>Hoàn tác riêng {pass}</button>)}</div>
    <ol>{doc.revisions.map((r,i)=><li key={i}>{r.pass}{r.action==='rollback'?' (hoàn tác)':''} · {r.map.terrainEdits?.length??0} stroke · <button disabled={i===doc.revisions.length-1} onClick={()=>run(()=>{setDoc(rollback(doc,i));setMessage(`Đã khôi phục revision ${i}.`);})}>Khôi phục</button></li>)}</ol>
  </main>;
}
