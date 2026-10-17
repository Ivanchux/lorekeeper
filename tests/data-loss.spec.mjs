// Pruebas de pérdida de datos con navegador real (Chromium). Ejecuta: cd tests && npm test
import { test } from '@playwright/test';
import { setup, open, waitReady, setFault, seed, counts, rawIdb, lsDbKeys, fakeSyncServer, expect } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await setup(page);
});

/* ---------------- Arranque con IndexedDB lenta o caída ---------------- */

test('IndexedDB tarda en abrir: espera y muestra los datos, sin pasarse a localStorage', async ({ page }) => {
  await open(page);
  await seed(page);
  await setFault(page, { delay: 4500 });
  await page.reload();
  await waitReady(page);
  expect(await page.evaluate(() => LK.db.adapterName())).toBe('IndexedDB');
  expect(await counts(page)).toEqual({ books: 3, sessions: 2 });
  await expect(page.locator('#view')).toContainText('Libro 1');
  expect(await lsDbKeys(page)).toEqual([]);
});

test('IndexedDB falla las dos primeras veces: reintenta y abre', async ({ page }) => {
  await open(page);
  await seed(page);
  await setFault(page, { failTimes: 2 });
  await page.reload();
  await waitReady(page);
  expect(await counts(page)).toEqual({ books: 3, sessions: 2 });
  expect(await lsDbKeys(page)).toEqual([]);
});

test('IndexedDB no abre nunca: avisa y no escribe nada en ningún sitio', async ({ page }) => {
  await open(page);
  await seed(page);
  await setFault(page, { always: true });
  await page.reload();
  await waitReady(page, 45000);
  await expect(page.locator('.boot-error')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.lkBoot)).toBe('error');
  expect(await lsDbKeys(page)).toEqual([]);
  // Cuando IndexedDB vuelve, todo sigue ahí
  await setFault(page, null);
  await page.locator('#boot-retry').click();
  await waitReady(page);
  expect(await counts(page)).toEqual({ books: 3, sessions: 2 });
});

test('Conexión con IndexedDB perdida a mitad (Safari): se reconecta y guarda', async ({ page }) => {
  await open(page);
  await seed(page);
  await setFault(page, { txFailTimes: 1 });
  await page.evaluate(() => LK.db.saveSession({ id: 'tras-corte', bookId: 'b0', durationMinutes: 45 }));
  await setFault(page, null);
  expect((await rawIdb(page)).sessions.map((s) => s.id)).toContain('tras-corte');
});

test('Datos que quedaron en localStorage por un fallo antiguo se fusionan con IndexedDB y se guarda copia', async ({ page }) => {
  await open(page);
  await seed(page, { books: 1, audioSessions: 1 });
  // Lo que habría escrito la versión anterior al pasarse a localStorage
  await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('lk-db-books', JSON.stringify({ perdido: { id: 'perdido', title: 'Libro de la sesión perdida', format: 'audio', updatedAt: now } }));
    localStorage.setItem('lk-db-sessions', JSON.stringify({ sp: { id: 'sp', bookId: 'perdido', durationMinutes: 50, createdAt: now } }));
  });
  await page.reload();
  await waitReady(page);
  const ids = (await page.evaluate(() => LK.db.getBooks())).map((b) => b.id).sort();
  expect(ids).toEqual(['b0', 'perdido']);
  expect((await page.evaluate(() => LK.db.getSessions())).map((s) => s.id).sort()).toEqual(['s0', 'sp']);
  // El original no se borra: queda como copia con otro nombre, y ya no se vuelve a fusionar
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).not.toContain('lk-db-books');
  expect(keys.some((k) => k.startsWith('lk-respaldo-ls-books'))).toBe(true);
  expect((await page.evaluate(() => LK.db.listSnapshots())).length).toBeGreaterThan(0);
});

