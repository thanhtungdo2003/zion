'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createDefaultRegistry } from '@zion/assets';
import { BATTLE_MAP } from '@zion/shared';
import { WorldGenerator, authoredWorld, checkpoint, currentIsland, normalizeSeed, openIsland, readIslandDocument, rollback, rollbackPass, terrainPass, townParcels, townRoadPass, ruralSettlementPass, type AuthoredMap, type IslandDocument } from '@zion/worldgen';
import { Icon } from './Icon';
import WorldMapCanvas, { FULL_ISLAND, constrainViewport, type MapLayers } from './WorldMapCanvas';
import styles from './WorldEditor.module.css';

const registry = createDefaultRegistry();
const storageKey = 'zion-island-editor-v1';
const createGenerator = (battleIsland: AuthoredMap) => new WorldGenerator({ seed: normalizeSeed(BATTLE_MAP.seed), sizeChunks: BATTLE_MAP.sizeChunks, mode: 'battle-royale', battleIsland }, registry);
const tools = [
  { id: 'terrain', name: 'Địa hình', detail: 'Cao độ & bề mặt', icon: 'mountain', action: 'Cải thiện địa hình', description: 'Điều chỉnh ba vùng địa hình, bảo vệ bờ biển, địa danh, đường và công trình hiện có.' },
  { id: 'roads', name: 'Mạng lưới đường', detail: 'Kết nối & giao thông', icon: 'route', action: 'Tạo đường Thạch Lâm', description: 'Bổ sung đường nhánh tại Thạch Lâm, dựa trên cao độ và các công trình hiện có.' },
  { id: 'parcels', name: 'Ô phố & lô đất', detail: 'Phân khu xây dựng', icon: 'layout-grid', action: 'Phân tích lô đất', description: 'Tìm các ô phố khép kín và lô xây dựng. Giữ nguyên công trình có liên kết gameplay.' },
  { id: 'settlement', name: 'Khu dân cư', detail: 'Công trình & mật độ', icon: 'house', action: 'Bổ sung nhà nông thôn', description: 'Đặt nhà vào lô mặt đường hợp lệ tại làng và nông trại. Cần kiểm tra lối vào trong game.' },
  { id: 'environment', name: 'Môi trường', detail: 'Cây xanh & chi tiết', icon: 'trees', action: 'Bổ sung chi tiết sân', description: 'Thêm hàng rào và bụi cây quanh nhà mới, giữ khoảng trống ở mặt hướng ra đường.' },
] as const;
type Tool = typeof tools[number]['id'];
const passNames: Record<string, string> = { baseline: 'Bản đồ gốc', terrain: 'Địa hình', roads: 'Mạng lưới đường', settlement: 'Khu dân cư', environment: 'Môi trường' };
const layerNames: { id: keyof MapLayers; name: string; icon: string }[] = [
  { id: 'roads', name: 'Đường giao thông', icon: 'route' }, { id: 'buildings', name: 'Công trình', icon: 'house' },
  { id: 'parcels', name: 'Lô quy hoạch', icon: 'layout-grid' }, { id: 'labels', name: 'Địa danh / POI', icon: 'map-pin' },
];
const number = (value: number) => value.toLocaleString('vi-VN');

