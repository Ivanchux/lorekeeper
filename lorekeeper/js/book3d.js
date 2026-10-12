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
      ? `<img src="${u.esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML=this.dataset.fallback" data-fallback="${u.esc(generated)}">`
      : generated;

    return `
      <div class="b3d" style="--d:${d}px;--hue:${hue}" aria-hidden="true">
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
          if (!reduceMotion && now > resumeAt) angle += speed * dt;
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

  LK.book3d = { markup, scene, spin, depthFor };
})(window.LK);