test('Una sesión de audio en marcha sobrevive a un arranque lento y se puede guardar', async ({ page }) => {
  await open(page);
  await seed(page, { books: 1, audioSessions: 0 });
  await page.evaluate(() =>
    localStorage.setItem('lk-timer', JSON.stringify({ bookId: 'b0', title: 'Libro 0', startPage: 0, startedAt: Date.now() - 40 * 60000, accMs: 0, running: true, audio: true, startPos: 0, speed: 1, accContent: 0 }))
  );
  await setFault(page, { delay: 4000 });
  await page.reload();
  await waitReady(page);
  await setFault(page, null);
  await page.locator('#timer-pill').click();
  await expect(page.locator('.timer-overlay')).toBeVisible();
  await page.locator('.timer-overlay [data-act="finish"]').click();
  await page.locator('dialog[open] button[type="submit"]').click();
  await expect.poll(() => page.evaluate(async () => (await LK.db.getSessions()).length)).toBe(1);
  const s = (await page.evaluate(() => LK.db.getSessions()))[0];
  expect(s.durationMinutes).toBeGreaterThanOrEqual(39);
});

/* ---------------- Restaurar y borrar ---------------- */

test('Restaurar una copia deja una copia automática y se puede volver atrás', async ({ page }) => {
  await open(page);
  await seed(page);
  const file = { name: 'vieja.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'lorekeeper', schema: 3, books: [{ id: 'x', title: 'Solo uno' }], sessions: [], quotes: [] })) };
  await page.goto('/index.html#/ajustes');
  await waitReady(page);
  await page.locator('#input-import').setInputFiles(file);
  await page.locator('dialog[open] [data-ok]').click();
  await expect.poll(() => counts(page)).toEqual({ books: 1, sessions: 0 });
  // Volver atrás desde Ajustes
  await page.goto('/index.html#/ajustes');
  await waitReady(page);
  await page.locator('details.snapshots summary').click();
  await expect(page.locator('details.snapshots')).toContainText('Antes de restaurar una copia');
  await page.locator('[data-snapshot]').first().click();
  await page.locator('dialog[open] [data-ok]').click();
  await expect.poll(() => counts(page)).toEqual({ books: 3, sessions: 2 });
});

test('Borrar todo se puede deshacer y no olvida los borrados anteriores', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.evaluate(() => LK.db.deleteBook('b2'));
  await page.evaluate(() => LK.db.wipeAll());
  expect(await counts(page)).toEqual({ books: 0, sessions: 0 });
  const tombs = await page.evaluate(() => LK.db.getTombstones());
  expect(Object.keys(tombs)).toEqual(expect.arrayContaining(['b0', 'b1', 'b2']));
  const snaps = await page.evaluate(() => LK.db.listSnapshots());
  expect(snaps[0].books).toBe(2);
  await page.evaluate((id) => LK.db.restoreSnapshot(id), snaps[0].id);
  expect(await counts(page)).toEqual({ books: 2, sessions: 2 });
});

/* ---------------- Dos pestañas ---------------- */

test('Dos pestañas: lo que guarda una no lo pisa la otra, y la otra se entera', async ({ context, page }) => {
  await open(page);
  await seed(page);
  const other = await context.newPage();
  await setup(other);
  await open(other, '#/libro/b0');
  // La pestaña A guarda una sesión; la B (con la ficha abierta desde antes) cambia el libro
  await page.evaluate(() => LK.db.saveSession({ id: 'desde-A', bookId: 'b0', durationMinutes: 20 }));
  await other.evaluate(async () => {
    const b = await LK.db.getBook('b0');
    await LK.db.saveBook({ ...b, rating: 5 });
  });
  const raw = await rawIdb(page);
  expect(raw.sessions.map((s) => s.id)).toContain('desde-A');
  expect(raw.books.find((b) => b.id === 'b0').rating).toBe(5);
  // La pestaña B recibe el aviso de cambios
  await expect.poll(() => other.evaluate(() => window.__lkExternalChanges || 0)).toBeGreaterThan(0);
});

/* ---------------- Sincronización ---------------- */

async function device(browser, server, name) {
  const context = await browser.newContext({ serviceWorkers: 'block', baseURL: 'http://localhost:4173' });
  await server.attach(context);
  const page = await context.newPage();
  await setup(page);
  await open(page);
  page.__name = name;
  return { context, page };
}

