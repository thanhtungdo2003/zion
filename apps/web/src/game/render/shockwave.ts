import {
  FramebufferTexture, SphereGeometry, LinearFilter, Mesh, NoColorSpace, RGBAFormat, Scene, ShaderMaterial, Vector2,
  type Camera, type WebGLRenderer,
} from 'three';
import { SHOCKWAVE, shockwaveFront } from '@zion/shared';

/**
 * Shock waves: a clear sphere racing out from each blast that bends the light at its rim. After
 * the frame is drawn, the screen is copied once and every live sphere is drawn over it, reading
 * that copy shifted along its surface normal (strongest at the silhouette, nothing face-on), with
 * a faint bright edge; it thins out as it grows.
 */
const vertex = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = -view.xyz;
  gl_Position = projectionMatrix * view;
}`;
const fragment = /* glsl */ `
uniform sampler2D uScreen;
uniform vec2 uSize;
uniform float uLife;
uniform float uStrength;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 n = normalize(vNormal);
  float facing = abs(dot(n, normalize(vView)));
  // A shell: the bend lives near the silhouette, fading towards the centre and the very edge.
  float rim = smoothstep(0.15, 0.75, 1.0 - facing) * (1.0 - smoothstep(0.92, 1.0, 1.0 - facing));
  float fade = 1.0 - uLife * uLife;
  vec2 uv = gl_FragCoord.xy / uSize;
  vec2 shift = n.xy * rim * fade * uStrength;
  // Slight chromatic split, as a real lens of compressed air would.
  vec3 col = vec3(texture2D(uScreen, uv - shift * 1.06).r, texture2D(uScreen, uv - shift).g, texture2D(uScreen, uv - shift * 0.94).b);
  col += rim * fade * 0.12;
  gl_FragColor = vec4(col, clamp(rim * 1.6, 0.0, 1.0) * fade);
}`;

interface Wave { mesh: Mesh; material: ShaderMaterial; radius: number; born: number }

export class Shockwaves {
  private readonly scene = new Scene();
  private readonly geometry = new SphereGeometry(1, 48, 32);
  private readonly waves: Wave[] = [];
  private screen: FramebufferTexture | null = null;
  private readonly size = new Vector2();

  /** A blast of `radius` metres at (x, y, z). */
  add(x: number, y: number, z: number, radius: number, now = performance.now()): void {
    if (this.waves.length >= 6) this.remove(0);
    const material = new ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false,
      uniforms: { uScreen: { value: null }, uSize: { value: this.size }, uLife: { value: 0 }, uStrength: { value: 0.07 + Math.min(0.05, radius * 0.005) } },
    });
    const mesh = new Mesh(this.geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(0.01);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.waves.push({ mesh, material, radius, born: now });
  }

  get active(): boolean { return this.waves.length > 0; }

  /** Draws the live waves over the finished frame (call right after the frame's render). */
  render(renderer: WebGLRenderer, camera: Camera, now = performance.now()): void {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]!, t = (now - w.born) / 1000;
      if (t >= SHOCKWAVE.seconds) { this.remove(i); continue; }
      w.mesh.scale.setScalar(Math.max(0.01, shockwaveFront(w.radius, t)));
      w.material.uniforms.uLife!.value = t / SHOCKWAVE.seconds;
    }
    if (!this.waves.length) return;
    renderer.getDrawingBufferSize(this.size);
    if (!this.screen || this.screen.image.width !== this.size.x || this.screen.image.height !== this.size.y) {
      this.screen?.dispose();
      this.screen = new FramebufferTexture(this.size.x, this.size.y);
      this.screen.format = RGBAFormat;
      this.screen.minFilter = this.screen.magFilter = LinearFilter;
      this.screen.colorSpace = NoColorSpace;
    }
    const target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(this.screen);
    for (const w of this.waves) w.material.uniforms.uScreen!.value = this.screen;
    renderer.autoClear = false;
    renderer.render(this.scene, camera);
    renderer.autoClear = autoClear;
    renderer.setRenderTarget(target);
  }

  private remove(i: number): void {
    const [w] = this.waves.splice(i, 1);
    if (!w) return;
    this.scene.remove(w.mesh);
    w.material.dispose();
  }

  dispose(): void {
    while (this.waves.length) this.remove(0);
    this.geometry.dispose();
    this.screen?.dispose();
  }
}
