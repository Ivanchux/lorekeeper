/* ==========================================================
   MOTOR RPG  (LK.rpg)
   Funciones puras: no tocan la base de datos ni el DOM.
   Nivel, EXP y atributos se CALCULAN a partir de las sesiones
   guardadas, así nunca se desincronizan (si borras una sesión
   o un libro, el progreso se recalcula solo).
   ========================================================== */

(function (LK) {
  'use strict';

  /** Bonus de EXP al terminar un libro. */
  const COMPLETION_BONUS = 50;
  /** Páginas leídas de un género para ganar 1 punto de atributo. */
  const PAGES_PER_POINT = 20;
  const BASE_STAT = 10;

  /** Atributos y los géneros que los alimentan (inglés de Google Books + castellano). */
  const STATS = [
    {
      id: 'sistemas',
      name: 'Sistemas',
      desc: 'Tecnología, ciencia ficción, informática',
      keys: ['science fiction', 'sci-fi', 'cyberpunk', 'technology', 'computers', 'computing', 'programming', 'ciencia ficción', 'tecnología', 'informática', 'programación'],
    },
    {
      id: 'ocultismo',
      name: 'Ocultismo',
      desc: 'Terror, fantasía, folklore',
      keys: ['horror', 'fantasy', 'folklore', 'occult', 'supernatural', 'paranormal', 'ghost', 'mythology', 'terror', 'fantasía', 'mitología', 'sobrenatural'],
    },
    {
      id: 'valor',
      name: 'Valor',
      desc: 'Thriller, misterio, acción',
      keys: ['thriller', 'mystery', 'action', 'adventure', 'crime', 'detective', 'suspense', 'military', 'misterio', 'acción', 'aventura', 'policiaca', 'policíaca', 'novela negra', 'bélica'],
    },
    {
      id: 'carisma',
      name: 'Carisma',
      desc: 'Ficción general, romance',
      keys: ['romance', 'love', 'drama', 'poetry', 'humor', 'comics', 'graphic novel', 'poesía', 'amor', 'cómic', 'novela gráfica'],
    },
    {
      id: 'intelecto',
      name: 'Intelecto',
      desc: 'Ciencia, historia, ensayo',
      keys: ['science', 'history', 'philosophy', 'essay', 'biography', 'psychology', 'economics', 'political', 'mathematics', 'self-help', 'business', 'ciencia', 'historia', 'filosofía', 'ensayo', 'biografía', 'psicología', 'economía', 'política', 'matemáticas'],
    },
  ];

  /** Títulos de rango según el nivel. */
  const TITLES = [
    [1, 'Aprendiz'],
    [3, 'Lector'],
    [5, 'Escriba'],
    [8, 'Erudito'],
    [12, 'Archivista'],
    [16, 'Cronista'],
    [20, 'Custodio del Saber'],
    [30, 'Guardián del Lore'],
  ];

  /** EXP de una sesión: páginas × 2 + minutos × 1,5 */
  const sessionExp = (pagesRead, minutes) => Math.round((pagesRead || 0) * 2 + (minutes || 0) * 1.5);

  /** EXP necesaria para pasar de `level` al siguiente: nivel^1,5 × 100 */
  const expToNext = (level) => Math.round(Math.pow(level, 1.5) * 100);

  /** Nivel y progreso a partir de la EXP total. */
  function levelFromExp(totalExp) {
    let level = 1;
    let remaining = totalExp;
    while (remaining >= expToNext(level)) {
      remaining -= expToNext(level);
      level++;
    }
    const needed = expToNext(level);
    return { level, current: remaining, needed, progress: remaining / needed };
  }

  const titleFor = (level) => TITLES.filter(([min]) => level >= min).pop()[1];

  /**
   * Atributos que sube un libro según sus géneros.
   * Las categorías de Google Books vienen como "Fiction / Science Fiction / General".
   * Las claves largas se comprueban primero y se eliminan del texto al coincidir,
   * así "science fiction" no cuenta también como "science".
   * La ficción genérica solo cuenta como Carisma si no encaja en nada más concreto.
   */
  function statsForGenres(genres = []) {
    let text = ` ${genres.join(' ').toLowerCase()} `;
    const pairs = STATS.flatMap((s) => s.keys.map((k) => [k, s.id])).sort((a, b) => b[0].length - a[0].length);
    const hits = new Set();
    for (const [key, stat] of pairs) {
      if (text.includes(key)) {
        hits.add(stat);
        text = text.split(key).join(' ');
      }
    }
    if (hits.size === 0 && /\b(fiction|ficción|novela|literary|literatura)\b/.test(text)) hits.add('carisma');
    return [...hits];
  }

  /** Atributos de un libro: el elegido a mano o los deducidos del género. */
  const statsForBook = (book) => (book.statOverride ? [book.statOverride] : statsForGenres(book.genres));

  /**
   * Progreso completo del lector a partir de libros y sesiones.
   * Devuelve EXP total, nivel, título y atributos.
   */
  function compute(books, sessions) {
    const byId = new Map(books.map((b) => [b.id, b]));
    const pages = Object.fromEntries(STATS.map((s) => [s.id, 0]));
    let totalExp = 0;

    for (const s of sessions) {
      totalExp += sessionExp(s.pagesRead, s.durationMinutes);
      const book = byId.get(s.bookId);
      if (!book) continue;
      // Audiolibros: sin páginas, cada 2 min escuchados cuentan como 1 página para los atributos
      // Si hay posición (de/a), cuenta lo avanzado del libro; si no, el tiempo escuchado
      const advanced = s.toMin != null && s.fromMin != null ? Math.max(0, s.toMin - s.fromMin) : s.durationMinutes || 0;
      const eq = s.pagesRead || (book.format === 'audio' ? Math.round(advanced / 2) : 0);
      for (const stat of statsForBook(book)) pages[stat] += eq;
    }
    // Los libros importados de otra app no dan bonus (no los has terminado aquí)
    totalExp += books.filter((b) => b.status === 'completed' && !b.imported).length * COMPLETION_BONUS;

    const stats = Object.fromEntries(STATS.map((s) => [s.id, BASE_STAT + Math.floor(pages[s.id] / PAGES_PER_POINT)]));
    const lvl = levelFromExp(totalExp);
    return { totalExp, ...lvl, title: titleFor(lvl.level), stats, statPages: pages };
  }

  LK.rpg = {
    STATS,
    COMPLETION_BONUS,
    PAGES_PER_POINT,
    BASE_STAT,
    sessionExp,
    expToNext,
    levelFromExp,
    titleFor,
    statsForGenres,
    statsForBook,
    compute,
    statName: (id) => STATS.find((s) => s.id === id)?.name || id,
  };
})(window.LK);
