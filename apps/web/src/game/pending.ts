'use client';

import { useSyncExternalStore } from 'react';

/**
 * Requests waiting for the server (buy, take from cache, accept quest…), by key. Buttons show a
 * spinner while their key is pending; the engine clears keys when the server's answer arrives
 * (or after a timeout, so a dropped request never leaves a button spinning forever).
 */
const pending = new Map<string, number>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version++;
  for (const l of listeners) l();
}

export function markPending(key: string, timeoutMs = 4000): void {
  const old = pending.get(key);
  if (old) clearTimeout(old);
  pending.set(key, window.setTimeout(() => clearPending(key), timeoutMs));
  emit();
}

/** Clears one key, or every key starting with `prefix*` (e.g. 'buy:*'). */
export function clearPending(key: string): void {
  let changed = false;
  for (const [k, t] of pending) {
    if (key.endsWith('*') ? k.startsWith(key.slice(0, -1)) : k === key) {
      clearTimeout(t);
      pending.delete(k);
      changed = true;
    }
  }
  if (changed) emit();
}

export function isPending(key: string): boolean {
  return pending.has(key);
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const snapshot = () => version;

/** Re-renders the caller whenever the pending set changes; returns a lookup. */
export function usePending(): (key: string) => boolean {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  return isPending;
}
