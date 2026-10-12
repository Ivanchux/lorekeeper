/* ==========================================================
   PIEZAS DE INTERFAZ COMPARTIDAS  (LK.ui)
   Trozos de HTML que usan varias pantallas.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;

  /** Anillo de progreso (SVG). pct 0-100. */
  function ring(pct, { size = 64, stroke = 7, label = '', title = '' } = {}) {
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const off = c * (1 - u.clamp(pct, 0, 100) / 100);
    return `
      <svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" style="--c:${c.toFixed(1)}" role="img" aria-label="${u.esc(title)}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${stroke}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--accent)" stroke-width="${stroke}" stroke-linecap="round"
          stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
        ${label ? `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" class="ring-label">${label}</text>` : ''}
      </svg>`;
  }

  /** Iconito de formato (solo si no es papel). */
  const formatBadge = (book) =>
    book.format && book.format !== 'paper' ? `<span class="fmt-badge" title="${LK.books.FORMATS[book.format]}">${LK.books.FORMAT_ICONS[book.format]}</span>` : '';

  const loanBadge = (book) => {
    const l = LK.books.loan(book);
    return l ? `<span class="loan-badge ${l.overdue ? 'overdue' : ''}" title="${u.esc(l.text)}">🤝 ${u.esc(l.short)}</span>` : '';
  };

  const seriesLabel = (book) => (book.series ? `${u.esc(book.series)}${book.seriesNo != null ? ` · nº ${book.seriesNo}` : ''}` : '');

  /** Libro en la estantería (mini 3D + datos). */
  function shelfItem(book, src, listened = 0) {
    const pr = LK.books.progress(book, listened);
    const progress = book.status === 'reading' && pr.total ? `<div class="progress"><span style="width:${pr.pct}%"></span></div>` : '';
    const stars = book.rating ? `<div class="stars-static" aria-label="${book.rating} de 5">${'★'.repeat(book.rating)}</div>` : '';
    const hay = u.norm([book.title, book.author, book.series, ...(book.tags || [])].join(' '));
    return `
      <a class="shelf-item" href="#/libro/${encodeURIComponent(book.id)}" data-hay="${u.esc(hay)}">
        <div class="b3d-mini">${LK.book3d.markup(book, src, 'sm')}${formatBadge(book)}</div>
        <div class="shelf-meta">
          <div class="shelf-title">${u.esc(book.title)}</div>
          <div class="shelf-author">${u.esc(book.author)}</div>
          ${book.series ? `<div class="shelf-series">${seriesLabel(book)}</div>` : ''}
          ${loanBadge(book)}${progress}${stars}
        </div>
      </a>`;
  }

  /** Sección «avisos» de la pantalla de inicio. items: [{icon, text, action?, href?, cls?}] */
  function banners(items) {
    if (!items.length) return '';
    return `<div class="banners">${items
      .map(
        (b) => `
        <div class="banner ${b.cls || ''}" ${b.id ? `data-banner="${b.id}"` : ''}>
          <span class="banner-icon" aria-hidden="true">${b.icon}</span>
          <span class="banner-text">${b.text}</span>
          ${b.href ? `<a class="btn btn-sm" href="${b.href}">${b.cta || 'Ver'}</a>` : ''}
          ${b.action ? `<button class="btn btn-sm" data-banner-act="${b.action}">${b.cta || 'Ok'}</button>` : ''}
          ${b.dismiss ? `<button class="btn btn-ghost btn-icon" data-banner-dismiss="${b.id}" aria-label="Ocultar aviso">✕</button>` : ''}
        </div>`
      )
      .join('')}</div>`;
  }

  LK.ui = { ring, formatBadge, loanBadge, seriesLabel, shelfItem, banners };
})(window.LK);
