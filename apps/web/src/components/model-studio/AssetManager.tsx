'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACESFilmicToneMapping, BoxGeometry, Color, DirectionalLight, Fog, Group, HemisphereLight, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createDefaultRegistry, type AssetDefinition } from '@zion/assets';
import { Icon } from '@/components/Icon';
import { msApi, type AssetOverrideInfo } from '@/lib/model-studio-api';
import { AssetLibrary, VARIANT_ID } from '@/game/render/asset-library';
import s from './model-studio.module.css';

const GROUPS: Array<{ id: AssetDefinition['category'] | 'all'; name: string }> = [
  { id: 'tree', name: 'Cây' }, { id: 'vegetation', name: 'Bụi cỏ' }, { id: 'rock', name: 'Đá' },
  { id: 'decor', name: 'Đồ vật' }, { id: 'structure', name: 'Công trình' }, { id: 'block', name: 'Khối xây' }, { id: 'all', name: 'Tất cả' },
];

/**
 * "Tài nguyên game": the models already in the game (trees, grass and bushes, rocks, props,
 * buildings) with a preview as the game draws them (its lighting, materials and wear, at real size
 * beside a person), and the changes the Studio can make to them: replace a model with another
 * file, mix new models in among one's instances (more variety), take one out of the game, and
 * undo any of these. Changes apply to every map, the next time a match or the World Studio loads.
 */
