import io
p='apps/web/src/game/render/viewmodel.ts'
s=io.open(p,encoding='utf8').read()
pairs=[
("import { DoubleSide, Euler, Group, Matrix4, Mesh, Quaternion, Vector3, type Camera, type Material, type Object3D } from 'three';",
 "import { Box3, CircleGeometry, DoubleSide, Euler, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Camera, type Material, type Object3D } from 'three';"),
("  private readonly rigs = new Map<string, { visual: WeaponVisual; mechanics: WeaponMechanics }>();",
 "  private readonly rigs = new Map<string, { visual: WeaponVisual; mechanics: WeaponMechanics }>();\n  /** Per dressed model with a magnified optic: the lens the scope image is drawn on. */\n  private readonly lenses = new Map<string, OpticLens>();"),
("""    model.visible = true;
    this.current = key;""","""    if (!this.lenses.has(key) && optic && (optic.magnification ?? 1) > 1) {
      const lens = opticLens(model, visual, optic.id);
      if (lens) this.lenses.set(key, lens);
    }
    // A magnified optic is held close enough that its lens fills a comfortable part of the view.
    const lens = this.lenses.get(key);
    if (lens) this.eyeRelief = Math.min(.25, Math.max(.05, lens.radius / Math.tan(LENS_HALF_ANGLE)));
    model.visible = true;
    this.current = key;"""),
]
for a,b in pairs:
    assert a in s, a[:60]; s=s.replace(a,b,1)
s=s.replace("""  get aimed()""","""  /** The current optic's lens (magnified optics only). */
  get lens(): OpticLens | null { return this.current ? this.lenses.get(this.current) ?? null : null; }

  /** The first-person gun and arms, to leave out of the scope image. */
  get object(): Object3D { return this.root; }

  get aimed()""",1)
s+="""
export interface OpticLens {
  /** The mesh the scope image is drawn on: the optic's `lens` group, or a generated disc. */
  mesh: Mesh;
  /** Lens radius in the first-person model's units. */
  radius: number;
}

/** Apparent half-size of a magnified optic's lens when aimed (≈ 28° across). */
const LENS_HALF_ANGLE = 14 * Math.PI / 180;

/**
 * The optic's lens in a dressed first-person model. Optics drawn in the Gun Studio carry clear
 * blocks in a group named `lens` (merged into the mesh `lens_mesh`). Older optics have none: an
 * invisible octagonal disc is placed on the sight line at the eye point instead, sized to the
 * optic's width, so the scope image still has a surface to appear on.
 */
function opticLens(model: Group, visual: WeaponVisual, opticId: string): OpticLens | null {
  const optic = model.getObjectByName(`attachment-${opticId}`);
  if (!optic) return null;
  model.updateMatrixWorld(true);
  const toModel = new Matrix4().copy(model.matrixWorld).invert();
  const inModel = (mesh: Mesh) => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox!.clone().applyMatrix4(new Matrix4().multiplyMatrices(toModel, mesh.matrixWorld));
  };
  const authored = optic.getObjectByName('lens_mesh');
  if (authored instanceof Mesh) {
    const size = inModel(authored).getSize(new Vector3()).toArray().sort((a, b) => a - b);
    // A lens is a thin disc (or two discs along the tube): its diameter is the middle extent.
    return { mesh: authored, radius: size[1]! / 2 };
  }
  if (!visual.sight) return null;
  const box = new Box3();
  optic.traverse((o) => { if (o instanceof Mesh) box.union(inModel(o)); });
  const rear = visual.sight.rear, front = visual.sight.front;
  const along = front.clone().sub(rear).normalize();
  const extent = box.getSize(new Vector3());
  // Width across the sight line (the model's lateral axis is the one least aligned with it).
  const lateral = Math.abs(along.z) < .5 ? extent.z : extent.x;
  const radius = Math.max(.004, lateral * .38);
  const disc = new Mesh(new CircleGeometry(radius, 8), new MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: DoubleSide }));
  disc.name = 'lens_mesh';
  disc.position.copy(rear);
  disc.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), along);
  disc.visible = false;
  disc.frustumCulled = false;
  model.add(disc);
  return { mesh: disc, radius };
}
"""
io.open(p,'w',encoding='utf8').write(s)
print('ok')
