import { DataTexture, LinearFilter, Matrix4, Mesh, PlaneGeometry, RGBAFormat, ShaderMaterial, Vector2, Vector3, type Camera, type Scene } from 'three';
import { Mask, makeRayHit, type CollisionWorld } from '@zion/physics';

const DEG = Math.PI / 180;
/** Rays cast across the cone each frame for the line-of-sight shadow. */
const VIS_RAYS = 128;

/**
 * Full-screen pass that darkens everything outside the cone. Each pixel's view ray is intersected
 * with the ground plane at the player's feet, and that point is tested against the cone — exact
 * for the ground and a good match for anything standing on it in this top-down view.
 */
const VERT = `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG = `
varying vec2 vNdc;
uniform mat4 uInvViewProj;
uniform vec3 uCam;
uniform vec3 uOrigin;
uniform vec2 uDir;
uniform float uCosHalf;
uniform float uRange;
uniform float uDarkness;
uniform sampler2D uVis;
uniform float uHalf;
void main() {
  vec4 far = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 ray = normalize(far.xyz / far.w - uCam);
  float t = (uOrigin.y - uCam.y) / min(ray.y, -1e-4);
  vec3 p = uCam + ray * max(t, 0.0);
  vec2 d = p.xz - uOrigin.xz;
  float dist = length(d);
  float c = dist > 1e-3 ? dot(d / dist, uDir) : 1.0;
  // Soft edges on the angle and at the far end; a small lit circle around the feet.
  float inAngle = smoothstep(uCosHalf - 0.08, uCosHalf + 0.04, c);
  float inRange = 1.0 - smoothstep(uRange * 0.85, uRange, dist);
  // Line of sight: how far each ray across the cone gets before a wall; beyond it is hidden.
  // (A little slack keeps the faces of walls themselves lit in this top-down projection.)
  vec2 dn = dist > 1e-3 ? d / dist : uDir;
  float ang = atan(uDir.x * dn.y - uDir.y * dn.x, dot(uDir, dn));
  float reach = texture2D(uVis, vec2(clamp((ang + uHalf) / (2.0 * uHalf), 0.0, 1.0), 0.5)).r * uRange;
  float seen = 1.0 - smoothstep(reach + 0.1, reach + 0.4, dist);
  inRange *= seen;
  float lit = inAngle * inRange;
  gl_FragColor = vec4(0.0, 0.0, 0.02, uDarkness * (1.0 - lit));
}`;

/**
 * The character's field of view: an invisible cone from the eyes along the aim direction.
 * Gameplay queries `canSee` / `contains`; on screen, the area *outside* the cone is dimmed.
 */
export class VisionCone {
  range = 40;
  halfAngle = 76 * DEG;
  readonly origin = new Vector3();
  readonly direction = new Vector3(0, 0, -1);
  private readonly overlay: Mesh;
  private readonly material: ShaderMaterial;
  private readonly tmp = new Vector3();
  private readonly hit = makeRayHit();
  private readonly invViewProj = new Matrix4();
  /** Ray reach across the cone (0…1 of range), one texel per ray. */
  private readonly visData = new Uint8Array(VIS_RAYS * 4);
  private readonly visTex = new DataTexture(this.visData, VIS_RAYS, 1, RGBAFormat);
  private nextSightAt = 0;

  constructor(private readonly scene: Scene) {
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uInvViewProj: { value: this.invViewProj },
        uCam: { value: new Vector3() },
        uOrigin: { value: new Vector3() },
        uDir: { value: new Vector2(0, -1) },
        uCosHalf: { value: Math.cos(this.halfAngle) },
        uRange: { value: this.range },
        uDarkness: { value: 0.3 },
        uVis: { value: this.visTex },
        uHalf: { value: this.halfAngle },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.visTex.magFilter = LinearFilter;
    this.visTex.minFilter = LinearFilter;
    this.visData.fill(255);
    this.visTex.needsUpdate = true;
    this.overlay = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.overlay.frustumCulled = false;
    this.overlay.renderOrder = 1000;
    scene.add(this.overlay);
  }

  /** The darkening pass only reads in the top-down view. */
  setOverlay(on: boolean): void {
    this.overlay.visible = on;
  }

  /** eye = world eye position; feetY = ground under the player; yaw/pitch = aim (yaw 0 → −Z). */
  update(ex: number, ey: number, ez: number, yaw: number, pitch: number, night: number, camera: Camera, feetY: number, world?: CollisionWorld | null): void {
    this.origin.set(ex, ey, ez);
    const cp = Math.cos(pitch);
    this.direction.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp).normalize();
    const u = this.material.uniforms;
    camera.updateMatrixWorld();
    this.invViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    (u.uCam!.value as Vector3).setFromMatrixPosition(camera.matrixWorld);
    (u.uOrigin!.value as Vector3).set(ex, feetY + 0.05, ez);
    (u.uDir!.value as Vector2).set(-Math.sin(yaw), -Math.cos(yaw));
    u.uCosHalf!.value = Math.cos(this.halfAngle);
    u.uHalf!.value = this.halfAngle;
    const now = performance.now();
    if (world && this.overlay.visible && now >= this.nextSightAt) {
      this.castSight(ex, ey, ez, yaw, world);
      this.nextSightAt = now + 50;
    }
    u.uRange!.value = this.range;
    // Slightly darker outside the cone at night.
    u.uDarkness!.value = 0.28 + 0.1 * night;
  }

  /** Casts a fan of horizontal rays from the eyes across the cone (walls stop them). */
  private castSight(ex: number, ey: number, ez: number, yaw: number, world: CollisionWorld): void {
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    for (let i = 0; i < VIS_RAYS; i++) {
      // Same signed-angle convention as the shader: rotate the facing by θ in the x/z plane.
      const th = -this.halfAngle + (i / (VIS_RAYS - 1)) * 2 * this.halfAngle;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const dx = fx * c - fz * s;
      const dz = fx * s + fz * c;
      let t = this.range;
      if (world.raycast(ex, ey, ez, dx, 0, dz, this.range, Mask.LineOfSight, this.hit)) t = this.hit.t;
      this.visData[i * 4] = Math.round((t / this.range) * 255);
    }
    this.visTex.needsUpdate = true;
  }

  /** Geometric test only: is the point inside the cone? */
  contains(x: number, y: number, z: number): boolean {
    const d = this.tmp.set(x - this.origin.x, y - this.origin.y, z - this.origin.z);
    const dist = d.length();
    if (dist > this.range) return false;
    if (dist < 1e-3) return true;
    // Horizontal angle only: the cone is about where the character faces, not up/down.
    const h = Math.hypot(d.x, d.z) || 1;
    const fh = Math.hypot(this.direction.x, this.direction.z) || 1;
    return (d.x * this.direction.x + d.z * this.direction.z) / (h * fh) >= Math.cos(this.halfAngle);
  }

  /** Inside the cone and not blocked by terrain or solid props. */
  canSee(x: number, y: number, z: number, world: CollisionWorld | null | undefined): boolean {
    if (!this.contains(x, y, z)) return false;
    if (!world) return true;
    const d = this.tmp.set(x - this.origin.x, y - this.origin.y, z - this.origin.z);
    const dist = d.length();
    if (dist < 1e-3) return true;
    d.divideScalar(dist);
    return !world.raycast(this.origin.x, this.origin.y, this.origin.z, d.x, d.y, d.z, dist - 0.1, Mask.LineOfSight, this.hit);
  }

  dispose(): void {
    this.scene.remove(this.overlay);
    this.overlay.geometry.dispose();
    this.material.dispose();
    this.visTex.dispose();
  }
}
