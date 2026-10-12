/* ==========================================================
   VISTA: ESTADÍSTICAS   #/estadisticas
   Ficha de personaje (nivel, atributos; se pueden ocultar),
   cifras de lectura, objetivos, calendario, gráfica mensual,
   desglose y accesos a Logros y «Tu año en libros».
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  LK.views = LK.views || {};

  const tile = (value, label) => `<div class="card tile"><div class="tile-value">${value}</div><div class="tile-label">${label}</div></div>`;

  LK.views.estadisticas = async () => {
    const [books, sessions, quotes, profile] = await Promise.all([LK.db.getBooks(), LK.db.getSessions(), LK.db.getQuotes(), LK.db.getProfile()]);
    const p = LK.rpg.compute(books, sessions);
    const year = new Date().getFullYear();
    const weeks = window.innerWidth >= 900 ? 44 : 26; // más semanas en pantallas anchas
    const byId = new Map(books.map((b) => [b.id, b]));
    // Lo importado cuenta en totales y gráficas (repartido entre sus fechas); racha, ritmo y EXP usan solo sesiones reales
    const virtual = LK.books.virtualSessions(books, sessions);
    const all = sessions.concat(virtual);
    const audioSessions = all.filter((s) => LK.audio.isAudioSession(s, byId));
    const audioMinutes = audioSessions.reduce((a, s) => a + (s.durationMinutes || 0), 0);

    const completedThisYear = books.filter((b) => b.status === 'completed' && String(b.dateCompleted || '').startsWith(String(year))).length;
    const totalPages = all.reduce((a, s) => a + (s.pagesRead || 0), 0);
    const totalMinutes = all.reduce((a, s) => a + (s.durationMinutes || 0), 0);
    // Quien escucha más de lo que lee ve el calendario en minutos, salvo que haya elegido otra cosa
    const pref = LK.prefs.get('metric');
    const metric = pref === 'pages' || pref === 'minutes' ? pref : audioMinutes > totalMinutes / 2 ? 'minutes' : 'pages';
    // Ritmo de lectura: solo cuentan las sesiones con páginas (el audio no tiene páginas)
    const paged = sessions.filter((s) => s.durationMinutes > 0 && s.pagesRead > 0);
    const pagedMinutes = paged.reduce((a, s) => a + s.durationMinutes, 0);
    const timedPages = paged.reduce((a, s) => a + s.pagesRead, 0);
    const pace = pagedMinutes && timedPages ? Math.round((timedPages / pagedMinutes) * 60) : 0;
    const goal = profile.yearlyGoal || 0;
    const goalPct = goal ? Math.min(100, Math.round((completedThisYear / goal) * 100)) : 0;
    const streak = LK.ach.streak(sessions);

    // Ritmo para llegar al objetivo
    let pacing = '';
    if (goal && completedThisYear < goal) {
      const dayOfYear = u.daysBetween(`${year}-01-01`, u.isoDate()) + 1;
      const expected = (goal * dayOfYear) / 365;
      const diff = completedThisYear - expected;
      pacing = diff >= 0.5 ? `Vas ${Math.round(diff)} ${Math.round(diff) === 1 ? 'libro' : 'libros'} por delante del ritmo.` : diff <= -1 ? `Vas ${Math.round(-diff)} ${Math.round(-diff) === 1 ? 'libro' : 'libros'} por detrás del ritmo.` : 'Vas justo al ritmo.';
    }

    const attrRows = LK.rpg.STATS.map((s) => {
      const value = p.stats[s.id];
      const next = LK.rpg.PAGES_PER_POINT - (p.statPages[s.id] % LK.rpg.PAGES_PER_POINT);
      const width = Math.min(100, ((p.statPages[s.id] % LK.rpg.PAGES_PER_POINT) / LK.rpg.PAGES_PER_POINT) * 100);
      return `
        <li class="attr-row" title="Faltan ${next} págs. para el siguiente punto">
          <span>${s.name}</span>
          <div class="progress"><span style="width:${width}%"></span></div>
          <span class="num">${value}</span>
          <span class="attr-desc">${s.desc}</span>
        </li>`;
    }).join('');

    // Desglose
    const finished = books.filter((b) => b.status === 'completed');
    const fmtCounts = Object.entries(LK.books.FORMATS)
      .map(([id, label]) => [label, LK.books.FORMAT_ICONS[id], finished.filter((b) => (b.format || 'paper') === id).length])
      .filter((x) => x[2]);
    const rated = finished.filter((b) => b.rating);
    const avg = rated.length ? (rated.reduce((a, b) => a + b.rating, 0) / rated.length).toFixed(1).replace('.', ',') : null;
    const finishedCount = finished.length;

    // Por año, autores y valoraciones
    const byYear = new Map();
    finished.forEach((b) => {
      const y = String(b.dateCompleted || '').slice(0, 4);
      if (y) byYear.set(y, (byYear.get(y) || 0) + 1);
    });
    const yearRows = [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    const authorMap = new Map();
    finished.forEach((b) => {
      const name = String(b.author || '').split(/[,;]/)[0].trim();
      if (!name || /desconocido/i.test(name)) return;
      const e = authorMap.get(name) || { n: 0, r: 0, rn: 0 };
      e.n++;
      if (b.rating) (e.r += b.rating), e.rn++;
      authorMap.set(name, e);
    });
    const authorRows = [...authorMap.entries()].sort((a, b) => b[1].n - a[1].n || b[1].r - a[1].r).slice(0, 6);
    const ratingRows = [5, 4, 3, 2, 1].map((n) => [n, rated.filter((b) => b.rating === n).length]);
    const topTags = LK.books.tagCounts(finished).slice(0, 10);
    const rankBars = (rows, fmt) => {
      const max = Math.max(1, ...rows.map((r) => r[1]));
      return `<ul class="rank-list">${rows.map(([label, n, extra]) => `<li><span class="rank-label">${fmt ? fmt(label) : u.esc(label)}</span><div class="progress"><span style="width:${Math.round((n / max) * 100)}%"></span></div><span class="num">${n}${extra ? ` <small class="muted">${extra}</small>` : ''}</span></li>`).join('')}</ul>`;
    };
    const importedNote = virtual.length ? '<p class="muted small" style="text-align:center">Los libros importados cuentan en el calendario y en los totales, repartidos entre sus fechas de inicio y fin.</p>' : '';

    const ach = await LK.ach.compute({ books, sessions, quotes, profile });
    const unlocked = ach.filter((a) => a.done && (LK.prefs.get('rpg') || !a.rpg));
    const visibleTotal = ach.filter((a) => LK.prefs.get('rpg') || !a.rpg).length;

    const tileList = [
      tile(completedThisYear, `Libros leídos en ${year}`),
      finishedCount > completedThisYear ? tile(u.fmtNum(finishedCount), 'Libros leídos en total') : '',
      totalPages || !audioMinutes ? tile((virtual.length ? '≈ ' : '') + u.fmtNum(totalPages), 'Páginas leídas') : '',
      totalMinutes - audioMinutes > 0 || !audioMinutes ? tile((virtual.length ? '≈ ' : '') + u.fmtDuration(totalMinutes - audioMinutes), 'Tiempo leyendo') : '',
      audioMinutes ? tile(u.fmtDuration(audioMinutes), '🎧 Tiempo escuchando') : '',
      tile(`${streak} ${streak === 1 ? 'día' : 'días'}`, 'Racha actual'),
      pace ? tile(`${pace}`, 'Páginas por hora') : '',
      tile(avg ? `${avg} ★` : '—', 'Valoración media'),
    ].filter(Boolean);
    // El acceso a los gráficos ocupa el hueco que deja la última fila; si no hay hueco, ocupa la fila entera
    const graphTile = `<a class="card tile tile-link" href="#/graficos" ${tileList.length % 2 === 0 ? 'style="grid-column:1/-1"' : ''}><div class="tile-value">🍩</div><div class="tile-label">Gráficos por año, autor, género…</div></a>`;
    const tilesHtml = tileList.join('') + graphTile;

    const html = `
      <div class="page-head"><h1>Estadísticas</h1></div>
      <div class="stack">

        <section class="card player-card rpg-only">
          <div class="level-badge" aria-label="Nivel ${p.level}">${p.level}</div>
          <div>
            <div class="player-title">${u.esc(p.title)}</div>
            <h2 style="margin:.1rem 0 .5rem">${u.esc(profile.name)}</h2>
            <div class="progress progress-lg"><span style="width:${Math.round(p.progress * 100)}%"></span></div>
            <div class="progress-label"><span>${u.fmtNum(p.current)} / ${u.fmtNum(p.needed)} EXP</span><span>${u.fmtNum(p.totalExp)} EXP total</span></div>
          </div>
        </section>

        <section class="card rpg-only">
          <div class="card-head"><h2>Atributos</h2><span class="muted small">+1 cada ${LK.rpg.PAGES_PER_POINT} págs. del género</span></div>
          <div class="attr-layout">
            <div style="max-width:340px;margin:0 auto;width:100%">${LK.charts.radar(p.stats, LK.rpg.STATS)}</div>
            <ul class="attr-list">${attrRows}</ul>
          </div>
        </section>

        <div class="tiles">${tilesHtml}</div>

        <div class="grid-2">
          <section class="card">
            <div class="card-head"><h2>Objetivo ${year}</h2><a class="small" href="#/ajustes">Cambiar</a></div>
            ${goal
              ? `<div class="progress progress-lg"><span style="width:${goalPct}%"></span></div>
                 <div class="progress-label"><span>${completedThisYear} de ${goal} libros</span><span>${goalPct}%</span></div>
                 ${pacing ? `<p class="muted small" style="margin-top:.5rem">${pacing}</p>` : ''}`
              : '<p class="muted small">Sin objetivo. Puedes fijarlo en Ajustes.</p>'}
          </section>
          <a class="card link-card" href="#/resumen/${year}">
            <h2>📅 Tu año en libros</h2>
            <p class="muted small">Un resumen de ${year} para ver y compartir.</p>
          </a>
        </div>

        <a class="card link-card" href="#/logros">
          <div class="card-head"><h2>🏅 Logros</h2><span class="muted small">${unlocked.length} de ${visibleTotal}</span></div>
          <div class="progress"><span style="width:${Math.round((unlocked.length / Math.max(1, visibleTotal)) * 100)}%"></span></div>
          <p class="ach-row" aria-hidden="true">${unlocked.slice(-8).map((a) => `<span title="${u.esc(a.name)}">${a.icon}</span>`).join('') || '<span class="muted small">Aún no tienes ninguno: ¡el primero está cerca!</span>'}</p>
        </a>

        <section class="card">
          <div class="card-head">
            <h2>Calendario de lectura</h2>
            <span class="seg-mini" role="group" aria-label="Medir en">
              <button type="button" data-metric="pages" aria-pressed="${metric === 'pages'}">Páginas</button>
              <button type="button" data-metric="minutes" aria-pressed="${metric === 'minutes'}">Minutos</button>
            </span>
          </div>
          ${LK.charts.heatmap(all, weeks, metric)}
        </section>

        <section class="card">
          <div class="card-head"><h2>${metric === 'minutes' ? 'Minutos' : 'Páginas'} por mes</h2><span class="muted small">Últimos 12 meses</span></div>
          ${LK.charts.monthlyBars(all, 12, metric)}
        </section>

        ${yearRows.length > 1
          ? `<section class="card"><div class="card-head"><h2>Libros por año</h2></div>${rankBars(yearRows)}</section>`
          : ''}

        ${authorRows.length && authorRows[0][1].n > 1
          ? `<section class="card"><div class="card-head"><h2>Autores que más lees</h2></div>${rankBars(authorRows.map(([n, e]) => [n, e.n, e.rn ? `${(e.r / e.rn).toFixed(1).replace('.', ',')} ★` : '']))}</section>`
          : ''}

        ${rated.length > 4
          ? `<section class="card"><div class="card-head"><h2>Tus valoraciones</h2><span class="muted small">${avg} ★ de media</span></div>${rankBars(ratingRows, (n) => '★'.repeat(n))}</section>`
          : ''}

        ${topTags.length
          ? `<section class="card"><div class="card-head"><h2>Lo que más lees</h2></div><div class="chips">${topTags.map((t) => `<a class="chip chip-lg" href="#/biblioteca/etiqueta/${encodeURIComponent(t.tag)}">#${u.esc(t.tag)} <strong>${t.count}</strong></a>`).join('')}</div></section>`
          : ''}

        ${fmtCounts.length
          ? `<section class="card">
              <div class="card-head"><h2>Libros terminados por formato</h2></div>
              <div class="row">${fmtCounts.map(([l, i, n]) => `<span class="chip chip-lg">${i} ${l}: <strong>${n}</strong></span>`).join('')}</div>
            </section>`
          : ''}

        ${importedNote}
        ${all.length ? '' : '<p class="muted small" style="text-align:center">Las gráficas se llenan a medida que registras sesiones de lectura.</p>'}
      </div>`;

    return {
      html,
      mount(root) {
        // En pantallas estrechas, el calendario empieza mostrando las semanas más recientes
        root.querySelectorAll('.chart-scroll').forEach((el) => (el.scrollLeft = el.scrollWidth));
        root.querySelectorAll('[data-metric]').forEach((b) =>
          b.addEventListener('click', () => {
            LK.prefs.set({ metric: b.dataset.metric });
            LK.app.render();
          })
        );
      },
    };
  };
})(window.LK);
