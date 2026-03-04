import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStannis } from '../src/index.js'

const DIR = fileURLToPath(new URL('.', import.meta.url))
const PORT = process.env.PORT || 3000

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
}

// Shared in-memory storage for all flows
const store = new Map()
const storage = {
  get: async (key) => store.get(key) ?? null,
  set: async (key, value) => store.set(key, value),
}

// flowId → definition (needed to reconstruct stannis for /api/graph)
const definitions = new Map()

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => (body += chunk))
    req.on('end', () => {
      try { resolve(JSON.parse(body)) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

function jsonRes(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  if (req.method === 'POST' && url.pathname === '/api/run') {
    try {
      const { definition, token } = await readBody(req)
      if (!definition) return jsonRes(res, { error: 'definition required' }, 400)
      const stannis = createStannis({ definition, storage })
      const result = await stannis.run(token ?? undefined)
      definitions.set(result.flowId, definition)
      return jsonRes(res, result)
    } catch (err) {
      return jsonRes(res, { error: err.message }, 500)
    }
  }

  if (req.method === 'GET' && url.pathname === '/api/graph') {
    try {
      const flowId = url.searchParams.get('flowId')
      if (!flowId) return jsonRes(res, { error: 'flowId required' }, 400)
      const definition = definitions.get(flowId)
      if (!definition) return jsonRes(res, { error: 'unknown flowId' }, 404)
      const stannis = createStannis({ definition, storage })
      const html = await stannis.graph('html', flowId)
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end(html)
    } catch (err) {
      return jsonRes(res, { error: err.message }, 500)
    }
  }

  // Static files
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname
  const file = join(DIR, pathname)
  try {
    const data = await readFile(file)
    const type = MIME[extname(file)] || 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type })
    res.end(data)
  } catch {
    res.writeHead(404)
    res.end('Not found')
  }
})

server.listen(PORT, () => {
  console.log(`stannis demo → http://localhost:${PORT}`)
})
