/* ==========================================================
   EFECTOS  (LK.fx)
   Pequeños detalles de movimiento que no caben en CSS:
   - enter(): al cambiar de pantalla, numera los elementos para
     entrar escalonados, pinta los libros con su color y hace que
     los números suban desde cero.
   - confetti(): lluvia de papelitos al subir de nivel, terminar un
     libro o conseguir un logro.
   - bump(): hace «saltar» un elemento (por ejemplo, el nivel).
   Todo se apaga con «Reducir movimiento» del sistema o con el
   interruptor de Ajustes.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /** ¿Hay que animar? */
  const enabled = () => !reduced.matches && document.documentElement.dataset.motion !== 'off';

  /* ---------- Entrada de una pantalla ---------- */

  // Contenedores cuyos hijos entran uno tras otro
  const STAGGER = '.shelf, .tiles, .ach-grid, .results, .banners, .attr-list, .list, .theme-grid';

  function enter(root, animate) {
    // Los libros con color ya conocido se pintan antes del primer fotograma
    root.querySelectorAll('.b3d[data-ck]').forEach((b) => LK.book3d.paintCached(b));
    if (!animate || !enabled()) return;

    root.querySelectorAll(STAGGER).forEach((group) => {
      [...group.children].forEach((el, i) => el.style.setProperty('--i', Math.min(i, 14)));
    });
    root.querySelectorAll('.chart').forEach((chart) => {
      chart.querySelectorAll('.bar').forEach((bar, i) => bar.style.setProperty('--i', Math.min(i, 24)));
    });
    root.querySelectorAll('.tile-value, .ring-label').forEach(countUp);
  }

  /* ---------- Números que suben ---------- */

  const NUM = /^(\d{1,3}(?:\.\d{3})+|\d+)(\D*)$/;

  function countUp(el, ms = 800) {
    if (el.dataset.counted) return;
    const text = el.textContent.trim();
    const m = NUM.exec(text);
    if (!m) return;
    const target = parseInt(m[1].replace(/\./g, ''), 10);
    if (!target || target > 1e7) return;
    const suffix = m[2];
    // Solo si sabemos reproducir el formato original (separador de miles incluido)
    if (target.toLocaleString('es-ES') + suffix !== text && String(target) + suffix !== text) return;
    const withDots = m[1].includes('.');
    el.dataset.counted = '1';

    const t0 = performance.now() + 200; // espera a que la tarjeta haya entrado
    const fmt = (n) => (withDots ? n.toLocaleString('es-ES') : String(n)) + suffix;
    el.textContent = fmt(0);
    function frame(now) {
      if (!el.isConnected) return;
      const p = u.clamp((now - t0) / ms, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = text; // deja exactamente el texto original
    }
    requestAnimationFrame(frame);
  }

  /* ---------- «Salto» de un elemento ---------- */

  function bump(el) {
    if (!el || !enabled()) return;
    el.classList.remove('bump');
    void el.offsetWidth; // reinicia la animación
    el.classList.add('bump');
    el.addEventListener('animationend', () => el.classList.remove('bump'), { once: true });
  }

  /* ---------- Confeti ---------- */

  function palette() {
    const cs = getComputedStyle(document.documentElement);
    const pick = (v, fallback) => cs.getPropertyValue(v).trim() || fallback;
    return [pick('--accent', '#00e1ec'), pick('--accent-2', '#ff3dd8'), pick('--star', '#ffd35c'), pick('--success', '#4ce0a0'), '#ffffff'];
  }

  let confettiOn = false;

  function confetti({ count = 110, x = 0.5, y = 0.78 } = {}) {
    if (!enabled() || confettiOn) return;
    confettiOn = true;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.className = 'fx-confetti';
    cv.setAttribute('aria-hidden', 'true');
    cv.width = Math.round(innerWidth * dpr);
    cv.height = Math.round(innerHeight * dpr);
    document.body.appendChild(cv);
    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);

    const colors = palette();
    const ox = innerWidth * x;
    const oy = innerHeight * y;
    const parts = Array.from({ length: count }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5; // abanico hacia arriba
      const speed = 380 + Math.random() * 520;
      return {
        x: ox + (Math.random() - 0.5) * 40,
        y: oy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 5,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 14,
        color: colors[Math.floor(Math.random() * colors.length)],
        sway: Math.random() * Math.PI * 2,
      };
    });

    const GRAVITY = 1100;
    const LIFE = 2200;
    const start = performance.now();
    let prev = start;

    function frame(now) {
      const dt = Math.min(0.04, (now - prev) / 1000);
      prev = now;
      const age = now - start;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      const fade = age > LIFE - 500 ? Math.max(0, (LIFE - age) / 500) : 1;
      for (const p of parts) {
        p.vy += GRAVITY * dt;
        p.vx *= Math.pow(0.35, dt); // el aire los frena
        p.x += (p.vx + Math.sin(p.sway + age / 220) * 30) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (age < LIFE) requestAnimationFrame(frame);
      else {
        cv.remove();
        confettiOn = false;
      }
    }
    requestAnimationFrame(frame);
  }

  LK.fx = { enabled, enter, countUp, bump, confetti };
})(window.LK);
