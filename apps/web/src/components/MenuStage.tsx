'use client';

import { useEffect, useRef } from 'react';
import {
  ACESFilmicToneMapping,
  AmbientLight,
  CircleGeometry,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { EntityFlags } from '@zion/shared';
import { Avatar } from '@/game/render/avatars';
import { loadCharacterModel } from '@/game/render/character-model';
import { loadWeapons } from '@/game/render/weapons';

/** Main-menu backdrop: the survivor standing centre stage with a rifle, idling. */
export default function MenuStage({ onReady, members }: { onReady?: () => void; members?: string[] }) {
  const host = useRef<HTMLDivElement>(null);
  const rosterKey = JSON.stringify(members ?? []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;
    const names = JSON.parse(rosterKey) as string[];
    const count = Math.max(1, names.length);
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(30, 1, 0.1, 100);
    scene.add(new AmbientLight(0xffffff, 0.55));
    const key = new DirectionalLight(0xfff2e0, 2.6);
    key.position.set(-2.5, 4, -4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const rim = new DirectionalLight(0xffb000, 2.2);
    rim.position.set(3, 2.5, 3);
    scene.add(rim);
    const floor = new Mesh(new CircleGeometry(3, 48), new ShadowMaterial({ opacity: 0.45 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    // Flat marker disc under the feet.
    const pad = new Mesh(new CircleGeometry(0.9, 6), new MeshBasicMaterial({ color: 0x1b1d1f }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.002;
    scene.add(pad);

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      // Keep the character the same size on narrow screens.
      const dist = count > 1 ? Math.max(7.5, count * 1.25 / (2 * Math.tan(Math.PI / 12) * Math.max(0.3, camera.aspect))) : camera.aspect < 1 ? 6.4 / camera.aspect ** 0.5 : 6.4;
      camera.position.set(0.0, 1.35, -dist);
      camera.lookAt(0, 0.95, 0);
      camera.updateProjectionMatrix();
    };
    resize();
    // Opening the team panel changes this element without resizing the browser window.
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    const avatars: Avatar[] = [];
    void (async () => {
      try {
        const character = await loadCharacterModel();
        const weapons = await loadWeapons(character);
        if (disposed) return;
        for (let i = 0; i < count; i++) {
          const avatar = new Avatar(character, true);
          avatar.setStance('rifle');
          avatar.setWeapon('ak47', weapons);
          if (names[i]) avatar.setName(names[i]!);
          avatar.addTo(scene); avatars.push(avatar);
        }
        onReady?.();
      } catch {
        /* menu still works without the model */
      }
    })();

    let last = performance.now();
    let t = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      // Yaw 0 looks −Z, straight at the camera; turned slightly for a three-quarter pose.
      const yaw = 0.35 + Math.sin(t * 0.25) * 0.08;
      avatars.forEach((avatar, i) => avatar.update((i - (count - 1) / 2) * 1.15, 0, Math.abs(i - (count - 1) / 2) * 0.15, yaw, EntityFlags.Grounded, dt, t));
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      avatars.forEach((avatar) => avatar.dispose(scene));
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onReady, rosterKey]);

  return <div ref={host} className="menu-stage" />;
}
