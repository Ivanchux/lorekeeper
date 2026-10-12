/* ==========================================================
   UTILIDADES
   Todo el código cuelga del objeto global `LK` para poder
   cargarse con <script> normales (sin servidor ni módulos).
   ========================================================== */

window.LK = window.LK || {};

(function (LK) {
  'use strict';

  const u = {};

  /** Escapa texto antes de meterlo en HTML (datos de la API, notas del usuario…). */
  u.esc = (str) =>
    String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  /** Id corto y único. */
  u.uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  /** Fecha local en formato AAAA-MM-DD (no UTC, para que medianoche cuente bien). */
  u.isoDate = (d = new Date()) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  u.parseISO = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };

  /** Suma días a una fecha AAAA-MM-DD. */
  u.addDays = (iso, n) => {
    const d = u.parseISO(iso);
    d.setDate(d.getDate() + n);
    return u.isoDate(d);
  };

  /** Días entre dos fechas AAAA-MM-DD (b − a). */
  u.daysBetween = (a, b) => Math.round((u.parseISO(b) - u.parseISO(a)) / 86400000);

  u.fmtDate = (s) =>
    s ? u.parseISO(s).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  u.fmtDuration = (minutes) => {
    const min = Math.round(minutes || 0);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  };

  /** Milisegundos → "MM:SS" o "H:MM:SS". */
  u.fmtClock = (ms) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${m}:${s}` : `${m}:${s}`;
  };

  u.fmtNum = (n) => Math.round(n || 0).toLocaleString('es-ES');

  /** "hace 3 min", "hace 2 h", "ayer"… */
  u.ago = (ts) => {
    if (!ts) return 'nunca';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 45) return 'hace unos segundos';
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    const d = Math.round(s / 86400);
    return d === 1 ? 'ayer' : `hace ${d} días`;
  };

  u.clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  /** Minúsculas, sin acentos y solo letras y números (para comparar textos). */
  u.norm = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');

  /** Hash numérico estable de un texto (para colores de portadas generadas). */
  u.hash = (s) => {
    let h = 0;
    for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) | 0;
    return Math.abs(h);
  };

  u.debounce = (fn, ms = 300) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  /** Dirección absoluta de un archivo de la app (para workers y vendors). */
  u.abs = (path) => new URL(path, document.baseURI).href;

  /** Carga un script una sola vez. Devuelve una promesa. */
  const scripts = new Map();
  u.loadScript = (src) => {
    if (!scripts.has(src)) {
      scripts.set(
        src,
        new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = src;
          s.onload = resolve;
          s.onerror = () => {
            scripts.delete(src);
            reject(new Error(`No se pudo cargar ${src}`));
          };
          document.head.appendChild(s);
        })
      );
    }
    return scripts.get(src);
  };

  /* ---------- Avisos (en cola, para que no se pisen) ---------- */

  const toastQueue = [];
  let toastBusy = false;

  function showNextToast() {
    const el = document.getElementById('toast');
    const next = toastQueue.shift();
    if (!el || !next) {
      toastBusy = false;
      return;
    }
    toastBusy = true;
    el.textContent = next.msg;
    el.dataset.type = next.type;
    el.classList.remove('show');
    void el.offsetWidth; // reinicia la animación si es seguido a otro aviso
    el.classList.add('show');
    if (next.type === 'level') LK.fx?.confetti(); // nivel, libro terminado o logro
    setTimeout(
      () => {
        el.classList.remove('show');
        setTimeout(showNextToast, 250);
      },
      next.type === 'level' ? 3800 : 2400
    );
  }

  /** type: '' | 'level' | 'error' */
  u.toast = (msg, type = '') => {
    // Un aviso idéntico al último en cola no se repite
    if (toastQueue.length && toastQueue[toastQueue.length - 1].msg === msg) return;
    toastQueue.push({ msg, type });
    if (!toastBusy) showNextToast();
  };

  /* ---------- Ventanas modales ---------- */

  /**
   * Abre un <dialog> con el HTML dado. Devuelve el elemento.
   * Se cierra con Escape, clic fuera o cualquier [data-close].
   */
  u.modal = (html, { wide = false } = {}) => {
    const d = document.createElement('dialog');
    d.className = wide ? 'modal modal-wide' : 'modal';
    d.innerHTML = `<div class="modal-body">${html}</div>`;
    document.body.appendChild(d);
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
      if (e.target.closest('[data-close]')) d.close();
    });
    d.showModal();
    return d;
  };

  /** Confirmación con estilo propio. Devuelve una promesa booleana. */
  u.confirm = (message, { ok = 'Aceptar', cancel = 'Cancelar', danger = false } = {}) =>
    new Promise((resolve) => {
      const d = u.modal(`
        <p>${u.esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-close>${u.esc(cancel)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${u.esc(ok)}</button>
        </div>`);
      let result = false;
      d.querySelector('[data-ok]').addEventListener('click', () => {
        result = true;
        d.close();
      });
      d.addEventListener('close', () => resolve(result));
      d.querySelector('[data-ok]').focus();
    });

  /** Descarga un texto o un Blob como archivo. */
  u.download = (filename, data, type = 'application/json') => {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  };

  /**
   * Comparte un archivo con el menú del móvil (WhatsApp, Drive, correo…).
   * Si el navegador no puede, lo descarga. Devuelve 'shared' | 'downloaded' | 'cancelled'.
   */
  u.shareFile = async (file, { title = '', text = '' } = {}) => {
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title, text });
        return 'shared';
      }
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
    u.download(file.name, file, file.type);
    return 'downloaded';
  };

  LK.util = u;
})(window.LK);
