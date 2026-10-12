/* ==========================================================
   NÚCLEO DEL SERVIDOR DE SINCRONIZACIÓN
   Funciona igual en Cloudflare Workers y en Node (usa solo
   APIs web estándar: Request, Response, crypto.subtle).

   Qué guarda: UN texto opaco por "baúl". El móvil lo cifra
   antes de enviarlo (AES-GCM con una clave derivada de tu código),
   así que el servidor no puede leer tus libros aunque quisiera.

   Autenticación: el cliente manda un token (SHA-256 de su código).
   El servidor guarda solo el hash de ese token como nombre del baúl.

   API
     GET    /api/health
     POST   /api/vaults            {token}            crea un baúl vacío
     GET    /api/vault[?meta=1]    Bearer <token>     {rev, updatedAt, data}
     PUT    /api/vault             Bearer + If-Match  {data} → {rev, updatedAt}
     DELETE /api/vault             Bearer             borra el baúl
   Control de versiones optimista: cada PUT debe indicar la `rev`
   que conocía. Si otro dispositivo guardó antes → 409 y el cliente
   fusiona.
   ========================================================== */

const TOKEN_RE = /^[a-f0-9]{64}$/;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

function cors(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, X-Create-Password',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(env, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(env) },
  });
}

/** timingSafeEqual simple para comparar textos del mismo largo */
function same(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * @param {Request} request
 * @param {{get(k:string):Promise<string|null>, put(k:string,v:string):Promise<void>, delete(k:string):Promise<void>, lock?:(k:string,fn:Function)=>Promise<any>}} store
 * @param {{CREATE_PASSWORD?:string, ALLOWED_ORIGIN?:string, MAX_BYTES?:string|number}} env
 */
export async function handle(request, store, env = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  const MAX = Number(env.MAX_BYTES) || 8 * 1024 * 1024;

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
  if (!path.startsWith('/api/')) return json(env, 404, { error: 'No encontrado' });

  if (path === '/api/health' && request.method === 'GET') {
    return json(env, 200, { ok: true, name: 'lorekeeper-sync', needsPassword: !!env.CREATE_PASSWORD });
  }

  // Crear un baúl
  if (path === '/api/vaults' && request.method === 'POST') {
    if (env.CREATE_PASSWORD) {
      const given = request.headers.get('X-Create-Password') || '';
      if (!same(await sha256(given), await sha256(env.CREATE_PASSWORD))) {
        return json(env, 401, { error: 'Falta la contraseña de creación o no es correcta.' });
      }
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return json(env, 400, { error: 'JSON no válido' });
    }
    if (!TOKEN_RE.test(body?.token || '')) return json(env, 400, { error: 'Token no válido' });
    const key = 'v:' + (await sha256(body.token));
    if (await store.get(key)) return json(env, 409, { error: 'Ese código ya existe' });
    const rec = { rev: 0, updatedAt: Date.now(), data: null };
    await store.put(key, JSON.stringify(rec));
    return json(env, 201, { rev: rec.rev, updatedAt: rec.updatedAt });
  }

  if (path === '/api/vault') {
    const m = (request.headers.get('Authorization') || '').match(/^Bearer ([a-f0-9]{64})$/);
    if (!m) return json(env, 401, { error: 'Falta el código de acceso' });
    const key = 'v:' + (await sha256(m[1]));

    const run = (fn) => (store.lock ? store.lock(key, fn) : fn());

    if (request.method === 'GET') {
      const raw = await store.get(key);
      if (!raw) return json(env, 404, { error: 'No existe ese baúl. Revisa el código.' });
      const rec = JSON.parse(raw);
      if (url.searchParams.get('meta')) return json(env, 200, { rev: rec.rev, updatedAt: rec.updatedAt, empty: rec.data == null });
      return json(env, 200, rec);
    }

    if (request.method === 'PUT') {
      const len = Number(request.headers.get('Content-Length') || 0);
      if (len > MAX) return json(env, 413, { error: 'Demasiado grande' });
      const text = await request.text();
      if (text.length > MAX) return json(env, 413, { error: 'Demasiado grande' });
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return json(env, 400, { error: 'JSON no válido' });
      }
      if (typeof body?.data !== 'string') return json(env, 400, { error: 'Falta data' });
      const ifMatch = request.headers.get('If-Match');
      if (ifMatch == null) return json(env, 428, { error: 'Falta If-Match' });

      return run(async () => {
        const raw = await store.get(key);
        if (!raw) return json(env, 404, { error: 'No existe ese baúl.' });
        const cur = JSON.parse(raw);
        if (String(cur.rev) !== String(ifMatch)) return json(env, 409, { error: 'Hay una versión más reciente', rev: cur.rev, updatedAt: cur.updatedAt });
        const rec = { rev: cur.rev + 1, updatedAt: Date.now(), data: body.data };
        await store.put(key, JSON.stringify(rec));
        return json(env, 200, { rev: rec.rev, updatedAt: rec.updatedAt });
      });
    }

    if (request.method === 'DELETE') {
      if (!(await store.get(key))) return json(env, 404, { error: 'No existe ese baúl.' });
      await store.delete(key);
      return json(env, 200, { ok: true });
    }
  }

  return json(env, 404, { error: 'No encontrado' });
}
