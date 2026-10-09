import ts from 'typescript';
import { startVitest } from 'vitest/node';
const ctx = await startVitest('test', process.argv.slice(2), {
  run: true, pool: 'threads',
  include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts'], testTimeout: 30000,
}, {
  configFile: false, esbuild: false, resolve: { preserveSymlinks: true },
  plugins: [{ name: 'sandbox-typescript', enforce: 'pre', transform(code, id) {
    if (!id.endsWith('.ts')) return;
    return { code: ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, fileName: id,
    }).outputText, map: null };
  } }],
});
await ctx?.close();
