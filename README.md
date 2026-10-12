# LoreKeeper

Tracker de lectura **gratuito, sin anuncios ni suscripciones** y que funciona sin conexión. Una reinterpretación de Bookmory con libros en 3D, estanterías, temporizador que sigue en segundo plano, logros y un sistema de niveles opcional.

Hecho con HTML, CSS y JavaScript puros, sin frameworks. Se instala como app (PWA) y también se puede abrir con doble clic desde una carpeta. Proyecto educativo y de portfolio.

## Funciones

**Leer**
- **Hoy:** meta diaria (minutos o páginas) con anillo de progreso, racha y un botón grande de «Seguir leyendo».
- **Temporizador que sigue en segundo plano:** puedes salir de la app o apagar la pantalla; el reloj usa la hora real. Aviso opcional en la barra de notificaciones con **Pausar / Terminar**, tiempo en el título y protección si te dejas el reloj en marcha horas.
- **Registrar sesiones** por páginas o por porcentaje. Atajos de 15/30/45/60/90 min.
- **Audiolibros de verdad**: tiempo real escuchado (horas y minutos), **velocidad** (0,75× a 3×), punto de inicio y punto final del audio, que se pueden dar como *posición*, *«me quedan»* (lo que enseñan Audible o Storytel) o *porcentaje*. Capítulo opcional, «vas por…» en vivo con el reloj, progreso por posición, ritmo medio y logros propios. Pensado para quien escucha mientras hace otras cosas.
- **Libro 3D con el color de la portada** (lomo, contraportada, cantos y brillo) y **animaciones** por toda la app (entradas escalonadas, barras y números que se llenan, confeti al terminar un libro). Se apagan con «Reducir movimiento» del sistema o con el interruptor de Ajustes.
- **Diseño de app en el móvil** (`css/mobile.css`): títulos grandes, barra inferior flotante, tarjetas redondeadas, botones de 48–56 px, ventanas que suben desde abajo, pestañas en píldoras y letra del sistema en el tema Terminal para que no se vea comprimido. Al instalarla en iPhone abre a pantalla completa. En escritorio no cambia nada.

**Biblioteca**
- Estanterías (Leyendo, Pendientes, Leídos, Abandonados), buscador interno, orden, libro 3D que se arrastra.
- **Sagas**, **formato** (papel / ebook / audio), **etiquetas** y **préstamos** (a quién, hasta cuándo; avisos si vencen).
- «¿Qué leo ahora?» elige un pendiente al azar.

**Añadir libros**
- Búsqueda en Google Books y Open Library, alta manual, **escáner de código de barras (ISBN)** con la cámara y **importación de Bookmory / Goodreads / cualquier Excel o CSV** con detección de columnas y vista previa.

**Citas**
- Escritas a mano o **desde una foto** (reconocimiento de texto en el propio dispositivo) y **compartibles como imagen**.

**Motivación (opcional)**
- Niveles, atributos, **24 logros**, **«Tu año en libros»** compartible, estadísticas (calendario, mensual, ritmo, objetivo anual con ritmo esperado, libros por año, autores favoritos, valoraciones y etiquetas). Los libros importados cuentan en totales y gráficas repartidos entre sus fechas de inicio y fin (páginas y tiempo estimados si faltan). **Gráficos** en rosco por año, autor, género, editorial y formato. El **1 de enero** se abre solo «Tu año en libros» del año que termina.
- **Modo fácil:** letra grande, botones grandes y sin nada de juego. Tamaño de letra en 3 niveles y 6 estéticas, agrupadas en oscuras (Terminal, Grimorio, Luciérnaga) y claras (Biblioteca, Minimal, Girasol).

**Tus datos**
- Todo en el dispositivo. Copias: enviar por el menú del móvil (Drive, WhatsApp, correo), descargar JSON, restaurar.
- **Sincronización opcional cifrada** entre dispositivos con un servidor propio (`backend/`).
- Recordatorio diario como evento de calendario (`.ics`) + aviso dentro de la app.

## Límites de una PWA (y cómo se compensan)

