/* ==========================================================
   CAPA DE DATOS  (LK.db)
   El resto de la app solo habla con estas funciones.
   Debajo hay un "adaptador" intercambiable:
     - IndexedDB (normal)
     - localStorage (solo si el navegador no tiene IndexedDB)
   La sincronización con el servidor propio (js/sync.js) se
   engancha a `onChange` sin tocar las vistas.

   REGLAS PARA NO PERDER DATOS
   - Si IndexedDB tarda o falla al arrancar, se reintenta. Si no
     abre, la app avisa y no escribe nada: nunca arranca vacía.
   - Si Safari corta la conexión a mitad (pasa al volver a la app),
     se reconecta y se repite la operación.
   - Las operaciones que tocan muchos datos (restaurar, borrar todo,
     sincronizar) van en UNA transacción que lee lo que hay en ese
     momento, así nunca se escribe encima una foto vieja.
   - Antes de cada cambio grande se guarda una copia automática en
     el propio dispositivo, y una al día. Se recuperan desde Ajustes.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  const DB_NAME = 'lorekeeper';
  const DB_VERSION = 1;
  const SCHEMA = 3; // versión del formato de exportación

  /** Almacenes y su clave primaria. */
  const STORES = { books: 'id', sessions: 'id', quotes: 'id', covers: 'bookId', meta: 'id' };
  /** Los que viajan en las copias de seguridad (las portadas se vuelven a descargar). */
  const BACKUP_STORES = ['books', 'sessions', 'quotes'];
  /** Almacenes que se leen y escriben juntos en las operaciones grandes. */
  const DATA_STORES = ['books', 'sessions', 'quotes', 'meta'];

  const SNAP_PREFIX = 'snap:';
  const SNAP_MAX = 10;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- Adaptador IndexedDB ---------------- */

  /** Errores de «conexión perdida» de Safari: se puede reconectar y repetir. */
  const RETRYABLE = new Set(['InvalidStateError', 'UnknownError', 'TransactionInactiveError']);

  function idbAdapter() {
    let conn = null; // Promise<IDBDatabase>

    /** Un intento de abrir la base de datos. */
    function openOnce() {
      return new Promise((resolve, reject) => {
        let req;
        try {
          req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (err) {
          return reject(err);
        }
        req.onupgradeneeded = () => {
          const db = req.result;
          // Solo crea lo que falte: nunca borra almacenes ni datos
          for (const [name, keyPath] of Object.entries(STORES)) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          // Otra pestaña con una versión nueva necesita actualizar la base: se cede la conexión
          db.onversionchange = () => {
            db.close();
            conn = null;
          };
          db.onclose = () => {
            conn = null;
          };
          resolve(db);
        };
        req.onerror = () => reject(req.error || new Error('No se pudo abrir IndexedDB'));
        // Otra pestaña antigua la tiene abierta: se espera (no es un fallo)
        req.onblocked = () => db.onBlocked?.();
      });
    }

    /**
     * Abre con paciencia: varios intentos durante `total` ms. Un intento lento no se
     * abandona (puede llegar tarde); se lanza otro en paralelo y gana el primero.
     */
    async function connect(total = 20000) {
      const started = Date.now();
      let pending = [];
      let lastErr = null;
      let attempt = 0;
      while (Date.now() - started < total) {
        const p = openOnce();
        p.catch(() => {});
        pending.push(p);
        const step = Math.max(500, Math.min(7000, total - (Date.now() - started)));
        let timer;
        const winner = await Promise.race([
          ...pending.map((q) => q.then((db) => ({ db, q }), (err) => ({ err, q }))),
          new Promise((r) => (timer = setTimeout(() => r({ timeout: true }), step))),
        ]);
        clearTimeout(timer);
        if (winner.db) {
          // Los intentos que lleguen después se cierran
          pending.filter((q) => q !== winner.q).forEach((q) => q.then((d) => d.close(), () => {}));
          return winner.db;
        }
        if (winner.err) {
          lastErr = winner.err;
          pending = pending.filter((q) => q !== winner.q);
          await sleep(Math.min(3000, 300 * 2 ** attempt));
        }
        attempt++;
      }
      pending.forEach((q) => q.then((d) => d.close(), () => {}));
      throw lastErr || new Error('IndexedDB no responde');
    }

    const getDb = () => (conn ||= connect().catch((err) => {
      conn = null;
      throw err;
    }));

    /** Ejecuta fn(db) y, si Safari cortó la conexión, reconecta y lo repite una vez. */
    async function run(fn) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await fn(await getDb());
        } catch (err) {
          if (attempt >= 2 || !RETRYABLE.has(err?.name)) throw err;
          console.warn('IndexedDB: conexión perdida, se reconecta', err);
          try {
            (await conn)?.close();
          } catch {}
          conn = null;
          await sleep(150 * (attempt + 1));
        }
      }
    }

    const tx = (stores, mode, fn) =>
      run(
        (db) =>
          new Promise((resolve, reject) => {
            const t = db.transaction(stores, mode); // si la conexión está cerrada, lanza InvalidStateError
            const ctx = { result: undefined, error: null };
            try {
              fn(t, ctx);
            } catch (err) {
              ctx.error = err;
              try {
                t.abort();
              } catch {}
            }
            t.oncomplete = () => resolve(ctx.result);
            t.onerror = t.onabort = () => reject(ctx.error || t.error || new Error('Operación cancelada'));
          })
      );

    const single = (stores, mode, makeReq) =>
      tx(stores, mode, (t, ctx) => {
        const req = makeReq(t);
        if (req) req.onsuccess = () => (ctx.result = req.result);
      });

    const snapRange = () => IDBKeyRange.bound(SNAP_PREFIX, SNAP_PREFIX + '￿');

    return {
      name: 'IndexedDB',
      ready: () => getDb(),
      all: (s) => single(s, 'readonly', (t) => t.objectStore(s).getAll()),
      get: (s, key) => single(s, 'readonly', (t) => t.objectStore(s).get(key)),
      put: (s, value) => single(s, 'readwrite', (t) => t.objectStore(s).put(value)),
      putMany: (s, values) =>
        tx(s, 'readwrite', (t) => {
          const st = t.objectStore(s);
          values.forEach((v) => st.put(v));
        }),
      del: (s, key) => single(s, 'readwrite', (t) => t.objectStore(s).delete(key)),
      clear: (s) => single(s, 'readwrite', (t) => t.objectStore(s).clear()),
      snapshots: () => single('meta', 'readonly', (t) => t.objectStore('meta').getAll(snapRange())),

      /**
       * Lee libros, sesiones, citas, perfil y lápidas, llama a fn(local) y aplica lo que
       * devuelva ({ put: [[almacén, valor]], del: [[almacén, clave]], result }), todo en
       * la MISMA transacción: nadie puede escribir entre la lectura y la escritura.
       * fn tiene que ser síncrona.
       */
      atomic: (fn, mode = 'readwrite') =>
        tx(DATA_STORES, mode, (t, ctx) => {
          const local = {};
          let left = 6;
          const got = (req, key) => {
            req.onsuccess = () => {
              local[key] = req.result;
              if (--left) return;
              local.tombstones = local.tombRec?.items || {};
              try {
                const ops = fn(local) || {};
                (ops.put || []).forEach(([s, v]) => t.objectStore(s).put(v));
                (ops.del || []).forEach(([s, k]) => t.objectStore(s).delete(k));
                ctx.result = ops.result;
              } catch (err) {
                ctx.error = err;
                t.abort();
              }
            };
          };
          got(t.objectStore('books').getAll(), 'books');
          got(t.objectStore('sessions').getAll(), 'sessions');
          got(t.objectStore('quotes').getAll(), 'quotes');
          got(t.objectStore('meta').get('profile'), 'profile');
          got(t.objectStore('meta').get('tombstones'), 'tombRec');
          got(t.objectStore('meta').getAllKeys(snapRange()), 'snapKeys');
        }),
    };
  }

  /* ---------------- Adaptador localStorage (solo navegadores sin IndexedDB) ---------------- */

  function lsAdapter() {
    const mem = {}; // si localStorage también falla, al menos funciona en memoria
    const key = (s) => `lk-db-${s}`;
    const read = (s) => {
      try {
        return JSON.parse(localStorage.getItem(key(s))) || mem[s] || {};
      } catch {
        return mem[s] || {};
      }
    };
    const write = (s, obj) => {
      mem[s] = obj;
      try {
        localStorage.setItem(key(s), JSON.stringify(obj));
      } catch (err) {
        console.warn('localStorage lleno o bloqueado', err);
      }
    };
    const index = (s, values) => Object.fromEntries(values.map((v) => [v[STORES[s]], v]));
    const isSnap = (k) => String(k).startsWith(SNAP_PREFIX);
    return {
      name: 'localStorage',
      ready: async () => {},
      all: async (s) => Object.values(read(s)),
      get: async (s, k) => read(s)[k],
      put: async (s, v) => {
        if (s === 'covers') return; // los Blobs no caben en JSON
        const obj = read(s);
        obj[v[STORES[s]]] = v;
        write(s, obj);
      },
      putMany: async (s, values) => {
        if (s === 'covers') return;
        write(s, { ...read(s), ...index(s, values) });
      },
      del: async (s, k) => {
        const obj = read(s);
        delete obj[k];
        write(s, obj);
      },
      clear: async (s) => write(s, {}),
      snapshots: async () => Object.values(read('meta')).filter((r) => isSnap(r.id)),
      atomic: async (fn) => {
        const meta = read('meta');
        const local = {
          books: Object.values(read('books')),
          sessions: Object.values(read('sessions')),
          quotes: Object.values(read('quotes')),
          profile: meta.profile,
          tombstones: meta.tombstones?.items || {},
          snapKeys: Object.keys(meta).filter(isSnap).sort(),
        };
        const ops = fn(local) || {};
        const touched = {};
        const get = (s) => (touched[s] ||= read(s));
        (ops.put || []).forEach(([s, v]) => s !== 'covers' && (get(s)[v[STORES[s]]] = v));
        (ops.del || []).forEach(([s, k]) => delete get(s)[k]);
        Object.entries(touched).forEach(([s, obj]) => write(s, obj));
        return ops.result;
      },
    };
  }

  let A = null; // adaptador activo

  /* ---------------- Cambios (para sincronizar, recalcular logros y avisar a otras pestañas) ---------------- */

  const listeners = new Set();
  const externalListeners = new Set();
  let channel = null;
  try {
    channel = 'BroadcastChannel' in window ? new BroadcastChannel('lk-db') : null;
    if (channel) channel.onmessage = (e) => externalListeners.forEach((fn) => fn(e.data?.reason));
  } catch {
    channel = null;
  }

  function emit(reason, opts = {}) {
    // Las demás pestañas o ventanas de la app se enteran siempre, aunque el cambio sea «silencioso»
    try {
      channel?.postMessage({ reason });
    } catch {}
    if (opts.silent) return;
    // Aviso asíncrono: nunca bloquea el guardado
    queueMicrotask(() => listeners.forEach((fn) => { try { fn(reason); } catch (e) { console.error(e); } }));
  }

  /* ---------------- Fusión (sincronización y recuperación) ---------------- */

  /** Momento que decide qué copia de un registro gana. `restoredAt` lo pone «restaurar copia». */
  const bookStamp = (x) => Math.max(x.updatedAt || 0, x.restoredAt || 0);
  const itemStamp = (x) => Math.max(x.createdAt || 0, x.restoredAt || 0);

  /** Fusiona dos copias completas. Gana el registro modificado más tarde; un borrado posterior gana. */
  function mergeData(a, b) {
    const tombstones = { ...(a.tombstones || {}) };
    for (const [id, ts] of Object.entries(b.tombstones || {})) tombstones[id] = Math.max(tombstones[id] || 0, ts);

    const union = (xs = [], ys = [], stamp) => {
      const map = new Map();
      for (const item of [...xs, ...ys]) {
        if (!item || item.id == null) continue;
        const cur = map.get(item.id);
        if (!cur || stamp(item) > stamp(cur)) map.set(item.id, item);
      }
      return [...map.values()].filter((item) => !(tombstones[item.id] && tombstones[item.id] >= stamp(item)));
    };

    const books = union(a.books, b.books, bookStamp);
    const alive = new Set(books.map((x) => x.id));
    const sessions = union(a.sessions, b.sessions, itemStamp).filter((s) => alive.has(s.bookId));
    const quotes = union(a.quotes, b.quotes, itemStamp).filter((q) => alive.has(q.bookId));

    const pa = a.profile || {};
    const pb = b.profile || {};
    const newer = (pa.updatedAt || 0) >= (pb.updatedAt || 0) ? pa : pb;
    const seen = pa.achSeen || pb.achSeen ? [...new Set([...(pa.achSeen || []), ...(pb.achSeen || [])])] : null;
    const profile = { ...pb, ...pa, ...newer, achSeen: seen, id: 'profile' };

    return { app: 'lorekeeper', schema: Math.max(a.schema || 0, b.schema || 0, SCHEMA), exportedAt: new Date().toISOString(), profile, books, sessions, quotes, tombstones };
  }

  /** Operaciones para dejar `local` igual que `target` (solo lo que cambia). */
  function diffOps(local, target) {
    const put = [];
    const del = [];
    let removed = 0;
    for (const s of BACKUP_STORES) {
      const before = new Map((local[s] || []).map((x) => [x.id, x]));
      const after = new Map((target[s] || []).map((x) => [x.id, x]));
      for (const [id, x] of after) if (before.get(id) !== x && JSON.stringify(before.get(id)) !== JSON.stringify(x)) put.push([s, x]);
      for (const id of before.keys()) {
        if (!after.has(id)) {
          del.push([s, id]);
          removed++;
        }
      }
    }
    const profile = { ...(target.profile || {}), id: 'profile' };
    if (JSON.stringify(profile) !== JSON.stringify(local.profile || null)) put.push(['meta', profile]);
    const items = target.tombstones || {};
    if (JSON.stringify(items) !== JSON.stringify(local.tombstones || {})) put.push(['meta', { id: 'tombstones', items }]);
    return { put, del, removed };
  }

  /* ---------------- Copias automáticas en el dispositivo ---------------- */

  const DEFAULT_PROFILE = {
    id: 'profile',
    name: 'Lector',
    yearlyGoal: 12,
    dailyGoal: { type: 'minutes', value: 20 }, // type: 'minutes' | 'pages'; value 0 = sin meta
    achSeen: null,                              // logros ya avisados (null = aún no se ha calculado)
  };

  /** Operaciones para guardar una copia de `local` (y olvidar las más viejas). */
  function snapshotOps(local, reason) {
    const now = Date.now();
    const id = SNAP_PREFIX + String(now).padStart(14, '0');
    const data = {
      app: 'lorekeeper',
      schema: SCHEMA,
      exportedAt: new Date(now).toISOString(),
      profile: { ...DEFAULT_PROFILE, ...(local.profile || {}) },
      books: local.books || [],
      sessions: local.sessions || [],
      quotes: local.quotes || [],
      tombstones: local.tombstones || {},
    };
    const rec = { id, createdAt: now, reason, counts: { books: data.books.length, sessions: data.sessions.length, quotes: data.quotes.length }, data };
    const keys = [...(local.snapKeys || [])].sort();
    const old = keys.slice(0, Math.max(0, keys.length + 1 - SNAP_MAX));
    return { put: [['meta', rec]], del: old.map((k) => ['meta', k]) };
  }

  const hasData = (local) => (local.books || []).length + (local.sessions || []).length + (local.quotes || []).length > 0;

  /* ---------------- API pública ---------------- */

  const db = {};

  db.onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  /** Cambios hechos en OTRA pestaña o ventana de la app. */
  db.onExternalChange = (fn) => {
    externalListeners.add(fn);
    return () => externalListeners.delete(fn);
  };

  /**
   * Elige el adaptador. Se llama una vez al arrancar.
   * localStorage solo se usa si el navegador no tiene IndexedDB. Si IndexedDB existe pero
   * no abre, lanza un error con `boot = true`: la app avisa y no escribe nada en ningún sitio.
   */
  db.init = async () => {
    if (!('indexedDB' in window) || !window.indexedDB) {
      console.warn('Este navegador no tiene IndexedDB: se usa localStorage');
      A = lsAdapter();
    } else {
      const idb = idbAdapter();
      try {
        await idb.ready();
        // Comprueba que de verdad se puede leer
        await idb.get('meta', 'profile');
      } catch (err) {
        console.error('IndexedDB no se pudo abrir', err);
        const e = new Error('No se ha podido abrir tu biblioteca en este dispositivo.');
        e.boot = true;
        e.cause = err;
        throw e;
      }
      A = idb;
    }
    // Pide al navegador que no borre los datos si se queda sin espacio
    db.persisted = await db.requestPersist();
    return A.name;
  };

  /** Pide almacenamiento persistente. Devuelve true si el navegador lo concede. */
  db.requestPersist = async () => {
    try {
      if (await navigator.storage?.persisted?.()) return (db.persisted = true);
      return (db.persisted = (await navigator.storage?.persist?.()) ?? false);
    } catch {
      return (db.persisted = false);
    }
  };

  db.adapterName = () => (A ? A.name : '—');

  /* ---------- Lápidas (borrados) ----------
     Para que al sincronizar dos dispositivos un libro borrado no
     "resucite", se recuerda qué ids se borraron y cuándo. Ocupan muy
     poco (un id y una fecha), así que se guardan 5 años: un móvil que
     pase meses sin sincronizar tampoco resucita nada. */

  const TOMB_KEEP_MS = 5 * 365 * 86400000;
  const pruneTombs = (items, now = Date.now()) => {
    for (const [id, ts] of Object.entries(items)) if (now - ts > TOMB_KEEP_MS) delete items[id];
    return items;
  };
  db.getTombstones = async () => ((await A.get('meta', 'tombstones')) || { items: {} }).items || {};
  async function addTombs(ids) {
    const items = await db.getTombstones();
    const now = Date.now();
    ids.forEach((id) => (items[id] = now));
    await A.put('meta', { id: 'tombstones', items: pruneTombs(items, now) });
  }


  /* ---------- Libros ---------- */

  const bookDefaults = () => ({
    title: 'Sin título',
    author: '',
    coverUrl: '',
    totalPages: 0,
    readPages: 0,
    totalMinutes: 0,      // duración del audiolibro
    publisher: '',        // editorial
    listenPos: null,      // audiolibro: dónde vas (minutos de libro); null = se calcula con las sesiones
    speed: 1,             // audiolibro: velocidad habitual
    status: 'wishlist',   // 'reading' | 'wishlist' | 'completed' | 'abandoned'
    format: 'paper',      // 'paper' | 'ebook' | 'audio'
    genres: [],
    tags: [],
    series: '',
    seriesNo: null,
    loan: null,           // { dir:'lent'|'borrowed', person, date, due }
    statOverride: null,
    rating: null,
    review: '',
    description: '',
    year: '',
    isbn: '',
    source: 'manual',
    imported: false,      // viene de un archivo: no da bonus de EXP
    dateAdded: u.isoDate(),
    dateStarted: null,
    dateCompleted: null,
    lastReadAt: null,
  });

  db.getBooks = () => A.all('books');
  db.getBook = (id) => A.get('books', id);

  /** Guarda un libro nuevo o actualiza uno existente. */
  db.saveBook = async (book, opts) => {
    const record = { ...bookDefaults(), ...book, updatedAt: Date.now() };
    await A.put('books', record);
    emit('book', opts);
    return record;
  };

  /** Guarda muchos libros de golpe (importación). */
  db.saveBooks = async (books, opts) => {
    const now = Date.now();
    const records = books.map((b) => ({ ...bookDefaults(), ...b, updatedAt: now }));
    await A.putMany('books', records);
    emit('books', opts);
    return records;
  };

  /** Borra el libro y todo lo que cuelga de él. */
  db.deleteBook = async (id) => {
    const [sessions, quotes] = await Promise.all([A.all('sessions'), A.all('quotes')]);
    const mySessions = sessions.filter((s) => s.bookId === id);
    const myQuotes = quotes.filter((q) => q.bookId === id);
    await addTombs([id, ...mySessions.map((s) => s.id), ...myQuotes.map((q) => q.id)]);
    await Promise.all([
      ...mySessions.map((s) => A.del('sessions', s.id)),
      ...myQuotes.map((q) => A.del('quotes', q.id)),
      A.del('covers', id),
      A.del('books', id),
    ]);
    revokeCover(id);
    emit('book-deleted');
  };

  /* ---------- Sesiones de lectura ---------- */

  db.getSessions = () => A.all('sessions');
  db.getSessionsByBook = async (bookId) =>
    (await A.all('sessions')).filter((s) => s.bookId === bookId).sort((a, b) => b.createdAt - a.createdAt);

  db.saveSession = async (session) => {
    const record = {
      id: u.uid('ses'),
      date: u.isoDate(),
      startPage: 0,
      endPage: 0,
      pagesRead: 0,
      durationMinutes: 0,
      createdAt: Date.now(),
      ...session,
    };
    await A.put('sessions', record);
    emit('session');
    return record;
  };

  db.deleteSession = async (id) => {
    await addTombs([id]);
    await A.del('sessions', id);
    emit('session-deleted');
  };

  /* ---------- Citas y notas ---------- */

  db.getQuotes = () => A.all('quotes');
  db.getQuotesByBook = async (bookId) =>
    (await A.all('quotes')).filter((q) => q.bookId === bookId).sort((a, b) => b.createdAt - a.createdAt);

  db.saveQuote = async (quote) => {
    const record = { id: u.uid('q'), date: u.isoDate(), page: null, text: '', note: '', createdAt: Date.now(), ...quote };
    await A.put('quotes', record);
    emit('quote');
    return record;
  };

  db.deleteQuote = async (id) => {
    await addTombs([id]);
    await A.del('quotes', id);
    emit('quote-deleted');
  };

  /* ---------- Portadas ---------- */
  // Se intenta guardar cada portada como Blob para verla sin conexión.
  // Solo funciona con servidores que permiten CORS (Open Library sí,
  // Google Books no). Si falla, se usa la URL remota y, servida por
  // http, el Service Worker la guarda en su caché.

  const coverURLs = new Map();

  function revokeCover(bookId) {
    const url = coverURLs.get(bookId);
    if (url) URL.revokeObjectURL(url);
    coverURLs.delete(bookId);
  }

  db.cacheCover = async (bookId, url) => {
    if (!url || A.name !== 'IndexedDB') return false;
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) return false;
      const blob = await res.blob();
      if (!blob.type.startsWith('image/') || blob.size < 500) return false;
      await A.put('covers', { bookId, blob });
      revokeCover(bookId);
      return true;
    } catch {
      return false;
    }
  };

  /** Guarda una portada elegida a mano (Blob de imagen). */
  db.setCoverBlob = async (bookId, blob) => {
    await A.put('covers', { bookId, blob });
    revokeCover(bookId);
  };

  /** Olvida la portada guardada (p. ej. al cambiar la URL). */
  db.clearCover = async (bookId) => {
    await A.del('covers', bookId);
    revokeCover(bookId);
  };

  /** URL utilizable en <img>: portada guardada, si no la remota, si no ''. */
  db.coverSrc = async (book) => {
    if (coverURLs.has(book.id)) return coverURLs.get(book.id);
    try {
      const rec = await A.get('covers', book.id);
      if (rec?.blob) {
        const url = URL.createObjectURL(rec.blob);
        coverURLs.set(book.id, url);
        return url;
      }
    } catch {}
    return book.coverUrl || '';
  };

  /** Resuelve las portadas de una lista de libros: { [id]: src } */
  db.coverMap = async (books) => {
    const entries = await Promise.all(books.map(async (b) => [b.id, await db.coverSrc(b)]));
    return Object.fromEntries(entries);
  };

  /* ---------- Perfil y metas ---------- */

  db.getProfile = async () => ({ ...DEFAULT_PROFILE, ...((await A.get('meta', 'profile')) || {}) });
  db.saveProfile = async (patch, opts) => {
    const cur = await db.getProfile();
    // keepStamp: cambios automáticos (logros ya avisados) no deben ganar a los que hizo la persona
    const profile = { ...cur, ...patch, id: 'profile', updatedAt: opts?.keepStamp ? cur.updatedAt || 0 : Date.now() };
    await A.put('meta', profile);
    emit('profile', opts);
    return profile;
  };


  /* ---------- Copias de seguridad ---------- */

  /** Exporta todo a un objeto JSON (sin portadas, que se vuelven a descargar). Lectura coherente. */
  db.exportAll = async () =>
    A.atomic(
      (local) => ({
        result: {
          app: 'lorekeeper',
          schema: SCHEMA,
          exportedAt: new Date().toISOString(),
          profile: { ...DEFAULT_PROFILE, ...(local.profile || {}) },
          books: local.books,
          sessions: local.sessions,
          quotes: local.quotes,
          tombstones: local.tombstones,
        },
      }),
      'readonly'
    );

  /** Resumen de una copia (para mostrar al usuario antes de restaurarla). */
  db.summarize = (data) => ({
    books: (data?.books || []).length,
    sessions: (data?.sessions || []).length,
    quotes: (data?.quotes || []).length,
    exportedAt: data?.exportedAt || null,
  });

  db.isEmpty = async () => (await A.all('books')).length === 0 && (await A.all('sessions')).length === 0;

  /** Normaliza una copia (archivo, copia automática o servidor). Lanza si no es de LoreKeeper. */
  function normalize(data) {
    if (data?.app !== 'lorekeeper') throw new Error('El archivo no es una copia de LoreKeeper.');
    for (const s of BACKUP_STORES) if (data[s] != null && !Array.isArray(data[s])) throw new Error('La copia está dañada.');
    return {
      books: (data.books || []).filter((b) => b && b.id != null).map((b) => ({ ...bookDefaults(), ...b })),
      sessions: (data.sessions || []).filter(Boolean).map((s) => ({ createdAt: Date.now(), ...s, id: s.id || s.sessionId || u.uid('ses') })),
      quotes: (data.quotes || []).filter((q) => q && q.id != null).map((q) => ({ createdAt: Date.now(), ...q })),
      profile: { ...DEFAULT_PROFILE, ...(data.profile || {}), id: 'profile' },
      tombstones: data.tombstones && typeof data.tombstones === 'object' ? { ...data.tombstones } : {},
    };
  }

  /**
   * Restaura una copia: lo que hay ahora se sustituye por la copia, en una transacción.
   * Antes se guarda una copia automática de lo que había, para poder volver atrás.
   * Con la sincronización activa, lo restaurado gana a lo que haya en otros dispositivos.
   */
  db.importAll = async (data, opts = {}) => {
    const incoming = normalize(data);
    const now = Date.now();
    await A.atomic((local) => {
      const keep = new Set([...incoming.books, ...incoming.sessions, ...incoming.quotes].map((x) => x.id));
      const tombstones = { ...local.tombstones, ...incoming.tombstones };
      keep.forEach((id) => delete tombstones[id]);
      // Lo que había y no está en la copia queda marcado como borrado (para que otro dispositivo no lo devuelva)
      [...local.books, ...local.sessions, ...local.quotes].forEach((x) => !keep.has(x.id) && (tombstones[x.id] = now));
      const mark = (x) => ({ ...x, restoredAt: now });
      const target = {
        profile: { ...incoming.profile, updatedAt: now },
        books: incoming.books.map(mark),
        sessions: incoming.sessions.map(mark),
        quotes: incoming.quotes.map(mark),
        tombstones: pruneTombs(tombstones, now),
      };
      const ops = diffOps(local, target);
      const snap = hasData(local) ? snapshotOps(local, opts.reason || 'Antes de restaurar una copia') : { put: [], del: [] };
      return { put: [...snap.put, ...ops.put], del: [...snap.del, ...ops.del] };
    });
    // Vuelve a descargar portadas en segundo plano
    incoming.books.forEach((b) => db.cacheCover(b.id, b.coverUrl));
    emit('import', opts);
  };

  /**
   * Sincronización: fusiona la copia del servidor con lo que hay AHORA en el dispositivo,
   * en una sola transacción (si se ha guardado algo mientras se descargaba, se conserva).
   * Si la fusión quita algo de este dispositivo, antes se guarda una copia automática.
   * Devuelve la copia fusionada, que es la que se sube.
   */
  db.applyRemote = async (remote) => {
    const incoming = normalize(remote);
    const result = await A.atomic((local) => {
      const merged = mergeData(
        { profile: local.profile, books: local.books, sessions: local.sessions, quotes: local.quotes, tombstones: local.tombstones },
        { schema: remote.schema, ...incoming, profile: remote.profile ? incoming.profile : null }
      );
      const ops = diffOps(local, merged);
      const snap = ops.removed && hasData(local) ? snapshotOps(local, 'Antes de aplicar borrados de otro dispositivo') : { put: [], del: [] };
      const changed = ops.del.length > 0 || ops.put.length > 0;
      return { put: changed ? [...snap.put, ...ops.put] : [], del: changed ? [...snap.del, ...ops.del] : [], result: { merged, changed } };
    });
    if (result.changed) emit('sync', { silent: true });
    return result;
  };

  /** Guarda ahora una copia automática en el dispositivo. */
  db.snapshot = (reason = 'Copia manual') =>
    A.atomic((local) => (hasData(local) ? { ...snapshotOps(local, reason), result: true } : { result: false }));

  /** Copias automáticas guardadas, de la más reciente a la más antigua (sin los datos). */
  db.listSnapshots = async () =>
    (await A.snapshots())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ id, createdAt, reason, counts }) => ({ id, createdAt, reason, ...counts }));

  /** Vuelve a una copia automática (guardando antes otra de lo que hay ahora). */
  db.restoreSnapshot = async (id) => {
    const rec = await A.get('meta', id);
    if (!rec?.data) throw new Error('Esa copia ya no existe.');
    await db.importAll(rec.data, { reason: 'Antes de volver a una copia anterior' });
  };

  /** Una copia automática al día como mucho (al abrir la app). */
  db.dailySnapshot = async () => {
    const last = (await db.listSnapshots())[0];
    if (last && Date.now() - last.createdAt < 20 * 3600 * 1000) return false;
    return db.snapshot('Copia diaria');
  };

  /**
   * Versiones anteriores pasaban a localStorage si IndexedDB tardaba en abrir, y lo que se
   * apuntaba se quedaba allí sin verse. Aquí se fusiona con IndexedDB (gana lo más reciente),
   * se guarda antes una copia automática y el original se conserva con otro nombre.
   */
  db.recoverLocalStorage = async () => {
    if (A?.name !== 'IndexedDB') return 0;
    let found;
    try {
      const read = (s) => JSON.parse(localStorage.getItem(`lk-db-${s}`) || 'null');
      found = { books: read('books'), sessions: read('sessions'), quotes: read('quotes'), meta: read('meta') };
    } catch {
      return 0;
    }
    const keys = ['books', 'sessions', 'quotes', 'meta'].filter((s) => found[s]);
    if (!keys.length) return 0;
    const leftover = {
      app: 'lorekeeper',
      schema: SCHEMA,
      books: Object.values(found.books || {}),
      sessions: Object.values(found.sessions || {}),
      quotes: Object.values(found.quotes || {}),
      profile: found.meta?.profile || null,
      tombstones: found.meta?.tombstones?.items || {},
    };
    const n = leftover.books.length + leftover.sessions.length + leftover.quotes.length;
    if (n) {
      await db.snapshot('Antes de recuperar datos guardados aparte');
      await db.applyRemote(leftover);
    }
    // El original no se borra: se guarda con otro nombre y ya no se vuelve a fusionar
    const stamp = u.isoDate();
    for (const s of keys) {
      try {
        localStorage.setItem(`lk-respaldo-ls-${s}-${stamp}`, localStorage.getItem(`lk-db-${s}`));
        localStorage.removeItem(`lk-db-${s}`);
      } catch (err) {
        console.warn('No se pudo renombrar la copia de localStorage', err);
      }
    }
    if (n) emit('recover');
    return n;
  };

  /** Borra libros, sesiones, citas y perfil. Guarda antes una copia automática y recuerda los borrados. */
  db.wipeAll = async () => {
    const now = Date.now();
    await A.atomic((local) => {
      const snap = hasData(local) ? snapshotOps(local, 'Antes de borrar todo') : { put: [], del: [] };
      const tombstones = { ...local.tombstones };
      [...local.books, ...local.sessions, ...local.quotes].forEach((x) => (tombstones[x.id] = now));
      return {
        put: [...snap.put, ['meta', { id: 'tombstones', items: pruneTombs(tombstones, now) }]],
        del: [
          ...snap.del,
          ...local.books.map((x) => ['books', x.id]),
          ...local.sessions.map((x) => ['sessions', x.id]),
          ...local.quotes.map((x) => ['quotes', x.id]),
          ['meta', 'profile'],
        ],
      };
    });
    await A.clear('covers');
    coverURLs.forEach((url) => URL.revokeObjectURL(url));
    coverURLs.clear();
    emit('wipe');
  };

  db.mergeData = mergeData;
  db.BACKUP_STORES = BACKUP_STORES;
  LK.db = db;
})(window.LK);
