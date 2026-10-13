/** TOP detections expire three seconds after the last unobstructed sighting. */
export class TargetVisibility {
  private readonly lastSeen = new Map<number, number>();
  visible(id: number, inSight: boolean, now: number): boolean {
    if (inSight) this.lastSeen.set(id, now);
    const last = this.lastSeen.get(id);
    if (last !== undefined && now - last < 3000) return true;
    this.lastSeen.delete(id);
    return false;
  }
  clear(): void { this.lastSeen.clear(); }
  forget(id: number): void { this.lastSeen.delete(id); }
}
