/* ==========================================================
   CAPA DE DATOS  (LK.db)
   El resto de la app solo habla con estas funciones.
   Debajo hay un "adaptador" intercambiable:
     - IndexedDB (normal)
     - localStorage (respaldo si IndexedDB no está disponible)
   La sincronización con el servidor propio (js/sync.js) se
   engancha a `onChange` sin tocar las vistas.
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

  /* ---------------- Adaptador IndexedDB ---------------- */

  function idbAdapter() {
    const open = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('Sin IndexedDB'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña'));
    });

    const tx = (stores, mode, fn) =>
      open.then(
        (db) =>
          new Promise((resolve, reject) => {
            const t = db.transaction(stores, mode);
            let result;
            try {
              result = fn(t);
            } catch (err) {
              t.abort();
              return reject(err);
            }
            t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
          })
      );

    return {
      name: 'IndexedDB',
      ready: open,
      all: (s) => tx(s, 'readonly', (t) => t.objectStore(s).getAll()),
      get: (s, key) => tx(s, 'readonly', (t) => t.objectStore(s).get(key)),
      put: (s, value) => tx(s, 'readwrite', (t) => t.objectStore(s).put(value)),
      putMany: (s, values) =>
        tx(s, 'readwrite', (t) => {
          const st = t.objectStore(s);
          values.forEach((v) => st.put(v));
        }),
      del: (s, key) => tx(s, 'readwrite', (t) => t.objectStore(s).delete(key)),
      clear: (s) => tx(s, 'readwrite', (t) => t.objectStore(s).clear()),
      /** Sustituye varios almacenes a la vez, en una sola transacción: o se hace todo o nada. */
      replaceAll: (snapshot) =>
        tx(Object.keys(snapshot), 'readwrite', (t) => {
          for (const [name, values] of Object.entries(snapshot)) {
            const st = t.objectStore(name);
            st.clear();
            values.forEach((v) => st.put(v));
          }
        }),
    };
  }

  /* ---------------- Adaptador localStorage (respaldo) ---------------- */

  function lsAdapter() {
    const mem = {}; // si localStorage también falla, al menos funciona en memoria
    const key = (s) => `lk-db-${s}`;
    const read = (s) => {
      try {
        return JSON.parse(localStorage.getItem(key(s))) || {};
      } catch {
        return mem[s] || {};
      }
    };
    const write = (s, obj) => {
      mem[s] = obj;
      try {
        localStorage.setItem(key(s), JSON.stringify(obj));
      } catch {
        /* lleno o bloqueado */
      }
    };
    const index = (s, values) => Object.fromEntries(values.map((v) => [v[STORES[s]], v]));
    return {
      name: 'localStorage',
      ready: Promise.resolve(),
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
      replaceAll: async (snapshot) => {
        for (const [s, values] of Object.entries(snapshot)) write(s, index(s, values));
      },
    };
  }

  let A = null; // adaptador activo

  /* ---------------- Cambios (para sincronizar y recalcular logros) ---------------- */

  const listeners = new Set();
  function emit(reason, opts = {}) {
    if (opts.silent) return;
    // Aviso asíncrono: nunca bloquea el guardado
    queueMicrotask(() => listeners.forEach((fn) => { try { fn(reason); } catch (e) { console.error(e); } }));
  }

  /* ---------------- API pública ---------------- */

  const db = {};

  db.onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  /** Elige el adaptador. Se llama una vez al arrancar. */
  db.init = async () => {
    try {
      const idb = idbAdapter();
      await Promise.race([idb.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))]);
      A = idb;
    } catch (err) {
      console.warn('IndexedDB no disponible, se usa localStorage:', err);
      A = lsAdapter();
    }
    // Pide al navegador que no borre los datos si se queda sin espacio
    try {
      db.persisted = (await navigator.storage?.persist?.()) ?? false;
    } catch {
      db.persisted = false;
    }
    return A.name;
  };

  db.adapterName = () => (A ? A.name : '—');

  /* ---------- Lápidas (borrados) ----------
     Para que al sincronizar dos dispositivos un libro borrado no
     "resucite", se recuerda qué ids se borraron y cuándo. */

  const TOMB_KEEP_MS = 120 * 86400000;
  db.getTombstones = async () => ((await A.get('meta', 'tombstones')) || { items: {} }).items || {};
  async function addTombs(ids) {
    const items = await db.getTombstones();
    const now = Date.now();
    ids.forEach((id) => (items[id] = now));
    for (const [id, ts] of Object.entries(items)) if (now - ts > TOMB_KEEP_MS) delete items[id];
    await A.put('meta', { id: 'tombstones', items });
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

  const DEFAULT_PROFILE = {
    id: 'profile',
    name: 'Lector',
    yearlyGoal: 12,
    dailyGoal: { type: 'minutes', value: 20 }, // type: 'minutes' | 'pages'; value 0 = sin meta
    achSeen: null,                              // logros ya avisados (null = aún no se ha calculado)
  };

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

  /** Exporta todo a un objeto JSON (sin portadas, que se vuelven a descargar). */
  db.exportAll = async () => {
    const [profile, books, sessions, quotes, tombstones] = await Promise.all([
      db.getProfile(),
      A.all('books'),
      A.all('sessions'),
      A.all('quotes'),
      db.getTombstones(),
    ]);
    return { app: 'lorekeeper', schema: SCHEMA, exportedAt: new Date().toISOString(), profile, books, sessions, quotes, tombstones };
  };

  /** Resumen de una copia (para mostrar al usuario antes de restaurarla). */
  db.summarize = (data) => ({
    books: (data?.books || []).length,
    sessions: (data?.sessions || []).length,
    quotes: (data?.quotes || []).length,
    exportedAt: data?.exportedAt || null,
  });

  db.isEmpty = async () => (await A.all('books')).length === 0 && (await A.all('sessions')).length === 0;

  /**
   * Restaura una copia. Sustituye los datos actuales de golpe
   * (en una transacción: si algo falla, no se pierde nada).
   * opts.silent evita avisar del cambio (lo usa la sincronización).
   */
  db.importAll = async (data, opts = {}) => {
    if (data?.app !== 'lorekeeper') throw new Error('El archivo no es una copia de LoreKeeper.');
    const books = (data.books || []).map((b) => ({ ...bookDefaults(), ...b }));
    const sessions = (data.sessions || []).map((s) => ({ createdAt: Date.now(), ...s, id: s.id || s.sessionId || u.uid('ses') }));
    const quotes = (data.quotes || []).map((q) => ({ createdAt: Date.now(), ...q }));
    const profile = { ...DEFAULT_PROFILE, ...(data.profile || {}), id: 'profile' };
    await A.replaceAll({ books, sessions, quotes, meta: [profile, { id: 'tombstones', items: data.tombstones || {} }] });
    if (!opts.silent) {
      // Vuelve a descargar portadas en segundo plano
      books.forEach((b) => db.cacheCover(b.id, b.coverUrl));
    }
    emit('import', opts);
  };

  db.wipeAll = async () => {
    const [bs, ss, qs] = await Promise.all([A.all('books'), A.all('sessions'), A.all('quotes')]);
    const ids = [...bs, ...ss, ...qs].map((x) => x.id);
    await Promise.all(Object.keys(STORES).map((s) => A.clear(s)));
    await addTombs(ids);
    coverURLs.forEach((url) => URL.revokeObjectURL(url));
    coverURLs.clear();
    emit('wipe');
  };

  db.BACKUP_STORES = BACKUP_STORES;
  LK.db = db;
})(window.LK);
