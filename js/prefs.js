/* ==========================================================
   PREFERENCIAS DE ESTE DISPOSITIVO  (LK.prefs)
   Tamaño de letra, modo fácil, niveles y atributos on/off,
   recordatorio, aviso del temporizador… Se guardan en
   localStorage porque cada móvil puede querer lo suyo.
   (Las metas y el perfil sí viajan en la copia de seguridad.)
   ========================================================== */

(function (LK) {
  'use strict';

  const KEY = 'lk-prefs';

  const DEFAULTS = {
    font: 1,            // 1 | 1.15 | 1.3
    rpg: true,          // niveles, atributos y logros
    easy: false,        // modo fácil: botones y campos más grandes
    onboarded: false,   // ya vio la pantalla de bienvenida
    remindAt: null,     // 'HH:MM' del recordatorio diario
    notifyTimer: false, // aviso persistente mientras lee
    metric: 'auto',     // gráficas: 'auto' (minutos si se escucha más que se lee) | 'pages' | 'minutes'
    motion: true,       // animaciones y efectos
    unit: 'pages',      // unidad al registrar sesión: 'pages' | 'percent'
  };

  let cache = null;
  const listeners = new Set();

  function load() {
    if (cache) return cache;
    try {
      cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
    } catch {
      cache = { ...DEFAULTS };
    }
    return cache;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch {
      /* modo privado: dura solo esta sesión */
    }
  }

  /** Aplica las preferencias visuales al <html>. */
  function apply() {
    const p = load();
    const root = document.documentElement;
    root.style.setProperty('--font-scale', String(p.font));
    root.dataset.rpg = p.rpg ? 'on' : 'off';
    root.dataset.easy = p.easy ? 'on' : 'off';
    root.dataset.motion = p.motion ? 'on' : 'off';
  }

  const get = (key) => load()[key];

  function set(patch) {
    Object.assign(load(), patch);
    save();
    apply();
    listeners.forEach((fn) => fn(load(), patch));
  }

  /** 'easy' = letra grande, sin niveles, tema claro. 'full' = todo activado. */
  function preset(name) {
    if (name === 'easy') {
      set({ font: 1.25, rpg: false, easy: true });
      LK.theme?.set('biblioteca');
    } else {
      set({ font: 1, rpg: true, easy: false });
    }
  }

  LK.prefs = {
    DEFAULTS,
    get,
    set,
    apply,
    preset,
    all: () => ({ ...load() }),
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})(window.LK);
