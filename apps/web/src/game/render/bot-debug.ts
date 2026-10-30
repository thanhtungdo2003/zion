import { BufferGeometry, CanvasTexture, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Sprite, SpriteMaterial, type Scene } from 'three';
import type { BotDebugMessage } from '@zion/shared';

/**
 * /aidebug overlay: what each bot near the player is doing, drawn in the world —
 * - its long route (yellow), the goal it is making for (green), its target (red),
 *   the cover it is taking (blue) and the firing position its tactic chose (magenta);
 * - over its head: mode, tactic, personality, squad role and health.
 * Rebuilt from each server message (a few times a second); nothing is kept between them.
 */
const COLORS = { route: [1, .85, .2], goal: [.3, 1, .4], target: [1, .25, .2], cover: [.3, .6, 1], spot: [1, .3, 1] } as const;

export class BotDebugOverlay {
  private readonly group = new Group();
  private lines: LineSegments | null = null;
  private readonly labels = new Map<number, { sprite: Sprite; text: string }>();

  constructor(private readonly scene: Scene) { scene.add(this.group); }

  update(m: BotDebugMessage): void {
    const pos: number[] = [], col: number[] = [];
    const seg = (a: readonly number[], b: readonly number[], c: readonly number[]) => { pos.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!); col.push(...c, ...c); };
    const seen = new Set<number>();
    for (const b of m.bots) {
      const head = [b.x, b.y + 1.9, b.z], feet = [b.x, b.y + .3, b.z];
      let prev = feet;
      for (const [x, z] of b.route) { const p = [x, b.y + .3, z]; seg(prev, p, COLORS.route); prev = p; }
      if (b.goal) seg(feet, [b.goal[0], b.goal[1] + .3, b.goal[2]], COLORS.goal);
      if (b.target) seg([b.x, b.y + 1.5, b.z], [b.target[0], b.target[1] + 1.2, b.target[2]], COLORS.target);
      for (const [k, p] of [['cover', b.cover], ['spot', b.spot]] as const) if (p) {
        // A small cross on the spot and a line to it.
        seg(feet, [p[0], p[1] + .3, p[2]], COLORS[k]);
        seg([p[0] - .5, p[1] + .3, p[2]], [p[0] + .5, p[1] + .3, p[2]], COLORS[k]); seg([p[0], p[1] + .3, p[2] - .5], [p[0], p[1] + .3, p[2] + .5], COLORS[k]);
      }
      seen.add(b.id);
      const text = `${b.mode}${b.tactic ? ' · ' + b.tactic : ''}${b.planning ? ' · lập đường' : b.blocked ? ' · KHÔNG ĐƯỜNG' : ''}\n${b.personality} · ${b.role}${b.squad ? ' · ' + b.squad : ''} · ${b.health}`;
      let label = this.labels.get(b.id);
      if (!label) { label = { sprite: new Sprite(new SpriteMaterial({ depthTest: false, transparent: true })), text: '' }; label.sprite.renderOrder = 20; this.group.add(label.sprite); this.labels.set(b.id, label); }
      if (label.text !== text) { label.text = text; this.paint(label.sprite, text); }
      label.sprite.position.set(head[0]!, head[1]! + .4, head[2]!);
    }
    for (const [id, l] of this.labels) if (!seen.has(id)) { this.group.remove(l.sprite); l.sprite.material.map?.dispose(); l.sprite.material.dispose(); this.labels.delete(id); }
    if (this.lines) { this.group.remove(this.lines); this.lines.geometry.dispose(); this.lines = null; }
    if (!pos.length) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.lines = new LineSegments(g, new LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }));
    this.lines.renderOrder = 19;
    this.group.add(this.lines);
  }

  private paint(sprite: Sprite, text: string): void {
    if (typeof document === 'undefined') return;
    const c = document.createElement('canvas'), lines = text.split('\n');
    c.width = 512; c.height = 96;
    const x = c.getContext('2d')!;
    x.fillStyle = 'rgba(0,0,0,.6)'; x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#fff'; x.font = '600 34px system-ui, sans-serif';
    lines.forEach((l, i) => x.fillText(l, 10, 40 + i * 42));
    sprite.material.map?.dispose();
    sprite.material.map = new CanvasTexture(c); sprite.material.needsUpdate = true;
    sprite.scale.set(3.2, .6, 1);
  }

  dispose(): void {
    this.update({ t: 'botDebug', bots: [] });
    this.scene.remove(this.group);
  }
}
