/* ==========================================================
   VISTA: BUSCAR   #/buscar/<consulta>
   Busca en los catálogos, añade a una estantería o crea un
   libro a mano.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  LK.views = LK.views || {};

  const STATUS_OPTIONS = [
    ['wishlist', 'Pendiente'],
    ['reading', 'Leyendo'],
    ['completed', 'Leído'],
  ];
  const statusSelect = (name = 'status', selected = 'wishlist') =>
    `<select class="select" name="${name}" aria-label="Estantería">${STATUS_OPTIONS.map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

  const formatSelect = (name = 'format', selected = 'paper') =>
    `<select class="select" name="${name}" aria-label="Formato">${Object.entries(LK.books.FORMATS).map(([v, l]) => `<option value="${v}" ${v === selected ? 'selected' : ''}>${LK.books.FORMAT_ICONS[v]} ${l}</option>`).join('')}</select>`;

  let lastResults = []; // resultados de la última búsqueda, por id

  function resultCard(r, owned) {
    const cover = r.coverUrl
      ? `<img class="result-cover" src="${u.esc(r.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<div class="result-cover result-cover-fallback">Sin portada</div>`;
    const meta = [r.author, r.year, r.totalPages ? `${r.totalPages} págs.` : null].filter(Boolean).map(u.esc).join(' · ');
    const stats = LK.rpg.statsForGenres(r.genres);
    const chips = [
      ...stats.map((s) => `<span class="chip chip-accent">${LK.rpg.statName(s)}</span>`),
      ...(r.genres || []).slice(0, 2).map((g) => `<span class="chip">${u.esc(g)}</span>`),
      r.totalPages ? '' : '<span class="chip chip-warn">Sin nº de páginas</span>',
    ].join('');

    const actions = owned
      ? `<a class="btn btn-sm" href="#/libro/${encodeURIComponent(r.id)}">En tu biblioteca · Ver ficha</a>`
      : `<form class="result-actions" data-add="${u.esc(r.id)}">
           ${statusSelect()}
           ${formatSelect()}
           <button class="btn btn-primary btn-sm" type="submit">+ Añadir</button>
         </form>`;

    return `
      <article class="card result">
        ${cover}
        <div>
          <h3>${u.esc(r.title)}${r.subtitle ? `<span class="muted">: ${u.esc(r.subtitle)}</span>` : ''}</h3>
          <div class="result-meta">${meta}</div>
          <div class="chips">${chips}</div>
          ${actions}
        </div>
      </article>`;
  }

  const manualForm = `
    <details class="card disclosure" id="manual-box">
      <summary>¿No lo encuentras? Añádelo a mano</summary>
      <form id="manual-form" class="form-grid">
        <label class="field span-all"><span>Título *</span><input class="input" name="title" required></label>
        <label class="field"><span>Autor</span><input class="input" name="author"></label>
        <label class="field"><span>Páginas</span><input class="input" name="pages" type="number" min="0" inputmode="numeric"></label>
        <label class="field span-all"><span>Géneros (separados por comas)</span><input class="input" name="genres" placeholder="Fantasía, Terror"></label>
        <label class="field span-all"><span>URL de la portada (opcional)</span><input class="input" name="cover" type="url" placeholder="https://…"></label>
        <label class="field"><span>ISBN (opcional)</span><input class="input" name="isbn" inputmode="numeric"></label>
        <label class="field"><span>Formato</span>${formatSelect()}</label>
        <label class="field"><span>Estantería</span>${statusSelect()}</label>
        <div class="field" style="justify-content:flex-end"><button class="btn btn-primary" type="submit">Añadir libro</button></div>
      </form>
    </details>`;

  /** Guarda un libro nuevo con los datos de estado correctos. */
  async function addBook(data, status) {
    const today = u.isoDate();
    const book = await LK.db.saveBook({
      ...data,
      status,
      dateStarted: status !== 'wishlist' ? today : null,
      dateCompleted: status === 'completed' ? today : null,
      readPages: status === 'completed' ? data.totalPages || 0 : 0,
    });
    LK.db.cacheCover(book.id, book.coverUrl); // en segundo plano
    if (status === 'completed') LK.app.refreshPlayer(); // el bonus de libro terminado suma EXP
    return book;
  }

  LK.views.buscar = async (query = '') => {
    return {
      html: `
        <div class="page-head"><h1>Buscar</h1></div>
        <div class="stack">
          <form class="search-bar" id="search-form" role="search">
            <input class="input" type="search" name="q" value="${u.esc(query)}" placeholder="Título, autor o ISBN" autocomplete="off" enterkeyhint="search" aria-label="Buscar libros">
            <button class="btn btn-primary" type="submit">Buscar</button>
          </form>
          <div class="row">
            <button class="btn" type="button" id="btn-scan">📷 Escanear código de barras</button>
            <a class="btn" href="#/importar">📥 Importar de Bookmory / Goodreads</a>
          </div>
          <div id="results" aria-live="polite">
            ${query.trim() ? '' : '<p class="muted small">Busca en Google Books y Open Library. Si escribes un ISBN, se busca esa edición exacta.</p>'}
          </div>
          ${manualForm}
        </div>`,

      async mount(root) {
        const form = root.querySelector('#search-form');
        const input = form.elements.q;
        const $results = root.querySelector('#results');
        if (!query.trim()) input.focus();

        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const q = input.value.trim();
          if (!q) return;
          const target = `#/buscar/${encodeURIComponent(q)}`;
          if (location.hash === target) runSearch(q);
          else location.hash = target;
        });

        // Añadir un resultado
        $results.addEventListener('submit', async (e) => {
          const f = e.target.closest('[data-add]');
          if (!f) return;
          e.preventDefault();
          const r = lastResults.find((x) => x.id === f.dataset.add);
          if (!r) return;
          f.querySelector('button').disabled = true;
          const book = await addBook({ ...r, format: f.elements.format.value }, f.elements.status.value);
          f.outerHTML = `<a class="btn btn-sm" href="#/libro/${encodeURIComponent(book.id)}">✓ Añadido · Ver ficha</a>`;
          u.toast(`«${book.title}» añadido a tu biblioteca`);
        });

        // Alta manual
        root.querySelector('#manual-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target;
          const title = f.elements.title.value.trim();
          if (!title) return f.elements.title.focus();
          const book = await addBook(
            {
              id: u.uid('man'),
              source: 'manual',
              title,
              author: f.elements.author.value.trim() || 'Autor desconocido',
              totalPages: parseInt(f.elements.pages.value, 10) || 0,
              genres: f.elements.genres.value.split(',').map((g) => g.trim()).filter(Boolean),
              coverUrl: f.elements.cover.value.trim(),
              isbn: LK.books.isbn.normalize(f.elements.isbn.value) || f.elements.isbn.value.trim(),
              format: f.elements.format.value,
            },
            f.elements.status.value
          );
          u.toast(`«${book.title}» añadido a tu biblioteca`);
          location.hash = `#/libro/${encodeURIComponent(book.id)}`;
        });

        const openScan = () =>
          LK.scanner.open({
            onIsbn: (isbn) => {
              u.toast('Código leído');
              location.hash = `#/buscar/${isbn}`;
            },
          });
        root.querySelector('#btn-scan').addEventListener('click', openScan);
        LK.scanHook = openScan;

        async function runSearch(q) {
          $results.innerHTML = '<div class="results"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
          try {
            const [{ results, source }, books] = await Promise.all([LK.api.search(q), LK.db.getBooks()]);
            if (!$results.isConnected) return;
            lastResults = results;
            const owned = new Set(books.map((b) => b.id));
            $results.innerHTML = results.length
              ? `<p class="muted small" style="margin-bottom:.75rem">${results.length} resultados de ${source}</p>
                 <div class="results">${results.map((r) => resultCard(r, owned.has(r.id))).join('')}</div>`
              : `<div class="empty card">Sin resultados para «${u.esc(q)}». Prueba con otro título o añádelo a mano.</div>`;
            if (!results.length) {
              const isbn = LK.books.isbn.normalize(q);
              const box = root.querySelector('#manual-box');
              if (isbn) root.querySelector('#manual-form').elements.isbn.value = isbn;
              if (box) box.open = true;
            }
          } catch (err) {
            if (!$results.isConnected) return;
            $results.innerHTML = `<div class="error-box">${u.esc(err.message)}</div>`;
          }
        }

        if (query) runSearch(query);
      },
    };
  };

  /** #/escanear: abre el buscador con la cámara ya lista. */
  LK.views.escanear = async () => {
    const view = await LK.views.buscar('');
    const mount = view.mount;
    view.mount = async (root) => {
      await mount(root);
      LK.scanHook?.();
    };
    return view;
  };
})(window.LK);
