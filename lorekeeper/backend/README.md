# Servidor de sincronización (opcional)

LoreKeeper funciona perfectamente sin esto: los datos viven en el móvil. El servidor solo sirve para **tener la misma biblioteca en varios dispositivos** y como copia de seguridad automática.

## Cómo funciona (y por qué es seguro de verdad)

- La app genera un **código** (`ABCD-EFGH-…`) que se queda en tus dispositivos. El servidor **nunca lo recibe**.
- Los datos se **cifran en el dispositivo** (AES-GCM, clave derivada del código con PBKDF2) antes de subirse. El servidor guarda un texto ilegible y no puede leer tus libros.
- Para identificarse se envía un *token* (SHA-256 del código); el servidor solo guarda el hash del token.
- **Si pierdes el código, nadie puede recuperar los datos del servidor** (ni tú). Los datos locales del móvil siguen ahí.
- Fusión: cada libro/sesión/cita se compara por fecha de modificación; los borrados se recuerdan para que no «resuciten». Control de versiones con `If-Match` (si dos dispositivos guardan a la vez, el segundo descarga, fusiona y reintenta).

## Opción A · Cloudflare Workers (gratis, sin servidor propio)

```bash
cd backend
npx wrangler kv namespace create LK_VAULTS     # copia el id que imprime en wrangler.toml
# en wrangler.toml descomenta [vars] y pon CREATE_PASSWORD (así nadie más crea cuentas)
npx wrangler deploy
```

Te da una dirección tipo `https://lorekeeper-sync.<tu-usuario>.workers.dev`.
Nota: KV es de consistencia eventual; para una persona con dos dispositivos es más que suficiente.

## Opción B · Tu propio servidor (Node, Docker, Coolify)

Sin dependencias, Node ≥ 18:

```bash
cd backend
CREATE_PASSWORD=una-clave node server.js        # http://localhost:8787, datos en ./data
```

Con Docker, **sirviendo también la app** (todo en una sola dirección), desde la raíz del proyecto:

```bash
docker build -f backend/Dockerfile -t lorekeeper .
docker run -d -p 8787:8787 -v lk-data:/data -e CREATE_PASSWORD=una-clave lorekeeper
```

En Coolify: «Dockerfile» como tipo de build, ruta `backend/Dockerfile`, contexto la raíz del repositorio, puerto 8787, un volumen persistente en `/data` y la variable `CREATE_PASSWORD`. Ponlo detrás de https (Coolify lo gestiona).

Variables: `PORT`, `DATA_DIR`, `STATIC_DIR`, `CREATE_PASSWORD`, `ALLOWED_ORIGIN` (p. ej. `https://tuusuario.github.io`), `MAX_BYTES`.

## Usarlo desde la app

Ajustes → **Sincronizar entre dispositivos**:

1. En el primer dispositivo: «Crear una cuenta nueva», escribe la dirección del servidor (y la contraseña de creación). Te muestra el **código**: guárdalo.
2. En los demás: «Conectar con un código», o abre el **enlace de conexión** que te ofrece la app.

Requisito del navegador: si la app está en https (GitHub Pages), el servidor también debe ser https.

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Comprobación |
| POST | `/api/vaults` `{token}` | Crea un baúl (cabecera `X-Create-Password` si está configurada) |
| GET | `/api/vault[?meta=1]` | Datos cifrados y `rev` (`Authorization: Bearer <token>`) |
| PUT | `/api/vault` `{data}` | Guarda; exige `If-Match: <rev>`; 409 si hay una versión más nueva |
| DELETE | `/api/vault` | Borra el baúl |

Pruebas: `npm test`.
