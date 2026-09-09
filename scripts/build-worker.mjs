import { build } from 'esbuild';
await build({ entryPoints: ['server/worker.ts'], outfile: 'dist/_worker.js', bundle: true, format: 'esm', target: 'es2022', minify: true });
