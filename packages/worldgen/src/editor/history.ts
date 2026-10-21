import type { CellRect, Heightfield } from './heightfield';

export interface TerrainPatch { rect: CellRect; heights: Float32Array; surface: Uint8Array }

/** One undoable edit: a document change, a terrain patch, or both (e.g. carving a river). */
export interface HistoryEntry<D> {
  label: string;
  doc?: { before: D; after: D };
  terrain?: { before: TerrainPatch; after: TerrainPatch };
}

const bytes = <D>(e: HistoryEntry<D>) => (e.terrain ? e.terrain.before.heights.byteLength * 2.5 : 0) + (e.doc ? 200_000 : 0);

/**
 * Undo / redo stacks with a memory budget: terrain edits store only the cells they touched, so a
 * brush stroke costs a few KB, not the whole map.
 */
export class EditHistory<D> {
  private undoStack: Array<HistoryEntry<D>> = [];
  private redoStack: Array<HistoryEntry<D>> = [];
  constructor(private readonly limit = 120, private readonly budget = 256 * 1024 * 1024) {}

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string | undefined { return this.undoStack[this.undoStack.length - 1]?.label; }
  get redoLabel(): string | undefined { return this.redoStack[this.redoStack.length - 1]?.label; }
  get size(): number { return this.undoStack.length; }

  push(entry: HistoryEntry<D>): void {
    this.undoStack.push(entry);
    this.redoStack = [];
    let total = this.undoStack.reduce((s, e) => s + bytes(e), 0);
    while (this.undoStack.length > this.limit || (total > this.budget && this.undoStack.length > 1)) total -= bytes(this.undoStack.shift()!);
  }

  /** Folds a follow-up change into the latest edit (slider drags: one undo step, not hundreds). */
  amend(after: D): boolean {
    const top = this.undoStack[this.undoStack.length - 1];
    if (!top?.doc || this.redoStack.length) return false;
    top.doc.after = after;
    return true;
  }

  /** Reverts the latest edit: restores its terrain cells and returns the document before it. */
  undo(terrain: Heightfield): HistoryEntry<D> | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    if (e.terrain) terrain.restore(e.terrain.before);
    this.redoStack.push(e);
    return e;
  }

  redo(terrain: Heightfield): HistoryEntry<D> | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    if (e.terrain) terrain.restore(e.terrain.after);
    this.undoStack.push(e);
    return e;
  }

  clear(): void { this.undoStack = []; this.redoStack = []; }
}

/** Accumulates the cells a brush stroke touches, so the whole stroke is one undo step. */
export class StrokeRecorder {
  private rect: CellRect | null = null;
  private original: Heightfield;
  constructor(private readonly terrain: Heightfield) { this.original = terrain.clone(); }
  touch(r: CellRect | null): void {
    if (!r) return;
    this.rect = this.rect ? { i0: Math.min(this.rect.i0, r.i0), j0: Math.min(this.rect.j0, r.j0), i1: Math.max(this.rect.i1, r.i1), j1: Math.max(this.rect.j1, r.j1) } : { ...r };
  }
  get bounds(): CellRect | null { return this.rect; }
  finish(): { before: TerrainPatch; after: TerrainPatch } | null {
    if (!this.rect) return null;
    return { before: this.original.snapshot(this.rect), after: this.terrain.snapshot(this.rect) };
  }
}
