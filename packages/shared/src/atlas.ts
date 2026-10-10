/** Public, coarse cartography. The client masks unexplored areas; this never contains the world seed. */
export interface WorldAtlas {
  worldId: string;
  size: number;
  pixels: number;
  /** Packed RGB bytes, base64 encoded. */
  rgb: string;
  structures: Array<{ x: number; z: number; radius: number; kind: string }>;
}
