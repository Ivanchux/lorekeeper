/* ==========================================================
   CATÁLOGOS DE LIBROS  (LK.api)
   Busca en Google Books y, si falla o no encuentra nada,
   en Open Library. Ambos devuelven el mismo formato.
   ========================================================== */

(function (LK) {
  'use strict';

  const cache = new Map(); // búsquedas recientes, para no repetir peticiones

  /** fetch con tiempo límite. */
  async function getJSON(url, ms = 9000, patient = false) {
    const attempts = patient ? 2 : 1;
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      if (patient) await pace(new URL(url).hostname, url.includes('itunes') ? 1500 : 400);
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), ms);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { retry: true });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (!patient || (!err.retry && err.name !== 'AbortError' && err.name !== 'TypeError')) break;
        await sleep(2000 * 2 ** i); // pequeña espera antes de reintentar
      } finally {
        clearTimeout(t);
      }
    }
    if (patient && /HTTP 429/.test(lastErr?.message || '')) blockedUntil[new URL(url).hostname] = Date.now() + 10 * 60 * 1000;
    throw lastErr;
  }

  // Qué ha respondido cada catálogo (para saber por qué faltan portadas)
  let diagData = {};
  const note = (src, kind) => {
    const d = (diagData[src] = diagData[src] || { searches: 0, withResults: 0, empty: 0, covers: 0, errors: {} });
    if (kind === 'search') d.searches++;
    else if (kind === 'results') d.withResults++;
    else if (kind === 'empty') d.empty++;
    else if (kind === 'cover') d.covers++;
    else if (kind.startsWith('err:')) d.errors[kind.slice(4)] = (d.errors[kind.slice(4)] || 0) + 1;
  };
  const errName = (e) => (e?.name === 'AbortError' ? 'sin respuesta (tiempo agotado)' : /HTTP (\d+)/.test(e?.message || '') ? `HTTP ${RegExp.$1}` : e?.message === 'bloqueado' ? 'saltado (bloqueado)' : e?.message || 'error de red');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Cuando se completan muchos libros seguidos, los catálogos limitan las peticiones
  // (error 429) y el libro se queda sin portada. Se espacian para evitarlo.
  const nextSlot = {};
  async function pace(host = 'default', gap = 400) {
    const slot = Math.max(Date.now(), nextSlot[host] || 0);
    nextSlot[host] = slot + gap;
    if (slot > Date.now()) await sleep(slot - Date.now());
  }

  // Si un catálogo se niega a seguir (cuota diaria), se deja de insistir un rato
  const blockedUntil = {};
  const isBlocked = (host) => (blockedUntil[host] || 0) > Date.now();

  /** Si el texto parece un ISBN, se busca como tal. */
  function normalizeQuery(q) {
    const digits = q.replace(/[-\s]/g, '');
    return /^(97[89])?\d{9}[\dXx]$/.test(digits) ? { q: digits, isbn: true } : { q, isbn: false };
  }

  async function google(query, patient = false) {
    const { q, isbn } = normalizeQuery(query);
    const term = isbn ? `isbn:${q}` : q;
    const data = await getJSON(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(term)}&maxResults=20&printType=books`, 9000, patient
    );
    return (data.items || []).map((item) => {
      const v = item.volumeInfo || {};
      const img = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '';
      const ids = v.industryIdentifiers || [];
      return {
        id: `gb_${item.id}`,
        source: 'google',
        title: v.title || 'Sin título',
        subtitle: v.subtitle || '',
        author: (v.authors || []).join(', ') || 'Autor desconocido',
        coverUrl: img ? img.replace(/^http:/, 'https:').replace('&edge=curl', '') : '',
        totalPages: v.pageCount || 0,
        genres: v.categories || [],
        year: (v.publishedDate || '').slice(0, 4),
        description: v.description || '',
        publisher: v.publisher || '',
        isbn: (ids.find((i) => i.type === 'ISBN_13') || ids[0] || {}).identifier || '',
      };
    });
  }

  async function openLibrary(query, patient = false) {
    const { q, isbn } = normalizeQuery(query);
    const param = isbn ? `isbn=${q}` : q.startsWith('\u0000') ? q.slice(1) : `q=${encodeURIComponent(q)}`;
    const fields = 'key,title,subtitle,author_name,cover_i,number_of_pages_median,subject,first_publish_year,isbn,publisher';
    const data = await getJSON(`https://openlibrary.org/search.json?${param}&limit=20&fields=${fields}`, 9000, patient);
    return (data.docs || []).map((d) => ({
      id: `ol_${String(d.key || '').replace('/works/', '')}`,
      source: 'openlibrary',
      title: d.title || 'Sin título',
      subtitle: d.subtitle || '',
      author: (d.author_name || []).slice(0, 3).join(', ') || 'Autor desconocido',
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '',
      totalPages: d.number_of_pages_median || 0,
      genres: (d.subject || []).slice(0, 8),
      year: d.first_publish_year ? String(d.first_publish_year) : '',
      description: '',
      publisher: (d.publisher || [])[0] || '',
      isbn: (d.isbn || [])[0] || '',
    }));
  }

  /**
   * Busca libros. Devuelve { results, source }.
   * `prefer` permite forzar el catálogo: 'google' | 'openlibrary'.
   */
  async function search(query, prefer = 'google') {
    const q = query.trim();
    if (!q) return { results: [], source: null };
    const cacheKey = `${prefer}:${q.toLowerCase()}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    const order = prefer === 'openlibrary'
      ? [['Open Library', openLibrary], ['Google Books', google]]
      : [['Google Books', google], ['Open Library', openLibrary]];

    let lastError = null;
    for (const [name, fn] of order) {
      try {
        const results = await fn(q);
        if (results.length) {
          const out = { results, source: name };
          cache.set(cacheKey, out);
          return out;
        }
      } catch (err) {
        console.warn(`${name} falló:`, err);
        lastError = err;
      }
    }
    if (lastError) {
      throw new Error(navigator.onLine === false
        ? 'Sin conexión. El buscador necesita internet; tu biblioteca sigue disponible.'
        : 'No se pudo conectar con los catálogos de libros. Inténtalo de nuevo en un momento.');
    }
    return { results: [], source: order[0][0] };
  }

  /**
   * Apple Books / iTunes: buena fuente para audiolibros y portadas en español, sin clave.
   * Se pide por JSONP (etiqueta <script>) para no depender de los permisos CORS.
   */
  let jsonpN = 0;
  function jsonp(url, ms = 9000) {
    return new Promise((resolve, reject) => {
      const cb = `__lk_jsonp_${Date.now()}_${jsonpN++}`;
      const el = document.createElement('script');
      const done = (fn, v) => {
        clearTimeout(t);
        delete window[cb];
        el.remove();
        fn(v);
      };
      const t = setTimeout(() => done(reject, Object.assign(new Error('timeout'), { name: 'AbortError' })), ms);
      window[cb] = (data) => done(resolve, data);
      el.onerror = () => done(reject, Object.assign(new TypeError('network')));
      el.src = `${url}&callback=${cb}`;
      document.head.appendChild(el);
    });
  }

  async function itunes(query, media = 'audiobook') {
    if (isBlocked('itunes.apple.com')) throw new Error('bloqueado');
    const entity = media === 'audiobook' ? 'audiobook' : 'ebook';
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=${media}&entity=${entity}&country=es&limit=10`;
    let data;
    for (let i = 0; i < 3; i++) {
      await pace('itunes.apple.com', 1500);
      try {
        data = await jsonp(url);
        break;
      } catch (err) {
        if (i === 2) throw err;
        await sleep(2000 * 2 ** i);
      }
    }
    return (data?.results || []).map((r) => ({
      id: `it_${r.collectionId || r.trackId}`,
      source: 'apple',
      title: r.collectionName || r.trackName || '',
      subtitle: '',
      author: r.artistName || '',
      coverUrl: (r.artworkUrl100 || r.artworkUrl60 || '').replace(/\/\d+x\d+(bb)?\./, '/600x600bb.'),
      totalPages: 0,
      genres: r.primaryGenreName ? [r.primaryGenreName] : [],
      year: (r.releaseDate || '').slice(0, 4),
      description: r.description || '',
      publisher: r.copyright ? String(r.copyright).replace(/^[^A-Za-zÁ-ú]*(\d{4}\s*)?/, '') : '',
      isbn: '',
    }));
  }

  /* ---------- Completar libros (importados, sin portada…) ---------- */

  /** Varias formas de escribir el título, de la más completa a la más corta. */
  function titleVariants(title) {
    const clean = String(title || '').replace(/\s+/g, ' ').trim();
    const noParens = clean.replace(/\s*\([^)]*\)/g, '').replace(/\s*-\s*(spanish|english)\s+edition/i, '').trim();
    const out = [noParens];
    const beforeColon = noParens.replace(/\s*[:–—].*$/, '').trim();
    out.push(beforeColon);
    const afterSeries = noParens.match(/^.*?,\s*\d+\s*[.:\-]\s*(.+)$/); // «Saga, 1. Título»
    if (afterSeries) out.push(afterSeries[1].replace(/\s*[:–—].*$/, '').trim());
    const dropRustica = noParens.replace(/\s*\.?\s*(rustica|rústica|tapa blanda|tapa dura|bolsillo)\s*$/i, '').trim();
    out.push(dropRustica);
    return [...new Set(out.filter((v) => v.length >= 3))];
  }

  const words = (text) => LK.util.norm(text).match(/[a-z0-9]{4,}/g) || [];
  const sameAuthor = (a, b) => {
    const wa = new Set(words(a));
    return words(b).some((w) => wa.has(w));
  };

  /** ¿La imagen existe de verdad? (Open Library devuelve un 404 si no hay portada.) */
  function probeImage(url, ms = 6000) {
    return new Promise((resolve) => {
      const img = new Image();
      const t = setTimeout(() => resolve(false), ms);
      img.onload = () => {
        clearTimeout(t);
        resolve(img.naturalWidth > 20);
      };
      img.onerror = () => {
        clearTimeout(t);
        resolve(false);
      };
      img.src = url;
    });
  }

  /**
   * Completa un libro con datos del catálogo. Devuelve { patch, answered }:
   * - patch: solo los campos que le faltaban (o null si no encontró nada);
   * - answered: algún catálogo contestó de verdad (aunque no hubiera nada). Si todo falló
   *   por red o límites, el libro no se marca como «ya buscado» y se reintentará.
   * Prueba de más a menos preciso hasta dar con la portada y se rinde a los 25 s.
   */
  async function enrichDetailed(book) {
    const u = LK.util;
    const isbn = LK.books.isbn.normalize(book.isbn);
    const variants = titleVariants(book.title);
    const a = String(book.author || '').split(/[,;]/)[0].trim();
    const aq = a && !/desconocido/i.test(a) ? a : '';
    const first = variants[0] || '';
    const audio = book.format === 'audio';
    const media = audio ? 'audiobook' : 'ebook';

    const G = 'Google Books';
    const O = 'Open Library';
    const A = 'Apple Books';
    const g = (q) => [G, () => (isBlocked('www.googleapis.com') ? Promise.reject(new Error('bloqueado')) : google(q, true))];
    const o = (q) => [O, () => (isBlocked('openlibrary.org') ? Promise.reject(new Error('bloqueado')) : openLibrary(q, true))];
    const ap = (v) => [A, () => itunes(`${v} ${aq}`.trim(), media)];

    const googleTries = [];
    if (isbn) googleTries.push(g(isbn));
    variants.slice(0, 2).forEach((v) => googleTries.push(g(`intitle:"${v}"${aq ? ` inauthor:"${aq}"` : ''}`)));
    googleTries.push(g(`${first} ${aq}`.trim()));
    const olTries = [];
    if (isbn) olTries.push(o(isbn));
    variants.slice(0, 2).forEach((v) => olTries.push(o(`\u0000title=${encodeURIComponent(v)}${aq ? `&author=${encodeURIComponent(aq)}` : ''}`)));
    const appleTries = (audio ? [first, variants[1]] : [first]).filter(Boolean).map(ap);
    const tries = audio ? [...appleTries, ...olTries, ...googleTries] : [...googleTries, ...olTries, ...appleTries];

    const patch = {};
    const need = () => ({
      cover: !book.coverUrl && !patch.coverUrl,
      genres: !(book.genres || []).length && !patch.genres,
      pages: !book.totalPages && !patch.totalPages && !audio,
    });
    const deadline = Date.now() + 25000;
    let answered = false;

    for (const [src, run] of tries) {
      if (!Object.values(need()).some(Boolean) || Date.now() > deadline) break;
      let list;
      note(src, 'search');
      try {
        list = await run();
        answered = true;
      } catch (err) {
        note(src, `err:${errName(err)}`);
        continue; // este intento falló: se prueba el siguiente
      }
      if (!list.length) {
        note(src, 'empty');
        continue;
      }
      note(src, 'results');
      const scored = list
        .map((r) => {
          const rt = u.norm(r.title);
          const titleOk = variants.some((v) => {
            const n = u.norm(v);
            return n.length >= 4 && (rt.includes(n) || (rt.length >= 4 && n.includes(rt)));
          });
          const authorOk = !aq || sameAuthor(aq, r.author);
          return { r, score: (titleOk ? 2 : 0) + (authorOk ? 1 : 0) + (r.coverUrl ? 0.5 : 0), titleOk, authorOk };
        })
        .filter((x) => (x.titleOk && x.authorOk) || (isbn && x.titleOk) || x.score >= 3)
        .sort((x, y) => y.score - x.score);
      const hit = scored[0]?.r;
      if (!hit) continue;
      if (need().cover && hit.coverUrl) {
        patch.coverUrl = hit.coverUrl;
        note(src, 'cover');
      }
      if (need().genres && hit.genres?.length) patch.genres = hit.genres;
      if (need().pages && hit.totalPages) patch.totalPages = hit.totalPages;
      if (!book.description && !patch.description && hit.description) patch.description = hit.description;
      if (!book.year && !patch.year && hit.year) patch.year = hit.year;
      if (!book.isbn && !patch.isbn && hit.isbn) patch.isbn = hit.isbn;
      if (!book.publisher && !patch.publisher && hit.publisher) patch.publisher = hit.publisher;
    }

    // Último recurso: la portada de Open Library por ISBN, si existe
    if (!book.coverUrl && !patch.coverUrl && isbn && Date.now() < deadline + 8000) {
      const url = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
      if (await probeImage(url)) {
        patch.coverUrl = url;
        note('Open Library (por ISBN)', 'cover');
      }
      note('Open Library (por ISBN)', 'search');
    }
    return { patch: Object.keys(patch).length ? patch : null, answered };
  }

  const enrich = async (book) => (await enrichDetailed(book)).patch;

  /**
   * Busca la portada (y lo que falte) de los libros que no la tienen. Los que ya se buscaron
   * hace poco y no aparecieron se saltan, salvo con { force: true }.
   * onProgress({ done, total, found, title }) se llama al empezar y tras cada libro.
   */
  async function fillMissing(onProgress = () => {}, { signal, force = false } = {}) {
    const WEEK = 3 * 86400000;
    const books = (await LK.db.getBooks()).filter((b) => !b.coverUrl && !b.hasLocalCover && (force || !b.coverTriedAt || Date.now() - b.coverTriedAt > WEEK));
    const total = books.length;
    diagData = {};
    let i = 0;
    let done = 0;
    let found = 0;
    onProgress({ done, total, found, title: '' });
    const worker = async () => {
      while (i < books.length) {
        if (signal?.aborted) return;
        const book = books[i++];
        onProgress({ done, total, found, title: book.title });
        const { patch, answered } = await enrichDetailed(book);
        const upd = { ...(patch || {}) };
        if (answered && !patch?.coverUrl) upd.coverTriedAt = Date.now();
        if (Object.keys(upd).length) {
          Object.assign(book, upd);
          await LK.db.saveBook(book, { silent: true });
          if (patch?.coverUrl) {
            found++;
            LK.db.cacheCover(book.id, patch.coverUrl);
          }
        }
        done++;
        onProgress({ done, total, found, title: book.title });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return { total, found };
  }

  /** Prueba cada catálogo con un libro y cuenta lo que responde (para ver por qué fallan). */
  async function diagnose(book) {
    const out = [];
    const t = titleVariants(book.title)[0] || book.title;
    const a = String(book.author || '').split(/[,;]/)[0].trim();
    const probes = [
      ['Google Books', () => google(`intitle:"${t}"${a ? ` inauthor:"${a}"` : ''}`)],
      ['Open Library', () => openLibrary(`\u0000title=${encodeURIComponent(t)}${a ? `&author=${encodeURIComponent(a)}` : ''}`)],
      ['Apple Books', () => itunes(`${t} ${a}`.trim(), book.format === 'audio' ? 'audiobook' : 'ebook')],
    ];
    for (const [name, run] of probes) {
      const t0 = Date.now();
      try {
        const list = await run();
        out.push(`${name}: ${list.length} resultados (${list.filter((r) => r.coverUrl).length} con portada) en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      } catch (err) {
        out.push(`${name}: ERROR ${errName(err)}`);
      }
    }
    return out;
  }

  /** Resumen legible de lo que ha respondido cada catálogo en la última búsqueda. */
  function diagSummary() {
    return Object.entries(diagData).map(([src, d]) => {
      const errs = Object.entries(d.errors).map(([k, n]) => `${n}× ${k}`).join(', ');
      return `${src}: ${d.searches} búsquedas · ${d.withResults} con resultados · ${d.covers} portadas${errs ? ` · fallos: ${errs}` : ''}`;
    });
  }

  LK.api = { search, enrich, enrichDetailed, fillMissing, diagnose, diagSummary, titleVariants, blocked: () => Object.keys(blockedUntil).filter(isBlocked) };
})(window.LK);
