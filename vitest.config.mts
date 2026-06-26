import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  test: {
    // Server-side tests use 'node'; React component tests override with @vitest-environment jsdom
    environment: 'node',
    globals: true,
    env: loadEnv(mode, process.cwd(), ''),
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
}))
