import { CanvasTexture, Group, LinearFilter, Sprite, SpriteMaterial, type Scene } from 'three';

/** One soft, round puff shared by every smoke sprite. */
function puffTexture(): CanvasTexture {
  const size = 64, canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(.45, 'rgba(255,255,255,.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(canvas);
  t.minFilter = LinearFilter; t.magFilter = LinearFilter;
  return t;
}

interface Puff { sprite: Sprite; x: number; y: number; z: number; size: number; drift: number; spin: number; delay: number }
interface Cloud { group: Group; material: SpriteMaterial; puffs: Puff[]; age: number; life: number; radius: number }

/**
 * Smoke grenade screens: a billowing grey cloud that swells for a couple of seconds, hangs,
 * drifts and thins out at the end of its life. Purely visual (camera-facing soft sprites).
 */
export class SmokeClouds {
  private readonly clouds = new Map<number, Cloud>();
  private texture: CanvasTexture | null = null;

  constructor(private readonly scene: Scene) {}

  add(id: number, x: number, y: number, z: number, radius: number, ms: number): void {
    if (this.clouds.has(id) || typeof document === 'undefined') return;
    this.texture ??= puffTexture();
    const material = new SpriteMaterial({ map: this.texture, color: 0xc8cbcd, transparent: true, depthWrite: false, opacity: 0 });
    const group = new Group();
    group.position.set(x, y, z);
    const puffs: Puff[] = [];
    const count = Math.round(26 + radius * 5);
    for (let i = 0; i < count; i++) {
      // A low dome: wider than tall, densest in the middle.
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius * .9;
      const sprite = new Sprite(material);
      const p: Puff = { sprite, x: Math.cos(a) * r, y: .4 + Math.random() * radius * .55 * (1 - r / radius * .5), z: Math.sin(a) * r, size: radius * (.55 + Math.random() * .5), drift: Math.random() * Math.PI * 2, spin: (Math.random() - .5) * .3, delay: (r / radius) * 1.6 };
      sprite.renderOrder = 4;
      group.add(sprite);
      puffs.push(p);
    }
    this.scene.add(group);
    this.clouds.set(id, { group, material, puffs, age: 0, life: ms / 1000, radius });
  }

  update(dt: number): void {
    for (const [id, c] of this.clouds) {
      c.age += dt;
      if (c.age >= c.life) { this.scene.remove(c.group); c.material.dispose(); this.clouds.delete(id); continue; }
      // Thick quickly, thinning over the last few seconds.
      c.material.opacity = Math.min(1, c.age / 1.2) * Math.min(1, (c.life - c.age) / 4) * .92;
      for (const p of c.puffs) {
        const grow = Math.min(1, Math.max(0, (c.age - p.delay) / 2.5));
        const s = p.size * (.25 + .75 * grow) * (1 + c.age * .012);
        p.sprite.scale.set(s, s, 1);
        p.drift += dt * .15;
        p.sprite.position.set(p.x + Math.cos(p.drift) * .3 + c.age * .04, p.y + c.age * .02, p.z + Math.sin(p.drift) * .3);
      }
    }
  }

  dispose(): void {
    for (const c of this.clouds.values()) { this.scene.remove(c.group); c.material.dispose(); }
    this.clouds.clear();
    this.texture?.dispose();
  }
}
