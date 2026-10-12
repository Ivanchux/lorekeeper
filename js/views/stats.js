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
    const metric = LK.prefs.get('metric') === 'minutes' ? 'minutes' : 'pages';

    const completedThisYear = books.filter((b) => b.status === 'completed' && String(b.dateCompleted || '').startsWith(String(year))).length;
    const totalPages = sessions.reduce((a, s) => a + (s.pagesRead || 0), 0);
    const totalMinutes = sessions.reduce((a, s) => a + (s.durationMinutes || 0), 0);
    const timedPages = sessions.filter((s) => s.durationMinutes > 0).reduce((a, s) => a + (s.pagesRead || 0), 0);
    const pace = totalMinutes && timedPages ? Math.round((timedPages / totalMinutes) * 60) : 0;
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
    const ach = await LK.ach.compute({ books, sessions, quotes, profile });
    const unlocked = ach.filter((a) => a.done && (LK.prefs.get('rpg') || !a.rpg));
    const visibleTotal = ach.filter((a) => LK.prefs.get('rpg') || !a.rpg).length;

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

        <div class="tiles">
          ${tile(completedThisYear, `Libros leídos en ${year}`)}
          ${tile(u.fmtNum(totalPages), 'Páginas leídas')}
          ${tile(u.fmtDuration(totalMinutes), 'Tiempo leyendo')}
          ${tile(`${streak} ${streak === 1 ? 'día' : 'días'}`, 'Racha actual')}
          ${tile(pace ? `${pace}` : '—', 'Páginas por hora')}
          ${tile(avg ? `${avg} ★` : '—', 'Valoración media')}
        </div>

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
          ${LK.charts.heatmap(sessions, weeks, metric)}
        </section>

        <section class="card">
          <div class="card-head"><h2>${metric === 'minutes' ? 'Minutos' : 'Páginas'} por mes</h2><span class="muted small">Últimos 12 meses</span></div>
          ${LK.charts.monthlyBars(sessions, 12, metric)}
        </section>

        ${fmtCounts.length
          ? `<section class="card">
              <div class="card-head"><h2>Libros terminados por formato</h2></div>
              <div class="row">${fmtCounts.map(([l, i, n]) => `<span class="chip chip-lg">${i} ${l}: <strong>${n}</strong></span>`).join('')}</div>
            </section>`
          : ''}

        ${sessions.length ? '' : '<p class="muted small" style="text-align:center">Las gráficas se llenan a medida que registras sesiones de lectura.</p>'}
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
