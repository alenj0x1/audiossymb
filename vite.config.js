import { defineConfig } from 'vite';

// Spotify exige URIs de redirección con IP de loopback (127.0.0.1), no "localhost".
export default defineConfig({
  server: { host: '127.0.0.1', port: 5173, strictPort: true, open: false },
  preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  appType: 'spa',
  build: { target: 'es2022' },
});
