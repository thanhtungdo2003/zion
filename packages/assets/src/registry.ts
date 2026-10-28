import {
  assetDefinitionSchema,
  prefabDefinitionSchema,
  type AssetDefinition,
  type AssetDefinitionInput,
  type PlacementLayer,
  type PrefabDefinition,
  type PrefabDefinitionInput,
} from './schema';

export class AssetRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetRegistryError';
  }
}

/**
 * Central catalogue of placeable assets. Numeric ids are part of the network/world format and
 * MUST stay stable forever: never renumber or reuse an id; retire assets by tagging them instead.
 */
import { UPLOADED_MAP_ASSET_MAX, UPLOADED_MAP_ASSET_MIN } from './uploaded-maps';
import { STUDIO_MODEL_ASSET_MAX, STUDIO_MODEL_ASSET_MIN } from './model-studio/game-asset';

export class AssetRegistry {
  private readonly byId = new Map<string, AssetDefinition>();
  private readonly byNumeric = new Map<number, AssetDefinition>();
  private readonly prefabs = new Map<string, PrefabDefinition>();
  private readonly layerCache = new Map<PlacementLayer, AssetDefinition[]>();
  private frozen = false;

  register(input: AssetDefinitionInput): AssetDefinition {
    if (this.frozen) throw new AssetRegistryError('registry is frozen');
    const parsed = assetDefinitionSchema.safeParse(input);
    if (!parsed.success) {
      throw new AssetRegistryError(`invalid asset ${String(input.id)}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    const def = parsed.data;
    if (this.byId.has(def.id)) throw new AssetRegistryError(`duplicate asset id ${def.id}`);
    const clash = this.byNumeric.get(def.numericId);
    if (clash) throw new AssetRegistryError(`numeric id ${def.numericId} used by ${clash.id} and ${def.id}`);
    if (def.collisionLayer === 'none' && def.colliders.length > 0) {
      throw new AssetRegistryError(`${def.id}: colliders defined but collisionLayer is "none"`);
    }
    this.byId.set(def.id, def);
    this.byNumeric.set(def.numericId, def);
    this.layerCache.clear();
    return def;
  }

  registerPrefab(input: PrefabDefinitionInput): PrefabDefinition {
    if (this.frozen) throw new AssetRegistryError('registry is frozen');
    const parsed = prefabDefinitionSchema.safeParse(input);
    if (!parsed.success) throw new AssetRegistryError(`invalid prefab ${String(input.id)}: ${parsed.error.message}`);
    const def = parsed.data;
    if (this.prefabs.has(def.id)) throw new AssetRegistryError(`duplicate prefab id ${def.id}`);
    for (const part of def.parts) {
      if (!this.byId.has(part.asset)) throw new AssetRegistryError(`prefab ${def.id} references unknown asset ${part.asset}`);
    }
    this.prefabs.set(def.id, def);
    return def;
  }

  /**
   * A map model uploaded in the Studio (its reserved id range), also into a frozen registry;
   * replaces an earlier upload under the same id.
   */
  registerUploaded(input: AssetDefinitionInput): AssetDefinition {
    const studio = input.numericId >= STUDIO_MODEL_ASSET_MIN && input.numericId <= STUDIO_MODEL_ASSET_MAX;
    if (!studio && (input.numericId < UPLOADED_MAP_ASSET_MIN || input.numericId > UPLOADED_MAP_ASSET_MAX)) throw new AssetRegistryError(`uploaded asset id ${input.numericId} outside its range`);
    const old = this.byNumeric.get(input.numericId);
    if (old) { this.byNumeric.delete(old.numericId); this.byId.delete(old.id); }
    const frozen = this.frozen;
    this.frozen = false;
    try { return this.register(input); } finally { this.frozen = frozen; }
  }

  /** Prevents further registration (call once bootstrapping is done). */
  freeze(): this {
    this.frozen = true;
    return this;
  }

  get(id: string): AssetDefinition | undefined {
    return this.byId.get(id);
  }

  require(id: string): AssetDefinition {
    const d = this.byId.get(id);
    if (!d) throw new AssetRegistryError(`unknown asset ${id}`);
    return d;
  }

  byNumericId(n: number): AssetDefinition | undefined {
    return this.byNumeric.get(n);
  }

  prefab(id: string): PrefabDefinition | undefined {
    return this.prefabs.get(id);
  }

  all(): AssetDefinition[] {
    return [...this.byNumeric.values()].sort((a, b) => a.numericId - b.numericId);
  }

  /** Assets with placement rules on a layer, in stable numeric-id order (determinism). */
  layer(layer: PlacementLayer): readonly AssetDefinition[] {
    let list = this.layerCache.get(layer);
    if (!list) {
      list = this.all().filter((d) => d.placement?.layer === layer);
      this.layerCache.set(layer, list);
    }
    return list;
  }

  get size(): number {
    return this.byId.size;
  }
}
