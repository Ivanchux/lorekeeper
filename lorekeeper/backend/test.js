// Pruebas del núcleo (node test.js). Sin dependencias.
import assert from 'node:assert/strict';
import { handle } from './core.js';

const mem = new Map();
const store = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => void mem.set(k, v), delete: async (k) => void mem.delete(k) };
const call = async (method, path, { headers = {}, body, env = {} } = {}) => {
  const res = await handle(new Request('http://x' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), store, env);
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
};
const token = 'a'.repeat(64);
const auth = { Authorization: 'Bearer ' + token };

let r = await call('GET', '/api/health');
assert.equal(r.status, 200); assert.equal(r.headers.get('access-control-allow-origin'), '*');

r = await call('GET', '/api/vault', { headers: auth });
assert.equal(r.status, 404, 'sin baúl');

r = await call('POST', '/api/vaults', { body: { token: 'corto' } });
assert.equal(r.status, 400);

r = await call('POST', '/api/vaults', { body: { token }, env: { CREATE_PASSWORD: 'pw' } });
assert.equal(r.status, 401, 'pide contraseña');
r = await call('POST', '/api/vaults', { body: { token }, headers: { 'X-Create-Password': 'pw' }, env: { CREATE_PASSWORD: 'pw' } });
assert.equal(r.status, 201);
r = await call('POST', '/api/vaults', { body: { token } });
assert.equal(r.status, 409, 'ya existe');

r = await call('GET', '/api/vault?meta=1', { headers: auth });
assert.deepEqual([r.status, r.json.rev, r.json.empty], [200, 0, true]);

r = await call('PUT', '/api/vault', { headers: auth, body: { data: 'hola' } });
assert.equal(r.status, 428, 'sin If-Match');
r = await call('PUT', '/api/vault', { headers: { ...auth, 'If-Match': '0' }, body: { data: 'v1' } });
assert.deepEqual([r.status, r.json.rev], [200, 1]);
r = await call('PUT', '/api/vault', { headers: { ...auth, 'If-Match': '0' }, body: { data: 'v2' } });
assert.deepEqual([r.status, r.json.rev], [409, 1], 'versión vieja rechazada');
r = await call('PUT', '/api/vault', { headers: { ...auth, 'If-Match': '1' }, body: { data: 5 } });
assert.equal(r.status, 400);
r = await call('PUT', '/api/vault', { headers: { ...auth, 'If-Match': '1' }, body: { data: 'x'.repeat(200) }, env: { MAX_BYTES: 100 } });
assert.equal(r.status, 413);

r = await call('GET', '/api/vault', { headers: auth });
assert.deepEqual([r.json.rev, r.json.data], [1, 'v1']);

r = await call('GET', '/api/vault', { headers: { Authorization: 'Bearer ' + 'b'.repeat(64) } });
assert.equal(r.status, 404, 'otro código no ve nada');
r = await call('GET', '/api/vault', { headers: { Authorization: 'Bearer nope' } });
assert.equal(r.status, 401);

// el servidor guarda solo hashes: el token no aparece en ninguna clave ni valor
assert.ok([...mem.keys()].every((k) => !k.includes(token)));

r = await call('OPTIONS', '/api/vault');
assert.equal(r.status, 204);
r = await call('DELETE', '/api/vault', { headers: auth });
assert.equal(r.status, 200);
r = await call('GET', '/api/vault', { headers: auth });
assert.equal(r.status, 404);
console.log('backend: todas las pruebas OK');
