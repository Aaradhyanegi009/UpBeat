import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const API_DIR = fileURLToPath(new URL('../api', import.meta.url))
const PASS_HEADERS = ['content-type', 'range', 'accept', 'accept-language']

// Dev only: run the Vercel edge functions in /api inside the Vite server,
// so search, charts and audio work with `npm run dev` without deploying.
function vercelEdgeFunctionsInDev() {
  return {
    name: 'upbeat-vercel-edge-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const match = (req.url || '').match(/^\/api\/(innertube|audio-info|audio)(?:\/([^/?]+))?(\?.*)?$/)
        if (!match) return next()
        const [, name, id, query = ''] = match
        try {
          const mod = await import(pathToFileURL(path.join(API_DIR, `${name}.js`)).href)
          const url = new URL(`/api/${name}${query}`, 'http://localhost')
          if (id) url.searchParams.set('id', id)

          const headers = new Headers()
          for (const key of PASS_HEADERS) {
            if (req.headers[key]) headers.set(key, req.headers[key])
          }
          let body
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks = []
            for await (const chunk of req) chunks.push(chunk)
            body = Buffer.concat(chunks)
          }

          const response = await mod.default(new Request(url, { method: req.method, headers, body }))
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined)
        } catch (err) {
          res.statusCode = 500
          res.end(String(err?.message || err))
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), vercelEdgeFunctionsInDev()],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-icons': ['lucide-react']
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})
