/* ==========================================================
   RESUMEN ANUAL  (LK.summary)
   Calcula «Tu año en libros» a partir de libros y sesiones.
   Función pura: la pantalla (#/resumen) y la tarjeta para
   compartir (LK.cards.yearCard) usan el mismo resultado.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  /** Años con algo que contar, de más reciente a más antiguo. */
  function years(books, sessions) {
    const set = new Set();
    sessions.forEach((s) => s.date && set.add(Number(s.date.slice(0, 4))));
    books.forEach((b) => b.status === 'completed' && b.dateCompleted && set.add(Number(b.dateCompleted.slice(0, 4))));
    return [...set].filter(Boolean).sort((a, b) => b - a);
  }

  function compute(year, books, sessions, profile) {
    const y = String(year);
    const inYear = sessions.filter((s) => String(s.date || '').startsWith(y));
    const finishedBooks = books.filter((b) => b.status === 'completed' && String(b.dateCompleted || '').startsWith(y));

    const pages = inYear.reduce((a, s) => a + (s.pagesRead || 0), 0);
    const minutes = inYear.reduce((a, s) => a + (s.durationMinutes || 0), 0);
    const days = new Set(inYear.filter((s) => (s.pagesRead || 0) > 0 || (s.durationMinutes || 0) > 0).map((s) => s.date));
    const byId = new Map(books.map((b) => [b.id, b]));
    const audioMinutes = inYear.filter((s) => LK.audio.isAudioSession(s, byId)).reduce((a, s) => a + (s.durationMinutes || 0), 0);
    const paged = inYear.filter((s) => s.durationMinutes > 0 && s.pagesRead > 0);
    const pagedMinutes = paged.reduce((a, s) => a + s.durationMinutes, 0);
    const pagedPages = paged.reduce((a, s) => a + s.pagesRead, 0);

    const pagesByMonth = Array(12).fill(0);
    inYear.forEach((s) => (pagesByMonth[Number(s.date.slice(5, 7)) - 1] += s.pagesRead || 0));
    const finishedByMonth = Array(12).fill(0);
    finishedBooks.forEach((b) => finishedByMonth[Number(b.dateCompleted.slice(5, 7)) - 1]++);
    const bestIdx = pagesByMonth.some((n) => n > 0) ? pagesByMonth.indexOf(Math.max(...pagesByMonth)) : -1;

    const rated = finishedBooks.filter((b) => b.rating);
    const avgRating = rated.length ? rated.reduce((a, b) => a + b.rating, 0) / rated.length : 0;

    const byRating = finishedBooks.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.totalPages || 0) - (a.totalPages || 0));
    const hasRatings = rated.length > 0;

    const authors = new Map();
    finishedBooks.forEach((b) => {
      const name = (b.author || '').split(/[,;]/)[0].trim();
      if (name && !/desconocido/i.test(name)) authors.set(name, (authors.get(name) || 0) + 1);
    });
    const topAuthorEntry = [...authors.entries()].sort((a, b) => b[1] - a[1])[0];

    const withPages = finishedBooks.filter((b) => b.totalPages > 0);
    const formats = { paper: 0, ebook: 0, audio: 0 };
    finishedBooks.forEach((b) => (formats[b.format] = (formats[b.format] || 0) + 1));

    const attrs = {};
    finishedBooks.forEach((b) => LK.rpg.statsForBook(b).forEach((s) => (attrs[s] = (attrs[s] || 0) + 1)));
    const topAttr = Object.entries(attrs).sort((a, b) => b[1] - a[1])[0];

    return {
      year: Number(year),
      name: profile?.name || 'Lector',
      goal: profile?.yearlyGoal || 0,
      finished: finishedBooks.length,
      books: finishedBooks,
      pages,
      minutes,
      hours: minutes / 60,
      days: days.size,
      bestStreak: LK.ach.longestStreak(inYear),
      pagesByMonth,
      finishedByMonth,
      bestMonth: bestIdx >= 0 ? { idx: bestIdx, label: MONTHS[bestIdx], pages: pagesByMonth[bestIdx] } : null,
      avgRating,
      ratedCount: rated.length,
      top: byRating.slice(0, 5),
      topLabel: hasRatings ? 'Tus favoritos' : 'Lo que más leíste',
      longest: withPages.slice().sort((a, b) => b.totalPages - a.totalPages)[0] || null,
      shortest: withPages.length > 1 ? withPages.slice().sort((a, b) => a.totalPages - b.totalPages)[0] : null,
      topAuthor: topAuthorEntry && topAuthorEntry[1] >= 2 ? { name: topAuthorEntry[0], count: topAuthorEntry[1] } : null,
      formats,
      topAttr: topAttr ? { id: topAttr[0], count: topAttr[1] } : null,
      audioMinutes,
      // Ritmo de lectura: solo cuentan las sesiones con páginas (el audio no tiene)
      pace: pagedMinutes ? Math.round((pagedPages / pagedMinutes) * 60) : 0,
      empty: !finishedBooks.length && !inYear.length,
    };
  }

  LK.summary = { compute, years, MONTHS };
})(window.LK);
