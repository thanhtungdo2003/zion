import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readyStandaloneEntry } from './standalone.mjs';

try {
  const entry = readyStandaloneEntry(fileURLToPath(new URL('../', import.meta.url)));
  process.stdout.write(`Standalone server and assets ready: ${entry}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
