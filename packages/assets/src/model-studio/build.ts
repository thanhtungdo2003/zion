import { freshId, identityTransform, type ModelDoc, type ModelMaterial, type ModelNode, type Opening, type PrimitiveShape, type Transform } from './doc';
import { materialFromPreset } from './materials';

type V3 = [number, number, number];

/**
 * Adds parts to a document with fresh ids — the editing primitives every generator and agent
 * tool goes through, so ids stay unique and parents valid.
 */
export class DocBuilder {
  constructor(readonly doc: ModelDoc) {}

  private add<T extends ModelNode>(node: Omit<T, 'id'> & { id?: string }): T {
    const id = node.id && !this.doc.nodes.some((n) => n.id === node.id) ? node.id : freshId(this.doc, node.id ?? node.name);
    const full = { ...node, id } as T;
    this.doc.nodes.push(full);
    return full;
  }

  /** A material from a preset (reused when one with the same id exists). */
  material(id: string, preset: string, overrides: Parameters<typeof materialFromPreset>[2] = {}): ModelMaterial {
    const have = this.doc.materials.find((m) => m.id === id);
    if (have) return have;
    const m = materialFromPreset(id, preset, overrides);
    this.doc.materials.push(m);
    return m;
  }

  group(name: string, parent: string | null, at: Partial<Transform> = {}, extra: Partial<ModelNode> = {}): string {
    return this.add({ kind: 'group', name, parent, transform: tf(at), ...extra } as never).id;
  }

  primitive(name: string, parent: string | null, shape: PrimitiveShape, params: Record<string, number>, material: string, at: Partial<Transform> = {}, extra: Partial<ModelNode> = {}): string {
    return this.add({ kind: 'primitive', name, parent, shape, params, material, transform: tf(at), ...extra } as never).id;
  }

  /** A box by its min/max corners (in the parent's space). */
  box(name: string, parent: string | null, min: V3, max: V3, material: string, extra: Partial<ModelNode> = {}): string {
    return this.primitive(name, parent, 'box', { width: max[0] - min[0], height: max[1] - min[1], depth: max[2] - min[2] }, material, { position: [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2] }, extra);
  }

  wall(name: string, parent: string | null, length: number, height: number, thickness: number, openings: Opening[], material: string, at: Partial<Transform>, innerMaterial?: string): string {
    return this.add({ kind: 'wall', name, parent, length, height, thickness, openings, material, ...(innerMaterial ? { innerMaterial } : {}), transform: tf(at) } as never).id;
  }

  slab(name: string, parent: string | null, width: number, depth: number, thickness: number, holes: Array<{ x: number; z: number; width: number; depth: number }>, material: string, at: Partial<Transform>): string {
    return this.add({ kind: 'slab', name, parent, width, depth, thickness, holes, material, transform: tf(at) } as never).id;
  }

  roof(name: string, parent: string | null, spec: { style: 'gable' | 'hip' | 'shed' | 'flat'; width: number; depth: number; rise: number; overhang: number; thickness: number; damage: number; seed: number }, material: string, at: Partial<Transform>): string {
    return this.add({ kind: 'roof', name, parent, ...spec, material, transform: tf(at) } as never).id;
  }

  stairs(name: string, parent: string | null, width: number, rise: number, run: number, steps: number, material: string, at: Partial<Transform>): string {
    return this.add({ kind: 'stairs', name, parent, width, rise, run, steps, material, transform: tf(at) } as never).id;
  }

  rock(name: string, parent: string | null, params: Record<string, number>, material: string, at: Partial<Transform> = {}): string {
    return this.add({ kind: 'rock', name, parent, params, material, transform: tf(at) } as never).id;
  }

  asset(name: string, parent: string | null, asset: number, at: Partial<Transform> = {}, extra: Partial<ModelNode> = {}): string {
    return this.add({ kind: 'asset', name, parent, asset, transform: tf(at), ...extra } as never).id;
  }
}

export function tf(at: Partial<Transform>): Transform {
  const t = identityTransform();
  return { position: at.position ?? t.position, rotation: at.rotation ?? t.rotation, scale: at.scale ?? t.scale };
}
