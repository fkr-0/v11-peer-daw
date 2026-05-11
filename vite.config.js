import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
        manualChunks: {
          'vendor-peerjs': ['peerjs'],
          'vendor-peernet': ['./src/core/peernet-stack.js'],
          'core-audio': ['./src/core/audio.js', './src/core/patchbay.js'],
          'ui-patch': ['./src/ui/patch-canvas.js'],
        },
      },
    },
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  },
  server: {
    port: 5173,
    host: true,
    open: true,
    fs: {
      strict: false,
    },
  },
  preview: {
    port: 4173,
    host: true,
  },
  optimizeDeps: {
    include: [],
    exclude: ['peerjs'],
  },
  assetsInclude: ['**/*.wasm', '**/*.orb'],
});
