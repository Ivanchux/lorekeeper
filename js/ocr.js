/* ==========================================================
   CITAS DESDE UNA FOTO  (LK.ocr)
   Reconoce el texto de la foto de una página con Tesseract
   (WebAssembly, todo en el propio dispositivo: la foto no sale
   del móvil). Los archivos pesan unos 6 MB y solo se descargan
   la primera vez que se usa. Necesita http(s) (workers).
   ========================================================== */

(function (LK) {
  'use strict';

  const u = LK.util;
  let worker = null;
  let loading = null;

  const available = () => location.protocol.startsWith('http') && typeof WebAssembly === 'object';

  /** Reduce y aclara la foto: OCR más rápido y más fiable. */
  async function prepare(file, maxSide = 1800) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const ctx = canvas.getContext('2d');
    ctx.filter = 'grayscale(1) contrast(1.35) brightness(1.05)';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    return canvas;
  }

  /** Limpia el texto: junta palabras cortadas con guion y líneas de un mismo párrafo. */
  function tidy(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
      .replace(/([^\n.!?:;»”"])\n(?!\n)/g, '$1 ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function getWorker(onProgress) {
    if (worker) return worker;
    if (!loading) {
      loading = (async () => {
        await u.loadScript(u.abs('js/vendor/tesseract/tesseract.min.js'));
        const w = await window.Tesseract.createWorker('spa', 1, {
          workerPath: u.abs('js/vendor/tesseract/worker.min.js'),
          corePath: u.abs('js/vendor/tesseract/tesseract-core-lstm.wasm.js'),
          langPath: u.abs('js/vendor/tesseract'),
          gzip: true,
          logger: (m) => onProgress?.(m),
        });
        worker = w;
        return w;
      })().catch((e) => {
        loading = null;
        throw e;
      });
    }
    return loading;
  }

  /**
   * Devuelve el texto reconocido de una foto.
   * onProgress({stage, pct}) permite pintar una barra.
   */
  async function recognize(file, onProgress) {
    if (!available()) throw new Error('El reconocimiento de texto necesita la app servida por http(s) (no abriendo el archivo directamente).');
    onProgress?.({ stage: 'Preparando la foto…', pct: 0.02 });
    const canvas = await prepare(file);
    onProgress?.({ stage: 'Cargando el lector de texto (la primera vez tarda)…', pct: 0.05 });
    const w = await getWorker((m) => {
      if (m.status === 'recognizing text') onProgress?.({ stage: 'Leyendo el texto…', pct: 0.15 + m.progress * 0.85 });
      else if (m.progress != null && /load|init/.test(m.status || '')) onProgress?.({ stage: 'Cargando el lector de texto…', pct: 0.05 + m.progress * 0.1 });
    });
    const { data } = await w.recognize(canvas);
    onProgress?.({ stage: 'Listo', pct: 1 });
    return tidy(data.text);
  }

  LK.ocr = { available, recognize, tidy };
})(window.LK);
