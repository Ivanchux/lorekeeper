/* ==========================================================
   VISTA: AJUSTES   #/ajustes
   Perfil y metas, aspecto (modo fácil, tamaño de letra, tema),
   lectura (avisos y recordatorio), copia de seguridad y
   sincronización, instalación y acerca de.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  LK.views = LK.views || {};

  const FONT_SIZES = [
    [1, 'Normal'],
    [1.15, 'Grande'],
    [1.3, 'Muy grande'],
  ];

  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = () => /android/i.test(navigator.userAgent);

  const markBackup = () => {
    try {
      localStorage.setItem('lk-lastbackup', String(Date.now()));
    } catch {}
  };

  function syncCard() {
    const s = LK.sync.info();
    if (!s.on) {
      return `
        <section class="card stack-sm" id="sync-card">
          <h2>Sincronizar entre dispositivos <span class="chip">opcional</span></h2>
          <p class="muted small">Con un servidor propio (ver <code>backend/README.md</code>) tus libros se mantienen iguales en el móvil y en el ordenador. Los datos se cifran en tu dispositivo: el servidor solo guarda texto ilegible.</p>
          <details class="disclosure">
            <summary>Ya tengo un código: conectar este dispositivo</summary>
            <form id="sync-connect" class="form-grid">
              <label class="field span-all"><span>Dirección del servidor</span><input class="input" name="url" placeholder="https://mi-servidor.ejemplo" value="${location.protocol.startsWith('http') && !/github\.io|localhost|127\./.test(location.hostname) ? u.esc(location.origin) : ''}" inputmode="url" autocapitalize="off"></label>
              <label class="field span-all"><span>Código</span><input class="input" name="code" placeholder="ABCD-EFGH-IJKL-MNOP-QRST" autocapitalize="characters" autocomplete="off"></label>
              <div class="span-all"><button class="btn btn-primary" type="submit">Conectar</button></div>
            </form>
          </details>
          <details class="disclosure">
            <summary>Crear una cuenta nueva en mi servidor</summary>
            <form id="sync-create" class="form-grid">
              <label class="field span-all"><span>Dirección del servidor</span><input class="input" name="url" placeholder="https://mi-servidor.ejemplo" inputmode="url" autocapitalize="off"></label>
              <label class="field span-all"><span>Contraseña de creación (si tu servidor la pide)</span><input class="input" name="pw" type="password" autocomplete="off"></label>
              <div class="span-all"><button class="btn btn-primary" type="submit">Crear y subir mis datos</button></div>
            </form>
          </details>
          <p class="small" id="sync-msg" style="color:var(--danger)" hidden></p>
        </section>`;
    }
    const states = { idle: '✓ Al día', syncing: 'Sincronizando…', error: '⚠ Error', offline: 'Sin conexión' };
    return `
      <section class="card stack-sm" id="sync-card">
        <h2>Sincronización activa</h2>
        <p><span id="sync-state">${states[s.state] || ''}</span> <span class="muted small" id="sync-last">${s.lastSync ? '· última vez ' + u.ago(s.lastSync) : ''}</span></p>
        <p class="muted small">Servidor: ${u.esc(s.url)}</p>
        <p class="small" id="sync-msg" style="color:var(--danger)" ${s.error ? '' : 'hidden'}>${u.esc(s.error || '')}</p>
        <div class="row">
          <button class="btn" id="sync-now">Sincronizar ahora</button>
          <button class="btn" id="sync-share">Conectar otro dispositivo</button>
          <button class="btn btn-ghost" id="sync-off">Desconectar</button>
        </div>
      </section>`;
  }

  LK.views.ajustes = async () => {
    const profile = await LK.db.getProfile();
    const current = LK.theme.get();
    const prefs = LK.prefs.all();
    const canNotify = LK.timer.canNotify();
    const notifOn = canNotify && prefs.notifyTimer && Notification.permission === 'granted';

    let storageInfo = '';
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage) storageInfo = ` · ${(est.usage / 1024 / 1024).toFixed(1)} MB usados`;
    } catch {}

    const themeOptions = LK.theme.THEMES.map(
      (t) => `
        <label class="theme-option">
          <input type="radio" name="theme" value="${t.id}" ${t.id === current ? 'checked' : ''}>
          <span class="theme-swatch">${t.swatch.map((c) => `<span style="background:${c}"></span>`).join('')}</span>
          <strong>${u.esc(t.name)}</strong>
          <span class="muted">${u.esc(t.description)}</span>
        </label>`
    ).join('');

    const lastBackup = (() => {
      try {
        return Number(localStorage.getItem('lk-lastbackup')) || 0;
      } catch {
        return 0;
      }
    })();

    const installHelp = isStandalone()
      ? '<p class="small">✓ Ya estás usando la app instalada.</p>'
      : LK.installPrompt
        ? '<button class="btn btn-primary" id="btn-install">📲 Instalar en este dispositivo</button>'
        : isIOS()
          ? '<ol class="small"><li>Abre esta página en <strong>Safari</strong>.</li><li>Toca el botón <strong>Compartir</strong> (el cuadrado con la flecha).</li><li>Elige <strong>«Añadir a pantalla de inicio»</strong>.</li></ol><p class="muted small">En iPhone la app instalada es la única que puede enviarte avisos, y conviene hacer copias de vez en cuando.</p>'
          : isAndroid()
            ? '<ol class="small"><li>Abre el menú ⋮ de Chrome.</li><li>Elige <strong>«Instalar aplicación»</strong> o «Añadir a pantalla de inicio».</li></ol>'
            : '<p class="small">En Chrome o Edge verás un icono de instalar a la derecha de la barra de direcciones.</p>';

    const offline = location.protocol.startsWith('http')
      ? 'La app funciona sin conexión una vez cargada.'
      : 'Estás abriendo el archivo directamente: todo funciona salvo instalar la app, el modo sin conexión, los avisos, la sincronización y el reconocimiento de texto de fotos (necesitan servirla por http, mira el README).';

    return {
      html: `
        <div class="page-head"><h1>Ajustes</h1></div>
        <div class="stack">

          <section class="card stack-sm easy-card">
            <div class="row-between">
              <div>
                <h2 style="margin:0">Modo fácil</h2>
                <p class="muted small" style="margin:.2rem 0 0">Letra grande, botones grandes y sin niveles ni atributos. Solo tus libros y tu lectura.</p>
              </div>
              <label class="switch"><input type="checkbox" id="easy" ${prefs.easy ? 'checked' : ''} aria-label="Modo fácil"><span></span></label>
            </div>
          </section>

          <section class="card">
            <h2>Perfil y metas</h2>
            <form id="profile-form" class="form-grid">
              <label class="field"><span>Nombre del lector</span><input class="input" name="name" value="${u.esc(profile.name)}" maxlength="40"></label>
              <label class="field"><span>Objetivo de libros este año</span><input class="input" name="goal" type="number" min="0" max="999" value="${profile.yearlyGoal}" inputmode="numeric"></label>
              <label class="field"><span>Meta diaria (0 = sin meta)</span>
                <input class="input" name="daily" type="number" min="0" max="999" value="${profile.dailyGoal?.value ?? 0}" inputmode="numeric"></label>
              <label class="field"><span>Medida de la meta diaria</span>
                <select class="select" name="dailyType">
                  <option value="minutes" ${profile.dailyGoal?.type !== 'pages' ? 'selected' : ''}>Minutos</option>
                  <option value="pages" ${profile.dailyGoal?.type === 'pages' ? 'selected' : ''}>Páginas</option>
                </select></label>
              <div class="span-all"><button class="btn btn-primary" type="submit">Guardar</button></div>
            </form>
          </section>

          <section class="card stack-sm">
            <h2>Aspecto</h2>
            <div class="field"><span class="muted small">Tamaño de letra</span>
              <div class="seg-mini" role="group" aria-label="Tamaño de letra" id="font-size">
                ${FONT_SIZES.map(([v, l]) => `<button type="button" data-font="${v}" aria-pressed="${prefs.font === v}">${l}</button>`).join('')}
              </div>
            </div>
            <div class="row-between">
              <div><strong>Niveles, atributos y logros de juego</strong><div class="muted small">Si lo desactivas, desaparece todo lo de «RPG» y queda un lector sencillo.</div></div>
              <label class="switch"><input type="checkbox" id="rpg" ${prefs.rpg ? 'checked' : ''} aria-label="Mostrar niveles y atributos"><span></span></label>
            </div>
            <div class="row-between">
              <div><strong>Animaciones</strong><div class="muted small">Movimiento y efectos: el libro que flota, las barras que se llenan, el confeti. Desactívalas si el móvil va justo o prefieres una app más quieta. Si tu móvil tiene «Reducir movimiento», se respeta siempre.</div></div>
              <label class="switch"><input type="checkbox" id="motion" ${prefs.motion ? 'checked' : ''} aria-label="Animaciones"><span></span></label>
            </div>
            <fieldset class="theme-grid">
              <legend class="sr-only">Elige el aspecto de la app</legend>
              ${themeOptions}
            </fieldset>
          </section>

          <section class="card stack-sm">
            <h2>Lectura</h2>
            <div class="row-between">
              <div><strong>Aviso mientras leo</strong>
                <div class="muted small">${canNotify ? 'Muestra en la barra de notificaciones que hay una sesión en marcha, con botones para pausar o terminar.' : 'Necesita la app servida por http(s) o instalada.'}</div></div>
              <label class="switch"><input type="checkbox" id="notif" ${notifOn ? 'checked' : ''} ${canNotify ? '' : 'disabled'} aria-label="Aviso mientras leo"><span></span></label>
            </div>
            <div>
              <strong>Recordatorio diario</strong>
              <div class="muted small" style="margin-bottom:.5rem">Se añade al calendario de tu móvil como evento diario con alarma (así suena aunque la app esté cerrada).</div>
              <div class="row">
                <input class="input" type="time" id="remind-time" value="${prefs.remindAt || '20:00'}" style="width:auto" aria-label="Hora del recordatorio">
                <button class="btn" id="remind-set">${prefs.remindAt ? 'Cambiar y añadir al calendario' : 'Añadir al calendario'}</button>
                ${prefs.remindAt ? '<button class="btn btn-ghost" id="remind-off">Quitar aviso en la app</button>' : ''}
              </div>
              ${prefs.remindAt ? `<p class="muted small" style="margin-top:.4rem">En la app te lo recordaré a las ${prefs.remindAt}. Si ya habías añadido el evento antes, bórralo del calendario al cambiarlo.</p>` : ''}
            </div>
          </section>

          ${syncCard()}

          <section class="card stack-sm">
            <h2>Tus datos</h2>
            <p class="muted small">Todo se guarda en este dispositivo (${u.esc(LK.db.adapterName())}${storageInfo}). Si borras los datos del navegador o desinstalas la app, se pierde. ${lastBackup ? `Última copia: ${u.ago(lastBackup)}.` : 'Aún no has hecho ninguna copia.'}</p>
            <div class="row">
              <button class="btn btn-primary" id="btn-share">📤 Enviar copia (Drive, WhatsApp, correo…)</button>
              <button class="btn" id="btn-export">Descargar copia (JSON)</button>
              <label class="btn" tabindex="0">Restaurar copia
                <input type="file" id="input-import" accept="application/json,.json" hidden>
              </label>
            </div>
            <div class="row">
              <a class="btn" href="#/importar">📥 Importar de Bookmory / Goodreads</a>
              <button class="btn btn-danger" id="btn-wipe">Borrar todo</button>
            </div>
          </section>

          <section class="card stack-sm">
            <h2>Instalar como app</h2>
            ${installHelp}
          </section>

          <section class="card stack-sm">
            <h2>Acerca de</h2>
            <p class="small">LoreKeeper · tracker de lectura gratuito, sin anuncios ni suscripciones, y que funciona sin conexión. Proyecto educativo de código abierto.</p>
            <p class="muted small">${offline}</p>
            <p class="muted small">Datos de libros: Google Books y Open Library. Lectura de códigos de barras: ZXing. Reconocimiento de texto: Tesseract.js (licencias en <code>js/vendor/</code>).</p>
          </section>
        </div>`,

      mount(root) {
        /* ----- Aspecto ----- */
        root.querySelectorAll('input[name="theme"]').forEach((input) => input.addEventListener('change', () => LK.theme.set(input.value)));

        root.querySelector('#easy').addEventListener('change', (e) => {
          LK.prefs.preset(e.target.checked ? 'easy' : 'full');
          LK.app.render();
          u.toast(e.target.checked ? 'Modo fácil activado' : 'Modo fácil desactivado');
        });
        root.querySelector('#motion').addEventListener('change', (e) => {
          LK.prefs.set({ motion: e.target.checked });
          if (e.target.checked) LK.fx.confetti({ count: 50, y: 0.6 });
        });
        root.querySelector('#rpg').addEventListener('change', (e) => {
          LK.prefs.set({ rpg: e.target.checked });
          LK.app.refresh();
        });
        root.querySelectorAll('[data-font]').forEach((b) =>
          b.addEventListener('click', () => {
            LK.prefs.set({ font: Number(b.dataset.font) });
            root.querySelectorAll('[data-font]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          })
        );

        /* ----- Perfil ----- */
        root.querySelector('#profile-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target.elements;
          await LK.db.saveProfile({
            name: f.name.value.trim() || 'Lector',
            yearlyGoal: Math.max(0, parseInt(f.goal.value, 10) || 0),
            dailyGoal: { type: f.dailyType.value, value: Math.max(0, parseInt(f.daily.value, 10) || 0) },
          });
          u.toast('Guardado');
          LK.app.refreshPlayer();
        });

        /* ----- Avisos y recordatorio ----- */
        root.querySelector('#notif').addEventListener('change', async (e) => {
          if (e.target.checked) {
            if (!(await LK.timer.enableNotifications())) e.target.checked = false;
            else u.toast('Avisos activados');
          } else {
            LK.prefs.set({ notifyTimer: false });
          }
        });
        root.querySelector('#remind-set').addEventListener('click', async () => {
          const t = root.querySelector('#remind-time').value;
          if (!t) return;
          LK.reminder.set(t);
          await LK.reminder.download(t);
          u.toast('Abre el archivo descargado para añadirlo al calendario');
          LK.app.render();
        });
        root.querySelector('#remind-off')?.addEventListener('click', () => {
          LK.reminder.set(null);
          LK.app.render();
        });

        /* ----- Instalar ----- */
        root.querySelector('#btn-install')?.addEventListener('click', async () => {
          LK.installPrompt.prompt();
          await LK.installPrompt.userChoice.catch(() => {});
          LK.installPrompt = null;
          LK.app.render();
        });

        /* ----- Sincronización ----- */
        const msg = root.querySelector('#sync-msg');
        const fail = (text) => {
          msg.textContent = text;
          msg.hidden = false;
        };
        const busy = (form, on) => form.querySelectorAll('button').forEach((b) => (b.disabled = on));

        root.querySelector('#sync-connect')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target;
          busy(f, true);
          try {
            await LK.sync.connect(f.elements.url.value, f.elements.code.value);
            u.toast('Conectado y sincronizado');
            LK.app.refresh();
          } catch (err) {
            fail(err.message);
            busy(f, false);
          }
        });
        root.querySelector('#sync-create')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target;
          busy(f, true);
          try {
            const code = await LK.sync.create(f.elements.url.value, f.elements.pw.value);
            await showCode(code);
            LK.app.refresh();
          } catch (err) {
            fail(err.message);
            busy(f, false);
          }
        });
        root.querySelector('#sync-now')?.addEventListener('click', () => LK.sync.syncNow());
        root.querySelector('#sync-share')?.addEventListener('click', () => showCode(LK.sync.displayCode()));
        root.querySelector('#sync-off')?.addEventListener('click', async () => {
          if (!(await u.confirm('¿Desconectar? Tus datos siguen en este dispositivo y en el servidor, pero dejarán de sincronizarse.', { ok: 'Desconectar' }))) return;
          LK.sync.disconnect();
          LK.app.render();
        });
        const off = LK.sync.onStatus((s) => {
          if (!root.isConnected) return off();
          const st = root.querySelector('#sync-state');
          if (!st) return;
          st.textContent = { idle: '✓ Al día', syncing: 'Sincronizando…', error: '⚠ Error', offline: 'Sin conexión' }[s.state] || '';
          root.querySelector('#sync-last').textContent = s.lastSync ? '· última vez ' + u.ago(s.lastSync) : '';
          msg.textContent = s.error || '';
          msg.hidden = !s.error;
        });

        async function showCode(code) {
          const link = LK.sync.linkFor();
          const d = u.modal(`
            <h2>Tu código de sincronización</h2>
            <p class="sync-code" aria-label="Código">${u.esc(code)}</p>
            <p class="muted small">Guárdalo en un sitio seguro: sin él no se pueden recuperar los datos del servidor (están cifrados). Para conectar otro dispositivo, abre este enlace en él o escribe el código en Ajustes.</p>
            <div class="row">
              <button class="btn" data-copy="${u.esc(code)}">Copiar código</button>
              <button class="btn" data-copy="${u.esc(link)}">Copiar enlace de conexión</button>
            </div>
            <div class="modal-actions"><button class="btn btn-primary" data-close>Hecho</button></div>`);
          d.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-copy]');
            if (!b) return;
            try {
              await navigator.clipboard.writeText(b.dataset.copy);
              u.toast('Copiado');
            } catch {
              u.toast('No se pudo copiar. Selecciónalo a mano.', 'error');
            }
          });
          await new Promise((r) => d.addEventListener('close', r));
        }

        /* ----- Copias ----- */
        root.querySelector('#btn-export').addEventListener('click', async () => {
          const data = await LK.db.exportAll();
          u.download(`lorekeeper-${u.isoDate()}.json`, JSON.stringify(data, null, 2));
          markBackup();
          u.toast('Copia descargada');
        });
        root.querySelector('#btn-share').addEventListener('click', async () => {
          const data = await LK.db.exportAll();
          const file = new File([JSON.stringify(data)], `lorekeeper-${u.isoDate()}.json`, { type: 'application/json' });
          const res = await u.shareFile(file, { title: 'Copia de LoreKeeper', text: 'Copia de seguridad de mi biblioteca' });
          if (res !== 'cancelled') {
            markBackup();
            u.toast(res === 'shared' ? 'Copia enviada' : 'Copia descargada');
          }
        });

        const input = root.querySelector('#input-import');
        input.closest('label').addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            input.click();
          }
        });
        input.addEventListener('change', async (e) => {
          const file = e.target.files[0];
          e.target.value = '';
          if (!file) return;
          try {
            const data = JSON.parse(await file.text());
            if (data?.app !== 'lorekeeper') throw new Error('El archivo no es una copia de LoreKeeper. Para Bookmory o Goodreads usa «Importar de Bookmory / Goodreads».');
            const sum = LK.db.summarize(data);
            const ok = await u.confirm(`¿Restaurar esta copia (${sum.books} libros, ${sum.sessions} sesiones${sum.exportedAt ? `, del ${u.fmtDate(sum.exportedAt.slice(0, 10))}` : ''})? Sustituirá todo lo que tienes ahora.`, { ok: 'Restaurar', danger: true });
            if (!ok) return;
            await LK.db.importAll(data);
            u.toast('Copia restaurada');
            LK.app.refresh();
          } catch (err) {
            u.toast(err instanceof SyntaxError ? 'El archivo no es un JSON válido.' : err.message, 'error');
          }
        });

        root.querySelector('#btn-wipe').addEventListener('click', async () => {
          const ok = await u.confirm('¿Borrar todos tus libros, sesiones, citas y progreso? No se puede deshacer.', { ok: 'Borrar todo', danger: true });
          if (!ok) return;
          await LK.db.wipeAll();
          try {
            localStorage.removeItem('lk-timer');
          } catch {}
          u.toast('Datos borrados');
          LK.app.refresh();
        });
      },
    };
  };
})(window.LK);
