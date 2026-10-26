import { Matrix4, Vector3, type Object3D, type PointLight } from 'three';

/**
 * Lamps built into a model (point lights saved in its GLB, e.g. blocks made to glow in the
 * Infection Studio): model-local positions after its scale and offset, with their colour,
 * brightness and reach. Read when the model loads; lit in game by the camp lights.
 */
export interface AssetLight { x: number; y: number; z: number; color: number; power: number; range: number }
const lights = new Map<number, AssetLight[]>();

export function assetLights(asset: number): readonly AssetLight[] | undefined { return lights.get(asset); }

export function collectAssetLights(asset: number, root: Object3D, scale: number, offset: readonly [number, number, number]): void {
  root.updateMatrixWorld(true);
  const base = new Matrix4().makeTranslation(offset[0], offset[1], offset[2]).multiply(new Matrix4().makeScale(scale, scale, scale));
  const out: AssetLight[] = [];
  root.traverse((o) => {
    const l = o as PointLight;
    if (!l.isPointLight) return;
    const p = new Vector3().setFromMatrixPosition(l.matrixWorld).applyMatrix4(base);
    out.push({ x: p.x, y: p.y, z: p.z, color: l.color.getHex(), power: l.intensity, range: l.distance > 0 ? l.distance * scale : 14 });
  });
  if (out.length) lights.set(asset, out); else lights.delete(asset);
}
