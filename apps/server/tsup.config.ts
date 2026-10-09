import { defineConfig } from 'tsup';

// Bundles the server and its workspace packages (which ship TypeScript sources) into dist/.
// The chunk worker is a separate entry because worker_threads loads it by file path.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'chunk-worker': 'src/world/chunk-worker.ts',
    'migrate-cli': 'src/db/migrate-cli.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@zion\//],
});
