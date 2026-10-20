// Synthesises the UI sound effects (quest accepted / completed; click, equip, eat and footsteps are recorded files) into
// apps/web/public/sounds as 16-bit mono WAV. Run: node apps/web/scripts/gen-ui-sounds.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RATE = 44100;
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/sounds');

function wav(name, samples) {
  const data = Buffer.alloc(samples.length * 2);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const k = peak > 0 ? 0.89 / peak : 1;
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s * k)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path.join(out, name), Buffer.concat([h, data]));
}

const buf = (sec) => new Float32Array(Math.round(sec * RATE));
/** Bell-ish tone: a few decaying partials. */
function tone(b, at, freq, dur, vol, decay = 6) {
  const start = Math.round(at * RATE);
  for (let i = 0; i < dur * RATE && start + i < b.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t * 400) * Math.exp(-t * decay);
    b[start + i] += vol * env * (Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(4 * Math.PI * freq * t) + 0.12 * Math.sin(6 * Math.PI * freq * t));
  }
}

// Quest accepted: two rising notes.
{
  const b = buf(0.6);
  tone(b, 0, 523.25, 0.5, 0.8, 7);
  tone(b, 0.11, 783.99, 0.5, 0.9, 6);
  wav('quest-accept.wav', b);
}
// Quest completed: major arpeggio with a sparkle on top.
{
  const b = buf(1.3);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(b, i * 0.09, f, 1.0, 0.75, 4.5));
  for (let i = 0; i < 6; i++) tone(b, 0.38 + i * 0.05, 2093 + i * 260, 0.25, 0.18, 14);
  wav('quest-complete.wav', b);
}
console.log('UI sounds written to', out);