No es una app de tienda; hay cosas que el navegador no permite:

| Cosa | Situación |
|---|---|
| Cronómetro vivo en la pantalla de bloqueo / Dynamic Island | No se puede. Se compensa con el aviso persistente (Android; en iPhone, solo con la app instalada) y el reloj basado en la hora real |
| Notificación programada con la app cerrada | No sin un servidor de notificaciones push. Se usa un evento de calendario con alarma |
| Escáner de códigos en Safari | No existe `BarcodeDetector`: se usa la librería ZXing incluida |
| iPhone: borrado de datos | Safari puede borrar datos de webs que no se usan en semanas; instalada en la pantalla de inicio es más seguro. **Haz copias** o activa la sincronización |
| Widgets, Siri, Apple Watch | No |
| Sincronizar con Google Drive | No implementado (exige registrar un cliente OAuth). Alternativa: copia por el menú compartir o servidor propio |

## Cómo abrirla

**Rápido:** doble clic en `index.html`. Funciona casi todo salvo instalar la app, los avisos, la sincronización y la lectura de texto de fotos (necesitan http).

**Completo (PWA):**

```bash
python -m http.server 8080      # o: npx serve .
```

Para el móvil hace falta publicarla con https: GitHub Pages, Cloudflare Pages o tu servidor (`backend/` también sirve la app).

**Instalarla en el móvil**

- **iPhone:** abrir el enlace en Safari → Compartir → *Añadir a pantalla de inicio* y usarla desde el icono. La app instalada tiene su propio almacenamiento, así que los libros se añaden ya desde ahí. Los avisos de la sesión de lectura requieren iOS 16.4 o superior.
- **Android:** Chrome → menú → *Instalar aplicación*.

## Estructura

```
├── index.html, manifest.webmanifest, sw.js
├── css/        themes.css · base.css · book3d.css · features.css · motion.css · mobile.css
├── js/
│   ├── util, prefs, books, storage, rpg, audio, achievements, summary
│   ├── theme, api, book3d, fx, charts, ui, cards
│   ├── csv (CSV y XLSX), scanner, ocr, sync, reminder, timer, onboarding
│   ├── views/  library · search · book · stats · settings · importer · extras
│   ├── app.js  (arranque y rutas)
│   └── vendor/ ZXing y Tesseract.js (licencias en js/vendor/licenses)
├── backend/    servidor de sincronización (Worker o Node) + pruebas
└── icons/
```

Scripts clásicos que comparten el objeto global `LK` (sin módulos ES), por eso funciona también desde `file://`.

## Arquitectura

- **Local primero.** IndexedDB (con respaldo en localStorage). Las vistas solo usan `LK.db`; la sincronización se engancha a `db.onChange`.
- **Progreso calculado, no guardado.** Nivel, EXP, atributos y logros se calculan a partir de las sesiones: si borras una, todo se recalcula.
- **Temas por variables CSS.** Añadir uno = un bloque en `themes.css` + una entrada en `theme.js`.
- **Sincronización cifrada de extremo a extremo** con fusión por registros y lápidas de borrado (ver `backend/README.md`).

## Sistema RPG (opcional)

| Concepto | Regla |
|---|---|
| EXP por sesión | `páginas × 2 + minutos × 1,5` |
| Bonus por terminar un libro | `+50 EXP` (no en libros importados) |
| EXP para subir de nivel | `nivel ^ 1,5 × 100` |
| Atributos | Empiezan en 10; +1 por cada 20 páginas del género (audio: 2 min ≈ 1 página) |

Rangos: Aprendiz (1) · Lector (3) · Escriba (5) · Erudito (8) · Archivista (12) · Cronista (16) · Custodio del Saber (20) · Guardián del Lore (30).

## Pruebas

`cd backend && npm test` prueba el servidor. La interfaz se ha probado con Playwright (Chromium): flujos, desbordes en móvil (360 y 390 px, letra grande, los cuatro temas) y `file://`. Falta probarla en un iPhone real.

## Licencia

MIT © Iván Brihuega. Librerías de terceros en `js/vendor/THIRD_PARTY.md`.
