import { Worker } from 'node:worker_threads';

/**
 * Event-loop watchdog. The main thread stamps a shared clock (and the name of what it is doing)
 * every few hundred ms; a worker thread watches the stamp and, when the main thread has been
 * stuck for over `stallMs` (a loop that never ends, a huge synchronous job), writes to stderr
 * what it was doing — a frozen server otherwise leaves no trace at all, since nothing on the
 * main thread can log while it is blocked.
 */
const LABEL_BYTES = 96;
const shared = new SharedArrayBuffer(8 + LABEL_BYTES);
const clock = new Float64Array(shared, 0, 1);
const label = new Uint8Array(shared, 8, LABEL_BYTES);
const encoder = new TextEncoder();
let started = false;

/** Names what the main thread is doing now (shown if it stalls there). Cheap: call freely. */
export function watchSection(name: string): void {
  if (!started) return;
  const bytes = encoder.encode(name.slice(0, LABEL_BYTES - 1));
  label.fill(0); label.set(bytes);
  clock[0] = Date.now();
}

export function startWatchdog(stallMs = 3000): void {
  if (started) return;
  started = true;
  clock[0] = Date.now();
  // The main thread's heartbeat, whatever it is doing between ticks.
  setInterval(() => { clock[0] = Date.now(); }, 250).unref();
  const source = `
    const { workerData } = require('node:worker_threads');
    const clock = new Float64Array(workerData, 0, 1), label = new Uint8Array(workerData, 8, ${LABEL_BYTES});
    const decoder = new TextDecoder();
    let reported = 0;
    setInterval(() => {
      const late = Date.now() - clock[0];
      if (late < ${stallMs}) { if (reported) { process.stderr.write(JSON.stringify({ level: 'warn', msg: 'event loop recovered', stalledMs: reported }) + '\\n'); reported = 0; } return; }
      if (late - reported < 5000 && reported) return;
      reported = late;
      const end = label.indexOf(0);
      process.stderr.write(JSON.stringify({ level: 'error', time: Date.now(), msg: 'event loop stalled: the server is frozen', stalledMs: late, section: decoder.decode(label.slice(0, end < 0 ? label.length : end)) }) + '\\n');
    }, 1000);
  `;
  const worker = new Worker(source, { eval: true, workerData: shared });
  worker.unref();
  worker.on('error', (err) => process.stderr.write(`watchdog failed: ${String(err)}\n`));
}
