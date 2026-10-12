/* ==========================================================
   PANTALLAS PEQUEÑAS
     #/logros               insignias
     #/resumen/<año>        «Tu año en libros» (ver y compartir)
     #/empezar              atajo: empieza sesión con el libro actual
     #/enlazar/<url>/<cód>  conecta este dispositivo a la sincronización
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  LK.views = LK.views || {};

  /* ---------------- Logros ---------------- */

  LK.views.logros = async () => {
    const list = (await LK.ach.compute()).filter((a) => LK.prefs.get('rpg') || !a.rpg);
    const done = list.filter((a) => a.done).length;
    return {
      html: `
        <a class="btn btn-ghost btn-sm" href="#/estadisticas" style="margin-bottom:.75rem">← Estadísticas</a>
        <div class="page-head"><h1>Logros</h1><span class="muted">${done} de ${list.length}</span></div>
        <div class="ach-grid">
          ${list
            .map(
              (a) => `
            <article class="ach ${a.done ? 'done' : ''}" aria-label="${u.esc(a.name)}${a.done ? ' (conseguido)' : ''}">
              <div class="ach-icon" aria-hidden="true">${a.icon}</div>
              <div>
                <strong>${u.esc(a.name)}</strong>
                <div class="muted small">${u.esc(a.desc)}</div>
                ${a.done ? '' : `<div class="progress" style="margin-top:.4rem"><span style="width:${Math.round((a.cur / a.max) * 100)}%"></span></div><div class="muted small">${u.fmtNum(a.cur)} / ${u.fmtNum(a.max)}</div>`}
              </div>
            </article>`
            )
            .join('')}
        </div>`,
    };
  };

  /* ---------------- Tu año en libros ---------------- */

  const bar = (value, max) => `<span class="mbar"><i style="height:${max ? Math.max(value ? 6 : 0, Math.round((value / max) * 100)) : 0}%"></i></span>`;

  LK.views.resumen = async (yearParam, extra) => {
    const [books, sessions, profile] = await Promise.all([LK.db.getBooks(), LK.db.getSessions(), LK.db.getProfile()]);
    const years = LK.summary.years(books, sessions);
    const year = Number(yearParam) || years[0] || new Date().getFullYear();
    const sm = LK.summary.compute(year, books, sessions, profile);
    const covers = await LK.db.coverMap(sm.books);
    const maxP = Math.max(...sm.pagesByMonth, 0);
    const yearTabs = (years.includes(year) ? years : [year, ...years]).map((y) => `<a href="#/resumen/${y}" ${y === year ? 'aria-current="page"' : ''}>${y}</a>`).join('');

    if (sm.empty) {
      return {
        html: `
          <a class="btn btn-ghost btn-sm" href="#/estadisticas" style="margin-bottom:.75rem">← Estadísticas</a>
          <div class="page-head"><h1>Tu año en libros</h1></div>
          <nav class="segmented">${yearTabs}</nav>
          <div class="empty card" style="margin-top:1rem"><p>Todavía no hay nada que contar de ${year}.</p><p class="muted small">Registra sesiones o termina libros y aquí aparecerá tu resumen.</p></div>`,
      };
    }

    const facts = [
      sm.longest && ['📏', 'El más largo', `${u.esc(sm.longest.title)} (${sm.longest.totalPages} págs.)`],
      sm.shortest && sm.shortest !== sm.longest && ['⚡', 'El más corto', `${u.esc(sm.shortest.title)} (${sm.shortest.totalPages} págs.)`],
      sm.topAuthor && ['✍️', 'Autor/a del año', `${u.esc(sm.topAuthor.name)} (${sm.topAuthor.count} libros)`],
      sm.bestMonth && ['📆', 'Tu mejor mes', `${sm.bestMonth.label} · ${u.fmtNum(sm.bestMonth.pages)} páginas`],
      sm.avgRating && ['⭐', 'Valoración media', `${sm.avgRating.toFixed(1).replace('.', ',')} sobre 5 (${sm.ratedCount} valorados)`],
      sm.pace && ['🏃', 'Tu ritmo', `${sm.pace} páginas por hora`],
      sm.audioMinutes && ['🎧', 'Audiolibros', `${u.fmtDuration(sm.audioMinutes)} escuchando`],
      sm.days && ['🗓', sm.audioMinutes ? 'Días leyendo o escuchando' : 'Días leyendo', `${sm.days} días`],
      sm.topAttr && LK.prefs.get('rpg') && ['🧙', 'Atributo más entrenado', `${LK.rpg.statName(sm.topAttr.id)} (${sm.topAttr.count} libros)`],
    ].filter(Boolean);

    return {
      html: `
        <a class="btn btn-ghost btn-sm" href="#/estadisticas" style="margin-bottom:.75rem">← Estadísticas</a>
        <div class="page-head"><h1>Tu año en libros</h1></div>
        ${extra === 'nuevo' ? `<div class="card banner-ok" style="margin-bottom:1rem"><strong>🎆 ¡Feliz año nuevo!</strong><p class="small" style="margin:.25rem 0 0">Este es el resumen de tu ${year}. Aparece solo el 1 de enero; después lo tienes siempre en Estadísticas.</p></div>` : ''}
        <nav class="segmented" aria-label="Año">${yearTabs}</nav>

        <div class="stack" style="margin-top:1.25rem">
          <section class="card year-hero">
            <div class="year-num">${year}</div>
            <p class="year-lead">${sm.finished ? `Terminaste <strong>${sm.finished}</strong> ${sm.finished === 1 ? 'libro' : 'libros'}` : 'Un año de lecturas en marcha'}${sm.goal ? ` y tu objetivo era ${sm.goal}${sm.finished >= sm.goal ? ' — <strong>¡cumplido!</strong> 🎉' : '.'}` : '.'}</p>
            <div class="tiles">
              <div class="card tile"><div class="tile-value">${sm.finished}</div><div class="tile-label">libros</div></div>
              <div class="card tile"><div class="tile-value">${u.fmtNum(sm.pages)}</div><div class="tile-label">páginas</div></div>
              <div class="card tile"><div class="tile-value">${sm.hours >= 1 ? Math.round(sm.hours) + ' h' : Math.round(sm.minutes) + ' min'}</div><div class="tile-label">${sm.audioMinutes ? 'leyendo y escuchando' : 'leyendo'}</div></div>
              <div class="card tile"><div class="tile-value">${sm.bestStreak}</div><div class="tile-label">mejor racha (días)</div></div>
            </div>
            <div class="row" style="margin-top:1rem">
              <button class="btn btn-primary" id="share-year">📤 Compartir imagen</button>
              <button class="btn" id="save-year">Descargar</button>
            </div>
          </section>

          ${sm.top.length
            ? `<section class="card">
                <div class="card-head"><h2>${sm.topLabel}</h2></div>
                <div class="shelf-wrap"><div class="shelf">${sm.top.map((b) => LK.ui.shelfItem(b, covers[b.id])).join('')}</div></div>
              </section>`
            : ''}

          <section class="card">
            <div class="card-head"><h2>Mes a mes</h2><span class="muted small">páginas leídas</span></div>
            <div class="mbars" role="img" aria-label="Páginas leídas por mes en ${year}">
              ${sm.pagesByMonth
                .map((v, i) => `<div class="mcol" title="${LK.summary.MONTHS[i]}: ${u.fmtNum(v)} págs., ${sm.finishedByMonth[i]} libros">${bar(v, maxP)}<span class="mlab">${LK.summary.MONTHS[i].slice(0, 3)}</span>${sm.finishedByMonth[i] ? `<span class="mbook">${'📕'.repeat(Math.min(3, sm.finishedByMonth[i]))}</span>` : '<span class="mbook">&nbsp;</span>'}</div>`)
                .join('')}
            </div>
          </section>

          ${LK.rosco.cards(sm.books, { by: ['author', 'genre', 'publisher'] })}

          ${facts.length
            ? `<section class="card"><ul class="list facts">${facts.map(([i, t, v]) => `<li><span aria-hidden="true">${i}</span><div><div class="muted small">${t}</div><strong>${v}</strong></div></li>`).join('')}</ul></section>`
            : ''}
        </div>`,

      mount(root) {
        const make = async () => LK.cards.yearCard(sm, covers);
        const name = `mi-ano-en-libros-${year}.png`;
        root.querySelector('#share-year').addEventListener('click', async (e) => {
          e.target.disabled = true;
          try {
            const res = await u.shareFile(new File([await make()], name, { type: 'image/png' }), { title: `Mi año en libros ${year}`, text: `Mi ${year} en libros 📚` });
            if (res === 'downloaded') u.toast('Imagen descargada');
          } catch {
            u.toast('No se pudo crear la imagen', 'error');
          }
          e.target.disabled = false;
        });
        root.querySelector('#save-year').addEventListener('click', async () => {
          try {
            u.download(name, await make(), 'image/png');
          } catch {
            u.toast('No se pudo crear la imagen', 'error');
          }
        });
      },
    };
  };

  /* ---------------- Atajo: empezar a leer ---------------- */

  LK.views.empezar = async () => {
    if (LK.timer.current()) {
      location.replace('#/biblioteca');
      setTimeout(() => LK.timer.open(), 150);
      return { html: '<p class="muted">Abriendo tu sesión…</p>' };
    }
    const reading = (await LK.db.getBooks()).filter((b) => b.status === 'reading').sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0));
    if (reading.length === 1) {
      location.replace('#/biblioteca');
      setTimeout(() => LK.timer.start(reading[0]), 150);
      return { html: '<p class="muted">Empezando sesión…</p>' };
    }
    if (!reading.length) {
      location.replace('#/buscar');
      return { html: '' };
    }
    const covers = await LK.db.coverMap(reading);
    return {
      html: `
        <div class="page-head"><h1>¿Qué lees ahora?</h1></div>
        <div class="results">${reading
          .map(
            (b) => `<button class="card result pick-book" data-pick="${u.esc(b.id)}">
              <div class="b3d-mini">${LK.book3d.markup(b, covers[b.id], 'sm')}</div>
              <div><h3>${u.esc(b.title)}</h3><div class="result-meta">${u.esc(b.author)}</div></div></button>`
          )
          .join('')}</div>`,
      mount(root) {
        root.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-pick]');
          if (!b) return;
          location.hash = '#/biblioteca';
          LK.timer.start(await LK.db.getBook(b.dataset.pick));
        });
      },
    };
  };

  /* ---------------- Enlace de conexión ---------------- */

  LK.views.enlazar = async (url = '', code = '') => {
    return {
      html: `
        <div class="page-head"><h1>Conectar este dispositivo</h1></div>
        <section class="card stack-sm">
          <p>Vas a sincronizar este dispositivo con:</p>
          <p><strong>${u.esc(url)}</strong></p>
          <p class="muted small">Si aquí ya tienes libros, se fusionan con los del servidor (no se borra nada).</p>
          <p class="small" id="link-msg" style="color:var(--danger)" hidden></p>
          <div class="row">
            <button class="btn btn-primary" id="link-go">Conectar</button>
            <a class="btn btn-ghost" href="#/biblioteca">Cancelar</a>
          </div>
        </section>`,
      mount(root) {
        root.querySelector('#link-go').addEventListener('click', async (e) => {
          e.target.disabled = true;
          try {
            await LK.sync.connect(url, code);
            u.toast('Conectado y sincronizado');
            location.hash = '#/biblioteca';
          } catch (err) {
            const m = root.querySelector('#link-msg');
            m.textContent = err.message;
            m.hidden = false;
            e.target.disabled = false;
          }
        });
      },
    };
  };
})(window.LK);
