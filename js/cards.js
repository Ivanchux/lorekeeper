/* ==========================================================
   TARJETAS PARA COMPARTIR  (LK.cards)
   Dibuja en un <canvas> imágenes con el tema actual:
   - cita de un libro (1080×1350)
   - «Tu año en libros» (1080×1920, formato historia)
   Se comparten con el menú del móvil o se descargan.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;

  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => cs.getPropertyValue(n).trim() || d;
    return {
      bg: v('--bg', '#0b0b10'),
      surface: v('--surface', '#14141c'),
      surface2: v('--surface-2', '#1d1d28'),
      border: v('--border', '#2a2a3a'),
      text: v('--text', '#e4e4ec'),
      muted: v('--text-muted', '#8c8ca3'),
      accent: v('--accent', '#00e1ec'),
      accent2: v('--accent-2', '#ff3dd8'),
      contrast: v('--accent-contrast', '#001214'),
      star: v('--star', '#ffd35c'),
      font: v('--font-body', 'system-ui, sans-serif'),
      display: v('--font-display', v('--font-body', 'system-ui, sans-serif')),
    };
  }

  const make = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')];
  };

  const toBlob = (canvas) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen'))), 'image/png'));

  /** Divide un texto en líneas que caben en maxW con la fuente actual del contexto. */
  function wrap(ctx, text, maxW) {
    const lines = [];
    for (const para of String(text).split(/\n+/)) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = word;
        } else line = test;
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  /** Reduce el tamaño hasta que el texto cabe en (maxW × maxH). Devuelve {size, lines, lh}. */
  function fit(ctx, text, fontFn, maxW, maxH, start, min, lhk = 1.35) {
    for (let size = start; size >= min; size -= 2) {
      ctx.font = fontFn(size);
      const lines = wrap(ctx, text, maxW);
      if (lines.length * size * lhk <= maxH) return { size, lines, lh: size * lhk };
    }
    ctx.font = fontFn(min);
    const lines = wrap(ctx, text, maxW);
    const max = Math.floor(maxH / (min * lhk));
    const cut = lines.slice(0, max);
    if (lines.length > max) cut[cut.length - 1] = cut[cut.length - 1].replace(/\s*\S*$/, '') + '…';
    return { size: min, lines: cut, lh: min * lhk };
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      if (!src.startsWith('blob:') && !src.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.referrerPolicy = 'no-referrer';
      img.src = src;
    });
  }

  /** Portada pequeña: imagen real si se puede, si no una generada con título. */
  async function drawCover(ctx, p, book, src, x, y, w, h) {
    const img = await loadImage(src);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    if (img) {
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
      return;
    }
    const hue = u.hash(book.title + book.author) % 360;
    ctx.fillStyle = `hsl(${hue} 38% 30%)`;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    ctx.fillStyle = `hsl(${hue} 40% 20%)`;
    ctx.fillRect(x, y, Math.max(6, w * 0.07), h);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    const pad = w * 0.12;
    const f = fit(ctx, book.title, (s) => `700 ${s}px ${p.display}`, w - pad * 2, h * 0.6, Math.round(w * 0.14), 12, 1.2);
    ctx.font = `700 ${f.size}px ${p.display}`;
    f.lines.forEach((l, i) => ctx.fillText(l, x + w / 2, y + h * 0.2 + i * f.lh + f.size));
    ctx.textAlign = 'left';
  }

  function backdrop(ctx, p, w, h) {
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w * 0.85, 0, 0, w * 0.85, 0, w * 1.1);
    g.addColorStop(0, hexA(p.accent, 0.28));
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const g2 = ctx.createRadialGradient(0, h, 0, 0, h, w);
    g2.addColorStop(0, hexA(p.accent2, 0.16));
    g2.addColorStop(1, 'transparent');
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, h);
  }

  /** '#rrggbb' → 'rgba(...)' (los colores de tema son hex). */
  function hexA(color, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /* ---------------- Cita ---------------- */

  async function quoteCard(quote, book, coverSrc) {
    const p = palette();
    const W = 1080;
    const H = 1350;
    const [canvas, ctx] = make(W, H);
    backdrop(ctx, p, W, H);

    // marco
    ctx.strokeStyle = p.border;
    ctx.lineWidth = 3;
    ctx.strokeRect(48, 48, W - 96, H - 96);

    ctx.fillStyle = p.accent;
    ctx.font = `700 220px ${p.display}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('“', 90, 330);

    const text = quote.text.trim();
    const f = fit(ctx, text, (s) => `${p.font.includes('serif') ? '' : ''}500 ${s}px ${p.font}`, W - 220, 700, 66, 30);
    ctx.fillStyle = p.text;
    ctx.font = `500 ${f.size}px ${p.font}`;
    f.lines.forEach((l, i) => ctx.fillText(l, 110, 400 + i * f.lh));

    // pie: portada + datos
    const footY = H - 330;
    ctx.fillStyle = p.surface;
    ctx.fillRect(48, footY - 40, W - 96, 322);
    ctx.strokeStyle = p.border;
    ctx.strokeRect(48, footY - 40, W - 96, 322);
    await drawCover(ctx, p, book, coverSrc, 100, footY, 150, 225);

    ctx.fillStyle = p.text;
    const tf = fit(ctx, book.title, (s) => `700 ${s}px ${p.display}`, W - 480, 110, 44, 26, 1.2);
    ctx.font = `700 ${tf.size}px ${p.display}`;
    tf.lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, 290, footY + 50 + i * tf.lh));
    ctx.fillStyle = p.muted;
    ctx.font = `400 32px ${p.font}`;
    ctx.fillText(book.author || '', 290, footY + 50 + Math.min(2, tf.lines.length) * tf.lh + 12);
    if (quote.page) ctx.fillText(`Página ${quote.page}`, 290, footY + 200);

    ctx.fillStyle = p.accent;
    ctx.font = `700 26px ${p.display}`;
    ctx.textAlign = 'right';
    ctx.fillText('LOREKEEPER', W - 100, footY + 235);
    ctx.textAlign = 'left';
    return toBlob(canvas);
  }

  /* ---------------- Tu año en libros ---------------- */

  /**
   * summary: salida de LK.summary.compute(). Usa los 5 mejores libros para las portadas.
   */
  async function yearCard(summary, covers = {}) {
    const p = palette();
    const W = 1080;
    const H = 1920;
    const [canvas, ctx] = make(W, H);
    backdrop(ctx, p, W, H);
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = p.accent;
    ctx.font = `700 34px ${p.display}`;
    ctx.fillText('LOREKEEPER', 80, 120);
    ctx.fillStyle = p.muted;
    ctx.font = `400 34px ${p.font}`;
    ctx.fillText(summary.name, 80, 168);

    ctx.fillStyle = p.text;
    ctx.font = `700 120px ${p.display}`;
    ctx.fillText('Tu año', 80, 330);
    ctx.fillText('en libros', 80, 450);
    ctx.fillStyle = p.accent;
    ctx.font = `700 120px ${p.display}`;
    ctx.fillText(String(summary.year), 80, 570);

    // cifras
    const stats = [
      [String(summary.finished), summary.finished === 1 ? 'libro leído' : 'libros leídos'],
      [u.fmtNum(summary.pages), 'páginas'],
      [summary.hours >= 1 ? `${Math.round(summary.hours)} h` : `${Math.round(summary.minutes)} min`, summary.audioMinutes ? 'de lectura y audio' : 'leyendo'],
      [`${summary.bestStreak}`, summary.bestStreak === 1 ? 'día de racha' : 'días de racha'],
    ];
    stats.forEach(([big, small], i) => {
      const x = 80 + (i % 2) * 460;
      const y = 700 + Math.floor(i / 2) * 190;
      ctx.fillStyle = p.surface;
      ctx.fillRect(x, y, 430, 160);
      ctx.strokeStyle = p.border;
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, 430, 160);
      ctx.fillStyle = p.text;
      ctx.font = `700 70px ${p.display}`;
      ctx.fillText(big, x + 28, y + 85);
      ctx.fillStyle = p.muted;
      ctx.font = `400 30px ${p.font}`;
      ctx.fillText(small, x + 28, y + 130);
    });

    // portadas
    const top = summary.top.slice(0, 5);
    if (top.length) {
      ctx.fillStyle = p.muted;
      ctx.font = `700 30px ${p.display}`;
      ctx.fillText(summary.topLabel.toUpperCase(), 80, 1140);
      const cw = 170;
      const gap = 22;
      const total = top.length * cw + (top.length - 1) * gap;
      let x = (W - total) / 2;
      for (const b of top) {
        await drawCover(ctx, p, b, covers[b.id], x, 1175, cw, 255);
        x += cw + gap;
      }
    }

    // destacados
    ctx.fillStyle = p.text;
    ctx.font = `400 34px ${p.font}`;
    const facts = [];
    if (summary.longest) facts.push(`Más largo: ${clip(ctx, summary.longest.title, 640)} (${summary.longest.totalPages} págs.)`);
    if (summary.topAuthor) facts.push(`Autor/a del año: ${clip(ctx, summary.topAuthor.name, 560)}`);
    if (summary.bestMonth) facts.push(`Mejor mes: ${summary.bestMonth.label} (${u.fmtNum(summary.bestMonth.pages)} págs.)`);
    facts.slice(0, 3).forEach((t, i) => ctx.fillText(t, 80, 1530 + i * 62));

    ctx.fillStyle = p.muted;
    ctx.font = `400 28px ${p.font}`;
    ctx.fillText('Hecho con LoreKeeper · gratis y sin anuncios', 80, H - 80);
    return toBlob(canvas);
  }

  function clip(ctx, text, maxW) {
    let t = String(text);
    while (ctx.measureText(t).width > maxW && t.length > 4) t = t.slice(0, -2);
    return t === String(text) ? t : t.trimEnd() + '…';
  }

  LK.cards = { quoteCard, yearCard, palette };
})(window.LK);
