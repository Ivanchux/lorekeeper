/* ==========================================================
   VISTA: IMPORTAR   #/importar
   Trae libros de Bookmory (Excel), Goodreads (CSV) o cualquier
   tabla. Como cada app exporta columnas distintas, se detectan
   solas y se pueden corregir antes de importar.
   Los libros importados NO dan EXP de "libro terminado": ya los
   leíste antes de usar LoreKeeper.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  LK.views = LK.views || {};

  /* ---------- Campos que se pueden rellenar ---------- */

  // aliases: nombres de columna habituales, ya normalizados (sin acentos ni símbolos)
  const FIELDS = [
    { id: 'title', label: 'Título', required: true, aliases: ['title', 'titulo', 'nombre', 'libro', 'book', 'name'] },
    { id: 'author', label: 'Autor', aliases: ['author', 'autor', 'autores', 'escritor', 'authors'] },
    { id: 'isbn', label: 'ISBN', aliases: ['isbn13', 'isbn', 'isbn10'] },
    { id: 'totalPages', label: 'Páginas totales', aliases: ['numberofpages', 'pages', 'paginas', 'paginastotales', 'numpaginas', 'npaginas', 'pagecount'] },
    { id: 'readPages', label: 'Página actual', aliases: ['paginaactual', 'currentpage', 'readpages', 'paginaleida', 'paginasleidas', 'pagesread'] },
    { id: 'status', label: 'Estado / estantería', aliases: ['exclusiveshelf', 'estado', 'status', 'estanteria', 'shelf', 'state', 'lectura'] },
    { id: 'rating', label: 'Valoración', aliases: ['myrating', 'valoracion', 'rating', 'puntuacion', 'calificacion', 'estrellas', 'nota', 'stars'] },
    { id: 'dateStarted', label: 'Fecha de inicio', aliases: ['datestarted', 'fechadeinicio', 'fechainicio', 'startdate', 'started', 'inicio', 'empezado', 'fechaempezado'] },
    { id: 'dateCompleted', label: 'Fecha de fin', aliases: ['dateread', 'fechadefin', 'fechafin', 'enddate', 'finished', 'fin', 'terminado', 'fechaterminado', 'fechalectura', 'fechadelectura', 'completado'] },
    { id: 'review', label: 'Reseña / notas', aliases: ['myreview', 'resena', 'review', 'notas', 'notes', 'comentario', 'comentarios', 'memo', 'opinion'] },
    { id: 'genres', label: 'Géneros', aliases: ['genero', 'generos', 'genre', 'genres', 'categoria', 'categorias', 'category', 'categories'] },
    { id: 'tags', label: 'Etiquetas', aliases: ['bookshelves', 'etiquetas', 'etiqueta', 'tags', 'tag', 'estanterias'] },
    { id: 'series', label: 'Saga / serie', aliases: ['series', 'serie', 'saga', 'coleccion'] },
    { id: 'format', label: 'Formato', aliases: ['format', 'formato', 'binding', 'tipo'] },
    { id: 'year', label: 'Año', aliases: ['yearpublished', 'originalpublicationyear', 'ano', 'anio', 'year', 'publicacion', 'anopublicacion'] },
  ];

  const EXCLUDE = { rating: ['average', 'media', 'promedio'], status: ['ranking'] };

  /** Asigna cada campo a la columna que mejor encaja (sin repetir columnas). */
  function autoMap(headers) {
    const norm = headers.map((h) => u.norm(h));
    const used = new Set();
    const map = {};
    for (const f of FIELDS) {
      const ok = (i) => !used.has(i) && !(EXCLUDE[f.id] || []).some((x) => norm[i].includes(x));
      let idx = -1;
      for (const alias of f.aliases) {
        idx = norm.findIndex((h, i) => h === alias && ok(i));
        if (idx >= 0) break;
      }
      if (idx < 0) {
        for (const alias of f.aliases.filter((a) => a.length >= 5)) {
          idx = norm.findIndex((h, i) => h.includes(alias) && ok(i));
          if (idx >= 0) break;
        }
      }
      if (idx >= 0) {
        map[f.id] = headers[idx];
        used.add(idx);
      }
    }
    return map;
  }

  /* ---------- Conversión de valores ---------- */

  function parseDate(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {
      const d = new Date(Math.round((+s - 25569) * 86400000)); // serial de Excel
      return u.isoDate(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) {
      let [, a, b, y] = m.map(Number);
      if (y < 100) y += 2000;
      let [day, mon] = [a, b];
      if (mon > 12 && day <= 12) [day, mon] = [mon, day]; // venía como mes/día
      return `${y}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : u.isoDate(new Date(t));
  }

  function parseStatus(v) {
    const s = u.norm(v);
    if (!s) return null;
    if (/(toread|wanttoread|quiero|pendiente|wish|porleer|deseo|porempezar|noempezado)/.test(s)) return 'wishlist';
    if (/(currently|reading|leyendo|encurso|enlectura|empezado)/.test(s)) return 'reading';
    if (/(abandon|dnf|dejado|didnotfinish|nolo)/.test(s)) return 'abandoned';
    if (/(^read$|leido|termin|finish|complet|acabado|hecho|done)/.test(s)) return 'completed';
    return null;
  }

  function parseRating(v) {
    const n = parseFloat(String(v ?? '').replace(',', '.'));
    if (!n || n <= 0) return null;
    const stars = n > 5 ? n / 2 : n; // algunas apps puntúan sobre 10
    return u.clamp(Math.round(stars), 1, 5);
  }

  const parseInt0 = (v) => parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10) || 0;

  function parseFormat(v) {
    const s = u.norm(v);
    if (/audio/.test(s)) return 'audio';
    if (/(ebook|kindle|digital|electr|epub|pdf)/.test(s)) return 'ebook';
    return 'paper';
  }

  /** "Título (Saga, #2)" → { title, series, seriesNo } (formato de Goodreads). */
  function splitSeries(title) {
    const m = String(title).match(/^(.*?)\s*\(([^()]+?),?\s*#\s*(\d+(?:\.\d+)?)\)\s*$/);
    if (!m) return { title, series: '', seriesNo: null };
    return { title: m[1].trim(), series: m[2].trim(), seriesNo: parseFloat(m[3]) };
  }

  /** Fila → libro (o null si no tiene título). */
  function convertRow(row, map) {
    const g = (id) => (map[id] ? String(row[map[id]] ?? '').trim() : '');
    let title = g('title').replace(/\s+/g, ' ');
    if (!title) return null;
    let series = g('series');
    let seriesNo = null;
    const sp = splitSeries(title);
    if (sp.series) {
      title = sp.title;
      series = series || sp.series;
      seriesNo = sp.seriesNo;
    }
    const isbn = LK.books.isbn.normalize(g('isbn').replace(/[="]/g, ''));
    const totalPages = parseInt0(g('totalPages'));
    const dateCompleted = parseDate(g('dateCompleted'));
    const dateStarted = parseDate(g('dateStarted'));
    let status = parseStatus(g('status'));
    if (!status) status = dateCompleted ? 'completed' : dateStarted ? 'reading' : 'wishlist';
    let readPages = parseInt0(g('readPages'));
    if (status === 'completed' && totalPages) readPages = totalPages;
    if (totalPages) readPages = Math.min(readPages, totalPages);
    const tags = LK.books.splitList(g('tags')).filter((t) => !/^(to-read|read|currently-reading)$/i.test(t));
    const genres = LK.books.splitList(g('genres'));

    return {
      title,
      author: g('author') || 'Autor desconocido',
      isbn,
      totalPages,
      readPages,
      status,
      rating: parseRating(g('rating')),
      dateStarted: dateStarted || (status !== 'wishlist' ? dateCompleted : null),
      dateCompleted: status === 'completed' ? dateCompleted : null,
      review: g('review'),
      genres,
      tags,
      series,
      seriesNo,
      format: map.format ? parseFormat(g('format')) : 'paper',
      year: g('year').match(/\d{4}/)?.[0] || '',
    };
  }

  const keyOf = (b) => u.norm(b.title) + '|' + u.norm((b.author || '').split(/[,;]/)[0]);

  /* ---------- Vista ---------- */

  LK.views.importar = async () => {
    const existing = await LK.db.getBooks();
    const haveIsbn = new Set(existing.map((b) => LK.books.isbn.normalize(b.isbn)).filter(Boolean));
    const haveKey = new Set(existing.map(keyOf));

    return {
      html: `
        <div class="page-head"><h1>Importar libros</h1></div>
        <div class="stack" id="imp-root">
          <section class="card stack-sm">
            <h2>Trae tu biblioteca de otra app</h2>
            <p>Sirve un Excel (<strong>.xlsx</strong>) o un <strong>.csv</strong>: el de <strong>Bookmory</strong>, el de <strong>Goodreads</strong> o cualquier tabla con una columna de título.</p>
            <details class="disclosure">
              <summary>¿Cómo saco el archivo?</summary>
              <ul class="small">
                <li><strong>Bookmory:</strong> en sus ajustes busca la opción de exportar a Excel y guarda el archivo.</li>
                <li><strong>Goodreads:</strong> en la web, «My Books» → «Import and export» → «Export Library». Te baja un .csv.</li>
                <li>Desde un móvil, el archivo puede estar en «Descargas» o en Drive.</li>
              </ul>
            </details>
            <p class="muted small">Los libros importados no dan EXP por «libro terminado» (ya los leíste antes), pero cuentan en tus estadísticas y logros.</p>
            <label class="btn btn-primary" tabindex="0" id="imp-pick">Elegir archivo…
              <input type="file" id="imp-file" accept=".xlsx,.csv,.tsv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
            </label>
            <p class="small" id="imp-error" style="color:var(--danger)" hidden></p>
          </section>
          <div id="imp-step"></div>
        </div>`,

      mount(root) {
        const $file = root.querySelector('#imp-file');
        const $step = root.querySelector('#imp-step');
        const $err = root.querySelector('#imp-error');
        root.querySelector('#imp-pick').addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            $file.click();
          }
        });

        let table = null;
        let map = {};

        $file.addEventListener('change', async () => {
          const file = $file.files[0];
          $file.value = '';
          if (!file) return;
          $err.hidden = true;
          $step.innerHTML = '<div class="skeleton"></div>';
          try {
            if (file.name.toLowerCase().endsWith('.json')) throw new Error('Eso es una copia de LoreKeeper. Para restaurarla ve a Ajustes → Importar copia.');
            table = await LK.csv.parseFile(file);
            if (!table.rows.length) throw new Error('El archivo no tiene filas con datos.');
            map = autoMap(table.headers);
            renderStep(file.name);
          } catch (err) {
            $step.innerHTML = '';
            $err.textContent = err.message;
            $err.hidden = false;
          }
        });

        function analyse() {
          const books = [];
          let skipped = 0;
          for (const row of table.rows) {
            const b = convertRow(row, map);
            if (b) books.push(b);
            else skipped++;
          }
          const seen = new Set();
          for (const b of books) {
            const k = keyOf(b);
            b.dup = (b.isbn && haveIsbn.has(b.isbn)) || haveKey.has(k) || seen.has(k);
            seen.add(k);
          }
          return { books, skipped };
        }

        function renderStep(fileName) {
          const { books, skipped } = analyse();
          const fresh = books.filter((b) => !b.dup);
          const dupes = books.length - fresh.length;
          const byStatus = (s) => fresh.filter((b) => b.status === s).length;
          const options = (current) =>
            `<option value="">— no importar —</option>` +
            table.headers.map((h) => `<option value="${u.esc(h)}" ${h === current ? 'selected' : ''}>${u.esc(h)}</option>`).join('');

          const sample = books.slice(0, 5);
          $step.innerHTML = `
            <section class="card stack-sm">
              <h2>Revisa cómo se ha entendido</h2>
              <p class="muted small">${u.esc(fileName)} · ${table.rows.length} filas. Si alguna columna está mal asignada, cámbiala.</p>
              <div class="form-grid" id="imp-map">
                ${FIELDS.map(
                  (f) => `<label class="field"><span>${f.label}${f.required ? ' *' : ''}</span>
                    <select class="select" data-field="${f.id}">${options(map[f.id])}</select></label>`
                ).join('')}
              </div>
            </section>

            <section class="card stack-sm">
              <h2>Vista previa</h2>
              ${map.title
                ? `<ul class="list imp-preview">${sample
                    .map(
                      (b) => `<li><strong>${u.esc(b.title)}</strong> <span class="muted">· ${u.esc(b.author)}</span>
                        <div class="muted small">${u.esc(LK.books.statusLabel(b.status))}${b.totalPages ? ` · ${b.totalPages} págs.` : ''}${b.rating ? ` · ${'★'.repeat(b.rating)}` : ''}${b.dateCompleted ? ` · ${u.fmtDate(b.dateCompleted)}` : ''}${b.series ? ` · ${u.esc(b.series)}${b.seriesNo ? ' #' + b.seriesNo : ''}` : ''}${b.dup ? ' · <span class="chip chip-warn">ya lo tienes</span>' : ''}</div></li>`
                    )
                    .join('')}</ul>`
                : '<p class="chip chip-warn">Elige qué columna es el título.</p>'}
              <div class="tiles imp-tiles">
                <div class="card tile"><div class="tile-value">${fresh.length}</div><div class="tile-label">libros nuevos</div></div>
                <div class="card tile"><div class="tile-value">${byStatus('completed')}</div><div class="tile-label">leídos</div></div>
                <div class="card tile"><div class="tile-value">${byStatus('reading')}</div><div class="tile-label">leyendo</div></div>
                <div class="card tile"><div class="tile-value">${byStatus('wishlist')}</div><div class="tile-label">pendientes</div></div>
              </div>
              ${dupes ? `<p class="muted small">${dupes} ya están en tu biblioteca (o repetidos en el archivo) y se omitirán.</p>` : ''}
              ${skipped ? `<p class="muted small">${skipped} filas sin título se ignoran.</p>` : ''}

              <label class="check"><input type="checkbox" id="imp-enrich" checked>
                <span>Completar portadas, páginas y géneros desde internet <span class="muted small">(tarda un poco; los géneros alimentan tus atributos)</span></span></label>

              <div class="row">
                <button class="btn btn-primary" id="imp-go" ${fresh.length && map.title ? '' : 'disabled'}>Importar ${fresh.length} libros</button>
              </div>
              <div id="imp-progress" aria-live="polite"></div>
            </section>`;

          $step.querySelectorAll('[data-field]').forEach((sel) =>
            sel.addEventListener('change', () => {
              if (sel.value) map[sel.dataset.field] = sel.value;
              else delete map[sel.dataset.field];
              renderStep(fileName);
            })
          );
          $step.querySelector('#imp-go').addEventListener('click', () => run(fresh));
        }

        async function run(list) {
          const enrich = $step.querySelector('#imp-enrich').checked;
          const $prog = $step.querySelector('#imp-progress');
          $step.querySelector('#imp-go').disabled = true;
          const today = u.isoDate();

          const records = list.map(({ dup, ...b }) => ({
            ...b,
            id: u.uid('imp'),
            source: 'import',
            imported: true,
            dateAdded: today,
            lastReadAt: b.status === 'reading' ? Date.now() : null,
          }));
          await LK.db.saveBooks(records);
          LK.app.refreshPlayer();

          if (!enrich) return done($prog, records.length, 0, 0);

          $prog.innerHTML = '<div class="progress progress-lg"><span style="width:0%"></span></div><p class="muted small" id="imp-ptext"></p>';
          const bar = $prog.querySelector('.progress span');
          const text = $prog.querySelector('#imp-ptext');
          let i = 0;
          let n = 0;
          let improved = 0;
          const worker = async () => {
            while (i < records.length) {
              const book = records[i++];
              if (!document.body.contains($prog)) return; // se salió de la pantalla
              const patch = await LK.api.enrich(book);
              if (patch) {
                Object.assign(book, patch);
                await LK.db.saveBook(book, { silent: true });
                if (patch.coverUrl) LK.db.cacheCover(book.id, patch.coverUrl);
                improved++;
              }
              n++;
              bar.style.width = `${Math.round((n / records.length) * 100)}%`;
              text.textContent = `Completando datos… ${n} de ${records.length}`;
            }
          };
          await Promise.all([worker(), worker(), worker()]);
          LK.app.refreshPlayer();
          if (document.body.contains($prog)) done($prog, records.length, improved, 1);
        }

        function done($prog, total, improved, enriched) {
          $prog.innerHTML = `
            <div class="card banner-ok">
              <strong>✓ ${total} libros importados</strong>
              ${enriched ? `<p class="small">${improved} se han completado con datos de internet.</p>` : ''}
              <div class="row"><a class="btn btn-primary" href="#/biblioteca/all">Ver mi biblioteca</a></div>
            </div>`;
          u.toast(`${total} libros importados`);
        }
      },
    };
  };

  // Para pruebas y para reutilizar desde fuera
  LK.importer = { autoMap, convertRow, parseDate, parseStatus, splitSeries };
})(window.LK);
