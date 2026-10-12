/* ==========================================================
   LOGROS  (LK.ach)
   Insignias que se calculan a partir de los datos (como el nivel):
   no se guardan, solo se recuerda cuáles ya se han avisado
   (profile.achSeen) para felicitar una única vez.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;

  /* ---------- Rachas ---------- */

  const activeDays = (sessions) =>
    new Set(sessions.filter((s) => (s.pagesRead || 0) > 0 || (s.durationMinutes || 0) > 0).map((s) => s.date));

  /** Días seguidos leyendo hasta hoy (o ayer, si hoy aún no has leído). */
  function streak(sessions) {
    const days = activeDays(sessions);
    const d = new Date();
    if (!days.has(u.isoDate(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (days.has(u.isoDate(d))) {
      n++;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  /** Mejor racha de la historia. */
  function longestStreak(sessions) {
    const days = [...activeDays(sessions)].sort();
    let best = 0;
    let run = 0;
    let prev = null;
    for (const day of days) {
      run = prev && u.daysBetween(prev, day) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = day;
    }
    return best;
  }

  /* ---------- Definición de logros ---------- */
  // cur/max alimentan la barrita de progreso; done = cur >= max.

  const count = (n, max) => ({ cur: Math.min(n, max), max });

  const DEFS = [
    { id: 'first-book', icon: '📚', name: 'Primer libro', desc: 'Añade un libro a tu biblioteca', f: (c) => count(c.books.length, 1) },
    { id: 'first-session', icon: '⏱️', name: 'A leer', desc: 'Registra tu primera sesión', f: (c) => count(c.sessions.length, 1) },
    { id: 'first-finished', icon: '🏁', name: 'Primera meta', desc: 'Termina un libro', f: (c) => count(c.finished.length, 1) },
    { id: 'finished-5', icon: '📗', name: 'Cinco libros', desc: 'Termina 5 libros', f: (c) => count(c.finished.length, 5) },
    { id: 'finished-10', icon: '📘', name: 'Diez libros', desc: 'Termina 10 libros', f: (c) => count(c.finished.length, 10) },
    { id: 'finished-25', icon: '🏛️', name: 'Biblioteca viva', desc: 'Termina 25 libros', f: (c) => count(c.finished.length, 25) },
    { id: 'pages-1000', icon: '📄', name: 'Mil páginas', desc: 'Lee 1.000 páginas en total', f: (c) => count(c.pages, 1000) },
    { id: 'pages-10000', icon: '📜', name: 'Diez mil páginas', desc: 'Lee 10.000 páginas en total', f: (c) => count(c.pages, 10000) },
    { id: 'hours-10', icon: '⌛', name: '10 horas', desc: 'Pasa 10 horas leyendo', f: (c) => count(Math.floor(c.minutes / 60), 10) },
    { id: 'hours-100', icon: '🕰️', name: '100 horas', desc: 'Pasa 100 horas leyendo', f: (c) => count(Math.floor(c.minutes / 60), 100) },
    { id: 'streak-3', icon: '🔥', name: 'Tres seguidos', desc: 'Lee 3 días seguidos', f: (c) => count(c.best, 3) },
    { id: 'streak-7', icon: '🔥', name: 'Semana entera', desc: 'Lee 7 días seguidos', f: (c) => count(c.best, 7) },
    { id: 'streak-30', icon: '🌋', name: 'Un mes sin parar', desc: 'Lee 30 días seguidos', f: (c) => count(c.best, 30) },
    { id: 'level-5', icon: '🛡️', name: 'Escriba', desc: 'Llega al nivel 5', rpg: true, f: (c) => count(c.progress.level, 5) },
    { id: 'level-10', icon: '⚔️', name: 'Nivel 10', desc: 'Llega al nivel 10', rpg: true, f: (c) => count(c.progress.level, 10) },
    { id: 'quotes-1', icon: '❝', name: 'Subrayador', desc: 'Guarda tu primera cita', f: (c) => count(c.quotes.length, 1) },
    { id: 'quotes-10', icon: '🖋️', name: 'Coleccionista de frases', desc: 'Guarda 10 citas', f: (c) => count(c.quotes.length, 10) },
    { id: 'reviews-5', icon: '⭐', name: 'Crítico', desc: 'Escribe 5 reseñas', f: (c) => count(c.books.filter((b) => (b.review || '').trim()).length, 5) },
    {
      id: 'night-owl',
      icon: '🦉',
      name: 'Búho',
      desc: 'Lee después de las 23:00 o antes de las 5:00',
      f: (c) => count(c.sessions.filter((s) => s.createdAt && [23, 0, 1, 2, 3, 4].includes(new Date(s.createdAt).getHours())).length, 1),
    },
    {
      id: 'big-book',
      icon: '🧱',
      name: 'Ladrillo',
      desc: 'Termina un libro de 700 páginas o más',
      f: (c) => count(c.finished.filter((b) => (b.totalPages || 0) >= 700).length, 1),
    },
    {
      id: 'saga',
      icon: '🐉',
      name: 'Saga completa',
      desc: 'Termina todos los libros de una saga (3 o más)',
      f: (c) => count(LK.books.seriesGroups(c.books).filter((g) => g.total >= 3 && g.done === g.total).length, 1),
    },
    {
      id: 'all-formats',
      icon: '🎭',
      name: 'Todoterreno',
      desc: 'Lee en papel, en ebook y escucha un audiolibro',
      f: (c) => {
        const used = new Set(c.sessions.map((s) => c.byId.get(s.bookId)?.format || 'paper'));
        return count(['paper', 'ebook', 'audio'].filter((f) => used.has(f)).length, 3);
      },
    },
    {
      id: 'listener-first',
      icon: '🎧',
      name: 'Con los cascos puestos',
      desc: 'Termina un audiolibro',
      f: (c) => count(c.finished.filter((b) => b.format === 'audio').length, 1),
    },
    {
      id: 'listener-10',
      icon: '👂',
      name: 'Buen oído',
      desc: 'Escucha 10 horas de audiolibro',
      f: (c) => count(Math.floor(c.audioMinutes / 60), 10),
    },
    {
      id: 'listener-50',
      icon: '📻',
      name: 'Oyente de fondo',
      desc: 'Escucha 50 horas de audiolibro',
      f: (c) => count(Math.floor(c.audioMinutes / 60), 50),
    },
    {
      id: 'lender',
      icon: '🤝',
      name: 'Biblioteca compartida',
      desc: 'Presta un libro a alguien',
      f: (c) => count(c.books.filter((b) => b.loan?.person && b.loan.dir === 'lent').length, 1),
    },
    {
      id: 'goal',
      icon: '🎯',
      name: 'Objetivo anual',
      desc: 'Cumple tu objetivo de libros del año',
      f: (c) => {
        const y = String(new Date().getFullYear());
        const n = c.finished.filter((b) => String(b.dateCompleted || '').startsWith(y)).length;
        return count(n, c.profile.yearlyGoal || 9999);
      },
    },
  ];

  /** Lista de logros con su estado. `ctx` se puede reutilizar si ya se ha cargado. */
  async function compute(ctx) {
    if (!ctx) {
      const [books, sessions, quotes, profile] = await Promise.all([LK.db.getBooks(), LK.db.getSessions(), LK.db.getQuotes(), LK.db.getProfile()]);
      ctx = { books, sessions, quotes, profile };
    }
    const { books, sessions } = ctx;
    const full = {
      ...ctx,
      byId: new Map(books.map((b) => [b.id, b])),
      finished: books.filter((b) => b.status === 'completed'),
      pages: sessions.reduce((a, s) => a + (s.pagesRead || 0), 0),
      minutes: sessions.reduce((a, s) => a + (s.durationMinutes || 0), 0),
      audioMinutes: sessions.filter((s) => LK.audio.isAudioSession(s, new Map(books.map((b) => [b.id, b])))).reduce((a, s) => a + (s.durationMinutes || 0), 0),
      best: longestStreak(sessions),
      progress: LK.rpg.compute(books, sessions),
    };
    return DEFS.map((d) => {
      const r = d.f(full);
      return { id: d.id, icon: d.icon, name: d.name, desc: d.desc, rpg: !!d.rpg, cur: r.cur, max: r.max, done: r.cur >= r.max };
    });
  }

  /**
   * Avisa de los logros nuevos. La primera vez solo memoriza los que
   * ya tienes (para no llenar la pantalla de avisos al importar tus libros).
   */
  async function check() {
    const profile = await LK.db.getProfile();
    const list = await compute();
    const doneIds = list.filter((a) => a.done).map((a) => a.id);
    if (profile.achSeen === null || profile.achSeen === undefined) {
      await LK.db.saveProfile({ achSeen: doneIds }, { silent: true, keepStamp: true });
      return [];
    }
    const fresh = list.filter((a) => a.done && !profile.achSeen.includes(a.id));
    if (!fresh.length) return [];
    await LK.db.saveProfile({ achSeen: [...new Set([...profile.achSeen, ...doneIds])] }, { silent: true, keepStamp: true });
    const showRpg = LK.prefs.get('rpg');
    for (const a of fresh) {
      if (a.rpg && !showRpg) continue;
      u.toast(`${a.icon} Logro: ${a.name}`, 'level');
    }
    return fresh;
  }

  LK.ach = { DEFS, compute, check, streak, longestStreak };
})(window.LK);
