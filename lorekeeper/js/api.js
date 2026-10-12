/* ==========================================================
   CATÁLOGOS DE LIBROS  (LK.api)
   Busca en Google Books y, si falla o no encuentra nada,
   en Open Library. Ambos devuelven el mismo formato.
   ========================================================== */

(function (LK) {
  'use strict';

  const cache = new Map(); // búsquedas recientes, para no repetir peticiones

  /** fetch con tiempo límite. */
  async function getJSON(url, ms = 9000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  /** Si el texto parece un ISBN, se busca como tal. */
  function normalizeQuery(q) {
    const digits = q.replace(/[-\s]/g, '');
    return /^(97[89])?\d{9}[\dXx]$/.test(digits) ? { q: digits, isbn: true } : { q, isbn: false };
  }

  async function google(query) {
    const { q, isbn } = normalizeQuery(query);
    const term = isbn ? `isbn:${q}` : q;
    const data = await getJSON(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(term)}&maxResults=20&printType=books`
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
        isbn: (ids.find((i) => i.type === 'ISBN_13') || ids[0] || {}).identifier || '',
      };
    });
  }

  async function openLibrary(query) {
    const { q, isbn } = normalizeQuery(query);
    const param = isbn ? `isbn=${q}` : `q=${encodeURIComponent(q)}`;
    const fields = 'key,title,subtitle,author_name,cover_i,number_of_pages_median,subject,first_publish_year,isbn';
    const data = await getJSON(`https://openlibrary.org/search.json?${param}&limit=20&fields=${fields}`);
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
   * Completa un libro (importado, por ejemplo) con datos del catálogo.
   * Devuelve solo los campos que le faltaban, o null si no encuentra nada.
   */
  async function enrich(book) {
    const u = LK.util;
    const isbn = LK.books.isbn.normalize(book.isbn);
    const tries = [];
    if (isbn) tries.push(() => google(isbn));
    const t = String(book.title || '').replace(/[:(].*$/, '').trim();
    const a = String(book.author || '').split(',')[0].trim();
    if (t) tries.push(() => google(`intitle:${t}${a ? ` inauthor:${a}` : ''}`));
    if (isbn) tries.push(() => openLibrary(isbn));
    for (const run of tries) {
      try {
        const list = await run();
        const hit = list.find((r) => u.norm(r.title).includes(u.norm(t)) || u.norm(t).includes(u.norm(r.title))) || (isbn ? list[0] : null);
        if (!hit) continue;
        const patch = {};
        if (!book.coverUrl && hit.coverUrl) patch.coverUrl = hit.coverUrl;
        if (!(book.genres || []).length && hit.genres?.length) patch.genres = hit.genres;
        if (!book.totalPages && hit.totalPages) patch.totalPages = hit.totalPages;
        if (!book.description && hit.description) patch.description = hit.description;
        if (!book.year && hit.year) patch.year = hit.year;
        if (!book.isbn && hit.isbn) patch.isbn = hit.isbn;
        return Object.keys(patch).length ? patch : null;
      } catch {
        /* prueba con el siguiente catálogo */
      }
    }
    return null;
  }

  LK.api = { search, enrich };
})(window.LK);