test('Sincronización entre dos dispositivos con datos propios: no se pierde nada y los borrados viajan', async ({ browser }) => {
  const server = fakeSyncServer();
  const A = await device(browser, server, 'A');
  const B = await device(browser, server, 'B');
  await seed(A.page, { books: 3, audioSessions: 2 });
  await B.page.evaluate(async () => {
    await LK.db.saveBook({ id: 'deB', title: 'Solo en B', format: 'audio' });
    await LK.db.saveSession({ id: 'sesB', bookId: 'deB', durationMinutes: 60 });
  });
  const code = await A.page.evaluate((url) => LK.sync.create(url), server.url);
  await B.page.evaluate(({ url, code }) => LK.sync.connect(url, code), { url: server.url, code });
  await A.page.evaluate(() => LK.sync.syncNow());
  for (const d of [A, B]) expect(await counts(d.page)).toEqual({ books: 4, sessions: 3 });
  // Un borrado en A llega a B
  await A.page.evaluate(() => LK.db.deleteBook('b1'));
  await A.page.evaluate(() => LK.sync.syncNow());
  await B.page.evaluate(() => LK.sync.syncNow());
  expect((await B.page.evaluate(() => LK.db.getBooks())).map((b) => b.id).sort()).toEqual(['b0', 'b2', 'deB']);
  await A.context.close();
  await B.context.close();
});

test('Sincronización: una sesión guardada mientras se sincroniza no se pierde', async ({ browser }) => {
  const server = fakeSyncServer();
  const A = await device(browser, server, 'A');
  const B = await device(browser, server, 'B');
  await seed(A.page);
  const code = await A.page.evaluate((url) => LK.sync.create(url), server.url);
  await B.page.evaluate(({ url, code }) => LK.sync.connect(url, code), { url: server.url, code });
  await B.page.evaluate(() => LK.db.saveBook({ id: 'nuevoB', title: 'Nuevo en B' }));
  await B.page.evaluate(() => LK.sync.syncNow());
  // A descarga despacio; mientras tanto termina una sesión de audio
  server.delayGet = 1500;
  const syncing = A.page.evaluate(() => LK.sync.syncNow());
  await A.page.waitForTimeout(400);
  await A.page.evaluate(() => LK.db.saveSession({ id: 'en-medio', bookId: 'b0', durationMinutes: 33 }));
  await syncing;
  server.delayGet = 0;
  expect((await rawIdb(A.page)).sessions.map((s) => s.id)).toContain('en-medio');
  expect((await rawIdb(A.page)).books.map((b) => b.id)).toContain('nuevoB');
  // Y acaba llegando al otro dispositivo
  await A.page.evaluate(() => LK.sync.syncNow());
  await B.page.evaluate(() => LK.sync.syncNow());
  expect((await rawIdb(B.page)).sessions.map((s) => s.id)).toContain('en-medio');
  await A.context.close();
  await B.context.close();
});

test('Sincronización: si el servidor devuelve algo corrupto o una copia vacía, no se toca lo local', async ({ browser }) => {
  const server = fakeSyncServer();
  const A = await device(browser, server, 'A');
  await seed(A.page);
  await A.page.evaluate((url) => LK.sync.create(url), server.url);
  const [key] = [...server.mem.keys()];
  // Corrupto
  const rec = JSON.parse(server.mem.get(key));
  server.mem.set(key, JSON.stringify({ ...rec, rev: rec.rev + 1, data: 'lk1.basura' }));
  await A.page.evaluate(() => LK.sync.syncNow());
  expect(await counts(A.page)).toEqual({ books: 3, sessions: 2 });
  expect(await A.page.evaluate(() => LK.sync.info().state)).toBe('error');
  // Copia válida pero vacía (otro dispositivo recién instalado): se fusiona, no se borra nada
  const empty = await A.page.evaluate(() => LK.sync._encryptForTest({ app: 'lorekeeper', schema: 3, books: [], sessions: [], quotes: [], tombstones: {} }));
  server.mem.set(key, JSON.stringify({ ...rec, rev: rec.rev + 2, data: empty }));
  await A.page.evaluate(() => LK.sync.syncNow());
  expect(await counts(A.page)).toEqual({ books: 3, sessions: 2 });
  await A.context.close();
});

