import { defineConfig, loadEnv, type HtmlTagDescriptor, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  fetchVideoSummaries,
  isVideoId,
  searchMusicVideos,
  YouTubeUpstreamError,
} from './api/_youtube.ts'
import sessionHandler from './api/session.ts'
import { getSessionState, subscribeSession } from './api/_session.ts'

// Figma Make stores site metadata in .figma/make/site.json. That file is
// generated inside Figma and can be missing when the project is built in
// another environment (e.g. Vercel), so load it defensively and fall back
// to an empty configuration instead of failing the build on a hard import.
function loadSiteConfiguration(): FigmaSiteConfiguration {
  try {
    const raw = readFileSync(path.resolve(import.meta.dirname, './.figma/make/site.json'), 'utf8')
    return JSON.parse(raw) as FigmaSiteConfiguration
  } catch {
    return {}
  }
}

const siteConfiguration = loadSiteConfiguration()

// Vite config — https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // .figma/make/deploy-preview passes `--mode development` for cached-preview builds.
  const emitSourcemaps = mode === 'development'
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: process.env.FIGMA_PUBLIC_URL ? `${process.env.FIGMA_PUBLIC_URL}/` : '/',
    build: {
      sourcemap: emitSourcemaps ? 'inline' : false,
      minify: !emitSourcemaps,
    },
    plugins: [
      react(),
      tailwindcss(),
      figmaSiteConfiguration(siteConfiguration),
      figmaErrorOverlayReplay(),
      figmaReactRefreshBoundaryFallback(),
      figmaMakeKitPlugin({ storiesGlob: '/src/**/*.stories.{ts,tsx,js,jsx}' }),
      youtubeApiProxy(env.YOUTUBE_API_KEY),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 0,
      strictPort: !!process.env.PORT,
      watch: { ignored: ['**/.figma/**'] },
    },
    preview: {
      host: '0.0.0.0',
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 0,
    },
  }
})

type FigmaSiteConfiguration = {
  title?: string
  description?: string
  language?: string
  robots?: {
    index?: boolean
  }
  icons?: {
    icon?: string
  }
  openGraph?: {
    image?: string
  }
  customScripts?: {
    headStart?: string
    headEnd?: string
    bodyStart?: string
    bodyEnd?: string
  }
  accessibility?: {
    addBypassLinks?: boolean
  }
}

