import type { SettlementIssue } from '@zion/worldgen/editor';
import type { WorkerJob, WorkerReply, WorkerResult } from './worker-protocol';

export class JobError extends Error {
  constructor(message: string, readonly issues?: SettlementIssue[], readonly cancelled = false) { super(message); this.name = 'JobError'; }
}

export interface JobHandle<T> { promise: Promise<T>; cancel: () => void }

let worker: Worker | null = null;
let nextId = 1;
const listeners = new Map<number, (m: WorkerReply) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module', name: 'zion-world-studio' });
  worker.onmessage = (e: MessageEvent<WorkerReply>) => listeners.get(e.data.id)?.(e.data);
  worker.onerror = (e) => {
    // A crashed worker fails every running job; the next job starts a fresh one.
    for (const [id, l] of listeners) l({ id, error: e.message || 'Worker gặp lỗi.' });
    listeners.clear(); worker?.terminate(); worker = null;
  };
  return worker;
}

/** Runs a job in the editor worker with progress callbacks; `cancel` stops it at its next step. */
export function runJob<K extends WorkerResult['kind']>(job: WorkerJob, onProgress: (label: string, value: number) => void, transfer: Transferable[] = []): JobHandle<Extract<WorkerResult, { kind: K }>> {
  const id = nextId++, w = getWorker();
  const promise = new Promise<Extract<WorkerResult, { kind: K }>>((resolve, reject) => {
    listeners.set(id, (m) => {
      if ('progress' in m) { onProgress(m.progress.label, m.progress.value); return; }
      listeners.delete(id);
      if ('done' in m) resolve(m.done as Extract<WorkerResult, { kind: K }>);
      else reject(new JobError(m.error === 'cancelled' ? 'Đã hủy.' : m.error, m.issues, m.error === 'cancelled'));
    });
  });
  w.postMessage({ id, job }, transfer);
  return { promise, cancel: () => w.postMessage({ id, cancel: true }) };
}
