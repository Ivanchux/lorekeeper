/* Servidor Node (sin dependencias) para tu propio servidor / Coolify / Docker.
   - Guarda cada baúl como un archivo en DATA_DIR.
   - Si defines STATIC_DIR, también sirve la app (así todo vive en una sola dirección).
   Variables: PORT (8787), DATA_DIR (./data), STATIC_DIR, CREATE_PASSWORD, ALLOWED_ORIGIN, MAX_BYTES */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './core.js';

const env = process.env;
const PORT = Number(env.PORT) || 8787;
const DATA_DIR = path.resolve(env.DATA_DIR || './data');
const STATIC_DIR = env.STATIC_DIR ? path.resolve(env.STATIC_DIR) : null;
fs.mkdirSync(DATA_DIR, { recursive: true });

const file = (k) => path.join(DATA_DIR, k.replace(/[^a-z0-9:]/gi, '_').replace(/:/g, '-') + '.json');
const locks = new Map();

const store = {
  async get(k) {
    try {
      return await fs.promises.readFile(file(k), 'utf8');
    } catch {
      return null;
    }
  },
  async put(k, v) {
    const f = file(k);
    const tmp = f + '.tmp';
    await fs.promises.writeFile(tmp, v);
    await fs.promises.rename(tmp, f); // escritura atómica
  },
  async delete(k) {
    await fs.promises.rm(file(k), { force: true });
  },
  /** Una petición a la vez por baúl: evita que dos PUT se pisen. */
  async lock(k, fn) {
    const prev = locks.get(k) || Promise.resolve();
    const next = prev.then(fn, fn);
    locks.set(k, next.catch(() => {}));
    return next;
  },
};

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const full = path.resolve(STATIC_DIR, '.' + rel);
  if (!full.startsWith(STATIC_DIR + path.sep) && full !== STATIC_DIR) {
    res.writeHead(403).end('Prohibido');
    return;
  }
  try {
    const stat = await fs.promises.stat(full);
    if (!stat.isFile()) throw new Error('no file');
    const ext = path.extname(full);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' || full.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600',
    });
    fs.createReadStream(full).pipe(res);
  } catch {
    res.writeHead(404).end('No encontrado');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (STATIC_DIR && !req.url.startsWith('/api/')) return serveStatic(req, res);
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > (Number(env.MAX_BYTES) || 8 * 1024 * 1024) + 1024) {
        res.writeHead(413).end('Demasiado grande');
        return;
      }
      chunks.push(c);
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(',') : v);
    const request = new Request(`http://${req.headers.host || 'localhost'}${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request, store, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Error interno' }));
  }
});

server.listen(PORT, () => console.log(`LoreKeeper sync en http://localhost:${PORT}  (datos: ${DATA_DIR}${STATIC_DIR ? `, app: ${STATIC_DIR}` : ''})`));
