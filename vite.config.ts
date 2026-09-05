import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:4317', ws: true } },
  },
  build: { chunkSizeWarningLimit: 600, rollupOptions: { output: { manualChunks: { three: ['three'], terminal: ['@xterm/xterm', '@xterm/addon-fit'] } } } },
});
