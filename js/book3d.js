/* ==========================================================
   LIBRO 3D  (LK.book3d)
   - markup(): genera el HTML de un libro con 6 caras.
   - spin():   lo hace girar solo y permite arrastrarlo con
               ratón, dedo o teclado, con inercia al soltar.
   El giro se calcula en JS (no con @keyframes), así al soltar
   el libro sigue desde el ángulo exacto en que lo dejaste.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;

  /* ---------- Color de la portada ----------
     Se saca el color dominante de la imagen y se aplica al lomo, a la
     contraportada, a los cantos y al halo. Se recuerda en localStorage
     (por libro y portada) para que la próxima vez salga ya pintado.
     Si el servidor de la imagen no permite leerla (CORS), el libro
     conserva el tono derivado del título; en cuanto la portada se guarda
     en el dispositivo, sí se puede leer. */

  const CC_KEY = 'lk-cc';
  let ccCache = null;

  function ccLoad() {
    if (!ccCache) {
      try {
        ccCache = JSON.parse(localStorage.getItem(CC_KEY) || '{}');
      } catch {
        ccCache = {};
      }
    }
    return ccCache;
  }

  function ccSave() {
    try {
      const keys = Object.keys(ccCache);
      if (keys.length > 400) keys.slice(0, keys.length - 400).forEach((k) => delete ccCache[k]);
      localStorage.setItem(CC_KEY, JSON.stringify(ccCache));
    } catch {
      /* sin almacenamiento: se recalcula la próxima vez */
    }
  }

  const colorKey = (book) => `${book.id || ''}|${book.coverUrl || ''}`;

  /** RGB (0-255) → [h 0-360, s 0-1, l 0-1] */
  function toHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
  }

  /** Color dominante y "vistoso" de una imagen: {h, s, l} listo para CSS. */
  function dominant(img) {
    const W = 28;
    const H = 42;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;

    const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
    let lum = 0;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 200) continue;
      const [h, s, l] = toHsl(px[i], px[i + 1], px[i + 2]);
      lum += l;
      n++;
      if (s < 0.18 || l < 0.12 || l > 0.9) continue; // grises, negros y blancos no cuentan
      const w = s * (1 - Math.abs(l - 0.5) * 1.2);
      const bin = bins[Math.floor(h / 30) % 12];
      bin.w += w;
      bin.r += px[i] * w;
      bin.g += px[i + 1] * w;
      bin.b += px[i + 2] * w;
    }
    if (!n) throw new Error('imagen vacía');

    const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
    if (best.w < n * 0.015) {
      // Portada casi en blanco y negro: tapa gris azulada del brillo medio
      return { h: 215, s: 10, l: Math.round(u.clamp((lum / n) * 100, 24, 40)) };
    }
    const [h, s, l] = toHsl(best.r / best.w, best.g / best.w, best.b / best.w);
    return { h: Math.round(h), s: Math.round(u.clamp(s * 100, 28, 72)), l: Math.round(u.clamp(l * 100, 28, 44)) };
  }

  function setTint(el, c) {
    el.style.setProperty('--ch', c.h);
    el.style.setProperty('--cs', `${c.s}%`);
    el.style.setProperty('--cl', `${c.l}%`);
    el.dataset.tint = '1';
  }

  /** Aplica el color al libro y a lo que lo rodea (escena, tarjeta, temporizador). */
  function paint(b3d, c) {
    setTint(b3d, c);
    const scene = b3d.closest('.b3d-scene');
    if (scene) setTint(scene, c);
    const wrap = b3d.closest('.hero, .detail-top, .timer-overlay');
    if (wrap) setTint(wrap, c);
  }

  /** Pinta con el color ya conocido (si lo hay). */
  function paintCached(b3d) {
    const c = b3d?.dataset.ck && ccLoad()[b3d.dataset.ck];
    if (c) paint(b3d, c);
  }

  /** Se llama cuando carga la imagen de la tapa (atributo onload). */
  function tint(img) {
    const b3d = img.closest('.b3d');
    const key = b3d?.dataset.ck;
    if (!key) return;
    const cache = ccLoad();
    if (cache[key]) return paintCached(b3d);
    const src = img.currentSrc || img.src;
    if (!src) return;
    const probe = new Image();
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      try {
        const c = dominant(probe);
        cache[key] = c;
        ccSave();
        document.querySelectorAll('.b3d[data-ck]').forEach((el) => {
          if (el.dataset.ck === key) paint(el, c);
        });
      } catch {
        /* imagen no legible: se queda el tono por defecto */
      }
    };
    probe.src = src;
  }

  /** Grosor del lomo según el número de páginas. */
  function depthFor(pages, size) {
    const p = pages || 250;
    return size === 'sm' ? u.clamp(Math.round(p / 22), 8, 26) : u.clamp(Math.round(p / 12), 16, 52);
  }

  /**
   * HTML de un libro 3D.
   * @param {object} book   libro de la base de datos (o resultado de búsqueda)
   * @param {string} src    URL de portada ('' para generar una)
   * @param {'sm'|'lg'} size
   */
  function markup(book, src = '', size = 'lg') {
    const hue = u.hash(book.title + book.author) % 360;
    const d = depthFor(book.totalPages, size);
    const title = u.esc(book.title);
    const author = u.esc(book.author);
    const generated = `<div class="b3d-cover-gen"><span class="t">${title}</span><span class="a">${author}</span></div>`;
    // Si la imagen falla al cargar, se sustituye por la portada generada
    const front = src
      ? `<img src="${u.esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="LK.book3d.tint(this)" onerror="this.outerHTML=this.dataset.fallback" data-fallback="${u.esc(generated)}">`
      : generated;

    // Si ya conocemos el color de esta portada, el libro sale pintado desde el primer fotograma
    const key = src ? colorKey(book) : '';
    const known = key && ccLoad()[key];
    const tintStyle = known ? `;--ch:${known.h};--cs:${known.s}%;--cl:${known.l}%` : '';

    return `
      <div class="b3d" style="--d:${d}px;--hue:${hue}${tintStyle}" ${key ? `data-ck="${u.esc(key)}"` : ''} ${known ? 'data-tint="1"' : ''} aria-hidden="true">
        <div class="b3d-face b3d-front">${front}</div>
        <div class="b3d-face b3d-back"></div>
        <div class="b3d-face b3d-spine"><span>${title}</span></div>
        <div class="b3d-face b3d-pages"></div>
        <div class="b3d-face b3d-top"></div>
        <div class="b3d-face b3d-bottom"></div>
      </div>`;
  }

  /** Escena interactiva (contenedor + libro). */
  function scene(book, src, { label = 'Libro en 3D. Arrastra o usa las flechas para girarlo.' } = {}) {
    return `<div class="b3d-scene" tabindex="0" role="img" aria-label="${u.esc(label)}">${markup(book, src, 'lg')}</div>`;
  }

  /**
   * Activa el giro automático y el arrastre en una .b3d-scene.
   * Se detiene sola cuando la escena desaparece del DOM.
   */
  function spin(sceneEl, { speed = 14, tilt = -8, start = -28 } = {}) {
    const book = sceneEl?.querySelector('.b3d');
    if (!book) return;
    paintCached(book); // también pinta la escena y la tarjeta que lo rodean

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let angle = start;
    let velocity = 0;      // grados/segundo tras soltar
    let dragging = false;
    let lastX = 0;
    let lastT = 0;
    let prev = performance.now();
    let resumeAt = 0;      // momento a partir del cual vuelve el giro automático

    sceneEl.style.setProperty('--shadow-w', `${book.offsetWidth}px`);

    function frame(now) {
      if (!sceneEl.isConnected) return; // la vista cambió: se para el bucle
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;

      if (!dragging) {
        if (Math.abs(velocity) > 4) {
          angle += velocity * dt;
          velocity *= Math.pow(0.05, dt); // fricción
        } else {
          velocity = 0;
          if (!reduceMotion && document.documentElement.dataset.motion !== 'off' && now > resumeAt) angle += speed * dt;
        }
      }
      book.style.transform = `rotateX(${tilt}deg) rotateY(${angle}deg)`;
      requestAnimationFrame(frame);
    }

    sceneEl.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true;
      velocity = 0;
      lastX = e.clientX;
      lastT = e.timeStamp;
      sceneEl.setPointerCapture?.(e.pointerId);
      sceneEl.classList.add('grabbing');
    });

    sceneEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dtMs = Math.max(8, e.timeStamp - lastT);
      angle += dx * 0.6;
      velocity = u.clamp(((dx * 0.6) / dtMs) * 1000, -900, 900);
      lastX = e.clientX;
      lastT = e.timeStamp;
    });

    const release = (e) => {
      if (!dragging) return;
      dragging = false;
      // Si el dedo se quedó quieto antes de soltar, no hay inercia
      if (e && e.timeStamp - lastT > 80) velocity = 0;
      resumeAt = performance.now() + 2500;
      sceneEl.classList.remove('grabbing');
    };
    sceneEl.addEventListener('pointerup', release);
    sceneEl.addEventListener('pointercancel', release);
    sceneEl.addEventListener('lostpointercapture', release);

    // Teclado: flechas para girar
    sceneEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        angle += e.key === 'ArrowLeft' ? -20 : 20;
        resumeAt = performance.now() + 3000;
      }
    });

    requestAnimationFrame(frame);
  }

  LK.book3d = { markup, scene, spin, depthFor, tint, paintCached };
})(window.LK);
