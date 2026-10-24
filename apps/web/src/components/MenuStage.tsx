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
  type Object3D,
} from 'three';
import { DEFAULT_APPEARANCE, EntityFlags, randomAppearance, type Appearance, type RankTitle } from '@zion/shared';
import { Avatar } from '@/game/render/avatars';
import { loadPlayerCharacter } from '@/game/render/character-model';
import { SURVIVOR_SIZE } from '@/game/render/human-rig';
import { loadWeapons } from '@/game/render/weapons';
import { ResourceDisposer } from '@/game/render/resources';
import { renderItemIcons } from '@/game/inventory/icons';

/** Main-menu backdrop: the survivor standing centre stage with a rifle, idling. */
export default function MenuStage({ onReady, members, look, self }: { onReady?: () => void; members?: Array<{ name: string; rank?: RankTitle }>; look?: Appearance | null; self?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const rosterKey = JSON.stringify(members ?? []);
  /** The lobby survivors, with which one is this player (wears their look; the others a random one). */
  const lineup = useRef<Array<{ avatar: Avatar; name?: string }>>([]);
  const lookRef = useRef<{ look: Appearance | null | undefined; self?: string }>({ look, self });
  lookRef.current = { look, self };
  const dress = () => {
    const { look: own, self: me } = lookRef.current;
    lineup.current.forEach(({ avatar, name }, i) => {
      const mine = name ? name === me : i === 0;
      let seed = 7;
      for (const ch of name ?? '') seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
      avatar.setAppearance(mine ? own ?? DEFAULT_APPEARANCE : randomAppearance(seed));
    });
  };
  const dressRef = useRef(dress);
  dressRef.current = dress;
  useEffect(() => { dressRef.current(); }, [look, self]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;
    const names = JSON.parse(rosterKey) as Array<{ name: string; rank?: RankTitle }>;
    const count = Math.max(1, names.length);
    const swayPhases = Array.from({ length: count }, () => Math.random() * Math.PI * 2);
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
      // Framed so the survivor fills most of the stage height.
      const dist = count > 1 ? Math.max(6.5, count * 1.25 / (2 * Math.tan(Math.PI / 12) * Math.max(0.3, camera.aspect))) : camera.aspect < 1 ? 5 / camera.aspect ** 0.5 : 5;
      camera.position.set(0.0, 1.45 * SURVIVOR_SIZE, -dist);
      camera.lookAt(0, 1.02 * SURVIVOR_SIZE, 0);
      camera.updateProjectionMatrix();
    };
    resize();
    // Opening the team panel changes this element without resizing the browser window.
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    const avatars: Avatar[] = [];
    const resources = new ResourceDisposer();
    const ownedModels: Object3D[] = [];
    void (async () => {
      try {
        const character = await loadPlayerCharacter();
        if (disposed) { resources.object(character.root); return; }
        ownedModels.push(character.root);
        const weapons = await loadWeapons(character);
        if (disposed) {
          resources.object(character.root);
          for (const weapon of weapons.values()) { resources.object(weapon.object); resources.object(weapon.display); }
          return;
        }
        for (const weapon of weapons.values()) ownedModels.push(weapon.object, weapon.display);
        for (let i = 0; i < count; i++) {
          const avatar = new Avatar(character, true);
          avatar.setStance('rifle');
          avatar.setWeapon('ak47', weapons);
          // The survivor's recorded rifle idle; the block character keeps its patrol clip.
          if (!avatar.setMocapIdle('rifle_idle')) {
            const clipLength = character.clips.get('rifle_patrol_idle')?.length ?? 8;
            avatar.setIdleClip('rifle_patrol_idle', Math.random() * clipLength, [6, 20]);
          }
          if (names[i]) avatar.setName(names[i]!.name, names[i]!.rank);
          avatar.addTo(scene); avatars.push(avatar);
        }
        lineup.current = avatars.map((avatar, i) => ({ avatar, name: names[i]?.name }));
        dressRef.current();
        try { renderItemIcons(weapons); } catch { /* Keep the lobby usable when icon rendering is unavailable. */ }
        onReady?.();
      } catch {
        for (const root of ownedModels) resources.object(root);
        /* menu still works without the model */
      }
    })();

    let last = performance.now();
    let t = 0;
    const looks: Array<{ yaw: number; target: number; next: number; hold: number }> = [];
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      // Yaw 0 looks −Z, straight at the camera. Each survivor faces the player and now and then
      // glances aside: usually the head alone, sometimes far enough that the feet step round.
      avatars.forEach((avatar, i) => {
        const look = looks[i] ??= { yaw: 0, target: 0, next: 2 + swayPhases[i]! * 2, hold: 0 };
        if (t >= look.next) {
          if (look.target === 0) {
            const far = Math.random() < .3;
            look.target = (Math.random() < .5 ? -1 : 1) * (far ? .8 + Math.random() * .35 : .25 + Math.random() * .25);
            look.hold = t + 1.6 + Math.random() * 1.8;
            look.next = look.hold;
          } else {
            look.target = 0;
            look.next = t + 5 + Math.random() * 6;
          }
        }
        look.yaw += (look.target - look.yaw) * (1 - Math.exp(-dt * 2.2));
        avatar.update((i - (count - 1) / 2) * 1.15, 0, Math.abs(i - (count - 1) / 2) * 0.15, look.yaw, EntityFlags.Grounded, dt, t);
      });
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      avatars.forEach((avatar) => avatar.dispose(scene));
      lineup.current = [];
      for (const root of ownedModels) resources.object(root);
      resources.object(scene);
      key.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [onReady, rosterKey]);

  return <div ref={host} className="menu-stage" />;
}
