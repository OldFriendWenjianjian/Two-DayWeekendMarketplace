import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/shc-20260520-a1faaf/weekend-marketplace/',
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
});
