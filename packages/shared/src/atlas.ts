/** Public, coarse cartography. The client masks unexplored areas; this never contains the world seed. */
export interface WorldAtlas {
  worldId: string;
  size: number;
  pixels: number;
  /** Packed RGB bytes, base64 encoded. */
  rgb: string;
  roads?: Array<{ ax: number; az: number; bx: number; bz: number; width: number; bridge: boolean; paved?: boolean; widthA?: number; widthB?: number }>;
  structures: Array<{ x: number; z: number; radius: number; kind: string; halfX?: number; halfZ?: number; yaw?: number }>;
  /** Oriented top-down footprints of the live camp layout, in world metres. */
  campParts?: AtlasFootprint[];
  /** Authored maps: named areas (labels), power lines and building footprints. */
  areas?: AtlasArea[];
  power?: Array<{ kind: 'tower' | 'hframe'; points: Array<[number, number]> }>;
  buildings?: AtlasFootprint[];
  /** 3D conductor polylines for rendering cables (x, y, z). */
  cables?: Array<{ kind: 'tower' | 'hframe'; points: Array<[number, number, number]> }>;
}

export interface AtlasArea { id: string; name: string; kind: string; x: number; z: number; radius: number }

export interface AtlasFootprint {
  x: number; z: number; halfX: number; halfZ: number; yaw: number;
}

export interface AtlasTile {
  worldId: string;
  x: number; z: number; size: number; pixels: number;
  rgb: string;
}