/** Applies /.figma/make/site.json to the generated document shell. */
function figmaSiteConfiguration(config: FigmaSiteConfiguration): Plugin {
  function sanitizeHtmlValue(value: string | undefined): string {
    return value?.replace(/[^a-zA-Z0-9_-]/g, '') || ''
  }
  function escapeHtmlText(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
  function replaceHtmlCommentSlot(html: string, slotName: string, content: string): string {
    return html.replace(`<!-- ${slotName} -->`, content)
  }

  const title = config.title ?? "Figma Make App"
  const description = config.description ?? ''
  const favicon = config.icons?.icon ?? ''
  const socialImage = config.openGraph?.image ?? ''
  const language = sanitizeHtmlValue(config.language) || 'en'
  const headStart = config.customScripts?.headStart ?? ''
  const headEnd = config.customScripts?.headEnd ?? ''
  const bodyStart = config.customScripts?.bodyStart ?? ''
  const bodyEnd = config.customScripts?.bodyEnd ?? ''
  const robotsTxt = config.robots?.index === false ? 'User-agent: *\nDisallow: /\n' : ''

  return {
    name: 'figma-site-configuration',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!robotsTxt || req.url?.split('?')[0] !== '/robots.txt') return next()

        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(robotsTxt)
      })
    },
    generateBundle() {
      if (!robotsTxt) return

      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: robotsTxt,
      })
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let result = html
        result = replaceHtmlCommentSlot(result, 'figma:lang', language)
        result = replaceHtmlCommentSlot(result, 'figma:title', escapeHtmlText(title))
        result = replaceHtmlCommentSlot(result, 'figma:head-start', headStart)
        result = replaceHtmlCommentSlot(result, 'figma:head-end', headEnd)
        result = replaceHtmlCommentSlot(result, 'figma:body-start', bodyStart)
        result = replaceHtmlCommentSlot(result, 'figma:body-end', bodyEnd)

        const tags: HtmlTagDescriptor[] = []
        if (description) {
          tags.push({ tag: 'meta', attrs: { name: 'description', content: description }, injectTo: 'head' })
        }
        if (config.robots?.index === false) {
          tags.push({ tag: 'meta', attrs: { name: 'robots', content: 'noindex, nofollow' }, injectTo: 'head' })
        }
        if (favicon) {
          tags.push({ tag: 'link', attrs: { rel: 'icon', href: favicon }, injectTo: 'head' })
        }
        if (title) {
          tags.push({ tag: 'meta', attrs: { property: 'og:title', content: title }, injectTo: 'head' })
        }
        if (description) {
          tags.push({ tag: 'meta', attrs: { property: 'og:description', content: description }, injectTo: 'head' })
        }
        if (socialImage) {
          tags.push(
            { tag: 'meta', attrs: { property: 'og:image', content: socialImage }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' }, injectTo: 'head' },
            { tag: 'meta', attrs: { name: 'twitter:image', content: socialImage }, injectTo: 'head' },
          )
        }

        if (config.accessibility?.addBypassLinks) {
          tags.push(
            {
              tag: 'style',
              children: `
  .figma-bypass-link {
    position: fixed;
    top: 8px;
    left: 8px;
    z-index: 2147483647;
    transform: translateY(-150%);
    border-radius: 6px;
    background: #111827;
    color: #fff;
    padding: 8px 12px;
    font: 600 14px/1.2 system-ui, sans-serif;
    text-decoration: none;
  }
  .figma-bypass-link:focus {
    transform: translateY(0);
  }
`,
              injectTo: 'head',
            },
            {
              tag: 'a',
              attrs: { class: 'figma-bypass-link', href: '#root' },
              children: 'Skip to content',
              injectTo: 'body-prepend',
            },
          )
        }

        return {
          html: result,
          tags,
        }
      },
    },
  }
}

/**
 * Replay the most recent build error to clients that connect after
 * it was first broadcast. Vite buffers an error payload only while
 * no clients are connected and clears the buffer on the first
 * reconnect (see `bufferedMessage` in `createWebSocketServer`), so
 * if the preview iframe reloads after Vite already delivered an
 * error to a live socket, the new socket misses the payload and
 * the overlay stays hidden even though the build is still broken.
 * We intercept `ws.send` to remember the latest error and replay
 * it on every new connection; the cache clears on a successful
 * `update` or `full-reload` so a stale overlay can't survive a
 * fixed build.
 */
function figmaErrorOverlayReplay(): Plugin {
  return {
    name: 'figma-error-overlay-replay',
    apply: 'serve',
    configureServer(server) {
      let lastError: object | null = null

      const origSend = server.ws.send.bind(server.ws) as (...args: any[]) => void
      server.ws.send = ((...args: any[]) => {
        const payload = args[0]
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const type = (payload as { type?: string }).type
          if (type === 'error') {
            lastError = payload as object
          } else if (type === 'update' || type === 'full-reload') {
            lastError = null
          }
        }
        return origSend(...args)
      }) as typeof server.ws.send

      server.ws.on('connection', (socket) => {
        if (lastError !== null) {
          socket.send(JSON.stringify(lastError))
        }
      })
    },
  }
}

/**
 * Reload when a module that previously defined a React Refresh boundary stops
 * defining one. This happens when an agent moves a component into a new file
 * and replaces the old module with a re-export:
 *
 *   export { default } from './app/App'
 *
 * Vite otherwise accepts the update using the previous module's HMR boundary,
 * but the re-export-only transform no longer registers a replacement for the
 * mounted component family. React reports a successful refresh while leaving
 * the old tree mounted until the page is reloaded.
 */
