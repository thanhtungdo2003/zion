import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Color, DirectionalLight, Fog, HemisphereLight, PCFShadowMap, PCFSoftShadowMap, PerspectiveCamera,
  PMREMGenerator, Points, PointsMaterial, Scene, SRGBColorSpace, ACESFilmicToneMapping, Vector3, WebGLRenderer, Box3, type Object3D,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EntityFlags, randomAppearance } from '@zion/shared';
import { Avatar } from '@/game/render/avatars';
import { loadPlayerCharacter, type CharacterTemplate } from '@/game/render/character-model';
import { ShaderPack } from '@/game/render/shader-pack';
import { buildHall, lotusLamp, type Hall } from './hall';
import { TempleSimulation, type Offering, type Person, type TempleEventInput } from './simulation';

/**
 * Chánh Điện scene: the hall, one survivor-model Avatar per viewer (the game's own walk and run),
 * the camera and the overlays (names are the Avatars' tags; chat, the offering card, the feed and
 * the notice are DOM). The same class runs in the studio tab (preview) and on the game screen.
 *
 * Camera: high above the door end looking down the hall to the altar (as in An Nhiên). A big
 * offering (50 likes, a follow, a share) takes it down behind that person's back until the
 * offering is set, then it goes back up.
 */
export interface TempleGraphics { renderScale: number; shadows: 'off' | 'low' | 'high'; shaders: boolean; brightness: number; maxPeople: number }
export interface TempleStatus { state: 'idle' | 'connecting' | 'connected' | 'error'; username: string | null; viewers: number | null; error: string | null }

/** Drop the real statue here (GLB, any size: it is scaled to the stand-in's height). */
export const STATUE_URL = '/models/temple/buddha.glb';
const TINTS = [0xf2a6c0, 0xf6c35a, 0xf08a6a, 0xb9a2ef, 0x8cc4f2, 0xf2eee6];
const DISCLAIMER = 'Trò chơi giải trí mô phỏng chánh điện, không phải hoạt động tôn giáo và không đại diện cho chùa hay tổ chức tôn giáo nào. Thả tim, theo dõi, chia sẻ chỉ để trò chuyện vui vẻ, không mang lại phước báu hay điều may.';
const SOURCE_TEXT: Record<Offering['source'], string> = { likes: 'thả tim', follow: 'theo dõi kênh', share: 'chia sẻ LIVE' };
const smooth = (rate: number, dt: number) => 1 - Math.exp(-dt * rate);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string) => { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; parent?.appendChild(e); return e; };

export class TempleScene {
  readonly sim: TempleSimulation;
  private readonly renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(42, 1, .1, 120);
  private readonly sun = new DirectionalLight(0xffe2b8, 2.1);
  private readonly sunDir = new Vector3();
  private readonly hall: Hall;
  private readonly avatars = new Map<string, Avatar>();
  private template: CharacterTemplate | null = null;
  private pack: ShaderPack | null = null;
  private graphics: TempleGraphics = { renderScale: .8, shadows: 'low', shaders: false, brightness: 1.1, maxPeople: 24 };
  private focus: Person | null = null;
  private readonly camPos = new Vector3(0, 14, 8);
  private readonly camLook = new Vector3(0, 0, -2);
  private readonly lamps: Array<{ obj: Object3D; until: number }> = [];
  private lampIndex = 0;
  private readonly smoke: { points: Points; ages: Float32Array };
  private sparkle: { points: Points; t: number } | null = null;
  private raf = 0; private last = 0; private elapsed = 0; private disposed = false;
  private readonly ro: ResizeObserver;
  // Overlays.
  private readonly ui: HTMLDivElement;
  private readonly bubbles = new Map<string, HTMLDivElement>();
  private readonly card: { root: HTMLDivElement; photo: HTMLImageElement; name: HTMLElement; line: HTMLElement };
  private readonly feed: HTMLOListElement;
  private readonly status: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private toastTimer = 0;

