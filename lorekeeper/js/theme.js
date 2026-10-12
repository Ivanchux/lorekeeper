/* ==========================================================
   TEMAS  (LK.theme)
   Registro de estéticas y cambio en caliente.
   El CSS de cada tema vive en css/themes.css.
   ========================================================== */

(function (LK) {
  'use strict';

  const KEY = 'lk-theme';

  /** Para añadir un tema: bloque en themes.css + entrada aquí. */
  const THEMES = [
    {
      id: 'terminal',
      name: 'Terminal',
      description: 'Oscuro, monoespaciado, acentos neón y líneas CRT.',
      swatch: ['#0b0b10', '#14141c', '#00e1ec', '#ff3dd8'],
      themeColor: '#14141c',
    },
    {
      id: 'grimorio',
      name: 'Grimorio',
      description: 'Fantasía oscura: madera quemada y oro viejo.',
      swatch: ['#120d0b', '#271d18', '#d9a441', '#b23a3a'],
      themeColor: '#1c1512',
    },
    {
      id: 'biblioteca',
      name: 'Biblioteca',
      description: 'Papel, madera y tipografía serif.',
      swatch: ['#f2eadc', '#fbf7ef', '#7d2b22', '#a87326'],
      themeColor: '#fbf7ef',
    },
    {
      id: 'minimal',
      name: 'Minimal',
      description: 'Claro y neutro, sin adornos.',
      swatch: ['#f6f6f4', '#ffffff', '#2f5bd3', '#0f9d8a'],
      themeColor: '#ffffff',
    },
  ];

  function get() {
    try {
      const saved = localStorage.getItem(KEY);
      if (THEMES.some((t) => t.id === saved)) return saved;
    } catch {}
    return THEMES[0].id;
  }

  function set(id) {
    const theme = THEMES.find((t) => t.id === id) || THEMES[0];
    document.documentElement.dataset.theme = theme.id;
    // Colorea la barra del navegador / sistema en móvil
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.themeColor);
    try {
      localStorage.setItem(KEY, theme.id);
    } catch {
      /* modo privado: el tema dura solo esta sesión */
    }
  }

  LK.theme = { THEMES, get, set, init: () => set(get()) };
})(window.LK);
