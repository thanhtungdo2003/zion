import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  Group,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  SRGBColorSpace,
  TextureLoader,
  type Object3D,
} from 'three';
import { FACES, type FaceName } from './bbmodel-loader';

/** Served from apps/web/public/models (copy of /models/characters/teen-wasteland-survivor.bbmodel). */
export const CHARACTER_MODEL_URL = '/models/characters/teen-wasteland-survivor.bbmodel';
/** Blockbench pixels per metre: the 32 px tall model becomes ~1.8 m, matching the collider. */
const UNITS_PER_METER = 32 / 1.8;
const DEG = Math.PI / 180;

type Vec3 = [number, number, number];

interface RawCube {
  name?: string;
  type?: string;
  uuid: string;
  from: Vec3;
  to: Vec3;
  inflate?: number;
  uv_offset?: [number, number];
  mirror_uv?: boolean;
  visibility?: boolean;
  faces?: Partial<Record<FaceName, { uv?: [number, number, number, number]; rotation?: number; texture?: number | null }>>;
}

interface RawGroup {
  name: string;
  origin?: Vec3;
  rotation?: Vec3;
  visibility?: boolean;
  children: Array<string | RawGroup>;
}

interface RawKeyframe {
  channel: string;
  time: number;
  interpolation?: string;
  data_points: Array<Record<'x' | 'y' | 'z', string | number>>;
}

export interface RawModel {
  resolution: { width: number; height: number };
  elements: RawCube[];
  outliner: Array<string | RawGroup>;
  textures: Array<{ source: string }>;
  animations?: Array<{ name: string; loop?: string; length: number; animators?: Record<string, { name: string; keyframes: RawKeyframe[] }> }>;
}

interface Track {
  times: number[];
  values: Vec3[];
  step: boolean[];
}

export interface BoneTracks {
  rotation?: Track;
  position?: Track;
  scale?: Track;
}

export interface CharacterClip {
  name: string;
  length: number;
  loop: boolean;
  bones: Map<string, BoneTracks>;
}

export interface CharacterTemplate {
  /** Bone hierarchy with merged per-bone meshes; clone(true) per avatar (geometry is shared). */
  root: Group;
  boneNames: string[];
  clips: Map<string, CharacterClip>;
}

function num(v: string | number | undefined): number {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '0');
  return Number.isFinite(n) ? n : 0;
}

/** Blockbench box-UV layout (Minecraft style) for a cube of size w×h×d at uv offset (u, v). */
function boxUv(cube: RawCube): Record<FaceName, [number, number, number, number]> {
  const [u, v] = cube.uv_offset ?? [0, 0];
  const w = Math.abs(cube.to[0] - cube.from[0]);
  const h = Math.abs(cube.to[1] - cube.from[1]);
  const d = Math.abs(cube.to[2] - cube.from[2]);
  const r = (x: number, y: number, sx: number, sy: number): [number, number, number, number] => [u + x, v + y, u + x + sx, v + y + sy];
  const faces: Record<FaceName, [number, number, number, number]> = {
    east: r(0, d, d, h),
    north: r(d, d, w, h),
    west: r(d + w, d, d, h),
    south: r(d * 2 + w, d, w, h),
    up: r(d + w, d, -w, -d),
    down: r(d + w * 2, 0, -w, d),
  };
  if (cube.mirror_uv) {
    for (const k of Object.keys(faces) as FaceName[]) {
      const f = faces[k];
      faces[k] = [f[2], f[1], f[0], f[3]];
    }
    [faces.east, faces.west] = [faces.west, faces.east];
  }
  return faces;
}

function cubeQuads(cube: RawCube, pivot: Vec3, texW: number, texH: number, out: { pos: number[]; nrm: number[]; uv: number[] }): void {
  const inflate = cube.inflate ?? 0;
  const from = cube.from.map((c, i) => Math.min(c, cube.to[i]!) - inflate);
  const to = cube.to.map((c, i) => Math.max(c, cube.from[i]!) + inflate);
  const box = cube.faces && Object.values(cube.faces).some((f) => f?.uv) ? null : boxUv(cube);
  const s = 1 / UNITS_PER_METER;
  for (const name of Object.keys(FACES) as FaceName[]) {
    const def = FACES[name];
    const face = cube.faces?.[name];
    if (face?.texture === null) continue;
    const [u1, v1, u2, v2] = box ? box[name] : (face?.uv ?? [0, 0, 0, 0]);
    let uvs: Array<[number, number]> = [
      [u1 / texW, 1 - v1 / texH],
      [u2 / texW, 1 - v1 / texH],
      [u2 / texW, 1 - v2 / texH],
      [u1 / texW, 1 - v2 / texH],
    ];
    const turns = ((face?.rotation ?? 0) / 90) % 4;
    for (let i = 0; i < turns; i++) uvs = [uvs[3]!, uvs[0]!, uvs[1]!, uvs[2]!];
    const quad = def.corners.map(([cx, cy, cz]) => [
      ((cx ? to[0]! : from[0]!) - pivot[0]) * s,
      ((cy ? to[1]! : from[1]!) - pivot[1]) * s,
      ((cz ? to[2]! : from[2]!) - pivot[2]) * s,
    ]);
    for (const k of [0, 3, 2, 0, 2, 1]) {
      out.pos.push(...quad[k]!);
      out.nrm.push(...def.normal);
      out.uv.push(...uvs[k]!);
    }
  }
}

