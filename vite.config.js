import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig } from 'vite';

function copyStaticRuntimeAssets() {
  return {
    name: 'copy-static-runtime-assets',
    async closeBundle() {
      await Promise.all([
        cp(join(process.cwd(), 'vendor'), join(process.cwd(), 'dist', 'vendor'), { recursive: true, force: true }),
        cp(join(process.cwd(), 'docs'), join(process.cwd(), 'dist', 'docs'), { recursive: true, force: true }),
      ]);
    },
  };
}

export default defineConfig({
  root: '.',
  base: './',
  plugins: [copyStaticRuntimeAssets()],
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