  constructor(private readonly host: HTMLElement) {
    this.sim = new TempleSimulation({
      focus: (p) => this.setFocus(p),
      offered: (p, o) => this.offered(p, o),
      thanks: (p, kind) => this.showToast(`Cảm ơn ${p.name} đã ${kind === 'follow' ? 'theo dõi kênh' : 'chia sẻ LIVE'}!`),
    });
    const r = this.renderer;
    r.outputColorSpace = SRGBColorSpace; r.toneMapping = ACESFilmicToneMapping;
    r.domElement.className = 'tp-canvas'; host.appendChild(r.domElement);
    // Image-based light for the gold and lacquer (a neutral room, softened).
    const pmrem = new PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture; pmrem.dispose();
    this.scene.environmentIntensity = .45;
    this.scene.background = new Color(0x1a0f0a); this.scene.fog = new Fog(0x1a0f0a, 26, 60);
    this.scene.add(new HemisphereLight(0xffe6c4, 0x3a2216, .75));
    // Warm daylight falling in through the door end; it carries the shadows.
    this.sun.position.set(5, 12, 10); this.sun.target.position.set(0, 0, -2);
    const sc = this.sun.shadow.camera; sc.left = -9; sc.right = 9; sc.top = 11; sc.bottom = -11; sc.near = 1; sc.far = 40; this.sun.shadow.bias = -.0004; this.sun.shadow.normalBias = .03;
    this.scene.add(this.sun, this.sun.target);
    this.hall = buildHall(); this.scene.add(this.hall.root);
    this.smoke = this.makeSmoke();
    void this.loadStatue();
    void loadPlayerCharacter(undefined, undefined, 'survivor').then((t) => { if (!this.disposed) this.template = t; });
    // Overlays.
    this.ui = el('div', 'tp-ui', host);
    el('div', 'tp-labels', this.ui);
    const guide = el('div', 'tp-guide', this.ui);
    el('h2', '', guide, 'CHÁNH ĐIỆN');
    const ul = el('ul', '', guide);
    for (const [b, t] of [['❤ Thả tim', 'để vào chánh điện'], ['10 tim', 'dâng một đèn sen'], ['50 tim · Theo dõi · Chia sẻ', 'dâng lễ lớn']]) { const li = el('li', '', ul); el('b', '', li, b); li.append(` ${t}`); }
    const card = el('div', 'tp-card', this.ui); card.hidden = true;
    const photo = el('img', 'tp-photo', card); photo.alt = ''; photo.referrerPolicy = 'no-referrer'; photo.onerror = () => { photo.hidden = true; };
    const info = el('div', 'tp-card-info', card);
    this.card = { root: card, photo, name: el('strong', '', info), line: el('span', '', info) };
    const feedBox = el('div', 'tp-feed', this.ui); el('h2', '', feedBox, 'VỪA DÂNG');
    this.feed = el('ol', '', feedBox);
    this.toast = el('div', 'tp-toast', this.ui); this.toast.hidden = true;
    this.status = el('div', 'tp-status', this.ui, 'Đang chờ kết nối…');
    const ticker = el('div', 'tp-ticker', this.ui); el('span', '', ticker, DISCLAIMER);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host); this.resize();
    this.applyGraphics(this.graphics);
    this.raf = requestAnimationFrame(this.frame);
  }

  receive(e: TempleEventInput): void { this.sim.receive(e); }

  setStatus(s: TempleStatus): void {
    this.status.hidden = s.state === 'connected';
    this.status.textContent = s.state === 'connecting' ? `Đang kết nối @${s.username ?? ''}…` : s.state === 'error' ? s.error ?? 'Mất kết nối' : 'Chưa kết nối TikTok LIVE';
  }

  /** Render scale, shadows, shader pack (the game's post-processing), exposure, crowd size. */
  applyGraphics(g: TempleGraphics): void {
    const shadowsChanged = g.shadows !== this.graphics.shadows || !this.renderer.shadowMap.enabled !== (g.shadows === 'off');
    this.graphics = g;
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 2) * g.renderScale);
    r.toneMappingExposure = g.brightness;
    r.shadowMap.enabled = g.shadows !== 'off'; r.shadowMap.type = g.shadows === 'high' ? PCFSoftShadowMap : PCFShadowMap;
    this.sun.castShadow = g.shadows !== 'off';
    const size = g.shadows === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    if (shadowsChanged) this.scene.traverse((o) => { const m = (o as { material?: { needsUpdate: boolean } }).material; if (m) m.needsUpdate = true; });
    if (g.shaders && !this.pack) this.pack = new ShaderPack(r, this.scene, this.camera);
    if (!g.shaders && this.pack) { this.pack.dispose(); this.pack = null; }
    this.sim.maxPeople = g.maxPeople;
    this.resize();
  }

  private resize(): void {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.ui.classList.toggle('tp-portrait', w < h);
  }

  /** The overview: above the door end, looking down the hall; further up on a narrow screen. */
  private overview(t: number, pos: Vector3, look: Vector3): void {
    const narrow = Math.min(2.1, Math.max(1, .78 / this.camera.aspect));
    pos.set(Math.sin(t * .05) * .8, 3 + 10.5 * narrow, -1.5 + 9.5 * narrow);
    look.set(0, 0, -2.4 + (narrow - 1) * .8);
  }

  private setFocus(p: Person | null): void {
    this.focus = p;
    const c = this.card;
    if (!p) { c.root.hidden = true; return; }
    c.name.textContent = p.name;
    c.line.textContent = `Dâng lễ lớn · ${SOURCE_TEXT[p.current?.source ?? 'likes']}${p.likes ? ` · ${p.likes} tim` : ''}`;
    c.photo.hidden = !p.avatar; if (p.avatar) c.photo.src = p.avatar;
    c.root.hidden = false;
  }

  private offered(p: Person, o: Offering): void {
    const slot = this.hall.lampSlots[this.lampIndex++ % this.hall.lampSlots.length]!;
    const lamp = lotusLamp(TINTS[p.seed % TINTS.length]!); lamp.position.set(...slot); lamp.scale.setScalar(o.kind === 'big' ? 1.6 : 1);
    this.hall.root.add(lamp); this.lamps.push({ obj: lamp, until: this.elapsed + 120 });
    while (this.lamps.length > this.hall.lampSlots.length) { const old = this.lamps.shift()!; this.hall.root.remove(old.obj); }
    const li = document.createElement('li'); li.textContent = `${p.name} · ${o.kind === 'big' ? 'lễ lớn' : 'đèn sen'}`; if (o.kind === 'big') li.className = 'big';
    this.feed.prepend(li); while (this.feed.children.length > 6) this.feed.lastChild?.remove();
    if (o.kind === 'big') this.burst(slot);
  }

  private showToast(text: string): void {
    this.toast.textContent = text; this.toast.hidden = false;
    clearTimeout(this.toastTimer); this.toastTimer = window.setTimeout(() => { this.toast.hidden = true; }, 4500);
  }

  // ---------- Particles: incense smoke, a burst of golden sparks on a big offering ----------
  private makeSmoke() {
    const n = 48, geo = new BufferGeometry(), pos = new Float32Array(n * 3), ages = new Float32Array(n);
    for (let i = 0; i < n; i++) ages[i] = i / n * 6;
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    const points = new Points(geo, new PointsMaterial({ color: 0xd8d0c4, size: .22, transparent: true, opacity: .22, depthWrite: false }));
    points.frustumCulled = false; this.scene.add(points);
    return { points, ages };
  }
  private updateSmoke(dt: number): void {
    const { points, ages } = this.smoke, pos = points.geometry.getAttribute('position') as BufferAttribute, [x, y, z] = this.hall.incense;
    for (let i = 0; i < ages.length; i++) {
      const a = (ages[i]! + dt) % 6; ages[i] = a;
      pos.setXYZ(i, x + Math.sin(a * 1.3 + i) * .05 * a, y + a * .45, z + Math.cos(a * .9 + i * 2) * .04 * a);
    }
    pos.needsUpdate = true;
  }
  private burst(at: [number, number, number]): void {
    if (this.sparkle) { this.scene.remove(this.sparkle.points); this.sparkle.points.geometry.dispose(); }
    const n = 90, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([at[0], at[1], at[2]], i * 3);
    const geo = new BufferGeometry(); geo.setAttribute('position', new BufferAttribute(pos, 3));
    const points = new Points(geo, new PointsMaterial({ color: 0xffd27a, size: .07, transparent: true, blending: AdditiveBlending, depthWrite: false }));
    points.userData.dirs = Array.from({ length: n }, (_, i) => new Vector3(Math.cos(i * 2.4) * (.3 + (i % 7) * .08), .8 + (i % 5) * .25, Math.sin(i * 2.4) * (.3 + (i % 7) * .08)));
    this.scene.add(points); this.sparkle = { points, t: 0 };
  }
  private updateSparkle(dt: number): void {
    const s = this.sparkle; if (!s) return;
    s.t += dt;
    const pos = s.points.geometry.getAttribute('position') as BufferAttribute, dirs = s.points.userData.dirs as Vector3[];
    for (let i = 0; i < dirs.length; i++) { const d = dirs[i]!; pos.setXYZ(i, pos.getX(i) + d.x * dt, pos.getY(i) + d.y * dt, pos.getZ(i) + d.z * dt); d.y -= .5 * dt; }
    pos.needsUpdate = true; (s.points.material as PointsMaterial).opacity = Math.max(0, 1 - s.t / 3);
    if (s.t > 3) { this.scene.remove(s.points); s.points.geometry.dispose(); this.sparkle = null; }
  }

  /** Swaps the stand-in for the real statue when /models/temple/buddha.glb exists. */
  private async loadStatue(): Promise<void> {
    try {
      const head = await fetch(STATUE_URL, { method: 'HEAD' });
      if (!head.ok || this.disposed) return;
      const gltf = await new GLTFLoader().loadAsync(STATUE_URL);
      if (this.disposed) return;
      const model = gltf.scene, box = new Box3().setFromObject(model), size = box.getSize(new Vector3());
      const k = 3.4 / Math.max(.01, size.y); model.scale.setScalar(k);
      model.position.set(-(box.min.x + size.x / 2) * k, -box.min.y * k, -(box.min.z + size.z / 2) * k);
      model.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
      const statue = this.hall.statue; statue.clear(); statue.add(model);
    } catch { /* keep the stand-in */ }
  }

  // ---------- Frame ----------
  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(.1, (now - this.last) / 1000) : 0; this.last = now; this.elapsed += dt;
    try { this.step(dt); } catch (error) { console.error('[chanh-dien]', error); }
  };

  private step(dt: number): void {
    const t = this.elapsed;
    this.sim.update(dt);
    this.syncAvatars(dt);
    this.updateSmoke(dt); this.updateSparkle(dt);
    for (const f of this.hall.flicker) f.light.intensity = f.base * (.88 + Math.sin(t * 11 + f.base) * .06 + Math.sin(t * 23.7) * .05);
    for (let i = this.lamps.length - 1; i >= 0; i--) if (this.lamps[i]!.until < t) { this.hall.root.remove(this.lamps[i]!.obj); this.lamps.splice(i, 1); }
    // Camera: overview, or close behind the person making a big offering.
    const pos = new Vector3(), look = new Vector3(), p = this.focus && this.sim.people.has(this.focus.key) ? this.focus : null;
    if (p) {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), kneel = p.state === 'bowing' ? -.35 : 0;
      pos.set(p.x - fx * 2.1 + .35, 1.75 + kneel, p.z - fz * 2.1);
      look.set(p.x + fx * 2.4, 1.15 + kneel * .5, p.z + fz * 2.4);
    } else this.overview(t, pos, look);
    const k = smooth(p ? 2.6 : 1.6, dt);
    this.camPos.lerp(pos, k); this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
    this.updateBubbles();
    this.sunDir.copy(this.sun.position).sub(this.sun.target.position).normalize();
    if (this.pack) this.pack.render(this.camera, this.sunDir, 0, t);
    else this.renderer.render(this.scene, this.camera);
  }

  /** One Avatar per person, moved each frame: its gait (walk, run) follows the distance moved. */
  private syncAvatars(dt: number): void {
    for (const [key, a] of this.avatars) if (!this.sim.people.has(key)) { a.dispose(this.scene); this.avatars.delete(key); }
    if (!this.template) return;
    for (const p of this.sim.people.values()) {
      let a = this.avatars.get(p.key);
      if (!a) {
        a = new Avatar(this.template, false); a.networked = true;
        a.setAppearance(randomAppearance(p.seed)); a.addTo(this.scene); this.avatars.set(p.key, a);
      }
      a.setName(p.name);
      const age = this.sim.time - p.stateAt;
      // Kneel on the cushion; at the altar, bow down and up again.
      const kneel = p.state === 'sitting' || (p.state === 'bowing' && Math.floor(age / 1.3) % 2 === 0);
      const flags = EntityFlags.Grounded | (p.running && p.path.length ? EntityFlags.Sprinting : 0) | (kneel ? EntityFlags.Crouching : 0);
      a.update(p.x, 0, p.z, p.yaw, flags, dt, this.elapsed);
    }
  }

  private updateBubbles(): void {
    const layer = this.ui.firstElementChild as HTMLDivElement, v = new Vector3(), shown = new Set<string>();
    for (const p of this.sim.people.values()) {
      if (!p.chat) continue;
      v.set(p.x, 2.25, p.z).project(this.camera);
      if (v.z > 1) continue;
      shown.add(p.key);
      let b = this.bubbles.get(p.key);
      if (!b) { b = el('div', 'tp-bubble', layer); this.bubbles.set(p.key, b); }
      if (b.textContent !== p.chat) b.textContent = p.chat;
      b.style.left = `${(v.x * .5 + .5) * 100}%`; b.style.top = `${(-v.y * .5 + .5) * 100}%`;
    }
    for (const [k, b] of this.bubbles) if (!shown.has(k)) { b.remove(); this.bubbles.delete(k); }
  }

  dispose(): void {
    this.disposed = true; cancelAnimationFrame(this.raf); this.ro.disconnect(); clearTimeout(this.toastTimer);
    for (const a of this.avatars.values()) a.dispose(this.scene);
    this.pack?.dispose();
    this.scene.traverse((o) => { const m = o as { geometry?: { dispose(): void }; material?: { dispose(): void } }; m.geometry?.dispose(); m.material?.dispose(); });
    this.scene.environment?.dispose();
    this.renderer.dispose(); this.renderer.forceContextLoss();
    this.renderer.domElement.remove(); this.ui.remove();
  }
}