test('Sincronización: si el servidor perdió un cambio sin cambiar de versión, se detecta y se repara', async ({ browser }) => {
  const server = fakeSyncServer();
  const A = await device(browser, server, 'A');
  await seed(A.page);
  await A.page.evaluate((url) => LK.sync.create(url), server.url);
  const [key] = [...server.mem.keys()];
  const before = server.mem.get(key);
  await A.page.evaluate(() => LK.db.saveSession({ id: 'perdida-en-kv', bookId: 'b0', durationMinutes: 10 }));
  await A.page.evaluate(() => LK.sync.syncNow());
  // Simula Cloudflare KV: otra escritura simultánea dejó la versión con el mismo número pero sin el cambio
  const after = JSON.parse(server.mem.get(key));
  server.mem.set(key, JSON.stringify({ ...JSON.parse(before), rev: after.rev }));
  await A.page.evaluate(() => LK.sync.syncNow({ full: true }));
  const remote = await A.page.evaluate(async (data) => LK.sync._decryptForTest(data), JSON.parse(server.mem.get(key)).data);
  expect(remote.sessions.map((s) => s.id)).toContain('perdida-en-kv');
  await A.context.close();
});

/* ---------------- Service worker y avisos ---------------- */

test('El service worker no borra las cachés de otras apps del mismo dominio', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow', baseURL: 'http://localhost:4173' });
  const page = await context.newPage();
  await setup(page);
  await page.goto('/index.html');
  await page.evaluate(async () => {
    await caches.open('vinilos-v7');
    await caches.open('lk-v1');
  });
  await page.reload();
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', null, { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => caches.keys()), { timeout: 10000 }).not.toContain('lk-v1');
  expect(await page.evaluate(() => caches.keys())).toContain('vinilos-v7');
  await context.close();
});

test('Ajustes muestra si el almacenamiento está protegido', async ({ page }) => {
  await open(page, '#/ajustes');
  await expect(page.locator('#storage-persist')).toBeVisible();
});

test('En Safari de iPhone sin instalar, avisa de que la app instalada guarda los datos aparte', async ({ page }) => {
  await open(page);
  await seed(page, { books: 1, audioSessions: 0 });
  await page.reload();
  await waitReady(page);
  await expect(page.locator('#view')).toContainText('pantalla de inicio guarda sus datos aparte');
});

test('Los datos guardados por la versión anterior se abren igual y se hace la copia diaria', async ({ page }) => {
  // Escribe directamente en IndexedDB, como lo dejó la versión publicada antes de este cambio
  await page.goto('/tests/blank.html');
  await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('lorekeeper', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const [n, k] of Object.entries({ books: 'id', sessions: 'id', quotes: 'id', covers: 'bookId', meta: 'id' })) db.createObjectStore(n, { keyPath: k });
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const t = db.transaction(['books', 'sessions', 'meta'], 'readwrite');
          t.objectStore('books').put({ id: 'viejo', title: 'Drácula', format: 'audio', totalMinutes: 900, status: 'reading', updatedAt: 1 });
          t.objectStore('sessions').put({ id: 'sv', bookId: 'viejo', durationMinutes: 20, date: '2026-10-01', createdAt: 2 });
          t.objectStore('meta').put({ id: 'profile', name: 'Mamá', achSeen: ['first'] });
          t.objectStore('meta').put({ id: 'tombstones', items: { borrado: 3 } });
          t.oncomplete = () => (db.close(), resolve());
        };
      })
  );
  await open(page);
  expect(await counts(page)).toEqual({ books: 1, sessions: 1 });
  expect((await page.evaluate(() => LK.db.getProfile())).name).toBe('Mamá');
  await expect.poll(() => page.evaluate(async () => (await LK.db.listSnapshots()).map((s) => s.reason))).toEqual(['Copia diaria']);
  await expect(page.locator('#view')).toContainText('Drácula');
});
