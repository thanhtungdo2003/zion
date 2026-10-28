import type { AssetDefinitionInput, AssetRegistry } from '@zion/assets';

/** The API origin (no browser-only imports: also used inside web workers). */
const API = process.env.NEXT_PUBLIC_API_URL === 'same-origin' ? '' : process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Registers the models published from the Model Studio (public list) into a registry, so World
 * Studio views and the settlement generator can draw and place them. Failures leave the
 * registry as it was (the built-in models still work).
 */
export async function registerStudioModels(registry: AssetRegistry): Promise<number> {
  try {
    const res = await fetch(`${API}/api/model-assets`, { cache: 'no-store' });
    if (!res.ok) return 0;
    const list = await res.json() as Array<{ def: AssetDefinitionInput }>;
    let n = 0;
    for (const m of list) { try { registry.registerUploaded(m.def); n++; } catch { /* invalid entry */ } }
    return n;
  } catch { return 0; }
}
