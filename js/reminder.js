/* ==========================================================
   RECORDATORIO DIARIO  (LK.reminder)

   Una PWA no puede programar una notificación para cuando la app
   está cerrada (eso exige un servidor de notificaciones push o una
   app de tienda). Lo que sí funciona en TODOS los móviles:
     1) Un evento diario en el calendario del teléfono (.ics) con
        alarma. Es fiable porque lo gestiona el sistema.
     2) Un aviso dentro de la app al abrirla a la hora elegida o si
        la racha está en peligro.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  const pad = (n) => String(n).padStart(2, '0');

  function ics(time) {
    const [h, m] = time.split(':').map(Number);
    const now = new Date();
    const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}00Z`;
    const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//LoreKeeper//Recordatorio//ES',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:lorekeeper-lectura-diaria@lorekeeper',
      `DTSTAMP:${stamp}`,
      `DTSTART:${day}T${pad(h)}${pad(m)}00`,
      'DURATION:PT20M',
      'RRULE:FREQ=DAILY',
      'SUMMARY:📖 Hora de leer',
      'DESCRIPTION:Tu rato de lectura de hoy. Abre LoreKeeper y pulsa «Seguir leyendo».',
      'TRANSP:TRANSPARENT',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Hora de leer',
      'TRIGGER:PT0S',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
  }

  /** Guarda la hora y devuelve el archivo de calendario. null = desactivar. */
  function set(time) {
    LK.prefs.set({ remindAt: time || null });
  }

  async function download(time = LK.prefs.get('remindAt')) {
    if (!time) return;
    const file = new File([ics(time)], 'lorekeeper-recordatorio.ics', { type: 'text/calendar' });
    // En móvil, abrir el .ics directamente propone añadirlo al calendario
    u.download(file.name, file, 'text/calendar');
  }

  /** Mensaje para mostrar al abrir la app, o null. */
  function nudge(sessions) {
    const today = u.isoDate();
    const doneToday = sessions.some((s) => s.date === today && ((s.pagesRead || 0) > 0 || (s.durationMinutes || 0) > 0));
    if (doneToday) return null;
    const now = new Date();
    const at = LK.prefs.get('remindAt');
    if (at) {
      const [h, m] = at.split(':').map(Number);
      if (now.getHours() * 60 + now.getMinutes() >= h * 60 + m) return { icon: '📖', text: 'Es la hora de tu lectura de hoy.' };
    }
    const st = LK.ach.streak(sessions);
    if (st >= 2 && now.getHours() >= 19) return { icon: '🔥', text: `Tu racha de ${st} días está en juego: unos minutos hoy y la mantienes.` };
    return null;
  }

  LK.reminder = { ics, set, download, nudge };
})(window.LK);
