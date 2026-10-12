/* ==========================================================
   GRÁFICAS  (LK.charts)
   SVG generado a mano, sin librerías. Los colores salen de las
   variables del tema, así cada estética las pinta a su manera.
   Pasa el ratón (o mantén pulsado) sobre una barra o casilla
   para ver su valor.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  /** Agrupa páginas leídas por día: { 'AAAA-MM-DD': páginas } */
  const valueOf = (s, metric) => (metric === 'minutes' ? s.durationMinutes || 0 : s.pagesRead || 0);
  const unitOf = (metric) => (metric === 'minutes' ? 'min' : 'págs.');

  function pagesByDay(sessions, metric = 'pages') {
    const map = {};
    for (const s of sessions) map[s.date] = (map[s.date] || 0) + valueOf(s, metric);
    return map;
  }

  /* ---------------- Radar de atributos ---------------- */

  function radar(stats, defs) {
    const size = 280;
    const c = size / 2;
    const r = 96;
    const n = defs.length;
    const max = Math.max(20, ...defs.map((d) => stats[d.id])) * 1.05;
    const pt = (i, f) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [c + Math.cos(a) * r * f, c + Math.sin(a) * r * f];
    };
    const poly = (f) => defs.map((_, i) => pt(i, f).join(',')).join(' ');

    const rings = [0.25, 0.5, 0.75, 1].map((f) => `<polygon class="radar-grid" points="${poly(f)}"/>`).join('');
    const spokes = defs.map((_, i) => `<line class="grid-line" x1="${c}" y1="${c}" x2="${pt(i, 1)[0]}" y2="${pt(i, 1)[1]}"/>`).join('');
    const area = defs.map((d, i) => pt(i, stats[d.id] / max).join(',')).join(' ');
    const dots = defs
      .map((d, i) => {
        const [x, y] = pt(i, stats[d.id] / max);
        return `<circle class="radar-dot" cx="${x}" cy="${y}" r="4.5"><title>${d.name}: ${stats[d.id]}</title></circle>`;
      })
      .join('');
    const labels = defs
      .map((d, i) => {
        const [x, y] = pt(i, 1.2);
        const anchor = Math.abs(x - c) < 4 ? 'middle' : x > c ? 'start' : 'end';
        return `<text class="radar-label" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle">${d.name}</text>`;
      })
      .join('');

    return `
      <svg class="chart" viewBox="-30 0 ${size + 60} ${size}" role="img" aria-label="Gráfico de atributos">
        ${rings}${spokes}
        <polygon class="radar-area" points="${area}"/>
        ${dots}${labels}
      </svg>`;
  }

  /* ---------------- Calendario de lectura (heatmap) ---------------- */

  const heatLevel = (p, metric) => {
    const t = metric === 'minutes' ? [15, 30, 60] : [10, 25, 50];
    return p <= 0 ? 0 : p <= t[0] ? 1 : p <= t[1] ? 2 : p <= t[2] ? 3 : 4;
  };

  function heatmap(sessions, weeks = 26, metric = 'pages') {
    const byDay = pagesByDay(sessions, metric);
    const cell = 15;
    const gap = 4;
    const step = cell + gap;
    const left = 22;
    const top = 18;

    // Empieza en el lunes de hace `weeks` semanas
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    const dow = (today.getDay() + 6) % 7; // lunes = 0
    start.setDate(today.getDate() - dow - (weeks - 1) * 7);

    let cells = '';
    let monthLabels = '';
    let lastMonth = -1;
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(start);
        date.setDate(start.getDate() + w * 7 + d);
        if (date > today) continue;
        const iso = u.isoDate(date);
        const pages = byDay[iso] || 0;
        const x = left + w * step;
        const y = top + d * step;
        cells += `<rect class="cell h${heatLevel(pages, metric)}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2"><title>${u.fmtDate(iso)}: ${pages} ${unitOf(metric)}</title></rect>`;
        if (d === 0 && date.getMonth() !== lastMonth && date.getDate() <= 7) {
          lastMonth = date.getMonth();
          monthLabels += `<text x="${x}" y="11">${MONTHS[lastMonth]}</text>`;
        }
      }
    }
    const dayLabels = [['L', 0], ['X', 2], ['V', 4]]
      .map(([l, d]) => `<text x="0" y="${top + d * step + cell - 2}">${l}</text>`)
      .join('');
    const width = left + weeks * step + 14;
    const height = top + 7 * step;

    return `
      <div class="chart-scroll">
        <svg class="chart chart-fixed heatmap" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Calendario de lectura de las últimas ${weeks} semanas">
          ${monthLabels}${dayLabels}${cells}
        </svg>
      </div>
      <div class="heat-legend">Menos
        <i class="h0"></i><i class="h1"></i><i class="h2"></i><i class="h3"></i><i class="h4"></i>
      Más</div>`;
  }

  /* ---------------- Páginas por mes (barras) ---------------- */

  /** Redondea hacia arriba a un número "bonito" para el eje. */
  function niceMax(v) {
    if (v <= 10) return 10;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  function monthlyBars(sessions, months = 12, metric = 'pages') {
    const now = new Date();
    const buckets = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS[d.getMonth()], year: d.getFullYear(), pages: 0 });
    }
    const index = Object.fromEntries(buckets.map((b, i) => [b.key, i]));
    for (const s of sessions) {
      const i = index[String(s.date).slice(0, 7)];
      if (i !== undefined) buckets[i].pages += valueOf(s, metric);
    }

    const W = 640;
    const H = 200;
    const padL = 36;
    const padB = 24;
    const padT = 14;
    const plotW = W - padL;
    const plotH = H - padB - padT;
    const max = niceMax(Math.max(...buckets.map((b) => b.pages)));
    const slot = plotW / months;
    const bw = Math.min(30, slot * 0.6);

    const ticks = [0, 0.5, 1]
      .map((f) => {
        const y = padT + plotH - f * plotH;
        return `<line class="grid-line" x1="${padL}" x2="${W}" y1="${y}" y2="${y}"/><text x="${padL - 6}" y="${y + 4}" text-anchor="end">${u.fmtNum(max * f)}</text>`;
      })
      .join('');

    const bars = buckets
      .map((b, i) => {
        const h = (b.pages / max) * plotH;
        const x = padL + i * slot + (slot - bw) / 2;
        const y = padT + plotH - h;
        const r = Math.min(4, h, bw / 2);
        // Barra con las esquinas superiores redondeadas y la base recta
        const path = h > 0
          ? `<path class="bar" d="M${x},${padT + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${padT + plotH} Z"/>`
          : '';
        // Zona de hover más grande que la barra
        const hit = `<rect x="${padL + i * slot}" y="${padT}" width="${slot}" height="${plotH}" fill="transparent"><title>${b.label} ${b.year}: ${u.fmtNum(b.pages)} ${unitOf(metric)}</title></rect>`;
        const label = `<text x="${padL + i * slot + slot / 2}" y="${H - 6}" text-anchor="middle">${b.label}</text>`;
        return path + label + hit;
      })
      .join('');

    return `<div class="chart-scroll"><svg class="chart" viewBox="0 0 ${W} ${H}" style="min-width:520px" role="img" aria-label="${metric === 'minutes' ? 'Minutos' : 'Páginas'} por mes">${ticks}${bars}</svg></div>`;
  }

  /* ---------------- Rosco (gráfico de anillo) ---------------- */

  /**
   * Anillo dividido en porciones con su leyenda.
   * rows: [{ label, value }] (ya ordenadas); se muestran las `max` mayores y el resto como «Otros».
   * center: { big, small } texto en el centro.
   */
  function donut(rows, { center = {}, max = 6, unit = '' } = {}) {
    const clean = rows.filter((r) => r.value > 0);
    const total = clean.reduce((a, r) => a + r.value, 0);
    if (!total) return '<p class="muted small">Todavía no hay datos para este gráfico.</p>';
    let shown = clean.slice(0, max);
    const rest = clean.slice(max);
    if (rest.length) shown.push({ label: 'Otros', value: rest.reduce((a, r) => a + r.value, 0), rest: true });
    const R = 46;
    const C = 2 * Math.PI * R;
    const GAP = shown.length > 1 ? 2 : 0; // hueco entre porciones
    let offset = 0;
    const segs = shown
      .map((r, i) => {
        const len = (r.value / total) * C;
        const dash = Math.max(0.5, len - GAP);
        const html = `<circle class="donut-seg ${r.rest ? 'd-rest' : r.none ? 'd-none' : `d-c${i % 7}`}" cx="60" cy="60" r="${R}" fill="none" stroke-width="20" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"><title>${u.esc(r.label)}: ${u.fmtNum(r.value)}${unit ? ' ' + unit : ''} (${Math.round((r.value / total) * 100)} %)</title></circle>`;
        offset += len;
        return html;
      })
      .join('');
    const legend = shown
      .map((r, i) => `<li><i class="donut-dot ${r.rest ? 'd-rest' : r.none ? 'd-none' : `d-c${i % 7}`}"></i><span class="donut-name">${u.esc(r.label)}</span><span class="donut-val">${u.fmtNum(r.value)}<small>${Math.round((r.value / total) * 100)} %</small></span></li>`)
      .join('');
    return `
      <div class="donut">
        <svg viewBox="0 0 120 120" role="img" aria-label="${u.esc(center.small || 'Gráfico')}: ${shown.map((r) => `${r.label} ${Math.round((r.value / total) * 100)} %`).join(', ')}">
          <circle cx="60" cy="60" r="${R}" fill="none" stroke-width="20" class="donut-track"/>
          <g class="donut-ring">${segs}</g>
          <text x="60" y="${center.small ? 58 : 64}" text-anchor="middle" class="donut-big">${u.esc(center.big ?? u.fmtNum(total))}</text>
          ${center.small ? `<text x="60" y="74" text-anchor="middle" class="donut-small">${u.esc(center.small)}</text>` : ''}
        </svg>
        <ul class="donut-legend">${legend}</ul>
      </div>`;
  }

  LK.charts = { radar, heatmap, monthlyBars, pagesByDay, donut };
})(window.LK);
