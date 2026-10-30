import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, type Camera, type Scene } from 'three';
import { partHealth, type VehicleState } from '@zion/shared';

/**
 * A helicopter's instrument panel, seen below the windscreen from the pilot's seat: airspeed,
 * altitude above the ground, vertical speed, attitude, heading, collective and rotor rpm, and the
 * warning lights of damaged parts. A canvas redrawn a few times a second on a plane that sits in
 * front of the pilot's eye (it turns with the cockpit, as the camera does).
 */
export class CockpitPanel {
  private readonly canvas: HTMLCanvasElement | null;
  private readonly texture: CanvasTexture | null;
  private readonly mesh: Mesh | null;
  private drawnAt = 0;

  constructor(private readonly scene: Scene) {
    if (typeof document === 'undefined') { this.canvas = null; this.texture = null; this.mesh = null; return; }
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024; this.canvas.height = 320;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(new PlaneGeometry(.66, .2), new MeshBasicMaterial({ map: this.texture, depthTest: false, depthWrite: false }));
    this.mesh.renderOrder = 10;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Shown while flying from the pilot's seat (null hides it). */
  update(camera: Camera, v: VehicleState | null, altitude: number, now: number): void {
    const mesh = this.mesh;
    if (!mesh) return;
    mesh.visible = !!v;
    if (!v) return;
    // Below the line of sight, tilted towards the eye.
    mesh.position.set(0, -.27, -.6).applyQuaternion(camera.quaternion).add(camera.position);
    mesh.quaternion.copy(camera.quaternion);
    mesh.rotateX(-.45);
    if (now - this.drawnAt > 100) { this.drawnAt = now; this.draw(v, altitude); }
  }

  private draw(v: VehicleState, altitude: number): void {
    const c = this.canvas!.getContext('2d');
    if (!c) return;
    const m = v.motion, W = 1024, H = 320;
    c.fillStyle = '#16191b'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#2c3236'; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6);
    const dial = (x: number, label: string, value: string, fraction: number, warn = false) => {
      const cx = x, cy = 150, r = 82;
      c.fillStyle = '#0b0d0e'; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#59626a'; c.lineWidth = 3; c.stroke();
      const a = -Math.PI * 1.25 + Math.max(0, Math.min(1, fraction)) * Math.PI * 1.5;
      c.strokeStyle = warn ? '#ff5a4a' : '#f3f0e3'; c.lineWidth = 6; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); c.stroke();
      c.fillStyle = '#9aa3ab'; c.font = '600 22px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(label, cx, cy + r + 30);
      c.fillStyle = warn ? '#ff7b6e' : '#e9f2df'; c.font = '700 30px ui-monospace, monospace'; c.fillText(value, cx, cy + 46);
    };
    const speed = Math.hypot(v.speed, m?.lateral ?? 0) * 3.6;
    dial(110, 'TỐC ĐỘ km/h', speed.toFixed(0), speed / 300);
    dial(300, 'ĐỘ CAO m', altitude.toFixed(0), altitude / 300);
    dial(490, 'LÊN/XUỐNG m/s', (m?.vy ?? 0).toFixed(1), .5 + (m?.vy ?? 0) / 30, (m?.vy ?? 0) < -8);
    // Attitude: the horizon line tilts with the bank and moves with the pitch.
    const ax = 680, ay = 150;
    c.save(); c.beginPath(); c.arc(ax, ay, 82, 0, Math.PI * 2); c.clip();
    c.translate(ax, ay); c.rotate(-(m?.roll ?? 0)); c.translate(0, (m?.pitch ?? 0) * 160);
    c.fillStyle = '#3d6ea8'; c.fillRect(-200, -400, 400, 400); c.fillStyle = '#6b4a2b'; c.fillRect(-200, 0, 400, 400);
    c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.moveTo(-90, 0); c.lineTo(90, 0); c.stroke();
    c.restore();
    c.strokeStyle = '#ffd34d'; c.lineWidth = 5; c.beginPath(); c.moveTo(ax - 40, ay); c.lineTo(ax - 12, ay); c.moveTo(ax + 12, ay); c.lineTo(ax + 40, ay); c.stroke();
    c.fillStyle = '#9aa3ab'; c.font = '600 22px system-ui, sans-serif'; c.textAlign = 'center';
    c.fillText(`HƯỚNG ${String(Math.round(((-v.yaw * 180 / Math.PI) % 360 + 360) % 360)).padStart(3, '0')}°`, ax, ay + 112);
    // Collective and rotor rpm bars, damage lights.
    const bar = (x: number, label: string, fraction: number, warn: boolean) => {
      c.fillStyle = '#0b0d0e'; c.fillRect(x, 60, 34, 180);
      c.fillStyle = warn ? '#ff5a4a' : '#7be08a'; const h = 180 * Math.max(0, Math.min(1, fraction)); c.fillRect(x, 240 - h, 34, h);
      c.fillStyle = '#9aa3ab'; c.font = '600 20px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(label, x + 17, 272);
    };
    bar(820, 'LỰC NÂNG', m?.collective ?? 0, false);
    bar(880, 'VÒNG QUAY', v.rotor ?? 0, (v.rotor ?? 0) < .85);
    const lights: Array<[string, number]> = [['CQ', partHealth(v, 'mainRotor')], ['ĐUÔI', partHealth(v, 'tailRotor')], ['ĐC', partHealth(v, 'engine')]];
    lights.forEach(([name, h], i) => {
      c.fillStyle = h <= 0 ? '#ff3b30' : h < .5 ? '#ffb020' : '#1f3a26'; c.fillRect(940, 60 + i * 62, 70, 48);
      c.fillStyle = h < .5 ? '#111' : '#7be08a'; c.font = '700 18px system-ui, sans-serif'; c.textAlign = 'center'; c.fillText(name, 975, 91 + i * 62);
    });
    this.texture!.needsUpdate = true;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose(); (this.mesh.material as MeshBasicMaterial).dispose(); this.texture?.dispose();
  }
}
