import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  Matrix4,
  Matrix3,
  MeshLambertMaterial,
  NearestFilter,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type Material,
} from 'three';
import { bbCubeFaces, isCubeElement, parseBBModel, type BBElement, type BBFace, type BBModel } from '@zion/assets';

export interface ModelPart {
  geometry: BufferGeometry;
  material: Material;
  wheel?: number;
  wheelCenter?: readonly [number,number,number];
}

export type FaceName = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

/**
 * Corner order per face: top-left, top-right, bottom-right, bottom-left as seen from outside,
 * expressed as (x,y,z) picks from [from, to] — 0 = from, 1 = to. Matches Blockbench UV layout.
 */
export const FACES: Record<FaceName, { corners: Array<[number, number, number]>; normal: [number, number, number] }> = {
  north: { corners: [[1, 1, 0], [0, 1, 0], [0, 0, 0], [1, 0, 0]], normal: [0, 0, -1] },
  south: { corners: [[0, 1, 1], [1, 1, 1], [1, 0, 1], [0, 0, 1]], normal: [0, 0, 1] },
  east: { corners: [[1, 1, 1], [1, 1, 0], [1, 0, 0], [1, 0, 1]], normal: [1, 0, 0] },
  west: { corners: [[0, 1, 0], [0, 1, 1], [0, 0, 1], [0, 0, 0]], normal: [-1, 0, 0] },
  up: { corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], normal: [0, 1, 0] },
  down: { corners: [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]], normal: [0, -1, 0] },
};

const DEG = Math.PI / 180;

function elementMatrix(e: BBElement, scale: number, offset: readonly [number, number, number], axisScale: readonly [number, number, number]): Matrix4 {
  const origin = new Vector3(...(e.origin ?? [0, 0, 0]));
  let euler: Euler | null = null;
  if (Array.isArray(e.rotation)) {
    const [rx, ry, rz] = e.rotation;
    if (rx || ry || rz) euler = new Euler(rx * DEG, ry * DEG, rz * DEG, 'ZYX');
  } else if (e.rotation) {
    const r = e.rotation;
    if (r.origin) origin.set(...r.origin);
    euler = new Euler(r.axis === 'x' ? r.angle * DEG : 0, r.axis === 'y' ? r.angle * DEG : 0, r.axis === 'z' ? r.angle * DEG : 0);
  }
  const m = new Matrix4().makeTranslation(offset[0], offset[1], offset[2]).multiply(new Matrix4().makeScale(scale * axisScale[0], scale * axisScale[1], scale * axisScale[2]));
  if (euler) {
    m.multiply(new Matrix4().makeTranslation(origin.x, origin.y, origin.z))
      .multiply(new Matrix4().makeRotationFromEuler(euler))
      .multiply(new Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
  }
  return m;
}

function faceUvs(face: BBFace, w: number, h: number): Array<[number, number]> {
  const [u1, v1, u2, v2] = face.uv ?? [0, 0, w, h];
  let uv: Array<[number, number]> = [
    [u1 / w, 1 - v1 / h],
    [u2 / w, 1 - v1 / h],
    [u2 / w, 1 - v2 / h],
    [u1 / w, 1 - v2 / h],
  ];
  const turns = ((face.rotation ?? 0) / 90) % 4;
  for (let i = 0; i < turns; i++) uv = [uv[3]!, uv[0]!, uv[1]!, uv[2]!];
  return uv;
}

/**
 * Converts a validated Blockbench model into geometry grouped by texture (one part per texture),
 * ready for instancing. Only cube elements are supported; meshes/locators are skipped.
 */
export async function loadBBModel(json: unknown, unitsPerMeter: number, offset: readonly [number, number, number], axisScale: readonly [number, number, number] = [1, 1, 1]): Promise<ModelPart[]> {
  const model: BBModel = parseBBModel(json);
  const texW = model.resolution.width;
  const texH = model.resolution.height;
  const loader = new TextureLoader();
  const materials = await Promise.all(
    model.textures.map(async (t) => {
      const tex = await loader.loadAsync(t.source);
      tex.magFilter = NearestFilter;
      tex.minFilter = NearestFilter;
      tex.colorSpace = SRGBColorSpace;
      tex.generateMipmaps = false;
      return new MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    }),
  );
  const fallback = new MeshLambertMaterial({ color: 0x8a7a5a });
  const perTexture = new Map<number, { pos: number[]; nrm: number[]; uv: number[] }>();
  const scale = 1 / unitsPerMeter;
  const v = new Vector3();
  const nrm = new Vector3();

  for (const raw of model.elements) {
    if (!isCubeElement(raw) || raw.visibility === false) continue;
    const e = raw;
    const faces = bbCubeFaces(e);
    const inflate = e.inflate ?? 0;
    const from = e.from.map((c, i) => Math.min(c, e.to[i]!) - inflate);
    const to = e.to.map((c, i) => Math.max(c, e.from[i]!) + inflate);
    const m = elementMatrix(e, scale, offset, axisScale);
    const normalMatrix = new Matrix3().getNormalMatrix(m);
    for (const name of Object.keys(FACES) as FaceName[]) {
      const face = faces[name];
      if (!face || face.texture === null) continue;
      const texIndex = face.texture ?? -1;
      const tex = texIndex >= 0 && texIndex < materials.length ? texIndex : -1;
      let bucket = perTexture.get(tex);
      if (!bucket) perTexture.set(tex, (bucket = { pos: [], nrm: [], uv: [] }));
      const def = FACES[name];
      const uvs = faceUvs(face, texW, texH);
      const quad = def.corners.map(([cx, cy, cz]) => v.set(cx ? to[0]! : from[0]!, cy ? to[1]! : from[1]!, cz ? to[2]! : from[2]!).applyMatrix4(m).toArray());
      nrm.set(...def.normal).applyMatrix3(normalMatrix).normalize();
      for (const k of [0, 3, 2, 0, 2, 1]) {
        bucket.pos.push(...quad[k]!);
        bucket.nrm.push(nrm.x, nrm.y, nrm.z);
        bucket.uv.push(...uvs[k]!);
      }
    }
  }

  const parts: ModelPart[] = [];
  for (const [tex, b] of perTexture) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(b.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(b.nrm), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(b.uv), 2));
    g.computeBoundingSphere();
    parts.push({ geometry: g, material: tex >= 0 ? materials[tex]! : fallback });
  }
  return parts;
}
