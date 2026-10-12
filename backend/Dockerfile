# Imagen mínima: sirve la app y la API de sincronización.
# Construir desde la RAÍZ del proyecto:  docker build -f backend/Dockerfile -t lorekeeper .
FROM node:22-alpine
WORKDIR /srv
COPY backend/ ./backend/
COPY index.html manifest.webmanifest sw.js ./app/
COPY css ./app/css
COPY js ./app/js
COPY icons ./app/icons
ENV PORT=8787 DATA_DIR=/data STATIC_DIR=/srv/app
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "backend/server.js"]
