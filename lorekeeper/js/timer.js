/* ==========================================================
   TEMPORIZADOR Y SESIONES  (LK.timer)

   SEGUNDO PLANO
   El reloj no "cuenta": guarda cuándo empezó (startedAt) y cuánto
   llevaba acumulado (accMs) en localStorage. Se puede cambiar de
   app, bloquear el móvil o cerrar la pestaña: al volver, el tiempo
   se calcula con la hora real. Nada se pierde.

   Lo que una PWA NO puede hacer (a diferencia de una app de la
   tienda) es poner un cronómetro vivo en la pantalla de bloqueo.
   Como sustituto hay un aviso persistente en la barra de
   notificaciones con botones Pausar / Terminar (si el usuario lo
   permite), el título de la pestaña con el tiempo y un aviso si
   alguien se deja el reloj en marcha horas y horas.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  const KEY = 'lk-timer';
  const FORGOT_MS = 3 * 3600 * 1000; // a partir de 3 h se pregunta si sigue leyendo
  const TITLE = 'LoreKeeper';

  let overlay = null;
  let tickId = null;
  let wakeLock = null;
  let snoozeUntil = 0;
  let forgotOpen = false;

  /* ---------- Estado ---------- */

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY));
    } catch {
      return null;
    }
  };
  const store = (s) => {
    try {
      s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY);
    } catch {}
  };
  const elapsed = (s) => s.accMs + (s.running ? Date.now() - s.startedAt : 0);
  const hhmm = (ms) => new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  /* ---------- Pantalla encendida ---------- */

  async function requestWake() {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      wakeLock = null;
    }
  }
  function releaseWake() {
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (overlay) requestWake();
    if (load()) {
      tick();
      checkForgotten();
    }
  });

  /* ---------- Aviso en la barra de notificaciones ---------- */

  const canNotify = () => 'Notification' in window && 'serviceWorker' in navigator && location.protocol.startsWith('http');

  async function swReg() {
    try {
      return await navigator.serviceWorker.ready;
    } catch {
      return null;
    }
  }

  /** Muestra o actualiza el aviso persistente de la sesión (si está permitido). */
  async function notify() {
    const s = load();
    if (!s || !canNotify() || !LK.prefs.get('notifyTimer') || Notification.permission !== 'granted') return;
    const reg = await swReg();
    if (!reg) return;
    const body = s.running
      ? `En marcha desde las ${hhmm(s.startedAt - s.accMs)}. Puedes seguir en otra app: el reloj no se para.`
      : `En pausa · ${u.fmtClock(elapsed(s))} acumulados`;
    try {
      await reg.showNotification(`${s.running ? '📖 Leyendo' : '⏸ En pausa'}: ${s.title}`, {
        body,
        tag: 'lk-timer',
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        requireInteraction: true,
        silent: true,
        renotify: false,
        actions: [
          { action: s.running ? 'pause' : 'resume', title: s.running ? 'Pausar' : 'Reanudar' },
          { action: 'finish', title: 'Terminar' },
        ],
        data: { type: 'timer' },
      });
    } catch (err) {
      console.warn('Aviso no mostrado:', err);
    }
  }

  async function clearNotification() {
    if (!canNotify()) return;
    const reg = await swReg();
    const list = (await reg?.getNotifications?.({ tag: 'lk-timer' })) || [];
    list.forEach((n) => n.close());
  }

  /** Pide permiso (debe llamarse desde un clic). Devuelve true si queda activo. */
  async function enableNotifications() {
    if (!canNotify()) {
      u.toast('Los avisos necesitan la app instalada o servida por https.', 'error');
      return false;
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      LK.prefs.set({ notifyTimer: false });
      u.toast('El navegador tiene los avisos bloqueados para esta app.', 'error');
      return false;
    }
    LK.prefs.set({ notifyTimer: true });
    notify();
    return true;
  }

  /** Orden recibida desde el aviso (botón Pausar / Reanudar / Terminar). */
  function handleAction(action) {
    const s = load();
    if (!s) return;
    if (action === 'pause' && s.running) toggle();
    else if (action === 'resume' && !s.running) toggle();
    else if (action === 'finish') finish();
    else if (action === 'open') open();
  }

  /* ---------- Ciclo del temporizador ---------- */

  /** Empieza (o retoma) una sesión con este libro. */
  async function start(book) {
    const current = load();
    if (current && current.bookId !== book.id) {
      const ok = await u.confirm(`Ya hay una sesión en marcha con «${current.title}». ¿Descartarla y empezar con este libro?`, {
        ok: 'Descartar y empezar',
        danger: true,
      });
      if (!ok) return;
      store(null);
    }
    const isNew = !load();
    if (isNew) {
      store({ bookId: book.id, title: book.title, startPage: book.readPages || 0, startedAt: Date.now(), accMs: 0, running: true });
    }
    if (book.status !== 'reading') {
      book.status = 'reading';
      book.dateStarted = book.dateStarted || u.isoDate();
      await LK.db.saveBook(book);
    }
    await open();
    if (isNew) {
      u.toast(book.format === 'audio' ? 'Sesión en marcha. Puedes salir de la app: el reloj sigue.' : 'Sesión en marcha. Puedes cerrar la pantalla: el reloj sigue.');
    }
    notify();
  }

  /** Abre el temporizador a pantalla completa. */
  async function open() {
    const s = load();
    if (!s) return;
    const book = await LK.db.getBook(s.bookId);
    if (!book) {
      store(null);
      updatePill();
      return;
    }
    overlay?.remove();
    const src = await LK.db.coverSrc(book);
    const audio = LK.books.isAudio(book);
    const offerNotify = canNotify() && Notification.permission !== 'granted' && Notification.permission !== 'denied';

    overlay = document.createElement('div');
    overlay.className = 'timer-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Sesión de lectura');
    overlay.innerHTML = `
      <button class="btn btn-ghost btn-sm timer-close" data-act="min">Minimizar ✕</button>
      ${LK.book3d.scene(book, src)}
      <div>
        <div class="timer-book-title">${u.esc(book.title)}</div>
        <div class="muted small">${audio ? 'Escuchando' : `Empezaste en la página ${s.startPage}`}</div>
      </div>
      <div class="timer-clock" id="timer-clock" aria-live="off">00:00</div>
      <div class="timer-controls">
        <button class="btn" data-act="toggle">Pausar</button>
        <button class="btn btn-primary" data-act="finish">Terminar sesión</button>
      </div>
      <p class="timer-tip small muted">El reloj sigue aunque salgas de la app o apagues la pantalla.</p>
      ${offerNotify ? '<button class="btn btn-sm" data-act="notif">🔔 Avisarme en la barra de notificaciones</button>' : ''}
      <button class="btn btn-ghost btn-sm" data-act="discard">Descartar sesión</button>`;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    LK.book3d.spin(overlay.querySelector('.b3d-scene'), { speed: 10 });

    overlay.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'min') minimize();
      if (act === 'toggle') toggle();
      if (act === 'finish') finish();
      if (act === 'discard') discard();
      if (act === 'notif') {
        if (await enableNotifications()) e.target.closest('[data-act]').remove();
      }
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') minimize();
    });
    overlay.querySelector('[data-act="finish"]').focus();

    requestWake();
    tick();
    ensureTicking();
  }

  function tick() {
    const s = load();
    if (!s) {
      stopTicking();
      updatePill();
      document.title = TITLE;
      return;
    }
    const time = u.fmtClock(elapsed(s));
    if (overlay) {
      overlay.querySelector('#timer-clock').textContent = time;
      overlay.querySelector('[data-act="toggle"]').textContent = s.running ? 'Pausar' : 'Reanudar';
      overlay.classList.toggle('paused', !s.running);
    }
    document.title = `${s.running ? '▶' : '⏸'} ${time} · ${TITLE}`;
    updatePill();
    checkForgotten();
  }

  const ensureTicking = () => {
    if (!tickId) tickId = setInterval(tick, 500);
  };
  const stopTicking = () => {
    clearInterval(tickId);
    tickId = null;
    document.title = TITLE;
  };

  function minimize() {
    overlay?.remove();
    overlay = null;
    document.body.style.overflow = '';
    releaseWake();
    updatePill();
  }

  function toggle() {
    const s = load();
    if (!s) return;
    if (s.running) {
      s.accMs += Date.now() - s.startedAt;
      s.running = false;
    } else {
      s.startedAt = Date.now();
      s.running = true;
    }
    store(s);
    tick();
    notify();
  }

  /** Pausa el reloj y abre el formulario para guardar la sesión. */
  async function finish() {
    const s = load();
    if (!s) return;
    if (s.running) {
      s.accMs += Date.now() - s.startedAt;
      s.running = false;
      store(s);
    }
    const book = await LK.db.getBook(s.bookId);
    minimize();
    clearNotification();
    if (!book) return store(null);
    logSession(book, { startPage: s.startPage, minutes: Math.max(1, Math.round(s.accMs / 60000)), fromTimer: true });
  }

  async function discard() {
    const ok = await u.confirm('¿Descartar esta sesión? No se guardará el tiempo.', { ok: 'Descartar', danger: true });
    if (!ok) return;
    store(null);
    minimize();
    stopTicking();
    clearNotification();
  }

  /** ¿Se ha dejado el reloj en marcha horas y horas? Pregunta una vez cada hora. */
  async function checkForgotten() {
    const s = load();
    if (!s || !s.running || forgotOpen || Date.now() < snoozeUntil) return;
    const ms = elapsed(s);
    if (ms < FORGOT_MS) return;
    forgotOpen = true;
    const d = u.modal(`
      <h2>¿Sigues leyendo?</h2>
      <p>Llevas <strong>${u.fmtDuration(ms / 60000)}</strong> con el reloj en marcha en «${u.esc(s.title)}».</p>
      <p class="muted small">Si te lo dejaste puesto, termina la sesión y corrige los minutos al guardarla.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-close>Sigo leyendo</button>
        <button class="btn btn-primary" data-finish>Terminar y ajustar</button>
      </div>`);
    d.querySelector('[data-finish]').addEventListener('click', () => {
      d.close();
      finish();
    });
    d.addEventListener('close', () => {
      forgotOpen = false;
      snoozeUntil = Date.now() + 3600 * 1000;
    });
  }

  /** Píldora de la cabecera: visible cuando hay sesión y el temporizador está minimizado. */
  function updatePill() {
    const pill = document.getElementById('timer-pill');
    if (!pill) return;
    const s = load();
    pill.hidden = !s || !!overlay;
    if (s) {
      document.getElementById('timer-pill-time').textContent = u.fmtClock(elapsed(s));
      pill.classList.toggle('paused', !s.running);
      pill.setAttribute('aria-label', `Sesión de lectura en curso: ${s.title}. Abrir temporizador`);
    }
  }

  /** Al arrancar la app: si había una sesión en marcha, muestra la píldora. */
  function restore() {
    document.getElementById('timer-pill')?.addEventListener('click', open);
    if (load()) {
      ensureTicking();
      tick();
    }
    updatePill();
  }

  /* ---------- Formulario de sesión ---------- */

  /**
   * Guarda una sesión de lectura.
   * Papel/ebook: páginas (o % del libro). Audiolibro: solo minutos escuchados.
   */
  function logSession(book, { startPage = book.readPages || 0, minutes = 30, fromTimer = false } = {}) {
    const audio = LK.books.isAudio(book);
    const total = book.totalPages || 0;
    const canPercent = !audio && total > 0;
    let unit = canPercent && LK.prefs.get('unit') === 'percent' ? 'percent' : 'pages';
    const toPct = (p) => Math.round((p / total) * 100);
    const suspicious = fromTimer && minutes > 240;

    const pageFields = audio
      ? ''
      : `
        ${canPercent ? `<div class="span-all"><div class="seg-mini" role="group" aria-label="Unidad">
            <button type="button" data-unit="pages" aria-pressed="${unit === 'pages'}">Páginas</button>
            <button type="button" data-unit="percent" aria-pressed="${unit === 'percent'}">Porcentaje</button></div></div>` : ''}
        <label class="field"><span data-l="start">Página inicial</span>
          <input class="input" type="number" name="start" min="0" inputmode="numeric" required>
        </label>
        <label class="field"><span data-l="end">¿En qué página te has quedado?</span>
          <input class="input" type="number" name="end" min="0" inputmode="numeric" required>
        </label>`;

    const d = u.modal(`
      <h2>${fromTimer ? 'Sesión terminada' : audio ? 'Registrar escucha' : 'Registrar sesión'}</h2>
      <p class="muted small">${u.esc(book.title)}</p>
      <form class="form-grid" id="session-form" novalidate>
        ${pageFields}
        <label class="field ${audio ? 'span-all' : ''}"><span>${audio ? 'Minutos escuchados' : 'Minutos leídos'}</span>
          <input class="input" type="number" name="minutes" min="0" value="${minutes}" inputmode="numeric" required>
        </label>
        <div class="span-all chips-pick" aria-label="Minutos habituales">
          ${[15, 30, 45, 60, 90].map((m) => `<button type="button" class="chip-btn" data-min="${m}">${m} min</button>`).join('')}
        </div>
        ${suspicious ? `<p class="small span-all chip chip-warn">El reloj marcó ${u.fmtDuration(minutes)}. Si te lo dejaste en marcha, corrige los minutos.</p>` : ''}
        <label class="field span-all"><span>Fecha</span>
          <input class="input" type="date" name="date" value="${u.isoDate()}" max="${u.isoDate()}" required>
        </label>
        ${audio ? '' : total ? `<p class="muted small span-all">El libro tiene ${total} páginas.</p>` : '<p class="small span-all chip chip-warn">Este libro no tiene número de páginas. Puedes ponerlo en «Editar datos».</p>'}
        <p class="small span-all" id="session-error" style="color:var(--danger)" hidden></p>
        <div class="modal-actions span-all">
          <button type="button" class="btn btn-ghost" data-close>${fromTimer ? 'Más tarde' : 'Cancelar'}</button>
          <button type="submit" class="btn btn-primary">Guardar sesión</button>
        </div>
      </form>`);

    const form = d.querySelector('#session-form');

    /* Rellena y alterna páginas / porcentaje */
    function fillFields(pagesStart, pagesEnd) {
      if (audio) return;
      const isPct = unit === 'percent';
      form.elements.start.value = isPct ? toPct(pagesStart) : pagesStart;
      form.elements.end.value = isPct ? toPct(pagesEnd) : pagesEnd;
      form.elements.start.max = form.elements.end.max = isPct ? 100 : total || '';
      d.querySelector('[data-l="start"]').textContent = isPct ? '% inicial' : 'Página inicial';
      d.querySelector('[data-l="end"]').textContent = isPct ? '¿Por qué % vas?' : '¿En qué página te has quedado?';
    }
    const readPages = () => {
      const s = parseInt(form.elements.start.value, 10) || 0;
      const e = parseInt(form.elements.end.value, 10) || 0;
      if (unit === 'percent') return [Math.round((s * total) / 100), Math.round((e * total) / 100)];
      return [s, e];
    };
    fillFields(startPage, startPage);

    d.querySelectorAll('[data-unit]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const [s, e] = readPages();
        unit = btn.dataset.unit;
        LK.prefs.set({ unit });
        d.querySelectorAll('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        fillFields(s, e);
      })
    );
    d.querySelectorAll('[data-min]').forEach((btn) =>
      btn.addEventListener('click', () => (form.elements.minutes.value = btn.dataset.min))
    );

    (audio ? form.elements.minutes : form.elements.end).focus();
    (audio ? form.elements.minutes : form.elements.end).select?.();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const [start, end] = audio ? [0, 0] : readPages();
      const mins = Math.max(0, parseInt(form.elements.minutes.value, 10) || 0);
      const date = form.elements.date.value || u.isoDate();
      const error = d.querySelector('#session-error');

      const fail = (msg) => {
        error.textContent = msg;
        error.hidden = false;
      };
      if (end < start) return fail(unit === 'percent' ? 'El % final no puede ser menor que el inicial.' : 'La página final no puede ser menor que la inicial.');
      if (!audio && total && end > total) return fail(`El libro solo tiene ${total} páginas.`);
      if (audio ? mins === 0 : end === start && mins === 0) return fail(audio ? 'Indica los minutos que has escuchado.' : 'Indica las páginas o el tiempo que has leído.');

      const before = await LK.app.progress();

      await LK.db.saveSession({ bookId: book.id, date, startPage: start, endPage: end, pagesRead: end - start, durationMinutes: mins });

      // Actualiza el libro
      const fresh = (await LK.db.getBook(book.id)) || book;
      if (!audio) fresh.readPages = Math.max(fresh.readPages || 0, end);
      fresh.lastReadAt = Date.now();
      fresh.dateStarted = fresh.dateStarted || date;
      if (fresh.status === 'wishlist' || fresh.status === 'abandoned') fresh.status = 'reading';
      let finished = false;
      let reached = false;
      if (audio) {
        const listened = (await LK.db.getSessionsByBook(book.id)).reduce((a, s) => a + (s.durationMinutes || 0), 0);
        reached = !!fresh.totalMinutes && listened >= fresh.totalMinutes;
      } else {
        reached = !!total && end >= total;
      }
      if (reached && fresh.status !== 'completed') {
        fresh.status = 'completed';
        fresh.dateCompleted = date;
        finished = true;
      }
      await LK.db.saveBook(fresh);

      if (fromTimer) {
        store(null);
        stopTicking();
        updatePill();
        clearNotification();
      }
      d.close();

      const after = await LK.app.progress();
      const gained = after.totalExp - before.totalExp;
      const rpg = LK.prefs.get('rpg');
      if (rpg && after.level > before.level) {
        u.toast(`¡Subes a nivel ${after.level}! Rango: ${after.title}`, 'level');
      } else if (finished) {
        u.toast(rpg ? `¡Libro terminado! +${gained} EXP` : '¡Libro terminado! Enhorabuena 🎉', 'level');
      } else {
        u.toast(rpg ? `Sesión guardada: +${gained} EXP` : 'Sesión guardada');
      }
      LK.app.refresh();
    });
  }

  LK.timer = { start, open, restore, logSession, current: load, handleAction, enableNotifications, canNotify };
})(window.LK);
