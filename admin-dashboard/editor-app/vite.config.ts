import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/store-editor/',
  build: {
    outDir:    path.resolve(__dirname, '../public/store-editor'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:  ['react', 'react-dom', 'zustand'],
          dnd:     ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          icons:   ['lucide-react'],
        },
      },
    },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
