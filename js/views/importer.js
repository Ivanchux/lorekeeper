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
    { id: 'publisher', label: 'Editorial', aliases: ['editorial', 'publisher', 'editor', 'editora'] },
    { id: 'isbn', label: 'ISBN', aliases: ['isbn13', 'isbn', 'isbn10'] },
    { id: 'totalPages', label: 'Páginas totales', aliases: ['numberofpages', 'pages', 'paginas', 'paginastotales', 'numpaginas', 'npaginas', 'pagecount'] },
    { id: 'readPages', label: 'Página actual', aliases: ['paginaactual', 'currentpage', 'readpages', 'paginaleida', 'paginasleidas', 'pagesread'] },
    { id: 'status', label: 'Estado / estantería', aliases: ['exclusiveshelf', 'estado', 'status', 'estanteria', 'shelf', 'state', 'lectura'] },
    { id: 'rating', label: 'Valoración', aliases: ['myrating', 'valoracion', 'rating', 'puntuacion', 'calificacion', 'estrellas', 'nota', 'stars'] },
    { id: 'period', label: 'Período de lectura (inicio ~ fin)', aliases: ['periododelectura', 'periodoleido', 'readingperiod'] },
    { id: 'dateStarted', label: 'Fecha de inicio', aliases: ['datestarted', 'fechadeinicio', 'fechainicio', 'startdate', 'started', 'inicio', 'empezado', 'fechaempezado'] },
    { id: 'dateCompleted', label: 'Fecha de fin', aliases: ['dateread', 'fechadefin', 'fechafin', 'enddate', 'finished', 'fin', 'terminado', 'fechaterminado', 'fechalectura', 'fechadelectura', 'completado'] },
    { id: 'review', label: 'Reseña / notas', aliases: ['myreview', 'resena', 'review', 'notas', 'notes', 'comentario', 'comentarios', 'memo', 'opinion'] },
    { id: 'genres', label: 'Géneros', aliases: ['genero', 'generos', 'genre', 'genres', 'categoria', 'categorias', 'category', 'categories'] },
    { id: 'tags', label: 'Etiquetas', aliases: ['bookshelves', 'etiquetas', 'etiqueta', 'tags', 'tag', 'estanterias'] },
    { id: 'series', label: 'Saga / serie', aliases: ['series', 'serie', 'saga', 'coleccion'] },
    { id: 'format', label: 'Formato', aliases: ['format', 'formato', 'binding', 'tipodelibro', 'tipolibro', 'tipo'] },
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
    if (/(abandon|dnf|dejado|deje|didnotfinish|nolo)/.test(s)) return 'abandoned';
    if (/(^pausa|enpausa|paused|onhold)/.test(s)) return 'reading';
    if (/(^read$|leido|termin|finish|complet|acabado|hecho|done)/.test(s)) return 'completed';
    return null;
  }

  function parseRating(v) {
    const n = parseFloat(String(v ?? '').replace(',', '.'));
    if (!n || n <= 0) return null;
    const stars = n > 5 ? n / 2 : n; // algunas apps puntúan sobre 10
    return u.clamp(Math.round(stars), 1, 5);
  }

  /** "Total de páginas" de Bookmory: "457", "Pág. 457", "100,00%" (ebook sin páginas) o "16:50:00" (duración del audiolibro). */
  function parseSize(v) {
    const s = String(v ?? '').trim();
    const t = s.match(/^(\d+):(\d{1,2})(?::\d{1,2})?$/);
    if (t) return { pages: 0, minutes: +t[1] * 60 + +t[2] };
    if (s.includes('%')) return { pages: 0, minutes: 0 };
    return { pages: parseInt(s.replace(/[^\d]/g, ''), 10) || 0, minutes: 0 };
  }

  /** "1/3/2024 ~ 31/3/2024" → { from, to } */
  function parsePeriod(v) {
    const [a, b] = String(v ?? '').split(/\s*[~–]\s*/);
    return { from: parseDate(a), to: parseDate(b) };
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
    const size = parseSize(g('totalPages'));
    const totalPages = size.pages;
    const period = map.period ? parsePeriod(g('period')) : { from: null, to: null };
    const dateCompleted = parseDate(g('dateCompleted')) || period.to;
    const dateStarted = parseDate(g('dateStarted')) || period.from;
    let status = parseStatus(g('status'));
    if (!status) status = dateCompleted ? 'completed' : dateStarted ? 'reading' : 'wishlist';
    let readPages = parseInt0(g('readPages'));
    if (status === 'completed' && totalPages) readPages = totalPages;
    if (totalPages) readPages = Math.min(readPages, totalPages);
    const rawTags = g('tags');
    const tags = (rawTags.includes('#') ? LK.books.splitList(rawTags.replace(/#/g, ',').replace(/\s+/g, ',')) : LK.books.splitList(rawTags)).filter((t) => !/^(to-read|read|currently-reading)$/i.test(t));
    const genres = LK.books.splitList(g('genres'));

    let format = map.format ? parseFormat(g('format')) : 'paper';
    if (size.minutes && format === 'paper') format = 'audio';
    const audio = format === 'audio';

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
      format,
      ...(audio && size.minutes ? { totalMinutes: size.minutes, listenPos: status === 'completed' ? size.minutes : null } : {}),
      publisher: g('publisher'),
      year: g('year').match(/\d{4}/)?.[0] || '',
    };
  }

  const keyOf = (b) => u.norm(b.title) + '|' + u.norm((b.author || '').split(/[,;]/)[0]);

  /* ---------- Vista ---------- */

  LK.views.importar = async () => {
    const existing = await LK.db.getBooks();
    const haveIsbn = new Set(existing.map((b) => LK.books.isbn.normalize(b.isbn)).filter(Boolean));
    const haveKey = new Set(existing.map(keyOf));
    const byIsbn = new Map(existing.filter((b) => b.isbn).map((b) => [LK.books.isbn.normalize(b.isbn), b]));
    const byKey = new Map(existing.map((b) => [keyOf(b), b]));

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
          const updates = []; // libros que ya tienes y a los que les faltan datos que trae el archivo
          for (const b of books) {
            const k = keyOf(b);
            b.dup = (b.isbn && haveIsbn.has(b.isbn)) || haveKey.has(k) || seen.has(k);
            const ex = (b.isbn && byIsbn.get(b.isbn)) || byKey.get(k);
            if (b.dup && ex && !seen.has(k)) {
              const patch = {};
              if (!ex.publisher && b.publisher) patch.publisher = b.publisher;
              if (ex.format === 'audio' && !ex.totalMinutes && b.totalMinutes) patch.totalMinutes = b.totalMinutes;
              if (Object.keys(patch).length) updates.push({ ex, patch });
            }
            seen.add(k);
          }
          return { books, skipped, updates };
        }

        function renderStep(fileName) {
          const { books, skipped, updates } = analyse();
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
                        <div class="muted small">${u.esc(LK.books.statusLabel(b.status))}${b.totalPages ? ` · ${b.totalPages} págs.` : ''}${b.totalMinutes ? ` · ${Math.floor(b.totalMinutes / 60)} h ${b.totalMinutes % 60} min de audio` : ''}${b.rating ? ` · ${'★'.repeat(b.rating)}` : ''}${b.dateCompleted ? ` · ${u.fmtDate(b.dateCompleted)}` : ''}${b.series ? ` · ${u.esc(b.series)}${b.seriesNo ? ' #' + b.seriesNo : ''}` : ''}${b.dup ? ' · <span class="chip chip-warn">ya lo tienes</span>' : ''}</div></li>`
                    )
                    .join('')}</ul>`
                : '<p class="chip chip-warn">Elige qué columna es el título.</p>'}
              <div class="tiles imp-tiles">
                <div class="card tile"><div class="tile-value">${fresh.length}</div><div class="tile-label">libros nuevos</div></div>
                <div class="card tile"><div class="tile-value">${byStatus('completed')}</div><div class="tile-label">leídos</div></div>
                <div class="card tile"><div class="tile-value">${byStatus('reading')}</div><div class="tile-label">leyendo</div></div>
                <div class="card tile"><div class="tile-value">${byStatus('wishlist')}</div><div class="tile-label">pendientes</div></div>
              </div>
              ${updates.length ? `<p class="small">✨ ${updates.length} libros que ya tienes se completarán con datos que trae el archivo (editorial, duración).</p>` : ''}
              ${dupes ? `<p class="muted small">${dupes} ya están en tu biblioteca (o repetidos en el archivo) y se omitirán.</p>` : ''}
              ${skipped ? `<p class="muted small">${skipped} filas sin título se ignoran.</p>` : ''}

              <label class="check"><input type="checkbox" id="imp-enrich" checked>
                <span>Completar portadas, páginas y géneros desde internet <span class="muted small">(tarda un poco; los géneros alimentan tus atributos)</span></span></label>

              <div class="row">
                <button class="btn btn-primary" id="imp-go" ${(fresh.length || updates.length) && map.title ? '' : 'disabled'}>${fresh.length ? `Importar ${fresh.length} libros${updates.length ? ` y completar ${updates.length}` : ''}` : `Completar ${updates.length} libros`}</button>
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
          $step.querySelector('#imp-go').addEventListener('click', () => run(fresh, updates));
        }

        async function run(list, updates = []) {
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
          for (const { ex, patch } of updates) await LK.db.saveBook({ ...ex, ...patch }, { silent: true });
          await LK.db.saveBooks(records);
          LK.app.refreshPlayer();

          if (!enrich || !records.length) return done($prog, records.length, 0, 0, updates.length);

          $prog.innerHTML = `<div class="progress progress-lg"><span style="width:2%"></span></div>
            <p class="muted small" id="imp-ptext">Completando datos… 0 de ${records.length}</p>
            <p class="muted small" id="imp-ptitle"></p>`;
          const bar = $prog.querySelector('.progress span');
          const text = $prog.querySelector('#imp-ptext');
          const ttl = $prog.querySelector('#imp-ptitle');
          const release = LK.ach.hold();
          let i = 0;
          let n = 0;
          let improved = 0;
          let covers = 0;
          const paint = () => {
            bar.style.width = `${Math.max(2, Math.round((n / records.length) * 100))}%`;
            text.textContent = `Completando datos… ${n} de ${records.length} · ${covers} portadas`;
          };
          const worker = async () => {
            while (i < records.length) {
              const book = records[i++];
              if (!document.body.contains($prog)) return; // se salió de la pantalla
              ttl.textContent = book.title;
              try {
                const { patch, answered } = await LK.api.enrichDetailed(book);
                const upd = { ...(patch || {}) };
                if (answered && !patch?.coverUrl) upd.coverTriedAt = Date.now();
                if (Object.keys(upd).length) {
                  Object.assign(book, upd);
                  await LK.db.saveBook(book, { silent: true });
                  if (patch?.coverUrl) {
                    covers++;
                    LK.db.cacheCover(book.id, patch.coverUrl);
                  }
                  if (patch) improved++;
                }
              } catch {}
              n++;
              paint();
            }
          };
          await Promise.all([worker(), worker(), worker()]);
          LK.app.refreshPlayer();
          await release();
          if (document.body.contains($prog)) done($prog, records.length, improved, 1, updates.length, covers);
        }

        function done($prog, total, improved, enriched, updated = 0, covers = 0) {
          $prog.innerHTML = `
            <div class="card banner-ok">
              <strong>✓ ${total} libros importados${updated ? ` y ${updated} completados` : ''}</strong>
              ${enriched ? `<p class="small">${improved} se han completado con datos de internet · ${covers} portadas encontradas.</p>${covers < total ? '<p class="muted small">Las que falten: Ajustes → «Buscar portadas que faltan», o pon la portada a mano desde la ficha del libro.</p>' : ''}` : ''}
              <div class="row"><a class="btn btn-primary" href="#/biblioteca/all">Ver mi biblioteca</a></div>
            </div>`;
          u.toast(`${total} libros importados`);
        }
      },
    };
  };

  // Para pruebas y para reutilizar desde fuera
  LK.importer = { autoMap, convertRow, parseDate, parseStatus, splitSeries, parseSize, parsePeriod };
})(window.LK);
