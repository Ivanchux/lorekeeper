/* ==========================================================
   ESCÁNER DE ISBN  (LK.scanner)
   Lee el código de barras del libro con la cámara.
   - Chrome/Android: BarcodeDetector nativo (rápido, sin descargas).
   - Safari/iPhone y otros: ZXing (js/vendor/zxing.min.js), que se
     descarga solo la primera vez que se usa el escáner.
   - Siempre hay un campo para escribir el ISBN a mano.
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  const isbnTools = LK.books.isbn;

  /** Crea una función que detecta un ISBN en un <video>. */
  async function makeDetector() {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await BarcodeDetector.getSupportedFormats();
        if (formats.includes('ean_13')) {
          const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'].filter((f) => formats.includes(f)) });
          return async (video) => (await det.detect(video)).map((c) => c.rawValue);
        }
      } catch {
        /* sigue con ZXing */
      }
    }
    await u.loadScript(u.abs('js/vendor/zxing.min.js'));
    const Z = window.ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A]);
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async (video) => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return [];
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(video, 0, 0, w, h);
      try {
        const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
        return [reader.decode(bitmap).getText()];
      } catch {
        return []; // no hay código en este fotograma
      }
    };
  }

  /**
   * Abre el escáner. Llama a onIsbn(isbn13) con el primer ISBN válido
   * (o con el escrito a mano) y se cierra.
   */
  function open({ onIsbn, title = 'Escanear ISBN' } = {}) {
    const el = document.createElement('div');
    el.className = 'scanner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', title);
    el.innerHTML = `
      <div class="scanner-top">
        <strong>${u.esc(title)}</strong>
        <button class="btn btn-ghost btn-sm" data-close>Cerrar ✕</button>
      </div>
      <div class="scanner-view">
        <video playsinline muted></video>
        <div class="scanner-frame" aria-hidden="true"><i></i></div>
        <p class="scanner-msg" role="status">Iniciando cámara…</p>
      </div>
      <form class="scanner-manual">
        <label class="field"><span>¿Prefieres escribirlo? El ISBN está bajo el código de barras</span>
          <div class="search-bar">
            <input class="input" name="isbn" inputmode="numeric" autocomplete="off" placeholder="978…" aria-label="ISBN">
            <button class="btn btn-primary" type="submit">Buscar</button>
          </div>
        </label>
        <p class="small" id="scan-error" style="color:var(--danger)" hidden></p>
      </form>`;
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';

    const video = el.querySelector('video');
    const msg = el.querySelector('.scanner-msg');
    const err = el.querySelector('#scan-error');
    let stream = null;
    let alive = true;
    let timer = null;

    function close() {
      alive = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      el.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
    }
    const onKey = (e) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    el.querySelector('[data-close]').addEventListener('click', close);

    function found(raw) {
      const isbn = isbnTools.normalize(raw);
      if (!isbn) return false;
      if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(60);
      close();
      onIsbn?.(isbn);
      return true;
    }

    el.querySelector('.scanner-manual').addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = e.target.elements.isbn.value;
      if (found(raw)) return;
      err.textContent = 'Ese ISBN no es válido. Revisa los números (10 o 13 cifras).';
      err.hidden = false;
    });

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        msg.textContent = 'Este navegador no deja usar la cámara aquí. Escribe el ISBN.';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        msg.textContent =
          e.name === 'NotAllowedError' ? 'Has bloqueado la cámara. Actívala en el candado de la barra de direcciones o escribe el ISBN.' : 'No se pudo abrir la cámara. Escribe el ISBN.';
        return;
      }
      if (!alive) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      await video.play().catch(() => {});

      let detect;
      try {
        detect = await makeDetector();
      } catch {
        msg.textContent = 'No se pudo cargar el lector de códigos (¿sin conexión?). Escribe el ISBN.';
        return;
      }
      msg.textContent = 'Apunta al código de barras de la contraportada';

      const loop = async () => {
        if (!alive) return;
        try {
          if (video.readyState >= 2) {
            for (const raw of await detect(video)) if (found(raw)) return;
          }
        } catch {
          /* fotograma ilegible: sigue */
        }
        timer = setTimeout(loop, 160);
      };
      loop();
    })();

    return { close };
  }

  LK.scanner = { open };
})(window.LK);
