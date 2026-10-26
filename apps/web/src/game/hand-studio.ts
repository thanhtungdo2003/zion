import { DEFAULT_HAND_STUDIO, handStudioSchema, registerHandStudioReloads, type HandAnimation, type HandPose, type HandStudio } from '@zion/shared';
import { API_URL } from '@/lib/api';

/**
 * The Hand Studio on this client: hand poses (by id) and hand / weapon animations, loaded once per
 * page and replaced live while the Studio edits them.
 */
let studio: HandStudio = DEFAULT_HAND_STUDIO;
let poses = new Map<string, HandPose>(studio.poses.map((p) => [p.id, p]));
let loading: Promise<HandStudio> | null = null;
const listeners = new Set<() => void>();

export function handStudio(): HandStudio { return studio; }
export function handPose(id: string | undefined): HandPose | undefined { return id ? poses.get(id) : undefined; }

/** The animation that plays for this weapon's action: its own first, else one made for any gun. */
export function handAnimationFor(itemId: string | null | undefined, action: HandAnimation['action'] = 'reload'): HandAnimation | null {
  if (!itemId) return null;
  return studio.animations.find((a) => a.action === action && a.weapon === itemId) ?? null;
}

export function loadHandStudio(): Promise<HandStudio> {
  if (typeof window === 'undefined') return Promise.resolve(studio);
  loading ??= fetch(`${API_URL}/api/hand-studio`, { credentials: 'include' })
    .then((res) => (res.ok ? res.json() as Promise<{ studio: unknown }> : { studio: DEFAULT_HAND_STUDIO }))
    .then(({ studio: raw }) => { const p = handStudioSchema.safeParse(raw); if (p.success) setHandStudio(p.data); return studio; })
    .catch(() => studio);
  return loading;
}

/** The Studio's working copy (or the loaded one): used at once by every hand in view. */
export function setHandStudio(next: HandStudio): void {
  studio = next;
  poses = new Map(next.poses.map((p) => [p.id, p]));
  registerHandStudioReloads(next);
  for (const f of listeners) f();
}
export function onHandStudio(f: () => void): () => void { listeners.add(f); return () => listeners.delete(f); }
