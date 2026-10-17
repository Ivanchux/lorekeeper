// Utilidades comunes de las pruebas de pérdida de datos.
import { expect } from '@playwright/test';
import { handle } from '../backend/core.js';

/**
 * Script que se inyecta antes de cargar la app. Permite simular fallos de IndexedDB
 * guardando en localStorage la clave `__idbFault`:
 *   { delay: ms }            la apertura tarda ese tiempo (Safari al volver a la app)
 *   { failTimes: n }         las n primeras aperturas fallan
 *   { always: true }         nunca se abre
 *   { txFailTimes: n }       las n primeras transacciones fallan como «conexión perdida»
 */
export const FAULT_SCRIPT = `(() => {
  const read = () => { try { return JSON.parse(localStorage.getItem('__idbFault')); } catch { return null; } };
  const realOpen = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...args) {
    const cfg = read();
    if (!cfg || (!cfg.delay && !cfg.failTimes && !cfg.always)) return realOpen.apply(this, args);
    window.__idbOpens = (window.__idbOpens || 0) + 1;
    const n = window.__idbOpens;
    const fake = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: undefined, error: null, readyState: 'pending' };
    const fail = cfg.always || (cfg.failTimes && n <= cfg.failTimes);
    const factory = this;
    setTimeout(() => {
      if (fail) {
        fake.error = new DOMException('Fallo simulado', 'UnknownError');
        fake.readyState = 'done';
        fake.onerror && fake.onerror({ target: fake });
        return;
      }
      const r = realOpen.apply(factory, args);
      r.onupgradeneeded = (e) => { fake.result = r.result; fake.onupgradeneeded && fake.onupgradeneeded(e); };
      r.onsuccess = (e) => { fake.result = r.result; fake.readyState = 'done'; fake.onsuccess && fake.onsuccess(e); };
      r.onerror = (e) => { fake.error = r.error; fake.onerror && fake.onerror(e); };
      r.onblocked = (e) => { fake.onblocked && fake.onblocked(e); };
    }, fail ? 30 : cfg.delay || 0);
    return fake;
  };
  const realTx = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const cfg = read();
    if (cfg && cfg.txFailTimes) {
      window.__idbTx = (window.__idbTx || 0) + 1;
      if (window.__idbTx <= cfg.txFailTimes) throw new DOMException('The database connection is closing.', 'InvalidStateError');
    }
    return realTx.apply(this, args);
  };
})();`;

export async function setup(page) {
  await page.addInitScript(FAULT_SCRIPT);
  // Sin pantalla de bienvenida
  await page.addInitScript(() => {
    if (!localStorage.getItem('lk-prefs')) localStorage.setItem('lk-prefs', JSON.stringify({ onboarded: true }));
  });
}

/** Abre la app y espera a que termine de arrancar. */
export async function open(page, hash = '#/biblioteca/all') {
  await page.goto('/index.html' + hash);
  await waitReady(page);
}

export async function waitReady(page, timeout = 30000) {
  await page.waitForFunction(
    () =>
      ['ready', 'error'].includes(document.documentElement.dataset.lkBoot) ||
      // versiones anteriores de la app (sin la marca): adaptador elegido y pantalla pintada
      (!('lkBoot' in document.documentElement.dataset) && window.LK?.db?.adapterName?.() !== '—' && !!document.querySelector('#view > :not(noscript)')),
    null,
    { timeout }
  );
}

export async function setFault(page, cfg) {
  await page.evaluate((c) => (c ? localStorage.setItem('__idbFault', JSON.stringify(c)) : localStorage.removeItem('__idbFault')), cfg);
}

/** Crea libros y sesiones de prueba con la API de la app. */
export async function seed(page, { books = 3, audioSessions = 2 } = {}) {
  return page.evaluate(
    async ({ books, audioSessions }) => {
      const out = [];
      for (let i = 0; i < books; i++) {
        const b = await LK.db.saveBook({ id: `b${i}`, title: `Libro ${i}`, author: 'Autora', format: i === 0 ? 'audio' : 'paper', totalMinutes: i === 0 ? 600 : 0, totalPages: 300, status: 'reading' });
        out.push(b.id);
      }
      for (let i = 0; i < audioSessions; i++) {
        await LK.db.saveSession({ id: `s${i}`, bookId: 'b0', durationMinutes: 30 + i, date: LK.util.isoDate() });
      }
      return out;
    },
    { books, audioSessions }
  );
}

export const counts = (page) =>
  page.evaluate(async () => ({ books: (await LK.db.getBooks()).length, sessions: (await LK.db.getSessions()).length }));

/** Lee directamente IndexedDB (sin pasar por la app) para comprobar lo que hay guardado de verdad. */
export const rawIdb = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('lorekeeper');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const names = [...db.objectStoreNames].filter((n) => n !== 'covers');
          const t = db.transaction(names, 'readonly');
          const out = {};
          names.forEach((n) => (t.objectStore(n).getAll().onsuccess = (e) => (out[n] = e.target.result)));
          t.oncomplete = () => {
            db.close();
            resolve(out);
          };
        };
      })
  );

export const lsDbKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('lk-db-')));

/**
 * Servidor de sincronización falso dentro de la prueba: usa el mismo núcleo que el de verdad
 * (backend/core.js), con la memoria compartida entre «dispositivos».
 */
export function fakeSyncServer() {
  const mem = new Map();
  const store = { get: async (k) => mem.get(k) ?? null, put: async (k, v) => void mem.set(k, v), delete: async (k) => void mem.delete(k) };
  const server = {
    url: 'https://sync.test',
    mem,
    delayGet: 0,
    async attach(context) {
      await context.route('https://sync.test/**', async (route) => {
        const r = route.request();
        if (server.delayGet && r.method() === 'GET' && !r.url().includes('meta=1')) await new Promise((res) => setTimeout(res, server.delayGet));
        const headers = r.headers();
        const req = new Request(r.url(), { method: r.method(), headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(r.method()) ? undefined : r.postData() });
        const res = await handle(req, store, {});
        await route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: await res.text() });
      });
    },
  };
  return server;
}

export { expect };
