import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/

/** Alinha o proxy ao backend: se VITE_API_URL for http://localhost:PORT, usa essa porta (evita 404 noutro serviço). */
function resolveProxyTarget(env) {
  const raw = String(env.VITE_API_URL || '').trim()
  const m = raw.match(/^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/?$/i)
  if (m) return `http://127.0.0.1:${m[1]}`
  const proxyPort = env.VITE_DEV_PROXY_PORT || '3030'
  return `http://127.0.0.1:${proxyPort}`
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const target = resolveProxyTarget(env)

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          /** Uploads grandes (ex.: DJ sets até 250MB) — alinhar com API_REQUEST_MS_BULK no frontend */
          timeout: 12 * 60_000,
          proxyTimeout: 12 * 60_000,
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
