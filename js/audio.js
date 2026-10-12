/* ==========================================================
   AUDIOLIBROS  (LK.audio)
   Quien escucha un audiolibro mientras hace otras cosas no lee páginas:
   avanza por un "punto" del audio. Aquí se apoya todo lo de audio:

   - Posición (en minutos de libro): dónde vas. Se puede dar como
     «posición» (2 h 14 min), «me quedan» (lo que enseñan Audible o
     Storytel) o «porcentaje».
   - Tiempo real: lo que has estado escuchando, que no es lo mismo si
     usas velocidad 1,25× o 1,5×.
   - Velocidad, capítulo y fecha, todo opcional salvo el tiempo o la
     posición.

   Una sesión de audio guarda:
     durationMinutes  tiempo real escuchado (cuenta para racha y horas)
     fromMin / toMin  posición del libro al empezar y al terminar
     speed            velocidad
     chapter          capítulo o parte (texto libre)
   y el libro recuerda listenPos (dónde vas) y speed (tu velocidad).
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;

  const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const whole = (n) => Math.max(0, Math.round(Number(n) || 0));
  const dur = (min) => u.fmtDuration(min);
  const fmtSpeed = (v) => `${String(Math.round(v * 100) / 100).replace('.', ',')}×`;

  /** Dónde vas en el audio (minutos de libro). Sin dato guardado, se usa la suma del tiempo escuchado. */
  function position(book, sessions = []) {
    if (book.listenPos != null) return whole(book.listenPos);
    return whole(sessions.reduce((a, s) => a + (s.durationMinutes || 0), 0));
  }

  /* ---------- Campos de tiempo (horas + minutos) ---------- */

  /**
   * Dos casillas (h y min) con botones para sumar o restar.
   * Los valores se leen con getTime(form, name).
   */
  function timeField(name, minutes, { label, hint = '', steps = [-5, 5], cls = '' } = {}) {
    const m = whole(minutes);
    const step = (v) =>
      v
        ? `<button type="button" class="tf-step" data-tf-step="${v}" aria-label="${v < 0 ? 'Restar' : 'Sumar'} ${Math.abs(v)} minutos">${v < 0 ? '−' : '+'}${Math.abs(v)}</button>`
        : '';
    return `
      <div class="field tf ${cls}" data-tf="${name}">
        <span>${label}</span>
        <div class="tf-row">
          ${step(steps[0])}
          <label class="tf-box"><input class="input" type="number" name="${name}_h" min="0" max="999" inputmode="numeric" value="${Math.floor(m / 60)}" aria-label="${u.esc(label)}: horas"><i>h</i></label>
          <label class="tf-box"><input class="input" type="number" name="${name}_m" min="0" max="59" inputmode="numeric" value="${m % 60}" aria-label="${u.esc(label)}: minutos"><i>min</i></label>
          ${step(steps[1])}
        </div>
        ${hint ? `<small class="muted">${hint}</small>` : ''}
      </div>`;
  }

  const getTime = (form, name) => whole(form.elements[`${name}_h`]?.value) * 60 + whole(form.elements[`${name}_m`]?.value);

  function setTime(form, name, minutes) {
    const m = whole(minutes);
    form.elements[`${name}_h`].value = Math.floor(m / 60);
    form.elements[`${name}_m`].value = m % 60;
  }

  /** Activa los botones +/− y normaliza (75 min → 1 h 15 min) en un formulario o contenedor. */
  function bindTimeFields(root) {
    const formOf = (el) => el.closest('form') || root;
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tf-step]');
      if (!btn) return;
      const name = btn.closest('[data-tf]').dataset.tf;
      const form = formOf(btn);
      setTime(form, name, Math.max(0, getTime(form, name) + Number(btn.dataset.tfStep)));
      form.elements[`${name}_h`].dispatchEvent(new Event('input', { bubbles: true }));
    });
    root.addEventListener('change', (e) => {
      const m = /^(.+)_m$/.exec(e.target.name || '');
      if (!m) return;
      const form = formOf(e.target);
      setTime(form, m[1], getTime(form, m[1])); // 75 min → 1 h 15 min
    });
  }

  /* ---------- Velocidad ---------- */

  function speedPills(current = 1) {
    return `<div class="speed-pills" role="group" aria-label="Velocidad de reproducción">${SPEEDS.map(
      (v) => `<button type="button" class="speed-pill" data-speed="${v}" aria-pressed="${v === Number(current)}">${fmtSpeed(v)}</button>`
    ).join('')}</div>`;
  }

  /* ---------- Resumen de una sesión y de un libro ---------- */

  /** "de 2 h 14 min a 3 h 5 min · 40 min reales · 1,25× · Cap. 12" */
  function sessionText(s) {
    const parts = [];
    if (s.toMin != null && s.fromMin != null) parts.push(`de ${dur(s.fromMin)} a ${dur(s.toMin)}`);
    parts.push(s.toMin != null ? `${dur(s.durationMinutes)} reales` : dur(s.durationMinutes));
    if (s.speed && s.speed !== 1) parts.push(fmtSpeed(s.speed));
    if (s.chapter) parts.push(u.esc(s.chapter));
    return parts.join(' · ');
  }

  /** Cifras de escucha de un libro: tiempo real, minutos de libro avanzados y velocidad media. */
  function listenStats(sessions) {
    let real = 0;
    let content = 0;
    let realWithPos = 0;
    for (const s of sessions) {
      real += s.durationMinutes || 0;
      if (s.toMin != null && s.fromMin != null && s.toMin >= s.fromMin) {
        content += s.toMin - s.fromMin;
        realWithPos += s.durationMinutes || 0;
      }
    }
    return { real, content, avgSpeed: realWithPos > 0 && content > 0 ? content / realWithPos : 0, count: sessions.length };
  }

  /** ¿Es una sesión de audiolibro? (también las antiguas, por el formato del libro) */
  const isAudioSession = (s, byId) => s.mode === 'audio' || (byId && byId.get(s.bookId)?.format === 'audio');

  /* ---------- Ventana pequeña para elegir un tiempo ---------- */

  function pickTime({ title, label, value = 0, hint = '', steps = [-5, 5] }) {
    return new Promise((resolve) => {
      const d = u.modal(`
        <h2>${u.esc(title)}</h2>
        <form id="pick-form" class="stack-sm" novalidate>
          ${timeField('t', value, { label, hint, steps })}
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
            <button type="submit" class="btn btn-primary">Aceptar</button>
          </div>
        </form>`);
      const form = d.querySelector('#pick-form');
      bindTimeFields(form);
      let result = null;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        result = getTime(form, 't');
        d.close();
      });
      d.addEventListener('close', () => resolve(result));
    });
  }

  /* ---------- Formulario de sesión de audio ---------- */

  async function logForm(book, opts = {}) {
    const sessions = await LK.db.getSessionsByBook(book.id);
    const fromTimer = !!opts.fromTimer;
    const startPos = whole(opts.startPos ?? position(book, sessions));
    const minutes0 = whole(opts.minutes ?? 30);
    let speed = Number(opts.speed ?? book.speed ?? 1) || 1;
    let total = whole(book.totalMinutes);
    let mode = 'pos'; // 'pos' | 'left' | 'pct'
    let endTouched = false;
    let edited = false;
    const suspicious = fromTimer && minutes0 > 360;

    const d = u.modal(
      `
      <h2>${fromTimer ? 'Sesión terminada' : 'Registrar escucha'}</h2>
      <p class="muted small">${u.esc(book.title)}</p>
      <form class="stack-sm audio-form" id="audio-form" novalidate>

        ${timeField('minutes', minutes0, { label: 'Tiempo escuchado', hint: 'Tiempo real, el que ha pasado en tu reloj.', steps: [-5, 5] })}
        <div class="chips-pick" aria-label="Tiempos habituales">
          ${[15, 30, 45, 60, 90, 120].map((m) => `<button type="button" class="chip-btn" data-min="${m}">${dur(m)}</button>`).join('')}
        </div>
        ${suspicious ? `<p class="small chip chip-warn">El reloj marcó ${dur(minutes0)}. Si te lo dejaste en marcha, corrige el tiempo.</p>` : ''}

        <div class="field">
          <span>Velocidad</span>
          ${speedPills(speed)}
        </div>

        ${timeField('start', startPos, { label: 'Empezaste en', hint: 'El punto del audio en el que estabas al empezar.', steps: [-5, 5] })}

        <div class="field">
          <span>¿Cómo prefieres decir dónde te quedas?</span>
          <div class="seg-mini" role="group" aria-label="Forma de indicar el punto" id="mode-seg">
            <button type="button" data-mode="pos" aria-pressed="true">Posición</button>
            <button type="button" data-mode="left" aria-pressed="false">Me quedan</button>
            <button type="button" data-mode="pct" aria-pressed="false">Porcentaje</button>
          </div>
        </div>
        <div id="end-block"></div>

        ${total ? '' : timeField('total', 0, { label: 'Duración total del audiolibro (opcional)', hint: 'Sale en la ficha del audiolibro. Con ella puedo calcular cuánto te queda y el porcentaje.', steps: [-30, 30] })}

        <p class="small audio-hint" id="audio-hint" aria-live="polite"></p>

        <div class="form-grid">
          <label class="field"><span>Capítulo o parte (opcional)</span>
            <input class="input" name="chapter" maxlength="40" placeholder="Cap. 12" autocomplete="off"></label>
          <label class="field"><span>Fecha</span>
            <input class="input" type="date" name="date" value="${u.isoDate()}" max="${u.isoDate()}" required></label>
        </div>

        <p class="small" id="session-error" style="color:var(--danger)" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-close>${fromTimer ? 'Más tarde' : 'Cancelar'}</button>
          <button type="submit" class="btn btn-primary">Guardar sesión</button>
        </div>
      </form>`,
      { wide: true }
    );

    const form = d.querySelector('#audio-form');
    const endBlock = d.querySelector('#end-block');
    const hint = d.querySelector('#audio-hint');
    const errorEl = d.querySelector('#session-error');
    bindTimeFields(form);

    const pctOf = (abs) => (total ? Math.round((abs / total) * 100) : 0);

    function endHTML(abs) {
      if (mode === 'pct') {
        return `<div class="field tf"><span>¿Qué porcentaje llevas?</span>
          <div class="tf-row"><label class="tf-box"><input class="input" type="number" name="end_pct" min="0" max="100" inputmode="numeric" value="${pctOf(abs)}" aria-label="Porcentaje"><i>%</i></label></div></div>`;
      }
      if (mode === 'left') return timeField('end', Math.max(0, total - abs), { label: 'Te quedan por escuchar', hint: 'Es lo que suele enseñar la app del audiolibro.', steps: [-5, 5] });
      return timeField('end', abs, { label: '¿Dónde te has quedado?', steps: [-5, 5] });
    }
    const renderEnd = (abs) => (endBlock.innerHTML = endHTML(abs));

    /** Posición final en minutos, según la forma elegida. */
    function readEnd() {
      if (mode === 'pct') return Math.round((total * (Number(form.elements.end_pct?.value) || 0)) / 100);
      const t = getTime(form, 'end');
      return mode === 'left' ? Math.max(0, total - t) : t;
    }

    /** Estimación de dónde estarás: inicio + tiempo × velocidad (o el avance exacto del reloj). */
    function estimate() {
      const start = getTime(form, 'start');
      if (!edited && opts.contentMin != null) return start + whole(opts.contentMin);
      return start + Math.round(getTime(form, 'minutes') * speed);
    }

    function autoEnd() {
      if (!endTouched) renderEnd(Math.min(estimate(), total || Infinity));
    }

    function refreshHint() {
      const start = getTime(form, 'start');
      const end = readEnd();
      const mins = getTime(form, 'minutes');
      const parts = [];
      if (end < start) parts.push('⚠ El punto final va antes del inicial.');
      else if (end > start && mins > 0) parts.push(`Avanzas ${dur(end - start)} de libro en ${dur(mins)} reales (${fmtSpeed((end - start) / mins)}).`);
      if (total && end >= start && end <= total) parts.push(`Llevarás el ${pctOf(end)} % y te quedarán ${dur(total - end)}.`);
      hint.textContent = parts.join(' ');
    }

    function updateModes() {
      d.querySelectorAll('#mode-seg [data-mode]').forEach((b) => {
        b.disabled = b.dataset.mode !== 'pos' && !total;
        b.title = b.disabled ? 'Necesita la duración total del audiolibro' : '';
      });
    }

    renderEnd(Math.min(estimate(), total || Infinity));
    updateModes();
    refreshHint();

    form.addEventListener('input', (e) => {
      const name = e.target.name || '';
      if (name.startsWith('end')) endTouched = true;
      else if (name.startsWith('minutes_') || name.startsWith('start_')) {
        edited = true;
        autoEnd();
      } else if (name.startsWith('total_')) {
        total = getTime(form, 'total');
        updateModes();
      }
      refreshHint();
    });

    d.querySelectorAll('[data-min]').forEach((b) =>
      b.addEventListener('click', () => {
        setTime(form, 'minutes', Number(b.dataset.min));
        edited = true;
        autoEnd();
        refreshHint();
      })
    );

    d.querySelectorAll('[data-speed]').forEach((b) =>
      b.addEventListener('click', () => {
        speed = Number(b.dataset.speed);
        d.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        edited = true;
        autoEnd();
        refreshHint();
      })
    );

    d.querySelectorAll('#mode-seg [data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        const abs = readEnd();
        mode = b.dataset.mode;
        d.querySelectorAll('#mode-seg [data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        renderEnd(abs);
        refreshHint();
      })
    );

    form.elements.minutes_m.focus();
    form.elements.minutes_m.select?.();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fail = (msg) => {
        errorEl.textContent = msg;
        errorEl.hidden = false;
      };
      const date = form.elements.date.value || u.isoDate();
      const start = getTime(form, 'start');
      const end = readEnd();
      let mins = getTime(form, 'minutes');
      const tot = total || (form.elements.total_h ? getTime(form, 'total') : 0);

      if (end < start) return fail('El punto final no puede ir antes del inicial. Si has vuelto a escuchar una parte, pon también más atrás el punto de partida.');
      if (tot && end > tot) return fail(`El audiolibro dura ${dur(tot)}: el punto final no puede pasarse.`);
      if (mins === 0 && end === start) return fail('Indica cuánto has escuchado o dónde te has quedado.');
      if (mins === 0) mins = Math.max(1, Math.ceil((end - start) / speed)); // solo sé dónde me quedé

      const before = await LK.app.progress();
      await LK.db.saveSession({
        bookId: book.id,
        date,
        mode: 'audio',
        startPage: 0,
        endPage: 0,
        pagesRead: 0,
        durationMinutes: mins,
        fromMin: start,
        toMin: end,
        speed,
        chapter: form.elements.chapter.value.trim(),
      });

      const fresh = (await LK.db.getBook(book.id)) || book;
      fresh.listenPos = fresh.listenPos == null ? end : Math.max(fresh.listenPos, end);
      fresh.speed = speed;
      if (!fresh.totalMinutes && tot) fresh.totalMinutes = tot;
      fresh.lastReadAt = Date.now();
      fresh.dateStarted = fresh.dateStarted || date;
      if (fresh.status === 'wishlist' || fresh.status === 'abandoned') fresh.status = 'reading';
      let finished = false;
      if (fresh.totalMinutes && end >= fresh.totalMinutes - 1 && fresh.status !== 'completed') {
        fresh.status = 'completed';
        fresh.dateCompleted = date;
        finished = true;
      }
      await LK.db.saveBook(fresh);

      if (fromTimer) LK.timer.clearState();
      d.close();

      const after = await LK.app.progress();
      const gained = after.totalExp - before.totalExp;
      const rpg = LK.prefs.get('rpg');
      if (rpg && after.level > before.level) u.toast(`¡Subes a nivel ${after.level}! Rango: ${after.title}`, 'level');
      else if (finished) u.toast(rpg ? `¡Audiolibro terminado! +${gained} EXP` : '¡Audiolibro terminado! Enhorabuena 🎉', 'level');
      else u.toast(rpg ? `Escucha guardada: +${gained} EXP` : 'Escucha guardada');
      LK.app.refresh();
    });
  }

  LK.audio = { SPEEDS, fmtSpeed, position, timeField, getTime, setTime, bindTimeFields, speedPills, sessionText, listenStats, isAudioSession, pickTime, logForm };
})(window.LK);
