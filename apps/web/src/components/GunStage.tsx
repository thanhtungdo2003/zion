'use client';
import { useEffect, useRef } from 'react';
import { AmbientLight, Box3, DirectionalLight, Group, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Attachments } from '@zion/shared';
import { loadItemDisplayModel } from '@/game/render/weapons';
import { ResourceDisposer } from '@/game/render/resources';

/** Screen positions (px, relative to the stage) of the gun's mounting points. */
export interface GunAnchors { rail: { x: number; y: number } | null; muzzle: { x: number; y: number } | null }

/**
 * The gun alone, on a transparent canvas: side view (muzzle to the right), drag to turn it a
 * little. Reports where its optic rail and muzzle are on screen so slots can sit next to them.
 */
export function GunStage({ itemId, attachments, onAnchors }: { itemId: string; attachments?: Attachments; onAnchors: (a: GunAnchors) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const report = useRef(onAnchors);
  report.current = onAnchors;
  const dress = `${attachments?.optic ?? ''}|${attachments?.muzzle ?? ''}`;
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, frame = 0;
    let renderer: WebGLRenderer;
    try { renderer = new WebGLRenderer({ alpha: true, antialias: true }); } catch { return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    const scene = new Scene(), pivot = new Group(), resources = new ResourceDisposer();
    scene.add(pivot, new AmbientLight(0xffffff, 1.9));
    const key = new DirectionalLight(0xffffff, 2.6); key.position.set(2, 4, 5); scene.add(key);
    const rim = new DirectionalLight(0xffc070, 1.4); rim.position.set(-4, 2, -3); scene.add(rim);
    const camera = new PerspectiveCamera(28, 1, .05, 100);
    camera.position.set(0, .35, 3.2); camera.lookAt(0, 0, 0);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.enableZoom = false; controls.enableDamping = true;
    controls.minAzimuthAngle = -.7; controls.maxAzimuthAngle = .7; controls.minPolarAngle = 1.1; controls.maxPolarAngle = 1.9;
    let last = '';
    const point = new Vector3();
    const project = (name: string) => {
      const marker = pivot.getObjectByName(name);
      if (!marker) return null;
      marker.getWorldPosition(point).project(camera);
      return { x: (point.x + 1) / 2 * el.clientWidth, y: (1 - point.y) / 2 * el.clientHeight };
    };
    const render = () => {
      frame = 0;
      if (disposed) return;
      controls.update();
      renderer.render(scene, camera);
      const anchors = { rail: project('weapon-rail'), muzzle: project('weapon-muzzle') };
      const sig = JSON.stringify(anchors, (_k, v) => typeof v === 'number' ? Math.round(v) : v);
      if (sig !== last) { last = sig; report.current(anchors); }
      frame = requestAnimationFrame(render);
    };
    const resize = () => {
      const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    void loadItemDisplayModel(itemId, attachments).then((root) => {
      if (disposed) { resources.object(root); return; }
      // Centre it and size it to fill the stage width (≈ 1.9 units across).
      const box = new Box3().setFromObject(root), size = box.getSize(new Vector3());
      root.position.sub(box.getCenter(new Vector3()));
      pivot.add(root);
      pivot.scale.setScalar(1.9 / Math.max(size.x, .001));
      frame = requestAnimationFrame(render);
    }).catch(() => undefined);
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      resources.object(scene); scene.clear(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dress` stands for `attachments`.
  }, [itemId, dress]);
  return <div className="gun-stage" ref={host} />;
}
