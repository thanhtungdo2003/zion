'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HudState } from '@/game/hud-store';
import { MAP_ICONS, type WorldMapStore } from '@/game/world-map';
import { mapToScreen, screenToMap, zoomMap, type MapCamera } from '@/game/map-camera';
import { Icon } from './Icon';
import { AtlasTiles } from '@/game/atlas-tiles';

function decodeRaster(source: { pixels: number; rgb: string }): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = cv.height = source.pixels;
  const ctx = cv.getContext('2d')!, data = ctx.createImageData(cv.width, cv.height), rgb = atob(source.rgb);
  for (let i = 0; i < cv.width * cv.height; i++) {
    data.data[i * 4] = rgb.charCodeAt(i * 3); data.data[i * 4 + 1] = rgb.charCodeAt(i * 3 + 1); data.data[i * 4 + 2] = rgb.charCodeAt(i * 3 + 2); data.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return cv;
}

export function WorldMap({ store, hud, onClose }: { store: WorldMapStore; hud: HudState; onClose: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), close = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 600, height: 500 });
  const [camera, setCamera] = useState<MapCamera>(() => state.camera ?? ({ x: state.world?.camp?.x ?? hud.position[0], z: state.world?.camp?.z ?? hud.position[2], scale: 0.2 }));
  const fitted = useRef(!!state.camera);
  const tiles = useRef<AtlasTiles | null>(null);
  const tileRasters = useRef(new Map<string, HTMLCanvasElement>());
  const [tileRevision, setTileRevision] = useState(0);
  useEffect(() => {
    if (!state.world) return;
    const cache = new AtlasTiles(state.world.worldId, () => setTileRevision((n) => n + 1));
    tiles.current = cache;
    const rasters = tileRasters.current;
    return () => { cache.dispose(); rasters.clear(); tiles.current = null; };
  }, [state.world]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!state.world || camera.scale < 0.75) { tiles.current?.setVisible([]); return; }
      const tl = screenToMap(0, 0, size.width, size.height, camera), br = screenToMap(size.width, size.height, size.width, size.height, camera);
      const count = Math.ceil(state.world.sizeChunks * state.world.chunkSize / 256), keys: Array<{ key: string; distance: number }> = [];
      for (let z = Math.max(0, Math.floor(tl.z / 256)); z <= Math.min(count - 1, Math.floor(br.z / 256)); z++) {
        for (let x = Math.max(0, Math.floor(tl.x / 256)); x <= Math.min(count - 1, Math.floor(br.x / 256)); x++) {
          keys.push({ key: `${x}:${z}`, distance: Math.hypot(x * 256 + 128 - camera.x, z * 256 + 128 - camera.z) });
        }
      }
      tiles.current?.setVisible(keys.sort((a, b) => a.distance - b.distance).slice(0, 64).map((k) => k.key));
    }, 150);
    return () => clearTimeout(timer);
  }, [camera, size, state.world]);
  useEffect(() => { if (fitted.current) store.setCamera(camera); }, [camera, store]);
  useEffect(() => { void store.loadAtlas(); return () => store.flush(); }, [store]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ x: number; z: number } | null>(null);
  const [name, setName] = useState(''), [icon, setIcon] = useState<string>(MAP_ICONS[0].id);
  const [notice, setNotice] = useState('');
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ x: 0, y: 0, moved: false });
  const location = state.locations.find((m) => m.id === selected);
  const raster = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    close.current?.focus();
    const el = host.current;
    if (!el) return;
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
      if (!fitted.current && width && height) { fitted.current = true; setCamera((c) => ({ ...c, scale: Math.min(width, height) / 2200 })); }
    });
    resize.observe(el);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (!state.atlas) return;
    raster.current = decodeRaster(state.atlas);
  }, [state.atlas]);
  useEffect(() => {
    const cv = canvas.current, atlas = state.atlas;
    if (!cv || !size.width || !size.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(size.width * dpr); cv.height = Math.round(size.height * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr); ctx.fillStyle = '#030506'; ctx.fillRect(0, 0, size.width, size.height);
    const to = (x: number, z: number) => mapToScreen(x, z, size.width, size.height, camera);
    ctx.save(); ctx.beginPath();
    const camp = state.world?.camp;
    if (camp) { const c = to(camp.x, camp.z); ctx.arc(c.x, c.y, 1000 * camera.scale, 0, Math.PI * 2); }
    for (const [z, spans] of store.exploration.rows) {
      const sy = to(0, z).y;
      if (sy + camera.scale < 0 || sy > size.height) continue;
      for (const [a, b] of spans) { const p = to(a, z); ctx.rect(p.x, p.y, (b - a) * camera.scale, camera.scale + 0.1); }
    }
    ctx.clip();
    const origin = to(0, 0), worldSize = state.world ? state.world.sizeChunks * state.world.chunkSize : 4096;
    ctx.fillStyle = '#26352b'; ctx.fillRect(origin.x, origin.y, worldSize * camera.scale, worldSize * camera.scale);
    if (atlas && raster.current) { ctx.imageSmoothingEnabled = true; ctx.drawImage(raster.current, origin.x, origin.y, atlas.size * camera.scale, atlas.size * camera.scale); }
    if (camera.scale >= 0.75 && tiles.current) {
      for (const key of tileRasters.current.keys()) if (!tiles.current.tiles.has(key)) tileRasters.current.delete(key);
      for (const [key, tile] of tiles.current.tiles) {
        const p = to(tile.x, tile.z), side = tile.size * camera.scale;
        if (p.x + side < 0 || p.y + side < 0 || p.x > size.width || p.y > size.height) continue;
        let image = tileRasters.current.get(key);
        if (!image) { image = decodeRaster(tile); tileRasters.current.set(key, image); }
        ctx.imageSmoothingEnabled = false; ctx.drawImage(image, p.x, p.y, side, side);
      }
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const road of atlas?.roads ?? []) {
      const a = to(road.ax, road.az), b = to(road.bx, road.bz);
      const margin = road.width * camera.scale;
      if (Math.max(a.x, b.x) < -margin || Math.min(a.x, b.x) > size.width + margin || Math.max(a.y, b.y) < -margin || Math.min(a.y, b.y) > size.height + margin) continue;
      ctx.strokeStyle = road.bridge ? '#92978e' : road.paved ? '#606562' : '#9a805a';
      // Short strokes approximate the smooth widening used by the physical roadbed.
      const pieces = road.widthA !== road.widthB ? 6 : 1;
      for (let i = 0; i < pieces; i++) {
        const t = (i + .5) / pieces, u = t * t * (3 - 2 * t);
        const width = (road.widthA ?? road.width) + ((road.widthB ?? road.width) - (road.widthA ?? road.width)) * u;
        ctx.lineWidth = Math.max(.8, width * camera.scale);
        ctx.beginPath(); ctx.moveTo(a.x + (b.x - a.x) * i / pieces, a.y + (b.y - a.y) * i / pieces);
        ctx.lineTo(a.x + (b.x - a.x) * (i + 1) / pieces, a.y + (b.y - a.y) * (i + 1) / pieces); ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
    if (atlas) for (const building of atlas.structures) {
      const p = to(building.x, building.z), r = Math.max(1.5, building.radius * camera.scale * 0.65);
      if (p.x < -r || p.y < -r || p.x > size.width + r || p.y > size.height + r) continue;
      ctx.fillStyle = '#685b44'; ctx.strokeStyle = '#b6a37c'; ctx.lineWidth = 0.7;
      ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2); ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
    }
    if (atlas?.campParts) for (const part of atlas.campParts) {
      const p = to(part.x, part.z), radius = Math.hypot(part.halfX, part.halfZ) * camera.scale;
      if (p.x < -radius || p.y < -radius || p.x > size.width + radius || p.y > size.height + radius) continue;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-part.yaw);
      ctx.fillStyle = '#8b7958'; ctx.strokeStyle = '#ddc48a'; ctx.lineWidth = 0.8;
      const hx = part.halfX * camera.scale, hz = part.halfZ * camera.scale;
      ctx.fillRect(-hx, -hz, hx * 2, hz * 2); ctx.strokeRect(-hx, -hz, hx * 2, hz * 2);
      ctx.restore();
    }
    ctx.restore();
    // Survey grid stays subtle; unknown terrain remains black beneath it.
    const grid = camera.scale > 1 ? 50 : camera.scale > 0.2 ? 250 : 1000;
    const tl = screenToMap(0, 0, size.width, size.height, camera), br = screenToMap(size.width, size.height, size.width, size.height, camera);
    ctx.strokeStyle = 'rgba(180,190,170,.11)'; ctx.lineWidth = 1; ctx.font = '10px monospace'; ctx.fillStyle = '#8a9384';
    for (let x = Math.ceil(tl.x / grid) * grid; x < br.x; x += grid) { const p = to(x, 0); ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, size.height); ctx.stroke(); ctx.fillText(String(x), p.x + 4, 14); }
    for (let z = Math.ceil(tl.z / grid) * grid; z < br.z; z += grid) { const p = to(0, z); ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(size.width, p.y); ctx.stroke(); ctx.fillText(String(z), 4, p.y - 4); }
    if (camp) { const c = to(camp.x, camp.z); ctx.beginPath(); ctx.arc(c.x, c.y, 1000 * camera.scale, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,176,0,.45)'; ctx.setLineDash([5, 7]); ctx.stroke(); }
  }, [camera, size, state.atlas, state.world, state.revision, store, tileRevision]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); const r = el.getBoundingClientRect();
      setCamera((c) => zoomMap(c, Math.exp(-event.deltaY * 0.0015), event.clientX - r.left, event.clientY - r.top, r.width, r.height));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const choose = (id: string) => {
    const m = state.locations.find((l) => l.id === id);
    if (!m) return;
    setSelected(id); setDraft(null); setName(m.name); setIcon(m.icon); setNotice('');
  };
  const beginDraft = (x: number, z: number) => {
    if (!store.known(x, z)) { setNotice('Hãy khám phá khu vực này trước khi đánh dấu.'); return; }
    setDraft({ x, z }); setSelected(null); setName(''); setIcon(MAP_ICONS[0].id); setNotice('');
  };
  const markers = state.locations.map((m) => ({ location: m, screen: mapToScreen(m.x, m.z, size.width, size.height, camera) }));
  const player = mapToScreen(hud.position[0], hud.position[2], size.width, size.height, camera);
  const zoom = (factor: number) => setCamera((c) => zoomMap(c, factor, size.width / 2, size.height / 2, size.width, size.height));
  const barMeters = camera.scale > 1 ? 50 : camera.scale > 0.2 ? 250 : 1000;
  return <div className="atlas-overlay" role="dialog" aria-modal="true" aria-labelledby="atlas-title" onKeyDown={(e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    if (e.key === 'Tab') {
      const items = e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select');
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }}>
    <section className="atlas-panel">
      <header className="atlas-header"><div><span className="q-kicker">ZION // BẢN ĐỒ THỰC ĐỊA</span><h2 id="atlas-title"><Icon name="lucide:map" /> Bản đồ sinh tồn</h2></div><span className="atlas-status"><i /> Vùng căn cứ · R 1 KM</span><button ref={close} className="atlas-close" onClick={onClose} aria-label="Đóng bản đồ (M / Esc)"><Icon name="lucide:x" /><kbd>M</kbd></button></header>
      <div className="atlas-body">
        <div className="atlas-viewport" ref={host}
          onPointerDown={(e) => {
            if ((e.target as Element).closest('button')) return;
            e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId);
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            gesture.current = { x: e.clientX, y: e.clientY, moved: pointers.current.size > 1 };
          }}
          onPointerMove={(e) => {
            const previous = pointers.current.get(e.pointerId); if (!previous) return;
            if (Math.hypot(e.clientX - gesture.current.x, e.clientY - gesture.current.y) > 5) gesture.current.moved = true;
            const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)?.[1];
            if (other) {
              gesture.current.moved = true;
              const oldDistance = Math.hypot(previous.x - other.x, previous.y - other.y), distance = Math.hypot(e.clientX - other.x, e.clientY - other.y);
              const r = e.currentTarget.getBoundingClientRect();
              if (oldDistance > 5) setCamera((c) => zoomMap(c, distance / oldDistance, (e.clientX + other.x) / 2 - r.left, (e.clientY + other.y) / 2 - r.top, r.width, r.height));
            } else { const dx = e.clientX - previous.x, dy = e.clientY - previous.y; setCamera((c) => ({ ...c, x: c.x - dx / c.scale, z: c.z - dy / c.scale })); }
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          }}
          onPointerUp={(e) => {
            if (!pointers.current.has(e.pointerId)) return;
            const click = !gesture.current.moved && pointers.current.size === 1;
            pointers.current.delete(e.pointerId);
            if (click) { const r = e.currentTarget.getBoundingClientRect(); const p = screenToMap(e.clientX - r.left, e.clientY - r.top, r.width, r.height, camera); beginDraft(p.x, p.z); }
          }} onPointerCancel={(e) => pointers.current.delete(e.pointerId)}>
          <canvas ref={canvas} aria-label="Địa hình và vùng đã khám phá" />
          {hud.quests.filter((q) => q.status === 'active' && !q.locked && q.target).map((q) => { const p = mapToScreen(q.target!.x, q.target!.z, size.width, size.height, camera); return p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height ? <div key={q.id} className="atlas-mission" style={{ left: p.x, top: p.y }} title={q.title}><Icon name="lucide:crosshair" /><span>{q.title}</span></div> : null; })}
          {markers.filter(({ location: m, screen: p }) => p.x >= -20 && p.y >= -20 && p.x <= size.width + 20 && p.y <= size.height + 20 && store.known(m.x, m.z)).map(({ location: m, screen: p }) => <button key={m.id} className={`atlas-pin${selected === m.id ? ' selected' : ''}${m.fixed ? ' fixed' : ''}`} style={{ left: p.x, top: p.y }} title={m.name} onClick={() => choose(m.id)}><Icon name={m.icon} />{(selected === m.id || camera.scale > 0.6) && <span>{m.name}</span>}{m.quest && <b>!</b>}</button>)}
          {player.x >= 0 && player.y >= 0 && player.x <= size.width && player.y <= size.height && <div className="atlas-player" style={{ left: player.x, top: player.y }} title="Bạn"><Icon name="lucide:navigation" /></div>}
          {hud.team?.members.filter((m) => m.inGame && m.x !== undefined && m.z !== undefined && m.name !== hud.username).map((m) => { const p = mapToScreen(m.x!, m.z!, size.width, size.height, camera); return p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height ? <div key={m.accountId} className="atlas-teammate" style={{ left: p.x, top: p.y }} title={m.name}><i /><span>{m.name}</span></div> : null; })}
          {draft && (() => { const p = mapToScreen(draft.x, draft.z, size.width, size.height, camera); return <div className="atlas-draft" style={{ left: p.x, top: p.y }}><Icon name={icon} /></div>; })()}
          <div className="atlas-compass">N<Icon name="lucide:arrow-up" /></div>
          <div className="atlas-tools"><button onClick={() => zoom(1.4)} aria-label="Phóng to"><Icon name="lucide:plus" /></button><button onClick={() => zoom(1 / 1.4)} aria-label="Thu nhỏ"><Icon name="lucide:minus" /></button><button title="Về vị trí của bạn" onClick={() => setCamera((c) => ({ ...c, x: hud.position[0], z: hud.position[2] }))}><Icon name="lucide:locate-fixed" /></button><button title="Toàn cảnh căn cứ" onClick={() => setCamera({ x: state.world?.camp?.x ?? hud.position[0], z: state.world?.camp?.z ?? hud.position[2], scale: Math.min(size.width, size.height) / 2200 })}><Icon name="lucide:house" /></button></div>
          <div className="atlas-scale"><span style={{ width: barMeters * camera.scale }} />{barMeters >= 1000 ? `${barMeters / 1000} km` : `${barMeters} m`}</div>
          {!state.atlas && <div className="atlas-loading">{state.error ? <><span>{state.error}</span><button className="btn" onClick={() => { void store.loadAtlas(); }}>Tải lại</button></> : 'Đang nhận dữ liệu địa hình…'}</div>}
        </div>
        <aside className="atlas-sidebar">
          <div className="atlas-sidebar-head"><span className="q-label">Sổ tay vị trí · {state.locations.length}</span><label className="atlas-check"><input type="checkbox" checked={state.arrows} onChange={(e) => store.setArrows(e.target.checked)} /> Mũi tên chỉ đường</label><small>Tắt mũi tên để dùng biểu tượng ghim trên bản đồ nhỏ.</small></div>
          <div className="atlas-locations">{state.locations.map((m) => <div className={`atlas-location${m.id === selected ? ' selected' : ''}`} key={m.id}><button onClick={() => { choose(m.id); setCamera((c) => ({ ...c, x: m.x, z: m.z })); }}><Icon name={m.icon} /><span><b>{m.name}</b><small>{Math.round(Math.hypot(m.x - hud.position[0], m.z - hud.position[2]))} m · {m.fixed ? 'Căn cứ' : `${Math.round(m.x)}, ${Math.round(m.z)}`}</small></span>{m.fixed && <Icon name="lucide:lock-keyhole" />}</button><button className={m.guide ? 'on' : ''} title={m.guide ? 'Tắt chỉ đường' : 'Bật chỉ đường'} aria-label={`Chỉ đường đến ${m.name}`} aria-pressed={m.guide} onClick={() => store.edit(m.id, { guide: !m.guide })}><Icon name="lucide:navigation" /></button></div>)}</div>
          {(draft || location) ? <form className="atlas-editor" onSubmit={(e) => {
            e.preventDefault();
            if (draft) { const id = store.add(draft.x, draft.z, name, icon); if (id) { setSelected(id); setDraft(null); } else setNotice('Không thể thêm vị trí (tối đa 100 vị trí cá nhân).'); }
            else if (location && !location.fixed) store.edit(location.id, { name, icon });
          }}><span className="q-label">{draft ? 'Đánh dấu mới' : location?.fixed ? 'Vị trí căn cứ' : 'Chỉnh sửa vị trí'}</span><input aria-label="Tên vị trí" value={name} maxLength={40} required disabled={location?.fixed} placeholder="Tên vị trí…" onChange={(e) => setName(e.target.value)} />{!location?.fixed && <div className="atlas-icons">{MAP_ICONS.map((i) => <button type="button" key={i.id} className={icon === i.id ? 'on' : ''} title={i.name} aria-label={i.name} aria-pressed={icon === i.id} onClick={() => setIcon(i.id)}><Icon name={i.id} /></button>)}</div>}{location?.fixed ? <small>Vị trí có sẵn của căn cứ luôn được giữ lại.</small> : <div className="atlas-editor-actions"><button className="btn btn-primary" type="submit">{draft ? 'Lưu đánh dấu' : 'Lưu thay đổi'}</button>{location && <button type="button" className="btn" onClick={() => { store.remove(location.id); setSelected(null); }}>Xóa</button>}</div>}<button type="button" className="atlas-text-button" onClick={() => { setDraft(null); setSelected(null); }}>Đóng chỉnh sửa</button></form> : <div className="atlas-help"><Icon name="lucide:mouse-pointer-2" /><p>Kéo để di chuyển · Cuộn hoặc chụm hai ngón để thu phóng.</p><p>Chạm vùng đã khám phá để đặt tên và chọn biểu tượng.</p><button className="btn" onClick={() => beginDraft(hud.position[0], hud.position[2])}>Đánh dấu tại đây</button></div>}
          {notice && <p className="atlas-notice" role="status">{notice}</p>}
        </aside>
      </div>
      <footer className="atlas-footer"><span><i className="atlas-dot" /> Bạn <i className="atlas-dot team" /> Đồng đội</span><span>Khám phá thêm ô 50 × 50 m quanh bước chân · Sổ tay lưu trên thiết bị này</span><span><kbd>M</kbd> / <kbd>Esc</kbd> Đóng</span></footer>
    </section>
  </div>;
}
