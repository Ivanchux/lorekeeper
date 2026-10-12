# Librerías de terceros (incluidas en local para que la app funcione sin conexión)

| Archivo | Proyecto | Versión | Licencia | Para qué se usa |
|---|---|---|---|---|
| `zxing.min.js` | [@zxing/library](https://github.com/zxing-js/library) | 0.21.3 | Apache-2.0 (archivo LICENSE; el `package.json` del paquete indica MIT) | Leer códigos de barras (ISBN) en navegadores sin `BarcodeDetector`, como Safari en iPhone |
| `tesseract/tesseract.min.js`, `tesseract/worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) | 5.1.1 | Apache-2.0 | Reconocer texto en la foto de una página (citas) |
| `tesseract/tesseract-core-lstm.wasm.js` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 5.1.1 | Apache-2.0 | Motor de OCR (Tesseract compilado a WebAssembly) |
| `tesseract/spa.traineddata.gz` | [@tesseract.js-data/spa](https://github.com/naptha/tessdata) (`4.0.0_best_int`) | 1.0.0 | Apache-2.0 | Modelo de idioma español para el OCR |

Los textos completos de las licencias están en la carpeta `licenses/`.

Estos archivos solo se descargan cuando se usa la función correspondiente (escáner de ISBN u OCR de citas).
