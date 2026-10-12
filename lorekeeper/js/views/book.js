/* ==========================================================
   VISTA: FICHA DEL LIBRO   #/libro/<id>
   Libro 3D, progreso, estantería, préstamo, sesiones, valoración,
   reseña, citas (a mano o desde una foto) y edición de datos.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  LK.views = LK.views || {};

  function sessionsList(sessions, audio) {
    if (!sessions.length) return `<p class="muted small">Aún no hay sesiones. Pulsa «Empezar sesión» cuando te pongas ${audio ? 'a escuchar' : 'a leer'}.</p>`;
    return `<ul class="list">${sessions
      .map(
        (s) => `
        <li class="row-between">
          <div>
            <div>${u.fmtDate(s.date)}</div>
            <div class="muted small">${audio ? '' : `págs. ${s.startPage}–${s.endPage} · ${s.pagesRead} págs. · `}${u.fmtDuration(s.durationMinutes)}<span class="rpg-only"> · +${LK.rpg.sessionExp(s.pagesRead, s.durationMinutes)} EXP</span></div>
          </div>
          <button class="btn btn-ghost btn-icon" data-del-session="${u.esc(s.id)}" aria-label="Borrar sesión del ${u.fmtDate(s.date)}" title="Borrar sesión">✕</button>
        </li>`
      )
      .join('')}</ul>`;
  }

  function quotesList(quotes) {
    if (!quotes.length) return '<p class="muted small">Guarda aquí las frases que quieras recordar. Puedes escribirlas o sacar una foto a la página.</p>';
    return `<ul class="list">${quotes
      .map(
        (q) => `
        <li>
          <blockquote class="quote-text">${u.esc(q.text)}</blockquote>
          ${q.note ? `<p class="small" style="margin:.4rem 0 0">${u.esc(q.note)}</p>` : ''}
          <div class="quote-meta">
            <span>${q.page ? `Página ${q.page} · ` : ''}${u.fmtDate(q.date)}</span>
            <span class="row">
              <button class="btn btn-ghost btn-sm" data-share-quote="${u.esc(q.id)}" title="Compartir como imagen">🖼 Compartir</button>
              <button class="btn btn-ghost btn-icon" data-del-quote="${u.esc(q.id)}" aria-label="Borrar cita" title="Borrar cita">✕</button>
            </span>
          </div>
        </li>`
      )
      .join('')}</ul>`;
  }

  function loanCard(book) {
    const l = LK.books.loan(book);
    if (l) {
      return `
        <section class="card stack-sm ${l.overdue ? 'loan-overdue' : ''}">
          <h2>🤝 Préstamo</h2>
          <p>${u.esc(l.text)}</p>
          <div class="row">
            <button class="btn btn-primary" id="btn-return">${l.dir === 'borrowed' ? 'Ya lo he devuelto' : 'Ya me lo han devuelto'}</button>
            <button class="btn btn-ghost" id="btn-loan">Editar</button>
          </div>
        </section>`;
    }
    return `
      <section class="card stack-sm">
        <h2>🤝 Préstamo</h2>
        <p class="muted small">¿Has dejado este libro a alguien, o te lo han dejado? Anótalo y te avisamos si se pasa la fecha.</p>
        <div><button class="btn" id="btn-loan">Anotar préstamo</button></div>
      </section>`;
  }

  LK.views.libro = async (id) => {
    const book = await LK.db.getBook(id);
    if (!book) {
      return { html: `<div class="empty card"><p>Este libro ya no está en tu biblioteca.</p><a class="btn" href="#/biblioteca">Volver a la biblioteca</a></div>` };
    }

    const [src, sessions, quotes] = await Promise.all([LK.db.coverSrc(book), LK.db.getSessionsByBook(id), LK.db.getQuotesByBook(id)]);
    const audio = LK.books.isAudio(book);
    const minutes = sessions.reduce((a, s) => a + (s.durationMinutes || 0), 0);
    const pagesInSessions = sessions.reduce((a, s) => a + (s.pagesRead || 0), 0);
    const pace = minutes && !audio ? Math.round((pagesInSessions / minutes) * 60) : 0;
    const total = book.totalPages || 0;
    const read = book.readPages || 0;
    const pr = LK.books.progress(book, minutes);
    const remaining = !audio && total && pace ? (Math.max(0, total - read) / pace) * 60 : audio && pr.total ? Math.max(0, pr.total - minutes) : 0;

    const autoStats = LK.rpg.statsForGenres(book.genres);
    const statChips = LK.rpg.statsForBook(book).map((s) => `<span class="chip chip-accent rpg-only">${LK.rpg.statName(s)}</span>`).join('');
    const genreChips = (book.genres || []).slice(0, 4).map((g) => `<span class="chip">${u.esc(g)}</span>`).join('');
    const tagChips = (book.tags || []).map((t) => `<a class="chip chip-tag" href="#/biblioteca/etiqueta/${encodeURIComponent(t)}">#${u.esc(t)}</a>`).join('');

    const meta = [book.year, total ? `${total} págs.` : null, audio && book.totalMinutes ? u.fmtDuration(book.totalMinutes) : null, book.isbn ? `ISBN ${book.isbn}` : null].filter(Boolean).map(u.esc).join(' · ');

    const html = `
      <a class="btn btn-ghost btn-sm" href="#/biblioteca" style="margin-bottom:.75rem">← Biblioteca</a>

      <section class="detail-top">
        <div>
          ${LK.book3d.scene(book, src)}
          <p class="drag-hint">Arrastra el libro para girarlo</p>
        </div>
        <div class="stack-sm">
          <h1>${u.esc(book.title)}</h1>
          <div class="detail-author">${u.esc(book.author)}${meta ? `<br><span class="small">${meta}</span>` : ''}
            ${book.series ? `<br><a class="small" href="#/biblioteca/sagas">${LK.ui.seriesLabel(book)}</a>` : ''}</div>
          <div class="chips"><span class="chip">${LK.books.FORMAT_ICONS[book.format] || '📖'} ${LK.books.FORMATS[book.format] || 'Papel'}</span>${statChips}${genreChips}${tagChips}</div>

          <div style="padding-top:.5rem">
            ${pr.total
              ? `<div class="progress progress-lg"><span style="width:${pr.pct}%"></span></div>
                 <div class="progress-label"><span>${pr.text}</span><span>${pr.pct}%</span></div>`
              : `<p class="muted small">${pr.text}${audio ? ' · sin duración total' : ' · sin número total de páginas'}</p>`}
            ${remaining && book.status === 'reading' ? `<p class="muted small">${audio ? `Te quedan unas ${u.fmtDuration(remaining)} de audio.` : `A tu ritmo (${pace} págs./h) te quedan unas ${u.fmtDuration(remaining)}.`}</p>` : ''}
          </div>

          <div class="row">
            <button class="btn btn-primary btn-lg" id="btn-start">▶ Empezar sesión</button>
            <button class="btn btn-lg" id="btn-log">+ Registrar sesión</button>
          </div>

          <label class="field" style="max-width:240px">
            <span>Estantería</span>
            <select class="select" id="status">${LK.books.STATUSES.map(([v, l]) => `<option value="${v}" ${v === book.status ? 'selected' : ''}>${l.replace(/s$/, '')}</option>`).join('')}</select>
          </label>
        </div>
      </section>

      <div class="grid-2" style="margin-top:1.5rem">
        <section class="card stack-sm">
          <h2>Tu valoración</h2>
          <div class="stars" id="stars" role="radiogroup" aria-label="Valoración">
            ${[1, 2, 3, 4, 5].map((n) => `<button type="button" role="radio" aria-checked="${book.rating === n}" aria-label="${n} de 5" data-star="${n}" class="${book.rating >= n ? 'on' : ''}">★</button>`).join('')}
          </div>
          <label class="field"><span>Reseña personal</span>
            <textarea class="textarea" id="review" placeholder="¿Qué te ha parecido?">${u.esc(book.review)}</textarea>
          </label>
          <p class="muted small" id="review-status" aria-live="polite"></p>
        </section>

        ${loanCard(book)}
      </div>

      <section class="card stack-sm rpg-only" style="margin-top:1rem">
        <h2>Atributo que entrena</h2>
        <p class="muted small">Cada ${LK.rpg.PAGES_PER_POINT} páginas leídas de este libro suman 1 punto${audio ? ' (en audiolibros, cada 40 minutos)' : ''}. Por defecto se deduce del género${autoStats.length ? ` (${autoStats.map(LK.rpg.statName).join(', ')})` : ', pero este libro no encaja en ninguno: elige uno'}.</p>
        <select class="select" id="stat-override">
          <option value="">Automático según el género</option>
          ${LK.rpg.STATS.map((s) => `<option value="${s.id}" ${book.statOverride === s.id ? 'selected' : ''}>${s.name} — ${s.desc}</option>`).join('')}
        </select>
      </section>

      ${book.description ? `<details class="card disclosure" style="margin-top:1rem"><summary>Sinopsis</summary><p class="small" style="white-space:pre-line">${u.esc(book.description.replace(/<[^>]+>/g, ''))}</p></details>` : ''}

      <section class="card stack-sm" style="margin-top:1rem">
        <div class="card-head"><h2>Citas y notas</h2><span class="muted small">${quotes.length}</span></div>
        <form id="quote-form" class="form-grid">
          <label class="field span-all"><span>Cita</span><textarea class="textarea" name="text" rows="3" required placeholder="«…»"></textarea></label>
          <label class="field"><span>Página</span><input class="input" name="page" type="number" min="0" inputmode="numeric"></label>
          <label class="field"><span>Nota (opcional)</span><input class="input" name="note"></label>
          <div class="span-all row">
            <button class="btn btn-primary" type="submit">Guardar cita</button>
            <label class="btn" tabindex="0" id="ocr-pick">📷 Desde una foto
              <input type="file" id="ocr-file" accept="image/*" capture="environment" hidden>
            </label>
          </div>
          <p class="small span-all" id="ocr-status" aria-live="polite" hidden></p>
        </form>
        <div id="quotes" style="margin-top:1rem">${quotesList(quotes)}</div>
      </section>

      <section class="card" style="margin-top:1rem">
        <div class="card-head">
          <h2>Sesiones</h2>
          <span class="muted small">${sessions.length} · ${u.fmtDuration(minutes)}</span>
        </div>
        ${sessionsList(sessions, audio)}
      </section>

      <details class="card disclosure" style="margin-top:1rem">
        <summary>Editar datos del libro</summary>
        <form id="edit-form" class="form-grid">
          <label class="field span-all"><span>Título</span><input class="input" name="title" value="${u.esc(book.title)}" required></label>
          <label class="field"><span>Autor</span><input class="input" name="author" value="${u.esc(book.author)}"></label>
          <label class="field"><span>Formato</span>
            <select class="select" name="format">${Object.entries(LK.books.FORMATS).map(([v, l]) => `<option value="${v}" ${v === (book.format || 'paper') ? 'selected' : ''}>${LK.books.FORMAT_ICONS[v]} ${l}</option>`).join('')}</select>
          </label>
          <label class="field"><span>Páginas totales</span><input class="input" name="totalPages" type="number" min="0" value="${total}" inputmode="numeric"></label>
          <label class="field"><span>Página actual</span><input class="input" name="readPages" type="number" min="0" value="${read}" inputmode="numeric"></label>
          <label class="field span-all"><span>Duración del audiolibro (minutos)</span><input class="input" name="totalMinutes" type="number" min="0" value="${book.totalMinutes || 0}" inputmode="numeric"></label>
          <label class="field"><span>Saga o serie</span><input class="input" name="series" value="${u.esc(book.series || '')}" list="series-list" placeholder="Ej.: Los Juegos del Hambre"></label>
          <label class="field"><span>Nº en la saga</span><input class="input" name="seriesNo" type="number" step="any" min="0" value="${book.seriesNo ?? ''}" inputmode="decimal"></label>
          <label class="field span-all"><span>Etiquetas (separadas por comas)</span><input class="input" name="tags" value="${u.esc((book.tags || []).join(', '))}" placeholder="Regalo, Club de lectura, Viaje"></label>
          <label class="field span-all"><span>Géneros (separados por comas)</span><input class="input" name="genres" value="${u.esc((book.genres || []).join(', '))}"></label>
          <label class="field"><span>ISBN</span><input class="input" name="isbn" value="${u.esc(book.isbn || '')}" inputmode="numeric"></label>
          <label class="field"><span>URL de la portada</span><input class="input" name="coverUrl" type="url" value="${u.esc(book.coverUrl)}"></label>
          <datalist id="series-list"></datalist>
          <div class="span-all row-between">
            <button class="btn btn-primary" type="submit">Guardar cambios</button>
            <button class="btn btn-danger" type="button" id="btn-delete">Eliminar libro</button>
          </div>
        </form>
      </details>`;

    return {
      html,
      async mount(root) {
        LK.book3d.spin(root.querySelector('.b3d-scene'));

        const save = async (patch) => {
          const fresh = await LK.db.getBook(id);
          return LK.db.saveBook({ ...fresh, ...patch });
        };

        // Sagas ya usadas, para autocompletar
        LK.db.getBooks().then((all) => {
          const dl = root.querySelector('#series-list');
          if (dl) dl.innerHTML = [...new Set(all.map((b) => b.series).filter(Boolean))].map((s) => `<option value="${u.esc(s)}">`).join('');
        });

        root.querySelector('#btn-start').addEventListener('click', async () => LK.timer.start(await LK.db.getBook(id)));
        root.querySelector('#btn-log').addEventListener('click', async () => LK.timer.logSession(await LK.db.getBook(id)));

        // Estantería
        root.querySelector('#status').addEventListener('change', async (e) => {
          const status = e.target.value;
          const today = u.isoDate();
          const fresh = await LK.db.getBook(id);
          const patch = { status };
          if (status === 'reading' && !fresh.dateStarted) patch.dateStarted = today;
          if (status === 'completed') {
            patch.dateCompleted = fresh.dateCompleted || today;
            if (fresh.totalPages && !LK.books.isAudio(fresh)) patch.readPages = fresh.totalPages;
          } else {
            patch.dateCompleted = null;
          }
          await save(patch);
          const rpg = LK.prefs.get('rpg');
          u.toast(status === 'completed' ? (rpg && !fresh.imported ? `¡Libro terminado! +${LK.rpg.COMPLETION_BONUS} EXP` : '¡Libro terminado! 🎉') : 'Estantería actualizada', status === 'completed' ? 'level' : '');
          LK.app.refresh();
        });

        // Valoración
        root.querySelector('#stars').addEventListener('click', async (e) => {
          const btn = e.target.closest('[data-star]');
          if (!btn) return;
          const n = Number(btn.dataset.star);
          const current = (await LK.db.getBook(id)).rating;
          const rating = current === n ? null : n; // pulsar la misma estrella la quita
          await save({ rating });
          root.querySelectorAll('[data-star]').forEach((b) => {
            const v = Number(b.dataset.star);
            b.classList.toggle('on', rating >= v);
            b.setAttribute('aria-checked', String(rating === v));
          });
        });

        // Reseña: se guarda sola al dejar de escribir
        const reviewStatus = root.querySelector('#review-status');
        const saveReview = u.debounce(async (text) => {
          await save({ review: text });
          reviewStatus.textContent = 'Guardado';
          setTimeout(() => (reviewStatus.textContent = ''), 1500);
        }, 600);
        root.querySelector('#review').addEventListener('input', (e) => saveReview(e.target.value));

        // Atributo manual
        root.querySelector('#stat-override')?.addEventListener('change', async (e) => {
          await save({ statOverride: e.target.value || null });
          u.toast('Atributo actualizado');
          LK.app.refresh();
        });

        /* ----- Préstamo ----- */
        root.querySelector('#btn-return')?.addEventListener('click', async () => {
          await save({ loan: null });
          u.toast('Anotado: ya está de vuelta 📚');
          LK.app.refresh();
        });
        root.querySelector('#btn-loan')?.addEventListener('click', async () => {
          const cur = (await LK.db.getBook(id)).loan || {};
          const d = u.modal(`
            <h2>Préstamo</h2>
            <form class="form-grid" id="loan-form">
              <div class="span-all seg-mini" role="group" aria-label="Tipo de préstamo">
                <button type="button" data-dir="lent" aria-pressed="${cur.dir !== 'borrowed'}">Lo he prestado</button>
                <button type="button" data-dir="borrowed" aria-pressed="${cur.dir === 'borrowed'}">Me lo han prestado</button>
              </div>
              <label class="field span-all"><span data-l="who">${cur.dir === 'borrowed' ? '¿Quién te lo ha dejado?' : '¿A quién se lo has dejado?'}</span><input class="input" name="person" value="${u.esc(cur.person || '')}" required maxlength="60"></label>
              <label class="field"><span>Desde</span><input class="input" type="date" name="date" value="${cur.date || u.isoDate()}"></label>
              <label class="field"><span>Devolver antes del (opcional)</span><input class="input" type="date" name="due" value="${cur.due || ''}"></label>
              <div class="modal-actions span-all">
                <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
                <button class="btn btn-primary" type="submit">Guardar</button>
              </div>
            </form>`);
          let dir = cur.dir === 'borrowed' ? 'borrowed' : 'lent';
          d.querySelectorAll('[data-dir]').forEach((b) =>
            b.addEventListener('click', () => {
              dir = b.dataset.dir;
              d.querySelectorAll('[data-dir]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
              d.querySelector('[data-l="who"]').textContent = dir === 'borrowed' ? '¿Quién te lo ha dejado?' : '¿A quién se lo has dejado?';
            })
          );
          d.querySelector('#loan-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = e.target.elements;
            const person = f.person.value.trim();
            if (!person) return f.person.focus();
            await save({ loan: { dir, person, date: f.date.value || u.isoDate(), due: f.due.value || null } });
            d.close();
            u.toast('Préstamo anotado');
            LK.app.refresh();
          });
        });

        /* ----- Citas ----- */
        const quoteForm = root.querySelector('#quote-form');
        const refreshQuotes = async () => (root.querySelector('#quotes').innerHTML = quotesList(await LK.db.getQuotesByBook(id)));

        quoteForm.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target;
          const text = f.elements.text.value.trim();
          if (!text) return f.elements.text.focus();
          await LK.db.saveQuote({ bookId: id, text, page: parseInt(f.elements.page.value, 10) || null, note: f.elements.note.value.trim() });
          f.reset();
          await refreshQuotes();
          u.toast('Cita guardada');
        });

        // Foto → texto
        const ocrFile = root.querySelector('#ocr-file');
        const ocrStatus = root.querySelector('#ocr-status');
        root.querySelector('#ocr-pick').addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            ocrFile.click();
          }
        });
        ocrFile.addEventListener('click', (e) => {
          if (!LK.ocr.available()) {
            e.preventDefault();
            u.toast('Leer texto de una foto necesita la app servida por http(s) (no el archivo suelto).', 'error');
          }
        });
        ocrFile.addEventListener('change', async () => {
          const file = ocrFile.files[0];
          ocrFile.value = '';
          if (!file) return;
          ocrStatus.hidden = false;
          try {
            const text = await LK.ocr.recognize(file, ({ stage, pct }) => (ocrStatus.textContent = `${stage} ${Math.round(pct * 100)}%`));
            if (!text) {
              ocrStatus.textContent = 'No se ha podido leer texto en la foto. Prueba con más luz y el texto bien recto.';
              return;
            }
            const area = quoteForm.elements.text;
            area.value = (area.value ? area.value + '\n\n' : '') + text;
            ocrStatus.textContent = 'Texto reconocido. Revísalo, borra lo que sobre y pulsa «Guardar cita».';
            area.focus();
          } catch (err) {
            ocrStatus.textContent = err.message || 'No se pudo leer la foto.';
          }
        });

        root.querySelector('#quotes').addEventListener('click', async (e) => {
          const del = e.target.closest('[data-del-quote]');
          if (del) {
            if (!(await u.confirm('¿Borrar esta cita?', { ok: 'Borrar', danger: true }))) return;
            await LK.db.deleteQuote(del.dataset.delQuote);
            return refreshQuotes();
          }
          const sh = e.target.closest('[data-share-quote]');
          if (sh) {
            sh.disabled = true;
            try {
              const q = (await LK.db.getQuotesByBook(id)).find((x) => x.id === sh.dataset.shareQuote);
              const fresh = await LK.db.getBook(id);
              const blob = await LK.cards.quoteCard(q, fresh, await LK.db.coverSrc(fresh));
              const res = await u.shareFile(new File([blob], `cita-${u.norm(fresh.title).slice(0, 20)}.png`, { type: 'image/png' }), { title: fresh.title, text: `«${q.text.slice(0, 120)}»` });
              if (res === 'downloaded') u.toast('Imagen descargada');
            } catch (err) {
              u.toast('No se pudo crear la imagen', 'error');
            } finally {
              sh.disabled = false;
            }
          }
        });

        // Sesiones
        root.addEventListener('click', async (e) => {
          const btn = e.target.closest('[data-del-session]');
          if (!btn) return;
          if (!(await u.confirm('¿Borrar esta sesión? Se descontará de tus estadísticas.', { ok: 'Borrar', danger: true }))) return;
          await LK.db.deleteSession(btn.dataset.delSession);
          LK.app.refresh();
        });

        // Edición de datos
        root.querySelector('#edit-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target.elements;
          const totalPages = parseInt(f.totalPages.value, 10) || 0;
          const coverUrl = f.coverUrl.value.trim();
          const fresh = await LK.db.getBook(id);
          let readPages = parseInt(f.readPages.value, 10) || 0;
          if (totalPages) readPages = Math.min(readPages, totalPages);
          const seriesNo = f.seriesNo.value === '' ? null : parseFloat(f.seriesNo.value);
          await save({
            title: f.title.value.trim() || fresh.title,
            author: f.author.value.trim(),
            format: f.format.value,
            totalPages,
            readPages,
            totalMinutes: parseInt(f.totalMinutes.value, 10) || 0,
            series: f.series.value.trim(),
            seriesNo: Number.isNaN(seriesNo) ? null : seriesNo,
            tags: LK.books.splitList(f.tags.value.replace(/#/g, '')),
            genres: LK.books.splitList(f.genres.value),
            isbn: LK.books.isbn.normalize(f.isbn.value) || f.isbn.value.trim(),
            coverUrl,
          });
          if (coverUrl !== fresh.coverUrl) {
            await LK.db.clearCover(id);
            await LK.db.cacheCover(id, coverUrl);
          }
          u.toast('Datos guardados');
          LK.app.refresh();
        });

        root.querySelector('#btn-delete').addEventListener('click', async () => {
          const ok = await u.confirm(`¿Eliminar «${book.title}» con sus sesiones y citas? Se descontará de tus estadísticas.`, { ok: 'Eliminar', danger: true });
          if (!ok) return;
          await LK.db.deleteBook(id);
          u.toast('Libro eliminado');
          location.hash = '#/biblioteca';
          LK.app.refreshPlayer();
        });
      },
    };
  };
})(window.LK);