function parseClips(model: RawModel): Map<string, CharacterClip> {
  const clips = new Map<string, CharacterClip>();
  for (const a of model.animations ?? []) {
    const bones = new Map<string, BoneTracks>();
    for (const animator of Object.values(a.animators ?? {})) {
      const tracks: BoneTracks = {};
      for (const channel of ['rotation', 'position', 'scale'] as const) {
        const kfs = animator.keyframes.filter((k) => k.channel === channel).sort((x, y) => x.time - y.time);
        if (!kfs.length) continue;
        tracks[channel] = {
          times: kfs.map((k) => k.time),
          values: kfs.map((k) => {
            const p = k.data_points[0] ?? { x: 0, y: 0, z: 0 };
            return [num(p.x), num(p.y), num(p.z)];
          }),
          step: kfs.map((k) => k.interpolation === 'step'),
        };
      }
      if (tracks.rotation || tracks.position || tracks.scale) bones.set(animator.name, tracks);
    }
    clips.set(a.name, { name: a.name, length: Math.max(0.01, a.length), loop: a.loop === 'loop', bones });
  }
  return clips;
}

export async function fetchWithProgress(url: string, onProgress?: (p: number) => void): Promise<string> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`character model unavailable (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total) onProgress?.(Math.min(1, received / total));
  }
  onProgress?.(1);
  const all = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(all);
}

/**
 * Downloads and fully builds the player character (geometry, decoded texture, animation clips)
 * up front, so nothing about the avatar is parsed or uploaded while the game is running.
 */
export async function loadCharacterModel(url = CHARACTER_MODEL_URL, onProgress?: (p: number) => void): Promise<CharacterTemplate> {
  return buildBBModel(JSON.parse(await fetchWithProgress(url, onProgress)) as RawModel);
}

/** Builds any Blockbench (box-UV or per-face) model into a bone hierarchy, at character scale. */
export async function buildBBModel(model: RawModel): Promise<CharacterTemplate> {
  const texW = model.resolution.width;
  const texH = model.resolution.height;
  const src = model.textures[0]?.source;
  let material: MeshLambertMaterial;
  if (src) {
    const tex = await new TextureLoader().loadAsync(src);
    tex.magFilter = NearestFilter;
    tex.minFilter = NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = SRGBColorSpace;
    material = new MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
  } else {
    material = new MeshLambertMaterial({ color: 0x8a7a5a });
  }

  const cubes = new Map(model.elements.filter((e) => (e.type ?? 'cube') === 'cube').map((e) => [e.uuid, e]));
  const boneNames: string[] = [];
  const s = 1 / UNITS_PER_METER;

  const buildBone = (g: RawGroup, parentOrigin: Vec3): Object3D => {
    const origin = g.origin ?? [0, 0, 0];
    const bone = new Group();
    bone.name = g.name;
    bone.position.set((origin[0] - parentOrigin[0]) * s, (origin[1] - parentOrigin[1]) * s, (origin[2] - parentOrigin[2]) * s);
    if (g.rotation) bone.rotation.copy(new Euler(g.rotation[0] * DEG, g.rotation[1] * DEG, g.rotation[2] * DEG, 'ZYX'));
    bone.userData.restPos = bone.position.clone();
    bone.userData.restRot = bone.rotation.clone();
    boneNames.push(g.name);
    const buf = { pos: [] as number[], nrm: [] as number[], uv: [] as number[] };
    for (const child of g.children) {
      if (typeof child === 'string') {
        const cube = cubes.get(child);
        if (cube && cube.visibility !== false) cubeQuads(cube, origin, texW, texH, buf);
      } else if (child.visibility !== false) {
        bone.add(buildBone(child, origin));
      }
    }
    if (buf.pos.length) {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array(buf.pos), 3));
      geo.setAttribute('normal', new BufferAttribute(new Float32Array(buf.nrm), 3));
      geo.setAttribute('uv', new BufferAttribute(new Float32Array(buf.uv), 2));
      geo.computeBoundingSphere();
      const mesh = new Mesh(geo, material);
      mesh.castShadow = true;
      mesh.name = `${g.name}_mesh`;
      bone.add(mesh);
    }
    return bone;
  };

  const root = new Group();
  root.name = 'character';
  for (const node of model.outliner) if (typeof node !== 'string') root.add(buildBone(node, [0, 0, 0]));
  return { root, boneNames, clips: parseClips(model) };
}

/** Samples a track at time t (seconds) into out; linear between keys, holds outside. */
export function sampleTrack(track: Track, t: number, out: Vec3): Vec3 {
  const { times, values } = track;
  const n = times.length;
  if (t <= times[0]! || n === 1) return copy3(values[0]!, out);
  if (t >= times[n - 1]!) return copy3(values[n - 1]!, out);
  let i = 1;
  while (i < n && times[i]! < t) i++;
  const a = values[i - 1]!;
  const b = values[i]!;
  if (track.step[i - 1]) return copy3(a, out);
  const k = (t - times[i - 1]!) / Math.max(1e-6, times[i]! - times[i - 1]!);
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = a[2] + (b[2] - a[2]) * k;
  return out;
}

function copy3(src: Vec3, out: Vec3): Vec3 {
  out[0] = src[0];
  out[1] = src[1];
  out[2] = src[2];
  return out;
}

export const BB_UNITS_PER_METER = UNITS_PER_METER;
