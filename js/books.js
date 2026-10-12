/* ==========================================================
   AYUDANTES DE LIBROS  (LK.books)
   Estados, formatos, progreso, préstamos, sagas, etiquetas e ISBN.
   Funciones puras: no tocan la base de datos ni el DOM.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;

  const STATUSES = [
    ['reading', 'Leyendo'],
    ['wishlist', 'Pendientes'],
    ['completed', 'Leídos'],
    ['abandoned', 'Abandonados'],
  ];

  const FORMATS = { paper: 'Papel', ebook: 'Ebook', audio: 'Audiolibro' };
  const FORMAT_ICONS = { paper: '📖', ebook: '📱', audio: '🎧' };

  const statusLabel = (id) => (STATUSES.find(([s]) => s === id) || [, id])[1];
  const isAudio = (book) => book.format === 'audio';

  /** { bookId: minutosTotales } a partir de las sesiones. */
  function listenedMap(sessions) {
    const map = {};
    for (const s of sessions) map[s.bookId] = (map[s.bookId] || 0) + (s.durationMinutes || 0);
    return map;
  }

  /**
   * Progreso de un libro.
   * Papel y ebook se miden en páginas; los audiolibros, en tiempo escuchado.
   */
  function progress(book, listenedMin = 0) {
    if (isAudio(book)) {
      // Se mide por el punto del audio en el que vas (listenPos); sin él, por el tiempo escuchado
      const total = book.totalMinutes || 0;
      const hasPos = book.listenPos != null;
      const done = hasPos ? book.listenPos : listenedMin;
      return {
        unit: 'time',
        done,
        total,
        pct: total ? u.clamp(Math.round((done / total) * 100), 0, 100) : 0,
        text: total ? `${u.fmtDuration(done)} de ${u.fmtDuration(total)}` : hasPos ? `Vas por ${u.fmtDuration(done)}` : `${u.fmtDuration(done)} escuchados`,
      };
    }
    const total = book.totalPages || 0;
    const done = book.readPages || 0;
    return {
      unit: 'pages',
      done,
      total,
      pct: total ? u.clamp(Math.round((done / total) * 100), 0, 100) : 0,
      text: total ? `Página ${done} de ${total}` : `Página ${done}`,
    };
  }

  /**
   * Estado del préstamo de un libro, o null si no está prestado.
   * dir: 'lent' (lo he prestado) | 'borrowed' (me lo han prestado)
   */
  function loan(book, today = u.isoDate()) {
    const l = book.loan;
    if (!l || !l.person) return null;
    const out = { ...l, daysLeft: null, overdue: false };
    if (l.due) {
      out.daysLeft = u.daysBetween(today, l.due);
      out.overdue = out.daysLeft < 0;
    }
    const who = l.dir === 'borrowed' ? `Te lo ha prestado ${l.person}` : `Prestado a ${l.person}`;
    let when = '';
    if (l.due) {
      if (out.overdue) when = ` · venció hace ${Math.abs(out.daysLeft)} ${Math.abs(out.daysLeft) === 1 ? 'día' : 'días'}`;
      else if (out.daysLeft === 0) when = ' · vence hoy';
      else if (out.daysLeft === 1) when = ' · vence mañana';
      else when = ` · vence el ${u.fmtDate(l.due)}`;
    }
    out.text = who + when;
    out.short = l.dir === 'borrowed' ? `De ${l.person}` : `A ${l.person}`;
    return out;
  }

  /** Sagas: [{ name, books (ordenados), done, total }] */
  function seriesGroups(books) {
    const map = new Map();
    for (const b of books) {
      const name = (b.series || '').trim();
      if (!name) continue;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(b);
    }
    return [...map.entries()]
      .map(([name, list]) => {
        list.sort((a, b) => (a.seriesNo ?? 999) - (b.seriesNo ?? 999) || a.title.localeCompare(b.title, 'es'));
        return { name, books: list, done: list.filter((b) => b.status === 'completed').length, total: list.length };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  /** Etiquetas usadas, con recuento: [{ tag, count }] */
  function tagCounts(books) {
    const map = new Map();
    for (const b of books) for (const t of b.tags || []) map.set(t, (map.get(t) || 0) + 1);
    return [...map.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'es'));
  }

  /** Texto "a, b, c" → ['a','b','c'] sin vacíos ni repetidos. */
  const splitList = (text) => [...new Set(String(text || '').split(/[,;|\n]/).map((s) => s.trim()).filter(Boolean))];

  /* ---------------- ISBN ---------------- */

  const isbn = {
    /** Deja solo dígitos y X. */
    clean: (s) => String(s || '').replace(/[^0-9Xx]/g, '').toUpperCase(),

    valid13(s) {
      if (!/^\d{13}$/.test(s)) return false;
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
      return (10 - (sum % 10)) % 10 === Number(s[12]);
    },

    valid10(s) {
      if (!/^\d{9}[\dX]$/.test(s)) return false;
      let sum = 0;
      for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
      return sum % 11 === 0;
    },

    to13(s10) {
      const body = '978' + s10.slice(0, 9);
      let sum = 0;
      for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 ? 3 : 1);
      return body + ((10 - (sum % 10)) % 10);
    },

    /** Devuelve un ISBN-13 válido o '' si el texto no es un ISBN. */
    normalize(s) {
      const c = isbn.clean(s);
      if (c.length === 13 && isbn.valid13(c)) return c;
      if (c.length === 10 && isbn.valid10(c)) return isbn.to13(c);
      return '';
    },
  };

  LK.books = { STATUSES, FORMATS, FORMAT_ICONS, statusLabel, isAudio, listenedMap, progress, loan, seriesGroups, tagCounts, splitList, isbn };
})(window.LK);
