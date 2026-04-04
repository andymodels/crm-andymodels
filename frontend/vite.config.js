import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const proxyPort = env.VITE_DEV_PROXY_PORT || '3030'
  const target = `http://127.0.0.1:${proxyPort}`

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          timeout: 20_000,
          proxyTimeout: 20_000,
        },
        '/health': {
          target,
          changeOrigin: true,
          timeout: 10_000,
          proxyTimeout: 10_000,
        },
      },
    },
  }
})
