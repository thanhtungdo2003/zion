import process from 'node:process';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import { readyStandaloneEntry } from './scripts/standalone.mjs';

// Resolve relative to this file so aaPanel's working directory does not affect startup.
process.env.NODE_ENV = 'production';
process.env.PORT ??= '3000';
process.env.HOSTNAME ??= '127.0.0.1';

try {
  const entry = readyStandaloneEntry(fileURLToPath(new URL('.', import.meta.url)));
  await import(pathToFileURL(entry).href);
} catch (error) {
  process.stderr.write(`[web] ${error.message}\n`);
  process.exitCode = 1;
}
