'use client';

import { useEffect, useRef, useState } from 'react';
import { AmbientLight, Box3, DirectionalLight, OrthographicCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from 'three';
import { loadCharacterModel } from '@/game/render/character-model';
import { ResourceDisposer } from '@/game/render/resources';

/** The actual Blockbench badge, fitted by its bounds; still thumbnails do not run a frame loop. */
export function BadgeModel({ url, animated = false }: { url: string; animated?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false, raf = 0;
    let renderer: WebGLRenderer;
    try { renderer = new WebGLRenderer({ alpha: true, antialias: true }); }
    catch { setFailed(true); return; }
    setFailed(false);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    el.appendChild(renderer.domElement);
    const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, .01, 100);
    scene.add(new AmbientLight(0xffffff, 1.6));
    const light = new DirectionalLight(0xffe6b8, 2.5);
    light.position.set(2, 4, 6); scene.add(light);
    const resources = new ResourceDisposer();
    const fit = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.left = -1.25 * w / h; camera.right = 1.25 * w / h;
      camera.top = 1.25; camera.bottom = -1.25; camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(fit); observer.observe(el); fit();
    void loadCharacterModel(url).then((template) => {
      if (disposed) { resources.object(template.root); return; }
      const root = template.root;
      const box = new Box3().setFromObject(root), size = box.getSize(new Vector3());
      root.position.sub(box.getCenter(new Vector3()));
      const scale = 2 / Math.max(size.x, size.y, size.z, .001);
      root.scale.setScalar(scale); root.position.multiplyScalar(scale);
      scene.add(root);
      // A shallow view reveals the relief without hiding the emblem's face.
      camera.position.set(0.25, 0.15, 6); camera.lookAt(0, 0, 0);
      fit();
      if (animated) {
        const frame = (now: number) => {
          root.rotation.y = Math.sin(now / 2200) * .22;
          renderer.render(scene, camera);
          raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
      }
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => {
      disposed = true; cancelAnimationFrame(raf); observer.disconnect(); resources.object(scene);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, [url, animated]);
  return <div ref={host} className="badge-model" aria-hidden="true">{failed && <span>★</span>}</div>;
}
