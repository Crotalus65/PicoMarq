import { defineConfig } from 'vite';
import path from 'node:path';
// Builds the equivalence harness page used by run.cjs.
export default defineConfig({
  root: __dirname,
  base: './',
  resolve: { alias: { '@app': path.resolve(__dirname, '../../src') } },
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true, target: 'chrome140', minify: false, sourcemap: false, chunkSizeWarningLimit: 5000 },
  logLevel: 'warn',
});
