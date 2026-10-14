import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, type Scene } from 'three';

export interface SquadMarkerTarget { id: number; name: string; x: number; y: number; z: number }

/** Shared texture of the blue teammate diamond. */
let diamondTexture: CanvasTexture | null = null;
function diamond(): CanvasTexture {
  if (diamondTexture) return diamondTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath(); ctx.moveTo(32, 4); ctx.lineTo(58, 32); ctx.lineTo(32, 60); ctx.lineTo(6, 32); ctx.closePath();
  ctx.fillStyle = '#3d9bff'; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(4, 20, 40, .9)'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(32, 16); ctx.lineTo(45, 32); ctx.lineTo(32, 48); ctx.lineTo(19, 32); ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, .35)'; ctx.fill();
  diamondTexture = new CanvasTexture(canvas);
  diamondTexture.minFilter = LinearFilter;
  return diamondTexture;
}

function nameTexture(name: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '700 26px "Noto Sans", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0, 0, 0, .85)'; ctx.strokeText(name, 128, 24, 246);
  ctx.fillStyle = '#cfe6ff'; ctx.fillText(name, 128, 24, 246);
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  return tex;
}

/** Overlay sprites: drawn on top of everything (seen through walls), constant size on screen. */
function overlay(map: CanvasTexture): Sprite {
  const sprite = new Sprite(new SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true, sizeAttenuation: false }));
  sprite.renderOrder = 999;
  sprite.frustumCulled = false;
  return sprite;
}

/** Blue diamond and name over each teammate's head, visible through walls in first and third person. */
export class SquadMarkers {
  private readonly markers = new Map<number, { name: string; diamond: Sprite; label: Sprite }>();
  constructor(private readonly scene: Scene) {}

  update(targets: readonly SquadMarkerTarget[]): void {
    const live = new Set<number>();
    for (const t of targets) {
      live.add(t.id);
      let m = this.markers.get(t.id);
      if (m && m.name !== t.name) { this.remove(t.id); m = undefined; }
      if (!m) {
        const d = overlay(diamond()); d.scale.set(.028, .028, 1);
        const label = overlay(nameTexture(t.name)); label.scale.set(.13, .024, 1);
        // Label sits just above the diamond on screen: the centre is shifted up in sprite space.
        label.center.set(.5, -.9);
        this.scene.add(d, label);
        m = { name: t.name, diamond: d, label };
        this.markers.set(t.id, m);
      }
      m.diamond.position.set(t.x, t.y, t.z);
      m.label.position.set(t.x, t.y, t.z);
    }
    for (const id of [...this.markers.keys()]) if (!live.has(id)) this.remove(id);
  }

  private remove(id: number): void {
    const m = this.markers.get(id);
    if (!m) return;
    this.scene.remove(m.diamond, m.label);
    m.diamond.material.dispose();
    m.label.material.map?.dispose(); m.label.material.dispose();
    this.markers.delete(id);
  }

  dispose(): void { for (const id of [...this.markers.keys()]) this.remove(id); }
}