export default function WorldEditor() {
  const [doc, setDoc] = useState<IslandDocument>(() => openIsland());
  const [radius, setRadius] = useState(160), [delta, setDelta] = useState(4), [sculpt, setSculpt] = useState(false);
  const [active, setActive] = useState<Tool>('terrain');
  const [message, setMessage] = useState('Đã mở bản đồ Đảo Hắc Sơn. Chọn công cụ để bắt đầu chỉnh sửa.');
  const [ready, setReady] = useState(false), [saved, setSaved] = useState(false);
  const [compare, setCompare] = useState(true);
  const [viewport, setViewport] = useState(FULL_ISLAND);
  const [position, setPosition] = useState<{ x: number; z: number } | null>(null);
  const [layers, setLayers] = useState<MapLayers>({ roads: true, buildings: true, parcels: true, labels: true });
  const fileInput = useRef<HTMLInputElement>(null);
  const baseline = useMemo(() => createGenerator(currentIsland(openIsland())), []);
  const gen = useMemo(() => createGenerator(currentIsland(doc)), [doc]);
  const world = useMemo(() => authoredWorld(gen), [gen]);
  const parcels = useMemo(() => townParcels(world.map), [world]);
  const tool = tools.find(item => item.id === active)!;
  const revision = doc.revisions.length - 1;
  useEffect(() => {
    try { const stored = localStorage.getItem(storageKey); if (stored) { setDoc(readIslandDocument(stored)); setMessage('Đã mở lại phiên bản lưu trên trình duyệt.'); } }
    catch (error) { setMessage(`Không đọc được bản lưu: ${error instanceof Error ? error.message : String(error)}`); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) try { localStorage.setItem(storageKey, JSON.stringify(doc)); setSaved(true); }
    catch { setSaved(false); setMessage('Không đủ bộ nhớ trình duyệt. Hãy xuất JSON để lưu phiên bản.'); }
  }, [doc, ready]);
  const run = (action: () => void) => { try { action(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } };
  const apply = () => run(() => {
    const map = currentIsland(doc);
    if (active === 'terrain') { setDoc(checkpoint(doc, 'terrain', terrainPass(map))); setMessage('Đã cải thiện ba vùng địa hình, bảo vệ bờ biển, POI, đường và công trình.'); }
    if (active === 'roads') { const result = townRoadPass(map, world.structures(), (x, z) => gen.heightAt(x, z)); setDoc(checkpoint(doc, 'roads', result.map)); setMessage(`Đã thêm ${result.map.roads.length - map.roads.length} đường. Bỏ qua: ${result.rejected.join('; ') || 'không'}.`); }
    if (active === 'parcels') { setDoc(checkpoint(doc, 'settlement', map)); setMessage(`Đã phân tích ${parcels.length} lô trong ô phố khép kín. Giữ nguyên công trình có gameplay.`); }
    if (active === 'settlement') { const result = ruralSettlementPass(map, world.structures(), registry, (x, z) => gen.heightAt(x, z), (x, z) => world.coastDistance(x, z)); setDoc(checkpoint(doc, 'settlement', result.map)); setMessage(`Đã thêm ${result.parcels.length} nhà tại làng / nông trại. Cần kiểm tra lối vào trong game.`); }
    if (active === 'environment') { setDoc(checkpoint(doc, 'environment', { ...map, dressExtraBuildings: true })); setMessage('Đã bổ sung hàng rào và bụi cây vào sân nhà mới, giữ lối ra đường.'); }
  });
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'hac-son-editor.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const restore = (index: number) => run(() => { setDoc(rollback(doc, index)); setMessage(`Đã khôi phục phiên bản ${index}.`); });
  const zoom = (factor: number) => setViewport(view => constrainViewport({ ...view, span: view.span * factor }));
  const sculptMap = (x: number, z: number) => run(() => {
    const map = structuredClone(currentIsland(doc)); map.terrainEdits = [...(map.terrainEdits ?? []), { x, z, radius, delta }];
    setDoc(checkpoint(doc, 'terrain', map)); setMessage('Đã lưu nét địa hình. Các vùng được bảo vệ tự loại trừ khỏi chỉnh sửa.');
  });
  return <main className={styles.studio}>
    <header className={styles.topbar}>
      <Link className={styles.brand} href="/studio" aria-label="Về Zion Studio"><span className={styles.brandMark}>Z</span><span>ZION <b>STUDIO</b></span></Link>
      <span className={styles.breadcrumb}><span>/</span> Quản lý thế giới <span>/</span> World Editor</span>
      <div className={styles.topActions}><span className={styles.saveState}><i className={saved ? styles.saved : ''} />{saved ? 'Đã lưu cục bộ' : 'Chưa lưu cục bộ'}</span>
        <button onClick={() => fileInput.current?.click()} title="Mở phiên bản JSON"><Icon name="lucide:folder-open" /><span>Mở bản đồ</span></button>
        <button className={styles.export} onClick={exportFile} title="Xuất phiên bản JSON"><Icon name="lucide:download" /><span>Xuất JSON</span></button>
      </div>
      <input hidden ref={fileInput} type="file" accept="application/json,.json" onChange={async event => {
        const file = event.target.files?.[0]; if (!file) return;
        try { if (file.size > 4_000_000) throw new Error('Tệp quá lớn'); setDoc(readIslandDocument(await file.text())); setMessage('Đã mở phiên bản JSON cùng lịch sử chỉnh sửa.'); }
        catch (error) { setMessage(String(error)); } event.target.value = '';
      }} />
    </header>

    <div className={styles.projectHeader}>
      <div><div className={styles.eyebrow}>WORLD WORKSPACE <span>01 / ISLAND</span></div><div className={styles.titleRow}><h1>Đảo Hắc Sơn</h1><span className={styles.badge}>BẢN CHỈNH SỬA</span></div><p>Giữ bản sắc hòn đảo. Kiến tạo từng khu vực.</p></div>
      <div className={styles.projectMeta}><span><Icon name="lucide:scan" />4.096 × 4.096 m</span><span><Icon name="lucide:git-branch" />Phiên bản {revision.toString().padStart(2, '0')}</span><button disabled={revision === 0} onClick={() => restore(revision - 1)}><Icon name="lucide:undo-2" />Hoàn tác</button></div>
    </div>

    <div className={styles.workbench}>
      <aside className={styles.sidebar} aria-label="Công cụ và lớp bản đồ">
        <div className={styles.sidebarHeading}><Icon name="lucide:sliders-horizontal" /><h2>Công cụ thế giới</h2></div>
        <nav className={styles.toolList} aria-label="Công cụ chỉnh sửa">{tools.map((item, index) => <button key={item.id} className={active === item.id ? styles.activeTool : ''} aria-pressed={active === item.id} onClick={() => { setActive(item.id); if (item.id !== 'terrain') setSculpt(false); }}><Icon name={`lucide:${item.icon}`} /><span><strong>{item.name}</strong><small>{item.detail}</small></span><em>0{index + 1}</em></button>)}</nav>
        <div className={styles.layers}><div className={styles.sectionTitle}><h2>Lớp hiển thị</h2><Icon name="lucide:layers" /></div>{layerNames.map(layer => <label key={layer.id}><Icon name={`lucide:${layer.icon}`} /><span>{layer.name}</span><input type="checkbox" data-testid={`layer-${layer.id}`} checked={layers[layer.id]} onChange={event => setLayers({ ...layers, [layer.id]: event.target.checked })} /></label>)}</div>
        <div className={styles.protected}><Icon name="lucide:shield-check" /><strong>Bảo toàn bản đồ gốc</strong><p>Bờ biển, địa danh và các đối tượng gameplay được giữ trong bản gốc để khôi phục.</p><span>BASELINE ĐƯỢC LƯU RIÊNG</span></div>
      </aside>

      <section className={styles.workspace} aria-label="Không gian bản đồ">
        <div className={styles.mapToolbar}><div className={styles.viewTabs}><button aria-pressed={compare} onClick={() => setCompare(true)}><Icon name="lucide:columns-2" />So sánh</button><button aria-pressed={!compare} onClick={() => setCompare(false)}><Icon name="lucide:map" />Bản chỉnh sửa</button></div><button className={styles.fitButton} onClick={() => setViewport(FULL_ISLAND)} title="Xem toàn đảo"><Icon name="lucide:maximize" /><span>Toàn đảo</span></button></div>
        <div className={styles.locationBar}><span><Icon name="lucide:map-pin" />Địa danh</span><select aria-label="Đi đến địa danh" defaultValue="" onChange={event => { const area = world.areas().find(item => item.id === event.target.value); if (area) setViewport(constrainViewport({ x: area.x, z: area.z, span: 1024 })); }}><option value="" disabled>Đi đến một khu vực…</option>{world.areas().map(area => <option key={area.id} value={area.id}>{area.name}</option>)}</select><span className={styles.mapType}>BẢN ĐỒ ĐỊA HÌNH</span></div>
        <div className={`${styles.mapGrid} ${!compare ? styles.singleMap : ''}`}>
          {compare && <div className={styles.mapPane}><div className={styles.paneHeading}><span><i />Bản đồ gốc</span><small>BASELINE</small></div><WorldMapCanvas gen={baseline} viewport={viewport} layers={layers} onPan={setViewport} onPosition={setPosition} label="Bản đồ gốc Đảo Hắc Sơn" /><div className={styles.paneFoot}><Icon name="lucide:lock-keyhole" />Chỉ đọc · luôn có thể khôi phục</div></div>}
          <div className={styles.mapPane}><div className={`${styles.paneHeading} ${styles.revisionHeading}`}><span><i />Bản chỉnh sửa</span><small>REV {revision.toString().padStart(2, '0')}</small></div><WorldMapCanvas gen={gen} viewport={viewport} layers={layers} onPan={setViewport} onPosition={setPosition} onSculpt={sculpt ? sculptMap : undefined} label="Bản chỉnh sửa Đảo Hắc Sơn" /><div className={styles.paneFoot}><Icon name={sculpt ? 'lucide:paintbrush' : 'lucide:move'} />{sculpt ? 'Chạm bản đồ để chỉnh cao độ' : 'Kéo bản đồ để di chuyển'}</div></div>
        </div>
        <div className={`${styles.mapControls} ${!compare ? styles.singleControls : ''}`}><span className={styles.north}>↑ <b>B</b></span><span className={styles.scale}><i />{number(Math.round(viewport.span / 4))} m</span><span className={styles.coordinates}>{position ? `X ${Math.round(position.x)} · Z ${Math.round(position.z)}` : 'X — · Z —'}</span><div className={styles.zoom}><button aria-label="Thu nhỏ bản đồ" disabled={viewport.span >= 4096} onClick={() => zoom(2)}><Icon name="lucide:minus" /></button><output data-testid="zoom">{Math.round(4096 / viewport.span * 100)}%</output><button aria-label="Phóng to bản đồ" disabled={viewport.span <= 256} onClick={() => zoom(.5)}><Icon name="lucide:plus" /></button></div></div>
        <div className={styles.legend}><span><i style={{ background: '#d2c6a7' }} />Đường giao thông</span><span><i style={{ background: '#e9b968' }} />Phạm vi công trình</span><span><i style={{ background: '#71c8b2' }} />Lô quy hoạch</span></div>
        <div className={styles.stats}>{[{ value: world.areas().length, label: 'Địa danh / POI', icon: 'map-pin' }, { value: world.structures().length, label: 'Công trình / site', icon: 'house' }, { value: world.map.roads.length, label: 'Tuyến đường', icon: 'route' }, { value: parcels.length + (world.map.extraBuildings?.length ?? 0), label: 'Lô quy hoạch', icon: 'layout-grid' }].map(stat => <div key={stat.label}><Icon name={`lucide:${stat.icon}`} /><strong data-site-count={stat.icon === 'house' ? stat.value : undefined}>{number(stat.value)}</strong><span>{stat.label}</span></div>)}</div>
        <div className={styles.status} role="status"><Icon name="lucide:info" /><span>{message}</span></div>
      </section>

      <aside className={styles.inspector} aria-label="Thông số và lịch sử">
        <section className={styles.settings}><div className={styles.sectionTitle}><h2>Thiết lập công cụ</h2><span>0{tools.findIndex(item => item.id === active) + 1}</span></div><div className={styles.toolHeading}><span><Icon name={`lucide:${tool.icon}`} /></span><div><small>ĐANG CHỌN</small><h3>{tool.name}</h3></div></div><p className={styles.description}>{tool.description}</p>
          <button className={styles.primary} onClick={apply}><Icon name="lucide:wand-sparkles" />{tool.action}<Icon name="lucide:arrow-right" /></button>
          {active === 'terrain' && <div className={styles.brush}><label className={styles.sculptToggle}><span><Icon name="lucide:paintbrush" />Bút chỉnh địa hình</span><input data-testid="sculpt-toggle" type="checkbox" checked={sculpt} onChange={event => setSculpt(event.target.checked)} /></label><p>Chỉnh cao độ trực tiếp trên bản đồ.</p><label className={styles.sliderLabel}>Bán kính bút <output>{radius} m</output><input type="range" min={16} max={600} step={8} value={radius} onChange={event => setRadius(Number(event.target.value))} /></label><label className={styles.sliderLabel}>Thay đổi cao độ <output>{delta > 0 ? '+' : ''}{delta} m</output><input type="range" min={-12} max={12} value={delta} onChange={event => setDelta(Number(event.target.value))} /></label><div className={styles.rangeEnds}><span>Hạ địa hình</span><span>Nâng địa hình</span></div></div>}
          <div className={styles.checkpointNote}><Icon name="lucide:git-commit-horizontal" />Mỗi lần áp dụng tạo một mốc khôi phục.</div>
        </section>
        <section className={styles.history}><div className={styles.sectionTitle}><h2>Lịch sử phiên bản</h2><span>{doc.revisions.length.toString().padStart(2, '0')}</span></div><ol>{doc.revisions.map((item, index) => <li className={index === revision ? styles.currentRevision : ''} key={index}><span className={styles.timelineDot} /><div><strong>{passNames[item.pass] ?? item.pass}{item.action === 'rollback' ? ' · Hoàn tác' : ''}</strong><small>Phiên bản {index.toString().padStart(2, '0')} · {item.map.terrainEdits?.length ?? 0} nét địa hình</small></div><button disabled={index === revision} aria-label={`Khôi phục phiên bản ${index}`} title={index === revision ? 'Phiên bản hiện tại' : `Khôi phục phiên bản ${index}`} onClick={() => restore(index)}><Icon name={index === revision ? 'lucide:check' : 'lucide:rotate-ccw'} /></button></li>)}</ol>
          <details className={styles.rollback}><summary>Hoàn tác từng lượt</summary><div>{(['terrain', 'roads', 'settlement', 'environment'] as const).map(pass => <button key={pass} onClick={() => run(() => { setDoc(rollbackPass(doc, pass)); setMessage(`Đã hoàn tác lượt ${passNames[pass]} gần nhất. Cần kiểm chứng lại phiên bản.`); })}><Icon name="lucide:undo-2" />{passNames[pass]}</button>)}</div></details>
        </section>
        <div className={styles.localNotice}><Icon name="lucide:hard-drive" /><div><strong>Không gian chỉnh sửa cục bộ</strong><p>Thay đổi lưu trong trình duyệt. Xuất JSON để giữ bản sao. Chưa áp dụng lên máy chủ trận đấu.</p></div></div>
      </aside>
    </div>
    <footer className={styles.footer}><span><i />ZION WORLD EDITOR <b>·</b> Dữ liệu bản đồ thực tế</span><span>Bản đồ phân tích 2D · Kiểm tra mô hình, cửa và di chuyển trong game</span></footer>
  </main>;
}
