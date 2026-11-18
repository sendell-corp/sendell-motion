import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const aqui = fileURLToPath(new URL('.', import.meta.url));
// Se sirve como /jolt/ del alias de pruebas «jolt» (Cloudflare Pages, detrás del pase).
export default defineConfig({
    root: aqui,
    base: '/jolt/',
    build: { target: 'es2022', outDir: fileURLToPath(new URL('../../dist/jolt', import.meta.url)), emptyOutDir: false, chunkSizeWarningLimit: 2000 },
});
