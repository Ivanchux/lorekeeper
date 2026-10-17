/* ==========================================================
   VISTA: BIBLIOTECA
     #/biblioteca/<estado>        reading | wishlist | completed | abandoned | all
     #/biblioteca/sagas           libros agrupados por saga
     #/biblioteca/prestados       libros prestados o recibidos
     #/biblioteca/etiqueta/<tag>  libros con esa etiqueta
   Arriba: «Hoy» (meta diaria, racha y botón de seguir leyendo)
   y avisos útiles (préstamos, recordatorio, copia de seguridad).
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  LK.views = LK.views || {};

  const SHELVES = [...LK.books.STATUSES, ['all', 'Todos']];
  const SPECIAL = ['sagas', 'prestados', 'etiqueta'];

  const pctOf = (b, listened) => LK.books.progress(b, listened[b.id] || 0).pct;
  const SORTS = {
    recent: ['Recientes', () => (a, b) => (b.lastReadAt || b.updatedAt || 0) - (a.lastReadAt || a.updatedAt || 0)],
    title: ['Título', () => (a, b) => a.title.localeCompare(b.title, 'es')],
    author: ['Autor', () => (a, b) => a.author.localeCompare(b.author, 'es')],
    progress: ['Progreso', (l) => (a, b) => pctOf(b, l) - pctOf(a, l)],
  };

  const getSort = () => {
    try {
      return SORTS[localStorage.getItem('lk-sort')] ? localStorage.getItem('lk-sort') : 'recent';
    } catch {
      return 'recent';
    }
  };

  /* ---------- Avisos descartables ---------- */

  const DKEY = 'lk-dismissed';
  const readDismissed = () => {
    try {
      return JSON.parse(localStorage.getItem(DKEY)) || {};
    } catch {
      return {};
    }
  };
  const isDismissed = (id) => (readDismissed()[id] || 0) > Date.now();
  function dismiss(id, days) {
    const d = readDismissed();
    d[id] = Date.now() + days * 86400000;
    try {
      localStorage.setItem(DKEY, JSON.stringify(d));
    } catch {}
  }

  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  function buildBanners(books, sessions) {
    const out = [];

    const nudge = LK.reminder.nudge(sessions);
    if (nudge && !isDismissed('nudge')) out.push({ id: 'nudge', icon: nudge.icon, text: nudge.text, dismiss: true });

    // Préstamos vencidos o a punto de vencer
    const loans = books.map((b) => ({ b, l: LK.books.loan(b) })).filter((x) => x.l && x.l.daysLeft != null && x.l.daysLeft <= 2);
    loans.sort((a, b) => a.l.daysLeft - b.l.daysLeft);
    loans.slice(0, 2).forEach(({ b, l }) =>
      out.push({ icon: '🤝', cls: l.overdue ? 'warn' : '', text: `<strong>${u.esc(b.title)}</strong>: ${u.esc(l.text)}`, href: `#/libro/${encodeURIComponent(b.id)}`, cta: 'Ver' })
    );

    // Copia de seguridad
    if (!LK.sync.isOn() && books.length >= 3 && !isDismissed('backup')) {
      let last = 0;
      try {
        last = Number(localStorage.getItem('lk-lastbackup')) || 0;
      } catch {}
      const since = last || Math.min(...books.map((b) => (b.dateAdded ? u.parseISO(b.dateAdded).getTime() : Date.now())));
      if (Date.now() - since > 14 * 86400000) {
        out.push({ id: 'backup', icon: '💾', text: last ? `Hace ${Math.round((Date.now() - last) / 86400000)} días de tu última copia de seguridad.` : 'Aún no has hecho ninguna copia de seguridad.', href: '#/ajustes', cta: 'Hacerla', dismiss: true });
      }
    }

    // Instalar
    if (!isStandalone() && isIOS() && location.protocol.startsWith('http') && !isDismissed('ios-split')) {
      // En iPhone, Safari y la app de la pantalla de inicio no comparten datos: si se mezclan, parece que se pierden
      out.push({
        id: 'ios-split',
        icon: '📲',
        cls: 'warn',
        text: 'Estás en Safari. En iPhone, la app de la pantalla de inicio guarda sus datos aparte: lo que apuntes aquí no aparecerá allí. Elige una y usa siempre esa (para instalarla: Compartir → «Añadir a pantalla de inicio»).',
        dismiss: true,
      });
    } else if (!isStandalone() && !isDismissed('install') && books.length >= 1 && LK.installPrompt) {
      out.push({ id: 'install', icon: '📲', text: 'Instala LoreKeeper en tu móvil: se abre como una app, también sin conexión.', action: 'install', cta: 'Instalar', dismiss: true });
    }
    return out;
  }

  /* ---------- «Hoy» ---------- */

  function todayCard(books, sessions, profile, covers) {
    const today = u.isoDate();
    const mine = sessions.filter((s) => s.date === today);
    const minutes = mine.reduce((a, s) => a + (s.durationMinutes || 0), 0);
    const pages = mine.reduce((a, s) => a + (s.pagesRead || 0), 0);
    const goal = profile.dailyGoal || { type: 'minutes', value: 0 };
    const done = goal.type === 'pages' ? pages : minutes;
    const unit = goal.type === 'pages' ? 'págs.' : 'min';
    const pct = goal.value ? Math.min(100, Math.round((done / goal.value) * 100)) : 0;
    const streak = LK.ach.streak(sessions);
    const timer = LK.timer.current();

    const current = timer
      ? books.find((b) => b.id === timer.bookId)
      : books.filter((b) => b.status === 'reading').sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))[0];

    let cta;
    if (timer) cta = `<button class="btn btn-primary btn-lg" id="today-cta" data-mode="open">⏱ Volver a la sesión en marcha</button>`;
    else if (current) cta = `<button class="btn btn-primary btn-lg" id="today-cta" data-mode="start" data-id="${u.esc(current.id)}">${LK.timer.startLabel(current, true)}<span class="cta-sub">${u.esc(current.title)}</span></button>`;
    else cta = `<a class="btn btn-primary btn-lg" href="#/buscar">＋ Añadir un libro para leer</a>`;

    const status = !goal.value
      ? `<strong>${minutes ? u.fmtDuration(minutes) : 'Nada aún'}</strong> hoy`
      : pct >= 100
        ? '<strong>¡Meta de hoy cumplida!</strong> 🎉'
        : `<strong>${done} de ${goal.value} ${unit}</strong> hoy`;

    return `
      <section class="card today">
        <div class="today-top">
          ${goal.value ? LK.ui.ring(pct, { size: 68, label: pct >= 100 ? '✓' : `${pct}%`, title: `Meta diaria al ${pct}%` }) : ''}
          <div class="today-text">
            <div class="today-kicker">Hoy</div>
            <div class="today-status">${status}</div>
            <div class="muted small">${streak ? `<span class="flame" aria-hidden="true">🔥</span> ${streak} ${streak === 1 ? 'día' : 'días'} seguidos` : 'Lee o escucha un rato hoy para empezar una racha'}</div>
          </div>
        </div>
        ${cta}
      </section>`;
  }

  /* ---------- Pantallas vacías y piezas ---------- */

  function welcome() {
    const demo = { title: 'Tu primer libro', author: 'LoreKeeper', totalPages: 320 };
    return `
      <section class="card hero">
        ${LK.book3d.scene(demo, '')}
        <div class="hero-info">
          <div class="hero-kicker">Bienvenida</div>
          <h2>Tu biblioteca está vacía</h2>
          <p class="muted">Añade tu primer libro de la forma que te resulte más cómoda.</p>
          <div class="start-options">
            <a class="btn btn-primary btn-lg" href="#/buscar">🔎 Buscar por título o autor</a>
            <a class="btn btn-lg" href="#/escanear">📷 Escanear el código de barras</a>
            <a class="btn btn-lg" href="#/importar">📥 Traer mis libros de Bookmory o Goodreads</a>
          </div>
        </div>
      </section>`;
  }

  function sagasView(books, covers, listened) {
    const groups = LK.books.seriesGroups(books);
    if (!groups.length) {
      return `<div class="empty card"><p>Aún no hay sagas.</p><p class="muted small">En la ficha de un libro, en «Editar datos», escribe el nombre de la saga y el número.</p></div>`;
    }
    return groups
      .map(
        (g) => `
        <section class="card saga">
          <div class="card-head"><h2>${u.esc(g.name)}</h2><span class="muted small">${g.done} de ${g.total} leídos</span></div>
          <div class="progress"><span style="width:${Math.round((g.done / g.total) * 100)}%"></span></div>
          <div class="shelf-wrap"><div class="shelf">${g.books.map((b) => LK.ui.shelfItem(b, covers[b.id], listened[b.id])).join('')}</div></div>
        </section>`
      )
      .join('');
  }

  function randomPick(books, covers) {
    const pool = books.filter((b) => b.status === 'wishlist');
    if (!pool.length) return u.toast('No tienes libros pendientes. ¡Añade alguno!');
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const d = u.modal(`
      <h2>¿Qué tal este?</h2>
      ${LK.book3d.scene(pick, covers[pick.id])}
      <p style="text-align:center"><strong>${u.esc(pick.title)}</strong><br><span class="muted">${u.esc(pick.author)}</span>${pick.totalPages ? `<br><span class="muted small">${pick.totalPages} páginas</span>` : ''}</p>
      <div class="modal-actions">
        <button class="btn" data-again>Otro</button>
        <a class="btn" href="#/libro/${encodeURIComponent(pick.id)}" data-close>Ver ficha</a>
        <button class="btn btn-primary" data-go>▶ Empezar a leer</button>
      </div>`);
    LK.book3d.spin(d.querySelector('.b3d-scene'));
    d.querySelector('[data-go]').addEventListener('click', () => {
      d.close();
      LK.timer.start(pick);
    });
    d.querySelector('[data-again]').addEventListener('click', () => {
      d.close();
      randomPick(books, covers);
    });
  }

  /* ---------- Vista ---------- */

  const PAGE = 30; // libros que se pintan de golpe: con cientos, los 3D pesan

  LK.views.biblioteca = async (filterParam, extra) => {
    const [books, sessions, profile] = await Promise.all([LK.db.getBooks(), LK.db.getSessions(), LK.db.getProfile()]);
    if (!books.length) return { html: welcome(), mount: (root) => LK.book3d.spin(root.querySelector('.b3d-scene')) };

    const listened = LK.books.listenedMap(sessions);
    const counts = Object.fromEntries(SHELVES.map(([id]) => [id, id === 'all' ? books.length : books.filter((b) => b.status === id).length]));
    const lentCount = books.filter((b) => LK.books.loan(b)).length;
    const tags = LK.books.tagCounts(books);
    const sagaCount = LK.books.seriesGroups(books).length;

    const special = SPECIAL.includes(filterParam) ? filterParam : null;
    const filter = special ? null : SHELVES.some(([id]) => id === filterParam) ? filterParam : counts.reading ? 'reading' : 'all';
    const sortKey = getSort();

    let list;
    let featured = null;
    let title = '';
    if (special === 'prestados') list = books.filter((b) => LK.books.loan(b));
    else if (special === 'etiqueta') list = books.filter((b) => (b.tags || []).includes(extra));
    else if (special === 'sagas') list = books;
    else list = filter === 'all' ? books.slice() : books.filter((b) => b.status === filter);
    list.sort(SORTS[sortKey][1](listened));

    if (filter === 'reading' && list.length) {
      featured = list.slice().sort(SORTS.recent[1]())[0];
      list = list.filter((b) => b !== featured);
    }
    const covers = await LK.db.coverMap(featured ? [featured, ...list] : list);

    const tabs = SHELVES.map(([id, label]) => `<a href="#/biblioteca/${id}" ${id === filter ? 'aria-current="page"' : ''}>${label}<span class="count">${counts[id]}</span></a>`).join('');
    const more = [
      sagaCount ? `<a href="#/biblioteca/sagas" ${special === 'sagas' ? 'aria-current="page"' : ''}>Sagas<span class="count">${sagaCount}</span></a>` : '',
      lentCount ? `<a href="#/biblioteca/prestados" ${special === 'prestados' ? 'aria-current="page"' : ''}>Prestados<span class="count">${lentCount}</span></a>` : '',
    ].join('');
    const tagBar = tags.length
      ? `<div class="chips tagbar adv" aria-label="Etiquetas">${tags
          .slice(0, 14)
          .map((t) => `<a class="chip ${special === 'etiqueta' && extra === t.tag ? 'chip-accent' : ''}" href="#/biblioteca/etiqueta/${encodeURIComponent(t.tag)}">#${u.esc(t.tag)} <span class="muted">${t.count}</span></a>`)
          .join('')}</div>`
      : '';

    const sortSelect = `
      <label class="row small muted adv">Ordenar
        <select class="select" id="sort" style="width:auto;min-height:34px;padding:.2rem .5rem">
          ${Object.entries(SORTS).map(([k, [label]]) => `<option value="${k}" ${k === sortKey ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>`;

    let body;
    if (special === 'sagas') body = sagasView(books, await LK.db.coverMap(books), listened);
    else {
      const label = special === 'prestados' ? 'Prestados' : special === 'etiqueta' ? `#${extra}` : SHELVES.find(([id]) => id === filter)[1];
      body = list.length
        ? `<div class="shelf-wrap"><div class="shelf">${list.slice(0, PAGE).map((b) => LK.ui.shelfItem(b, covers[b.id], listened[b.id])).join('')}</div></div>
           ${list.length > PAGE ? `<button class="btn btn-block" id="shelf-more">Mostrar más libros (${list.length - PAGE})</button>` : ''}`
        : featured
          ? ''
          : `<div class="empty card">No hay libros en «${u.esc(label)}».</div>`;
      title = label;
    }

    const heroHtml = featured ? heroCard(featured, covers[featured.id], listened[featured.id]) : '';
    const banners = LK.ui.banners(buildBanners(books, sessions));

    return {
      html: `
        <div class="page-head">
          <h1>Biblioteca</h1>
          ${sortSelect}
        </div>
        ${banners}
        ${todayCard(books, sessions, profile, covers)}
        <div class="lib-tools">
          <input class="input" type="search" id="lib-q" placeholder="Buscar en mi biblioteca…" aria-label="Buscar en mi biblioteca" autocomplete="off">
          ${counts.wishlist ? '<button class="btn" id="btn-random" title="Elegir un pendiente al azar">🎲 ¿Qué leo ahora?</button>' : ''}
        </div>
        <nav class="segmented" aria-label="Estanterías">${tabs}${more}</nav>
        ${tagBar}
        <div class="stack" style="margin-top:1.25rem">
          ${heroHtml}
          ${featured && list.length ? '<h2>También leyendo</h2>' : ''}
          ${body}
        </div>`,

      mount(root) {
        root.querySelectorAll('.b3d-scene').forEach((s) => LK.book3d.spin(s));
        root.querySelector('#sort')?.addEventListener('change', (e) => {
          try {
            localStorage.setItem('lk-sort', e.target.value);
          } catch {}
          LK.app.refresh();
        });

        root.querySelectorAll('[data-start]').forEach((btn) => btn.addEventListener('click', async () => LK.timer.start(await LK.db.getBook(btn.dataset.start))));
        root.querySelectorAll('[data-log]').forEach((btn) => btn.addEventListener('click', async () => LK.timer.logSession(await LK.db.getBook(btn.dataset.log))));

        const cta = root.querySelector('#today-cta');
        cta?.addEventListener('click', async () => {
          if (cta.dataset.mode === 'open') LK.timer.open();
          else LK.timer.start(await LK.db.getBook(cta.dataset.id));
        });

        root.querySelector('#btn-random')?.addEventListener('click', () => randomPick(books, covers));

        // Filtro instantáneo
        // Se pintan por tandas; al buscar se filtra entre todos los de la estantería
        const q = root.querySelector('#lib-q');
        const shelf = root.querySelector('.shelf');
        const moreBtn = root.querySelector('#shelf-more');
        const item = (b) => LK.ui.shelfItem(b, covers[b.id], listened[b.id]);
        const hayOf = (b) => u.norm([b.title, b.author, b.series, ...(b.tags || [])].join(' '));
        let shown = Math.min(PAGE, list.length);
        const updateMore = (searching) => {
          if (!moreBtn) return;
          moreBtn.hidden = searching || shown >= list.length;
          moreBtn.textContent = `Mostrar más libros (${list.length - shown})`;
        };
        moreBtn?.addEventListener('click', () => {
          const next = list.slice(shown, shown + PAGE);
          shelf.insertAdjacentHTML('beforeend', next.map(item).join(''));
          shown += next.length;
          updateMore(false);
        });
        let searching = false;
        q.addEventListener('input', () => {
          const needle = u.norm(q.value);
          if (!shelf) return;
          if (needle) {
            searching = true;
            const hits = list.filter((b) => hayOf(b).includes(needle));
            shelf.innerHTML = hits.slice(0, 60).map(item).join('') || '<p class="muted" style="grid-column:1/-1;text-align:center">Ningún libro coincide.</p>';
            updateMore(true);
          } else if (searching) {
            searching = false;
            shelf.innerHTML = list.slice(0, shown).map(item).join('');
            updateMore(false);
          }
        });

        // Avisos
        root.querySelector('.banners')?.addEventListener('click', async (e) => {
          const d = e.target.closest('[data-banner-dismiss]');
          if (d) {
            dismiss(d.dataset.bannerDismiss, d.dataset.bannerDismiss === 'install' ? 30 : d.dataset.bannerDismiss === 'backup' ? 7 : 1);
            d.closest('.banner').remove();
          }
          if (e.target.closest('[data-banner-act="install"]') && LK.installPrompt) {
            LK.installPrompt.prompt();
            await LK.installPrompt.userChoice.catch(() => {});
            LK.installPrompt = null;
            LK.app.refresh();
          }
        });
      },
    };
  };

  function heroCard(book, src, listenedMin) {
    const pr = LK.books.progress(book, listenedMin);
    const stats = LK.rpg.statsForBook(book).map((s) => `<span class="chip chip-accent">${LK.rpg.statName(s)}</span>`).join('');
    return `
      <section class="card hero">
        ${LK.book3d.scene(book, src)}
        <div class="hero-info">
          <div class="hero-kicker">Leyendo ahora ${LK.ui.formatBadge(book)}</div>
          <h2>${u.esc(book.title)}</h2>
          <p class="muted">${u.esc(book.author)}${book.series ? ` · ${LK.ui.seriesLabel(book)}` : ''}</p>
          ${stats ? `<div class="chips rpg-only" style="margin-bottom:1rem">${stats}</div>` : ''}
          ${pr.total
            ? `<div class="progress progress-lg"><span style="width:${pr.pct}%"></span></div>
               <div class="progress-label"><span>${pr.text}</span><span>${pr.pct}%</span></div>`
            : `<p class="muted small">${pr.text}</p>`}
          <div class="hero-actions">
            <button class="btn btn-primary" data-start="${u.esc(book.id)}">${LK.timer.startLabel(book)}</button>
            ${LK.books.isAudio(book) && LK.timer.enabled() ? `<button class="btn" data-log="${u.esc(book.id)}">＋ Registrar escucha</button>` : ''}
            <a class="btn" href="#/libro/${encodeURIComponent(book.id)}">Ver ficha</a>
          </div>
        </div>
      </section>`;
  }
})(window.LK);
