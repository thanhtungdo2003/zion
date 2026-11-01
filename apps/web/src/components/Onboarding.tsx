'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ACESFilmicToneMapping, AmbientLight, Box3, Clock, DirectionalLight, Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { HudState } from '@/game/hud-store';
import { Icon } from './Icon';
import type { ClientMessage, TutorialId } from '@zion/shared';
import type { InventoryState } from '@/game/inventory/inventory';
import { discoveryLesson, lessonContextOpen, type DiscoveryLesson } from '@/game/discovery-tutorial';
import { ResourceDisposer } from '@/game/render/resources';
import { rollKeyLabel, useSettings } from '@/lib/settings';

/** Fired (e.g. from the settings panel) to replay the tutorial from the first step. */
export const TUTORIAL_RESTART_EVENT = 'zion:tutorial-restart';

const PORTRAIT_W = 300, PORTRAIT_H = 360;

/**
 * The guide's bust. The model's baked clips are a walk cycle that stutters in a still frame, so it
 * stays in its rest pose and gets a procedural breathing loop instead. The rig faces -X; it is turned
 * to face the viewer and framed on the upper body.
 */
export function GuidePortrait() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = new WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(PORTRAIT_W, PORTRAIT_H); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.toneMapping = ACESFilmicToneMapping; renderer.toneMappingExposure = 0.8;
    el.appendChild(renderer.domElement);
    const scene = new Scene(); const camera = new PerspectiveCamera(28, PORTRAIT_W / PORTRAIT_H, 0.01, 100);
    scene.add(new AmbientLight(0xffffff, 0.55));
    const key = new DirectionalLight(0xffe2b0, 1.3); key.position.set(2, 3, 4); scene.add(key);
    const rim = new DirectionalLight(0xffb000, 0.6); rim.position.set(-3, 2, -2); scene.add(rim);
    const body = new Group(); scene.add(body);
    const resources = new ResourceDisposer();
    let disposed = false; let baseY = 0; let ready = false;
    new GLTFLoader().load('/models/specials/cattail_girl-plants_vs_zombies.glb', (gltf) => {
      if (disposed) { resources.object(gltf.scene); return; }
      gltf.scene.rotation.y = Math.PI / 2;
      const turned = new Group(); turned.add(gltf.scene);
      const box = new Box3().setFromObject(turned); const size = box.getSize(new Vector3()); const center = box.getCenter(new Vector3());
      // Pivot at the feet so breathing stretches the chest upward, not the whole body around its middle.
      turned.position.set(-center.x, -box.min.y, -center.z); body.add(turned);
      const chest = size.y * 0.7;
      camera.position.set(0, chest, size.y * 1.15); camera.lookAt(0, chest - size.y * 0.03, 0);
      baseY = body.position.y; ready = true;
    });
    const clock = new Clock(); let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      if (ready) {
        const t = clock.getElapsedTime(); const breath = Math.sin(t * 1.9);
        body.scale.set(1 + breath * 0.006, 1 + breath * 0.012, 1 + breath * 0.008);
        body.position.y = baseY + breath * 0.004;
        body.rotation.y = Math.sin(t * 0.45) * 0.05;
        body.rotation.z = Math.sin(t * 0.6) * 0.012;
      }
      renderer.render(scene, camera);
    };
    render();
    return () => { disposed = true; cancelAnimationFrame(frame); resources.object(scene); scene.clear(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
  }, []);
  return <div ref={host} className="tutorial-portrait" />;
}

type Target = 'quest' | 'shop' | 'gate';
interface Step { title: string; text: string; focus?: string; walk?: Target; wait?: 'quest' }

const steps: Step[] = [
  { title: 'ZION', text: '100 coin · GL18 · 2 lựu đạn · 5 khoai chín · 1 khoai sống · 1 kit cứu thương.' },
  { title: 'Máu · thể lực', text: 'Shift chạy · Q lướt · C nằm/đứng · H kit cứu thương · ăn để hồi năng lượng.', focus: '.hud-health' },
  { title: 'Vũ khí', text: '1–4 đổi súng · chuột trái bắn · R nạp đạn.', focus: '.hotbar' },
  { title: 'Giáp', text: 'Mũ · áo · quần · giày: giảm sát thương, xem độ bền.', focus: '.armor-hud' },
  { title: 'Nhiệm vụ', text: 'WASD theo mũi tên · E để nói chuyện.', walk: 'quest' },
  { title: 'Nhận nhiệm vụ', text: 'Chọn nhiệm vụ · Nhận nhiệm vụ · xong quay lại nhận thưởng.', focus: '.q-dialog', wait: 'quest' },
  { title: 'Kho vũ khí', text: 'Theo mũi tên · E: mua súng, đạn, bán đồ.', walk: 'shop' },
  { title: 'Cổng nam', text: 'Bên ngoài có zombie: mang đạn, thức ăn, thuốc.', walk: 'gate' },
  { title: 'Sẵn sàng', text: 'Lục rương gỗ ngoài bản đồ để tìm đồ.' },
];

