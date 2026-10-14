import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Демо собирается в папку ../demo и открывается по адресу /demo/
// base './' — относительные пути, чтобы работало и на github.io/ordius/demo/, и на ordius.ru/demo/
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../demo',
    emptyOutDir: true
  }
});