export function AssetManager({ flash }: { flash: (text: string) => void }) {
  const registry = useMemo(() => createDefaultRegistry(), []);
  const [group, setGroup] = useState<(typeof GROUPS)[number]['id']>('vegetation');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [overrides, setOverrides] = useState<AssetOverrideInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [weight, setWeight] = useState(1);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<{ library: AssetLibrary; stage: Group; camera: PerspectiveCamera; controls: OrbitControls } | null>(null);
  const replaceInput = useRef<HTMLInputElement>(null), variantInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try { setOverrides(await msApi.overrides()); } catch { /* offline: no changes shown */ }
    await view.current?.library.refreshOverrides();
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return registry.all()
      .filter((d) => (group === 'all' || d.category === group) && (!q || d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q) || String(d.numericId) === q))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [registry, group, query]);
  const changes = (asset: number) => overrides.filter((o) => o.base === asset);
  const def = selected !== null ? registry.byNumericId(selected) : undefined;
  const mine = selected !== null ? changes(selected) : [];
  const hidden = mine.find((o) => o.kind === 'hide'), replaced = mine.find((o) => o.kind === 'replace'), variants = mine.filter((o) => o.kind === 'variant');

  // The preview: the game's asset library (its materials and wear), the game's light, a person for scale.
  useEffect(() => {
    const el = host.current!;
    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = .9;
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    scene.background = new Color('#a9c0cf'); scene.fog = new Fog('#a9c0cf', 80, 260);
    scene.add(new HemisphereLight('#dfe9f2', '#4a4636', 1.1));
    const sun = new DirectionalLight('#fff2dc', 2.2); sun.position.set(-30, 50, 25); scene.add(sun);
    const ground = new Mesh(new PlaneGeometry(600, 600), new MeshStandardMaterial({ color: '#5d6b3a', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    const stage = new Group(); scene.add(stage);
    const camera = new PerspectiveCamera(45, 1, .05, 1000);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.maxPolarAngle = Math.PI * .49;
    const library = new AssetLibrary(registry, { overrides: true });
    view.current = { library, stage, camera, controls };
    const resize = () => { const r = el.getBoundingClientRect(); renderer.setSize(r.width, r.height); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    let raf = 0;
    const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
    loop();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); library.dispose(); renderer.dispose(); renderer.domElement.remove(); view.current = null; };
  }, [registry]);

  // The selected model as the game draws it, with every model mixed in among it alongside.
  useEffect(() => {
    const v = view.current;
    if (!v || !def) return;
    let cancelled = false;
    const ids = [def.numericId, ...variants.map((o) => VARIANT_ID + o.id)];
    void (async () => {
      await v.library.overridesReady;
      const visuals = await Promise.all(ids.map((id) => v.library.load(id)?.catch(() => undefined)));
      if (cancelled) return;
      for (const c of [...v.stage.children]) { v.stage.remove(c); if (c instanceof InstancedMesh) c.dispose(); }
      const r = Math.max(.4, def.bounds.radius), gap = r * 2.4 + 1;
      visuals.forEach((vis, i) => {
        if (!vis) return;
        for (const part of vis.parts) {
          // Three of each, for the per-instance variation in colour and wear.
          const m = new InstancedMesh(part.geometry, part.material, 3);
          for (let k = 0; k < 3; k++) m.setMatrixAt(k, new Matrix4().makeRotationY(k * 1.9).setPosition(i * gap, 0, (k - 1) * gap));
          v.stage.add(m);
        }
      });
      // A person (1.75 m) for scale.
      const person = new Mesh(new BoxGeometry(.45, 1.75, .3).translate(0, .875, 0), new MeshLambertMaterial({ color: '#c4612c' }));
      person.position.set(-r - 1.2, 0, 0); v.stage.add(person);
      const h = Math.max(1.8, def.bounds.height), width = (ids.length - 1) * gap;
      v.controls.target.set(width / 2, h * .45, 0);
      v.camera.position.copy(new Vector3(width / 2, h * .9 + 1, Math.max(h, width * .6, gap * 1.6) * 1.9 + 2));
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, overrides]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await reload(); flash(label); } catch (err) { flash(`Lỗi: ${(err as Error).message}`); } finally { setBusy(false); }
  };
  const pickFile = (input: HTMLInputElement | null) => new Promise<File | null>((resolve) => {
    if (!input) return resolve(null);
    input.value = ''; input.onchange = () => resolve(input.files?.[0] ?? null); input.click();
  });

  return <div className={s.assetManager} data-testid="asset-manager">
    <div className={s.assetList}>
      <div className={s.assetGroups}>{GROUPS.map((g) => <button key={g.id} className={`${s.tab} ${group === g.id ? s.on : ''}`} onClick={() => setGroup(g.id)}>{g.name}</button>)}</div>
      <input className={s.input} placeholder="Tìm model…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className={s.assetItems}>
        {items.map((d) => {
          const c = changes(d.numericId);
          return <button key={d.numericId} className={`${s.assetItem} ${selected === d.numericId ? s.on : ''}`} onClick={() => setSelected(d.numericId)}>
            <span>{d.name}</span>
            <small>#{d.numericId}{c.some((o) => o.kind === 'hide') ? ' · đã xóa' : ''}{c.some((o) => o.kind === 'replace') ? ' · đã thay' : ''}{c.filter((o) => o.kind === 'variant').length ? ` · +${c.filter((o) => o.kind === 'variant').length} biến thể` : ''}</small>
          </button>;
        })}
        {!items.length && <p className={s.muted}>Không có model nào.</p>}
      </div>
    </div>
    <div className={s.assetMain}>
      <div ref={host} className={s.assetPreview} />
      {!def && <div className={s.assetEmpty}>Chọn một model bên trái để xem và chỉnh.</div>}
      {def && <div className={s.assetPanel}>
        <div className={s.assetHead}>
          <strong>{def.name}</strong>
          <small>#{def.numericId} · {GROUPS.find((g) => g.id === def.category)?.name ?? def.category} · cao {def.bounds.height.toFixed(1)} m{hidden ? ' · ĐÃ XÓA KHỎI GAME' : ''}</small>
        </div>
        <p className={s.muted}>Xem trước như trong game: ánh sáng, vật liệu và độ hao mòn của game, ba bản để thấy mỗi bản một khác, khối cam cao 1,75 m để so kích thước. Thay đổi áp dụng cho mọi bản đồ ở trận hoặc lần mở World Studio sau.</p>
        <div className={s.btnRow}>
          <button className={s.tbtn} disabled={busy} onClick={() => void pickFile(replaceInput.current).then((f) => f && act(`Đã thay model "${def.name}" bằng ${f.name}.`, () => msApi.addOverride(def.numericId, 'replace', f)))}><Icon name="lucide:replace" /> {replaced ? 'Thay file khác' : 'Thay model (.glb)'}</button>
          {replaced && <button className={s.tbtn} disabled={busy} onClick={() => void act('Đã khôi phục model gốc.', () => msApi.removeOverride(replaced.id))}><Icon name="lucide:undo-2" /> Về model gốc</button>}
          <button className={s.tbtn} disabled={busy} onClick={() => void pickFile(variantInput.current).then((f) => f && act(`Đã thêm ${f.name} xen vào "${def.name}".`, () => msApi.addOverride(def.numericId, 'variant', f, weight)))}><Icon name="lucide:plus" /> Thêm biến thể (.glb)</button>
          <label className={s.muted}>tỉ lệ <input className={s.input} style={{ width: 56 }} type="number" min={.05} max={10} step={.05} value={weight} onChange={(e) => setWeight(Math.max(.05, Math.min(10, Number(e.target.value) || 1)))} /></label>
          {hidden
            ? <button className={s.tbtn} disabled={busy} onClick={() => void act(`"${def.name}" đã trở lại game.`, () => msApi.removeOverride(hidden.id))}><Icon name="lucide:eye" /> Khôi phục vào game</button>
            : <button className={`${s.tbtn} ${s.danger}`} disabled={busy} onClick={() => { if (confirm(`Xóa "${def.name}" khỏi game? Model sẽ không còn hiện và không còn va chạm ở mọi bản đồ (khôi phục được).`)) void act(`Đã xóa "${def.name}" khỏi game.`, () => msApi.addOverride(def.numericId, 'hide')); }}><Icon name="lucide:trash-2" /> Xóa khỏi game</button>}
        </div>
        {(replaced || variants.length > 0) && <div className={s.assetChanges}>
          {replaced && <div className={s.assetChange}><span>Thay bằng: {replaced.name || `file #${replaced.id}`} ({(replaced.bytes / 1048576).toFixed(1)} MB)</span></div>}
          {variants.map((o) => <div key={o.id} className={s.assetChange}>
            <span>Biến thể: {o.name || `file #${o.id}`} ({(o.bytes / 1048576).toFixed(1)} MB)</span>
            <label className={s.muted}>tỉ lệ <input className={s.input} style={{ width: 56 }} type="number" min={.05} max={10} step={.05} defaultValue={o.weight}
              onBlur={(e) => { const w = Number(e.target.value); if (w > 0 && w !== o.weight) void act('Đã đổi tỉ lệ biến thể.', () => msApi.updateOverride(o.id, { weight: w })); }} /></label>
            <button className={`${s.ibtn} ${s.danger}`} title="Xóa biến thể" disabled={busy} onClick={() => void act('Đã xóa biến thể.', () => msApi.removeOverride(o.id))}><Icon name="lucide:trash-2" /></button>
          </div>)}
          <p className={s.muted}>Tỉ lệ: model gốc tính là 1; biến thể tỉ lệ 1 thay khoảng một nửa số cây/khóm của model này.</p>
        </div>}
      </div>}
      <input ref={replaceInput} type="file" accept=".glb,model/gltf-binary" hidden />
      <input ref={variantInput} type="file" accept=".glb,model/gltf-binary" hidden />
    </div>
  </div>;
}