/** Shown as a banner when the player reaches each guided location. */
const ZONES: Record<Target, { icon: string; name: string; reach: number }> = {
  quest: { icon: 'lucide:scroll-text', name: 'Trạm nhiệm vụ', reach: 3 },
  shop: { icon: 'game-icons:ammo-box', name: 'Kho vũ khí', reach: 3 },
  gate: { icon: 'lucide:door-open', name: 'Cổng nam', reach: 5 },
};

/** Hard-edged chevron stack pointing "down" in its own frame; the wrapper rotates it at the target. */
function DirectionArrow() {
  return <svg className="tutorial-arrow" viewBox="0 0 64 80" aria-hidden>
    <path className="c1" d="M8 6 L32 24 L56 6 L56 18 L32 36 L8 18 Z" />
    <path className="c2" d="M8 26 L32 44 L56 26 L56 38 L32 56 L8 38 Z" />
    <path className="c3" d="M8 46 L32 64 L56 46 L56 58 L32 76 L8 58 Z" />
  </svg>;
}

export function Onboarding({ hud, inventory, onBlock, onGuide }: { hud: HudState; inventory: InventoryState; onBlock: (block: boolean) => void; onGuide: (message: Extract<ClientMessage, { t: 'tutorial' }>) => void }) {
  const { rollKey, proneKey } = useSettings();
  const key = `zion:onboarding:v1:${hud.username}`;
  const [step, setStep] = useState(0); const [done, setDone] = useState(true);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [zone, setZone] = useState<Target | null>(null);
  const [lesson, setLesson] = useState<DiscoveryLesson | null>(null), [lessonStep, setLessonStep] = useState(0);
  const [replay, setReplay] = useState(false);
  const [ready, setReady] = useState(false);
  const initialized = useRef(''), localSeen = useRef(new Set<TutorialId>());
  useEffect(() => {
    if (!hud.username || !hud.tutorial || initialized.current === key) return;
    initialized.current = key; localSeen.current.clear(); setLesson(null); setReplay(false); setReady(true);
    try {
      const saved = localStorage.getItem(key);
      setDone(saved === 'done' || hud.tutorial.seen.includes('intro'));
      setStep(saved && saved !== 'done' ? Math.min(steps.length - 1, Math.max(0, Number(saved) || 0)) : 0);
    } catch { setDone(hud.tutorial.seen.includes('intro')); }
  }, [key, hud.username, hud.tutorial]);
  useEffect(() => {
    const restart = () => { setStep(0); setDone(false); setZone(null); setLesson(null); setReplay(true); localSeen.current.clear(); try { localStorage.setItem(key, '0'); } catch { /* storage unavailable */ } };
    window.addEventListener(TUTORIAL_RESTART_EVENT, restart);
    return () => window.removeEventListener(TUTORIAL_RESTART_EVENT, restart);
  }, [key]);
  useEffect(() => {
    if (!ready || !done || hud.status !== 'playing' || !hud.tutorial || initialized.current !== key || hud.downed !== null) return;
    if (lesson) { if (!lessonContextOpen(lesson, hud, inventory)) setLesson(null); return; }
    const seen = new Set([...(!replay ? hud.tutorial.seen : []), ...localSeen.current]);
    const found = discoveryLesson(hud, inventory, seen);
    if (found) { localSeen.current.add(found.id); setLesson(found); setLessonStep(0); }
  }, [done, hud, inventory, lesson, key, replay, ready]);
  const currentSteps = lesson?.steps ?? steps;
  const currentIndex = lesson ? lessonStep : step;
  const cur: Step = currentSteps[currentIndex];
  const walking = !!cur.walk;
  const passive = walking || !!cur.wait;
  const active = (!done || !!lesson) && hud.status === 'playing';
  const guideId = active ? lesson?.id ?? 'intro' : null;
  useEffect(() => {
    if (!guideId) return;
    onGuide({ t: 'tutorial', op: 'open', id: guideId, replay });
    const heartbeat = window.setInterval(() => onGuide({ t: 'tutorial', op: 'heartbeat' }), 10_000);
    return () => { clearInterval(heartbeat); onGuide({ t: 'tutorial', op: 'close' }); };
  }, [guideId, replay, onGuide]);
  const target = cur.walk ? hud.tutorialTargets.find((t) => t.id === cur.walk) : undefined;
  const next = useCallback(() => {
    if (lesson) { if (lessonStep + 1 >= lesson.steps.length) setLesson(null); else setLessonStep((n) => n + 1); return; }
    const n = step + 1;
    if (n >= steps.length) { setDone(true); try { localStorage.setItem(key, 'done'); } catch { /* storage unavailable */ } }
    else { setStep(n); try { localStorage.setItem(key, String(n)); } catch { /* storage unavailable */ } }
  }, [step, key, lesson, lessonStep]);
  useEffect(() => { onBlock(active && !passive); return () => onBlock(false); }, [active, passive, onBlock]);
  useEffect(() => {
    if (!active || !cur.focus) { setRect(null); return; }
    let lit: Element | null = null;
    const update = () => {
      const target = document.querySelector(cur.focus!);
      const el = target ?? (lesson ? document.querySelector(lesson.context === 'npc' ? '.q-dialog' : lesson.context === 'inventory' ? '.inv-panel' : '.hud-health') : null);
      if (el !== lit) { lit?.classList.remove('tutorial-lit'); el?.classList.add('tutorial-lit'); lit = el; }
      setRect(el?.getBoundingClientRect() ?? null);
    };
    update(); const timer = window.setInterval(update, 250);
    return () => { clearInterval(timer); lit?.classList.remove('tutorial-lit'); };
  }, [active, cur.focus, lesson]);
  useEffect(() => {
    if (active && cur.walk && target && target.distance < ZONES[cur.walk].reach) { setZone(cur.walk); next(); }
  }, [active, cur.walk, target, next]);
  useEffect(() => { if (!zone) return; const t = window.setTimeout(() => setZone(null), 6000); return () => clearTimeout(t); }, [zone]);
  useEffect(() => { if (active && cur.wait === 'quest' && hud.quests.some((q) => q.status === 'active' || q.status === 'ready' || q.status === 'claimed')) next(); }, [active, cur.wait, hud.quests, next]);
  if (!active) return null;
  const pad = 8;
  const zoneInfo = zone ? ZONES[zone] : null;
  return <div className={`tutorial ${passive ? 'tutorial-walk' : ''}`}>
    {!passive && !rect && <div className="tutorial-shade" />}
    {rect && <div className={`tutorial-focus ${passive ? 'soft' : ''}`} style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}><i /><i /><i /><i /></div>}
    {rect && lesson?.id === 'pvp' && <div className="tutorial-direction" style={{ left: rect.left + rect.width / 2, top: rect.bottom + 58, transform: 'translate(-50%, -50%) rotate(180deg)' }}><DirectionArrow /></div>}
    {walking && target && <div className="tutorial-direction" style={{ left: hud.tutorialAnchor.x, top: hud.tutorialAnchor.y, transform: `translate(-50%, -50%) rotate(${target.angle}rad) translateY(96px)` }}>
      <DirectionArrow />
      <span style={{ transform: `rotate(${-target.angle}rad)` }}><b>{Math.ceil(target.distance)}</b>M</span>
    </div>}
    {zoneInfo && <div className="tutorial-zone" key={zone} role="status">
      <h3><Icon name={zoneInfo.icon} /> {zoneInfo.name}</h3>
    </div>}
    <section className="tutorial-dialog" style={rect && rect.top > window.innerHeight / 2 && !passive ? { top: '6%', bottom: 'auto' } : undefined} aria-label="Hướng dẫn tân thủ" aria-live="polite">
      <GuidePortrait />
      <div className="tutorial-body">
        <header><small>CATTAIL</small><span>{String(currentIndex + 1).padStart(2, '0')}/{String(currentSteps.length).padStart(2, '0')}</span></header>
        <div className="tutorial-progress">{currentSteps.map((_, i) => <i key={i} className={i < currentIndex ? 'done' : i === currentIndex ? 'on' : ''} />)}</div>
        <h2>{cur.title}</h2><p>{cur.text.replace('Q lướt', `${rollKeyLabel(rollKey)} lướt`).replace('C nằm', `${rollKeyLabel(proneKey)} nằm`)}</p>
        <footer>
          {passive
            ? <strong><Icon name="game-icons:compass" /> {cur.wait ? 'Nhận nhiệm vụ' : 'Đi theo mũi tên'}</strong>
            : <button className="btn btn-primary" onClick={next}>{currentIndex === currentSteps.length - 1 ? lesson ? 'Đã hiểu' : 'Bắt đầu' : 'Tiếp tục'} <Icon name="lucide:arrow-right" /></button>}
          <button type="button" className="tutorial-skip" onClick={() => { if (lesson) { setLesson(null); return; } setDone(true); try { localStorage.setItem(key, 'done'); } catch { /* storage unavailable */ } }}>Bỏ qua</button>
        </footer>
      </div>
    </section>
  </div>;
}
