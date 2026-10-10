import type { ClientMessage, TutorialProgress } from '@zion/shared';
import type { Player } from './player';

export function tutorialProgress(p: Player): TutorialProgress {
  return p.life.tutorial ??= { seen: [], firstZombie: false };
}

export function tutorialProtected(p: Player, now: number): boolean {
  return !!p.tutorialActive && p.tutorialActive.until > now;
}

/** One protection grant per lesson per account. Replays and heartbeats cannot create a grant. */
export function updateTutorial(p: Player, message: Extract<ClientMessage, { t: 'tutorial' }>, now: number): void {
  if (message.op === 'heartbeat') {
    if (tutorialProtected(p, now)) p.tutorialActive!.until = now + 30_000;
    return;
  }
  p.tutorialActive = null;
  if (message.op === 'close' || !message.id) return;
  const progress = tutorialProgress(p), seen = progress.seen.includes(message.id);
  if (!seen) { progress.seen.push(message.id); p.dirty = true; }
  if (!seen && !message.replay && !p.dead && !p.downed) p.tutorialActive = { id: message.id, until: now + 30_000 };
}

export function recordZombieKill(p: Player): boolean {
  const progress = tutorialProgress(p);
  if (progress.firstZombie) return false;
  progress.firstZombie = true; p.dirty = true;
  return true;
}
