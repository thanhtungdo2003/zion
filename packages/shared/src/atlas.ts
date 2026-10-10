/** Public, coarse cartography. The client masks unexplored areas; this never contains the world seed. */
export interface WorldAtlas {
  worldId: string;
  size: number;
  pixels: number;
  /** Packed RGB bytes, base64 encoded. */
  rgb: string;
  structures: Array<{ x: number; z: number; radius: number; kind: string }>;
  /** Oriented top-down footprints of the live camp layout, in world metres. */
  campParts?: AtlasFootprint[];
}

export interface AtlasFootprint {
  x: number; z: number; halfX: number; halfZ: number; yaw: number;
}

export interface AtlasTile {
  worldId: string;
  x: number; z: number; size: number; pixels: number;
  rgb: string;
}