function figmaReactRefreshBoundaryFallback(): Plugin {
  const hadRefreshBoundary = new Map<string, boolean>()
  let sendFullReload: (() => void) | null = null

  return {
    name: 'figma-react-refresh-boundary-fallback',
    apply: 'serve',
    enforce: 'post',
    configureServer(server) {
      sendFullReload = () => server.ws.send({ type: 'full-reload', path: '*' })
    },
    transform(code, id) {
      if (!/\.[jt]sx?(?:\?|$)/.test(id) || id.includes('/node_modules/')) return null

      const moduleId = id.split('?')[0] ?? id
      const hasRefreshBoundary = code.includes('registerExportsForReactRefresh')
      const previousHadRefreshBoundary = hadRefreshBoundary.get(moduleId)
      hadRefreshBoundary.set(moduleId, hasRefreshBoundary)

      if (previousHadRefreshBoundary && !hasRefreshBoundary) {
        queueMicrotask(() => sendFullReload?.())
      }

      return null
    },
  }
}

/**
 * Serves a blank render-target page at /.figma/make/kit.html that
 * the Figma preview script drives directly. The page exposes a
 * registry of every file matching `storiesGlob` on
 * window.__FIGMA__.stories so the design surface can dynamically
 * import + mount each entry into its own grid view.
 *
 * Dev-only: `apply: 'serve'` gates the plugin to `vite dev`. Prod
 * builds (`vite build`) skip it entirely so the route doesn't leak
 * into shipped bundles.
 */
