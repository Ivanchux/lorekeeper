/* ==========================================================
   APP  (LK.app)
   Arranque, enrutado por hash y cabecera del jugador.
   Rutas:
     #/biblioteca[/estado|sagas|prestados|etiqueta/<tag>]
     #/buscar[/consulta]   #/escanear   #/importar
     #/libro/<id>   #/estadisticas   #/logros   #/resumen/<año>
     #/ajustes   #/empezar   #/enlazar/<url>/<código>
   Cada vista devuelve { html, mount(root) }.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  const $view = document.getElementById('view');
  let renderToken = 0;
  let lastRoute = '';

  // En qué pestaña de la barra inferior se ilumina cada pantalla
  const TAB_OF = { libro: 'biblioteca', importar: 'buscar', escanear: 'buscar', logros: 'estadisticas', resumen: 'estadisticas', empezar: 'biblioteca', enlazar: 'ajustes' };

  /** Progreso calculado del lector (nivel, EXP, atributos). */
  async function progress() {
    const [books, sessions] = await Promise.all([LK.db.getBooks(), LK.db.getSessions()]);
    return LK.rpg.compute(books, sessions);
  }

  /** Nivel y barra de EXP de la cabecera. */
  let playerShown = false;

  async function refreshPlayer() {
    const p = await progress();
    const pct = Math.round(p.progress * 100);
    const levelEl = document.getElementById('ui-level');
    const levelUp = playerShown && Number(levelEl.textContent) < p.level;
    levelEl.textContent = p.level;
    if (levelUp) LK.fx.bump(levelEl);
    playerShown = true;
    document.getElementById('ui-xpfill').style.width = `${pct}%`;
    const bar = document.getElementById('ui-xpbar');
    bar.setAttribute('aria-valuenow', pct);
    bar.setAttribute('aria-label', `${p.current} de ${p.needed} EXP para el nivel ${p.level + 1}`);
  }

  function parseRoute() {
    const [name = '', ...params] = location.hash.replace(/^#\/?/, '').split('/');
    return { name: LK.views[name] ? name : 'biblioteca', params: params.map((p) => decodeURIComponent(p)) };
  }

  let enterTimer = null;

  async function render() {
    const token = ++renderToken;
    const { name, params } = parseRoute();
    const routeKey = `${name}/${params[0] || ''}`;
    const isNewRoute = routeKey !== lastRoute; // al repintar la misma pantalla no se repiten las entradas

    const tab = TAB_OF[name] || name;
    document.querySelectorAll('.tabbar a').forEach((a) => {
      if (a.dataset.route === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    try {
      const { html, mount } = await LK.views[name](...params);
      if (token !== renderToken) return; // llegó otra navegación mientras cargaba
      $view.classList.toggle('entering', isNewRoute);
      $view.innerHTML = html;
      LK.fx.enter($view, isNewRoute);
      clearTimeout(enterTimer);
      if (isNewRoute) enterTimer = setTimeout(() => $view.classList.remove('entering'), 1800);
      await mount?.($view);
    } catch (err) {
      console.error(err);
      if (token !== renderToken) return;
      $view.innerHTML = `<div class="error-box"><strong>Algo ha fallado al cargar esta pantalla.</strong><br><span class="small">${u.esc(err.message)}</span></div>`;
    }

    // Al cambiar de pantalla, vuelve arriba; al refrescar la misma, conserva el scroll
    if (isNewRoute) {
      window.scrollTo(0, 0);
      $view.focus({ preventScroll: true });
    }
    lastRoute = routeKey;
  }

  /** Vuelve a pintar la vista actual y la cabecera (tras guardar algo). */
  function refresh() {
    render();
    refreshPlayer();
    updateBadge();
  }

  /** Puntito en el icono de la app instalada si hoy toca leer. */
  async function updateBadge() {
    if (!('setAppBadge' in navigator)) return;
    try {
      const nudge = LK.reminder.nudge(await LK.db.getSessions());
      if (nudge) await navigator.setAppBadge(1);
      else await navigator.clearAppBadge();
    } catch {}
  }

  LK.app = { progress, refreshPlayer, refresh, render };

  /* ---------------- Mensajes del Service Worker (botones del aviso) ---------------- */

  function listenSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'lk-notif') LK.timer.handleAction(e.data.action);
    });
  }

  /** Si la app se abrió desde un botón del aviso (app estaba cerrada): ?notif=pause|finish|open */
  function handleLaunchAction() {
    const params = new URLSearchParams(location.search);
    const action = params.get('notif');
    if (!action) return;
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => LK.timer.handleAction(action), 200);
  }

  /* ---------------- Arranque ---------------- */

  async function boot() {
    LK.prefs.apply();
    LK.theme.init();
    await LK.db.init();
    LK.sync.init();

    // Logros nuevos tras cualquier cambio (con calma, para no frenar el guardado)
    const checkAch = u.debounce(() => LK.ach.check().catch(() => {}), 800);
    LK.db.onChange(checkAch);

    // Si cambia una preferencia visual (modo fácil, RPG), repinta
    LK.prefs.onChange((_, patch) => {
      if ('rpg' in patch || 'easy' in patch) refreshPlayer();
    });

    window.addEventListener('hashchange', render);
    await render();
    refreshPlayer();
    LK.timer.restore();
    listenSW();
    handleLaunchAction();
    updateBadge();
    LK.ach.check().catch(() => {});

    if (!LK.prefs.get('onboarded') && (await LK.db.isEmpty())) LK.onboarding.show();
    else if (!LK.prefs.get('onboarded')) LK.prefs.set({ onboarded: true });

    window.addEventListener('appinstalled', () => {
      LK.installPrompt = null;
      u.toast('LoreKeeper instalada 🎉');
    });

    // Service Worker: solo funciona servido por http(s), no abriendo el archivo con doble clic
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service Worker no registrado:', err));
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) u.toast('LoreKeeper se ha actualizado. Ciérrala y ábrela para ver lo nuevo.');
      });
    }
  }

  // `beforeinstallprompt` puede dispararse antes de que termine boot(): se captura ya
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    LK.installPrompt = e;
  });

  boot().catch((err) => {
    console.error(err);
    $view.innerHTML = `<div class="error-box">No se pudo iniciar LoreKeeper: ${u.esc(err.message)}</div>`;
  });
})(window.LK);
