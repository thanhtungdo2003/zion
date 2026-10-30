import { Color, Matrix4, Quaternion, SkinnedMesh as SkinnedMeshClass, Vector3, type Bone, type Material, type MeshStandardMaterial, type Object3D, type SkinnedMesh } from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { HairStyle } from '@zion/shared';
import { cachedFetch } from '@/lib/preload';
import { gltfLoader } from './gltf-loader';

/**
 * The hair pack's styles on the survivor (models/hair/hair_NN.glb, split from the pack as made:
 * meshes, textures and strand bones untouched). Each style's rig is bip_head plus chains of strand
 * bones: the head bone follows the survivor's head, the strands are simulated (gravity, inertia,
 * a spring back to their styled shape, the skull and shoulders in the way), and a helmet presses
 * the hair under it in onto the skull. A colour tints the texture by its own light and dark.
 */

/**
 * Where a style's bip_head sits in the survivor's own space (metres; both face +Z with +Y up):
 * fitted on the pack's shared scalp, its top on the survivor's skull, centred on it.
 */
export const HAIR_HEAD_AT = new Vector3(0, 1.556, -.01);
/** The skull and a helmet's inside in bip_head space: centre and radii (m). */
const SKULL = { c: new Vector3(0, .05, 0), r: new Vector3(.072, .1, .088) };
const HELMET = { c: new Vector3(0, .05, 0), r: new Vector3(.08, .104, .096), brim: -.01 };
const GRAVITY = new Vector3(0, -9.8, 0);

interface StrandBone {
  bone: Bone;
  /** Rest local rotation and position under its parent; the tail in the bone's own rest frame. */
  q0: Quaternion; p0: Vector3; tail: Vector3;
  /** Stiffness back to the styled shape (roots stiffer than tips). */
  stiff: number;
}

interface HairTemplate {
  scene: Object3D;
  /** bip_head's matrix in the scene at rest (to place the scene from where bip_head must be). */
  headRest: Matrix4;
}

const templates = new Map<HairStyle, Promise<HairTemplate | null>>();

/** Loads a style once (null in tests and on failure: the body is simply shown without hair). */
export function loadHairStyle(style: HairStyle): Promise<HairTemplate | null> {
  if (style === 'bald' || typeof document === 'undefined') return Promise.resolve(null);
  let t = templates.get(style);
  if (!t) {
    t = cachedFetch(`/models/hair/${style}.glb`).then((r) => r.arrayBuffer()).then((buf) => gltfLoader().parseAsync(buf, '/models/hair/')).then((g) => {
      g.scene.updateMatrixWorld(true);
      const head = findHead(g.scene);
      return head ? { scene: g.scene, headRest: head.matrixWorld.clone() } : null;
    }).catch((err: unknown) => { console.warn('hair style unavailable', style, err); return null; });
    templates.set(style, t);
  }
  return t;
}

function findHead(root: Object3D): Bone | null {
  let head: Bone | null = null;
  root.traverse((o) => { if (!head && (o as Bone).isBone && /^bip_head/.test(o.name)) head = o as Bone; });
  return head;
}

/** Shader tint: the texture's luminance times the chosen colour, so strands keep their detail. */
interface HairUniforms { uHairTint: { value: Color }; uHairTintAmount: { value: number }; uCapCenter: { value: Vector3 }; uCapRadii: { value: Vector3 }; uCapBrim: { value: number }; uCapOn: { value: number } }

function tintable(material: Material, uniforms: HairUniforms): Material {
  const m = material.clone() as MeshStandardMaterial;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uCapCenter; uniform vec3 uCapRadii; uniform float uCapBrim; uniform float uCapOn;')
      .replace('#include <skinning_vertex>', `#include <skinning_vertex>
      // A helmet: hair above its brim is pressed inside it (the hair's own space).
      if (uCapOn > .5) {
        vec3 d = transformed - uCapCenter;
        float above = smoothstep(uCapBrim - .02, uCapBrim + .02, d.y);
        float l = length(d / uCapRadii);
        if (l > 1.0) transformed = mix(transformed, uCapCenter + d / l, above);
      }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHairTint; uniform float uHairTintAmount;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      { float lum = dot(diffuseColor.rgb, vec3(.299, .587, .114)); diffuseColor.rgb = mix(diffuseColor.rgb, uHairTint * lum * 1.7, uHairTintAmount); }`);
  };
  m.customProgramCacheKey = () => 'zion-hair';
  return m;
}

