import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.BACKLOGGER_PORT ?? '3333';
const API_TARGET = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.BACKLOGGER_WEB_PORT ?? 5173),
    proxy: {
      '/api': API_TARGET,
      '/health': API_TARGET,
    },
  },
});
