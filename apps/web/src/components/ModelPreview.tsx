'use client';

import { useEffect, useRef, useState } from 'react';
import { AmbientLight, Box3, DirectionalLight, GridHelper, Group, OrthographicCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { HandbookEntry } from '@zion/shared';
import type { Attachments } from '@zion/shared';
import { loadCharacterModel } from '@/game/render/character-model';
import { loadItemDisplayModel } from '@/game/render/weapons';
import { ResourceDisposer } from '@/game/render/resources';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

/** `attachments`: show a gun dressed with these attachments (attachment screen, shop preview). */
export default function ModelPreview({ model, title, attachments }: { model: HandbookEntry['model']; title: string; attachments?: Attachments }) {
  const dress = attachments ? `${attachments.optic ?? ''}|${attachments.muzzle ?? ''}` : '';
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<{ reset(): void; zoom(amount: number): void; rotate(value: boolean): void } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [rotating, setRotating] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const itemId = 'item' in model ? model.item : null;
  const url = 'url' in model ? model.url : null;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, frame = 0, visible = true;
    let renderer: WebGLRenderer;
    setState('loading'); setRotating(false);
    try { renderer = new WebGLRenderer({ alpha: true, antialias: true }); }
    catch { setState('failed'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75)); renderer.outputColorSpace = SRGBColorSpace;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    el.appendChild(renderer.domElement);
    const resources = new ResourceDisposer(), scene = new Scene(), pivot = new Group();
    scene.add(pivot, new AmbientLight(0xffffff, 1.7));
    const light = new DirectionalLight(0xffefdb, 2.7); light.position.set(4, 6, -5); scene.add(light);
    const rim = new DirectionalLight(0xffb000, 1.8); rim.position.set(-4, 2, 3); scene.add(rim);
    const camera = new OrthographicCamera(-2, 2, 2, -2, .01, 100);
    camera.position.set(4, 2.6, -6); camera.lookAt(0, 0, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.enableDamping = false; controls.minZoom = .6; controls.maxZoom = 3;
    controls.autoRotateSpeed = 1.3;
    let extent = 1.6;
    const render = () => { if (!disposed) renderer.render(scene, camera); };
    const resize = () => {
      const width = Math.max(1, el.clientWidth), height = Math.max(1, el.clientHeight), aspect = width / height;
      renderer.setSize(width, height, false);
      camera.left = -extent * Math.max(1, aspect); camera.right = -camera.left;
      camera.top = extent * Math.max(1, 1 / aspect); camera.bottom = -camera.top;
      camera.updateProjectionMatrix(); render();
    };
    controls.addEventListener('change', render);
    const animate = () => {
      frame = 0;
      if (disposed || !controls.autoRotate || !visible || document.visibilityState === 'hidden') return;
      controls.update(1 / 60); render(); frame = requestAnimationFrame(animate);
    };
    const start = () => { if (!frame) animate(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    const intersection = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? true; if (visible) start(); }); intersection.observe(el);
    document.addEventListener('visibilitychange', start);
    const lost = (event: Event) => { event.preventDefault(); controls.autoRotate = false; setState('failed'); };
    renderer.domElement.addEventListener('webglcontextlost', lost);
    handle.current = {
      reset: () => { controls.reset(); camera.zoom = 1; camera.updateProjectionMatrix(); render(); },
      zoom: amount => { camera.zoom = Math.max(.6, Math.min(3, camera.zoom * amount)); camera.updateProjectionMatrix(); render(); },
      rotate: value => { controls.autoRotate = value; if (value) start(); },
    };
    const load = itemId ? loadItemDisplayModel(itemId, attachments) : url?.endsWith('.glb') || url?.endsWith('.gltf')
      ? new GLTFLoader().loadAsync(url!).then(gltf => gltf.scene)
      : loadCharacterModel(url!).then(template => template.root);
    void load.then(root => {
      if (disposed) { resources.object(root); return; }
      const bounds = new Box3().setFromObject(root), size = bounds.getSize(new Vector3());
      if (bounds.isEmpty() || !Number.isFinite(size.length())) { resources.object(root); throw new Error('Empty model'); }
      root.position.sub(bounds.getCenter(new Vector3()));
      pivot.add(root); const scale = 2 / Math.max(size.x, size.y, size.z, .001); pivot.scale.setScalar(scale);
      extent = size.length() * scale / 2 * 1.18;
      const grid = new GridHelper(6, 12, 0x41413a, 0x252a2b); grid.position.y = -size.y * scale / 2 - .05; scene.add(grid);
      controls.saveState(); resize(); setState('ready');
    }).catch(() => { if (!disposed) setState('failed'); });
    return () => {
      disposed = true; handle.current = null; cancelAnimationFrame(frame); observer.disconnect(); intersection.disconnect();
      document.removeEventListener('visibilitychange', start); renderer.domElement.removeEventListener('webglcontextlost', lost);
      controls.dispose(); resources.object(scene); scene.clear(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dress` stands for `attachments`.
  }, [itemId, url, attempt, dress]);
  return <div className="model-preview" role="group" aria-label={`Mô hình 3D: ${title}`}>
    <div className="model-preview-canvas" ref={host} />
    {state === 'loading' && <div className="model-preview-state" role="status"><Spinner /> Đang tải mô hình 3D…</div>}
    {state === 'failed' && <div className="model-preview-state" role="status"><Icon name="lucide:box" /><span>Chưa tải được mô hình 3D.</span><button className="btn" onClick={() => setAttempt(value => value + 1)}>Thử lại</button></div>}
    <div className="model-preview-tools"><span>3D / TOÀN CẢNH</span><div><button disabled={state !== 'ready'} title="Thu nhỏ" aria-label="Thu nhỏ mô hình" onClick={() => handle.current?.zoom(.8)}><Icon name="lucide:minus" /></button><button disabled={state !== 'ready'} title="Phóng to" aria-label="Phóng to mô hình" onClick={() => handle.current?.zoom(1.25)}><Icon name="lucide:plus" /></button><button disabled={state !== 'ready'} title="Đặt lại góc nhìn" aria-label="Đặt lại góc nhìn mô hình" onClick={() => handle.current?.reset()}><Icon name="lucide:scan" /></button><button disabled={state !== 'ready'} title="Tự xoay mô hình" aria-label="Tự xoay mô hình" aria-pressed={rotating} onClick={() => { setRotating(!rotating); handle.current?.rotate(!rotating); }}><Icon name={rotating ? 'lucide:pause' : 'lucide:rotate-cw'} /></button></div></div>
    <p className="model-preview-hint">Kéo để xoay · Cuộn hoặc chụm hai ngón để thu phóng</p>
  </div>;
}
