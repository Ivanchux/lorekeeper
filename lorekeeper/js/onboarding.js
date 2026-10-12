/* ==========================================================
   BIENVENIDA  (LK.onboarding)
   La primera vez, pregunta cómo se quiere usar la app. Es lo
   que hace que alguien que no busca «un juego» no se encuentre
   con niveles y atributos.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;

  function show() {
    const d = u.modal(`
      <h2>Bienvenido a LoreKeeper</h2>
      <p class="muted">Tu biblioteca y tus lecturas, en un solo sitio, gratis y sin anuncios. ¿Cómo prefieres verla?</p>
      <div class="onb-options">
        <button class="onb-opt" data-mode="easy">
          <span class="onb-icon" aria-hidden="true">📖</span>
          <strong>Sencilla</strong>
          <span>Letra grande, botones grandes y solo tus libros. Sin niveles ni juegos.</span>
        </button>
        <button class="onb-opt" data-mode="full">
          <span class="onb-icon" aria-hidden="true">🛡️</span>
          <strong>Con aventura</strong>
          <span>Cada página te da experiencia: subes de nivel, entrenas atributos y ganas logros.</span>
        </button>
      </div>
      <p class="muted small">Lo puedes cambiar cuando quieras en Ajustes.</p>
      <div class="modal-actions"><a class="btn btn-ghost" href="#/importar" data-close data-skip="import">Ya tengo libros en Bookmory o Goodreads</a></div>`);

    let chosen = false;
    d.querySelectorAll('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => {
        chosen = true;
        LK.prefs.preset(b.dataset.mode);
        LK.prefs.set({ onboarded: true });
        d.close();
        LK.app.refresh();
      })
    );
    d.addEventListener('close', () => {
      if (!chosen) LK.prefs.set({ onboarded: true });
    });
  }

  LK.onboarding = { show };
})(window.LK);