function youtubeApiProxy(apiKey?: string): Plugin {
  return {
    name: 'youtube-api-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        const [pathname, rawQuery] = url.split('?')
        if (
          pathname !== '/api/search' &&
          pathname !== '/api/videos' &&
          pathname !== '/api/session'
        )
          return next()
        const send = (status: number, body: unknown, cacheControl?: string) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          if (cacheControl) res.setHeader('Cache-Control', cacheControl)
          res.end(JSON.stringify(body))
        }
        const fail = (status: number, code: string, message: string) =>
          send(status, { error: { code, message } })

        const params = new URLSearchParams(rawQuery ?? '')

        if (pathname === '/api/session') {
          if (req.method === 'GET' && params.get('stream') === '1') {
            const code = params.get('code') ?? ''
            const role = params.get('role') ?? undefined
            const clientId = params.get('clientId') ?? undefined
            const initial = getSessionState(code, role, clientId)
            if (!initial) {
              fail(404, 'session_not_found', 'No active session found for that code.')
              return
            }

            res.statusCode = 200
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
            res.setHeader('Cache-Control', 'no-cache, no-transform')
            res.setHeader('Connection', 'keep-alive')
            res.flushHeaders?.()

            const writeEvent = (payload: unknown) => {
              res.write(`data: ${JSON.stringify(payload)}\n\n`)
            }

            writeEvent({
              type: 'snapshot',
              snapshot: initial.snapshot,
              connectedClients: initial.connectedClients,
              ackCommandIds: initial.ackCommandIds,
            })
            if (initial.pendingCommands.length > 0 && role === 'host') {
              writeEvent({
                type: 'commands',
                commands: initial.pendingCommands,
                connectedClients: initial.connectedClients,
              })
            }

            const unsubscribe = subscribeSession(code, role, clientId, (event) => {
              writeEvent(event)
            })
            const keepAlive = setInterval(() => {
              res.write(': ping\n\n')
            }, 15000)

            req.on('close', () => {
              clearInterval(keepAlive)
              unsubscribe?.()
            })
            return
          }

          let parsedBody: unknown = undefined
          if (req.method === 'POST') {
            try {
              const chunks: Buffer[] = []
              for await (const chunk of req) {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
              }
              const rawBody = Buffer.concat(chunks).toString('utf8')
              parsedBody = rawBody ? JSON.parse(rawBody) : {}
            } catch {
              fail(400, 'invalid_request', 'Invalid JSON request body.')
              return
            }
          }

          const queryRecord: Record<string, string> = {}
          for (const [k, v] of params.entries()) {
            queryRecord[k] = v
          }

          let statusCode = 200
          const apiRes = {
            setHeader(name: string, value: string) {
              res.setHeader(name, value)
            },
            status(code: number) {
              statusCode = code
              return apiRes
            },
            json(body: unknown) {
              send(statusCode, body)
              return body
            },
          }

          await sessionHandler(
            { method: req.method, query: queryRecord, body: parsedBody },
            apiRes,
          )
          return
        }

        if (req.method !== 'GET') {
          res.setHeader('Allow', 'GET')
          fail(405, 'method_not_allowed', 'Only GET requests are supported.')
          return
        }

        const key = apiKey ?? process.env.YOUTUBE_API_KEY
        if (!key) {
          fail(500, 'service_unconfigured', 'YouTube access is not configured yet.')
          return
        }

        try {
          if (pathname === '/api/search') {
            const query = params.get('q')?.trim().replace(/\s+/g, ' ') ?? ''
            const limit = Number(params.get('limit') ?? '8')
            if (query.length < 2 || query.length > 100) {
              fail(
                400,
                'invalid_request',
                'Search terms must contain between 2 and 100 characters.',
              )
              return
            }
            if (!Number.isInteger(limit) || limit < 1 || limit > 8) {
              fail(
                400,
                'invalid_request',
                'The result limit must be a whole number between 1 and 8.',
              )
              return
            }
            const result = await searchMusicVideos(query, limit, key)
            send(
              200,
              result,
              'public, max-age=0, s-maxage=300, stale-while-revalidate=60',
            )
            return
          }

          const ids = (params.get('ids') ?? '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
          if (!ids.length || ids.length > 50 || ids.some((id) => !isVideoId(id))) {
            fail(
              400,
              'invalid_request',
              'Provide between 1 and 50 comma-separated YouTube video IDs.',
            )
            return
          }
          const result = await fetchVideoSummaries(ids, key)
          send(
            200,
            result,
            'public, max-age=0, s-maxage=86400, stale-while-revalidate=3600',
          )
        } catch (error) {
          const quota =
            error instanceof YouTubeUpstreamError &&
            (/quota/i.test(error.reason ?? '') || error.status === 429)
          fail(
            quota ? 429 : 502,
            quota ? 'quota_exceeded' : 'upstream_unavailable',
            quota
              ? 'YouTube access is temporarily busy. Please try again later.'
              : 'YouTube is temporarily unavailable.',
          )
        }
      })
    },
  }
}

function figmaMakeKitPlugin(options: { storiesGlob: string | string[] }): Plugin {
  const storiesGlob = Array.isArray(options.storiesGlob) ? options.storiesGlob : [options.storiesGlob]
  const ROUTE = '/.figma/make/kit.html'
  const VIRTUAL_ID = 'virtual:figma-stories'
  const RESOLVED_ID = '\0' + VIRTUAL_ID
  const STORIES_MODULE = `export const stories = import.meta.glob(${JSON.stringify(storiesGlob)})`
  const HTML_BOOTSTRAP = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body>
<div id="figma-make-kit-root"></div>
<script type="module">
  import { stories } from 'virtual:figma-stories'
  window.__FIGMA__ = Object.assign(window.__FIGMA__ ?? {}, { stories })
  window.dispatchEvent(new CustomEvent('figma.ready'))
</script>
</body>
</html>`

  return {
    name: 'figma-make-kit',
    apply: 'serve',
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },
    load(id) {
      if (id !== RESOLVED_ID) return null
      return STORIES_MODULE
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || ''
        if (url.split('?')[0] !== ROUTE) return next()

        try {
          res.setHeader('Content-Type', 'text/html')
          res.end(await server.transformIndexHtml(url, HTML_BOOTSTRAP))
        } catch (err) {
          next(err as Error)
        }
      })
    },
  }
}
