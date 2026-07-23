import { copyFile, mkdir, rm } from 'node:fs/promises';
import { build } from 'vite';

await rm('dist', { recursive: true, force: true });
await build({
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});

await mkdir('dist/server', { recursive: true });
await copyFile('worker/sites-static.js', 'dist/server/index.js');
