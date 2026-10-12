/* ==========================================================
   VISTA: GRÁFICOS   #/graficos
   Estadísticas en forma de rosco (anillo dividido): por año,
   autor, género, editorial y formato, midiendo en libros o en
   páginas, para todos los años o uno concreto.
   También las usa «Tu año en libros» (LK.rosco.cards).
   Las páginas de los libros sin dato (audiolibros, ebooks) son
   estimadas: ver LK.books.estimator.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  LK.views = LK.views || {};

  /** «Grupo Planeta (GBS)», «Editorial Planeta», «Planeta Publishing» → «Planeta». */
  function cleanPublisher(name) {
    let n = String(name || '').replace(/\([^)]*\)/g, ' ');
    n = n.replace(/\b(grupo|editorial|editorial(es)?|ediciones|edicions|publishing|publishers?|spain|espa[ñn]a|s\.?\s?a\.?u?\.?|s\.?\s?l\.?u?\.?|ltd|inc|llc)\b\.?/gi, ' ');
    n = n.replace(/[,.;]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n) return '';
    return n.replace(/\b\w+/g, (w) => (w === w.toUpperCase() && w.length > 3 ? w[0] + w.slice(1).toLowerCase() : w));
  }

  const firstAuthor = (b) => {
    const n = String(b.author || '').split(/[,;]/)[0].trim();
    return n && !/desconocido/i.test(n) ? n : '';
  };

  const GROUPERS = {
    author: (b) => firstAuthor(b),
    genre: (b) => (b.genres || [])[0] || (b.tags || [])[0] || '',
    publisher: (b) => cleanPublisher(b.publisher),
    format: (b) => LK.books.FORMATS[b.format || 'paper'] || '',
    year: (b) => String(b.dateCompleted || '').slice(0, 4),
  };

  /** Filas [{label, value}] ordenadas, con «Sin dato» al final. */
  function rows(books, by, metric, est) {
    const map = new Map();
    for (const b of books) {
      const key = GROUPERS[by](b) || '';
      map.set(key, (map.get(key) || 0) + (metric === 'pages' ? est.pages(b) : 1));
    }
    const list = [...map.entries()].filter(([k]) => k).map(([label, value]) => ({ label, value }));
    list.sort(by === 'year' ? (a, b) => b.label.localeCompare(a.label) : (a, b) => b.value - a.value);
    const none = map.get('');
    if (none) list.push({ label: 'Sin dato', value: none, none: true });
    return list;
  }

  const TITLES = {
    year: 'Por año',
    author: 'Por autor',
    genre: 'Por género',
    publisher: 'Por editorial',
    format: 'Por formato',
  };

  /** Tarjetas con un rosco cada una. */
  function cards(books, { metric = 'books', by = ['author', 'genre', 'publisher', 'format'] } = {}) {
    const est = LK.books.estimator(books);
    const unit = metric === 'pages' ? 'págs.' : 'libros';
    return by
      .map((k) => {
        const r = rows(books, k, metric, est);
        const total = r.reduce((a, x) => a + x.value, 0);
        return `
          <section class="card">
            <div class="card-head"><h2>${TITLES[k]}</h2><span class="muted small">${k === 'year' ? 'Año en que terminaste el libro' : ''}</span></div>
            ${LK.charts.donut(r, { center: { big: u.fmtNum(total), small: unit }, unit, max: k === 'year' ? 8 : 6 })}
          </section>`;
      })
      .join('');
  }

  LK.views.graficos = async (yearParam, metricParam) => {
    const all = (await LK.db.getBooks()).filter((b) => b.status === 'completed');
    const years = [...new Set(all.map(GROUPERS.year).filter(Boolean))].sort().reverse();
    const year = years.includes(yearParam) ? yearParam : 'all';
    const metric = metricParam === 'pages' ? 'pages' : 'books';
    const books = year === 'all' ? all : all.filter((b) => GROUPERS.year(b) === year);
    const link = (y, m) => `#/graficos/${y}/${m}`;
    const est = LK.books.estimator(all);
    const estimated = all.some((b) => !(b.totalPages > 0));

    const html = `
      <a class="btn btn-ghost btn-sm" href="#/estadisticas" style="margin-bottom:.5rem">← Estadísticas</a>
      <div class="page-head">
        <h1>Gráficos</h1>
        <span class="seg-mini" role="group" aria-label="Medir en">
          <a class="seg-link" href="${link(year, 'books')}" aria-current="${metric === 'books'}">Libros</a>
          <a class="seg-link" href="${link(year, 'pages')}" aria-current="${metric === 'pages'}">Páginas</a>
        </span>
      </div>
      <nav class="segmented" aria-label="Año">
        <a href="${link('all', metric)}" ${year === 'all' ? 'aria-current="page"' : ''}>Todos<span class="count">${all.length}</span></a>
        ${years.map((y) => `<a href="${link(y, metric)}" ${y === year ? 'aria-current="page"' : ''}>${y}</a>`).join('')}
      </nav>
      <div class="stack" style="margin-top:1.1rem">
        ${all.length ? '' : '<div class="empty card">Cuando termines libros, aquí verás tus gráficos.</div>'}
        ${all.length ? (year === 'all' ? cards(all, { metric, by: ['year'] }) : '') : ''}
        ${all.length ? cards(books, { metric, by: ['author', 'genre', 'publisher', 'format'] }) : ''}
        ${metric === 'pages' && estimated ? '<p class="muted small" style="text-align:center">Las páginas de audiolibros y de libros sin dato son estimadas (2 min de audio ≈ 1 página).</p>' : ''}
        ${all.length && all.some((b) => !b.publisher) ? '<p class="muted small" style="text-align:center">«Sin dato» son libros sin editorial o género guardado. Puedes completarlos desde Ajustes → Buscar portadas que faltan, o volviendo a importar el archivo de Bookmory.</p>' : ''}
      </div>`;
    void est;
    return { html };
  };

  LK.rosco = { cards, rows, cleanPublisher };
})(window.LK);