/** One survivor's hair: placed on the head each frame, strands simulated. */
export class HairInstance {
  readonly root: Object3D;
  private readonly head: Bone;
  private readonly headRestInv: Matrix4;
  private readonly strands: StrandBone[] = [];
  private readonly sim: Array<{ pos: Vector3; prev: Vector3 }> = [];
  private readonly uniforms: HairUniforms = { uHairTint: { value: new Color() }, uHairTintAmount: { value: 0 }, uCapCenter: { value: new Vector3() }, uCapRadii: { value: new Vector3() }, uCapBrim: { value: 0 }, uCapOn: { value: 0 } };
  private helmet = false;
  private fresh = true;
  private readonly materials: Material[] = [];
  private readonly tmp = { m: new Matrix4(), q: new Quaternion(), q2: new Quaternion(), v: new Vector3(), v2: new Vector3(), v3: new Vector3(), s: new Vector3() };

  constructor(template: HairTemplate) {
    this.root = cloneSkinned(template.scene);
    this.root.matrixAutoUpdate = false;
    this.root.name = 'hair-style';
    this.root.updateMatrixWorld(true);
    this.head = findHead(this.root)!;
    this.headRestInv = template.headRest.clone().invert();
    const meshes: SkinnedMesh[] = [];
    this.root.traverse((o) => { const m = o as SkinnedMesh; if (m.isSkinnedMesh) meshes.push(m); });
    // Hair cards are layered and see-through: drawn twice, solid where the strands are dense (so
    // they hide what is behind them), then softly blended at their thin edges on top.
    for (const mesh of meshes) {
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
      const blended = source.transparent || source.alphaTest > 0;
      const solid = tintable(source, this.uniforms) as MeshStandardMaterial;
      this.materials.push(solid);
      mesh.material = solid;
      if (!blended) continue;
      solid.transparent = false; solid.alphaTest = .5; solid.depthWrite = true;
      const soft = tintable(source, this.uniforms) as MeshStandardMaterial;
      soft.transparent = true; soft.alphaTest = 0; soft.depthWrite = false;
      this.materials.push(soft);
      const edges = new SkinnedMeshClass(mesh.geometry, soft);
      edges.name = `${mesh.name}-edges`;
      edges.bind(mesh.skeleton, mesh.bindMatrix);
      edges.frustumCulled = false;
      edges.renderOrder = 2;
      mesh.add(edges);
    }
    // The helmet cap in the meshes' own space (fixed relative to bip_head: nothing between moves).
    const mesh0 = meshes[0];
    if (mesh0) {
      const toMesh = mesh0.matrixWorld.clone().invert().multiply(this.head.matrixWorld);
      const s = new Vector3().setFromMatrixScale(toMesh).x || 1;
      this.uniforms.uCapCenter.value.copy(HELMET.c).applyMatrix4(toMesh);
      this.uniforms.uCapRadii.value.copy(HELMET.r).multiplyScalar(s);
      this.uniforms.uCapBrim.value = HELMET.brim * s;
    }
    this.buildStrands(meshes);
  }

  /** Strand bones parents first, each with its rest pose and a tail (its child, or where its vertices hang). */
  private buildStrands(meshes: SkinnedMesh[]): void {
    const centroid = new Map<Bone, { sum: Vector3; n: number }>();
    const v = new Vector3();
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute('position'), idx = mesh.geometry.getAttribute('skinIndex'), wt = mesh.geometry.getAttribute('skinWeight');
      if (!idx || !wt) continue;
      for (let i = 0; i < pos.count; i++) {
        let best = 0, bw = 0;
        for (let c = 0; c < 4; c++) if (wt.getComponent(i, c) > bw) { bw = wt.getComponent(i, c); best = idx.getComponent(i, c); }
        const bone = mesh.skeleton.bones[best];
        if (!bone) continue;
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const e = centroid.get(bone) ?? { sum: new Vector3(), n: 0 };
        e.sum.add(v); e.n++; centroid.set(bone, e);
      }
    }
    const visit = (bone: Bone, depth: number) => {
      for (const child of bone.children) {
        if (!(child as Bone).isBone) continue;
        const b = child as Bone;
        const head = b.getWorldPosition(new Vector3());
        const next = b.children.find((c) => (c as Bone).isBone);
        let tailWorld: Vector3;
        if (next) tailWorld = next.getWorldPosition(new Vector3());
        else {
          const c = centroid.get(b);
          tailWorld = c && c.n ? c.sum.clone().divideScalar(c.n).sub(head).multiplyScalar(2).add(head) : head.clone().add(new Vector3(0, -.04, 0));
        }
        if (tailWorld.distanceTo(head) < .005) tailWorld.add(new Vector3(0, -.02, 0));
        const tail = b.worldToLocal(tailWorld.clone());
        // A lone short strand keeps its styled shape (spikes, fringes); chains (ponytails, braids,
        // long locks) hang: firm at the root, loose along their length.
        let chain = 0; b.traverse((o) => { if (o !== b && (o as Bone).isBone) chain++; });
        const long = tailWorld.distanceTo(head) > .1;
        const stiff = depth === 0 ? (chain === 0 && !long ? .3 : .2) : .06;
        this.strands.push({ bone: b, q0: b.quaternion.clone(), p0: b.position.clone(), tail, stiff });
        this.sim.push({ pos: new Vector3(), prev: new Vector3() });
        visit(b, depth + 1);
      }
    };
    visit(this.head, 0);
  }

  /** null keeps the texture's own colour. */
  setColor(hex: string | null): void {
    if (hex) this.uniforms.uHairTint.value.set(hex);
    this.uniforms.uHairTintAmount.value = hex ? 1 : 0;
  }

  /** A helmet or hood on: the hair under it is pressed in. */
  setHelmet(on: boolean): void { this.helmet = on; this.uniforms.uCapOn.value = on ? 1 : 0; }

  /**
   * Places the hair (its bip_head on `headWorld`, a world matrix) under `parent`, then steps the
   * strands by `dt` seconds.
   */
  update(parent: Object3D, headWorld: Matrix4, dt: number, simulate = true): void {
    const t = this.tmp;
    // root (in parent) = parent⁻¹ · headWorld · headRest⁻¹
    this.root.matrix.copy(parent.matrixWorld).invert().multiply(headWorld).multiply(this.headRestInv);
    this.root.updateMatrixWorld(true);
    // Far away: the hair rides on the head as last shaped (strand physics is not seen there).
    if (!simulate) { this.fresh = true; return; }
    const h = Math.min(.05, Math.max(0, dt));
    // The skull (and the helmet) in world space, from bip_head.
    const headM = this.head.matrixWorld;
    const headInv = t.m.copy(headM).invert();
    const damping = Math.exp(-h * 2.2);
    for (let k = 0; k < this.strands.length; k++) {
      const s = this.strands[k]!, p = this.sim[k]!, bone = s.bone;
      // Rest pose under the (already updated) parent: the styled shape.
      bone.quaternion.copy(s.q0); bone.position.copy(s.p0);
      bone.updateMatrixWorld(true);
      const root = bone.getWorldPosition(t.v);
      const target = t.v2.copy(s.tail).applyMatrix4(bone.matrixWorld), restLen = target.distanceTo(root);
      if (this.fresh || p.pos.distanceToSquared(target) > .25) { p.pos.copy(target); p.prev.copy(target); }
      // Verlet: inertia, gravity, a spring back to the styled shape.
      const vel = t.v3.copy(p.pos).sub(p.prev).multiplyScalar(damping);
      p.prev.copy(p.pos);
      p.pos.add(vel).addScaledVector(GRAVITY, h * h * .7).lerp(target, 1 - Math.pow(1 - s.stiff, h * 60));
      // The skull keeps the strands out; a helmet keeps those above its brim in.
      const local = t.s.copy(p.pos).applyMatrix4(headInv);
      const d = local.clone().sub(SKULL.c), outside = Math.hypot(d.x / SKULL.r.x, d.y / SKULL.r.y, d.z / SKULL.r.z);
      if (outside < 1) local.copy(SKULL.c).addScaledVector(d, 1 / Math.max(.05, outside));
      if (this.helmet && local.y > HELMET.brim) {
        const e = local.clone().sub(HELMET.c), inside = Math.hypot(e.x / HELMET.r.x, e.y / HELMET.r.y, e.z / HELMET.r.z);
        if (inside > 1) local.copy(HELMET.c).addScaledVector(e, 1 / inside);
      }
      p.pos.copy(local.applyMatrix4(headM));
      // The strand keeps its length.
      const dir = p.pos.clone().sub(root);
      p.pos.copy(root).addScaledVector(dir, restLen / (dir.length() || 1));
      // Turn the bone from its styled direction onto the simulated one.
      const restDir = target.sub(root).normalize(), simDir = dir.normalize();
      const swing = t.q.setFromUnitVectors(restDir, simDir);
      const parentQ = bone.parent!.getWorldQuaternion(t.q2);
      const worldQ = bone.getWorldQuaternion(new Quaternion());
      bone.quaternion.copy(parentQ.invert().multiply(swing.multiply(worldQ)));
      bone.updateMatrixWorld(true);
    }
    this.fresh = false;
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const m of this.materials) m.dispose();
  }
}
